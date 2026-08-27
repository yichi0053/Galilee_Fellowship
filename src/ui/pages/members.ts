/**
 * /members 與 /members/:id —— 成員列表與某位成員的個人資料（§10.8 / ADR-0023）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * **與 /member/... 是兩組路由，不要看混。**
 *   /members          房間裡有誰
 *   /members/:id      那個人的個人資料
 *   /member/me        我的貼文
 *   /member/me/edit   我的個人檔案設定
 * 命名確實接近，但 /member/* 是「關於我」，/members* 是「關於大家」。
 * 兩者在 _redirects 與 vite.config 裡各有規則，且不會互相吃到——
 * `/member/*` 的萬用字元要求 member 後面緊接 `/`，而 `/members/x` 是 `s`。
 *
 * 整頁只有成員看得到：成員名單帶有宗教信仰資訊、屬個資法第 6 條特種個人資料（§8.6）。
 * 訪客即使直接打網址，members_select policy 也只會回空陣列——
 * 但空白畫面看不出原因，所以這裡自己先擋一次並說明。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/members.css';

import { getViewer } from '@modules/membership';
import { getProfileOf, listRoomMembers } from '@modules/profile';
import type { MemberCard, Profile } from '@modules/profile';
import { initialAvatar } from '@ui/components/avatar';

const birthdayFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'long',
  day: 'numeric',
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

function links(...anchors: readonly HTMLAnchorElement[]): HTMLElement {
  const wrap = el('p', 'paper-links');
  for (const [i, a] of anchors.entries()) {
    if (i > 0) wrap.append(document.createTextNode('　'));
    wrap.append(a);
  }
  return wrap;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a');
  a.href = href;
  a.textContent = text;
  return a;
}

/** /members/<id> 的最後一段。/members 本身沒有第二段，回傳 null */
function memberIdFromPath(): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? (parts[1] ?? null) : null;
}

// ------------------------------------------------------------ 成員列表 ---

function memberTile(m: MemberCard): HTMLElement {
  // 是 <a> 而不是按鈕：點下去是換頁，用連結才有長按開新分頁與複製網址。
  const tile = el('a', 'member-tile');
  tile.href = `/members/${m.memberId}`;
  tile.append(initialAvatar(m.displayName, 'member-tile__avatar'));
  tile.append(el('span', 'member-tile__name', m.displayName));
  return tile;
}

function listView(members: readonly MemberCard[]): HTMLElement {
  const wrap = el('div', 'members-page');
  const head = el('header', 'members-head');
  head.append(el('h1', 'members-head__title', '成員'));
  head.append(el('span', 'members-head__count', `共 ${members.length} 人`));
  const back = el('a', 'members-head__back', '回照片牆');
  back.href = '/wall';
  head.append(back);
  wrap.append(head);

  if (members.length === 0) {
    wrap.append(el('p', 'wall-empty', '目前沒有其他成員。'));
    return wrap;
  }

  const grid = el('div', 'member-grid');
  for (const m of members) grid.append(memberTile(m));
  wrap.append(grid);
  return wrap;
}

// -------------------------------------------------------- 某人的個人資料 ---

/** 一列「標籤 + 內容」。沒填的欄位整列不畫，不留一排「未填寫」 */
function row(label: string, value: string | null): HTMLElement | null {
  if (value === null || value.trim().length === 0) return null;
  const node = el('div', 'profile-row');
  node.append(el('span', 'profile-row__label', label));
  node.append(el('p', 'profile-row__value', value));
  return node;
}

/**
 * 生日只顯示月日。
 *
 * 年份是比月日敏感得多的個資，而團契想知道的是「什麼時候幫他慶生」——
 * 那不需要年份。存的時候存完整日期（date 欄位不能只存月日），顯示時砍掉。
 */
function birthdayRow(iso: string | null): HTMLElement | null {
  if (iso === null) return null;
  const date = new Date(`${iso}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  return row('生日', birthdayFormat.format(date));
}

function profileView(profile: Profile, isMe: boolean): HTMLElement {
  const wrap = el('div', 'members-page');

  const box = el('section', 'paper-card profile-card');
  box.append(el('span', 'paper-card__pin'));
  box.append(initialAvatar(profile.displayName, 'profile-card__avatar'));
  box.append(el('h1', 'paper-card__title', profile.displayName));

  const rows = [
    birthdayRow(profile.birthday),
    row('興趣', profile.interests),
    row('喜歡的一句聖經經節', profile.favoriteVerse),
  ].filter((n): n is HTMLElement => n !== null);

  if (rows.length === 0) {
    box.append(
      message('info', isMe ? '你還沒有填任何資料。' : '這位成員還沒有填任何資料。'),
    );
  } else {
    for (const r of rows) box.append(r);
  }

  const anchors = [link('/members', '看所有成員')];
  // 自己的檔案給一個直接去編輯的入口，省得繞回選單。
  if (isMe) anchors.push(link('/member/me/edit', '編輯我的資料'));
  anchors.push(link('/wall', '回照片牆'));
  box.append(links(...anchors));

  wrap.append(box);
  return wrap;
}

// ------------------------------------------------------------- 進入點 ---

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    const viewer = await getViewer();
    if (viewer.kind !== 'member' && viewer.kind !== 'admin') {
      app.className = 'paper-page';
      const box = card('只有成員看得到這一頁');
      box.append(message('info', '成員名單只對房間內的人開放。'));
      box.append(links(link('/join', '前往加入'), link('/wall', '回照片牆')));
      app.replaceChildren(box);
      return;
    }

    const id = memberIdFromPath();
    if (id === null) {
      app.className = 'members-shell';
      app.replaceChildren(listView(await listRoomMembers()));
      return;
    }

    app.className = 'members-shell paper-page';
    app.replaceChildren(profileView(await getProfileOf(id), id === viewer.memberId));
  } catch (error: unknown) {
    app.className = 'paper-page';
    const box = card('載入失敗');
    box.append(message('error', error instanceof Error ? error.message : '無法載入成員資料。'));
    box.append(links(link('/members', '看所有成員'), link('/wall', '回照片牆')));
    app.replaceChildren(box);
  }
}

void main();
