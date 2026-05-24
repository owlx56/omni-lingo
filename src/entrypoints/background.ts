import { onMessage, sendTabMessage } from "@/lib/messaging";
import { DEFAULT_ENGINE_ID, getEngine } from "@/engines/registry";
import {
  peekTranslateMemoryCache,
  translateCached,
  translateCachedBatch,
} from "@/lib/cache/translate";

const OPEN_LINK_IN_VIEWER_MENU = "onelingo-open-link-in-viewer";
const OPEN_PAGE_IN_VIEWER_MENU = "onelingo-open-page-in-viewer";
const OPEN_IN_VIEWER_TITLE = "Open in OneLingo Reader";

export default defineBackground(() => {
  console.log("[OneLingo] background ready");
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
    return sendTabMessage(tab.id, "readPageFeatureStatus", {});
  });

  onMessage("setPageFeaturePrefs", async (input) => {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") {
      throw new Error("当前没有活动标签页");
    }
    return sendTabMessage(tab.id, "updatePageFeaturePrefs", input);
  });
});

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

function openDocumentViewer(url: string): Promise<unknown> {
  const format = inferViewerFormat(url);
  if (format === "pdf") {
    return browser.tabs.create({
      url: browser.runtime.getURL(
        `/viewer.html?url=${encodeURIComponent(url)}&format=pdf`,
      ),
    });
  }
  return browser.tabs.create({
    url: browser.runtime.getURL(
      `/viewer.html?url=${encodeURIComponent(url)}&format=${format}`,
    ),
  });
}

function inferViewerFormat(url: string): "auto" | "pdf" | "epub" {
  const lower = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".epub")) return "epub";
  return "auto";
}
