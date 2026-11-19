/** The send celebration: a short shower of falling notes that never blocks a click and is absent under reduced motion. */
import { after } from "../shared/timers.js";

const NOTES = 18;
const COLOURS = ["var(--color-money-in)", "var(--color-action)"];
const SHORTEST_MS = 1800;
const LONGEST_MS = 2700;
const REMOVE_AFTER_MS = 2900;
const NAMESPACE = "http://www.w3.org/2000/svg";

export function celebrate(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("[data-celebration]").forEach((old) => old.remove());
  const layer = document.createElement("div");
  layer.className = "celebration";
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-celebration", "");
  for (let index = 0; index < NOTES; index++) {
    const note = document.createElementNS(NAMESPACE, "svg");
    note.setAttribute("class", "note");
    note.setAttribute("viewBox", "0 0 24 24");
    note.setAttribute("width", "22");
    note.setAttribute("height", "22");
    const glyph = document.createElementNS(NAMESPACE, "path");
    glyph.setAttribute("d", "M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z");
    glyph.setAttribute("fill", "none");
    glyph.setAttribute("stroke", COLOURS[index % COLOURS.length] ?? "currentColor");
    glyph.setAttribute("stroke-width", "2");
    glyph.setAttribute("stroke-linecap", "round");
    glyph.setAttribute("stroke-linejoin", "round");
    note.append(glyph);
    const left = ((index * 37) % 94) + 3;
    const duration = SHORTEST_MS + ((index * 211) % (LONGEST_MS - SHORTEST_MS));
    const turn = (index % 2 === 0 ? 1 : -1) * (180 + ((index * 53) % 200));
    note.style.left = `${left}%`;
    note.animate(
      [
        { transform: "translateY(-10vh) rotate(0deg)", opacity: 1 },
        { transform: `translateY(60vh) rotate(${turn / 2}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translateY(105vh) rotate(${turn}deg)`, opacity: 0 },
      ],
      { duration, delay: (index * 40) % 400, easing: "cubic-bezier(0.3, 0.1, 0.6, 1)", fill: "forwards" },
    );
    layer.append(note);
  }
  document.body.append(layer);
  after(() => layer.remove(), REMOVE_AFTER_MS);
}
