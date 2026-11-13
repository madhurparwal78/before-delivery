import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";
import "./styles/screens.css";
import "./styles/board.css";

// Every self-hosted face the screens use (see styles/fonts.css).
const FACES = [
  '400 1em "Fraunces"',
  '600 1em "Fraunces"',
  '400 1em "IBM Plex Sans"',
  '500 1em "IBM Plex Sans"',
  '600 1em "IBM Plex Sans"',
  '400 1em "IBM Plex Mono"',
  '500 1em "IBM Plex Mono"',
];

function mount(): void {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<App />);
}

// First paint uses the studio's own fonts, so a late font swap never reflows the page (a wider fallback
// face can wrap the header or a table). A face that fails to load still lets the app mount.
void Promise.allSettled(FACES.map((face) => document.fonts.load(face))).then(mount);
