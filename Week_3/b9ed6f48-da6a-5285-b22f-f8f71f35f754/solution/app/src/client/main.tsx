import { createRoot } from "react-dom/client";
import "./fonts/fonts.css";
import "./styles.css";
import { AppProvider } from "./state.js";
import { App } from "./App.js";

// The first paint waits (at most 2.5 s) for the upright faces, so a wider fallback face never wraps the
// header and then reflows the page when the web fonts arrive.
const FACES = ['400 1em "Inter Tight"', '500 1em "Inter Tight"', '600 1em "Inter Tight"', '400 1em "Instrument Serif"',
  '400 1em "JetBrains Mono"', '500 1em "JetBrains Mono"'];
const fontsReady = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined);

void Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 2500))]).then(() =>
  createRoot(document.getElementById("root") as HTMLElement).render(
    <AppProvider>
      <App />
    </AppProvider>,
  ),
);
