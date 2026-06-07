export type TabId =
  | "account"
  | "hover"
  | "selection"
  | "immersive"
  | "fileplus"
  | "about";

const OPTION_TAB_IDS = new Set<TabId>([
  "account",
  "hover",
  "selection",
  "immersive",
  "fileplus",
  "about",
]);

export function normalizeOptionsTabId(value: string | null): TabId {
  return OPTION_TAB_IDS.has(value as TabId) ? (value as TabId) : "account";
}

export function optionsUrlForTab(baseUrl: string, tab: TabId): string {
  const url = new URL(baseUrl);
  url.searchParams.set("tab", tab);
  return url.href;
}
