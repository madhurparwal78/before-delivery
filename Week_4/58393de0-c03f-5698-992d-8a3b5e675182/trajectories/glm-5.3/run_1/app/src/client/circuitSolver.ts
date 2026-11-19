// Circuit solver: modified nodal analysis with Newton iteration over LED
// states. Domain rule for LED status lives here — every caller uses it.
import type { CircuitComponent, CircuitSnapshot } from '../shared/scene.js';

export const LED_FORWARD_DROP = 2.0;
export const LED_RESISTANCE = 25;
export const LED_LIMIT_MA = 20.0;

export type LedStatus = 'off' | 'lit' | 'broken';
export type BatteryStatus = 'ok' | 'shorted';

export interface ComponentReading {
  label: string;
  type: CircuitComponent['type'];
  status: string;
  currentMa: number;
  voltage: number;
  brightness: number | null;
}

export interface SolveResult {
  readings: ComponentReading[];
  batteryShorted: boolean;
  ledBurnt: string | null;
  ledLit: Array<{ label: string; currentMa: number }>;
}

// Build the circuit graph: nodes are union-find groups of terminals joined
// by wires and closed switches. Open switches break the connection.
function buildNodes(components: CircuitComponent[], wires: { from: string; to: string }[]): { terminalNode: Map<string, number>; nextId: () => number } {
  const terminalNode = new Map<string, number>();
  let next = 0;
  const nodeId = (t: string) => {
    if (!terminalNode.has(t)) terminalNode.set(t, next++);
    return terminalNode.get(t)!;
  };
  for (const c of components) {
    if (c.type === 'led' || c.type === 'resistor' || c.type === 'battery' || c.type === 'switch') {
      nodeId(`${c.label}+`);
      nodeId(`${c.label}-`);
    }
  }
  // union-find
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r && parent.has(r)) r = parent.get(r)!;
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const w of wires) {
    if (!terminalNode.has(w.from) || !terminalNode.has(w.to)) continue;
    union(terminalNode.get(w.from)!, terminalNode.get(w.to)!);
  }
  for (const c of components) {
    if (c.type === 'switch' && c.closed) {
      const a = terminalNode.get(`${c.label}+`);
      const b = terminalNode.get(`${c.label}-`);
      if (a !== undefined && b !== undefined) union(a, b);
    }
  }
  const seen = new Map<number, number>();
  let compact = 0;
  const finalMap = new Map<string, number>();
  for (const [term, n] of terminalNode) {
    const root = find(n);
    if (!seen.has(root)) seen.set(root, compact++);
    finalMap.set(term, seen.get(root)!);
  }
  return { terminalNode: finalMap, nextId: () => compact };
}

export function solveCircuit(components: CircuitComponent[], wires: { from: string; to: string }[]): SolveResult {
  const { terminalNode, nextId } = buildNodes(components, wires);
  const nodeCount = nextId();
  const batteries = components.filter((c) => c.type === 'battery');
  const leds = components.filter((c) => c.type === 'led');
  const resistors = components.filter((c) => c.type === 'resistor');

  // A battery whose terminals share a node (joined by wires and closed
  // switches alone) is short-circuited: every current is 0.
  const shortedBatteries = new Set(batteries.filter((b) => isBatteryShorted(b, terminalNode)).map((b) => b.label));
  if (batteries.length > 0 && shortedBatteries.size === batteries.length) {
    const readings: ComponentReading[] = components.map((c) => ({
      label: c.label,
      type: c.type,
      status: c.type === 'battery' ? 'shorted' : c.type === 'led' ? (c.broken ? 'broken' : 'off') : c.type === 'switch' ? (c.closed ? 'closed' : 'open') : 'ok',
      currentMa: 0,
      voltage: c.type === 'battery' ? round2(c.volts ?? 9) : 0,
      brightness: 0,
    }));
    return { readings, batteryShorted: true, ledBurnt: null, ledLit: [] };
  }

  // Ground the first battery's negative terminal.
  const firstBattery = batteries[0];
  const GND = firstBattery ? (terminalNode.get(`${firstBattery.label}-`) ?? 0) : 0;
  const nodeIds = new Set<number>();
  for (const id of terminalNode.values()) nodeIds.add(id);
  const remap = new Map<number, number>();
  let compact = 0;
  for (const id of terminalNode.values()) {
    if (!remap.has(id)) remap.set(id, compact++);
  }
  for (const [term, id] of [...terminalNode.entries()]) terminalNode.set(term, remap.get(id)!);
  const size = Math.max(1, nodeIds.size - 1); // unknown node voltages

  // MNA: unknowns = node voltages + battery currents.
  const n = size + batteries.length;
  void nodeCount;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const z: number[] = new Array<number>(n).fill(0);

  // Unknown index for a node: nodes other than GND get 0..size-1.
  const unk: number[] = [];
  for (const id of new Set(terminalNode.values())) if (id !== GND) unk.push(id);
  const unkIndexOf = new Map<number, number>();
  unk.forEach((id, i) => unkIndexOf.set(id, i));
  const idx = (node: number): number => unkIndexOf.get(node) ?? -1;

  const addResistor = (nA: number, nB: number, ohms: number): void => {
    const g = 1 / ohms;
    const ia = idx(nA);
    const ib = idx(nB);
    if (ia >= 0) A[ia]![ia]! += g;
    if (ib >= 0) A[ib]![ib]! += g;
    if (ia >= 0 && ib >= 0) {
      A[ia]![ib]! -= g;
      A[ib]![ia]! -= g;
    }
  };

  const ledState = new Map<string, LedStatus>();
  for (const led of leds) ledState.set(led.label, led.broken ? 'broken' : 'off');

  let iterations = 0;
  let batteryShorted = false;
  let result: SolveResult | null = null;
  while (iterations < 30) {
    iterations++;
    for (let i = 0; i < n; i++) { A[i] = new Array<number>(n).fill(0); z[i] = 0; }

    for (const r of resistors) {
      const a = terminalNode.get(`${r.label}+`);
      const b = terminalNode.get(`${r.label}-`);
      if (a === undefined || b === undefined) continue;
      addResistor(a, b, r.ohms ?? 1000);
    }

    // Conducting LEDs: Vf source in series with 25 Ω. Non-conducting LEDs
    // are stamped the same way for the probe; the consistency check below
    // flips a LED to off when its solved forward current is not positive.
    for (const led of leds) {
      const a = terminalNode.get(`${led.label}+`);
      const b = terminalNode.get(`${led.label}-`);
      if (a === undefined || b === undefined) continue;
      const state = ledState.get(led.label)!;
      if (state === 'broken') continue;
      const g = 1 / LED_RESISTANCE;
      const idxA = idx(a);
      const idxB = idx(b);
      if (idxA >= 0) { A[idxA]![idxA]! += g; }
      if (idxB >= 0) { A[idxB]![idxB]! += g; }
      if (idxA >= 0 && idxB >= 0) {
        A[idxA]![idxB]! -= g;
        A[idxB]![idxA]! -= g;
      }
      // source pushing Vf from anode to cathode
      const i0 = LED_FORWARD_DROP / LED_RESISTANCE;
      if (idxA >= 0) z[idxA]! += i0;
      if (idxB >= 0) z[idxB]! -= i0;
    }

    // Batteries: ideal source between + and - with unknown current.
    for (let bi = 0; bi < batteries.length; bi++) {
      const bat = batteries[bi]!;
      const a = terminalNode.get(`${bat.label}+`);
      const b = terminalNode.get(`${bat.label}-`);
      if (a === undefined || b === undefined) continue;
      const col = size + bi;
      const ia = idx(a);
      const ib = idx(b);
      if (ia >= 0) { A[ia]![col]! += 1; A[col]![ia]! += 1; }
      if (ib >= 0) { A[ib]![col]! -= 1; A[col]![ib]! -= 1; }
      z[col] = bat.volts ?? 9;
    }

    const x = solveLinear(A, z);
    if (!x) break;

    // Check LED consistency against the probe solution.
    let changed = false;
    const litCurrents = new Map<string, number>();
    for (const led of leds) {
      const a = terminalNode.get(`${led.label}+`);
      const b = terminalNode.get(`${led.label}-`);
      if (a === undefined || b === undefined) continue;
      const va = idx(a) < 0 ? 0 : (x[idx(a)] ?? 0);
      const vb = idx(b) < 0 ? 0 : (x[idx(b)] ?? 0);
      const state = ledState.get(led.label)!;
      if (state === 'broken') continue;
      const iForward = (va - vb - LED_FORWARD_DROP) / LED_RESISTANCE;
      if (iForward > 0) {
        litCurrents.set(led.label, iForward * 1000);
        if (state !== 'lit') { ledState.set(led.label, 'lit'); changed = true; }
      } else if (state === 'lit') {
        ledState.set(led.label, 'off');
        changed = true;
      }
    }
    if (changed) continue;

    // Converged: build the readings.
    const readings: ComponentReading[] = [];
    batteryShorted = detectShort(batteries, terminalNode);
    let ledBurnt: string | null = null;
    const ledLit: Array<{ label: string; currentMa: number }> = [];
    for (const c of components) {
      const a = terminalNode.get(`${c.label}+`);
      const b = terminalNode.get(`${c.label}-`);
      const va = a === undefined || idx(a) < 0 ? 0 : (x[idx(a)] ?? 0);
      const vb = b === undefined || idx(b) < 0 ? 0 : (x[idx(b)] ?? 0);
      const v = va - vb;
      if (c.type === 'battery') {
        const shorted = isBatteryShorted(c, terminalNode);
        const batIndex = batteries.indexOf(c);
        const currentMa = shorted ? 0 : round1(Math.abs(x[size + batIndex] ?? 0) * 1000);
        readings.push({ label: c.label, type: 'battery', status: shorted ? 'shorted' : 'ok', currentMa, voltage: round2(Math.abs(v)), brightness: null });
      } else if (c.type === 'resistor') {
        const i = Math.abs(v) / (c.ohms ?? 1000);
        readings.push({ label: c.label, type: 'resistor', status: 'ok', currentMa: round1(i * 1000), voltage: round2(Math.abs(v)), brightness: null });
      } else if (c.type === 'switch') {
        readings.push({ label: c.label, type: 'switch', status: c.closed ? 'closed' : 'open', currentMa: 0, voltage: round2(Math.abs(v)), brightness: null });
      } else {
        const state = ledState.get(c.label)!;
        const currentMa = state === 'lit' ? (litCurrents.get(c.label) ?? 0) : 0;
        if (state === 'lit' && currentMa > LED_LIMIT_MA) {
          ledState.set(c.label, 'broken');
          ledBurnt = c.label;
          readings.push({ label: c.label, type: 'led', status: 'broken', currentMa: round1(currentMa), voltage: round2(Math.abs(v)), brightness: 1 });
        } else {
          const status: LedStatus = state === 'broken' ? 'broken' : state === 'lit' ? 'lit' : 'off';
          readings.push({ label: c.label, type: 'led', status, currentMa: round1(currentMa), voltage: round2(Math.abs(v)), brightness: status === 'lit' ? round2(Math.min(1, currentMa / LED_LIMIT_MA)) : 0 });
          if (status === 'lit') ledLit.push({ label: c.label, currentMa: round1(currentMa) });
        }
      }
    }
    result = { readings, batteryShorted, ledBurnt, ledLit };
    break;
  }
  return result ?? { readings: [], batteryShorted: false, ledBurnt: null, ledLit: [] };
}

function isBatteryShorted(bat: CircuitComponent, terminalNode: Map<string, number>): boolean {
  const a = terminalNode.get(`${bat.label}+`);
  const b = terminalNode.get(`${bat.label}-`);
  if (a === undefined || b === undefined) return false;
  // Only wires and closed switches join terminals in the union pass, so a
  // shared node means the battery is shorted.
  return a === b;
}

function detectShort(batteries: CircuitComponent[], terminalNode: Map<string, number>): boolean {
  return batteries.some((b) => isBatteryShorted(b, terminalNode));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Gaussian elimination with partial pivoting; returns null if singular.
function solveLinear(A: number[][], z: number[]): number[] | null {
  const n = z.length;
  const M = A.map((row, i) => [...row, z[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

export function stoppedReadings(components: CircuitComponent[]): ComponentReading[] {
  return components.map((c) => ({
    label: c.label,
    type: c.type,
    status: c.type === 'battery' ? 'ok' : c.type === 'led' ? (c.broken ? 'broken' : 'off') : c.type === 'switch' ? (c.closed ? 'closed' : 'open') : 'ok',
    currentMa: 0,
    voltage: c.type === 'battery' ? (c.volts ?? 9) : 0,
    brightness: 0,
  }));
}

export function circuitSnapshotOf(components: CircuitComponent[], wires: { from: string; to: string }[]): CircuitSnapshot {
  return {
    kind: 'circuit',
    components: components.map((c) => ({ ...c })),
    wires: wires.map((w) => ({ ...w })),
  };
}
