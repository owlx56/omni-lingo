// 极轻量同语种短路：仅用于 hover 发请求前的高置信跳过。
//
// 设计原则：宁可多翻译一次，也不要漏掉本该翻译的文本。
//   - zh：除空白 / 数字 / 标点 / 符号外，全部是 Han 字符才跳过
//   - ja：含假名即可高置信视为日文
//   - ko：含 Hangul 即可高置信视为韩文
//   - en/fr/de/it 等拉丁语目标：不靠字符脚本跳过，交给引擎
//
// 不引入复杂统计或语言检测库（违反 AGENTS.md 加依赖门槛），也不依赖
// engines 返回的 from 字段（那需要先发请求才知道，达不到"短路省请求"的目的）。

const HAN_RE = /\p{Script=Han}/u;
const NEUTRAL_RE = /^[\p{White_Space}\p{Number}\p{Punctuation}\p{Symbol}]+$/u;

const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/;

/**
 * 文本高置信等同于目标语言时返回 true，调用方应跳过翻译。
 *
 * - target=zh：语言字符全是 Han → 跳过
 * - target=ja：含假名 → 跳过
 * - target=ko：含 Hangul → 跳过
 * - 其他 target / 文本无法高置信判定 → 不跳过
 *
 * 对 hover 这种热路径保持线性扫描；只有明确同语种才短路。
 */
export function shouldSkipSameLanguageText(
  text: string,
  target: string,
): boolean {
  if (!text) return false;

  const lang = primaryLang(target);
  if (lang === "zh") return isHanOnlyText(text);
  if (lang === "ja") return KANA_RE.test(text);
  if (lang === "ko") return HANGUL_RE.test(text);

  return false;
}

function primaryLang(lang: string): string {
  return lang.toLowerCase().split(/[-_]/, 1)[0] ?? "";
}

function isHanOnlyText(text: string): boolean {
  let hasHan = false;

  for (const char of text) {
    if (HAN_RE.test(char)) {
      hasHan = true;
      continue;
    }
    if (NEUTRAL_RE.test(char)) continue;
    return false;
  }

  return hasHan;
}
