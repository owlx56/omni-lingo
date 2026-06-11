import {
  onMessage,
  sendMessage,
  type PageFeatureStatus,
} from "@/lib/messaging";
import {
  getHoverEnabledStatus,
  initHover,
  updateHoverEnabledPref,
} from "@/features/hover";
import {
  getSelectionEnabledStatus,
  initSelection,
  updateSelectionEnabledPref,
} from "@/features/selection";
import {
  getFullPageClickToShowOriginalStatus,
  initFullPage,
  updateFullPageClickToShowOriginalPref,
} from "@/features/immersive";
import { initDocumentLinkSniffer } from "@/features/document-sniffer";

export default defineContentScript({
  matches: ["<all_urls>"],
  async main() {
    console.log("[Omni Lingo] content loaded:", location.href);
    try {
      const res = await sendMessage("ping", { text: "hello" });
      console.log("[Omni Lingo] ping ok:", res);
    } catch (e) {
      console.warn("[Omni Lingo] ping failed:", e);
    }
    initFullPage();
    initHover();
    initSelection();
    initDocumentLinkSniffer();

    const readFeatureStatus = (): PageFeatureStatus => ({
      ...getFullPageClickToShowOriginalStatus(),
      ...getHoverEnabledStatus(),
      ...getSelectionEnabledStatus(),
    });

    onMessage("readPageFeatureStatus", () => readFeatureStatus());
    onMessage("updatePageFeaturePrefs", (input) => {
      if (input.fullPageClickToShowOriginal !== undefined) {
        updateFullPageClickToShowOriginalPref(input.fullPageClickToShowOriginal);
      }
      if (input.hoverEnabled !== undefined) {
        updateHoverEnabledPref(input.hoverEnabled);
      }
      if (input.selectionEnabled !== undefined) {
        updateSelectionEnabledPref(input.selectionEnabled);
      }
      return readFeatureStatus();
    });
  },
});
