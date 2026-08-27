/**
 * /post/new —— 發布貼文（架構書 §10.1、§9.1、§9.3）。
 *
 * UI 層禁止 import db/（§12.4 規則 2）。資料一律經由各 module 的 index.ts。
 *
 * 本頁只負責問三件事：哪一種、哪張圖、寫什麼。
 * 壓縮、剝除 EXIF、產生縮圖、上傳、決定旋轉角、計算週次一概不在這裡——
 * 那些是 posts.createPost 內部的編排，UI 連 counts_toward_quota 存在都不知道（§12.5）。
 */

import '@ui/styles/wall.css';
import '@ui/styles/paper.css';
import '@ui/styles/new-post.css';

import { BODY_MAX_LENGTH, IMAGE, QUOTA, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH } from '@config/constants';
import { getViewer } from '@modules/membership';
import type { Viewer } from '@modules/membership';
import { previewUrl } from '@modules/media';
import { createPost, getMyQuota } from '@modules/posts';
import type { PostKind, QuotaState } from '@modules/posts';
import { getCurrentTheme } from '@modules/themes';
import type { Theme } from '@modules/themes';

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

function backLink(text = '回照片牆'): HTMLElement {
  const wrap = el('p', 'paper-links');
  const link = el('a');
  link.href = '/wall';
  link.textContent = text;
  wrap.append(link);
  return wrap;
}

function quotaChips(remaining: QuotaState['remaining']): HTMLElement {
  const box = el('div', 'quota');
  for (const [kind, label, total] of [
    ['theme', '主題貼文', QUOTA.theme],
    ['free', '自由貼文', QUOTA.free],
  ] as const) {
    const chip = el('div', 'quota__chip');
    chip.dataset['empty'] = String(remaining[kind] === 0);
    chip.append(el('span', 'quota__count', `${remaining[kind]}`));
    chip.append(document.createTextNode(`${label} 剩餘（共 ${total}）`));
    box.append(chip);
  }
  return box;
}

type KindOption = {
  readonly kind: PostKind;
  readonly name: string;
  readonly note: string;
  readonly disabled: boolean;
};

function kindOptions(
  remaining: QuotaState['remaining'],
  theme: Theme | null,
): readonly KindOption[] {
  return [
    {
      kind: 'theme',
      name: '主題貼文',
      // §9.6：沒有主題就不能發主題貼文，且過期主題不可補發，所以這裡只看本週。
      note: theme ? theme.title : '本週還沒有主題',
      disabled: theme === null || remaining.theme === 0,
    },
    {
      kind: 'free',
      name: '自由貼文',
      note: '想貼什麼都可以',
      disabled: remaining.free === 0,
    },
  ];
}

// --------------------------------------------------------------- 表單 ---

function postForm(
  memberId: string,
  remaining: QuotaState['remaining'],
  theme: Theme | null,
): HTMLElement {
  const box = card('發一則貼文');
  box.append(quotaChips(remaining));

  const options = kindOptions(remaining, theme);
  const firstEnabled = options.find((o) => !o.disabled);

  if (!firstEnabled) {
    box.append(
      message('info', '本週的配額都用完了。下週一之後就會重置，先去看看大家貼了什麼吧。'),
    );
    box.append(backLink());
    return box;
  }

  const form = el('form');
  form.noValidate = true;

  // ---- 種類 ----
  const kindField = el('fieldset', 'paper-field');
  kindField.style.border = 'none';
  kindField.style.padding = '0';
  kindField.style.margin = '0 0 1rem';
  kindField.append(el('legend', 'paper-field__label', '這則貼文算哪一種'));

  const kindRow = el('div', 'kind');
  for (const option of options) {
    const label = el('label', 'kind__option');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'kind';
    radio.value = option.kind;
    radio.disabled = option.disabled;
    radio.checked = option.kind === firstEnabled.kind;
    label.append(radio);
    label.append(el('span', 'kind__name', option.name));
    label.append(
      el('span', 'kind__note', option.disabled && !theme && option.kind === 'theme'
        ? option.note
        : option.disabled
          ? `${option.note}（本週已用完）`
          : option.note),
    );
    kindRow.append(label);
  }
  kindField.append(kindRow);

  // ---- 圖片 ----
  const imageField = el('div', 'paper-field');
  const picker = el('label', 'picker');
  const fileInput = el('input');
  fileInput.type = 'file';
  // capture 不設：讓使用者自己選相簿或相機，強制開相機在補貼舊照片時很惱人。
  fileInput.accept = 'image/jpeg,image/png,image/webp';
  const pickerText = el('span', undefined, '點這裡選一張照片');
  picker.append(fileInput, pickerText);

  const imageLabel = el('span', 'paper-field__label', '照片');
  imageLabel.append(
    el(
      'span',
      'paper-field__hint',
      `上限 ${IMAGE.maxOriginalBytes / 1024 / 1024} MB。上傳前會在你的手機上壓縮，` +
        '並移除拍攝地點等中繼資料。',
    ),
  );
  imageField.append(imageLabel, picker);

  const preview = el('div', 'preview');
  preview.hidden = true;
  const previewImg = el('img');
  previewImg.alt = '預覽';
  preview.append(previewImg);
  imageField.append(preview);

  let objectUrl: string | null = null;
  const releasePreview = (): void => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  fileInput.addEventListener('change', () => {
    releasePreview();
    const file = fileInput.files?.[0];
    if (!file) {
      preview.hidden = true;
      pickerText.textContent = '點這裡選一張照片';
      return;
    }
    objectUrl = previewUrl(file);
    previewImg.src = objectUrl;
    preview.hidden = false;
    pickerText.textContent = '換一張';
  });
  window.addEventListener('pagehide', releasePreview);

  // ---- 標題（ADR-0019：牆頁卡片上唯一的文字）----
  const titleField = el('div', 'paper-field');
  const titleLabel = el('label', 'paper-field__label', '標題');
  titleLabel.htmlFor = 'post-title';
  titleField.append(titleLabel);

  // 用 input 而不是 textarea：這一格就是要一行。textarea 會讓人以為可以換行，
  // 而換行字元在牆上的卡片裡不會有任何視覺效果，只會讓人困惑。
  const titleInput = el('input', 'paper-input');
  titleInput.id = 'post-title';
  titleInput.type = 'text';
  titleInput.maxLength = TITLE_MAX_LENGTH;
  titleInput.placeholder = '一句話說這是什麼';
  titleField.append(titleInput);

  const titleCounter = el('span', 'counter');
  const syncTitle = (): void => {
    const n = titleInput.value.trim().length;
    titleCounter.textContent = `${n} / ${TITLE_MAX_LENGTH}`;
    titleCounter.dataset['invalid'] = String(n > 0 && n < TITLE_MIN_LENGTH);
  };
  syncTitle();
  titleInput.addEventListener('input', syncTitle);
  titleField.append(titleCounter);

  // ---- 內文（選填，只在 /post/:id 顯示）----
  const bodyField = el('div', 'paper-field');
  const bodyLabel = el('label', 'paper-field__label', '想多說一點（選填）');
  bodyLabel.htmlFor = 'post-body';
  bodyField.append(bodyLabel);

  bodyField.append(
    el(
      'span',
      'paper-field__hint',
      '這一段不會出現在牆上，點進貼文才看得到。留白也可以。',
    ),
  );

  const bodyInput = el('textarea', 'body-input');
  bodyInput.id = 'post-body';
  bodyInput.maxLength = BODY_MAX_LENGTH;
  bodyInput.placeholder = '這張照片是什麼時候、跟誰、為什麼拍的？';
  bodyField.append(bodyInput);

  const counter = el('span', 'counter');
  const syncCounter = (): void => {
    const n = bodyInput.value.trim().length;
    counter.textContent = `${n} / ${BODY_MAX_LENGTH}`;
  };
  syncCounter();
  bodyInput.addEventListener('input', syncCounter);
  bodyField.append(counter);

  const submit = el('button', 'paper-button', '貼上牆');
  submit.type = 'submit';

  form.append(kindField, imageField, titleField, bodyField, submit);
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

    const kind = (form.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ??
      firstEnabled.kind) as PostKind;
    const file = fileInput.files?.[0];
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();

    // 這些在 createPost 與資料庫都會再驗一次。這裡擋下來只是為了少一趟往返，
    // 尤其是圖片——讓人壓縮上傳完才被退件太浪費了。
    if (!file) return showError('請先選一張照片。');
    if (title.length === 0) return showError('請寫一個標題。');
    if (title.length < TITLE_MIN_LENGTH) {
      return showError(`標題至少 ${TITLE_MIN_LENGTH} 個字。`);
    }
    // 內文選填，不擋長度下限。上限由 maxLength 擋在輸入階段。

    submit.disabled = true;
    // 手機上壓縮加兩次上傳可能要好幾秒，沒有回饋的話使用者會重複按。
    submit.textContent = '處理中…';

    void (async () => {
      try {
        await createPost({ kind, title, body, file }, memberId);
        releasePreview();
        window.location.replace('/wall');
      } catch (error: unknown) {
        submit.disabled = false;
        submit.textContent = '貼上牆';
        // 各 module 的錯誤訊息本身就是給人看的（配額、字數、HEIC 的處理指示），
        // 這裡不再翻譯一次，直接呈現。
        showError(error instanceof Error ? error.message : '發布失敗，請再試一次。');
      }
    })();
  });

  return box;
}

// ------------------------------------------------------------- 進入點 ---

function notMemberView(viewer: Viewer): HTMLElement {
  if (viewer.kind === 'suspended') {
    const box = card('這個帳號已被停權');
    box.append(message('info', '你目前無法發文。若認為有誤，請聯絡團契負責人。'));
    box.append(backLink());
    return box;
  }
  const box = card('只有成員可以發文');
  box.append(message('info', '先加入房間，就能把照片貼上牆。'));
  const wrap = el('p', 'paper-links');
  const link = el('a');
  link.href = '/join';
  link.textContent = '前往加入';
  wrap.append(link);
  box.append(wrap, backLink());
  return box;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  app.className = 'paper-page';

  try {
    const viewer = await getViewer();
    if (viewer.kind !== 'member' && viewer.kind !== 'admin') {
      app.replaceChildren(notMemberView(viewer));
      return;
    }

    // 配額與主題互不相關，一起抓，少一趟往返。
    const [quota, theme] = await Promise.all([getMyQuota(viewer.memberId), getCurrentTheme()]);
    app.replaceChildren(postForm(viewer.memberId, quota.remaining, theme));
  } catch (error: unknown) {
    const box = card('載入失敗');
    box.append(message('error', error instanceof Error ? error.message : '無法取得你的配額。'));
    box.append(backLink());
    app.replaceChildren(box);
  }
}

void main();
