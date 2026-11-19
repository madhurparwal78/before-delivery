import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./styles.css";
import { App } from "./App";

// The first render waits for the bundled faces (capped at 1s), so text never rewraps when a fallback font swaps out.
const FACES = ['400 1em "IBM Plex Sans"', '500 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"',
  '600 1em "IBM Plex Sans Condensed"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const fontsReady = Promise.race([
  Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined),
  new Promise((done) => setTimeout(done, 1000)),
]);

const root = document.getElementById("root");
if (root) void fontsReady.then(() => createRoot(root).render(<App />));
