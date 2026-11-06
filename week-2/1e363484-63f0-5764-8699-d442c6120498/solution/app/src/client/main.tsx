import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

if (location.pathname === "/") history.replaceState(null, "", "/projects");

// The first paint waits (briefly) for the five faces, so no fallback face is laid out and then swapped.
const FACES = ['400 1em "Instrument Serif"', '400 1em "Instrument Sans"', '600 1em "Instrument Sans"',
  '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const fontsReady = Promise.race([
  Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]);

void fontsReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
