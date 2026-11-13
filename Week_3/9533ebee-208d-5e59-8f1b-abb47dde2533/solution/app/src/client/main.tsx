import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// The faces the sheet uses, as CSS declares them. The app is drawn once they are in (or after a short wait), so text
// never reflows when a face arrives.
const FACES = ['500 1em "Space Grotesk"', '600 1em "Space Grotesk"', '400 1em "IBM Plex Sans"', '500 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const WAIT_MS = 1500;

const root = document.getElementById("root");
if (root) {
  const faces = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined);
  const patience = new Promise((resolve) => window.setTimeout(resolve, WAIT_MS));
  void Promise.race([faces, patience]).then(() => createRoot(root).render(<App />));
}
