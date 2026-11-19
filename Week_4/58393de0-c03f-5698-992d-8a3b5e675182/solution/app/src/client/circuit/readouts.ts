import { OHM } from "../../shared/copy";
import type { CircuitComponent } from "../../shared/types";
import { brightnessOf, partStatus, type PartStatus, type Solution } from "./solver";

/** Everything the screen and the hidden state element say about one part. */
export interface PartView {
  label: string;
  status: PartStatus;
  /** The state words of the part's accessible name. */
  words: string;
  currentMa: string;
  volts: string;
  /** Present for LEDs only. */
  brightness: string | null;
  /** The unrounded LED brightness, for drawing. */
  glow: number;
}

export function formatMa(milliamps: number): string {
  return milliamps.toFixed(1);
}

function wordsOf(part: CircuitComponent, status: PartStatus, currentMa: string): string {
  if (part.type === "resistor") return `${part.ohms} ${OHM}`;
  switch (status) {
    case "shorted": return "short-circuited";
    case "broken": return "burnt out";
    case "lit": return `lit ${currentMa} mA`;
    default: return status;
  }
}

/** `solution` is null while the simulation is stopped: every current reads 0.0 and lit LEDs read off. */
export function viewOf(part: CircuitComponent, solution: Solution | null): PartView {
  const reading = solution?.readings.get(part.label);
  const status = partStatus(part, solution);
  const currentMa = formatMa(reading?.currentMa ?? 0);
  const glow = part.type === "led" && status === "lit" ? brightnessOf(reading) : 0;
  return {
    label: part.label,
    status,
    words: wordsOf(part, status, currentMa),
    currentMa,
    volts: (reading?.volts ?? 0).toFixed(2),
    brightness: part.type === "led" ? glow.toFixed(2) : null,
    glow,
  };
}

export function groupName(view: PartView): string {
  return `${view.label}, ${view.words}`;
}
