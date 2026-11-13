import { BLACK_COINS, COIN_RADIUS, POCKET_IDS, POCKET_POSITIONS, POCKET_RADIUS, STRIKER_RADIUS, WHITE_COINS } from "../../shared/constants";
import type { PieceId } from "../../shared/types";
import { s } from "../dom";

/** The board and every piece are drawn here, procedurally: lacquered ply, net pockets, turned coins. No image files. */

interface Theme {
  surface: string;
  surfaceDeep: string;
  grain: string;
  line: string;
  accent: string;
  frame: string;
  frameLight: string;
}

const THEMES: Record<string, Theme> = {
  "board-ply": { surface: "#E7BB78", surfaceDeep: "#D6A257", grain: "#B98A47", line: "#5B2B1D", accent: "#B5342A", frame: "#5A3B22", frameLight: "#7A5232" },
  "board-chalk": { surface: "#E9E3D5", surfaceDeep: "#D9D1BE", grain: "#BDB49C", line: "#27385A", accent: "#27385A", frame: "#463C33", frameLight: "#65584B" },
  "board-walnut": { surface: "#6C4731", surfaceDeep: "#573624", grain: "#82583C", line: "#EBCB9C", accent: "#EBCB9C", frame: "#2B1B11", frameLight: "#47301F" },
};

interface CoinSet {
  white: { fill: string; rim: string; ring: string };
  black: { fill: string; rim: string; ring: string };
}

const COIN_SETS: Record<string, CoinSet> = {
  "coins-ivory": {
    white: { fill: "#F8F4EA", rim: "#14110F", ring: "#CBBF9F" },
    black: { fill: "#1C1815", rim: "#EFE8D8", ring: "#4A423A" },
  },
  "coins-shell": {
    white: { fill: "#E9E4D8", rim: "#14110F", ring: "#8FA2B8" },
    black: { fill: "#3B4452", rim: "#EFE8D8", ring: "#9AA9BD" },
  },
};

interface Skin {
  fill: string;
  rim: string;
  inner: string;
  inlay: string | null;
}

const SKINS: Record<string, Skin> = {
  "striker-ply": { fill: "#DBA55A", rim: "#4A2F18", inner: "#8C5E2D", inlay: null },
  "striker-tomato": { fill: "#F2452B", rim: "#14110F", inner: "#FFB4A6", inlay: null },
  "striker-cobalt": { fill: "#FFFFFF", rim: "#14110F", inner: "#1B45D7", inlay: "#1B45D7" },
  "striker-brass": { fill: "#B88A2E", rim: "#14110F", inner: "#F3D58A", inlay: "#F3D58A" },
};

const INK = "#14110F";
const QUEEN = "#C9281A";
let uid = 0;

function boardThemeOf(id: string): Theme {
  return THEMES[id] ?? (THEMES["board-ply"] as Theme);
}

function coinSetOf(id: string): CoinSet {
  return COIN_SETS[id] ?? (COIN_SETS["coins-ivory"] as CoinSet);
}

function skinOf(id: string): Skin {
  return SKINS[id] ?? (SKINS["striker-ply"] as Skin);
}

function baseline(theme: Theme, rotation: number): SVGGElement {
  const reach = 200 + STRIKER_RADIUS;
  const y = 252.1;
  const stroke = { stroke: theme.line, "stroke-width": 1.6, fill: "none", opacity: 0.85 };
  return s(
    "g",
    { transform: `rotate(${rotation})` },
    s("line", { x1: -reach, y1: y - STRIKER_RADIUS, x2: reach, y2: y - STRIKER_RADIUS, ...stroke }),
    s("line", { x1: -reach, y1: y + STRIKER_RADIUS, x2: reach, y2: y + STRIKER_RADIUS, ...stroke }),
    ...[-200, 200].map((x) =>
      s("g", {}, s("circle", { cx: x, cy: y, r: STRIKER_RADIUS, ...stroke }), s("circle", { cx: x, cy: y, r: 13, fill: theme.accent, opacity: 0.8 })),
    ),
  );
}

function arrow(theme: Theme, sx: number, sy: number): SVGGElement {
  const stroke = { stroke: theme.line, "stroke-width": 1.8, fill: "none", opacity: 0.85, "stroke-linecap": "round" };
  const from = 305;
  const to = 215;
  return s(
    "g",
    {},
    s("line", { x1: sx * from, y1: sy * from, x2: sx * to, y2: sy * to, ...stroke }),
    s("path", { d: `M ${sx * (to + 16)} ${sy * (to - 2)} L ${sx * to} ${sy * to} L ${sx * (to - 2)} ${sy * (to + 16)}`, ...stroke }),
    s("circle", { cx: sx * from, cy: sy * from, r: 11, ...stroke }),
    s("path", { d: `M ${sx * 268} ${sy * 336} Q ${sx * 336} ${sy * 336} ${sx * 336} ${sy * 268}`, ...stroke }),
  );
}

function defs(id: string, theme: Theme): SVGDefsElement {
  return s(
    "defs",
    {},
    s(
      "linearGradient",
      { id: `${id}-ply`, x1: 0, y1: 0, x2: 1, y2: 1 },
      s("stop", { offset: "0", "stop-color": theme.surface }),
      s("stop", { offset: "1", "stop-color": theme.surfaceDeep }),
    ),
    s(
      "linearGradient",
      { id: `${id}-sheen`, x1: 0, y1: 0, x2: 0, y2: 1 },
      s("stop", { offset: "0", "stop-color": "#FFFFFF", "stop-opacity": "0.22" }),
      s("stop", { offset: "0.5", "stop-color": "#FFFFFF", "stop-opacity": "0" }),
      s("stop", { offset: "1", "stop-color": "#000000", "stop-opacity": "0.12" }),
    ),
    s(
      "linearGradient",
      { id: `${id}-frame`, x1: 0, y1: 0, x2: 1, y2: 1 },
      s("stop", { offset: "0", "stop-color": theme.frameLight }),
      s("stop", { offset: "1", "stop-color": theme.frame }),
    ),
    s(
      "pattern",
      { id: `${id}-grain`, width: 120, height: 18, patternUnits: "userSpaceOnUse" },
      s("path", { d: "M0 4 Q30 1 60 4 T120 4", stroke: theme.grain, "stroke-width": 0.9, fill: "none", opacity: 0.55 }),
      s("path", { d: "M0 12 Q30 15 60 12 T120 12", stroke: theme.grain, "stroke-width": 0.6, fill: "none", opacity: 0.4 }),
    ),
    s(
      "pattern",
      { id: `${id}-net`, width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      s("path", { d: "M0 0 H7 M0 0 V7", stroke: "#8C7B66", "stroke-width": 0.7, fill: "none", opacity: 0.7 }),
    ),
  );
}

function pocket(id: string, x: number, y: number): SVGGElement {
  return s(
    "g",
    { transform: `translate(${x} ${y})` },
    s("circle", { r: POCKET_RADIUS + 2.2, fill: "#2B211A", opacity: 0.6 }),
    s("circle", { r: POCKET_RADIUS, fill: "#16110E" }),
    s("circle", { r: POCKET_RADIUS, fill: `url(#${id}-net)` }),
    s("circle", { r: POCKET_RADIUS - 1, fill: "none", stroke: "#0B0807", "stroke-width": 2 }),
  );
}

function coinArt(id: PieceId, set: CoinSet): SVGGElement {
  const group = s("g", { class: "art" });
  group.append(s("circle", { cx: 1.4, cy: 2, r: COIN_RADIUS, fill: "#000", opacity: 0.3 }));
  if (id === "queen") {
    group.append(
      s("circle", { r: COIN_RADIUS, fill: QUEEN, stroke: INK, "stroke-width": 1.5 }),
      s("circle", { r: 11, fill: "none", stroke: "#F9D9C8", "stroke-width": 1.1 }),
      s("circle", { r: 4.4, fill: "#F9D9C8" }),
      s("ellipse", { cx: -4.5, cy: -5.5, rx: 6, ry: 3.2, fill: "#FFF", opacity: 0.32, transform: "rotate(-30)" }),
    );
    return group;
  }
  const white = id.startsWith("w");
  const look = white ? set.white : set.black;
  group.append(
    s("circle", { r: COIN_RADIUS, fill: look.fill, stroke: look.rim, "stroke-width": 1.5 }),
    s("circle", { r: 10.8, fill: "none", stroke: look.ring, "stroke-width": 1.2 }),
    s("circle", { r: 5.2, fill: "none", stroke: look.ring, "stroke-width": 0.9 }),
    s("ellipse", { cx: -4.5, cy: -5.5, rx: 6, ry: 3.2, fill: "#FFF", opacity: white ? 0.5 : 0.2, transform: "rotate(-30)" }),
  );
  return group;
}

function strikerArt(skin: Skin): SVGGElement {
  const group = s("g", { class: "art" });
  group.append(
    s("circle", { cx: 1.6, cy: 2.4, r: STRIKER_RADIUS, fill: "#000", opacity: 0.3 }),
    s("circle", { r: STRIKER_RADIUS, fill: skin.fill, stroke: skin.rim, "stroke-width": 1.6 }),
    s("circle", { r: 13.5, fill: "none", stroke: skin.inner, "stroke-width": skin.inlay ? 3 : 1.4 }),
    s("circle", { r: 6, fill: skin.inner, opacity: 0.9 }),
  );
  if (skin.inlay) group.append(s("circle", { r: 17.4, fill: "none", stroke: skin.inlay, "stroke-width": 1.1, "stroke-dasharray": "3 2.2" }));
  group.append(s("ellipse", { cx: -6, cy: -8, rx: 8, ry: 4, fill: "#FFF", opacity: 0.35, transform: "rotate(-30)" }));
  return group;
}

function strikerRing(): SVGGElement {
  return s(
    "g",
    { class: "striker-ring" },
    s("circle", { class: "ring-outer", r: STRIKER_RADIUS - 1.3, fill: "none" }),
    s("circle", { class: "ring-inner", r: STRIKER_RADIUS - 4.45, fill: "none" }),
  );
}

export interface BoardParts {
  svg: SVGSVGElement;
  pieces: Map<PieceId, SVGGElement>;
  ring: SVGGElement;
  guide: SVGGElement;
  guideLine: SVGLineElement;
  guideMark: SVGCircleElement;
  ghost: SVGGElement;
  ghostAim: SVGLineElement;
  setLook: (boardId: string, coinsId: string) => void;
  setStrikerSkin: (skinId: string) => void;
}

interface BoardOptions {
  boardTheme: string;
  coins: string;
  strikerSkin: string;
  /** the live match board carries ids, roles and data attributes; a swatch does not */
  live: boolean;
}

function pieceGroup(id: PieceId, live: boolean): SVGGElement {
  return s("g", {
    class: `piece piece-${id === "striker" || id === "queen" ? id : id.startsWith("w") ? "white" : "black"}`,
    ...(live ? { id: `piece-${id}`, "data-state": "board", "data-pocketed-by": "" } : {}),
  });
}

/** Builds the board. Positions are board millimetres with the origin at the centre. */
export function createBoard(options: BoardOptions): BoardParts {
  uid += 1;
  const key = `b${uid}`;
  let theme = boardThemeOf(options.boardTheme);
  const reach = 394;
  const svg = s("svg", {
    viewBox: "-370 -370 740 740",
    class: "board-svg",
    xmlns: "http://www.w3.org/2000/svg",
    ...(options.live ? { id: "board", role: "group", "aria-label": "Carrom board", tabindex: 0, "data-theme": options.boardTheme } : { "aria-hidden": "true", focusable: "false" }),
  });
  const surface = s("g", {});
  const frame = s("g", {});
  const markings = s("g", {});
  const piecesLayer = s("g", {});
  const pieces = new Map<PieceId, SVGGElement>();

  const paint = (): void => {
    svg.querySelector("defs")?.remove();
    svg.prepend(defs(key, theme));
    frame.replaceChildren(
      s("rect", { x: -reach, y: -reach, width: reach * 2, height: reach * 2, fill: `url(#${key}-frame)` }),
      s("rect", { x: -reach + 5, y: -reach + 5, width: (reach - 5) * 2, height: (reach - 5) * 2, fill: "none", stroke: "#000", "stroke-opacity": 0.28, "stroke-width": 2 }),
      s("rect", { x: -372, y: -372, width: 744, height: 744, fill: "none", stroke: "#000", "stroke-opacity": 0.45, "stroke-width": 4 }),
    );
    surface.replaceChildren(
      s("rect", { x: -370, y: -370, width: 740, height: 740, fill: `url(#${key}-ply)` }),
      s("rect", { x: -370, y: -370, width: 740, height: 740, fill: `url(#${key}-grain)` }),
      s("rect", { x: -370, y: -370, width: 740, height: 740, fill: `url(#${key}-sheen)` }),
    );
    const stroke = { stroke: theme.line, "stroke-width": 1.8, fill: "none", opacity: 0.85 };
    markings.replaceChildren(
      baseline(theme, 0),
      baseline(theme, 90),
      baseline(theme, 180),
      baseline(theme, 270),
      s("circle", { r: 88, ...stroke }),
      s("circle", { r: 64, ...stroke }),
      s("circle", { r: 20, fill: theme.accent, opacity: 0.75 }),
      arrow(theme, -1, -1),
      arrow(theme, 1, -1),
      arrow(theme, -1, 1),
      arrow(theme, 1, 1),
      ...POCKET_IDS.map((p) => pocket(key, POCKET_POSITIONS[p].x, POCKET_POSITIONS[p].y)),
    );
  };

  const set = coinSetOf(options.coins);
  let currentSet = set;
  const ids: PieceId[] = ["queen", ...WHITE_COINS, ...BLACK_COINS];
  const draw = (id: PieceId): void => {
    const group = pieces.get(id) as SVGGElement;
    group.querySelector(".art")?.remove();
    group.prepend(coinArt(id, currentSet));
  };
  for (const id of ids) {
    const group = pieceGroup(id, options.live);
    pieces.set(id, group);
    piecesLayer.append(group);
    draw(id);
  }
  const guideLine = s("line", { class: "guide-line", stroke: "#FFFFFF", "stroke-width": 2.4, "stroke-dasharray": "7 6", "stroke-linecap": "round", opacity: 0.95 });
  const guideMark = s("circle", { class: "guide-mark", r: 5, fill: "none", stroke: "#FFFFFF", "stroke-width": 2.4 });
  const guide = s("g", { ...(options.live ? { id: "aim-guide", "data-first-contact": "" } : {}), class: "aim-guide" }, guideLine, guideMark);
  const ghostAim = s("line", { ...(options.live ? { id: "ghost-aim" } : {}), class: "ghost-aim", stroke: "#FFFFFF", "stroke-width": 2.4, "stroke-dasharray": "7 6", opacity: 0.4 });
  const ghost = s(
    "g",
    { ...(options.live ? { id: "ghost-striker", "data-x": "", "data-y": "" } : {}), class: "ghost-striker", opacity: 0.4 },
    s("circle", { r: STRIKER_RADIUS, fill: "#FFFFFF", stroke: INK, "stroke-width": 1.6 }),
    s("circle", { r: 13.5, fill: "none", stroke: INK, "stroke-width": 1.4 }),
  );
  const striker = pieceGroup("striker", options.live);
  let skinArt = strikerArt(skinOf(options.strikerSkin));
  const ring = strikerRing();
  striker.append(skinArt, ring);
  if (options.live) striker.setAttribute("data-skin", options.strikerSkin);
  pieces.set("striker", striker);
  piecesLayer.append(striker);

  svg.append(frame, surface, markings, ghostAim, guide, piecesLayer, ghost);
  paint();

  return {
    svg,
    pieces,
    ring,
    guide,
    guideLine,
    guideMark,
    ghost,
    ghostAim,
    setLook: (boardId, coinsId) => {
      theme = boardThemeOf(boardId);
      currentSet = coinSetOf(coinsId);
      if (options.live) svg.setAttribute("data-theme", boardId);
      paint();
      for (const id of ids) draw(id);
    },
    setStrikerSkin: (skinId) => {
      skinArt.remove();
      skinArt = strikerArt(skinOf(skinId));
      striker.prepend(skinArt);
      if (options.live) striker.setAttribute("data-skin", skinId);
    },
  };
}

/** A small drawing of a shop item for its tile. */
export function swatch(kind: "striker" | "board" | "coins", itemId: string): SVGSVGElement {
  if (kind === "board") {
    const parts = createBoard({ boardTheme: itemId, coins: "coins-ivory", strikerSkin: "striker-ply", live: false });
    for (const group of parts.pieces.values()) group.remove();
    parts.guide.remove();
    parts.ghost.remove();
    parts.ghostAim.remove();
    parts.svg.setAttribute("class", "swatch-svg");
    return parts.svg;
  }
  const view = s("svg", { viewBox: "-60 -40 120 80", class: "swatch-svg", "aria-hidden": "true", focusable: "false" });
  if (kind === "striker") {
    view.append(s("rect", { x: -60, y: -40, width: 120, height: 80, fill: "#E7BB78" }), s("g", { transform: "scale(1.5)" }, strikerArt(skinOf(itemId))));
    return view;
  }
  const set = coinSetOf(itemId);
  view.append(
    s("rect", { x: -60, y: -40, width: 120, height: 80, fill: "#E7BB78" }),
    s("g", { transform: "translate(-22 0) scale(1.45)" }, coinArt("w1", set)),
    s("g", { transform: "translate(22 0) scale(1.45)" }, coinArt("b1", set)),
  );
  return view;
}

