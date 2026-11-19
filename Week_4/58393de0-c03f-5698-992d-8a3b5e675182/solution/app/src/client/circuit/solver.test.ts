import { describe, expect, it } from "vitest";
import type { CircuitComponent, SnapshotCircuit } from "../../shared/types";
import { formatMa, viewOf } from "./readouts";
import { partStatus, settle, solve } from "./solver";

const battery = (volts = 9): CircuitComponent => ({ label: "BAT-1", type: "battery", volts });
const led = (broken = false): CircuitComponent => ({ label: "LED-1", type: "led", broken });
const resistor = (ohms: number): CircuitComponent => ({ label: "R-1", type: "resistor", ohms });
const toggle = (closed: boolean): CircuitComponent => ({ label: "SW-1", type: "switch", closed });

function circuit(components: CircuitComponent[], wires: [string, string][]): SnapshotCircuit {
  return { kind: "circuit", components, wires: wires.map(([from, to]) => ({ from, to })) };
}

const straight = circuit([battery(), led()], [["BAT-1+", "LED-1+"], ["LED-1-", "BAT-1-"]]);
const viaResistor = (ohms: number) =>
  circuit([battery(), resistor(ohms), led()], [["BAT-1+", "R-1+"], ["R-1-", "LED-1+"], ["LED-1-", "BAT-1-"]]);

const currentOf = (c: SnapshotCircuit, label: string) => solve(c).readings.get(label)?.currentMa ?? Number.NaN;

describe("worked values at 9 V", () => {
  it("drives 280.0 mA straight through an LED and burns it out", () => {
    expect(formatMa(currentOf(straight, "LED-1"))).toBe("280.0");
    const settled = settle(straight);
    expect(settled.burnt.map((b) => [b.label, formatMa(b.currentMa)])).toEqual([["LED-1", "280.0"]]);
    const [, burntLed] = settled.circuit.components;
    expect(burntLed?.broken).toBe(true);
    expect(settled.solution.readings.get("LED-1")?.currentMa).toBe(0);
    expect(settled.solution.readings.get("BAT-1")?.currentMa).toBe(0);
  });

  it("lights an LED at 19.7 mA, brightness 0.99, through 330 ohm", () => {
    const solution = solve(viaResistor(330));
    const [, , lamp] = viaResistor(330).components;
    expect(lamp && partStatus(lamp, solution)).toBe("lit");
    const view = lamp && viewOf(lamp, solution);
    expect(view?.currentMa).toBe("19.7");
    expect(view?.brightness).toBe("0.99");
    expect(view?.words).toBe("lit 19.7 mA");
    expect(settle(viaResistor(330)).burnt).toEqual([]);
  });

  it("lights an LED at 6.8 mA, brightness 0.34, through 1000 ohm", () => {
    const [, , lamp] = viaResistor(1000).components;
    const view = lamp && viewOf(lamp, solve(viaResistor(1000)));
    expect([view?.currentMa, view?.brightness]).toEqual(["6.8", "0.34"]);
  });

  it("reports the same current through every part of the series loop", () => {
    const solution = solve(viaResistor(330));
    for (const label of ["BAT-1", "R-1", "LED-1"]) expect(solution.readings.get(label)?.currentMa).toBeCloseTo(19.718, 2);
    expect(solution.readings.get("R-1")?.volts).toBeCloseTo(6.507, 2);
    expect(solution.readings.get("LED-1")?.volts).toBeCloseTo(2.493, 2);
  });
});

describe("limits", () => {
  it("leaves an LED at exactly 20.0 mA lit", () => {
    const edge = viaResistor(325);
    expect(settle(edge).burnt).toEqual([]);
  });

  it("burns an LED just above 20.0 mA", () => {
    expect(settle(viaResistor(324)).burnt).toHaveLength(1);
  });

  it("follows the battery voltage", () => {
    const low = circuit([battery(5), resistor(330), led()], viaResistor(330).wires.map((w) => [w.from, w.to]));
    expect(formatMa(currentOf(low, "LED-1"))).toBe("8.5");
    const high = circuit([battery(12), resistor(330), led()], viaResistor(330).wires.map((w) => [w.from, w.to]));
    expect(formatMa(settle(high).burnt[0]?.currentMa ?? 0)).toBe("28.2");
  });

  it("keeps an LED off below its 2.0 V forward drop", () => {
    const dim = circuit([battery(1), led()], [["BAT-1+", "LED-1+"], ["LED-1-", "BAT-1-"]]);
    expect(currentOf(dim, "LED-1")).toBe(0);
  });
});

describe("open paths", () => {
  it("carries nothing through a reversed LED", () => {
    const reversed = circuit([battery(), resistor(330), led()], [["BAT-1+", "R-1+"], ["R-1-", "LED-1-"], ["LED-1+", "BAT-1-"]]);
    const solution = solve(reversed);
    expect(solution.readings.get("LED-1")?.currentMa).toBe(0);
    expect(solution.readings.get("R-1")?.currentMa).toBe(0);
  });

  it("carries nothing past an open switch and everything past a closed one", () => {
    const wires: [string, string][] = [["BAT-1+", "SW-1+"], ["SW-1-", "R-1+"], ["R-1-", "LED-1+"], ["LED-1-", "BAT-1-"]];
    const open = solve(circuit([battery(), toggle(false), resistor(330), led()], wires));
    expect(["BAT-1", "SW-1", "R-1", "LED-1"].map((l) => open.readings.get(l)?.currentMa)).toEqual([0, 0, 0, 0]);
    expect(open.readings.get("SW-1")?.volts).toBeCloseTo(9, 2);
    const closed = solve(circuit([battery(), toggle(true), resistor(330), led()], wires));
    expect(formatMa(closed.readings.get("SW-1")?.currentMa ?? 0)).toBe("19.7");
  });

  it("carries nothing when a wire is missing", () => {
    const missing = circuit([battery(), resistor(330), led()], [["BAT-1+", "R-1+"], ["LED-1-", "BAT-1-"]]);
    const solution = solve(missing);
    expect(["BAT-1", "R-1", "LED-1"].map((l) => solution.readings.get(l)?.currentMa)).toEqual([0, 0, 0]);
  });

  it("treats a broken LED as an open circuit", () => {
    const broken = circuit([battery(), led(true)], [["BAT-1+", "LED-1+"], ["LED-1-", "BAT-1-"]]);
    const solution = solve(broken);
    expect(solution.readings.get("BAT-1")?.currentMa).toBe(0);
    const [, burnt] = broken.components;
    expect(burnt && partStatus(burnt, solution)).toBe("broken");
  });

  it("reads zero, without crashing, for parts nothing connects", () => {
    const loose = circuit([battery(), led(), resistor(330)], [["R-1+", "LED-1+"]]);
    const solution = solve(loose);
    for (const reading of solution.readings.values()) expect(reading.currentMa).toBe(0);
    const [, dangling] = loose.components;
    expect(dangling && partStatus(dangling, solution)).toBe("off");
  });

  it("solves an empty circuit", () => {
    expect(solve({ kind: "circuit", components: [], wires: [] }).readings.size).toBe(0);
  });
});

describe("short circuits", () => {
  it("flags a battery joined by a wire and a closed switch and zeroes every current", () => {
    const shorted = circuit([battery(), toggle(true)], [["BAT-1+", "SW-1+"], ["SW-1-", "BAT-1-"]]);
    const solution = solve(shorted);
    const [cell] = shorted.components;
    expect([...solution.shorted]).toEqual(["BAT-1"]);
    expect(cell && partStatus(cell, solution)).toBe("shorted");
    expect(cell && viewOf(cell, solution).words).toBe("short-circuited");
    for (const reading of solution.readings.values()) expect(reading.currentMa).toBe(0);
  });

  it("does not flag the same battery while the switch is open", () => {
    const open = circuit([battery(), toggle(false)], [["BAT-1+", "SW-1+"], ["SW-1-", "BAT-1-"]]);
    expect(solve(open).shorted.size).toBe(0);
  });

  it("flags a battery wired directly to itself", () => {
    expect(solve(circuit([battery()], [["BAT-1+", "BAT-1-"]])).shorted.has("BAT-1")).toBe(true);
  });
});

describe("the stopped view", () => {
  it("reads 0.0, off and ok with no solution", () => {
    const [cell, lamp, , ] = [battery(), led(), resistor(330)];
    expect(viewOf(cell, null)).toMatchObject({ status: "ok", words: "ok", currentMa: "0.0" });
    expect(viewOf(lamp, null)).toMatchObject({ status: "off", words: "off", currentMa: "0.0", brightness: "0.00" });
    expect(viewOf(led(true), null)).toMatchObject({ status: "broken", words: "burnt out" });
    expect(viewOf(resistor(330), null).words).toBe("330 Ω");
    expect(viewOf(toggle(true), null)).toMatchObject({ status: "closed", words: "closed" });
  });
});

describe("parallel LEDs", () => {
  it("shares a resistor's current between two lit LEDs", () => {
    const twin = "LED-2";
    const anode = `${twin}${"+"}`;
    const cathode = `${twin}${"-"}`;
    const pair = circuit(
      [battery(), resistor(330), led(), { label: twin, type: "led", broken: false }],
      [["BAT-1+", "R-1+"], ["R-1-", "LED-1+"], ["R-1-", anode], ["LED-1-", "BAT-1-"], [cathode, "BAT-1-"]],
    );
    const solution = solve(pair);
    expect(solution.readings.get("LED-1")?.currentMa).toBeCloseTo(solution.readings.get(twin)?.currentMa ?? 0, 6);
    expect(solution.readings.get("LED-1")?.currentMa).toBeCloseTo(10.219, 2);
  });
});
