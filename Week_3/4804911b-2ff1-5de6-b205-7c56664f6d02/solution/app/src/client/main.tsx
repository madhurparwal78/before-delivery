import { render } from "preact";
import { App } from "./App";
import "./styles.css";
import { installKeepFocus } from "./lib/keepfocus";

document.documentElement.style.setProperty("--vh", `${innerHeight}px`);
addEventListener("resize", () => document.documentElement.style.setProperty("--vh", `${innerHeight}px`));
installKeepFocus();
render(<App />, document.getElementById("root")!);
