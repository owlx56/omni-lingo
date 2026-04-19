import { onMessage } from "@/lib/messaging";
import { DEFAULT_ENGINE_ID, getEngine } from "@/engines/registry";
import { translateCached } from "@/lib/cache/translate";

export default defineBackground(() => {
  console.log("[OneLingo] background ready");

  onMessage("ping", (input) => ({ echo: input.text, at: Date.now() }));

  onMessage("translate", async ({ engine, ...req }) => {
    const id = engine ?? DEFAULT_ENGINE_ID;
    const e = getEngine(id);
    return translateCached(id, req, () => e.translate(req));
  });
});
