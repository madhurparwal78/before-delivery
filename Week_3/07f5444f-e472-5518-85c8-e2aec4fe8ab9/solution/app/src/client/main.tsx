import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

// The first layout waits for the self-hosted faces (up to a moment), so a fallback font never sets
// line breaks that shift once the real face swaps in.
const FACES = [
  '400 1em "IBM Plex Sans"',
  '500 1em "IBM Plex Sans"',
  '600 1em "IBM Plex Sans"',
  '400 1em "IBM Plex Mono"',
  '500 1em "IBM Plex Mono"',
  '600 1em "Fraunces"',
];
const FONT_WAIT_MS = 1500;

const root = document.getElementById("root");
if (root) {
  const fonts = Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => [])));
  const waited = new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS));
  void Promise.race([fonts, waited]).then(() => createRoot(root).render(<App />));
}
