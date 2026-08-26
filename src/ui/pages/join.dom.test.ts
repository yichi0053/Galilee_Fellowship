/**
 * /join 的結構煙霧測試。
 *
 * §15.2 說 UI 不值得投資測試，這裡刻意只驗兩件會真的出事的事：
 * 六種 Viewer 各自落在對的畫面，以及送出前的檢查沒有漏掉。
 * 樣式與轉場仍以真機手動測試為準。
 *
 * membership 與 auth 一律 mock：它們會 import db/client，
 * 而該檔在缺少環境變數時於載入當下就拋錯，測試環境沒有也不該有那些值。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  joinRoom: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock('@modules/membership', () => {
  // 錯誤類別必須是真的類別：join.ts 以 instanceof 分辨要顯示哪一句話。
  class JoinClosedError extends Error {}
  class InvalidJoinCodeError extends Error {}
  class RateLimitedError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('嘗試次數過多');
    }
  }
  return {
    getViewer: mocks.getViewer,
    joinRoom: mocks.joinRoom,
    JoinClosedError,
    InvalidJoinCodeError,
    RateLimitedError,
  };
});

vi.mock('@modules/auth', () => ({ signInWithGoogle: mocks.signInWithGoogle }));

async function renderJoin(viewer: Viewer): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  mocks.getViewer.mockResolvedValue(viewer);
  vi.resetModules();
  await import('./join');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

/** 填完表單並送出。回傳讓呼叫端 await 非同步處理跑完 */
async function submit(
  app: HTMLElement,
  values: { name?: string; code?: string; agree?: boolean },
): Promise<void> {
  const name = app.querySelector<HTMLInputElement>('#join-display-name');
  const code = app.querySelector<HTMLInputElement>('#join-code');
  const agree = app.querySelector<HTMLInputElement>('.join-agree input');
  if (!name || !code || !agree) throw new Error('表單欄位不存在');

  if (values.name !== undefined) name.value = values.name;
  if (values.code !== undefined) code.value = values.code;
  agree.checked = values.agree ?? true;

  app
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

const errorText = (app: HTMLElement): string =>
  app.querySelector('.paper-message--error')?.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  // 成功加入後會 location.replace('/wall')，happy-dom 的實作會真的嘗試導航
  Object.defineProperty(window, 'location', {
    value: { replace: vi.fn(), href: 'http://localhost:5173/join' },
    writable: true,
    configurable: true,
  });
});

describe('/join 的身分分派（§10.4）', () => {
  it('訪客看到 Google 登入，不會看到表單', async () => {
    const app = await renderJoin({ kind: 'guest' });
    expect(app.querySelector('.paper-button--google')).not.toBeNull();
    expect(app.querySelector('form')).toBeNull();
  });

  it('孤兒帳號直接落在填房間碼那一步，並以 Google 名稱預填', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: '陳小明' });
    expect(app.querySelector('.paper-button--google')).toBeNull();
    expect(app.querySelector<HTMLInputElement>('#join-display-name')?.value).toBe('陳小明');
  });

  it('Google 沒給名稱時欄位留空，不是 undefined 或 null 字樣', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    expect(app.querySelector<HTMLInputElement>('#join-display-name')?.value).toBe('');
  });

  it('退出者看得到重新加入的表單（§4.3：貼文保留）', async () => {
    const app = await renderJoin({ kind: 'left' });
    expect(app.querySelector('form')).not.toBeNull();
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('歡迎回來');
  });

  it('停權者看不到表單，只看到說明', async () => {
    const app = await renderJoin({ kind: 'suspended' });
    expect(app.querySelector('form')).toBeNull();
    expect(app.querySelector('.paper-message')).not.toBeNull();
  });

  it('已是成員時導向牆頁', async () => {
    await renderJoin({ kind: 'member', memberId: 'm1', displayName: '陳小明' });
    expect(window.location.replace).toHaveBeenCalledWith('/wall');
  });
});

describe('/join 的告知同意與送出檢查（§8.6、§17）', () => {
  it('四點告知同意都呈現出來', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    expect(app.querySelectorAll('.join-consent__list li').length).toBe(4);
  });

  it('未勾同意就送出會被擋下，且不呼叫 joinRoom', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    await submit(app, { name: '陳小明', code: 'DEV-ONLY-JOIN-CODE-0000', agree: false });
    expect(mocks.joinRoom).not.toHaveBeenCalled();
    expect(errorText(app)).toContain('同意');
  });

  it('名字空白會被擋下，且不呼叫 joinRoom', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    await submit(app, { name: '   ', code: 'DEV-ONLY-JOIN-CODE-0000' });
    expect(mocks.joinRoom).not.toHaveBeenCalled();
    expect(errorText(app)).toContain('名字');
  });

  it('房間碼空白會被擋下，且不呼叫 joinRoom', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    await submit(app, { name: '陳小明', code: '  ' });
    expect(mocks.joinRoom).not.toHaveBeenCalled();
    expect(errorText(app)).toContain('房間碼');
  });

  it('通過檢查後以去空白的值呼叫 joinRoom，成功則導向牆頁', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    mocks.joinRoom.mockResolvedValue({ kind: 'member', memberId: 'm1', displayName: '陳小明' });
    await submit(app, { name: ' 陳小明 ', code: ' CODE-1234-5678 ' });
    expect(mocks.joinRoom).toHaveBeenCalledWith('CODE-1234-5678', '陳小明');
    expect(window.location.replace).toHaveBeenCalledWith('/wall');
  });
});

describe('/join 的錯誤訊息', () => {
  it('房間碼錯誤時給出可照做的訊息，且表單仍可再送', async () => {
    const { InvalidJoinCodeError } = await import('@modules/membership');
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    mocks.joinRoom.mockRejectedValue(new InvalidJoinCodeError('房間碼不正確。'));
    await submit(app, { name: '陳小明', code: 'WRONG' });
    expect(errorText(app)).toContain('房間碼不正確');
    expect(app.querySelector<HTMLButtonElement>('.paper-button')?.disabled).toBe(false);
  });

  it('rate limit 換算成分鐘，不把秒數直接丟給使用者', async () => {
    const { RateLimitedError } = await import('@modules/membership');
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    mocks.joinRoom.mockRejectedValue(new RateLimitedError(3600));
    await submit(app, { name: '陳小明', code: 'WRONG' });
    expect(errorText(app)).toContain('60 分鐘');
  });

  it('房間已關閉加入時指向負責人', async () => {
    const { JoinClosedError } = await import('@modules/membership');
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    mocks.joinRoom.mockRejectedValue(new JoinClosedError('關閉'));
    await submit(app, { name: '陳小明', code: 'CODE-1234-5678' });
    expect(errorText(app)).toContain('負責人');
  });

  it('joinRoom 回傳 suspended 時切換到停權畫面（那是身分，不是例外）', async () => {
    const app = await renderJoin({ kind: 'orphan', suggestedName: null });
    mocks.joinRoom.mockResolvedValue({ kind: 'suspended' });
    await submit(app, { name: '陳小明', code: 'CODE-1234-5678' });
    expect(app.querySelector('form')).toBeNull();
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('這個帳號已被停權');
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
