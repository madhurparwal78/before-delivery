import { derivePage } from "../../shared/derive.ts";
import { plainLabel } from "../../shared/label.ts";
import type { CrossingPoint, Derived, PageDoc, Point } from "../../shared/model.ts";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const tallyText = (systems: number, crossings: number) => `${count(systems, "system")} · ${count(crossings, "crossing")}`;
const tallySentence = (systems: number, crossings: number) => `${count(systems, "system")}, ${count(crossings, "crossing")}.`;

/** Whether an edit changes any zone's member set or crossing count (so the boundary tally plays). */
export function qualifies(before: Derived, after: Derived): boolean {
  const old = new Map(before.zones.map((z) => [z.id, z]));
  const now = new Map(after.zones.map((z) => [z.id, z]));
  for (const id of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(id), b = now.get(id);
    const members = (z: typeof a) => [...(z?.members ?? [])].sort().join("|");
    if ((a?.crossings ?? 0) !== (b?.crossings ?? 0) || members(a) !== members(b)) return true;
  }
  return false;
}

/** The boundary announcement for an edit: shape sentences, then the zone sentence, then updated sentences. */
export function boundarySentences(beforeDoc: PageDoc, afterDoc: PageDoc, before: Derived, after: Derived): string {
  if (!qualifies(before, after)) return "";
  const zoneName = new Map(afterDoc.zones.map((z) => [z.id, z.name]));
  const tally = new Map(after.zones.map((z) => [z.id, z]));
  const sentence = (zoneId: string) => tallySentence(tally.get(zoneId)?.systems ?? 0, tally.get(zoneId)?.crossings ?? 0);
  const zonesOf = (d: Derived, shapeId: string) => d.zones.filter((z) => z.members.includes(shapeId)).map((z) => z.id);
  const named = new Set<string>();
  const out: string[] = [];
  const oldShapes = new Map(beforeDoc.shapes.map((s) => [s.id, s]));
  const moved = afterDoc.shapes
    .filter((s) => {
      const o = oldShapes.get(s.id);
      return o && (o.x !== s.x || o.y !== s.y);
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  for (const s of moved) {
    const was = zonesOf(before, s.id), is = zonesOf(after, s.id);
    const entered = is.filter((z) => !was.includes(z));
    const left = was.filter((z) => !is.includes(z));
    const label = plainLabel(s.label);
    if (entered.length) {
      for (const z of entered) {
        out.push(`${label} moved into ${zoneName.get(z)}. ${sentence(z)}`);
        named.add(z);
      }
    } else if (left.length && is.length === 0) {
      for (const z of left) {
        out.push(`${label} moved out of ${beforeDoc.zones.find((x) => x.id === z)?.name ?? ""}. ${sentence(z)}`);
        named.add(z);
      }
    }
  }
  const oldZones = new Map(beforeDoc.zones.map((z) => [z.id, z]));
  for (const z of afterDoc.zones) {
    const o = oldZones.get(z.id);
    if (!o || named.has(z.id)) continue;
    if (o.x !== z.x || o.y !== z.y) {
      out.push(`${z.name} moved. ${sentence(z.id)}`);
      named.add(z.id);
    } else if (o.width !== z.width || o.height !== z.height) {
      out.push(`${z.name} resized. ${sentence(z.id)}`);
      named.add(z.id);
    }
  }
  const oldTally = new Map(before.zones.map((z) => [z.id, z]));
  for (const z of afterDoc.zones) {
    if (named.has(z.id)) continue;
    const a = oldTally.get(z.id), b = tally.get(z.id);
    if ((a?.systems ?? 0) !== (b?.systems ?? 0) || (a?.crossings ?? 0) !== (b?.crossings ?? 0)) out.push(`${z.name} updated. ${sentence(z.id)}`);
  }
  return out.join(" ");
}

/* The signature sequence: connectors morph, markers stagger in, tallies roll. */

export interface MarkerView {
  key: string;
  zoneId: string;
  connectorId: string;
  x: number;
  y: number;
  direction: CrossingPoint["direction"];
  opacity: number;
  scale: number;
}

export interface Frame {
  connectors: Map<string, Point[]>;
  markers: MarkerView[];
  /** Per zone: the rolling [systems, crossings] from and to, and progress 0..1. */
  tallies: Map<string, { from: [number, number]; to: [number, number]; t: number }>;
}

export function markerKeys(derived: Derived): MarkerView[] {
  const seen = new Map<string, number>();
  return derived.crossings.map((c) => {
    const base = `${c.zoneId}|${c.connectorId}|${c.direction}`;
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return { key: `${base}|${k}`, zoneId: c.zoneId, connectorId: c.connectorId, x: c.x, y: c.y, direction: c.direction, opacity: 1, scale: 1 };
  });
}

const MORPH_MS = 200;
const STAGGER_MS = 35;
const POP_MS = 120;
const STAGGERED = 12;
const ROLL_MS = 320;
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

function resample(points: Point[], n: number): Point[] {
  return Array.from({ length: n }, (_, i) => points[Math.min(i, points.length - 1)]!);
}

function lerpPath(a: Point[], b: Point[], t: number): Point[] {
  const n = Math.max(a.length, b.length);
  const pa = resample(a, n), pb = resample(b, n);
  return pa.map((p, i): Point => [p[0] + (pb[i]![0] - p[0]) * t, p[1] + (pb[i]![1] - p[1]) * t]);
}

interface Sequence {
  /** Total duration in ms. */
  duration: number;
  frame(elapsed: number): Frame;
}

/** Builds the forward or reverse (undo) sequence between two documents. */
export function buildSequence(beforeDoc: PageDoc, afterDoc: PageDoc, reverse: boolean): Sequence {
  const before = derivePage(beforeDoc), after = derivePage(afterDoc);
  const oldConnectors = new Map(beforeDoc.connectors.map((c) => [c.id, c.points]));
  const morphing = afterDoc.connectors.filter((c) => {
    const o = oldConnectors.get(c.id);
    return o && JSON.stringify(o) !== JSON.stringify(c.points);
  });
  const oldMarkers = markerKeys(before), newMarkers = markerKeys(after);
  const newKeys = new Set(newMarkers.map((m) => m.key)), oldKeys = new Set(oldMarkers.map((m) => m.key));
  const staying = newMarkers.filter((m) => oldKeys.has(m.key));
  const appearing = newMarkers.filter((m) => !oldKeys.has(m.key)).sort((a, b) => (reverse ? b.x - a.x || b.y - a.y : a.x - b.x || a.y - b.y));
  const leaving = oldMarkers.filter((m) => !newKeys.has(m.key));
  const oldTally = new Map(before.zones.map((z) => [z.id, z]));
  const rolling = after.zones.filter((z) => {
    const o = oldTally.get(z.id);
    return !o || o.systems !== z.systems || o.crossings !== z.crossings;
  });

  const morphMs = morphing.length ? MORPH_MS : 0;
  const lastDelay = Math.min(appearing.length, STAGGERED) > 0 ? (Math.min(appearing.length, STAGGERED) - 1) * STAGGER_MS : 0;
  const markerMs = appearing.length || leaving.length ? Math.max(150, lastDelay + POP_MS) : 0;
  const rollMs = rolling.length ? ROLL_MS : 0;
  const order = reverse ? (["roll", "markers", "morph"] as const) : (["morph", "markers", "roll"] as const);
  const lengths = { morph: morphMs, markers: markerMs, roll: rollMs };
  const starts: Record<string, number> = {};
  let cursor = 0;
  for (const step of order) {
    starts[step] = cursor;
    cursor += lengths[step];
  }
  const progress = (step: "morph" | "markers" | "roll", elapsed: number) =>
    lengths[step] === 0 ? 1 : Math.min(1, Math.max(0, (elapsed - starts[step]!) / lengths[step]));
  const oldPos = new Map(oldMarkers.map((m) => [m.key, m]));

  return {
    duration: cursor,
    frame(elapsed) {
      const morphT = easeOut(progress("morph", elapsed));
      const connectors = new Map<string, Point[]>();
      for (const c of morphing) connectors.set(c.id, morphT >= 1 ? c.points : lerpPath(oldConnectors.get(c.id)!, c.points, morphT));
      const markersT = elapsed - starts.markers!;
      const markers: MarkerView[] = [];
      for (const m of staying) {
        const o = oldPos.get(m.key)!;
        markers.push({ ...m, x: o.x + (m.x - o.x) * morphT, y: o.y + (m.y - o.y) * morphT });
      }
      appearing.forEach((m, i) => {
        const delay = Math.min(i, STAGGERED - 1) * STAGGER_MS;
        const t = markerMs === 0 ? 1 : easeOut((markersT - delay) / POP_MS);
        if (t > 0) markers.push({ ...m, opacity: t, scale: 0.4 + 0.6 * t });
      });
      const fade = 1 - progress("markers", elapsed);
      if (fade > 0) for (const m of leaving) markers.push({ ...m, opacity: fade, scale: 1 });
      const tallies = new Map<string, { from: [number, number]; to: [number, number]; t: number }>();
      const rollT = easeOut(progress("roll", elapsed));
      for (const z of rolling) {
        const o = oldTally.get(z.id);
        tallies.set(z.id, { from: [o?.systems ?? 0, o?.crossings ?? 0], to: [z.systems, z.crossings], t: rollT });
      }
      return { connectors, markers, tallies };
    },
  };
}
