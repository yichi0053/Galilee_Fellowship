/**
 * 姓名首字的色塊頭像（架構書 §10.8 / ADR-0023）。
 *
 * 為什麼不是每個人的 Google 頭像：那來自 auth token 的 metadata，
 * **只有當前登入者自己的 session 拿得到**。要在列表上顯示別人的頭像，
 * 就得把網址存進 room_members，而 ADR-0022 刻意沒有那麼做
 * （要處理過期、換頭像、以及已退出的人的臉還留著）。
 * 所以列表一律用首字，只有導覽列右上角那個「我自己」用得到真的頭像。
 */

/**
 * 底色由姓名決定，不用隨機值——同一個人每次進來顏色都不同的話，
 * 那不是識別而是干擾。雜湊取色相，飽和度與亮度固定，
 * 確保深色底上的白字在任何色相下都讀得到。
 */
export function initialAvatar(displayName: string, className = 'avatar'): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = [...displayName][0] ?? '?';
  let hash = 0;
  for (const ch of displayName) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  node.style.setProperty('--hue', String(hash));
  node.setAttribute('aria-hidden', 'true');
  return node;
}
