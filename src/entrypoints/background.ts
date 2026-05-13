import { onMessage, sendTabMessage } from "@/lib/messaging";
import { DEFAULT_ENGINE_ID, getEngine } from "@/engines/registry";
import {
  peekTranslateMemoryCache,
  translateCached,
  translateCachedBatch,
} from "@/lib/cache/translate";

export default defineBackground(() => {
  console.log("[OneLingo] background ready");

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
});
