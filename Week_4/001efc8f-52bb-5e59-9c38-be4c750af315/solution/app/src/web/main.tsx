import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./fonts.css";
import "./styles.css";

// The first paint waits (briefly) for the self-hosted faces, so a late swap never rewraps the
// header and shifts the column under it.
const FACES = ['700 1em "Barlow Condensed"', '800 1em "Barlow Condensed"', '400 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const FONT_WAIT_MS = 2_000;

function fontsReady(): Promise<unknown> {
  if (!("fonts" in document)) return Promise.resolve();
  return Promise.race([
    Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ]);
}

const root = document.getElementById("root");
if (root) {
  void fontsReady().then(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
