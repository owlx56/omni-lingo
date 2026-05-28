import { onMessage, sendTabMessage, sendMessage } from "@/lib/messaging";
import { DEFAULT_ENGINE_ID, getEngine } from "@/engines/registry";
import {
  peekTranslateMemoryCache,
  translateCached,
  translateCachedBatch,
} from "@/lib/cache/translate";
import {
  getSettings,
  watchSettings,
  type Settings,
} from "@/lib/storage/settings";
import { browser, type Browser } from "wxt/browser";
import type { UiLang } from "@/lib/languages";
import {
  documentViewerUrlForUrl,
  isPdfViewerUrl,
  isReaderShellUrl,
  pdfViewerUrlForSniff,
  readerShellUrlForSniff,
  type ViewerFormat,
} from "@/lib/document-viewer-urls";

const OPEN_LINK_IN_VIEWER_MENU = "onelingo-open-link-in-viewer";
const OPEN_PAGE_IN_VIEWER_MENU = "onelingo-open-page-in-viewer";
const OPEN_IN_VIEWER_TITLE = "Open in OneLingo Reader";
const DOCUMENT_URL_RE = /\.(?:pdf|epub)(?:$|[?#])/i;
const SNIFFED_DOCUMENT_STORAGE_PREFIX = "onelingo:sniffed-document:";
const DOCUMENT_SNIFF_RULE_IDS = [42001, 42002, 42003, 42004, 42005, 42006];
const DOCUMENT_SNIFF_BYPASS_RULE_ID_START = 42100;
const DOCUMENT_SNIFF_BYPASS_RULE_ID_COUNT = 32;
const HTTP_PDF_URL_REGEX = "^https?://.*\\.[Pp][Dd][Ff](?:$|[?#].*)?";
const HTTP_EPUB_URL_REGEX = "^https?://.*\\.[Ee][Pp][Uu][Bb](?:$|[?#].*)?";
const DOCUMENT_RESPONSE_TYPES = new Set([
  "application/pdf",
  "application/epub+zip",
  "application/x-pdf",
]);

interface DocumentSniffState {
  enabled: boolean;
  dnrEnabled: boolean;
  keepOriginal: boolean;
  standalone: boolean;
  uiLang: UiLang;
  openedKeys: Set<string>;
  pendingOpens: Map<number, PendingDocumentOpen>;
  nextBypassRuleId: number;
  redirectingTabs: Set<number>;
  rulesSync: Promise<void>;
}

interface PendingDocumentOpen {
  createdAt: number;
  url: string;
}

export default defineBackground(() => {
  console.log("[OneLingo] background ready");
  const documentSniffer = initDocumentLinkSniffer();
  void clearDocumentBypassRules().catch((err: unknown) => {
    console.warn("[OneLingo] failed to clear document sniff bypass rules:", err);
  });
  void initDocumentViewerMenus().catch((err: unknown) => {
    console.warn("[OneLingo] failed to initialize reader context menus:", err);
  });

  onMessage("ping", (input) => ({ echo: input.text, at: Date.now() }));

  onMessage("translate", async ({ engine, ...req }) => {
    const id = engine ?? DEFAULT_ENGINE_ID;
    const e = getEngine(id);
    return translateCached(id, req, () => e.translate(req));
  });

  onMessage("peekTranslateMemoryCache", ({ engine, ...req }) => {
    const id = engine ?? DEFAULT_ENGINE_ID;
    return peekTranslateMemoryCache(id, req) ?? null;
  });

  onMessage(
    "translateBatch",
    async ({ engine, source, target, texts, format }) => {
      const id = engine ?? DEFAULT_ENGINE_ID;
      const e = getEngine(id);
      return translateCachedBatch(
        id,
        texts.map((text) => ({ text, target, source, format })),
        (req) => e.translate(req),
        e.translateBatch?.bind(e),
      );
    },
  );

  onMessage("translatePage", async (input) => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有可翻译的活动标签页");
    }
    return sendTabMessage(tab.id, "runPageTranslate", input);
  });

  onMessage("restorePage", async (input) => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有可还原的活动标签页");
    }
    return sendTabMessage(tab.id, "runPageRestore", input);
  });

  onMessage("getPageTranslateStatus", async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有活动标签页");
    }
    return sendTabMessage(tab.id, "readPageTranslateStatus", {});
  });

  onMessage("setPageTranslatePrefs", async (input) => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有活动标签页");
    }
    return sendTabMessage(tab.id, "updatePageTranslatePrefs", input);
  });

  onMessage("getPageFeatureStatus", async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有活动标签页");
    }
    try {
      return await sendTabMessage(tab.id, "readPageFeatureStatus", {});
    } catch {
      if (tab.url?.startsWith(browser.runtime.getURL("/"))) {
        return await sendMessage("readPageFeatureStatus", {});
      }
      throw new Error("当前页面不支持功能偏好设置");
    }
  });

  onMessage("setPageFeaturePrefs", async (input) => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有活动标签页");
    }
    try {
      return await sendTabMessage(tab.id, "updatePageFeaturePrefs", input);
    } catch {
      if (tab.url?.startsWith(browser.runtime.getURL("/"))) {
        return await sendMessage("updatePageFeaturePrefs", input);
      }
      throw new Error("当前页面不支持功能偏好设置");
    }
  });

  onMessage("openDocumentLink", async ({
    keepOriginal,
    sourceTabId,
    standalone,
    url,
  }) => {
    if (!isDocumentUrl(url)) return { opened: false };
    await openDocumentViewer(url, {
      keepOriginal: keepOriginal ?? documentSniffer.keepOriginal,
      standalone: standalone ?? documentSniffer.standalone,
      sourceTabId,
      state: documentSniffer,
    });
    return { opened: true };
  });

  onMessage("consumeSniffedDocument", async (_input, sender) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return null;
    const pending = await consumeSniffedDocumentOpen(documentSniffer, tabId);
    if (!pending) return null;
    if (
      (documentSniffer.keepOriginal || documentSniffer.standalone) &&
      sender.tab?.active === false
    ) {
      return null;
    }
    if (documentSniffer.keepOriginal) {
      await openDocumentViewer(pending.url, {
        active: false,
        format: sniffedFormatFromSender(sender),
        keepOriginal: true,
        standalone: documentSniffer.standalone,
        state: documentSniffer,
      });
      await installTemporaryDocumentBypassRule(documentSniffer, pending.url, tabId);
      return { action: "bypass", url: pending.url };
    }
    if (documentSniffer.standalone) {
      await openDocumentViewer(pending.url, {
        format: sniffedFormatFromSender(sender),
        standalone: true,
        state: documentSniffer,
      });
      await browser.tabs.remove(tabId);
      return { action: "handled" };
    }
    return { action: "open", url: pending.url };
  });
});

function initDocumentLinkSniffer(): DocumentSniffState {
  const state: DocumentSniffState = {
    dnrEnabled: false,
    enabled: false,
    keepOriginal: false,
    standalone: false,
    uiLang: "zh-Hans",
    openedKeys: new Set(),
    pendingOpens: new Map(),
    nextBypassRuleId: DOCUMENT_SNIFF_BYPASS_RULE_ID_START,
    redirectingTabs: new Set(),
    rulesSync: Promise.resolve(),
  };

  const apply = (settings: Settings): void => {
    state.enabled = settings.documentLinkSniffEnabled;
    state.keepOriginal = settings.documentLinkSniffKeepOriginal;
    state.standalone = settings.documentLinkSniffStandalone;
    state.uiLang = settings.uiLang;
    queueDocumentSniffRulesUpdate(state);
  };

  void getSettings().then(apply).catch((err: unknown) => {
    console.warn("[OneLingo] failed to read document sniffer settings:", err);
  });
  try {
    watchSettings(apply);
  } catch (err: unknown) {
    console.warn("[OneLingo] failed to watch document sniffer settings:", err);
  }

  browser.tabs?.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url ?? tab.url;
    if (
      !state.enabled ||
      !url ||
      !isFileUrl(url) ||
      !isDocumentUrl(url) ||
      isExtensionViewerUrl(url)
    ) {
      return;
    }
    void openSniffedDocument(tabId, url, state).catch((err: unknown) => {
      console.warn("[OneLingo] failed to sniff document navigation:", err);
    });
  });

  browser.webRequest?.onBeforeRequest.addListener(
    (details) => {
      if (
        !state.enabled ||
        !state.dnrEnabled ||
        details.tabId < 0 ||
        !isDocumentUrl(details.url)
      ) {
        return undefined;
      }
      rememberSniffedDocumentOpen(state, details.tabId, details.url);
      return undefined;
    },
    {
      types: ["main_frame"],
      urls: ["http://*/*", "https://*/*"],
    },
  );

  browser.webRequest?.onHeadersReceived.addListener(
    (details) => {
      if (
        !state.enabled ||
        details.tabId < 0 ||
        !isDocumentResponse(details.url, details.responseHeaders)
      ) {
        return undefined;
      }
      rememberSniffedDocumentOpen(state, details.tabId, details.url);
      return undefined;
    },
    {
      types: ["main_frame"],
      urls: ["http://*/*", "https://*/*"],
    },
    ["responseHeaders"],
  );

  return state;
}

function queueDocumentSniffRulesUpdate(state: DocumentSniffState): void {
  state.rulesSync = state.rulesSync
    .then(() => syncDocumentSniffRules(state))
    .catch((err: unknown) => {
      state.dnrEnabled = false;
      console.warn("[OneLingo] failed to update document sniff rules:", err);
    });
}

async function syncDocumentSniffRules(state: DocumentSniffState): Promise<void> {
  const api = browser.declarativeNetRequest;
  if (!api?.updateDynamicRules) {
    state.dnrEnabled = false;
    return;
  }

  const shouldInstall = state.enabled;
  await api.updateDynamicRules({
    removeRuleIds: DOCUMENT_SNIFF_RULE_IDS,
    addRules: shouldInstall ? createDocumentSniffRules() : undefined,
  });
  state.dnrEnabled = shouldInstall;
}

function createDocumentSniffRules(): Browser.declarativeNetRequest.Rule[] {
  const pdfRedirect = { url: pdfViewerUrlForSniff() };
  const readerRedirect = { url: readerShellUrlForSniff() };
  const resourceTypes: Array<`${Browser.declarativeNetRequest.ResourceType}`> = [
    "main_frame",
  ];
  return [
    {
      id: DOCUMENT_SNIFF_RULE_IDS[0]!,
      priority: 1,
      action: { type: "redirect", redirect: pdfRedirect },
      condition: {
        regexFilter: HTTP_PDF_URL_REGEX,
        resourceTypes,
      },
    },
    {
      id: DOCUMENT_SNIFF_RULE_IDS[1]!,
      priority: 1,
      action: { type: "redirect", redirect: pdfRedirect },
      condition: {
        regexFilter: "^https?://.*",
        resourceTypes,
        responseHeaders: [{ header: "content-type", values: ["*pdf*"] }],
      },
    },
    {
      id: DOCUMENT_SNIFF_RULE_IDS[2]!,
      priority: 1,
      action: { type: "redirect", redirect: readerRedirect },
      condition: {
        regexFilter: HTTP_EPUB_URL_REGEX,
        resourceTypes,
      },
    },
    {
      id: DOCUMENT_SNIFF_RULE_IDS[3]!,
      priority: 1,
      action: { type: "redirect", redirect: readerRedirect },
      condition: {
        regexFilter: "^https?://.*",
        resourceTypes,
        responseHeaders: [{ header: "content-type", values: ["*epub*"] }],
      },
    },
    {
      id: DOCUMENT_SNIFF_RULE_IDS[4]!,
      priority: 1,
      action: { type: "redirect", redirect: pdfRedirect },
      condition: {
        regexFilter: HTTP_PDF_URL_REGEX,
        resourceTypes,
        responseHeaders: [
          { header: "content-type", values: ["application/octet-stream*"] },
        ],
      },
    },
    {
      id: DOCUMENT_SNIFF_RULE_IDS[5]!,
      priority: 1,
      action: { type: "redirect", redirect: readerRedirect },
      condition: {
        regexFilter: HTTP_EPUB_URL_REGEX,
        resourceTypes,
        responseHeaders: [
          { header: "content-type", values: ["application/octet-stream*"] },
        ],
      },
    },
  ];
}

function rememberSniffedDocumentOpen(
  state: DocumentSniffState,
  tabId: number,
  url: string,
): void {
  const entry = {
    createdAt: Date.now(),
    url,
  };
  state.pendingOpens.set(tabId, entry);
  void browser.storage.session
    .set({ [sniffedDocumentStorageKey(tabId)]: entry })
    .catch((err: unknown) => {
      console.warn("[OneLingo] failed to store sniffed document URL:", err);
    });
  if (state.pendingOpens.size > 100) {
    const cutoff = Date.now() - 30_000;
    for (const [key, entry] of state.pendingOpens) {
      if (entry.createdAt < cutoff) state.pendingOpens.delete(key);
    }
  }
}

async function installTemporaryDocumentBypassRule(
  state: DocumentSniffState,
  url: string,
  tabId: number,
): Promise<void> {
  const api = browser.declarativeNetRequest;
  if (!api?.updateSessionRules) return;

  const ruleId = allocateBypassRuleId(state);
  await api.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [
      {
        id: ruleId,
        priority: 100,
        action: { type: "allow" },
        condition: {
          regexFilter: createExactUrlRegexFilter(url),
          resourceTypes: ["main_frame"],
          tabIds: [tabId],
        },
      },
    ],
  });

  setTimeout(() => {
    void browser.declarativeNetRequest
      ?.updateSessionRules({ removeRuleIds: [ruleId] })
      .catch(() => {});
  }, 10_000);
}

async function clearDocumentBypassRules(): Promise<void> {
  const api = browser.declarativeNetRequest;
  if (!api?.updateSessionRules) return;

  await api.updateSessionRules({
    removeRuleIds: Array.from(
      { length: DOCUMENT_SNIFF_BYPASS_RULE_ID_COUNT },
      (_, index) => DOCUMENT_SNIFF_BYPASS_RULE_ID_START + index,
    ),
  });
}

function allocateBypassRuleId(state: DocumentSniffState): number {
  const ruleId = state.nextBypassRuleId;
  state.nextBypassRuleId += 1;
  if (
    state.nextBypassRuleId >=
    DOCUMENT_SNIFF_BYPASS_RULE_ID_START + DOCUMENT_SNIFF_BYPASS_RULE_ID_COUNT
  ) {
    state.nextBypassRuleId = DOCUMENT_SNIFF_BYPASS_RULE_ID_START;
  }
  return ruleId;
}

function createExactUrlRegexFilter(url: string): string {
  return `^${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

async function consumeSniffedDocumentOpen(
  state: DocumentSniffState,
  tabId: number,
): Promise<PendingDocumentOpen | null> {
  const key = sniffedDocumentStorageKey(tabId);
  const memoryEntry = state.pendingOpens.get(tabId);
  state.pendingOpens.delete(tabId);
  const pending =
    memoryEntry ?? (await readStoredSniffedDocumentOpen(key).catch(() => null));
  void browser.storage.session.remove(key).catch(() => {});
  if (!pending || Date.now() - pending.createdAt > 30_000) return null;
  return pending;
}

async function readStoredSniffedDocumentOpen(
  key: string,
): Promise<PendingDocumentOpen | null> {
  const stored = await browser.storage.session.get<Record<string, unknown>>(key);
  const raw = stored[key];
  if (!isPendingDocumentOpen(raw)) return null;
  return raw;
}

function isPendingDocumentOpen(raw: unknown): raw is PendingDocumentOpen {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { createdAt?: unknown }).createdAt === "number" &&
    typeof (raw as { url?: unknown }).url === "string"
  );
}

function sniffedDocumentStorageKey(tabId: number): string {
  return `${SNIFFED_DOCUMENT_STORAGE_PREFIX}${tabId}`;
}

async function openSniffedDocument(
  tabId: number,
  url: string,
  state: DocumentSniffState,
): Promise<void> {
  if (state.redirectingTabs.has(tabId)) return;
  if (isFileUrl(url) && !(await isFileSchemeAccessAllowed())) return;

  const key = `${tabId}:${url}`;
  if (state.openedKeys.has(key)) return;
  state.openedKeys.add(key);
  if (state.openedKeys.size > 200) state.openedKeys.clear();

  await openDocumentViewer(url, {
    active: state.keepOriginal ? false : undefined,
    keepOriginal: state.keepOriginal,
    standalone: state.standalone,
    sourceTabId: tabId,
    state,
  });
}

async function initDocumentViewerMenus(): Promise<void> {
  if (!browser.contextMenus) return;

  await removeContextMenu(OPEN_LINK_IN_VIEWER_MENU);
  await removeContextMenu(OPEN_PAGE_IN_VIEWER_MENU);
  browser.contextMenus.create({
    contexts: ["link"],
    id: OPEN_LINK_IN_VIEWER_MENU,
    title: OPEN_IN_VIEWER_TITLE,
  });
  browser.contextMenus.create({
    contexts: ["page"],
    id: OPEN_PAGE_IN_VIEWER_MENU,
    title: OPEN_IN_VIEWER_TITLE,
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (
      info.menuItemId !== OPEN_LINK_IN_VIEWER_MENU &&
      info.menuItemId !== OPEN_PAGE_IN_VIEWER_MENU
    ) {
      return;
    }
    const url = info.linkUrl ?? info.pageUrl;
    if (url) void openDocumentViewer(url);
  });
}

async function removeContextMenu(id: string): Promise<void> {
  try {
    await browser.contextMenus.remove(id);
  } catch {
    // Missing menus are fine after service worker restarts.
  }
}

async function openDocumentViewer(
  url: string,
  options: {
    active?: boolean;
    format?: ViewerFormat;
    keepOriginal?: boolean;
    standalone?: boolean;
    sourceTabId?: number;
    state?: DocumentSniffState;
  } = {},
): Promise<unknown> {
  const uiLang =
    options.state?.uiLang ??
    (await getSettings()
      .then((settings) => settings.uiLang)
      .catch(() => undefined));
  const viewerUrl = viewerUrlForDocument(
    url,
    options.format ?? "auto",
    uiLang,
  );
  if (options.standalone) {
    const opened = browser.windows.create({
      focused: true,
      type: "popup",
      url: viewerUrl,
    });
    if (!options.keepOriginal && typeof options.sourceTabId === "number") {
      return opened.then(() => browser.tabs.remove(options.sourceTabId!));
    }
    return opened;
  }
  if (options.keepOriginal) {
    return browser.tabs.create({ active: options.active, url: viewerUrl });
  }
  if (typeof options.sourceTabId === "number") {
    options.state?.redirectingTabs.add(options.sourceTabId);
    return browser.tabs
      .update(options.sourceTabId, { url: viewerUrl })
      .finally(() => {
        setTimeout(() => {
          options.state?.redirectingTabs.delete(options.sourceTabId!);
        }, 1000);
      });
  }
  return browser.tabs.create({ url: viewerUrl });
}

function viewerUrlForDocument(
  url: string,
  format: ViewerFormat,
  uiLang: UiLang | undefined,
): string {
  return documentViewerUrlForUrl(url, format, uiLang);
}

function isDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" ||
        parsed.protocol === "https:" ||
        parsed.protocol === "file:") &&
      DOCUMENT_URL_RE.test(parsed.pathname + parsed.search + parsed.hash)
    );
  } catch {
    return false;
  }
}

function isFileUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "file:";
  } catch {
    return false;
  }
}

async function isFileSchemeAccessAllowed(): Promise<boolean> {
  try {
    return await browser.extension.isAllowedFileSchemeAccess();
  } catch {
    return false;
  }
}

function isDocumentResponse(
  url: string,
  responseHeaders:
    | Array<{ name: string; value?: string }>
    | undefined,
): boolean {
  if (!responseHeaders) return false;
  const contentType = responseHeaders
    .find((header) => header.name.toLowerCase() === "content-type")
    ?.value?.split(";")[0]
    ?.trim()
    .toLowerCase();

  if (!contentType) return false;
  if (DOCUMENT_RESPONSE_TYPES.has(contentType)) return true;
  return contentType === "application/octet-stream" && isDocumentUrl(url);
}

function isExtensionViewerUrl(url: string): boolean {
  return isReaderShellUrl(url) || isPdfViewerUrl(url);
}

function sniffedFormatFromSender(
  sender: Browser.runtime.MessageSender,
): ViewerFormat {
  const url = sender.url ?? sender.tab?.url ?? "";
  return isPdfViewerUrl(url) ? "pdf" : "auto";
}
