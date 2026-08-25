/**
 * 功能開關（架構書 §12.7 / ADR-0013）。
 *
 * 未啟用的功能：UI 不渲染入口，module 可先存在但不被呼叫。
 * 開關切換不需動已上線區塊的程式碼。
 */
export const features = {
  memberFilter: false, // 第二期，第 3 週
  randomThrowback: false, // 第二期，第 3 週
  profile: false, // 第三期，第 4 至 5 週
  icebreaker: false, // 第四期，第 6 至 8 週
  spotlight: false, // 第五期，第 9 至 12 週
  guessWho: false, // 第六期，第 13 至 15 週
  semesterRecap: false, // 第七期，第 16 至 18 週
} as const;

export type FeatureName = keyof typeof features;

export function isEnabled(name: FeatureName): boolean {
  return features[name];
}
