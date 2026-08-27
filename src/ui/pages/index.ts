/**
 * / —— 進站的第一頁（架構書 §10.1）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 這一頁不畫牆、不畫表單，它只做一件事：依身分把人送到該去的地方。
 * 之所以非有不可，是因為它是三種路徑的落地點：
 *
 * 1. 成員直接打網域（多數人會這樣做，沒人記得要加 /wall）。
 * 2. Supabase Auth 在 redirect_to 對不上白名單時**不報錯**，
 *    安靜地把人導向 Dashboard 設的 Site URL——也就是這裡（docs/SETUP.md 第 2 節第 8 步）。
 *    那條路上使用者的網址列帶著 `#access_token=`，身分是有效的，只是走錯了門。
 * 3. 舊書籤，以及 LINE 群組裡被截斷的連結。
 *
 * 三者都不該看到一個永遠停著的「載入中…」。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';

import { getViewer } from '@modules/membership';
import type { Viewer } from '@modules/membership';

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

/**
 * 去處。訪客也送去牆——訪客唯讀是本站刻意的設計（§10.3、ADR-0006），
 * 不必先攔下來要求登入。反過來，加入流程還沒走完的三種身分一律送去 /join，
 * 那一頁已經為 orphan、left、suspended 各備了一個畫面。
 */
function destinationFor(viewer: Viewer): '/wall' | '/join' {
  switch (viewer.kind) {
    case 'guest':
    case 'member':
    case 'admin':
      return '/wall';
    case 'orphan':
    case 'left':
    case 'suspended':
      return '/join';
  }
}

/**
 * 一律用 replace 而非 assign：這一頁沒有內容，留在瀏覽紀錄裡只會讓
 * 上一頁按鈕把人彈回來、然後再被導走一次。
 *
 * 傳進去的是不帶 hash 的乾淨路徑，這點是刻意的。走上面第 2 種路徑進來的人，
 * 網址列上掛著 `#access_token=` 與**不會自己過期的 refresh_token**
 * （docs/SETUP.md 的警告框）。supabase client 已在 getViewer() 之前把它讀進 storage，
 * 此處不轉送它，免得那串憑證被帶到 /wall 的網址列上、進而被截圖或轉貼出去。
 */
function go(to: string): void {
  window.location.replace(to);
}

function failure(reason: string): HTMLElement {
  // 這裡失敗多半是環境變數沒填或資料層沒接上。把訊息顯示出來，
  // 並且仍然給出兩個入口——牆頁對訪客不需要身分，很可能還是打得開的。
  const box = card('載入失敗');
  const msg = el('p', 'paper-message paper-message--error', reason);
  msg.setAttribute('role', 'alert');
  box.append(msg, links(link('/wall', '直接去照片牆'), link('/join', '前往加入')));
  return box;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  app.className = 'paper-page';

  let viewer: Viewer;
  try {
    viewer = await getViewer();
  } catch (error: unknown) {
    app.replaceChildren(failure(error instanceof Error ? error.message : '無法取得你的身分。'));
    return;
  }

  const to = destinationFor(viewer);

  // 導向之前先換掉「載入中…」。網路慢時這句是使用者唯一看得到的回饋，
  // 也是導向萬一沒生效時的備援——底下那條連結讓他自己點得過去。
  const box =
    to === '/wall'
      ? card('加利利團契照片牆', '正在帶你去牆上…')
      : card('還差一步', '正在帶你去加入頁…');
  box.append(links(link(to, '沒有自動跳轉的話請點這裡')));
  app.replaceChildren(box);

  go(to);
}

void main();
