// Parcel Moon's entry point: fonts, then the route — game, claim page or console.

import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";

import { MotionPreference } from "./dom.js";
import { startGame } from "./game/game.js";
import { startConsole } from "./console.js";
import { startClaim } from "./claim.js";

const app = document.getElementById("app")!;

async function loadFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('400 1em "Fraunces"'),
      document.fonts.load('700 1em "Fraunces"'),
      document.fonts.load('400 1em "Atkinson Hyperlegible"'),
      document.fonts.load('700 1em "Atkinson Hyperlegible"'),
    ]);
    await document.fonts.ready;
  } catch {
    // the page still works with fallback fonts
  }
}

void loadFonts();

const motion = new MotionPreference();
const path = location.pathname;
if (path === "/claim") {
  startClaim(app);
} else if (path === "/console") {
  startConsole(app);
} else {
  startGame(app, motion);
}
