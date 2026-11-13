import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/landing.css";
import "./styles/board.css";
import "./styles/sheets.css";
import "./styles/seam.css";

/** Both faces before the first paint, so a late font swap never reflows a page already on screen. */
const FONTS = ['400 16px "Mona Sans Variable"', '900 24px "Hubot Sans Variable"'];
const FONT_WAIT_MS = 3000;

function fontsLoaded(): Promise<unknown> {
  const loads = Promise.all(FONTS.map((font) => document.fonts.load(font))).catch(() => undefined);
  return Promise.race([loads, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]);
}

void fontsLoaded().then(() => createRoot(document.getElementById("root")!).render(<App />));
