import { render } from "solid-js/web";

import "@/lib/ui/controls.css";
import "./style.css";
import App from "./App";
import { initTheme } from "@/lib/theme";
import { initHover } from "@/features/hover";
import { initSelection } from "@/features/selection";

initTheme();
initHover();
initSelection();

render(() => <App />, document.getElementById("root")!);
