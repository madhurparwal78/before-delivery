import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/fira-sans/latin-400.css";
import "@fontsource/fira-sans/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "./styles.css";
import { startRouter } from "./router";
import { loadMe } from "./session";
import { startStatusWatch } from "./shell";

void loadMe().then(() => {
  startStatusWatch();
  startRouter();
});
