import { render } from "preact";
import "./styles.css";
import { App } from "./App";
import { viewer } from "./viewer";

function applySettings(): void {
  const settings = viewer.settings.get();
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty("--font-scale", String(settings.fontSize));
}

viewer.settings.subscribe(applySettings);
applySettings();
void viewer.boot().catch(() => viewer.signedOut());

/** Draws the first page once both faces are in (or after a short wait), so the text never reflows when the fonts swap in. */
const FONT_WAIT_MS = 1500;
const fontsReady = Promise.all([document.fonts.load('700 1em "Bodoni Moda"'), document.fonts.load('400 1em "Jost"')]).catch(() => undefined);
void Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).then(() => {
  render(<App />, document.getElementById("root")!);
});
