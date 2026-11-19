import { glyph, h } from "./dom";

const LETTERS: Record<string, string[]> = {
  H: ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  o: [".....", ".....", ".XXX.", "X...X", "X...X", "X...X", ".XXX."],
  l: [".XX..", "..X..", "..X..", "..X..", "..X..", "..X..", ".XXX."],
  d: ["....X", "....X", ".XXXX", "X...X", "X...X", "X...X", ".XXXX"],
  f: ["..XX.", ".X...", "XXXX.", ".X...", ".X...", ".X...", ".X..."],
  a: [".....", ".....", ".XXX.", "....X", ".XXXX", "X...X", ".XXXX"],
  s: [".....", ".....", ".XXXX", "X....", ".XXX.", "....X", "XXXX."],
  t: [".X...", ".X...", "XXXX.", ".X...", ".X...", ".X..X", "..XX."],
};

const SVG_NS = "http://www.w3.org/2000/svg";
const DEBRIS: [number, number, number][] = [[-2, 1, 0.7], [-4, 3, 0.5], [-1, 5, 0.6], [-6, 4, 0.35], [-3, 6, 0.45], [-7, 1, 0.3]];

/** The Holdfast pixel wordmark: an original grid of square pixels with debris breaking off its left edge. */
function wordmark(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-8 -1 56 9");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Holdfast Nights");
  svg.setAttribute("class", "wordmark");
  svg.setAttribute("shape-rendering", "crispEdges");
  const pixel = (x: number, y: number, fill: string, opacity = 1): void => {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", "1");
    rect.setAttribute("height", "1");
    rect.setAttribute("fill", fill);
    if (opacity < 1) rect.setAttribute("opacity", String(opacity));
    svg.append(rect);
  };
  [...("Holdfast")].forEach((letter, index) => {
    LETTERS[letter].forEach((row, y) => [...row].forEach((cell, x) => {
      if (cell === "X") pixel(index * 6 + x, y, y === 6 ? "#7d8785" : "#9aa3a1");
    }));
  });
  for (const [x, y, opacity] of DEBRIS) pixel(x, y, "#9aa3a1", opacity);
  return svg;
}

interface TitleActions {
  start(button: HTMLElement): void;
  convoy(button: HTMLElement): void;
  join(button: HTMLElement): void;
  nights(button: HTMLElement): void;
  history(button: HTMLElement): void;
  settings(button: HTMLElement): void;
  callsign(button: HTMLElement): void;
}

function link(label: string, icon: string[], onClick: (button: HTMLElement) => void): HTMLButtonElement {
  const button = h("button", { type: "button", class: "link-button" }, glyph(icon, 12), label);
  button.addEventListener("click", () => onClick(button));
  return button;
}

export interface TitleScreen {
  root: HTMLElement;
  startBar: HTMLButtonElement;
}

export function buildTitle(actions: TitleActions): TitleScreen {
  const startBar = h("button", { type: "button", class: "start-bar" }, "Start a room");
  startBar.addEventListener("click", () => actions.start(startBar));
  const root = h("main", { class: "title" },
    h("div", { class: "title-mark" }, wordmark(), h("p", { class: "title-sub", "aria-hidden": "true" }, "Nights")),
    startBar,
    h("nav", { class: "menu", "aria-label": "Title menu" },
      h("div", { class: "menu-row" },
        link("Join by code", ["M4 12h16", "M14 6l6 6-6 6"], actions.join),
        link("Convoy race", ["M3 17h18", "M5 17l2-6h10l2 6", "M8 17v2", "M16 17v2"], actions.convoy),
        link("Nights", ["M12 4v2", "M5 8h14", "M6 6h12v14H6z"], actions.nights)),
      h("div", { class: "menu-row" },
        link("History", ["M4 5h16", "M4 12h16", "M4 19h10"], actions.history),
        link("Settings", ["M5 7h14", "M5 17h14", "M9 4v6", "M15 14v6"], actions.settings),
        link("Callsign", ["M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M5 20c0-4 3-6 7-6s7 2 7 6"], actions.callsign))));
  return { root, startBar };
}
