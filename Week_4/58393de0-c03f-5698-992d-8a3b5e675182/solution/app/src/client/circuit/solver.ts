import { RESISTANCE_MIN } from "../../shared/limits";
import type { CircuitComponent, SnapshotCircuit } from "../../shared/types";
import { DEFAULT_OHMS, DEFAULT_VOLTS, terminalEnd, updatePart } from "./model";

const LED_FORWARD_VOLTS = 2.0;
const LED_SERIES_OHMS = 25;
const LED_LIMIT_MA = 20.0;

/** Ties every node weakly to ground so parts with no route to a source solve to zero instead of singular. */
const LEAK_SIEMENS = 1e-12;
/** A current below this many milliamps is numerical dust from the leak, not a current. */
const DUST_MA = 1e-6;
/** An unrounded current this far above the limit counts as above it; keeps exactly 20.0 mA safe from float noise. */
const LIMIT_MARGIN_MA = 1e-6;
const PIVOT_FLOOR = 1e-18;

interface PartReading {
  /** Absolute current in milliamps, unrounded. */
  currentMa: number;
  /** Absolute voltage across the part in volts. */
  volts: number;
}

export interface Solution {
  readings: ReadonlyMap<string, PartReading>;
  /** Labels of batteries whose + and - are joined by wires and closed switches alone. */
  shorted: ReadonlySet<string>;
}

export type PartStatus = "ok" | "shorted" | "off" | "lit" | "broken" | "open" | "closed";

class Groups {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const next = this.parent.get(key);
    if (next === undefined || next === key) return key;
    const root = this.find(next);
    this.parent.set(key, root);
    return root;
  }

  join(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
}

function terminalsOf(part: CircuitComponent): [string, string] {
  return [terminalEnd({ label: part.label, sign: "+" }), terminalEnd({ label: part.label, sign: "-" })];
}

function knownEnds(circuit: SnapshotCircuit): Set<string> {
  return new Set(circuit.components.flatMap(terminalsOf));
}

function groupedTerminals(circuit: SnapshotCircuit, throughClosedSwitches: boolean): Groups {
  const known = knownEnds(circuit);
  const groups = new Groups();
  for (const end of known) groups.find(end);
  for (const wire of circuit.wires) if (known.has(wire.from) && known.has(wire.to)) groups.join(wire.from, wire.to);
  if (throughClosedSwitches) {
    for (const part of circuit.components) if (part.type === "switch" && part.closed) groups.join(...terminalsOf(part));
  }
  return groups;
}

function shortedBatteries(circuit: SnapshotCircuit): Set<string> {
  const groups = groupedTerminals(circuit, true);
  const shorted = new Set<string>();
  for (const part of circuit.components) {
    const [plus, minus] = terminalsOf(part);
    if (part.type === "battery" && groups.find(plus) === groups.find(minus)) shorted.add(part.label);
  }
  return shorted;
}

/** Gaussian elimination with partial pivoting. A variable with no usable pivot (a floating loop of sources) reads 0. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const rows = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  const pivotColumns: number[] = [];
  let top = 0;
  for (let column = 0; column < size && top < size; column += 1) {
    let best = top;
    for (let r = top + 1; r < size; r += 1) if (Math.abs(rows[r]?.[column] ?? 0) > Math.abs(rows[best]?.[column] ?? 0)) best = r;
    const pivotRow = rows[best];
    if (!pivotRow || Math.abs(pivotRow[column] ?? 0) < PIVOT_FLOOR) continue;
    rows[best] = rows[top] ?? pivotRow;
    rows[top] = pivotRow;
    for (let r = 0; r < size; r += 1) {
      const row = rows[r];
      if (!row || r === top) continue;
      const factor = (row[column] ?? 0) / (pivotRow[column] ?? 1);
      if (factor === 0) continue;
      for (let c = column; c <= size; c += 1) row[c] = (row[c] ?? 0) - factor * (pivotRow[c] ?? 0);
    }
    pivotColumns[top] = column;
    top += 1;
  }
  const result = new Array<number>(size).fill(0);
  for (let r = 0; r < top; r += 1) {
    const column = pivotColumns[r];
    const row = rows[r];
    if (column !== undefined && row) result[column] = (row[size] ?? 0) / (row[column] ?? 1);
  }
  return result;
}

interface Network {
  nodeOf: ReadonlyMap<string, number>;
  nodeCount: number;
}

function networkOf(circuit: SnapshotCircuit): Network {
  const groups = groupedTerminals(circuit, false);
  const ids = new Map<string, number>();
  const nodeOf = new Map<string, number>();
  for (const end of knownEnds(circuit)) {
    const root = groups.find(end);
    if (!ids.has(root)) ids.set(root, ids.size);
    nodeOf.set(end, ids.get(root) ?? 0);
  }
  return { nodeOf, nodeCount: ids.size };
}

/** The first battery's - node is the 0 V reference; with no battery every node floats at 0 V through the leak. */
function groundNode(circuit: SnapshotCircuit, network: Network): number | null {
  const first = circuit.components.find((c) => c.type === "battery");
  return first ? (network.nodeOf.get(terminalEnd({ label: first.label, sign: "-" })) ?? null) : null;
}

interface Solved {
  volts: (end: string) => number;
  sourceAmps: ReadonlyMap<string, number>;
}

/** One linear solve with the given LEDs treated as conducting (2.0 V in series with 25 ohm). */
function solveWith(circuit: SnapshotCircuit, network: Network, conducting: ReadonlySet<string>): Solved {
  const sources = circuit.components.filter((c) => c.type === "battery" || (c.type === "switch" && c.closed));
  const size = network.nodeCount + sources.length;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);
  const add = (r: number, c: number, value: number) => {
    const row = matrix[r];
    if (row) row[c] = (row[c] ?? 0) + value;
  };
  const node = (end: string) => network.nodeOf.get(end) ?? 0;
  const conductance = (a: number, b: number, siemens: number) => {
    add(a, a, siemens);
    add(b, b, siemens);
    add(a, b, -siemens);
    add(b, a, -siemens);
  };

  for (let n = 0; n < network.nodeCount; n += 1) add(n, n, LEAK_SIEMENS);
  for (const part of circuit.components) {
    const [plus, minus] = terminalsOf(part);
    const a = node(plus);
    const b = node(minus);
    if (part.type === "resistor") conductance(a, b, 1 / Math.max(part.ohms ?? DEFAULT_OHMS, RESISTANCE_MIN));
    if (part.type === "led" && conducting.has(part.label)) {
      const siemens = 1 / LED_SERIES_OHMS;
      conductance(a, b, siemens);
      rhs[a] = (rhs[a] ?? 0) + siemens * LED_FORWARD_VOLTS;
      rhs[b] = (rhs[b] ?? 0) - siemens * LED_FORWARD_VOLTS;
    }
  }
  sources.forEach((part, k) => {
    const [plus, minus] = terminalsOf(part);
    const a = node(plus);
    const b = node(minus);
    const row = network.nodeCount + k;
    add(a, row, 1);
    add(b, row, -1);
    add(row, a, 1);
    add(row, b, -1);
    rhs[row] = part.type === "battery" ? (part.volts ?? DEFAULT_VOLTS) : 0;
  });

  const ground = groundNode(circuit, network);
  if (ground !== null) {
    const pinned = new Array<number>(size).fill(0);
    pinned[ground] = 1;
    matrix[ground] = pinned;
    rhs[ground] = 0;
  }
  const x = solveLinear(matrix, rhs);
  const sourceAmps = new Map<string, number>();
  sources.forEach((part, k) => sourceAmps.set(part.label, x[network.nodeCount + k] ?? 0));
  return { volts: (end) => x[node(end)] ?? 0, sourceAmps };
}

function ledAmps(solved: Solved, label: string, conducting: boolean): number {
  if (!conducting) return 0;
  const drop = solved.volts(terminalEnd({ label, sign: "+" })) - solved.volts(terminalEnd({ label, sign: "-" }));
  return (drop - LED_FORWARD_VOLTS) / LED_SERIES_OHMS;
}

/**
 * Newton-style iteration over which LEDs conduct: flip one violator at a time until every LED agrees with its own state.
 * An LED that "conducts" only leak dust has no route for current, so it is switched off and stays off.
 */
function settleLedStates(circuit: SnapshotCircuit, network: Network): { conducting: Set<string>; solved: Solved } {
  const leds = circuit.components.filter((c) => c.type === "led" && !c.broken);
  const conducting = new Set<string>();
  const noRoute = new Set<string>();
  let solved = solveWith(circuit, network, conducting);
  const drop = (label: string) => solved.volts(terminalEnd({ label, sign: "+" })) - solved.volts(terminalEnd({ label, sign: "-" }));
  for (let pass = 0; pass < 4 * leds.length + 8; pass += 1) {
    const violator = leds.find((led) =>
      conducting.has(led.label) ? ledAmps(solved, led.label, true) * 1000 <= DUST_MA : drop(led.label) > LED_FORWARD_VOLTS && !noRoute.has(led.label));
    if (!violator) break;
    if (conducting.has(violator.label)) {
      conducting.delete(violator.label);
      if (ledAmps(solved, violator.label, true) * 1000 > -DUST_MA) noRoute.add(violator.label);
    } else {
      conducting.add(violator.label);
    }
    solved = solveWith(circuit, network, conducting);
  }
  return { conducting, solved };
}

function clean(milliamps: number): number {
  const magnitude = Math.abs(milliamps);
  return magnitude < DUST_MA ? 0 : magnitude;
}

/** Solves the whole circuit once. Broken LEDs are open; they are not changed here. */
export function solve(circuit: SnapshotCircuit): Solution {
  const shorted = shortedBatteries(circuit);
  const readings = new Map<string, PartReading>();
  if (shorted.size > 0) {
    for (const part of circuit.components) readings.set(part.label, { currentMa: 0, volts: 0 });
    return { readings, shorted };
  }
  const network = networkOf(circuit);
  const { conducting, solved } = settleLedStates(circuit, network);
  for (const part of circuit.components) {
    const [plus, minus] = terminalsOf(part);
    const volts = Math.abs(solved.volts(plus) - solved.volts(minus));
    let amps = 0;
    if (part.type === "battery" || part.type === "switch") amps = solved.sourceAmps.get(part.label) ?? 0;
    if (part.type === "resistor") amps = (solved.volts(plus) - solved.volts(minus)) / Math.max(part.ohms ?? DEFAULT_OHMS, RESISTANCE_MIN);
    if (part.type === "led") amps = ledAmps(solved, part.label, conducting.has(part.label));
    readings.set(part.label, { currentMa: clean(amps * 1000), volts });
  }
  return { readings, shorted };
}

/** The one place that decides a part's status word. `solution` is null while the simulation is stopped. */
export function partStatus(part: CircuitComponent, solution: Solution | null): PartStatus {
  switch (part.type) {
    case "battery": return solution?.shorted.has(part.label) ? "shorted" : "ok";
    case "resistor": return "ok";
    case "switch": return part.closed ? "closed" : "open";
    case "led": {
      if (part.broken) return "broken";
      const reading = solution?.readings.get(part.label);
      return reading && reading.currentMa > 0 ? "lit" : "off";
    }
  }
}

/** LED brightness from its unrounded current, 0 to 1. */
export function brightnessOf(reading: PartReading | undefined): number {
  return reading ? Math.min(1, reading.currentMa / LED_LIMIT_MA) : 0;
}

interface Burnout {
  label: string;
  currentMa: number;
}

export interface Settled {
  circuit: SnapshotCircuit;
  solution: Solution;
  burnt: Burnout[];
}

/** One simulation tick: solve, burn out every LED above its limit, and solve again until none remain over it. */
export function settle(circuit: SnapshotCircuit): Settled {
  const burnt: Burnout[] = [];
  let current = circuit;
  let solution = solve(current);
  for (let pass = 0; pass <= current.components.length; pass += 1) {
    const over = current.components.filter((part) => {
      const reading = solution.readings.get(part.label);
      return part.type === "led" && !part.broken && reading !== undefined && reading.currentMa > LED_LIMIT_MA + LIMIT_MARGIN_MA;
    });
    if (over.length === 0) break;
    for (const led of over) {
      burnt.push({ label: led.label, currentMa: solution.readings.get(led.label)?.currentMa ?? 0 });
      current = updatePart(current, led.label, { broken: true });
    }
    solution = solve(current);
  }
  return { circuit: current, solution, burnt };
}
