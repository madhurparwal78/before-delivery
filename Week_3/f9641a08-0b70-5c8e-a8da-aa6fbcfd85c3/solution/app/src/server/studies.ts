// The seeded product art: four generated studies (Front, Side, Back, Open) per colour, drawn from
// stored data. Flat colour, chamfered corners, no photographs, no people.

export const VIEWS = ["Front", "Side", "Back", "Open"] as const;
export type View = (typeof VIEWS)[number];

const COLOUR_HEX: Record<string, string> = {
  graphite: "#3a3d42",
  sage: "#9caf88",
  "signal-red": "#d6281c",
  silver: "#c3c7cc",
  navy: "#1f2a5a",
  teal: "#008573",
  yellow: "#f5b700",
  blue: "#1c3fcb",
  sand: "#d8c39a",
  tan: "#b98a5a",
  black: "#1b1b1b",
  grey: "#8a8d91",
};

function colourHex(slug: string): string {
  const known = COLOUR_HEX[slug];
  if (known) return known;
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 38% 46%)`;
}

function shade(hex: string, amount: number): string {
  return `color-mix(in srgb, ${hex} ${100 - Math.abs(amount)}%, ${amount < 0 ? "#000" : "#fff"})`;
}

/** A chamfered rectangle as a polygon. */
function slab(x: number, y: number, w: number, h: number, c: number, fill: string): string {
  const points = [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
  return `<polygon points="${points.map((p) => p.join(",")).join(" ")}" fill="${fill}"/>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function wheels(x: number, y: number, spread: number, ink: string): string {
  return [x, x + spread].map((cx) => `${rect(cx - 14, y, 28, 30, ink)}${rect(cx - 6, y + 30, 12, 6, ink)}`).join("");
}

function luggage(view: View, body: string, ink: string): string {
  const dark = shade(body, -28);
  const light = shade(body, 18);
  const ribs = [0, 1, 2, 3, 4].map((i) => rect(190 + i * 44, 130, 14, 300, dark)).join("");
  if (view === "Side") {
    return `${slab(215, 90, 170, 380, 20, body)}${rect(228, 104, 12, 340, dark)}${rect(300, 40, 70, 50, ink)}${rect(312, 24, 46, 16, ink)}${wheels(250, 470, 100, ink)}${rect(330, 104, 40, 360, light)}`;
  }
  if (view === "Back") {
    return `${slab(160, 90, 280, 380, 24, body)}${ribs}${rect(272, 36, 56, 54, ink)}${rect(160, 60, 280, 14, dark)}${wheels(210, 470, 180, ink)}${rect(250, 250, 100, 40, dark)}`;
  }
  if (view === "Open") {
    return `${slab(150, 90, 150, 380, 18, body)}${slab(310, 90, 150, 380, 18, light)}${rect(166, 130, 118, 150, dark)}${rect(166, 300, 118, 150, dark)}${rect(326, 130, 118, 320, shade(body, 34))}${rect(298, 90, 14, 380, ink)}${wheels(190, 470, 220, ink)}`;
  }
  return `${slab(160, 90, 280, 380, 24, body)}${rect(272, 36, 56, 54, ink)}${rect(160, 60, 280, 14, dark)}${rect(176, 118, 248, 12, dark)}${rect(176, 420, 248, 12, dark)}${rect(292, 118, 16, 314, dark)}${wheels(210, 470, 180, ink)}${rect(240, 230, 120, 56, light)}`;
}

function backpack(view: View, body: string, ink: string): string {
  const dark = shade(body, -28);
  const light = shade(body, 18);
  if (view === "Side") {
    return `${slab(220, 110, 150, 360, 26, body)}${rect(300, 150, 60, 140, dark)}${rect(230, 200, 40, 200, light)}${rect(252, 80, 70, 30, ink)}`;
  }
  if (view === "Back") {
    return `${slab(170, 110, 260, 360, 26, body)}${rect(206, 150, 40, 300, dark)}${rect(354, 150, 40, 300, dark)}${rect(266, 70, 68, 40, ink)}${rect(236, 440, 128, 20, light)}`;
  }
  if (view === "Open") {
    return `${slab(170, 110, 260, 360, 26, body)}${rect(194, 150, 212, 280, dark)}${rect(214, 170, 172, 90, light)}${rect(214, 280, 172, 130, shade(body, 34))}${rect(266, 70, 68, 40, ink)}`;
  }
  return `${slab(170, 110, 260, 360, 26, body)}${rect(200, 330, 200, 110, dark)}${rect(214, 346, 172, 14, light)}${rect(266, 70, 68, 40, ink)}${rect(180, 150, 240, 12, dark)}${rect(292, 150, 16, 170, light)}`;
}

function tote(view: View, body: string, ink: string): string {
  const dark = shade(body, -28);
  const light = shade(body, 18);
  const handles = `${rect(230, 60, 14, 120, ink)}${rect(356, 60, 14, 120, ink)}${rect(230, 60, 140, 14, ink)}`;
  if (view === "Side") return `${handles}${slab(250, 170, 100, 300, 14, body)}${rect(262, 190, 20, 260, dark)}`;
  if (view === "Back") return `${handles}${slab(150, 170, 300, 300, 14, body)}${rect(150, 170, 300, 24, dark)}${rect(190, 300, 220, 110, light)}`;
  if (view === "Open") return `${handles}${slab(150, 170, 300, 300, 14, body)}${rect(166, 186, 268, 70, dark)}${rect(166, 256, 268, 200, shade(body, 30))}`;
  return `${handles}${slab(150, 170, 300, 300, 14, body)}${rect(150, 170, 300, 24, dark)}${rect(260, 280, 80, 80, light)}`;
}

function wallet(view: View, body: string, ink: string): string {
  const dark = shade(body, -28);
  const light = shade(body, 20);
  if (view === "Side") return `${slab(260, 190, 80, 220, 8, body)}${rect(272, 200, 14, 200, dark)}`;
  if (view === "Back") return `${slab(170, 180, 260, 240, 12, body)}${rect(170, 250, 260, 14, dark)}${rect(190, 280, 220, 110, light)}`;
  if (view === "Open") return `${slab(150, 190, 150, 220, 12, body)}${slab(310, 190, 150, 220, 12, light)}${rect(166, 220, 118, 40, dark)}${rect(166, 280, 118, 40, dark)}${rect(326, 210, 118, 180, dark)}`;
  return `${slab(170, 180, 260, 240, 12, body)}${rect(170, 250, 260, 14, dark)}${rect(272, 300, 56, 56, ink)}${rect(190, 200, 40, 10, light)}`;
}

function accessory(view: View, body: string, ink: string): string {
  const dark = shade(body, -28);
  const light = shade(body, 20);
  if (view === "Side") return `${slab(270, 230, 60, 160, 8, body)}${rect(284, 250, 12, 120, dark)}`;
  if (view === "Back") return `${slab(190, 220, 220, 180, 14, body)}${rect(190, 220, 220, 22, dark)}`;
  if (view === "Open") return `${slab(180, 210, 240, 200, 14, body)}${rect(200, 230, 200, 160, dark)}${rect(220, 250, 160, 40, light)}`;
  return `${slab(190, 220, 220, 180, 14, body)}${rect(190, 220, 220, 22, dark)}${rect(278, 190, 44, 36, ink)}${rect(250, 300, 100, 14, light)}`;
}

const DRAW: Record<string, (view: View, body: string, ink: string) => string> = {
  luggage,
  backpacks: backpack,
  totes: tote,
  wallets: wallet,
  accessories: accessory,
};

/** One study as an SVG document. `greyscale` draws the masthead variant. */
export function studySvg(category: string, colourSlug: string, view: View): string {
  const body = colourHex(colourSlug);
  const ground = "#ece9e4";
  const draw = DRAW[category] ?? accessory;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">${rect(0, 0, 600, 600, ground)}${rect(0, 520, 600, 80, "#d9d5ce")}<g>${draw(view, body, "#1b1b1b")}</g></svg>`;
}
