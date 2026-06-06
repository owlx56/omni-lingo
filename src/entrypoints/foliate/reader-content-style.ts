import type { EffectiveTheme } from "@/lib/theme";
import {
  FOLIATE_READER_TEXT_INDENT_EM,
  normalizeFoliateReaderSettings,
  shouldRelayoutFoliateReaderAppearance,
  type FoliateReaderStyleSettings,
} from "./reader-settings";

export const READEST_DEFAULT_FONT_SIZE = 16;
export const READEST_MINIMUM_FONT_SIZE = 8;
export const READEST_DEFAULT_LINE_HEIGHT = 1.4;
export const READEST_DEFAULT_TEXT_INDENT = 0;
export const FOLIATE_CONTENT_STYLE_ID = "onelingo-foliate-theme";
const READEST_DEFAULT_FONT_WEIGHT = 400;

type FoliateContentStyleTarget = {
  renderer?: {
    getContents?(): { doc?: Document | null }[] | undefined;
    render?(): void;
    setStyles?(styles: string | [string, string]): void;
  } | null;
  getContents?(): { doc?: Document | null }[] | undefined;
};

type ApplyFoliateViewContentCssOptions = {
  relayout?: boolean;
};

type ApplyFoliateReaderStyleSettingsOptions =
  ApplyFoliateViewContentCssOptions & {
    previous?: FoliateReaderStyleSettings | null;
  };

export type FoliateContentTransformMetrics = {
  height: number;
  vertical: boolean;
  width: number;
};

type FoliateContentTransformDetail = {
  data: Blob | Promise<Blob | string> | string;
  name?: string;
  type?: string;
};

export function applyFoliateContentCss(doc: Document, css: string): void {
  const style =
    doc.getElementById(FOLIATE_CONTENT_STYLE_ID) ?? doc.createElement("style");
  style.id = FOLIATE_CONTENT_STYLE_ID;
  style.textContent = css;
  if (!style.parentNode) {
    (doc.head ?? doc.documentElement).appendChild(style);
  }
}

export function applyFoliateViewContentCss(
  view: FoliateContentStyleTarget | null | undefined,
  css: string,
  options: ApplyFoliateViewContentCssOptions = {},
): void {
  const renderer = view?.renderer;
  renderer?.setStyles?.(css);
  const contents = view?.getContents?.() ?? renderer?.getContents?.();
  if (Array.isArray(contents)) {
    for (const item of contents) {
      if (item.doc) applyFoliateContentCss(item.doc, css);
    }
  }
  if (options.relayout) renderer?.render?.();
}

export function applyFoliateReaderStyleSettings(
  view: FoliateContentStyleTarget | null | undefined,
  theme: EffectiveTheme,
  settings: FoliateReaderStyleSettings,
  options: ApplyFoliateReaderStyleSettingsOptions = {},
): string {
  const css = createFoliateContentCss(theme, settings);
  applyFoliateViewContentCss(view, css, {
    relayout:
      options.relayout ??
      (options.previous
        ? shouldRelayoutFoliateReaderAppearance(options.previous, settings)
        : false),
  });
  return css;
}

export function createFoliateContentCss(
  theme: EffectiveTheme,
  settings?: Partial<FoliateReaderStyleSettings> | null,
): string {
  const readerSettings = normalizeFoliateReaderSettings({
    foliateReaderFontSize: settings?.fontSize,
    foliateReaderLineHeight: settings?.lineHeight,
    foliateReaderTextIndent: settings?.textIndent,
    foliateReaderUseBookLayout: settings?.useBookLayout,
  });
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
      `--font-size:${readerSettings.fontSize}px;`,
      `--min-font-size:${READEST_MINIMUM_FONT_SIZE}px;`,
      `--font-weight:${READEST_DEFAULT_FONT_WEIGHT};`,
      "--serif:serif;",
      "--sans-serif:sans-serif;",
      "--monospace:monospace;",
      `--theme-bg-color:${bg};`,
      `--theme-fg-color:${text};`,
      "--override-color:true;",
      "}",
    ].join(""),
    [
      "html,body{",
      `background:${bg}!important;`,
      `color:${text}!important;`,
      `color-scheme:${theme}!important;`,
      `font-size:${readerSettings.fontSize}px!important;`,
      `font-weight:${READEST_DEFAULT_FONT_WEIGHT};`,
      "-webkit-text-size-adjust:none;",
      "text-size-adjust:none;",
      "}",
    ].join(""),
    getLegacyFontSizeCss(readerSettings.fontSize),
    readerSettings.useBookLayout
      ? ""
      : getParagraphLayoutCss(
          readerSettings.lineHeight,
          readerSettings.textIndent,
        ),
    [
      "img,svg,video{",
      "max-width:100%!important;",
      "max-height:calc(var(--available-height) * 1px)!important;",
      "object-fit:contain!important;",
      "break-inside:avoid!important;",
      "page-break-inside:avoid!important;",
      "box-sizing:border-box!important;",
      "}",
    ].join(""),
    [
      "body:has(> img:only-child),body:has(> svg:only-child),body:has(> video:only-child){",
      "min-height:0!important;",
      "height:auto!important;",
      "max-height:calc(var(--available-height) * 1px)!important;",
      "overflow:hidden!important;",
      "}",
    ].join(""),
    `::selection{background:${selection}!important;}`,
    `a,a:visited{color:${link}!important;}`,
  ].filter(Boolean).join("\n");
}

export function createFoliateContentCssFromSource({
  getReaderSettings,
  readerSettings,
  readerSettingsOverride,
  theme,
}: {
  getReaderSettings?: () => FoliateReaderStyleSettings;
  readerSettings: FoliateReaderStyleSettings;
  readerSettingsOverride?: FoliateReaderStyleSettings;
  theme: EffectiveTheme;
}): string {
  return createFoliateContentCss(
    theme,
    getReaderSettings?.() ?? readerSettingsOverride ?? readerSettings,
  );
}

export function transformFoliateContentCss(
  css: string,
  metrics: FoliateContentTransformMetrics,
): string {
  const width = finitePositive(metrics.width);
  const height = finitePositive(metrics.height);
  const ruleRegex = /([^{]+)({[^}]+})/g;
  const isInlineStyle = !css.includes("{");

  css = removeBlockedLocalFontFaces(css);

  css = css.replace(ruleRegex, (match, selector, block) => {
    const hasTextAlignCenter = /text-align\s*:\s*center\s*[;$]/i.test(block);
    const hasTextIndentZero =
      /text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?\s*[;$]/i.test(block);
    if (!hasTextAlignCenter || !hasTextIndentZero) return match;
    return (
      selector +
      block
        .replace(/(text-align\s*:\s*center)(\s*;|\s*$)/gi, "$1 !important$2")
        .replace(
          /(text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?)(\s*;|\s*$)/gi,
          "$1 !important$2",
        )
    );
  });

  css = css.replace(ruleRegex, (match, selector, block) => {
    if (!/white-space\s*:\s*nowrap\s*[;$]/i.test(block)) return match;
    if (/overflow\s*:/i.test(block)) return match;
    return selector + block.replace(/}$/, " overflow:clip!important;}");
  });

  if (isInlineStyle) {
    if (
      /page-break-after\s*:\s*always\s*;?/i.test(css) &&
      !/margin-bottom\s*:/i.test(css)
    ) {
      css =
        css.replace(/;?\s*$/, "") +
        ";margin-bottom:calc(var(--available-height) * 1px)";
    }
  } else {
    css = css.replace(ruleRegex, (match, selector, block) => {
      if (!/page-break-after\s*:\s*always\s*[;$]/i.test(block)) return match;
      if (/margin-bottom\s*:/i.test(block)) return match;
      return (
        selector +
        block.replace(
          /}$/,
          " margin-bottom:calc(var(--available-height) * 1px);}",
        )
      );
    });
  }

  css = css.replace(ruleRegex, (match, selector, block) => {
    if (metrics.vertical) return match;
    let nextBlock = block;
    const directions: string[] = [];
    for (const direction of ["top", "bottom", "left", "right"]) {
      const bleedRegex = new RegExp(
        `duokan-bleed\\s*:\\s*[^;]*${direction}[^;]*;`,
        "i",
      );
      const marginRegex = new RegExp(`margin-${direction}\\s*:`, "i");
      if (bleedRegex.test(nextBlock) && !marginRegex.test(nextBlock)) {
        directions.push(direction);
        nextBlock = nextBlock.replace(
          /}$/,
          ` margin-${direction}:calc(-1 * var(--page-margin-${direction}))!important;}`,
        );
      }
    }
    if (!directions.length) return match;
    if (!/position\s*:/i.test(nextBlock)) {
      nextBlock = nextBlock.replace(/}$/, " position:relative!important;}");
    }
    if (!/overflow\s*:/i.test(nextBlock)) {
      nextBlock = nextBlock.replace(/}$/, " overflow:hidden!important;}");
    }
    if (!/display\s*:/i.test(nextBlock)) {
      nextBlock = nextBlock.replace(/}$/, " display:flow-root!important;}");
    }
    if (directions.includes("left") && directions.includes("right")) {
      nextBlock = nextBlock
        .replace(/}$/, " width:calc(var(--full-width) * 1px)!important;}")
        .replace(/}$/, " min-width:calc(var(--full-width) * 1px)!important;}")
        .replace(/}$/, " max-width:calc(var(--full-width) * 1px)!important;}");
    }
    if (directions.includes("top") && directions.includes("bottom")) {
      nextBlock = nextBlock
        .replace(/}$/, " height:calc(var(--full-height) * 1px)!important;}")
        .replace(/}$/, " min-height:calc(var(--full-height) * 1px)!important;}")
        .replace(/}$/, " max-height:calc(var(--full-height) * 1px)!important;}");
    }
    return selector + nextBlock;
  });

  css = css.replace(ruleRegex, (match, selector, block) => {
    if (!/\bbody\b/i.test(selector)) return match;
    const nextBlock = block
      .replace(/font-family\s*:\s*serif\s*(;|\}|$)/gi, "font-family:unset$1")
      .replace(
        /font-family\s*:\s*sans-serif\s*(;|\}|$)/gi,
        "font-family:unset$1",
      );
    return selector + nextBlock;
  });

  css = css.replace(ruleRegex, (match, selector, block) => {
    const widthMatch = /(?:^|[^a-z-])width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(block);
    const pxWidth = widthMatch ? Number.parseFloat(widthMatch[1] ?? "0") : 0;
    if (!width || pxWidth <= width || /max-width\s*:/i.test(block)) return match;
    return (
      selector +
      block.replace(
        /}$/,
        " width:100%;max-width:calc(var(--available-width) * 1px);box-sizing:border-box;}",
      )
    );
  });

  return css
    .replace(/font-size\s*:\s*xx-small/gi, "font-size:0.6rem")
    .replace(/font-size\s*:\s*x-small/gi, "font-size:0.75rem")
    .replace(/font-size\s*:\s*small/gi, "font-size:0.875rem")
    .replace(/font-size\s*:\s*medium/gi, "font-size:1rem")
    .replace(/font-size\s*:\s*large/gi, "font-size:1.2rem")
    .replace(/font-size\s*:\s*x-large/gi, "font-size:1.5rem")
    .replace(/font-size\s*:\s*xx-large/gi, "font-size:2rem")
    .replace(/font-size\s*:\s*xxx-large/gi, "font-size:3rem")
    .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, (_, px: string) => {
      const rem = Number.parseFloat(px) / 16;
      return `font-size:${trimNumber(rem)}rem`;
    })
    .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)pt/gi, (_, pt: string) => {
      const rem = Number.parseFloat(pt) / 12;
      return `font-size:${trimNumber(rem)}rem`;
    })
    .replace(
      /font-size\s*:\s*(\d*\.?\d+)(px|rem|em|%)?/gi,
      (_, size: string, unit = "px") =>
        `font-size:max(${size}${unit},var(--min-font-size,8px))`,
    )
    .replace(/backdrop-filter\s*:\s*brightness\(100%\)\s*;?/gi, "")
    .replace(/(\d*\.?\d+)vw/gi, (_, value: string) =>
      width ? `${trimNumber((Number.parseFloat(value) * width) / 100)}px` : "0px",
    )
    .replace(/(\d*\.?\d+)vh/gi, (_, value: string) =>
      height ? `${trimNumber((Number.parseFloat(value) * height) / 100)}px` : "0px",
    )
    .replace(/([\s;])-webkit-user-select\s*:\s*none/gi, "$1-webkit-user-select:unset")
    .replace(/([\s;])-moz-user-select\s*:\s*none/gi, "$1-moz-user-select:unset")
    .replace(/([\s;])-ms-user-select\s*:\s*none/gi, "$1-ms-user-select:unset")
    .replace(/([\s;])-o-user-select\s*:\s*none/gi, "$1-o-user-select:unset")
    .replace(/([\s;])user-select\s*:\s*none/gi, "$1user-select:unset")
    .replace(/(font-family\s*:[^;]*?)\bsans-serif\b/gi, "$1READEST_SS_PLACEHOLDER")
    .replace(/(font-family\s*:[^;]*?)\bserif\b(?!-)/gi, "$1var(--serif, serif)")
    .replace(/READEST_SS_PLACEHOLDER/g, "var(--sans-serif, sans-serif)")
    .replace(/(font-family\s*:[^;]*?)\bmonospace\b/gi, "$1var(--monospace, monospace)")
    .replace(/([\s;])font-weight\s*:\s*normal/gi, "$1font-weight:var(--font-weight)")
    .replace(/([\s;])color\s*:\s*black/gi, "$1color:var(--theme-fg-color)")
    .replace(/([\s;])color\s*:\s*#000000/gi, "$1color:var(--theme-fg-color)")
    .replace(/([\s;])color\s*:\s*#000/gi, "$1color:var(--theme-fg-color)")
    .replace(/([\s;])color\s*:\s*rgb\(0,\s*0,\s*0\)/gi, "$1color:var(--theme-fg-color)");
}

export function transformFoliateContentHtml(
  html: string,
  metrics: FoliateContentTransformMetrics,
): string {
  return html
    .replace(
      /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
      (_, attrs: string, css: string) =>
        `<style${attrs}>${transformFoliateContentCss(css, metrics)}</style>`,
    )
    .replace(
      /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
      (_, quote: string, css: string) =>
        ` style=${quote}${transformFoliateContentCss(css, metrics)}${quote}`,
    );
}

export function bindFoliateContentTransforms(
  target: EventTarget | null | undefined,
  getMetrics: () => FoliateContentTransformMetrics,
): () => void {
  if (!target) return () => {};

  const onData = (event: Event): void => {
    const detail = (event as CustomEvent<FoliateContentTransformDetail>).detail;
    if (!detail || !isTransformableContentType(detail.type)) return;
    detail.data = Promise.resolve(detail.data)
      .then((data) => contentDataToText(data))
      .then((text) =>
        transformFoliateContentData(text, detail.type ?? "", getMetrics()),
      )
      .catch((err: unknown) => {
        console.warn(
          `[OneLingo] failed to transform foliate content ${detail.name ?? ""}:`,
          err,
        );
        return "";
      });
  };

  target.addEventListener("data", onData);
  return () => target.removeEventListener("data", onData);
}

function getLegacyFontSizeCss(fontSize: number): string {
  return [
    `font[size="1"]{font-size:${READEST_MINIMUM_FONT_SIZE}px;}`,
    `font[size="2"]{font-size:${READEST_MINIMUM_FONT_SIZE * 1.5}px;}`,
    `font[size="3"]{font-size:${fontSize}px;}`,
    `font[size="4"]{font-size:${trimNumber(fontSize * 1.2)}px;}`,
    `font[size="5"]{font-size:${trimNumber(fontSize * 1.5)}px;}`,
    `font[size="6"]{font-size:${trimNumber(fontSize * 2)}px;}`,
    `font[size="7"]{font-size:${trimNumber(fontSize * 3)}px;}`,
    '[style*="font-size: 16px"],[style*="font-size:16px"]{font-size:1rem!important;}',
  ].join("\n");
}

function getParagraphLayoutCss(
  lineHeight: number,
  textIndent: boolean,
): string {
  return [
    [
      "p,blockquote,dd,li,div:not(:has(*:not(b,a,em,i,strong,u,span))){",
      `line-height:${lineHeight}!important;`,
      textIndent ? `text-indent:${FOLIATE_READER_TEXT_INDENT_EM}em!important;` : "text-indent:0!important;",
      "}",
    ].join(""),
    [
      "p:has(>img:only-child),p:has(>span:only-child>img:only-child),p:has(>img:not(.has-text-siblings)){",
      "text-indent:initial!important;",
      "}",
    ].join(""),
  ].join("\n");
}

function removeBlockedLocalFontFaces(css: string): string {
  return css.replace(/@font-face\s*{[^}]*}/gi, (rule) =>
    /\b(?:res|file):\/\//i.test(rule) ? "" : rule,
  );
}

function isTransformableContentType(type: string | undefined): boolean {
  return (
    type === "text/css" ||
    type === "text/html" ||
    type === "application/xhtml+xml"
  );
}

function transformFoliateContentData(
  data: string,
  type: string,
  metrics: FoliateContentTransformMetrics,
): string {
  if (type === "text/css") return transformFoliateContentCss(data, metrics);
  if (type === "text/html" || type === "application/xhtml+xml") {
    return transformFoliateContentHtml(data, metrics);
  }
  return data;
}

function contentDataToText(data: Blob | string): Promise<string> | string {
  return typeof data === "string" ? data : data.text();
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(4)).toString();
}
