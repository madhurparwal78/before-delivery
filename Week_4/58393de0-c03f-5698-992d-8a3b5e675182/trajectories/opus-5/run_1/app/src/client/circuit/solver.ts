import type { CircuitComponent, CircuitWire } from '../../shared/types.js';

export const LED_FORWARD_VOLTS = 2;
export const LED_SERIES_OHMS = 25;
export const LED_LIMIT_MA = 20;

export type ComponentStatus = 'ok' | 'shorted' | 'off' | 'lit' | 'broken' | 'open' | 'closed';

export interface Reading {
  label: string;
  status: ComponentStatus;
  currentMa: number;
  voltage: number;
  brightness: number | null;
}

export interface SolveResult {
  readings: Map<string, Reading>;
  burntOut: string[];
  burnCurrents: Map<string, number>;
  shortedBatteries: string[];
}

class Nets {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const seen = this.parent.get(key);
    if (seen === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (seen === key) return key;
    const root = this.find(seen);
    this.parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(a, b);
  }
}

const NEGLIGIBLE_MA = 1e-6;

const readableMa = (amps: number): number => {
  const milliamps = Math.abs(amps) * 1000;
  return milliamps < NEGLIGIBLE_MA ? 0 : milliamps;
};

const solveLinear = (matrix: number[][], vector: number[]): number[] | null => {
  const size = vector.length;
  if (size === 0) return [];
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    const swap = rows[column];
    rows[column] = rows[pivot];
    rows[pivot] = swap;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      if (factor === 0) continue;
      for (let at = column; at <= size; at += 1) rows[row][at] -= factor * rows[column][at];
    }
  }
  return rows.map((row, index) => row[size] / row[index]);
};

/**
 * Modified nodal analysis with Newton iteration over the LED states until they agree.
 * The single source of truth for currents, LED status and brightness.
 */
export const solveCircuit = (components: CircuitComponent[], wires: CircuitWire[]): SolveResult => {
  const nets = new Nets();
  for (const component of components) {
    nets.find(`${component.label}+`);
    nets.find(`${component.label}-`);
  }
  for (const wire of wires) nets.union(wire.from, wire.to);
  for (const component of components) {
    if (component.type === 'switch' && component.closed) {
      nets.union(`${component.label}+`, `${component.label}-`);
    }
  }

  const netIndex = new Map<string, number>();
  const indexOf = (terminal: string): number => {
    const root = nets.find(terminal);
    const known = netIndex.get(root);
    if (known !== undefined) return known;
    const next = netIndex.size;
    netIndex.set(root, next);
    return next;
  };
  for (const component of components) {
    indexOf(`${component.label}+`);
    indexOf(`${component.label}-`);
  }

  const batteries = components.filter((component) => component.type === 'battery');
  const shortedBatteries = batteries
    .filter((battery) => nets.find(`${battery.label}+`) === nets.find(`${battery.label}-`))
    .map((battery) => battery.label);

  const readings = new Map<string, Reading>();
  const burntOut: string[] = [];
  const burnCurrents = new Map<string, number>();
  const zero = (): void => {
    for (const component of components) {
      readings.set(component.label, {
        label: component.label,
        status:
          component.type === 'battery'
            ? shortedBatteries.includes(component.label)
              ? 'shorted'
              : 'ok'
            : component.type === 'led'
              ? component.broken
                ? 'broken'
                : 'off'
              : component.type === 'switch'
                ? component.closed
                  ? 'closed'
                  : 'open'
                : 'ok',
        currentMa: 0,
        voltage: 0,
        brightness: component.type === 'led' ? 0 : null,
      });
    }
  };

  zero();
  if (shortedBatteries.length > 0 || batteries.length === 0) return { readings, burntOut, burnCurrents, shortedBatteries };

  const nodeCount = netIndex.size;
  const ground = indexOf(`${batteries[0].label}-`);
  const leds = components.filter((component) => component.type === 'led' && !component.broken);
  const conducting = new Map<string, boolean>(leds.map((led) => [led.label, true]));

  let voltages: number[] = [];
  let sourceCurrents: number[] = [];
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const unknowns = nodeCount + batteries.length;
    const matrix = Array.from({ length: unknowns }, () => new Array<number>(unknowns).fill(0));
    const vector = new Array<number>(unknowns).fill(0);

    const stampConductance = (from: number, to: number, conductance: number): void => {
      matrix[from][from] += conductance;
      matrix[to][to] += conductance;
      matrix[from][to] -= conductance;
      matrix[to][from] -= conductance;
    };

    for (const component of components) {
      const plus = indexOf(`${component.label}+`);
      const minus = indexOf(`${component.label}-`);
      if (component.type === 'resistor') {
        stampConductance(plus, minus, 1 / (component.ohms ?? 1000));
      } else if (component.type === 'led' && conducting.get(component.label)) {
        const conductance = 1 / LED_SERIES_OHMS;
        stampConductance(plus, minus, conductance);
        vector[plus] += conductance * LED_FORWARD_VOLTS;
        vector[minus] -= conductance * LED_FORWARD_VOLTS;
      }
    }
    batteries.forEach((battery, index) => {
      const row = nodeCount + index;
      const plus = indexOf(`${battery.label}+`);
      const minus = indexOf(`${battery.label}-`);
      matrix[plus][row] += 1;
      matrix[minus][row] -= 1;
      matrix[row][plus] += 1;
      matrix[row][minus] -= 1;
      vector[row] = battery.volts ?? 9;
    });
    // A tiny conductance to ground keeps floating nodes solvable; it carries no readable current.
    for (let node = 0; node < nodeCount; node += 1) matrix[node][node] += 1e-12;
    for (let column = 0; column < unknowns; column += 1) matrix[ground][column] = 0;
    matrix[ground][ground] = 1;
    vector[ground] = 0;

    const solution = solveLinear(matrix, vector);
    if (!solution) return { readings, burntOut, burnCurrents, shortedBatteries };
    voltages = solution.slice(0, nodeCount);
    sourceCurrents = solution.slice(nodeCount);

    let changed = false;
    for (const led of leds) {
      const across = voltages[indexOf(`${led.label}+`)] - voltages[indexOf(`${led.label}-`)];
      const isConducting = conducting.get(led.label) === true;
      const current = (across - LED_FORWARD_VOLTS) / LED_SERIES_OHMS;
      if (isConducting && current <= 0) {
        conducting.set(led.label, false);
        changed = true;
      } else if (!isConducting && across > LED_FORWARD_VOLTS) {
        conducting.set(led.label, true);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const component of components) {
    const plus = indexOf(`${component.label}+`);
    const minus = indexOf(`${component.label}-`);
    const across = (voltages[plus] ?? 0) - (voltages[minus] ?? 0);
    if (component.type === 'resistor') {
      const ohms = component.ohms ?? 1000;
      const amps = across / ohms;
      readings.set(component.label, {
        label: component.label,
        status: 'ok',
        currentMa: readableMa(amps),
        voltage: Math.abs(across),
        brightness: null,
      });
    } else if (component.type === 'led') {
      if (component.broken) {
        readings.set(component.label, {
          label: component.label,
          status: 'broken',
          currentMa: 0,
          voltage: Math.abs(across),
          brightness: 0,
        });
        continue;
      }
      const amps = conducting.get(component.label) ? (across - LED_FORWARD_VOLTS) / LED_SERIES_OHMS : 0;
      const milliamps = amps <= 0 ? 0 : readableMa(amps);
      const broken = milliamps > LED_LIMIT_MA;
      if (broken) {
        burntOut.push(component.label);
        burnCurrents.set(component.label, milliamps);
      }
      readings.set(component.label, {
        label: component.label,
        status: broken ? 'broken' : milliamps > 0 ? 'lit' : 'off',
        currentMa: milliamps,
        voltage: conducting.get(component.label) ? Math.abs(across) : Math.abs(across),
        brightness: broken ? 0 : Math.min(1, milliamps / LED_LIMIT_MA),
      });
    } else if (component.type === 'switch') {
      readings.set(component.label, {
        label: component.label,
        status: component.closed ? 'closed' : 'open',
        currentMa: 0,
        voltage: component.closed ? 0 : Math.abs(across),
        brightness: null,
      });
    } else {
      const index = batteries.findIndex((battery) => battery.label === component.label);
      const amps = index >= 0 ? -(sourceCurrents[index] ?? 0) : 0;
      readings.set(component.label, {
        label: component.label,
        status: 'ok',
        currentMa: readableMa(amps),
        voltage: component.volts ?? 9,
        brightness: null,
      });
    }
  }

  // A burnt-out LED stops every current in series with it, so re-solve with it open.
  if (burntOut.length > 0) {
    const withBroken = components.map((component) =>
      burntOut.includes(component.label) ? { ...component, broken: true } : component,
    );
    const again = solveCircuit(withBroken, wires);
    return { readings: again.readings, burntOut, burnCurrents, shortedBatteries };
  }

  return { readings, burntOut, burnCurrents, shortedBatteries };
};

/** The state words used in a component's accessible name. */
export const stateWords = (component: CircuitComponent, reading: Reading | undefined): string => {
  if (component.type === 'battery') return reading?.status === 'shorted' ? 'short-circuited' : 'ok';
  if (component.type === 'resistor') return `${component.ohms ?? 1000} Ω`;
  if (component.type === 'switch') return component.closed ? 'closed' : 'open';
  if (!reading || reading.status === 'off') return component.broken ? 'burnt out' : 'off';
  if (reading.status === 'broken') return 'burnt out';
  return `lit ${reading.currentMa.toFixed(1)} mA`;
};
