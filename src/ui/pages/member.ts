/**
 * /member/:id —— 某位成員的貼文（架構書 §10.1、§10.7）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 第一期只做 `/member/me`：牆頁導覽列的「我的貼文」指向這裡，
 * 作者需要一個地方看見自己所有的貼文、以及被下架的那些（§9.5）。
 * 看別人的貼文是 memberFilter，第二期才開（ADR-0013）。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/member.css';

import { QUOTA } from '@config/constants';
import { isEnabled } from '@config/features';
import { getViewer } from '@modules/membership';
import type { Viewer } from '@modules/membership';
import { getMyQuota, listMine } from '@modules/posts';
import type { Post, QuotaState } from '@modules/posts';
import { disposeCards, observeEntrance, polaroidCard } from '@ui/components/polaroid';

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

function card(title: string): HTMLElement {
  const box = el('section', 'paper-card');
  box.append(el('span', 'paper-card__pin'));
  box.append(el('h1', 'paper-card__title', title));
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

/** /member/<segment>。第一期只認得 'me' */
function segmentFromPath(): string {
  return window.location.pathname.split('/').filter(Boolean).pop() ?? '';
}

function head(viewer: Viewer, posts: readonly Post[], quota: QuotaState): HTMLElement {
  const box = el('header', 'member-head');
  const name = viewer.kind === 'member' || viewer.kind === 'admin' ? viewer.displayName : '';
  box.append(el('h1', 'member-head__name', name));
  box.append(el('span', 'member-head__count', `共 ${posts.length} 則`));
  box.append(
    el(
      'span',
      'member-head__quota',
      `本週剩餘：主題 ${quota.remaining.theme}/${QUOTA.theme}、自由 ${quota.remaining.free}/${QUOTA.free}`,
    ),
  );
  const back = el('a', 'member-head__back', '回照片牆');
  back.href = '/wall';
  box.append(back);
  return box;
}

function grid(posts: readonly Post[]): HTMLElement {
  const wrap = el('div', 'member-grid');
  const masonry = el('div', 'masonry');
  for (const post of posts) {
    // 卡片本身就是連往 /post/:id 的連結（polaroid.ts）。
    const cardEl = polaroidCard(post, { refundCountdown: true });
    // §9.5：下架的貼文只有作者看得到，必須一眼看出它不是正常狀態。
    if (post.hiddenByAdmin) {
      cardEl.dataset['hidden'] = 'true';
      cardEl.title = '這則已被管理員下架，只有你看得到。';
    }
    masonry.append(cardEl);
  }
  wrap.append(masonry);
  return wrap;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const segment = segmentFromPath();
  if (segment !== 'me') {
    // ADR-0013：未啟用的功能，UI 不渲染入口，也不假裝它壞了。
    app.className = 'paper-page';
    const box = card(isEnabled('memberFilter') ? '找不到這位成員' : '這個功能還沒開放');
    box.append(
      message(
        'info',
        isEnabled('memberFilter')
          ? '這個連結指向的成員不存在，或你沒有權限看到。'
          : '看別人的貼文列表是之後才會開放的功能。你可以先回牆上看大家的貼文。',
      ),
    );
    box.append(backLink());
    app.replaceChildren(box);
    return;
  }

  try {
    const viewer = await getViewer();
    if (viewer.kind !== 'member' && viewer.kind !== 'admin') {
      app.className = 'paper-page';
      const box = card('只有成員看得到這一頁');
      box.append(message('info', '先加入房間，才會有自己的貼文。'));
      const wrap = el('p', 'paper-links');
      const join = el('a');
      join.href = '/join';
      join.textContent = '前往加入';
      wrap.append(join);
      box.append(wrap, backLink());
      app.replaceChildren(box);
      return;
    }

    const [posts, quota] = await Promise.all([
      listMine(viewer.memberId),
      getMyQuota(viewer.memberId),
    ]);

    app.className = 'member-page';
    if (posts.length === 0) {
      const empty = el('p', 'member-empty', '你還沒有貼過東西。牆上有大家的，右下角可以發第一則。');
      app.replaceChildren(head(viewer, posts, quota), empty);
      return;
    }

    const body = grid(posts);
    app.replaceChildren(head(viewer, posts, quota), body);

    const detach = observeEntrance(body);
    window.addEventListener('pagehide', () => {
      disposeCards(body);
      detach();
    });
  } catch (error: unknown) {
    app.className = 'paper-page';
    const box = card('載入失敗');
    box.append(message('error', error instanceof Error ? error.message : '無法載入你的貼文。'));
    box.append(backLink());
    app.replaceChildren(box);
  }
}

void main();
