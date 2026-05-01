import type {
  TranslationFontFamily,
  TranslationStyle,
} from "@/lib/storage/settings";

export function resolveTranslationStyleColor(
  style: TranslationStyle,
): string | undefined {
  if (style.color === "muted") return "#6b7280";
  if (style.color === "blue") return "#2563eb";
  if (style.color === "green") return "#047857";
  if (style.color === "red") return "#dc2626";
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

export function buildTranslationStyleCss(style: TranslationStyle): string {
  const css: string[] = [];

  if (style.underline) css.push("text-decoration: underline;");

  const fontFamily = resolveTranslationStyleFontFamily(style.fontFamily);
  if (fontFamily) css.push(`font-family: ${fontFamily};`);

  const color = resolveTranslationStyleColor(style);
  if (color) css.push(`color: ${color};`);

  return css.join(" ");
}
