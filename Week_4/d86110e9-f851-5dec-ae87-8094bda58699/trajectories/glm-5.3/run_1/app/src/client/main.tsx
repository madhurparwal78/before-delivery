// Client entry: renders the app shell.

import { render } from "preact";
import { h } from "./runtime";
import { App } from "./app";

render(h(App, {}), document.getElementById("root")!);
