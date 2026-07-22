/** 交割地点常用选项（支持自定义输入） */
export const DELIVERY_LOCATION_OPTIONS = [
  "江苏张家港",
  "华东库",
  "华南库",
  "华北库",
  "西南库",
  "上海港",
  "宁波港",
  "广州港",
];

/** 产品规格常用选项（支持自定义输入） */
export const SPECS_OPTIONS = [
  "优等品",
  "一等品",
  "合格品",
  "99.9% 工业级",
  "99.5% 工业级",
  "国标优等",
];

/** 合并预设选项与当前值 */
export function mergeSelectOptions(presets: string[], current?: string | null): string[] {
  const set = new Set(presets);
  const c = (current ?? "").trim();
  if (c) set.add(c);
  return Array.from(set);
}
