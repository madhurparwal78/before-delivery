// The pre-flight processes of the brief's table: ids, labels, limits and prices.
import { NNBSP } from "./numbers";
import type { Vec3 } from "./tine";

export interface Process {
  id: "fdm-04" | "mill-3" | "laser-sheet";
  label: string;
  /** Maximum part size per axis, in millimetres. */
  envelope: Vec3;
  /** A wall below `blocking` is Blocking; below `advisory` it is Advisory. */
  wall: { blocking: number; advisory: number };
  /** Maximum hole depth divided by diameter, or null when the process has no limit. */
  depthLimit: number | null;
  setup: number;
  /** Price per cm³. */
  rate: number;
  leadTime: string;
}

export const PROCESSES: readonly Process[] = [
  { id: "fdm-04", label: `FDM print, 0.4${NNBSP}mm nozzle`, envelope: [220, 220, 250], wall: { blocking: 1.2, advisory: 2 }, depthLimit: null, setup: 2, rate: 0.06, leadTime: "2–4 working days" },
  { id: "mill-3", label: "Three-axis mill", envelope: [300, 200, 100], wall: { blocking: 1, advisory: 1.5 }, depthLimit: 6, setup: 40, rate: 0.45, leadTime: "5–10 working days" },
  { id: "laser-sheet", label: "Laser-cut sheet", envelope: [600, 400, 6], wall: { blocking: 1.5, advisory: 3 }, depthLimit: null, setup: 8, rate: 0.3, leadTime: "3–6 working days" },
];

export function leadTime(id: string): string {
  return PROCESSES.find((p) => p.id === id)?.leadTime ?? "";
}
