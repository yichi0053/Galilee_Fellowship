/**
 * /admin —— 管理後台四分頁（架構書 §10.1、§9.7）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 前端的身分判斷只決定畫不畫得出來，擋不住任何人——真正的授權在 RLS 與
 * Edge Function（§16）。把 admin 這個網址打進網址列的人會看到「只有管理員」，
 * 但就算他繞過那一層，每個操作在資料庫端仍然會被拒。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/admin.css';

import { JOIN_CODE_MIN_LENGTH, SOFT_DELETE_RETENTION_DAYS } from '@config/constants';
import {
  getRoomSettings,
  listHidden,
  listJoinAttempts,
  listMembers,
  listSoftDeleted,
  markMemberLeft,
  reinstateMember,
  runCleanup,
  suspendMember,
  unhidePost,
  updateRoomSettings,
} from '@modules/admin';
import type { MemberSummary, RoomSettings } from '@modules/admin';
import { shiftWeeks, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';
import { getViewer } from '@modules/membership';
import { listThemesFrom, scheduleThemes } from '@modules/themes';

const dateFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'short',
  timeStyle: 'short',
});

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function message(kind: 'error' | 'info', text: string): HTMLElement {
  const node = el('p', `paper-message paper-message--${kind}`, text);
  if (kind === 'error') node.setAttribute('role', 'alert');
  return node;
}

/** 面板頂端的一次性提示。同一個面板重畫時舊的會一起消失 */
function notify(panel: HTMLElement, kind: 'error' | 'info', text: string): void {
  panel.querySelector('.paper-message')?.remove();
  panel.insertBefore(message(kind, text), panel.firstChild);
}

function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('div', 'paper-field');
  const label = el('label', 'paper-field__label', labelText);
  if (hint) label.append(el('span', 'paper-field__hint', hint));
  wrap.append(label, control);
  return wrap;
}

// ------------------------------------------------------- 分頁 1：房間 ---

async function roomPanel(panel: HTMLElement): Promise<void> {
  const room: RoomSettings = await getRoomSettings();

  panel.append(
    el('p', 'admin-panel__lead', '房間名稱與說明會顯示在牆頁頂端。房間碼是成員加入的唯一憑證。'),
  );

  const name = el('input', 'paper-input');
  name.type = 'text';
  name.value = room.name;

  const description = el('textarea', 'paper-input');
  description.rows = 2;
  description.value = room.description ?? '';

  // 房間碼是明文儲存的（ADR-0008），本來就要能複述給成員聽，
  // 所以預設遮蔽只是避免投影或截圖時外流，不是安全措施。
  const code = el('input', 'paper-input');
  code.type = 'password';
  code.value = room.joinCode;
  code.autocomplete = 'off';

  const reveal = el('button', 'mini', '顯示');
  reveal.type = 'button';
  reveal.addEventListener('click', () => {
    const hidden = code.type === 'password';
    code.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? '遮蔽' : '顯示';
  });

  const copy = el('button', 'mini', '複製');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(code.value).then(
      () => {
        copy.textContent = '已複製';
        window.setTimeout(() => (copy.textContent = '複製'), 1500);
      },
      () => notify(panel, 'error', '這個瀏覽器不允許自動複製，請手動選取。'),
    );
  });

  const codeRow = el('div', 'code-row');
  codeRow.append(code, reveal, copy);

  const open = el('input');
  open.type = 'checkbox';
  open.checked = room.joinOpen;
  const openLabel = el('label', 'join-agree');
  openLabel.append(
    open,
    document.createTextNode('開放加入。人到齊之後關掉，房間碼就會立即失效（§8.4）。'),
  );

  const save = el('button', 'paper-button', '儲存設定');
  save.type = 'submit';

  const form = el('form');
  form.noValidate = true;
  form.append(
    field('房間名稱', name),
    field('說明', description),
    field('房間碼', codeRow, `至少 ${JOIN_CODE_MIN_LENGTH} 個字元。改動後舊的房間碼立即失效。`),
    openLabel,
    save,
  );
  panel.append(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    save.textContent = '儲存中…';
    void (async () => {
      try {
        await updateRoomSettings({
          name: name.value,
          description: description.value.trim() || null,
          joinCode: code.value,
          joinOpen: open.checked,
        });
        notify(panel, 'info', '已儲存。');
      } catch (error: unknown) {
        // WeakJoinCodeError 的訊息本身就是給人看的，不再翻譯一次。
        notify(panel, 'error', error instanceof Error ? error.message : '儲存失敗。');
      } finally {
        save.disabled = false;
        save.textContent = '儲存設定';
      }
    })();
  });
}

// --------------------------------------------------- 分頁 2：主題排程 ---

/** 一學期 18 週（README）。一次排完，之後只需要偶爾回來調整 */
const WEEKS_AHEAD = 18;

function weekLabel(week: WeekStart, current: WeekStart): string {
  const label = week.replace(/-/g, '/').slice(5);
  return week === current ? `${label}（本週）` : label;
}

async function themesPanel(panel: HTMLElement): Promise<void> {
  const current = weekStartOf();
  const existing = new Map((await listThemesFrom(current)).map((t) => [t.week, t]));

  panel.append(
    el(
      'p',
      'admin-panel__lead',
      '§9.6：忘記設定的那一週會出現空窗，而空窗週的發文量通常斷崖下滑，' +
        '所以預排是必要功能而不是便利功能。標題留白代表那一週沒有主題，' +
        '成員只能發自由貼文。過期的主題不可補發。',
    ),
  );

  const form = el('form');
  form.noValidate = true;
  const rows = el('div', 'rows');

  const inputs: { week: WeekStart; title: HTMLInputElement; desc: HTMLInputElement }[] = [];

  for (let i = 0; i < WEEKS_AHEAD; i += 1) {
    const week = shiftWeeks(current, i);
    const theme = existing.get(week);

    const row = el('div', 'row');
    row.append(el('span', 'row__meta', weekLabel(week, current)));

    const title = el('input', 'paper-input');
    title.type = 'text';
    title.value = theme?.title ?? '';
    title.placeholder = '主題標題（留白＝這週沒有主題）';

    const desc = el('input', 'paper-input');
    desc.type = 'text';
    desc.value = theme?.description ?? '';
    desc.placeholder = '補充說明（可留白）';

    row.append(title, desc);
    rows.append(row);
    inputs.push({ week, title, desc });
  }

  const save = el('button', 'paper-button', '儲存主題排程');
  save.type = 'submit';
  form.append(rows, save);
  panel.append(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    save.textContent = '儲存中…';
    void (async () => {
      try {
        const result = await scheduleThemes(
          inputs.map((i) => ({ week: i.week, title: i.title.value, description: i.desc.value })),
        );
        notify(panel, 'info', `已儲存。從本週起共 ${result.length} 週有主題。`);
      } catch (error: unknown) {
        notify(panel, 'error', error instanceof Error ? error.message : '儲存失敗。');
      } finally {
        save.disabled = false;
        save.textContent = '儲存主題排程';
      }
    })();
  });
}

// --------------------------------------------------- 分頁 3：成員管理 ---

const STATUS_LABEL: Record<MemberSummary['status'], string> = {
  active: '正常',
  suspended: '已停權',
  left: '已退出',
};

async function membersPanel(panel: HTMLElement): Promise<void> {
  const members = await listMembers();

  panel.append(
    el(
      'p',
      'admin-panel__lead',
      '「停權」與「標記退出」對貼文的處置不同，這是最容易按錯的一組（§4.3）：' +
        '停權者的貼文一律隱藏；退出者的貼文保留顯示。想退出的人請他私訊你，由你代為標記。',
    ),
  );

  const rows = el('div', 'rows');
  for (const m of members) {
    const row = el('div', 'row');
    row.append(el('span', 'row__name', m.displayName));

    const status = el('span', 'badge', STATUS_LABEL[m.status]);
    status.dataset['status'] = m.status;
    row.append(status);

    if (m.role === 'admin') {
      const role = el('span', 'badge', '管理員');
      role.dataset['role'] = 'admin';
      row.append(role);
    }

    row.append(el('span', 'row__meta', `${dateFormat.format(m.joinedAt)} 加入`));

    const actions = el('div', 'row__actions');
    const act = async (
      label: string,
      run: () => Promise<void>,
      danger: boolean,
    ): Promise<HTMLButtonElement> => {
      const button = el('button', danger ? 'mini mini--danger' : 'mini', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        button.disabled = true;
        void run().then(
          () => void redraw('members'),
          (error: unknown) => {
            button.disabled = false;
            notify(panel, 'error', error instanceof Error ? error.message : '操作失敗。');
          },
        );
      });
      return button;
    };

    // 管理員自己不給任何按鈕：停掉唯一的管理員就沒有人能把它復權了（ADR-0014 單一管理員）。
    if (m.role !== 'admin') {
      if (m.status === 'active') {
        actions.append(
          await act('停權（貼文隱藏）', () => suspendMember(m.memberId), true),
          await act('標記退出（貼文保留）', () => markMemberLeft(m.memberId), false),
        );
      } else {
        actions.append(await act('恢復為正常', () => reinstateMember(m.memberId), false));
      }
    }
    row.append(actions);
    rows.append(row);
  }
  panel.append(rows);

  // §8.3 的稽核紀錄。放在成員管理底下而不是自己一個分頁：
  // 會來看它的時機幾乎都是「有人說加不進來」，而那時你已經在這一頁了。
  const attempts = await listJoinAttempts();
  panel.append(el('h2', 'paper-field__label', '最近的加入嘗試'));
  panel.append(
    el(
      'p',
      'admin-panel__lead',
      '最多 50 筆。連續失敗多半只是有人打錯字；若同一時間出現大量失敗，' +
        '到「房間設定」把開放加入關掉即可讓房間碼立即失效。',
    ),
  );

  if (attempts.length === 0) {
    panel.append(el('p', 'empty-note', '還沒有人嘗試加入。'));
    return;
  }

  const attemptRows = el('div', 'rows');
  for (const a of attempts) {
    const row = el('div', 'row');
    row.append(el('span', 'row__name', a.displayName ?? '（尚未加入的人）'));
    const badge = el('span', 'badge', a.success ? '成功' : '失敗');
    badge.dataset['ok'] = String(a.success);
    row.append(badge);
    row.append(el('span', 'row__meta', dateFormat.format(a.at)));
    attemptRows.append(row);
  }
  panel.append(attemptRows);
}

// --------------------------------------------------- 分頁 4：貼文管理 ---

/**
 * 下架中的貼文（§9.5、§9.7）。
 *
 * 下架的入口在每則貼文自己的頁面，但下架之後那則就從所有人的牆上消失了——
 * 包含管理員自己的。只有作者看得到佔位。沒有這一區，
 * 「我上週下架了什麼」與「把它放回去」實務上都做不到。
 */
async function hiddenSection(panel: HTMLElement): Promise<void> {
  const hidden = await listHidden();

  panel.append(el('h2', 'paper-field__label', `下架中（${hidden.length}）`));
  panel.append(
    el(
      'p',
      'admin-panel__lead',
      '下架的貼文只有作者看得到佔位，其他成員與訪客一律看不到。' +
        '資料與照片都還在，可發文次數也不受影響——放回架上就恢復原狀。',
    ),
  );

  if (hidden.length === 0) {
    panel.append(el('p', 'empty-note', '目前沒有下架中的貼文。'));
    return;
  }

  const rows = el('div', 'rows');
  for (const h of hidden) {
    const row = el('div', 'row row--hidden');

    // 縮圖是這一區最重要的資訊：要決定放不放回去，得先看得到那是什麼。
    const thumb = el('img', 'row__thumb');
    thumb.src = h.thumbUrl;
    thumb.alt = h.title;
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    row.append(thumb);

    const meta = el('div', 'row__stack');
    meta.append(el('span', 'row__name', h.title));
    meta.append(
      el(
        'span',
        'row__meta',
        `${h.authorName} · ${dateFormat.format(h.createdAt)} · ${h.week.replace(/-/g, '/')} 那一週`,
      ),
    );
    row.append(meta);

    const actions = el('div', 'row__actions');

    const view = el('a', 'mini');
    view.href = `/post/${h.id}`;
    view.textContent = '看完整貼文';
    actions.append(view);

    const restore = el('button', 'mini', '放回架上');
    restore.type = 'button';
    restore.addEventListener('click', () => {
      restore.disabled = true;
      restore.textContent = '處理中…';
      void unhidePost(h.id).then(
        () => void redraw('posts'),
        (error: unknown) => {
          restore.disabled = false;
          restore.textContent = '放回架上';
          notify(panel, 'error', error instanceof Error ? error.message : '操作失敗。');
        },
      );
    });
    actions.append(restore);

    row.append(actions);
    rows.append(row);
  }
  panel.append(rows);
}

async function postsPanel(panel: HTMLElement): Promise<void> {
  await hiddenSection(panel);

  const deleted = await listSoftDeleted();

  panel.append(el('h2', 'paper-field__label', '等待清理'));
  panel.append(
    el(
      'p',
      'admin-panel__lead',
      `作者刪除的貼文會先軟刪除，${SOFT_DELETE_RETENTION_DAYS} 天後才連同照片一起真的移除（ADR-0009）。` +
        '下架單則貼文請到那則貼文自己的頁面。',
    ),
  );

  if (deleted.length === 0) {
    panel.append(el('p', 'empty-note', '目前沒有等待清理的貼文。'));
  } else {
    const rows = el('div', 'rows');
    for (const d of deleted) {
      const days = Math.max(
        0,
        SOFT_DELETE_RETENTION_DAYS -
          Math.floor((Date.now() - d.deletedAt.getTime()) / 86_400_000),
      );
      const row = el('div', 'row');
      row.append(el('span', 'row__name', `${dateFormat.format(d.deletedAt)} 刪除`));
      row.append(
        el('span', 'row__meta', days === 0 ? '已到期，下次清理會移除' : `還有 ${days} 天到期`),
      );
      rows.append(row);
    }
    panel.append(rows);
  }

  const run = el('button', 'paper-button', '執行清理');
  run.type = 'button';
  run.addEventListener('click', () => {
    run.disabled = true;
    run.textContent = '清理中…';
    void runCleanup().then(
      (result) => {
        notify(
          panel,
          'info',
          result.deletedRows === 0
            ? '沒有到期的貼文，什麼都沒動。'
            : `已移除 ${result.deletedRows} 則貼文與 ${result.deletedObjects} 個檔案。`,
        );
        run.disabled = false;
        run.textContent = '執行清理';
      },
      (error: unknown) => {
        notify(panel, 'error', error instanceof Error ? error.message : '清理失敗。');
        run.disabled = false;
        run.textContent = '執行清理';
      },
    );
  });
  panel.append(run);
}

// ------------------------------------------------------------- 外框 ---

type TabId = 'room' | 'themes' | 'members' | 'posts';

const TABS: ReadonlyArray<{ id: TabId; label: string; render: (p: HTMLElement) => Promise<void> }> =
  [
    { id: 'room', label: '房間設定', render: roomPanel },
    { id: 'themes', label: '主題排程', render: themesPanel },
    { id: 'members', label: '成員管理', render: membersPanel },
    { id: 'posts', label: '貼文管理', render: postsPanel },
  ];

let current: TabId = 'room';

async function redraw(tab: TabId): Promise<void> {
  current = tab;
  const panel = document.querySelector<HTMLElement>('.admin-panel');
  const tabs = document.querySelectorAll<HTMLButtonElement>('.admin-tab');
  if (!panel) return;

  tabs.forEach((t) => t.setAttribute('aria-current', String(t.dataset['tab'] === tab)));
  panel.replaceChildren();

  const entry = TABS.find((t) => t.id === tab);
  if (!entry) return;
  try {
    await entry.render(panel);
  } catch (error: unknown) {
    panel.replaceChildren(
      message('error', error instanceof Error ? error.message : '載入失敗。'),
    );
  }
}

function shell(roomName: string): HTMLElement {
  const wrap = el('div', 'admin-shell');

  const head = el('header', 'admin-head');
  head.append(el('h1', 'admin-head__title', `${roomName} · 管理後台`));
  const back = el('a', 'admin-head__back', '回照片牆');
  back.href = '/wall';
  head.append(back);

  const tabs = el('nav', 'admin-tabs');
  for (const t of TABS) {
    const button = el('button', 'admin-tab', t.label);
    button.type = 'button';
    button.dataset['tab'] = t.id;
    button.setAttribute('aria-current', String(t.id === current));
    button.addEventListener('click', () => void redraw(t.id));
    tabs.append(button);
  }

  wrap.append(head, tabs, el('section', 'admin-panel'));
  return wrap;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    const viewer = await getViewer();
    if (viewer.kind !== 'admin') {
      app.className = 'paper-page';
      const box = el('section', 'paper-card');
      box.append(el('span', 'paper-card__pin'));
      box.append(el('h1', 'paper-card__title', '只有管理員看得到這一頁'));
      box.append(
        message('info', '如果你覺得這是錯的，請聯絡團契負責人確認你的身分設定。'),
      );
      const wrap = el('p', 'paper-links');
      const link = el('a');
      link.href = '/wall';
      link.textContent = '回照片牆';
      wrap.append(link);
      box.append(wrap);
      app.replaceChildren(box);
      return;
    }

    app.className = 'admin-page';
    const room = await getRoomSettings();
    app.replaceChildren(shell(room.name));
    await redraw('room');
  } catch (error: unknown) {
    app.className = 'paper-page';
    const box = el('section', 'paper-card');
    box.append(el('span', 'paper-card__pin'));
    box.append(el('h1', 'paper-card__title', '載入失敗'));
    box.append(message('error', error instanceof Error ? error.message : '無法載入後台。'));
    app.replaceChildren(box);
  }
}

void main();
