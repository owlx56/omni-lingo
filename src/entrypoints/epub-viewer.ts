import { render } from "solid-js/web";
import App from "./epub/App";
import { initTheme } from "@/lib/theme";

export default defineUnlistedScript(() => {
  initTheme();
  const root = document.getElementById("root");
  if (!root) return;
  render(App, root);
});
