/**
 * 假資料，供牆頁在還沒有 Supabase 專案時就能在瀏覽器裡看見成果。
 *
 * 以 VITE_USE_MOCK=true 啟用。正式環境不會走到這裡。
 * 圖片是就地產生的 SVG data URI，不連外，離線也能跑。
 *
 * 這個檔案在 tracer bullet（T-04）接上真資料之後就可以刪掉。
 */

import { parseWeekStart, shiftWeeks, weekStartOf } from '@domain/week';
import type { WeekStart } from '@domain/week';
import type { Post, PostId } from '@modules/posts';
import type { Theme } from '@modules/themes';

const PALETTE = [
  ['#d98f5a', '#8c4f2b'],
  ['#5a8fa8', '#2c5769'],
  ['#7fa05a', '#4a6b2f'],
  ['#a85a7f', '#692c4f'],
  ['#a8935a', '#69542c'],
  ['#6b6fa8', '#3a3d69'],
];

function placeholder(seed: number, w: number, h: number): string {
  const pair = PALETTE[seed % PALETTE.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${pair[0]}"/><stop offset="1" stop-color="${pair[1]}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.3}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,0.22)"/>
    <rect x="0" y="${h * 0.68}" width="100%" height="${h * 0.32}" fill="rgba(0,0,0,0.14)"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const NAMES = ['陳小明', '林大華', '黃怡君', '張文彥', '吳品萱', '蔡承翰', '許嘉玲', '鄭柏諺'];

const BODIES = [
  '宿舍樓下那攤滷味，老闆記得我不吃香菜，這件事讓我開心了一整個晚上。',
  '報告寫到三點，室友默默放了一杯溫豆漿在桌上就去睡了，沒說話。',
  '這禮拜第一次在圖書館看到日出，原來六點的天空是這個顏色。',
  '跟高中同學吃飯，才發現我們已經三年沒好好講過話了，但坐下來還是很自然。',
  '媽媽寄了一箱柚子來，室友三個人分完只花了兩天。',
  '練團練到手指起水泡，但主歌終於接得起來了。',
  '路邊這隻貓每天都在同一個位置睡覺，我開始懷疑牠是不是在等誰。',
  '期中考完的第一件事是把書桌整個清空，然後坐著發呆二十分鐘。',
  '今天騎車經過河堤，風大到差點停下來，但停下來以後就一直坐著沒走。',
];

const THEME_TITLES = [
  ['今天的晚餐，跟誰吃的', '不用是大餐，便利商店也算。'],
  ['你桌上最沒用但捨不得丟的東西', '講一下它為什麼還在。'],
  ['這禮拜讓你停下來看一眼的東西', '路邊的、螢幕上的都可以。'],
];

let idCounter = 0;

function makePost(week: WeekStart, index: number, now: Date): Post {
  idCounter += 1;
  const seed = idCounter;
  const portrait = seed % 3 !== 0;
  const w = portrait ? 300 : 400;
  const h = portrait ? 400 : 300;

  return {
    id: `mock-${seed}` as PostId,
    kind: index % 3 === 0 ? 'theme' : 'free',
    body: BODIES[seed % BODIES.length]!,
    imageUrl: placeholder(seed, w * 3, h * 3),
    thumbUrl: placeholder(seed, w, h),
    rotationDeg: ((seed * 7) % 7) - 3,
    week,
    authorName: NAMES[seed % NAMES.length]!,
    authorId: `member-${seed % NAMES.length}`,
    createdAt: new Date(now.getTime() - index * 5.5 * 3600_000),
    // 讓第一則卡片展示 10 分鐘倒數（§9.1）
    refundableUntil: index === 0 ? new Date(now.getTime() + 7 * 60_000) : null,
    hiddenByAdmin: false,
  };
}

export function mockWeeks(count = 4): WeekStart[] {
  const current = weekStartOf();
  return Array.from({ length: count }, (_, i) => shiftWeeks(current, -i));
}

export function mockListWeek(week: WeekStart): Promise<readonly Post[]> {
  const now = new Date();
  const offset = Math.abs(Number(week.slice(-2)));
  const howMany = 5 + (offset % 6);
  return Promise.resolve(Array.from({ length: howMany }, (_, i) => makePost(week, i, now)));
}

export function mockTheme(week: WeekStart): Theme | null {
  const offset = Math.abs(Number(week.slice(-2)));
  // 刻意讓其中一週沒有主題，好看見空窗週的呈現（§9.6）
  if (offset % 4 === 1) return null;
  const [title, description] = THEME_TITLES[offset % THEME_TITLES.length]!;
  return {
    id: `mock-theme-${week}`,
    week: parseWeekStart(week),
    title: title!,
    description: description!,
  };
}
