const GITHUB_CONTENT_TEXT_SELECTOR = [
  ".markdown-title",
  "a.Link--primary.h4[href*='/security/advisories/']",
].join(",");

const GITHUB_PULSE_CONTENT_TEXT_SELECTOR = [
  "a.Link--primary[href*='/pull/']",
  "a.Link--primary[href*='/issues/']",
  ".TimelineItem-body a[href*='/pull/']",
  ".TimelineItem-body a[href*='/issues/']",
].join(",");

const GITHUB_UI_SELECTOR = [
  "header", "nav", "form", "button", "[role='button']",
  "[role='banner']", "[role='navigation']", "[role='menu']",
  "[role='tablist']", "[role='toolbar']",
  ".AppHeader", ".HeaderMenu", ".UnderlineNav", ".tabnav",
  ".pagehead", ".pagehead-actions", ".BtnGroup", ".Button", ".btn",
  ".subnav", ".SelectMenu", ".ActionList", ".filter-item",
  "table[aria-labelledby='folders-and-files'] tr",
  ".react-directory-row", ".react-directory-filename-column",
  ".react-directory-row-commit-cell", ".react-directory-commit-age",
  ".LatestCommit-module__Box__B25ZT",
].join(",");

const INLINE_UI_CONTAINER_SELECTOR = [
  "nav", "header", "aside", "form", "dl", "dt", "dd",
  "[role='banner']", "[role='navigation']", "[role='complementary']",
  "[role='menu']", "[role='tablist']", "[role='toolbar']",
  "#header", ".AppHeader", ".HeaderMenu", ".UnderlineNav", ".tabnav",
  ".meta", ".tags", ".actions", ".pagehead", ".pagehead-actions",
  ".BtnGroup", ".Button", ".btn",
  ".vector-toc", ".vector-appearance", ".vector-page-tools",
].join(",");

const WIKIPEDIA_UI_TEXT_SELECTOR = [
  ".vector-pinnable-header-label",
  ".vector-menu-heading",
  ".vector-dropdown-label-text",
  ".vector-appearance legend",
  ".vector-appearance .cdx-label__label",
  ".vector-appearance .cdx-field__label",
  ".vector-toc-text",
  ".vector-toc-text > span:not(.vector-toc-numb)",
].join(",");

const REDDIT_CONTENT_TEXT_SELECTOR = [
  "shreddit-post a[slot='title']",
  "shreddit-post [slot='text-body']",
  "shreddit-post [slot='text-body'] p",
  "a[slot='title'][href*='/comments/']",
  "[data-testid='post-title']",
  "[data-testid='post-content']",
].join(",");

export function isCompactUiBlockCandidate(el: HTMLElement): boolean {
  return !!el.closest(INLINE_UI_CONTAINER_SELECTOR);
}

export function isGithubContentText(el: HTMLElement): boolean {
  if (el.matches(GITHUB_CONTENT_TEXT_SELECTOR)) return true;
  return isGithubPulsePage() && el.matches(GITHUB_PULSE_CONTENT_TEXT_SELECTOR);
}

export function isGithubUiText(el: HTMLElement): boolean {
  return isGithubPage() && !isGithubContentText(el) && !!el.closest(GITHUB_UI_SELECTOR);
}

export function isWikipediaHatnote(el: HTMLElement): boolean {
  return isWikipediaPage() && el.matches(".hatnote");
}

export function isWikipediaCompactUiText(el: HTMLElement): boolean {
  return isWikipediaPage() && el.matches(WIKIPEDIA_UI_TEXT_SELECTOR);
}

export function isRedditContentText(el: HTMLElement): boolean {
  return isRedditPage() && el.matches(REDDIT_CONTENT_TEXT_SELECTOR);
}

export function shouldSkipSiteElement(el: HTMLElement): boolean {
  return isAo3Page() && el.matches(".landmark");
}

function isGithubPage(): boolean {
  return window.location.hostname === "github.com";
}

function isGithubPulsePage(): boolean {
  return isGithubPage() && window.location.pathname.endsWith("/pulse");
}

function isWikipediaPage(): boolean {
  return window.location.hostname.endsWith(".wikipedia.org");
}

function isAo3Page(): boolean {
  return window.location.hostname === "archiveofourown.org";
}

function isRedditPage(): boolean {
  return window.location.hostname === "reddit.com" || window.location.hostname.endsWith(".reddit.com");
}
