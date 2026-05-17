import { render } from "solid-js/web";

import "./style.css";
import App from "./App";
import { initTheme } from "@/lib/theme";

initTheme();
render(() => <App />, document.getElementById("root")!);
