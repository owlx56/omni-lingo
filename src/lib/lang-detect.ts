// 极轻量源语言侦测：仅用于"目标语言 == 文本主要语言时跳过翻译"。
//
// 设计：与 less-translate 对齐——粗暴但稳定的字符范围检测。
//   - 含 CJK 字符 → 视为中文（含日韩汉字）
//   - 不含 CJK 且含拉丁字母 → 视为西方语言（英文 / 法语 / 德语 ...）
//   - 其他（纯数字 / 纯符号 / 表情）→ 不判定，交给引擎
//
// 不引入复杂统计或语言检测库（违反 AGENTS.md 加依赖门槛），也不依赖
// engines 返回的 from 字段（那需要先发请求才知道，达不到"短路省请求"的目的）。

// CJK 字符范围，移植自 less-translate js/content.js 的 Ze 常量：
//   \u3040-\u30ff  日文平假名 + 片假名
//   \u3400-\u4dbf  CJK Unified Ideographs Extension A
//   \u4e00-\u9fff  CJK Unified Ideographs (常用汉字)
//   \uf900-\ufaff  CJK Compatibility Ideographs
//   \uff66-\uff9f  半角片假名
const CJK_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

// 基本拉丁字母 + 拉丁扩展 A/B 的常用范围。覆盖英文、法语、德语、西语等。
const LATIN_RE = /[A-Za-z\u00c0-\u024f]/;

/**
 * 文本主要语言看起来已经等同于目标语言时返回 true，调用方应跳过翻译。
 *
 * - target=zh：文本含任意 CJK 字符 → 跳过
 * - target=en：文本不含 CJK 且含拉丁字母 → 跳过（西方语言视作已是英文域）
 * - 其他 target / 文本无法判定 → 不跳过
 *
 * 对 hover 这种热路径要求 O(1) 短路，对长文本只检查到第一个匹配字符即返回。
 */
export function isTargetSameAsText(text: string, target: string): boolean {
  if (!text) return false;
  if (target === "zh") return CJK_RE.test(text);
  if (target === "en") return !CJK_RE.test(text) && LATIN_RE.test(text);
  return false;
}
