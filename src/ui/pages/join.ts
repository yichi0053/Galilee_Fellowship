/**
 * /join —— 加入房間（架構書 §10.1、§10.4 流程 B）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 本頁的形狀就是 Viewer 的形狀：六種身分各自對應一個畫面，沒有 null 檢查散落各處。
 * 最要緊的是**孤兒帳號**能接續——完成 Google 授權但還沒輸房間碼的人關掉頁面再回來，
 * 必須落在「填房間碼」這一步，而不是又被要求登入一次或看到空白畫面。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/join.css';

import { DISPLAY_NAME_MAX_LENGTH } from '@config/constants';
import { signInWithGoogle } from '@modules/auth';
import {
  InvalidJoinCodeError,
  JoinClosedError,
  RateLimitedError,
  getViewer,
  joinRoom,
} from '@modules/membership';
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

function message(kind: 'error' | 'info', text: string): HTMLElement {
  const node = el('p', `paper-message paper-message--${kind}`, text);
  // 錯誤是使用者按下送出之後才出現的，讀螢幕軟體必須主動朗讀。
  if (kind === 'error') node.setAttribute('role', 'alert');
  return node;
}

function wallLink(text = '先去看看牆'): HTMLElement {
  const wrap = el('p', 'paper-links');
  const link = el('a');
  link.href = '/wall';
  link.textContent = text;
  wrap.append(link);
  return wrap;
}

/**
 * §17：本段文字已由團契負責人（即本專案的管理員）於 2026-08-27 確認，維持原文。
 *
 * 四個要點來自架構書，不可刪減——成員名單帶有宗教信仰資訊，
 * 屬個資法第 6 條特種個人資料（§8.6），告知同意是法律要求而非禮貌。
 *
 * 簽核時討論過但決定不加的一句：第 2 點的「姓名會被遮蔽」保護的是姓名而非臉，
 * 認識當事人的訪客仍認得出照片裡是誰，也因而知道其宗教身分。
 * 要改動措辭時請把這件事一起考慮進去。
 */
function consentBlock(): HTMLElement {
  const box = el('section', 'join-consent');
  box.append(el('strong', undefined, '加入之前請先知道：'));
  const list = el('ul', 'join-consent__list');
  for (const line of [
    '你上傳的照片與你填的姓名，同房間的成員都看得到。',
    '持有連結的非成員也看得到照片，但姓名會被遮蔽（例如「陳小O」）。',
    '你隨時可以自己刪除自己的貼文。',
    '若日後退出房間，你已發布的貼文仍會保留顯示。',
  ]) {
    list.append(el('li', undefined, line));
  }
  box.append(list);
  return box;
}

// ------------------------------------------------------------ 各身分畫面 ---

function guestView(): HTMLElement {
  const box = card(
    '加入加利利團契照片牆',
    '先用 Google 帳號登入，下一步再輸入團契負責人給你的房間碼。',
  );
  box.append(consentBlock());

  const button = el('button', 'paper-button paper-button--google', '以 Google 帳號登入');
  button.type = 'button';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = '前往 Google…';
    // 授權完成後導回本頁：屆時身分是 orphan，會直接落在填房間碼那一步。
    void signInWithGoogle('/join').catch((error: unknown) => {
      button.disabled = false;
      button.textContent = '以 Google 帳號登入';
      box.append(message('error', error instanceof Error ? error.message : '登入失敗，請再試一次。'));
    });
  });

  box.append(button);
  box.append(wallLink());
  return box;
}

function joinFormView(defaultName: string | null, returning: boolean): HTMLElement {
  const box = returning
    ? card('歡迎回來', '你先前退出了這個房間。重新輸入房間碼即可回來，你以前的貼文都還在。')
    : card('再一步就好', '填一個大家認得出你的名字，再輸入團契負責人給你的房間碼。');

  const form = el('form');
  form.noValidate = true;

  // ---- 顯示姓名 ----
  const nameField = el('div', 'paper-field');
  const nameLabel = el('label', 'paper-field__label', '你的名字');
  nameLabel.htmlFor = 'join-display-name';
  const nameHint = el(
    'span',
    'paper-field__hint',
    `同房間的成員看到的是全名，非成員看到的是遮蔽形式。最多 ${DISPLAY_NAME_MAX_LENGTH} 字。`,
  );
  nameLabel.append(nameHint);
  const nameInput = el('input', 'paper-input');
  nameInput.id = 'join-display-name';
  nameInput.type = 'text';
  nameInput.autocomplete = 'name';
  nameInput.maxLength = DISPLAY_NAME_MAX_LENGTH;
  nameInput.value = defaultName ?? '';
  nameField.append(nameLabel, nameInput);

  // ---- 房間碼 ----
  const codeField = el('div', 'paper-field');
  const codeLabel = el('label', 'paper-field__label', '房間碼');
  codeLabel.htmlFor = 'join-code';
  codeLabel.append(el('span', 'paper-field__hint', '向團契負責人索取。'));
  const codeInput = el('input', 'paper-input');
  codeInput.id = 'join-code';
  codeInput.type = 'text';
  // 房間碼是明文短字串（ADR-0008），不是密碼，不要讓瀏覽器存成密碼或自動大寫。
  codeInput.autocomplete = 'off';
  codeInput.autocapitalize = 'off';
  codeInput.spellcheck = false;
  codeField.append(codeLabel, codeInput);

  // ---- 告知同意 ----
  const agree = el('label', 'join-agree');
  const agreeBox = el('input');
  agreeBox.type = 'checkbox';
  agree.append(agreeBox, document.createTextNode('我已閱讀並瞭解上面四點，同意加入。'));

  const submit = el('button', 'paper-button', '加入房間');
  submit.type = 'submit';

  form.append(nameField, codeField, consentBlock(), agree, submit);
  box.append(form);

  let errorNode: HTMLElement | null = null;
  const showError = (text: string): void => {
    errorNode?.remove();
    errorNode = message('error', text);
    form.insertBefore(errorNode, submit);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorNode?.remove();
    errorNode = null;

    const displayName = nameInput.value.trim();
    const joinCode = codeInput.value.trim();

    // 這三項在伺服器端都會再驗一次（join-room Edge Function）。
    // 這裡擋下來只是為了少一趟往返，不是安全邊界。
    if (!displayName) return showError('請填寫你的名字。');
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return showError(`名字不可超過 ${DISPLAY_NAME_MAX_LENGTH} 字。`);
    }
    if (!joinCode) return showError('請輸入房間碼。');
    if (!agreeBox.checked) return showError('請先勾選同意，再加入房間。');

    submit.disabled = true;
    submit.textContent = '加入中…';

    void (async () => {
      try {
        const viewer = await joinRoom(joinCode, displayName);
        if (viewer.kind === 'suspended') {
          render(viewer);
          return;
        }
        // 成功就直接進牆頁。用 replace 是為了讓返回鍵回到牆頁之前的地方，
        // 而不是又回到這張已經填完的表單。
        window.location.replace('/wall');
      } catch (error: unknown) {
        submit.disabled = false;
        submit.textContent = '加入房間';

        if (error instanceof RateLimitedError) {
          const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
          showError(`嘗試次數過多，請於 ${minutes} 分鐘後再試。`);
        } else if (error instanceof InvalidJoinCodeError) {
          showError('房間碼不正確，請再確認一次。');
        } else if (error instanceof JoinClosedError) {
          showError('這個房間已經關閉加入，請聯絡團契負責人。');
        } else {
          showError(error instanceof Error ? error.message : '加入失敗，請稍後再試。');
        }
      }
    })();
  });

  return box;
}

function suspendedView(): HTMLElement {
  const box = card('這個帳號已被停權');
  box.append(
    message('info', '你目前無法加入或發文，你的貼文也不會顯示。若認為有誤，請聯絡團契負責人。'),
  );
  box.append(wallLink());
  return box;
}

// ------------------------------------------------------------------ 進入點 ---

function viewFor(viewer: Viewer): HTMLElement {
  switch (viewer.kind) {
    case 'guest':
      return guestView();
    case 'orphan':
      return joinFormView(viewer.suggestedName, false);
    case 'left':
      // 退出者重新加入時沿用原本那一列，貼文與作者的關聯因此保留（§4.3）。
      return joinFormView(null, true);
    case 'suspended':
      return suspendedView();
    case 'member':
    case 'admin': {
      window.location.replace('/wall');
      return card('已經是成員了', '正在帶你去照片牆…');
    }
  }
}

function render(viewer: Viewer): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.className = 'paper-page';
  app.replaceChildren(viewFor(viewer));
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    render(await getViewer());
  } catch (error: unknown) {
    // getViewer 失敗多半是環境變數沒填或資料層沒接上，
    // 直接把訊息顯示出來，不要留一個永遠的「載入中…」。
    app.className = 'paper-page';
    const box = card('載入失敗');
    box.append(message('error', error instanceof Error ? error.message : '無法取得你的身分。'));
    box.append(wallLink());
    app.replaceChildren(box);
  }
}

void main();
