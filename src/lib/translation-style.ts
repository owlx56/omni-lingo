import type {
  TranslationFontFamily,
  TranslationStyle,
} from "@/lib/storage/settings";

export function resolveTranslationStyleColor(
  style: TranslationStyle,
): string | undefined {
  if (style.color === "yellow") return "rgb(251, 188, 4)";
  if (style.color === "green") return "rgb(19, 129, 37)";
  if (style.color === "teal") return "rgb(25, 174, 160)";
  if (style.color === "blue") return "rgb(26, 115, 232)";
  if (style.color === "indigo") return "rgb(91, 96, 232)";
  if (style.color === "orange") return "rgb(245, 124, 0)";
  if (style.color === "purple") return "rgb(142, 68, 173)";
  if (style.color === "pink") return "rgb(236, 64, 122)";
  if (style.color === "red") return "rgb(234, 51, 59)";
  if (style.color === "gray") return "rgb(147, 147, 147)";
  if (style.color === "custom" && /^#[0-9a-f]{6}$/i.test(style.customColor)) {
    return style.customColor;
  }
  return undefined;
}

export function resolveTranslationStyleFontFamily(
  font: TranslationFontFamily,
): string | undefined {
  if (font === "serif") return 'Georgia, "Times New Roman", serif';
  if (font === "sans") {
    return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }
  if (font === "mono") {
    return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
  }
  return undefined;
}

export function resolveTranslationStyleTextDecoration(
  style: TranslationStyle,
): string {
  if (style.underlineStyle === "none") return "none";
  return `underline ${style.underlineStyle}`;
}

export function buildTranslationStyleCss(style: TranslationStyle): string {
  const css: string[] = [];

  const textDecoration = resolveTranslationStyleTextDecoration(style);
  css.push(`text-decoration: ${textDecoration};`);

  const fontFamily = resolveTranslationStyleFontFamily(style.fontFamily);
  if (fontFamily) css.push(`font-family: ${fontFamily};`);

  const color = resolveTranslationStyleColor(style);
  if (color) css.push(`color: ${color};`);

  return css.join(" ");
}
