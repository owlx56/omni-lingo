import type { EffectiveTheme } from "@/lib/theme";

export const READEST_DEFAULT_FONT_SIZE = 16;
export const READEST_MINIMUM_FONT_SIZE = 8;
const READEST_DEFAULT_FONT_WEIGHT = 400;

export function createFoliateContentCss(theme: EffectiveTheme): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#1f1f1e" : "#ffffff";
  const text = isDark ? "#ebe8df" : "#1f1e1d";
  const selection = isDark
    ? "rgba(91, 141, 214, 0.42)"
    : "rgba(44, 117, 224, 0.28)";
  const link = isDark ? "#8ab4f8" : "#1f5fbf";

  return [
    [
      "html{",
      `--font-size:${READEST_DEFAULT_FONT_SIZE}px;`,
      `--min-font-size:${READEST_MINIMUM_FONT_SIZE}px;`,
      `--font-weight:${READEST_DEFAULT_FONT_WEIGHT};`,
      "}",
    ].join(""),
    [
      "html,body{",
      `background:${bg}!important;`,
      `color:${text}!important;`,
      `color-scheme:${theme}!important;`,
      `font-size:${READEST_DEFAULT_FONT_SIZE}px!important;`,
      `font-weight:${READEST_DEFAULT_FONT_WEIGHT};`,
      "-webkit-text-size-adjust:none;",
      "text-size-adjust:none;",
      "}",
    ].join(""),
    `::selection{background:${selection}!important;}`,
    `a,a:visited{color:${link}!important;}`,
  ].join("\n");
}
