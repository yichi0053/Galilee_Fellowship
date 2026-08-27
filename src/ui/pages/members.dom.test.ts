/**
 * /members 與 /members/:id 的結構測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁的關鍵規則有三個——
 * 訪客一律看不到（§8.6：成員名單帶有宗教信仰資訊）、
 * 生日只顯示月日不顯示年份、以及沒填的欄位整列不畫。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@modules/membership';
import type { MemberCard, Profile } from '@modules/profile';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  listRoomMembers: vi.fn(),
  getProfileOf: vi.fn(),
}));

vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));
vi.mock('@modules/profile', () => ({
  listRoomMembers: mocks.listRoomMembers,
  getProfileOf: mocks.getProfileOf,
}));

const MEMBER: Viewer = { kind: 'member', memberId: 'm-1', displayName: '陳小明', avatarUrl: null };

const CARDS: MemberCard[] = [
  { memberId: 'm-1', displayName: '陳小明' },
  { memberId: 'm-2', displayName: '林大方' },
  { memberId: 'm-3', displayName: '王小美' },
];

const PROFILE: Profile = {
  memberId: 'm-2',
  displayName: '林大方',
  birthday: '1999-04-18',
  interests: '爬山、煮咖啡',
  favoriteVerse: '你們要休息，要知道我是神。—— 詩篇 46:10',
};

async function render(
  options: { path?: string; viewer?: Viewer; profile?: Profile | Error } = {},
): Promise<HTMLElement> {
  document.body.innerHTML = '<main id="app"></main>';
  const path = options.path ?? '/members';
  Object.defineProperty(window, 'location', {
    value: { replace: vi.fn(), pathname: path },
    writable: true,
    configurable: true,
  });
  mocks.getViewer.mockResolvedValue(options.viewer ?? MEMBER);
  mocks.listRoomMembers.mockResolvedValue(CARDS);
  const p = options.profile ?? PROFILE;
  if (p instanceof Error) mocks.getProfileOf.mockRejectedValue(p);
  else mocks.getProfileOf.mockResolvedValue(p);

  vi.resetModules();
  await import('./members');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/members 成員列表', () => {
  it('每個人一格，點下去進他的個人資料', async () => {
    const app = await render();
    const tiles = app.querySelectorAll<HTMLAnchorElement>('a.member-tile');
    expect(tiles.length).toBe(3);
    expect(tiles[1]?.getAttribute('href')).toBe('/members/m-2');
  });

  it('格子上有姓名首字的頭像與暱稱', async () => {
    const app = await render();
    const first = app.querySelector('.member-tile');
    expect(first?.querySelector('.member-tile__avatar')?.textContent).toBe('陳');
    expect(first?.querySelector('.member-tile__name')?.textContent).toBe('陳小明');
  });

  it('同一個人的頭像顏色固定，不是每次重擲', async () => {
    const a = await render();
    const hue1 = a.querySelector<HTMLElement>('.member-tile__avatar')?.style.getPropertyValue('--hue');
    const b = await render();
    const hue2 = b.querySelector<HTMLElement>('.member-tile__avatar')?.style.getPropertyValue('--hue');
    expect(hue1).toBe(hue2);
    expect(hue1).not.toBe('');
  });

  it('標頭顯示人數，不用自己數', async () => {
    const app = await render();
    expect(app.querySelector('.members-head__count')?.textContent).toBe('共 3 人');
  });
});

describe('/members/:id 某人的個人資料', () => {
  it('顯示暱稱、興趣與經節', async () => {
    const app = await render({ path: '/members/m-2' });
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('林大方');
    expect(app.textContent).toContain('爬山、煮咖啡');
    expect(app.textContent).toContain('詩篇 46:10');
    expect(mocks.getProfileOf).toHaveBeenCalledWith('m-2');
  });

  it('生日只顯示月日，不顯示年份——年份比月日敏感得多', async () => {
    const app = await render({ path: '/members/m-2' });
    const text = app.textContent ?? '';
    expect(text).toContain('4月18日');
    expect(text).not.toContain('1999');
  });

  it('沒填的欄位整列不畫，不留一排「未填寫」', async () => {
    const app = await render({
      path: '/members/m-2',
      profile: { ...PROFILE, birthday: null, interests: null },
    });
    expect(app.textContent).not.toContain('生日');
    expect(app.textContent).not.toContain('興趣');
    expect(app.textContent).toContain('詩篇 46:10');
  });

  it('什麼都沒填時給一句說明，而不是一張空卡片', async () => {
    const app = await render({
      path: '/members/m-2',
      profile: { ...PROFILE, birthday: null, interests: null, favoriteVerse: null },
    });
    expect(app.querySelector('.paper-message')?.textContent).toContain('還沒有填');
  });

  it('看自己的檔案時多一個編輯入口', async () => {
    const app = await render({ path: '/members/m-1', profile: { ...PROFILE, memberId: 'm-1' } });
    expect(app.querySelector<HTMLAnchorElement>('a[href="/member/me/edit"]')).not.toBeNull();
  });

  it('看別人的檔案時沒有編輯入口', async () => {
    const app = await render({ path: '/members/m-2' });
    expect(app.querySelector('a[href="/member/me/edit"]')).toBeNull();
  });

  it('找不到那個人時顯示原因，而不是一片空白', async () => {
    const app = await render({ path: '/members/nope', profile: new Error('找不到這位成員。') });
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('找不到這位成員');
  });
});

describe('可見性（§8.6：成員名單帶有宗教信仰資訊）', () => {
  it('訪客看不到列表，也不會去查資料', async () => {
    const app = await render({ viewer: { kind: 'guest' } });
    expect(mocks.listRoomMembers).not.toHaveBeenCalled();
    expect(app.querySelector('.member-tile')).toBeNull();
    expect(app.querySelector<HTMLAnchorElement>('a[href="/join"]')).not.toBeNull();
  });

  it('訪客直接打某個人的網址也看不到', async () => {
    const app = await render({ path: '/members/m-2', viewer: { kind: 'guest' } });
    expect(mocks.getProfileOf).not.toHaveBeenCalled();
    expect(app.textContent).toContain('只有成員看得到');
  });
});
