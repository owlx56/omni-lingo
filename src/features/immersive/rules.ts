import type { PageTranslateCommand } from "@/lib/messaging";
import type { FullPageEngineId } from "@/lib/storage/settings";

export const GLOBAL_RULE_KEY = "*" as const;

export const SPLIT_PARAGRAPH_DISABLE = "split_disable" as const;
export const SPLIT_PARAGRAPH_PUNCTUATION = "split_punctuation" as const;
export const SPLIT_PARAGRAPH_TEXTLENGTH = "split_textlength" as const;

export type RuleToggle = "true" | "false" | typeof GLOBAL_RULE_KEY;
export type SplitParagraphMode =
  | typeof SPLIT_PARAGRAPH_DISABLE
  | typeof SPLIT_PARAGRAPH_PUNCTUATION
  | typeof SPLIT_PARAGRAPH_TEXTLENGTH
  | typeof GLOBAL_RULE_KEY;
export type RuleTag = "span" | "font" | typeof GLOBAL_RULE_KEY;

export interface FullPageRule {
  pattern: string;
  selector: string;
  keepSelector: string;
  rootsSelector: string;
  ignoreSelector: string;
  richHtmlSelector?: string;
  richHtmlExcludeSelector?: string;
  fromLang: string;
  toLang: string;
  transOpen: RuleToggle;
  transOnly: RuleToggle;
  autoScan: RuleToggle;
  hasRichText: RuleToggle;
  hasShadowroot: RuleToggle;
  scanAll: RuleToggle;
  transTag: RuleTag;
  transTitle: RuleToggle;
  splitParagraph: SplitParagraphMode;
  splitLength: number;
  textExtStyle: string;
  selectStyle: string;
  parentStyle: string;
  grandStyle: string;
}

export interface ResolvedFullPageRule {
  pattern: string;
  selector: string;
  keepSelector: string;
  rootsSelector: string;
  ignoreSelector: string;
  richHtmlSelector: string;
  richHtmlExcludeSelector: string;
  engine: FullPageEngineId;
  source?: string;
  target: string;
  transOnly: boolean;
  autoScan: boolean;
  hasRichText: boolean;
  hasShadowroot: boolean;
  scanAll: boolean;
  transTag: "span" | "font";
  transTitle: boolean;
  textExtStyle: string;
  selectStyle: string;
  parentStyle: string;
  grandStyle: string;
}

const DEFAULT_SELECTOR =
  "h1, h2, h3, h4, h5, h6, li, p, dd, blockquote, figcaption, label, legend";
const DEFAULT_IGNORE_SELECTOR =
  "button, footer, pre, mark, nav, svg, img[src*='.svg'], [class*='logo'] svg, [id*='logo'] svg";
const DEFAULT_KEEP_SELECTOR = "code, cite, math, .math, a:has(code)";
const DEFAULT_SELECT_STYLE = "-webkit-line-clamp: unset; max-height: none; height: auto;";

const WIKIPEDIA_CHROME_SELECTOR = [
  "#p-associated-pages .mw-list-item > a > span",
  "#p-views .mw-list-item > a > span",
  "#p-cactions .vector-dropdown-label-text",
  "#p-cactions .mw-list-item > a > span",
  "#vector-main-menu-dropdown .vector-dropdown-label-text",
  "#vector-main-menu .vector-pinnable-header-label",
  "#vector-main-menu .vector-pinnable-header-toggle-button",
  "#vector-main-menu .vector-menu-heading",
  "#vector-main-menu .mw-list-item > a > span",
  "#vector-appearance-dropdown .vector-dropdown-label-text",
  "#vector-appearance .vector-pinnable-header-label",
  "#vector-appearance .vector-pinnable-header-toggle-button",
  "#vector-appearance .vector-menu-heading",
  "#vector-appearance .cdx-label__label__text",
  "#vector-appearance .skin-client-pref-exclusion-notice",
].join(", ");

const WIKIPEDIA_MAIN_PAGE_SELECTOR = [
  "+ #mp-welcome",
  "+ #mp-welcome h1",
  "+ #mp-welcome p",
  "+ #mp-free",
  "+ #articlecount li",
  "+ #mp-upper .mp-h2",
  "+ #mp-upper p",
  "+ #mp-upper li",
  "+ #mp-middle .mp-h2",
  "+ #mp-middle p",
  "+ #mp-middle li",
  "+ #mp-lower .mp-h2",
  "+ #mp-lower p",
  "+ #mp-lower li",
  "+ #mp-bottom .mp-h2",
  "+ #mp-other-content li",
  "+ #mp-sister-content > p",
  "+ #sister-projects-list li > div:last-child",
  "+ .wikipedia-languages > p",
  "+ .wikipedia-languages-count",
  "+ .wikipedia-languages-langs li",
].join(", ");

const WIKIPEDIA_MAIN_PAGE_ROOTS = [
  "#content",
  "#vector-main-menu",
  "#footer",
  "#vector-appearance-pinned-container",
  "#vector-appearance-unpinned-container",
  "#vector-appearance",
].join(", ");

const QUORA_ROOTS_SELECTOR = [
  "main",
  "[role='main']",
  "#mainContent",
  "aside",
].join(", ");

const QUORA_IGNORE_SELECTOR = [
  "+ header",
  "+ [role='banner']",
  "+ .q-fixed",
  "+ .q-sticky",
].join(", ");

export const DEFAULT_FULL_PAGE_RULE: FullPageRule = {
  pattern: GLOBAL_RULE_KEY,
  selector: DEFAULT_SELECTOR,
  keepSelector: DEFAULT_KEEP_SELECTOR,
  rootsSelector: "body",
  ignoreSelector: DEFAULT_IGNORE_SELECTOR,
  richHtmlSelector: "",
  richHtmlExcludeSelector: "",
  fromLang: "auto",
  toLang: GLOBAL_RULE_KEY,
  transOpen: "false",
  transOnly: "false",
  autoScan: "true",
  hasRichText: "true",
  hasShadowroot: "false",
  scanAll: "false",
  transTag: "font",
  transTitle: "false",
  splitParagraph: SPLIT_PARAGRAPH_DISABLE,
  splitLength: 100,
  textExtStyle: "",
  selectStyle: DEFAULT_SELECT_STYLE,
  parentStyle: "",
  grandStyle: "",
};

export const BUILTIN_FULL_PAGE_RULES: FullPageRule[] = [
  {
    pattern: "en.wikipedia.org",
    selector: WIKIPEDIA_CHROME_SELECTOR,
    keepSelector: "",
    rootsSelector: "",
    ignoreSelector:
      ".button, code, footer, mark, pre, .mwe-math-element, .mw-editsection",
    richHtmlSelector: "body",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: GLOBAL_RULE_KEY,
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "en.wikipedia.org/wiki/Main_Page",
    selector: WIKIPEDIA_MAIN_PAGE_SELECTOR,
    keepSelector: "",
    rootsSelector: WIKIPEDIA_MAIN_PAGE_ROOTS,
    ignoreSelector: "",
    richHtmlSelector: "#mp-tfa, #mp-tfl, #mp-dyk, #mp-itn, #mp-otd, #mp-tfp",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "overflow-wrap: anywhere; word-break: break-word;",
    selectStyle: "max-width: 100%; overflow-wrap: anywhere; word-break: break-word;",
    parentStyle: "min-width: 0; max-width: 100%; overflow-wrap: anywhere;",
    grandStyle: "min-width: 0; max-width: 100%; overflow-wrap: anywhere;",
  },
  {
    pattern: "news.ycombinator.com",
    selector:
      "p, .titleline, .commtext, .hn-item-title, .hn-comment-text, .hn-story-title",
    keepSelector: "code, img, svg, pre, .sitebit",
    rootsSelector: "",
    ignoreSelector: "button, code, footer, form, header, mark, nav, pre, .reply",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "twitter.com, https://x.com",
    selector:
      "[data-testid='tweetText'], [data-testid='twitter-article-title'], [data-testid='UserDescription'], .public-DraftStyleDefault-block, span.text-body, div.css-175oi2r.r-3pj75a div.css-175oi2r>span, div.css-175oi2r.r-3pj75a li>span, div.r-1s2bzr4>div.r-16dba41, div.r-16y2uox>div.r-1jeg54m",
    keepSelector: "img, svg, a, span:has(a), div:has(a)",
    rootsSelector: "",
    ignoreSelector: "[data-testid='videoPlayer'], [data-testid^='tweetTextarea']",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: DEFAULT_SELECT_STYLE,
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "www.youtube.com/live_chat",
    selector: "span.yt-live-chat-text-message-renderer",
    keepSelector: "",
    rootsSelector: "div#items",
    ignoreSelector: "",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "www.youtube.com",
    selector: "",
    keepSelector: "",
    rootsSelector: "ytd-page-manager",
    ignoreSelector:
      "aside, button, footer, form, header, pre, mark, nav, #player, #container, .caption-window, .ytp-settings-menu, #kiss-youtube-subtitle-list-container",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: GLOBAL_RULE_KEY,
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: DEFAULT_SELECT_STYLE,
    parentStyle: DEFAULT_SELECT_STYLE,
    grandStyle: DEFAULT_SELECT_STYLE,
  },
  {
    pattern: "web.telegram.org",
    selector: ".text-content, .embedded-text-wrapper",
    keepSelector: "",
    rootsSelector: ".Transition",
    ignoreSelector: "",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "github.com",
    selector:
      "h1, h2, h3, h4, h5, h6, .markdown-body li, p, dd, blockquote, figcaption, label, legend, .user-profile-bio>div, [data-testid='results-list'] .search-match, .Subhead-description, [class^='prc-SelectPanel-Subtitle-'], [class^='prc-ActionList-ItemLabel-'], [role='dialog'] .overflow-auto, .h4, .repos-list-description, .discussion-title, [class*='PinnedIssue-module__Link'] span, .js-wiki-sidebar-page-container :is(.Truncate-text, .Link--primary)",
    keepSelector: "",
    rootsSelector: "main, [role='main'], body",
    ignoreSelector:
      "button, p.pinned-item-desc+p, header, nav, .AppHeader, .UnderlineNav, .tabnav, .pagehead-actions, .BtnGroup, .Button, .btn, .subnav, .SelectMenu, .ActionList, table[aria-labelledby='folders-and-files'] tr, .react-directory-row, .react-directory-filename-column, .react-directory-row-commit-cell, .react-directory-commit-age, .LatestCommit-module__Box__B25ZT",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "archiveofourown.org",
    selector:
      "h1, h2, h3, h4, h5, h6, dt, dd:not(.series), p, blockquote, li:not(:has(> span.series)), .userstuff p, .summary blockquote, .meta dt, .meta dd, dd.series > span.series, #series li > span.series",
    keepSelector: "a:has(code), code, pre, .divider",
    richHtmlExcludeSelector: "dd.series > span.series, #series li > span.series",
    rootsSelector: "#main, .wrapper",
    ignoreSelector:
      "button, nav, header, footer, .landmark, .actions, .navigation, .share, .download",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "reddit.com",
    selector: [
      "main h1",
      "shreddit-post a[slot='title']",
      "shreddit-post [slot='title']",
      "shreddit-post h1",
      "shreddit-post [slot='text-body']",
      "shreddit-post [slot='text-body'] p",
      "shreddit-comment [slot='comment']",
      "shreddit-comment [slot='comment'] p",
      "shreddit-comment [slot='comment'] li",
      "shreddit-comment [slot='comment'] blockquote",
      "a[slot='title'][href*='/comments/']",
      "[data-testid='post-title']",
      "[data-testid='post-content']",
    ].join(", "),
    keepSelector: "code, pre",
    rootsSelector: "main, shreddit-app, body",
    ignoreSelector:
      "button, nav, header, aside, faceplate-number, [slot='share-button'], [slot='comment-cta'], [slot='credit-bar'], [aria-label*='vote'], [data-testid='comment-submission-form-toolbar']",
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: "false",
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
  {
    pattern: "quora.com",
    selector: GLOBAL_RULE_KEY,
    keepSelector: GLOBAL_RULE_KEY,
    rootsSelector: QUORA_ROOTS_SELECTOR,
    ignoreSelector: QUORA_IGNORE_SELECTOR,
    fromLang: GLOBAL_RULE_KEY,
    toLang: GLOBAL_RULE_KEY,
    transOpen: GLOBAL_RULE_KEY,
    transOnly: GLOBAL_RULE_KEY,
    autoScan: GLOBAL_RULE_KEY,
    hasRichText: GLOBAL_RULE_KEY,
    hasShadowroot: GLOBAL_RULE_KEY,
    scanAll: GLOBAL_RULE_KEY,
    transTag: GLOBAL_RULE_KEY,
    transTitle: GLOBAL_RULE_KEY,
    splitParagraph: GLOBAL_RULE_KEY,
    splitLength: 0,
    textExtStyle: "",
    selectStyle: "",
    parentStyle: "",
    grandStyle: "",
  },
];

export function normalizeFullPageRules(raw: unknown): FullPageRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: FullPageRule[] = [];
  const patterns = new Set<string>();
  for (const value of raw) {
    const rule = normalizeFullPageRule(value);
    if (!rule) continue;
    const pattern = rule.pattern.trim();
    if (!pattern || patterns.has(pattern)) continue;
    patterns.add(pattern);
    rules.push(rule);
  }
  return rules;
}

export function matchFullPageRule(url: string, rules: FullPageRule[]): FullPageRule {
  const userGlobal = rules.find((rule) => rule.pattern.trim() === GLOBAL_RULE_KEY);
  const matchedBuiltins = findMatchingRules(BUILTIN_FULL_PAGE_RULES, url);
  const matchedUsers = findMatchingRules(
    rules.filter((rule) => rule.pattern.trim() !== GLOBAL_RULE_KEY),
    url,
  );

  let merged = { ...DEFAULT_FULL_PAGE_RULE };
  for (const rule of matchedBuiltins) merged = mergeRules(merged, rule);
  merged = mergeRules(merged, userGlobal);
  for (const rule of matchedUsers) merged = mergeRules(merged, rule);
  return merged;
}

export function resolveFullPageRule(
  rule: FullPageRule,
  input: PageTranslateCommand,
): ResolvedFullPageRule {
  const target = input.target || normalizeLangValue(rule.toLang) || "zh";
  const engine = input.engine;
  const mode = input.mode ?? "replace";
  const transOnly = mode === "replace" ? true : toggleValue(rule.transOnly, false);
  return {
    pattern: rule.pattern,
    selector: rule.selector.trim() || DEFAULT_FULL_PAGE_RULE.selector,
    keepSelector: rule.keepSelector.trim() || DEFAULT_FULL_PAGE_RULE.keepSelector,
    rootsSelector: rule.rootsSelector.trim() || DEFAULT_FULL_PAGE_RULE.rootsSelector,
    ignoreSelector: rule.ignoreSelector.trim() || DEFAULT_FULL_PAGE_RULE.ignoreSelector,
    richHtmlSelector: rule.richHtmlSelector?.trim() ?? "",
    richHtmlExcludeSelector: rule.richHtmlExcludeSelector?.trim() ?? "",
    engine,
    source: normalizeSourceLang(rule.fromLang),
    target,
    transOnly,
    autoScan: toggleValue(rule.autoScan, true),
    hasRichText: toggleValue(rule.hasRichText, true),
    hasShadowroot: toggleValue(rule.hasShadowroot, false),
    scanAll: toggleValue(rule.scanAll, false),
    transTag: rule.transTag === "span" ? "span" : "font",
    transTitle: toggleValue(rule.transTitle, false),
    textExtStyle: rule.textExtStyle.trim(),
    selectStyle: rule.selectStyle.trim(),
    parentStyle: rule.parentStyle.trim(),
    grandStyle: rule.grandStyle.trim(),
  };
}

function normalizeFullPageRule(raw: unknown): FullPageRule | null {
  if (!isObject(raw)) return null;
  return {
    pattern: stringValue(raw.pattern),
    selector: stringValue(raw.selector),
    keepSelector: stringValue(raw.keepSelector),
    rootsSelector: stringValue(raw.rootsSelector),
    ignoreSelector: stringValue(raw.ignoreSelector),
    richHtmlSelector: stringValue(raw.richHtmlSelector),
    richHtmlExcludeSelector: stringValue(raw.richHtmlExcludeSelector),
    fromLang: stringValue(raw.fromLang, GLOBAL_RULE_KEY),
    toLang: stringValue(raw.toLang, GLOBAL_RULE_KEY),
    transOpen: toggleField(raw.transOpen),
    transOnly: toggleField(raw.transOnly),
    autoScan: toggleField(raw.autoScan),
    hasRichText: toggleField(raw.hasRichText),
    hasShadowroot: toggleField(raw.hasShadowroot),
    scanAll: toggleField(raw.scanAll),
    transTag: tagField(raw.transTag),
    transTitle: toggleField(raw.transTitle),
    splitParagraph: splitField(raw.splitParagraph),
    splitLength: numberField(raw.splitLength),
    textExtStyle: stringValue(raw.textExtStyle),
    selectStyle: stringValue(raw.selectStyle),
    parentStyle: stringValue(raw.parentStyle),
    grandStyle: stringValue(raw.grandStyle),
  };
}

function findMatchingRules(rules: FullPageRule[], url: string): FullPageRule[] {
  const matches: Array<{ rule: FullPageRule; score: number; index: number }> = [];
  rules.forEach((rule, index) => {
    const pattern = rule.pattern.trim();
    if (!pattern || pattern === GLOBAL_RULE_KEY) return;
    const score = pattern
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce((max, item) => wildcardIncludes(url, item) ? Math.max(max, item.length) : max, 0);
    if (score > 0) matches.push({ rule, score, index });
  });
  return matches
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((match) => match.rule);
}

function mergeRules(baseRule: FullPageRule, overrideRule: FullPageRule | undefined): FullPageRule {
  if (!overrideRule) return { ...baseRule };
  const merged = { ...baseRule };

  merged.selector = mergeSelectors(baseRule.selector, overrideRule.selector);
  merged.keepSelector = mergeSelectors(baseRule.keepSelector, overrideRule.keepSelector);
  merged.rootsSelector = mergeSelectors(baseRule.rootsSelector, overrideRule.rootsSelector);
  merged.ignoreSelector = mergeSelectors(baseRule.ignoreSelector, overrideRule.ignoreSelector);
  merged.richHtmlSelector = mergeSelectors(
    baseRule.richHtmlSelector ?? "",
    overrideRule.richHtmlSelector ?? "",
  );
  merged.richHtmlExcludeSelector = mergeSelectors(
    baseRule.richHtmlExcludeSelector ?? "",
    overrideRule.richHtmlExcludeSelector ?? "",
  );

  if (overrideRule.fromLang !== GLOBAL_RULE_KEY) merged.fromLang = overrideRule.fromLang;
  if (overrideRule.toLang !== GLOBAL_RULE_KEY) merged.toLang = overrideRule.toLang;
  if (overrideRule.transOpen !== GLOBAL_RULE_KEY) merged.transOpen = overrideRule.transOpen;
  if (overrideRule.transOnly !== GLOBAL_RULE_KEY) merged.transOnly = overrideRule.transOnly;
  if (overrideRule.autoScan !== GLOBAL_RULE_KEY) merged.autoScan = overrideRule.autoScan;
  if (overrideRule.hasRichText !== GLOBAL_RULE_KEY) merged.hasRichText = overrideRule.hasRichText;
  if (overrideRule.hasShadowroot !== GLOBAL_RULE_KEY) {
    merged.hasShadowroot = overrideRule.hasShadowroot;
  }
  if (overrideRule.scanAll !== GLOBAL_RULE_KEY) merged.scanAll = overrideRule.scanAll;
  if (overrideRule.transTag !== GLOBAL_RULE_KEY) merged.transTag = overrideRule.transTag;
  if (overrideRule.transTitle !== GLOBAL_RULE_KEY) merged.transTitle = overrideRule.transTitle;
  if (overrideRule.splitParagraph !== GLOBAL_RULE_KEY) {
    merged.splitParagraph = overrideRule.splitParagraph;
  }
  if (overrideRule.splitLength > 0) merged.splitLength = overrideRule.splitLength;

  if (overrideRule.textExtStyle.trim()) merged.textExtStyle = overrideRule.textExtStyle.trim();
  if (overrideRule.selectStyle.trim()) merged.selectStyle = overrideRule.selectStyle.trim();
  if (overrideRule.parentStyle.trim()) merged.parentStyle = overrideRule.parentStyle.trim();
  if (overrideRule.grandStyle.trim()) merged.grandStyle = overrideRule.grandStyle.trim();
  if (overrideRule.pattern.trim()) merged.pattern = overrideRule.pattern.trim();

  return merged;
}

function mergeSelectors(defaultValue: string, overrideValue: string): string {
  const override = overrideValue.trim();
  if (!override) return defaultValue;

  const base = splitSelectorList(defaultValue);
  const patch = splitSelectorList(override);
  const patchMode = patch.some((item) => item.startsWith("+") || item.startsWith("-"));
  if (!patchMode) {
    return Array.from(new Set(patch)).join(", ");
  }

  const finalSet = new Set(base);
  let mode: "add" | "remove" = "add";
  for (const item of patch) {
    let selector = item;
    if (item.startsWith("+")) {
      mode = "add";
      selector = item.slice(1).trim();
    } else if (item.startsWith("-")) {
      mode = "remove";
      selector = item.slice(1).trim();
    }
    if (!selector) continue;
    if (mode === "remove") {
      finalSet.delete(selector);
    } else {
      finalSet.add(selector);
    }
  }
  return Array.from(finalSet).join(", ");
}

function splitSelectorList(value: string): string[] {
  const items: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      items.push(value.slice(start, i));
      start = i + 1;
    }
  }
  items.push(value.slice(start));
  return items.map((item) => item.trim()).filter(Boolean);
}

function wildcardIncludes(source: string, pattern: string): boolean {
  if (!source || !pattern) return false;
  const wrappedPattern = `*${pattern}*`;
  let sIndex = 0;
  let pIndex = 0;
  let sRecord = -1;
  let pRecord = -1;
  while (sIndex < source.length && pRecord < wrappedPattern.length) {
    if (wrappedPattern[pIndex] === "*") {
      pIndex += 1;
      sRecord = sIndex;
      pRecord = pIndex;
    } else if (source[sIndex] === wrappedPattern[pIndex]) {
      sIndex += 1;
      pIndex += 1;
    } else if (sRecord + 1 < source.length) {
      sRecord += 1;
      sIndex = sRecord;
      pIndex = pRecord;
    } else {
      return false;
    }
  }
  if (wrappedPattern.length === pIndex) return true;
  for (let i = pIndex; i < wrappedPattern.length; i += 1) {
    if (wrappedPattern[i] !== "*") return false;
  }
  return true;
}

function toggleField(value: unknown): RuleToggle {
  return value === "true" || value === "false" ? value : GLOBAL_RULE_KEY;
}

function tagField(value: unknown): RuleTag {
  return value === "span" || value === "font" ? value : GLOBAL_RULE_KEY;
}

function splitField(value: unknown): SplitParagraphMode {
  return value === SPLIT_PARAGRAPH_DISABLE ||
    value === SPLIT_PARAGRAPH_PUNCTUATION ||
    value === SPLIT_PARAGRAPH_TEXTLENGTH
    ? value
    : GLOBAL_RULE_KEY;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toggleValue(value: RuleToggle, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeLangValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === GLOBAL_RULE_KEY) return undefined;
  return trimmed;
}

function normalizeSourceLang(value: string): string | undefined {
  const lang = normalizeLangValue(value);
  if (!lang || lang === "auto") return undefined;
  return lang;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
