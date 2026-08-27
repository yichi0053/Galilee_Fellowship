/**
 * /admin 的結構煙霧測試。
 *
 * §15.2：UI 只驗「畫得出來、關鍵規則沒漏掉」。這一頁最該守的是
 * §4.3 那組——「停權」與「標記退出」對貼文的處置相反，兩顆按鈕接反了
 * 資料庫不會察覺，牆上只會安靜地多出或少掉一個人的貼文。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiddenPost, MemberSummary, RoomSettings } from '@modules/admin';
import type { Viewer } from '@modules/membership';

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getRoomSettings: vi.fn(),
  updateRoomSettings: vi.fn(),
  listMembers: vi.fn(),
  suspendMember: vi.fn(),
  reinstateMember: vi.fn(),
  markMemberLeft: vi.fn(),
  listJoinAttempts: vi.fn(),
  listSoftDeleted: vi.fn(),
  listHidden: vi.fn(),
  unhidePost: vi.fn(),
  runCleanup: vi.fn(),
  listThemesFrom: vi.fn(),
  scheduleThemes: vi.fn(),
}));

vi.mock('@modules/membership', () => ({ getViewer: mocks.getViewer }));
vi.mock('@modules/admin', () => ({ ...mocks, WeakJoinCodeError: class extends Error {} }));
vi.mock('@modules/themes', () => ({
  listThemesFrom: mocks.listThemesFrom,
  scheduleThemes: mocks.scheduleThemes,
}));

const ADMIN: Viewer = { kind: 'admin', memberId: 'm-9', displayName: '負責人', avatarUrl: null };
const ROOM: RoomSettings = {
  name: '加利利團契',
  description: '一起把這學期的樣子貼在牆上。',
  backgroundImageUrl: null,
  joinCode: 'DEV-ONLY-JOIN-CODE-0000',
  joinOpen: true,
};

function member(over: Partial<MemberSummary> = {}): MemberSummary {
  return {
    memberId: 'm-1',
    displayName: '陳小明',
    role: 'member',
    status: 'active',
    joinedAt: new Date('2026-08-20T04:00:00Z'),
    ...over,
  };
}

async function render(
  options: { viewer?: Viewer; members?: MemberSummary[]; hidden?: HiddenPost[] } = {},
) {
  document.body.innerHTML = '<main id="app"></main>';
  mocks.getViewer.mockResolvedValue(options.viewer ?? ADMIN);
  mocks.getRoomSettings.mockResolvedValue(ROOM);
  mocks.updateRoomSettings.mockResolvedValue(ROOM);
  mocks.listMembers.mockResolvedValue(
    options.members ?? [member(), member({ memberId: 'm-9', displayName: '負責人', role: 'admin' })],
  );
  mocks.listJoinAttempts.mockResolvedValue([]);
  mocks.listSoftDeleted.mockResolvedValue([]);
  mocks.listHidden.mockResolvedValue(options.hidden ?? []);
  mocks.unhidePost.mockResolvedValue(undefined);
  mocks.suspendMember.mockResolvedValue(undefined);
  mocks.reinstateMember.mockResolvedValue(undefined);
  mocks.markMemberLeft.mockResolvedValue(undefined);
  mocks.runCleanup.mockResolvedValue({ deletedRows: 0, deletedObjects: 0 });
  mocks.listThemesFrom.mockResolvedValue([]);
  mocks.scheduleThemes.mockResolvedValue([]);

  vi.resetModules();
  await import('./admin');
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

async function openTab(app: HTMLElement, label: string): Promise<void> {
  const tab = Array.from(app.querySelectorAll<HTMLButtonElement>('.admin-tab')).find(
    (t) => t.textContent === label,
  );
  tab?.dispatchEvent(new Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

async function clickByText(app: HTMLElement, text: string): Promise<void> {
  const b = Array.from(app.querySelectorAll<HTMLButtonElement>('button')).find(
    (x) => x.textContent === text,
  );
  b?.dispatchEvent(new Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => vi.clearAllMocks());

describe('/admin 的存取', () => {
  it('一般成員看不到後台，也不會去查任何管理資料', async () => {
    const app = await render({ viewer: { kind: 'member', memberId: 'm-1', displayName: '陳小明', avatarUrl: null } });
    expect(app.querySelector('.admin-tabs')).toBeNull();
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(app.querySelector('.paper-card__title')?.textContent).toBe('只有管理員看得到這一頁');
  });

  it('管理員看到四個分頁，預設落在房間設定', async () => {
    const app = await render();
    const labels = Array.from(app.querySelectorAll('.admin-tab')).map((t) => t.textContent);
    expect(labels).toEqual(['房間設定', '主題排程', '成員管理', '貼文管理']);
    expect(app.querySelector('.admin-tab[aria-current="true"]')?.textContent).toBe('房間設定');
  });
});

describe('/admin 房間設定（§8.2、§8.4）', () => {
  it('房間碼預設遮蔽，按「顯示」才看得到', async () => {
    const app = await render();
    const code = app.querySelector<HTMLInputElement>('.code-row .paper-input');
    expect(code?.type).toBe('password');
    await clickByText(app, '顯示');
    expect(code?.type).toBe('text');
  });

  it('儲存時把四個欄位一起送出，包含開放加入的開關', async () => {
    const app = await render();
    app.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.updateRoomSettings).toHaveBeenCalledWith(
      expect.objectContaining({ name: '加利利團契', joinOpen: true }),
    );
  });

  it('模組拋出的房間碼錯誤原樣顯示，不再翻譯一次', async () => {
    const app = await render();
    mocks.updateRoomSettings.mockRejectedValue(new Error('這個房間碼太好猜了，換一個。'));
    app.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(app.querySelector('.paper-message--error')?.textContent).toContain('太好猜');
  });
});

describe('/admin 成員管理（§4.3：最容易接反的一組）', () => {
  it('「停權」接的是 suspendMember，不是 markMemberLeft', async () => {
    const app = await render();
    await openTab(app, '成員管理');
    await clickByText(app, '停權（貼文隱藏）');
    expect(mocks.suspendMember).toHaveBeenCalledWith('m-1');
    expect(mocks.markMemberLeft).not.toHaveBeenCalled();
  });

  it('「標記退出」接的是 markMemberLeft，不是 suspendMember', async () => {
    const app = await render();
    await openTab(app, '成員管理');
    await clickByText(app, '標記退出（貼文保留）');
    expect(mocks.markMemberLeft).toHaveBeenCalledWith('m-1');
    expect(mocks.suspendMember).not.toHaveBeenCalled();
  });

  it('按鈕文字直接寫出貼文的下場，因為那才是兩者真正的差別', async () => {
    const app = await render();
    await openTab(app, '成員管理');
    expect(app.textContent).toContain('停權（貼文隱藏）');
    expect(app.textContent).toContain('標記退出（貼文保留）');
  });

  it('已停權的成員只給「恢復為正常」', async () => {
    const app = await render({ members: [member({ status: 'suspended' })] });
    await openTab(app, '成員管理');
    expect(app.textContent).toContain('恢復為正常');
    expect(app.textContent).not.toContain('停權（貼文隱藏）');
  });

  it('管理員自己沒有任何按鈕：停掉唯一的管理員就沒人能復權（ADR-0014）', async () => {
    const app = await render({ members: [member({ memberId: 'm-9', role: 'admin' })] });
    await openTab(app, '成員管理');
    expect(app.querySelector('.row__actions')?.childElementCount).toBe(0);
  });
});

describe('/admin 貼文管理（ADR-0009）', () => {
  it('沒有待清理的貼文時說清楚，而不是一片空白', async () => {
    const app = await render();
    await openTab(app, '貼文管理');
    // 這一頁現在有兩個 .empty-note（下架中、等待清理），
    // 抓第一個會抓到上面那一區，故改為檢查整頁文字。
    expect(app.textContent).toContain('沒有等待清理');
  });

  it('執行清理呼叫 runCleanup，並回報實際刪了幾筆', async () => {
    const app = await render();
    await openTab(app, '貼文管理');
    mocks.runCleanup.mockResolvedValue({ deletedRows: 3, deletedObjects: 6 });
    await clickByText(app, '執行清理');
    expect(mocks.runCleanup).toHaveBeenCalled();
    expect(app.querySelector('.paper-message')?.textContent).toContain('3 則貼文與 6 個檔案');
  });
});

describe('/admin 主題排程（§9.6）', () => {
  it('一次排出一整學期 18 週', async () => {
    const app = await render();
    await openTab(app, '主題排程');
    expect(app.querySelectorAll('.rows .row').length).toBe(18);
    expect(mocks.listThemesFrom).toHaveBeenCalled();
  });

  it('留白的那幾週照樣送出——那是「這週沒有主題」的表達方式，不是漏填', async () => {
    const app = await render();
    await openTab(app, '主題排程');
    const first = app.querySelector<HTMLInputElement>('.row .paper-input');
    if (first) first.value = '今天的晚餐，跟誰吃的';

    app.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const drafts = mocks.scheduleThemes.mock.calls[0]?.[0] as { title: string }[];
    expect(drafts).toHaveLength(18);
    expect(drafts[0]?.title).toBe('今天的晚餐，跟誰吃的');
    expect(drafts[1]?.title).toBe('');
  });
});

describe('/admin 加入紀錄（§8.3）', () => {
  it('併在成員管理底下，因為會來看它的時機幾乎都是有人加不進來', async () => {
    const app = await render();
    // render() 會把所有 mock 設成預設值，所以這一筆必須在它之後、切分頁之前才設。
    mocks.listJoinAttempts.mockResolvedValue([
      { displayName: null, success: false, at: new Date('2026-08-27T02:00:00Z') },
    ]);
    await openTab(app, '成員管理');
    expect(app.textContent).toContain('最近的加入嘗試');
    expect(app.textContent).toContain('（尚未加入的人）');
    expect(app.textContent).toContain('失敗');
  });
});

describe('/admin 下架中的貼文（§9.5）', () => {
  const HIDDEN: HiddenPost[] = [
    {
      id: 'p-9' as HiddenPost['id'],
      title: '好吃碗粿',
      authorName: '陳小明',
      week: '2026-08-24',
      createdAt: new Date('2026-08-25T04:00:00Z'),
      thumbUrl: 'https://example.test/t9.jpg',
    },
  ];

  it('沒有下架中的貼文時說清楚，而不是一片空白', async () => {
    const app = await render();
    await openTab(app, '貼文管理');
    expect(app.textContent).toContain('目前沒有下架中的貼文');
  });

  it('列出下架中的貼文，含縮圖與作者——要決定放不放回去得先看得到那是什麼', async () => {
    const app = await render({ hidden: HIDDEN });
    await openTab(app, '貼文管理');
    const row = app.querySelector('.row--hidden');
    expect(row).not.toBeNull();
    expect(row?.querySelector<HTMLImageElement>('.row__thumb')?.src).toBe(
      'https://example.test/t9.jpg',
    );
    expect(row?.querySelector('.row__name')?.textContent).toBe('好吃碗粿');
    expect(row?.querySelector('.row__meta')?.textContent).toContain('陳小明');
  });

  it('每一列都有一個連往完整貼文的入口', async () => {
    const app = await render({ hidden: HIDDEN });
    await openTab(app, '貼文管理');
    expect(
      app.querySelector<HTMLAnchorElement>('.row--hidden a[href="/post/p-9"]'),
    ).not.toBeNull();
  });

  it('「放回架上」呼叫 unhidePost', async () => {
    const app = await render({ hidden: HIDDEN });
    await openTab(app, '貼文管理');
    await clickByText(app, '放回架上');
    expect(mocks.unhidePost).toHaveBeenCalledWith('p-9');
  });

  it('標頭顯示目前有幾則，不用自己數', async () => {
    const app = await render({ hidden: HIDDEN });
    await openTab(app, '貼文管理');
    expect(app.textContent).toContain('下架中（1）');
  });
});
