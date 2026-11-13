import type { Tolerance } from "./types.js";

export const MM_PER_IN = 25.4;

type Units = "mm" | "in";

/** The single place that converts display units to stored millimetres. */
export function unitToMm(value: number, units: Units): number {
  return units === "in" ? value * MM_PER_IN : value;
}

export function mmToUnit(mm: number, units: Units): number {
  return units === "in" ? mm / MM_PER_IN : mm;
}

function toLengthMm(raw: number | string | undefined, displayUnits: Units, fallback: number): number | string {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : "Enter a number, optionally followed by mm or in.";
  }
  if (raw === undefined || raw === null) return fallback;
  return parseLengthText(raw, displayUnits);
}

/** Parses the length input grammar. Returns millimetres, or a field message on failure. */
export function parseLengthText(text: string, displayUnits: Units): number | string {
  const s = text.trim();
  if (s === "") return "Enter a number, optionally followed by mm or in.";
  const m = /^(-?[0-9]+(?:\.[0-9]*)?|-?\.[0-9]+)\s*(mm|in)?$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return "Enter a number, optionally followed by mm or in.";
    return m[2] === undefined ? unitToMm(n, displayUnits) : m[2].toLowerCase() === "in" ? n * MM_PER_IN : n;
  }
  const f = /^(-?[0-9]+)\s*\/\s*([0-9]+)\s*(mm|in)?$/i.exec(s);
  if (f) {
    const den = Number(f[2]);
    if (den === 0) return "Enter a number, optionally followed by mm or in.";
    const n = Number(f[1]) / den;
    return f[3] === undefined ? unitToMm(n, displayUnits) : f[3].toLowerCase() === "in" ? n * MM_PER_IN : n;
  }
  return "Enter a number, optionally followed by mm or in.";
}

/**
 * The single entry point for any length field coming from a request:
 * accepts a millimetre number or the length text grammar.
 */
export function requestLength(
  raw: number | string | undefined,
  displayUnits: Units,
  options: { kind: "length" | "coordinate"; fallback?: number } = { kind: "length" }
): { value: number } | { error: string } {
  const out = toLengthMm(raw, displayUnits, options.fallback ?? 0);
  if (typeof out === "string") return { error: out };
  if (options.kind === "length") {
    if (!(out > 0 && out <= 10000)) return { error: "Enter a length greater than 0 and at most 10000 mm." };
  } else {
    if (!(out >= -10000 && out <= 10000)) return { error: "Enter a coordinate from −10000 mm to 10000 mm." };
  }
  return { value: out };
}

export function parseTolerance(
  raw: unknown,
  displayUnits: Units
): { value: Tolerance | null } | { error: string } {
  if (raw === null) return { value: null };
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return { value: null };
    return parseToleranceText(s, displayUnits);
  }
  if (typeof raw === "object" && raw !== null) {
    const t = raw as Record<string, unknown>;
    if (t.kind === "symmetric") {
      const v = toLengthMm(t.value as number | string | undefined, displayUnits, Number.NaN);
      if (typeof v === "string" || typeof v !== "number" || !(v >= 0 && v <= 10000))
        return { error: "Enter a tolerance like ±0.05 or +0.1/−0.05." };
      return { value: { kind: "symmetric", plus_mm: v, minus_mm: v } };
    }
    if (t.kind === "asymmetric") {
      const p = toLengthMm(t.plus as number | string | undefined, displayUnits, Number.NaN);
      const m = toLengthMm(t.minus as number | string | undefined, displayUnits, Number.NaN);
      if (
        typeof p === "string" ||
        typeof m === "string" ||
        typeof p !== "number" ||
        typeof m !== "number" ||
        !(p >= 0 && p <= 10000) ||
        !(m >= 0 && m <= 10000)
      )
        return { error: "Enter a tolerance like ±0.05 or +0.1/−0.05." };
      return { value: { kind: "asymmetric", plus_mm: p, minus_mm: m } };
    }
  }
  return { error: "Enter a tolerance like ±0.05 or +0.1/−0.05." };
}

function parseToleranceText(s: string, displayUnits: Units): { value: Tolerance | null } | { error: string } {
  const norm = s.replace(/±/g, "+").replace(/\+-/g, "+").replace(/−/g, "-");
  let m = /^\+\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*(mm|in)?$/i.exec(norm);
  if (m) {
    const n = Number(m[1]);
    const mm = m[2] === undefined ? unitToMm(n, displayUnits) : m[2].toLowerCase() === "in" ? n * MM_PER_IN : n;
    if (!(mm >= 0 && mm <= 10000)) return { error: "Enter a tolerance like ±0.05 or +0.1/−0.05." };
    return { value: { kind: "symmetric", plus_mm: mm, minus_mm: mm } };
  }
  const a = /^\+\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*\/\s*-\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*(mm|in)?$/i.exec(norm);
  if (a) {
    const p = Number(a[1]);
    const mn = Number(a[2]);
    const conv = (n: number) => (a[3] === undefined ? unitToMm(n, displayUnits) : a[3].toLowerCase() === "in" ? n * MM_PER_IN : n);
    const pm = conv(p);
    const mmn = conv(mn);
    if (!(pm >= 0 && pm <= 10000) || !(mmn >= 0 && mmn <= 10000))
      return { error: "Enter a tolerance like ±0.05 or +0.1/−0.05." };
    return { value: { kind: "asymmetric", plus_mm: pm, minus_mm: mmn } };
  }
  return { error: "Enter a tolerance like ±0.05 or +0.1/−0.05." };
}

function roundHalfAwayFromZero(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return n >= 0 ? Math.round(n * f + Number.EPSILON) / f : -Math.round(-n * f + Number.EPSILON) / f;
}

function formatUnit(value: number, units: Units, precision: number, suffix: string): string {
  const shown = roundHalfAwayFromZero(mmToUnit(value, units), precision);
  return `${shown.toFixed(precision)} ${suffix}`;
}

/** The single place that formats every figure for display. */
export const display = {
  length(mm: number | null | undefined, units: Units, precision: number): string {
    if (mm === null || mm === undefined) return "—";
    return formatUnit(mm, units, precision, units);
  },
  area(mm2: number | null | undefined, units: Units, precision: number): string {
    if (mm2 === null || mm2 === undefined) return "—";
    return formatUnit(mm2, units, precision, units === "in" ? "in²" : "mm²");
  },
  volume(mm3: number | null | undefined, units: Units, precision: number): string {
    if (mm3 === null || mm3 === undefined) return "—";
    return formatUnit(mm3, units, precision, units === "in" ? "in³" : "mm³");
  },
  mass(g: number | null | undefined): string {
    if (g === null || g === undefined) return "—";
    return `${roundHalfAwayFromZero(g, 2).toFixed(2)} g`;
  },
  density(gcm3: number): string {
    return `${gcm3.toFixed(2)} g/cm³`;
  },
  centroid(mm: { x: number; y: number; z: number } | null | undefined, units: Units, precision: number): string {
    if (mm === null || mm === undefined) return "—";
    const f = (n: number) => roundHalfAwayFromZero(mmToUnit(n, units), precision).toFixed(precision);
    return `(${f(mm.x)}, ${f(mm.y)}, ${f(mm.z)}) ${units}`;
  },
  toleranceText(nominalMm: number, tolerance: Tolerance | null | undefined, units: Units, precision: number): string {
    const nom = roundHalfAwayFromZero(mmToUnit(nominalMm, units), precision).toFixed(precision);
    if (!tolerance) return nom;
    const u = units;
    const conv = (v: number) => roundHalfAwayFromZero(mmToUnit(v, u), precision).toFixed(precision);
    if (tolerance.kind === "symmetric") return `${nom} ± ${conv(tolerance.plus_mm)} ${u}`;
    return `${nom} +${conv(tolerance.plus_mm)} −${conv(tolerance.minus_mm)} ${u}`;
  }
};
