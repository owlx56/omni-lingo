import { render } from "solid-js/web";

import "@/lib/ui/controls.css";
import "./style.css";
import App from "./App";
import { initTheme } from "@/lib/theme";

initTheme();

render(() => <App />, document.getElementById("root")!);
