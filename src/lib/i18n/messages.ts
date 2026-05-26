// OneLingo UI 多语言字典。
//
// 文案源集中在 catalog.ts；messages.ts 只导出类型和格式化 helper。

export type { Dict, MessageKey, PartialDict } from "./catalog";

/** 简易模板替换，{name} → params[name]。未匹配的占位符保留原样以便发现 bug。 */
export function format(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (raw, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : raw,
  );
}
