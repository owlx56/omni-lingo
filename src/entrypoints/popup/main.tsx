import { render } from "solid-js/web";

import "@/lib/ui/controls.css";
import "./popup.css";
import App from "./App";
import { initTheme } from "@/lib/theme";

initTheme();
render(() => <App surface="native" />, document.getElementById("root")!);
