import { render } from "preact";
import { App } from "./App";
import "./styles.css";

const FONT_WAIT_MS = 3000;
const LATIN = "Aa £—";
const LATIN_EXT = "ąćęłńóśźż";
const FACES = ['500 1em "Space Grotesk"', '700 1em "Space Grotesk"', '400 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];

/** Loads every bundled face (Latin and Latin Extended) before the first paint, so no text reflows afterwards. */
async function start(): Promise<void> {
  const loaded = Promise.allSettled(FACES.flatMap((face) => [document.fonts.load(face, LATIN), document.fonts.load(face, LATIN_EXT)]));
  await Promise.race([loaded, new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_MS))]);
  const root = document.getElementById("app");
  if (root) render(<App />, root);
}

void start();
