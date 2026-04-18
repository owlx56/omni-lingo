import { onMessage } from "@/lib/messaging";

export default defineBackground(() => {
  console.log("[OneLingo] background ready");

  onMessage("ping", (input) => ({ echo: input.text, at: Date.now() }));
});
