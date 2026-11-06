import type { ColourScheme } from "../store/preferences.ts";
import { readScheme, writeScheme } from "../store/preferences.ts";

const DARK = window.matchMedia("(prefers-color-scheme: dark)");

function show(scheme: ColourScheme): void {
  const dark = scheme === "Dark" || (scheme === "System" && DARK.matches);
  document.documentElement.dataset["colourScheme"] = dark ? "dark" : "light";
}

export function applyScheme(scheme: ColourScheme): void {
  writeScheme(scheme);
  show(scheme);
}

export function startColourScheme(): void {
  show(readScheme());
  DARK.addEventListener("change", () => show(readScheme()));
}
