import { MINUS } from "../../shared/copy";
import { RESISTANCE_MAX, RESISTANCE_MIN, VOLTAGE_MAX, VOLTAGE_MIN } from "../../shared/limits";
import type { CircuitComponent, CircuitPartType, CircuitWire, SnapshotCircuit } from "../../shared/types";

export type TerminalSign = "+" | "-";

export const DEFAULT_VOLTS = 9;
export const DEFAULT_OHMS = 1000;

const PART_PREFIX: Record<CircuitPartType, string> = { battery: "BAT", led: "LED", resistor: "R", switch: "SW" };
export const PART_TYPES: readonly CircuitPartType[] = ["battery", "led", "resistor", "switch"];
export const PART_NAMES: Record<CircuitPartType, string> = { battery: "Battery", led: "LED", resistor: "Resistor", switch: "Switch" };

interface TerminalRef {
  label: string;
  sign: TerminalSign;
}

/** The snapshot spelling of a terminal: the label then an ASCII `+` or `-`. */
export function terminalEnd({ label, sign }: TerminalRef): string {
  return `${label}${sign}`;
}

export function parseEnd(end: string): TerminalRef | null {
  const sign = end.slice(-1);
  const label = end.slice(0, -1);
  return (sign === "+" || sign === "-") && label.length > 0 ? { label, sign } : null;
}

/** How the screen spells a terminal sign: the typographic minus replaces the hyphen. */
export function signGlyph(sign: TerminalSign): string {
  return sign === "+" ? "+" : MINUS;
}

/** The on-screen name of a snapshot terminal end, such as `BAT-1 +` or `R-1 −`. */
export function endName(end: string): string {
  const ref = parseEnd(end);
  return ref ? `${ref.label} ${signGlyph(ref.sign)}` : end;
}

export function wireName(wire: CircuitWire): string {
  return `${endName(wire.from)} to ${endName(wire.to)}`;
}

export function emptyCircuit(): SnapshotCircuit {
  return { kind: "circuit", components: [], wires: [] };
}

/** Fills every field a part is expected to carry; stored circuits may leave defaults out. */
function normaliseComponent(component: CircuitComponent): CircuitComponent {
  switch (component.type) {
    case "battery": return { label: component.label, type: "battery", volts: component.volts ?? DEFAULT_VOLTS };
    case "led": return { label: component.label, type: "led", broken: component.broken ?? false };
    case "resistor": return { label: component.label, type: "resistor", ohms: component.ohms ?? DEFAULT_OHMS };
    case "switch": return { label: component.label, type: "switch", closed: component.closed ?? false };
  }
}

export function normaliseCircuit(snapshot: SnapshotCircuit): SnapshotCircuit {
  return { kind: "circuit", components: snapshot.components.map(normaliseComponent), wires: snapshot.wires.map((w) => ({ from: w.from, to: w.to })) };
}

export function nextLabel(components: readonly CircuitComponent[], type: CircuitPartType): string {
  const prefix = `${PART_PREFIX[type]}-`;
  const highest = components
    .filter((c) => c.type === type)
    .reduce((top, c) => Math.max(top, Number(c.label.slice(prefix.length)) || 0), 0);
  return `${prefix}${highest + 1}`;
}

export function addPart(circuit: SnapshotCircuit, type: CircuitPartType): { circuit: SnapshotCircuit; label: string } {
  const label = nextLabel(circuit.components, type);
  const part = normaliseComponent({ label, type });
  return { circuit: { ...circuit, components: [...circuit.components, part] }, label };
}

/** Deleting a part also deletes every wire that touches it. */
export function removePart(circuit: SnapshotCircuit, label: string): SnapshotCircuit {
  const touches = (end: string) => parseEnd(end)?.label === label;
  return {
    ...circuit,
    components: circuit.components.filter((c) => c.label !== label),
    wires: circuit.wires.filter((w) => !touches(w.from) && !touches(w.to)),
  };
}

export function updatePart(circuit: SnapshotCircuit, label: string, patch: Partial<CircuitComponent>): SnapshotCircuit {
  return { ...circuit, components: circuit.components.map((c) => (c.label === label ? { ...c, ...patch } : c)) };
}

function isWired(circuit: SnapshotCircuit, a: string, b: string): boolean {
  return circuit.wires.some((w) => (w.from === a && w.to === b) || (w.from === b && w.to === a));
}

type ConnectResult =
  | { outcome: "wired"; circuit: SnapshotCircuit }
  | { outcome: "duplicate" | "same" };

/** A wire joins two different terminals, and a pair of terminals carries at most one wire in either direction. */
export function connect(circuit: SnapshotCircuit, from: string, to: string): ConnectResult {
  if (from === to) return { outcome: "same" };
  if (isWired(circuit, from, to)) return { outcome: "duplicate" };
  return { outcome: "wired", circuit: { ...circuit, wires: [...circuit.wires, { from, to }] } };
}

export function removeWire(circuit: SnapshotCircuit, index: number): SnapshotCircuit {
  return { ...circuit, wires: circuit.wires.filter((_, i) => i !== index) };
}

const NUMBER_TEXT = /^\d+(\.\d+)?$/;

/** The typed value when it is a plain number inside the range, otherwise null. */
function parseInRange(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

export const parseResistance = (text: string): number | null => parseInRange(text, RESISTANCE_MIN, RESISTANCE_MAX);
export const parseVoltage = (text: string): number | null => parseInRange(text, VOLTAGE_MIN, VOLTAGE_MAX);
