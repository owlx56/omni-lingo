import { render } from "solid-js/web";

import "./style.css";
import App from "./App";
import { initTheme } from "./theme";

initTheme();
render(() => <App />, document.getElementById("root")!);
