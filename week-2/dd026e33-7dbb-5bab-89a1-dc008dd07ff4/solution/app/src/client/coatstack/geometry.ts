// The procedural top-down car plan (brief: Visual design › Car plan): front at the top, 12 separately
// outlined panels, drawn from shapes in code. Coordinates are in a 300 × 552 design box; every panel
// is at least 46 units on each side so it keeps a 44 px target when the plan is 290 px wide or more.
import type { PanelId } from "../../shared/domain.js";

export const PLAN_WIDTH = 300;
export const PLAN_HEIGHT = 552;

export interface PanelShape {
  id: PanelId;
  x: number;
  y: number;
  w: number;
  h: number;
  d: string;
  /** Line detail drawn over the fill (lamps, shut lines, handles). */
  detail?: string;
  /** Where the band label's plate sits: the panel's open area, clear of arches and lamps. */
  label: { x: number; y: number };
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}

/** A wing or rear quarter with its wheel arch cut into the outer edge. */
function archedPanel(x: number, y: number, w: number, h: number, archY: number, side: "l" | "r", rear: boolean): string {
  const r = 24;
  const front = rear ? 6 : 16;
  const back = rear ? 18 : 6;
  if (side === "l") {
    return `M${x + w} ${y}H${x + front}Q${x} ${y} ${x} ${y + front}V${archY - r}A${r} ${r} 0 0 1 ${x} ${archY + r}V${y + h - back}Q${x} ${y + h} ${x + back} ${y + h}H${x + w}Z`;
  }
  const outer = x + w;
  return `M${x} ${y}H${outer - front}Q${outer} ${y} ${outer} ${y + front}V${archY - r}A${r} ${r} 0 0 0 ${outer} ${archY + r}V${y + h - back}Q${outer} ${y + h} ${outer - back} ${y + h}H${x}Z`;
}

export const PANEL_SHAPES: PanelShape[] = [
  {
    id: "front_valance",
    x: 56,
    y: 4,
    w: 188,
    h: 46,
    d: "M74 4H226Q244 4 244 22V44Q244 50 238 50H62Q56 50 56 44V22Q56 4 74 4Z",
    detail: "M66 18h22v12h-22zM212 18h22v12h-22zM112 40h76",
    label: { x: 150, y: 24 },
  },
  { id: "bonnet", x: 104, y: 56, w: 92, h: 144, d: "M116 56H184Q196 58 196 70V200H104V70Q104 58 116 56Z", detail: "M150 64V192", label: { x: 150, y: 128 } },
  { id: "front_wing_l", x: 30, y: 56, w: 70, h: 144, d: archedPanel(30, 56, 70, 144, 128, "l", false), label: { x: 77, y: 128 } },
  { id: "front_wing_r", x: 200, y: 56, w: 70, h: 144, d: archedPanel(200, 56, 70, 144, 128, "r", false), label: { x: 223, y: 128 } },
  { id: "door_l", x: 52, y: 206, w: 48, h: 124, d: roundedRect(52, 206, 48, 124, 4), detail: "M60 262h12", label: { x: 76, y: 268 } },
  { id: "door_r", x: 200, y: 206, w: 48, h: 124, d: roundedRect(200, 206, 48, 124, 4), detail: "M228 262h12", label: { x: 224, y: 268 } },
  { id: "sill_l", x: 0, y: 206, w: 48, h: 176, d: roundedRect(0, 206, 48, 176, 10), label: { x: 24, y: 294 } },
  { id: "sill_r", x: 252, y: 206, w: 48, h: 176, d: roundedRect(252, 206, 48, 176, 10), label: { x: 276, y: 294 } },
  { id: "roof", x: 104, y: 230, w: 92, h: 128, d: roundedRect(104, 230, 92, 128, 14), label: { x: 150, y: 294 } },
  { id: "rear_quarter_l", x: 30, y: 388, w: 70, h: 128, d: archedPanel(30, 388, 70, 128, 452, "l", true), label: { x: 77, y: 452 } },
  { id: "rear_quarter_r", x: 200, y: 388, w: 70, h: 128, d: archedPanel(200, 388, 70, 128, 452, "r", true), label: { x: 223, y: 452 } },
  {
    id: "boot_lid",
    x: 104,
    y: 388,
    w: 92,
    h: 128,
    d: "M104 388H196V500Q196 516 180 516H120Q104 516 104 500Z",
    detail: "M136 504h28",
    label: { x: 150, y: 446 },
  },
];

/** Body silhouette, glass, tyres, bumper and centreline: line detail behind the panels. */
export const BODY = {
  silhouette:
    "M70 1H230Q251 1 251 22L253 53Q273 55 273 80V200Q299 203 299 220V380Q299 386 273 387V520Q273 549 240 551H60Q27 549 27 520V387Q1 386 1 380V220Q1 203 27 200V80Q27 55 47 53L49 22Q49 1 70 1Z",
  windscreen: "M108 206H192L196 226H104Z",
  rearScreen: "M104 362H196L192 382H108Z",
  tyres: ["M16 108h28v40h-28z", "M256 108h28v40h-28z", "M16 432h28v40h-28z", "M256 432h28v40h-28z"],
  bumper: "M64 522H236Q246 522 246 532V538Q246 546 236 546H64Q54 546 54 538V532Q54 522 64 522Z",
  centreline: "M150 0V552",
};
