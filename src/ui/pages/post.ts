/**
 * /post/:id —— 單則貼文（架構書 §10.1、§10.5、§9.1）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 這一頁存在的主要理由是**刪除**：發錯的人需要一個地方收回，
 * 而 §9.5 的期限只有 20 分鐘——倒數走完之後就刪不掉了（ADR-0021）。
 * 那個判斷在伺服器端（migration 012 的 raise exception），
 * 這裡的倒數只是把時間畫出來給人看，並在歸零時把按鈕收掉。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/post-detail.css';

import { hidePost, unhidePost } from '@modules/admin';
import { DELETE_WINDOW_MINUTES } from '@config/constants';
import { getViewer } from '@modules/membership';
import type { Viewer } from '@modules/membership';
import { deletePost, getPost } from '@modules/posts';
import type { Post, PostId } from '@modules/posts';

const stampFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'medium',
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

function card(title?: string): HTMLElement {
  const box = el('section', 'paper-card');
  box.append(el('span', 'paper-card__pin'));
  if (title) box.append(el('h1', 'paper-card__title', title));
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

/** /post/<uuid> 的最後一段。乾淨網址由 _redirects 與 vite 的中介層轉到本頁 */
function postIdFromPath(): PostId | null {
  const last = window.location.pathname.split('/').filter(Boolean).pop() ?? '';
  return /^[0-9a-fA-F-]{36}$/.test(last) ? (last as PostId) : null;
}

// ------------------------------------------------------- 作者專屬區塊 ---

function ownerActions(post: Post): HTMLElement {
  const box = el('section', 'owner');

  const countdown = el('span', 'owner__countdown');
  box.append(countdown);

  const remove = el('button', 'paper-button paper-button--danger', '刪除這則貼文');
  remove.type = 'button';
  box.append(remove);

  // 逾期時要把確認列也一併收掉，所以它必須在 paint 看得到的範圍。
  // 使用者剛好在讀秒歸零那一刻按下「刪除這則貼文」的話，
  // 留著一個按下去必定失敗的「確定刪除」比直接收掉更糟。
  let confirmRow: HTMLElement | null = null;

  // 倒數只是把時間畫出來。真正決定刪不刪得掉的是伺服器的 now()（migration 012），
  // 使用者改本機時鐘只會讓這行字說謊，按下去照樣被資料庫拒絕。
  const deadline = post.deletableUntil?.getTime() ?? 0;
  const paint = (): void => {
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      const s = Math.ceil(remaining / 1000);
      countdown.textContent = `還有 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} 可以刪除這則貼文。`;
      countdown.dataset['expired'] = 'false';
    } else {
      // ADR-0021：逾期就刪不掉了。按鈕直接移除而不是停用——
      // 停用的按鈕還在那裡，會讓人一直試著點它。
      countdown.textContent =
        `已超過 ${DELETE_WINDOW_MINUTES} 分鐘，無法自行刪除。需要移除請聯絡團契負責人。`;
      countdown.dataset['expired'] = 'true';
      remove.remove();
      confirmRow?.remove();
      window.clearInterval(timer);
    }
  };
  const timer = window.setInterval(paint, 1000);
  paint();
  window.addEventListener('pagehide', () => window.clearInterval(timer));

  remove.addEventListener('click', () => {
    // 兩段式確認而不是 window.confirm：刪除無法復原（ADR-0009 的 30 天後硬刪除），
    // 值得一個看得見、可以反悔的步驟。
    const row = el('div', 'owner__confirm');
    confirmRow = row;
    const yes = el('button', 'paper-button paper-button--danger', '確定刪除');
    yes.type = 'button';
    const no = el('button', 'paper-button paper-button--quiet', '算了');
    no.type = 'button';
    row.append(yes, no);
    remove.replaceWith(row);

    no.addEventListener('click', () => {
      row.replaceWith(remove);
      confirmRow = null;
    });

    yes.addEventListener('click', () => {
      yes.disabled = true;
      no.disabled = true;
      yes.textContent = '刪除中…';
      void (async () => {
        try {
          await deletePost(post.id);
          window.clearInterval(timer);
          window.location.replace('/wall');
        } catch (error: unknown) {
          row.replaceWith(remove);
          confirmRow = null;
          box.append(
            message('error', error instanceof Error ? error.message : '刪除失敗，請再試一次。'),
          );
        }
      })();
    });
  });

  return box;
}

// ------------------------------------------------------------- 畫面 ---

/**
 * 管理員的下架／復原（§9.5）。與作者的刪除是兩件事：
 * 下架設 hidden_by_admin，貼文與照片都還在，作者仍看得到佔位，配額也不變動。
 * 放在這一頁而不是後台的清單裡——要下架一則貼文，總得先看見它。
 */
function adminActions(post: Post): HTMLElement {
  const box = el('section', 'owner');
  const hidden = post.hiddenByAdmin;

  box.append(
    el(
      'span',
      'owner__countdown',
      hidden
        ? '這則目前已下架，只有作者看得到。'
        : '下架之後只有作者看得到，照片與資料都還在，配額也不受影響。',
    ),
  );

  const button = el(
    'button',
    hidden ? 'paper-button' : 'paper-button paper-button--danger',
    hidden ? '復原這則貼文' : '下架這則貼文',
  );
  button.type = 'button';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = hidden ? '復原中…' : '下架中…';
    void (hidden ? unhidePost(post.id) : hidePost(post.id)).then(
      () => window.location.reload(),
      (error: unknown) => {
        button.disabled = false;
        button.textContent = hidden ? '復原這則貼文' : '下架這則貼文';
        box.append(
          message('error', error instanceof Error ? error.message : '操作失敗，請再試一次。'),
        );
      },
    );
  });

  box.append(button);
  return box;
}

function postView(post: Post, viewer: Viewer): HTMLElement {
  const box = card();

  const isAuthor =
    post.authorId !== null &&
    (viewer.kind === 'member' || viewer.kind === 'admin') &&
    post.authorId === viewer.memberId;

  // §9.5：下架的貼文只有作者看得到，且必須知道自己看到的是佔位而非正常狀態。
  if (post.hiddenByAdmin) {
    box.append(
      message('error', '這則貼文已被管理員下架，只有你看得到。若不清楚原因請聯絡團契負責人。'),
    );
  }

  box.append(el('h1', 'post-title', post.title));

  const photo = el('div', 'post-photo');
  const img = el('img');
  img.src = post.imageUrl;
  img.alt = post.title;
  photo.append(img);
  box.append(photo);

  // ADR-0019：內文選填。沒有內文時整段不渲染——
  // 留一個空的 <p> 會在照片與作者資訊之間開一道莫名其妙的縫。
  if (post.body !== null) {
    box.append(el('p', 'post-body', post.body));
  }

  const meta = el('div', 'post-meta');
  meta.append(el('span', undefined, post.authorName));
  const when = el('time');
  when.dateTime = post.createdAt.toISOString();
  when.textContent = stampFormat.format(post.createdAt);
  meta.append(when);
  box.append(meta);

  if (isAuthor) box.append(ownerActions(post));
  // 管理員也可能是作者。兩組操作各自獨立，同時出現是正常的（§4.1：管理員繼承成員權限）。
  if (viewer.kind === 'admin') box.append(adminActions(post));
  box.append(backLink());
  return box;
}

function notFound(): HTMLElement {
  const box = card('找不到這則貼文');
  box.append(
    message('info', '它可能已經被作者刪除了，或者你沒有權限看到它。'),
  );
  box.append(backLink());
  return box;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  app.className = 'paper-page';

  const id = postIdFromPath();
  if (!id) {
    app.replaceChildren(notFound());
    return;
  }

  try {
    const viewer = await getViewer();
    const asMemberId =
      viewer.kind === 'member' || viewer.kind === 'admin' ? viewer.memberId : null;
    const post = await getPost(id, asMemberId);
    app.replaceChildren(post ? postView(post, viewer) : notFound());
  } catch (error: unknown) {
    const box = card('載入失敗');
    box.append(message('error', error instanceof Error ? error.message : '無法載入這則貼文。'));
    box.append(backLink());
    app.replaceChildren(box);
  }
}

void main();
