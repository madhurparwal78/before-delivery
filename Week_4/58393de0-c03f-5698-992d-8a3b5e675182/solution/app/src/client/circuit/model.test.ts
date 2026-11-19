import { describe, expect, it } from "vitest";
import type { SnapshotCircuit } from "../../shared/types";
import { addPart, connect, emptyCircuit, endName, nextLabel, parseResistance, parseVoltage, removePart } from "./model";
import { circuitSvg } from "./svg";

describe("labels and parts", () => {
  it("numbers each kind in insertion order with the stored defaults", () => {
    let circuit = emptyCircuit();
    const labels: string[] = [];
    for (const type of ["battery", "led", "resistor", "switch", "led", "battery"] as const) {
      const added = addPart(circuit, type);
      circuit = added.circuit;
      labels.push(added.label);
    }
    expect(labels).toEqual(["BAT-1", "LED-1", "R-1", "SW-1", "LED-2", "BAT-2"]);
    expect(circuit.components.slice(0, 4)).toEqual([
      { label: "BAT-1", type: "battery", volts: 9 },
      { label: "LED-1", type: "led", broken: false },
      { label: "R-1", type: "resistor", ohms: 1000 },
      { label: "SW-1", type: "switch", closed: false },
    ]);
    expect(nextLabel(circuit.components, "resistor")).toBe("R-2");
  });

  it("deletes a part's wires with it", () => {
    const circuit: SnapshotCircuit = {
      kind: "circuit",
      components: [{ label: "BAT-1", type: "battery", volts: 9 }, { label: "R-1", type: "resistor", ohms: 330 }],
      wires: [{ from: "BAT-1+", to: "R-1+" }, { from: "R-1-", to: "BAT-1-" }],
    };
    expect(removePart(circuit, "R-1")).toEqual({ kind: "circuit", components: [circuit.components[0]], wires: [] });
  });
});

describe("wiring", () => {
  const circuit = emptyCircuit();
  it("refuses a second wire between the same pair in either direction, and a wire to itself", () => {
    const first = connect(circuit, "BAT-1+", "LED-1+");
    expect(first.outcome).toBe("wired");
    const wired = first.outcome === "wired" ? first.circuit : circuit;
    expect(connect(wired, "LED-1+", "BAT-1+").outcome).toBe("duplicate");
    expect(connect(wired, "BAT-1+", "LED-1+").outcome).toBe("duplicate");
    expect(connect(wired, "BAT-1+", "BAT-1+").outcome).toBe("same");
    expect(connect(wired, "BAT-1+", "BAT-1-").outcome).toBe("wired");
  });

  it("names terminals with the typographic minus", () => {
    expect(endName("R-1-")).toBe("R-1 −");
    expect(endName("BAT-1+")).toBe("BAT-1 +");
  });
});

describe("typed values", () => {
  it("accepts only numbers inside the ranges", () => {
    expect([parseResistance("1"), parseResistance("10000000"), parseResistance("330")]).toEqual([1, 10000000, 330]);
    expect([parseResistance("0"), parseResistance("10000001"), parseResistance(""), parseResistance("12ab")]).toEqual([null, null, null, null]);
    expect([parseVoltage("1"), parseVoltage("12"), parseVoltage("4.5")]).toEqual([1, 12, 4.5]);
    expect([parseVoltage("13"), parseVoltage("0.5"), parseVoltage("-3")]).toEqual([null, null, null]);
  });
});

describe("circuitSvg", () => {
  const night: SnapshotCircuit = {
    kind: "circuit",
    components: [{ label: "BAT-1", type: "battery", volts: 9 }, { label: "R-1", type: "resistor", ohms: 330 }, { label: "LED-1", type: "led" }],
    wires: [{ from: "BAT-1+", to: "R-1+" }, { from: "R-1-", to: "LED-1+" }, { from: "LED-1-", to: "BAT-1-" }],
  };

  it("is a 297 by 210 mm page that lists the parts and wires, the same every time", () => {
    const svg = circuitSvg(night);
    expect(svg).toBe(circuitSvg(night));
    expect(svg).toContain('width="297mm" height="210mm" viewBox="0 0 297 210"');
    for (const text of ["BAT-1", "R-1, 330 Ω", "LED-1, off", "1. BAT-1 + to R-1 +", "3. LED-1 − to BAT-1 −"]) expect(svg).toContain(text);
    expect(svg.match(/stroke-width="5"/g)).toHaveLength(3);
  });

  it("draws an empty circuit without parts or wires", () => {
    expect(circuitSvg(emptyCircuit())).toContain("0 parts, 0 wires");
  });
});
