/**
 * /member/me/edit —— 個人檔案設定（架構書 §10.7 / ADR-0022）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 四個欄位裡只有暱稱是必填，其餘全部選填、留白即清空。
 * 這一頁刻意不做「儲存中不能離開」之類的攔截：填不填都無所謂的東西，
 * 不值得為它擋住使用者的返回鍵。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/profile.css';

import {
  DISPLAY_NAME_MAX_LENGTH,
  FAVORITE_VERSE_MAX_LENGTH,
  INTERESTS_MAX_LENGTH,
} from '@config/constants';
import { signOut } from '@modules/auth';
import { getViewer } from '@modules/membership';
import { getMyProfile, updateMyProfile } from '@modules/profile';
import type { Profile } from '@modules/profile';

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

function card(title: string, lead?: string): HTMLElement {
  const box = el('section', 'paper-card');
  box.append(el('span', 'paper-card__pin'));
  box.append(el('h1', 'paper-card__title', title));
  if (lead) box.append(el('p', 'paper-card__lead', lead));
  return box;
}

function message(kind: 'error' | 'info', text: string): HTMLElement {
  const node = el('p', `paper-message paper-message--${kind}`, text);
  if (kind === 'error') node.setAttribute('role', 'alert');
  return node;
}

function backLink(): HTMLElement {
  const wrap = el('p', 'paper-links');
  const link = el('a');
  link.href = '/wall';
  link.textContent = '回照片牆';
  wrap.append(link);
  return wrap;
}

type FieldOptions = {
  id: string;
  label: string;
  hint?: string;
  value: string;
  maxLength?: number;
  type?: 'text' | 'date';
  multiline?: boolean;
};

/** 一格欄位加上即時字數。回傳讀值用的元素，讓呼叫端不必再 querySelector 一次 */
function field(options: FieldOptions): {
  node: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement;
} {
  const wrap = el('div', 'paper-field');
  const label = el('label', 'paper-field__label', options.label);
  label.htmlFor = options.id;
  wrap.append(label);
  if (options.hint) wrap.append(el('span', 'paper-field__hint', options.hint));

  const input = options.multiline
    ? el('textarea', 'body-input')
    : (() => {
        const node = el('input', 'paper-input');
        node.type = options.type ?? 'text';
        return node;
      })();
  input.id = options.id;
  input.value = options.value;
  if (options.maxLength !== undefined) input.maxLength = options.maxLength;
  wrap.append(input);

  if (options.maxLength !== undefined) {
    const counter = el('span', 'counter');
    const sync = (): void => {
      counter.textContent = `${input.value.trim().length} / ${options.maxLength ?? 0}`;
    };
    sync();
    input.addEventListener('input', sync);
    wrap.append(counter);
  }

  return { node: wrap, input };
}

function form(profile: Profile, onSaved: (next: Profile) => void): HTMLElement {
  const box = card(
    '個人檔案',
    '除了暱稱以外都可以留白。填了的欄位，同房間的成員看得到；訪客看不到。',
  );

  const name = field({
    id: 'p-name',
    label: '暱稱',
    hint: '牆上每則貼文的署名。改了之後既有貼文的署名會一起變。',
    value: profile.displayName,
    maxLength: DISPLAY_NAME_MAX_LENGTH,
  });
  const birthday = field({
    id: 'p-birthday',
    label: '生日（選填）',
    hint: '只有月日會用來提醒大家，年份不會顯示在任何地方。',
    value: profile.birthday ?? '',
    type: 'date',
  });
  const interests = field({
    id: 'p-interests',
    label: '興趣（選填）',
    value: profile.interests ?? '',
    maxLength: INTERESTS_MAX_LENGTH,
  });
  const verse = field({
    id: 'p-verse',
    label: '喜歡的一句聖經經節（選填）',
    hint: '寫下經文與出處，例如「你們要休息，要知道我是神。—— 詩篇 46:10」。',
    value: profile.favoriteVerse ?? '',
    maxLength: FAVORITE_VERSE_MAX_LENGTH,
    multiline: true,
  });

  const formNode = el('form');
  formNode.noValidate = true;

  const save = el('button', 'paper-button', '儲存');
  save.type = 'submit';
  formNode.append(name.node, birthday.node, interests.node, verse.node, save);

  let notice: HTMLElement | null = null;
  const notify = (kind: 'error' | 'info', text: string): void => {
    notice?.remove();
    notice = message(kind, text);
    formNode.insertBefore(notice, save);
  };

  formNode.addEventListener('submit', (event) => {
    event.preventDefault();
    const displayName = name.input.value.trim();
    // 伺服器也會擋（migration 013 的 check），這裡先擋是為了少一趟往返。
    if (displayName.length === 0) return notify('error', '暱稱不可留白。');

    save.disabled = true;
    save.textContent = '儲存中…';
    void (async () => {
      try {
        const next = await updateMyProfile({
          displayName,
          birthday: birthday.input.value,
          interests: interests.input.value,
          favoriteVerse: verse.input.value,
        });
        onSaved(next);
        notify('info', '已儲存。');
      } catch (error: unknown) {
        notify('error', error instanceof Error ? error.message : '儲存失敗，請再試一次。');
      } finally {
        save.disabled = false;
        save.textContent = '儲存';
      }
    })();
  });

  box.append(formNode);
  return box;
}

/** 登出放在這一頁的最底下：它與上面的欄位是不同性質的操作，不該混在同一個表單裡 */
function signOutBlock(): HTMLElement {
  const box = el('section', 'profile-signout');
  const button = el('button', 'paper-button paper-button--quiet', '登出');
  button.type = 'button';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = '登出中…';
    // 登出後回牆頁：留在原地的話畫面還是成員視角，重新載入才會換成訪客視角。
    void signOut()
      .then(() => window.location.replace('/wall'))
      .catch(() => window.location.replace('/wall'));
  });
  box.append(button);
  return box;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  app.className = 'paper-page';

  try {
    const viewer = await getViewer();
    if (viewer.kind !== 'member' && viewer.kind !== 'admin') {
      const box = card('只有成員看得到這一頁');
      box.append(message('info', '先加入房間，才會有個人檔案。'));
      const links = el('p', 'paper-links');
      const join = el('a');
      join.href = '/join';
      join.textContent = '前往加入';
      links.append(join);
      box.append(links, backLink());
      app.replaceChildren(box);
      return;
    }

    const profile = await getMyProfile();
    const wrap = el('div', 'profile-page');
    wrap.append(
      form(profile, () => undefined),
      signOutBlock(),
      backLink(),
    );
    app.replaceChildren(wrap);
  } catch (error: unknown) {
    const box = card('載入失敗');
    box.append(message('error', error instanceof Error ? error.message : '無法載入個人檔案。'));
    box.append(backLink());
    app.replaceChildren(box);
  }
}

void main();
