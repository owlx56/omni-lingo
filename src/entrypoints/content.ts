import { sendMessage } from "@/lib/messaging";
import { initHover } from "@/features/hover";
import { initSelection } from "@/features/selection";
import { initFullPage } from "@/features/immersive";

export default defineContentScript({
  matches: ["<all_urls>"],
  async main() {
    console.log("[OneLingo] content loaded:", location.href);
    try {
      const res = await sendMessage("ping", { text: "hello" });
      console.log("[OneLingo] ping ok:", res);
    } catch (e) {
      console.warn("[OneLingo] ping failed:", e);
    }
    initFullPage();
    initHover();
    initSelection();
  },
});
