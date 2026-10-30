// Browser entry: mounts the Passboard app.

import { render } from "preact";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");
if (root) render(<App />, root);
