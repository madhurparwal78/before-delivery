import { MINUS } from "../../shared/copy";
import type { CircuitComponent } from "../../shared/types";
import { TERMINAL_REACH } from "./layout";
import { DEFAULT_OHMS, DEFAULT_VOLTS, signGlyph, type TerminalSign } from "./model";
import type { PartStatus } from "./solver";

/** A drawing as plain data, so the screen (React) and the exported file (a string) are made from the same shapes. */
export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
  text?: string;
}

/** Literal colours: the exported file has no stylesheet to read the app's tokens from. */
export const INK = "#282727";
export const SLATE = "#646e80";
export const ROYAL = "#0a47d2";
const METAL = "#5b6475";
const EDGE = "#c8d2ea";
const WIRE_COLOURS = ["#f58220", "#35b558", "#7a3fd1", "#1e90ff"] as const;
const LIGHT = "#ffd23f";
const FONT = "Fira Sans, Arial, sans-serif";

const tag = (name: string, attrs: SvgNode["attrs"], children?: SvgNode[]): SvgNode => (children ? { tag: name, attrs, children } : { tag: name, attrs });
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): SvgNode =>
  tag("line", { x1, y1, x2, y2, stroke, "stroke-width": width, "stroke-linecap": "round" });
const rect = (x: number, y: number, width: number, height: number, rx: number, fill: string, stroke = "none", strokeWidth = 2): SvgNode =>
  tag("rect", { x, y, width, height, rx, fill, stroke, "stroke-width": strokeWidth });
const circle = (cx: number, cy: number, r: number, fill: string, stroke = "none", strokeWidth = 2): SvgNode =>
  tag("circle", { cx, cy, r, fill, stroke, "stroke-width": strokeWidth });
const path = (d: string, fill: string, stroke: string, width: number): SvgNode =>
  tag("path", { d, fill, stroke, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" });

export function textNode(content: string, x: number, y: number, size: number, fill: string, weight = 600, anchor = "middle"): SvgNode {
  return {
    tag: "text",
    attrs: { x, y, "font-size": size, "font-weight": weight, "font-family": FONT, "text-anchor": anchor, fill },
    text: content,
  };
}

export function wireColour(index: number): string {
  return WIRE_COLOURS[index % WIRE_COLOURS.length] ?? ROYAL;
}

interface PartLook {
  status: PartStatus;
  /** LED brightness, 0 to 1. */
  glow: number;
  /** The state words shown under the label. */
  detail: string;
}

function batteryNodes(part: CircuitComponent, look: PartLook): SvgNode[] {
  const outline = look.status === "shorted" ? "#d2342a" : "#b35a0c";
  return [
    line(-TERMINAL_REACH, 0, -38, 0, METAL, 3),
    line(38, 0, TERMINAL_REACH, 0, METAL, 3),
    rect(-45, -7, 8, 14, 2, "#8a8f9c"),
    rect(-38, -19, 76, 38, 9, "#f58220", outline, look.status === "shorted" ? 3 : 2),
    rect(14, -19, 24, 38, 9, "#3b3f4a"),
    textNode("+", -27, 6, 18, "#ffffff", 700),
    textNode(MINUS, 26, 6, 18, "#ffffff", 700),
    textNode(`${part.volts ?? DEFAULT_VOLTS} V`, -4, 5, 14, "#ffffff", 700),
  ];
}

function ledNodes(look: PartLook): SvgNode[] {
  const lit = look.status === "lit";
  const broken = look.status === "broken";
  const dome = broken ? "#9aa1b0" : lit ? LIGHT : "#e4e8f2";
  const nodes: SvgNode[] = [];
  if (lit) {
    nodes.push(tag("circle", { cx: 0, cy: 0, r: 20 + look.glow * 18, fill: LIGHT, "fill-opacity": (0.2 + look.glow * 0.4).toFixed(2) }));
  }
  nodes.push(
    line(-TERMINAL_REACH, 0, -18, 0, METAL, 3),
    line(18, 0, TERMINAL_REACH, 0, METAL, 3),
    circle(0, 0, 19, dome, broken ? "#3b3f4a" : "#7a3fd1", 3),
    path("M-8 -9 L-8 9 L8 0 Z", "none", INK, 2),
    line(9, -9, 9, 9, INK, 2),
  );
  if (broken) nodes.push(path("M-12 -12 L-3 -2 L-9 4 L2 14", "none", "#3b3f4a", 2.5));
  return nodes;
}

/** Resistor colour code: two digits and a multiplier. */
const BAND_COLOURS = ["#1f1f1f", "#7b4a1e", "#d2342a", "#f58220", "#f2d02f", "#35b558", "#1e90ff", "#7a3fd1", "#8a8f9c", "#ffffff"] as const;
const GOLD = "#c9a227";
const SILVER = "#b8bdc8";

function bandsOf(ohms: number): string[] {
  const safe = Math.max(ohms, 1);
  const exponent = Math.floor(Math.log10(safe));
  const scaled = Math.round(safe / 10 ** (exponent - 1));
  const [tens, units, multiplier] = scaled >= 100 ? [1, 0, exponent] : [Math.floor(scaled / 10), scaled % 10, exponent - 1];
  const multiplierColour = multiplier === -1 ? GOLD : multiplier === -2 ? SILVER : (BAND_COLOURS[multiplier] ?? BAND_COLOURS[0]);
  return [BAND_COLOURS[tens] ?? GOLD, BAND_COLOURS[units] ?? GOLD, multiplierColour ?? GOLD];
}

function resistorNodes(part: CircuitComponent): SvgNode[] {
  const bands = bandsOf(part.ohms ?? DEFAULT_OHMS);
  const positions = [-20, -10, 0];
  return [
    line(-TERMINAL_REACH, 0, -32, 0, METAL, 3),
    line(32, 0, TERMINAL_REACH, 0, METAL, 3),
    rect(-34, -11, 68, 22, 11, "#ead9ae", "#9a7b3a", 2),
    ...bands.map((colour, i) => rect(positions[i] ?? 0, -11, 6, 22, 0, colour)),
    rect(18, -11, 6, 22, 0, GOLD),
  ];
}

function switchNodes(part: CircuitComponent): SvgNode[] {
  const closed = part.closed === true;
  return [
    line(-TERMINAL_REACH, 0, -30, 0, METAL, 3),
    line(30, 0, TERMINAL_REACH, 0, METAL, 3),
    rect(-44, -9, 88, 18, 9, "#eef2fb", EDGE, 2),
    line(-30, 0, closed ? 30 : 20, closed ? 0 : -26, "#1e90ff", 6),
    circle(closed ? 30 : 20, closed ? 0 : -26, 5, "#ffffff", "#1e90ff", 3),
    circle(-30, 0, 6, METAL),
    circle(30, 0, 6, METAL),
  ];
}

/** One part drawn around the origin: terminals at x = ±TERMINAL_REACH, the label and state words beneath. */
export function partNodes(part: CircuitComponent, look: PartLook): SvgNode[] {
  const body = part.type === "battery" ? batteryNodes(part, look)
    : part.type === "led" ? ledNodes(look)
    : part.type === "resistor" ? resistorNodes(part)
    : switchNodes(part);
  return [
    ...body,
    textNode(part.label, 0, 44, 15, INK, 700),
    textNode(look.detail, 0, 61, 13, SLATE, 400),
  ];
}

export const DOT_RADIUS = 7;

/** The sign printed above a terminal. */
export function terminalMark(x: number, y: number, sign: TerminalSign): SvgNode {
  return textNode(signGlyph(sign), x, y - 14, 14, ROYAL, 700);
}

/** A static terminal dot, for the exported file; the bench draws its own interactive ones. */
export function terminalDot(x: number, y: number): SvgNode {
  return circle(x, y, DOT_RADIUS, "#ffffff", ROYAL, 3);
}
