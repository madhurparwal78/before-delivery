// Other couriers' figures: matching presence entries to drawn figures, gliding between reads,
// fading in and out, and emote bubbles. Presence carries no ids, so matching follows one rule:
// equal names first (nearest pairs), then a figure whose courier left the read is taken over by
// an entry within 20 m, then new figures; every unmatched figure leaves.
import { Vector3 } from "three";
import { arcMetres, latLonOf, unitVector, type LatLon } from "../../shared/geo";
import { h, setData, setText, fixed } from "../lib/dom";
import { clamp01, easePrint } from "../lib/motion";
import { RADIUS } from "./world";

const GLIDE_MS = 1000;
const FADE_MS = 300;
const BUBBLE_MS = 200;
const SNAP_M = 20;

export interface PresenceEntry {
  display_name: string;
  satchel_colour: string;
  position: { lat: number; lon: number; heading_deg: number };
  emote: string | null;
}

export class Figure {
  readonly item = h("li");
  name = "";
  colour = "canvas";
  heading = 0;
  private from = new Vector3();
  private to = new Vector3();
  private glideStart = -Infinity;
  fade: "in" | "shown" | "out" = "in";
  private fadeStart = 0;
  emote = "";
  private bubbleStart = -Infinity;
  private bubbleShown = false;
  shown = new Vector3();

  constructor(entry: PresenceEntry, now: number, reduced: boolean) {
    this.rename(entry.display_name);
    this.colour = entry.satchel_colour;
    this.to.set(...unitVector(entry.position));
    this.from.copy(this.to);
    this.shown.copy(this.to);
    this.heading = entry.position.heading_deg;
    this.fadeStart = now;
    this.fade = reduced ? "shown" : "in";
  }

  rename(name: string): void {
    this.name = name;
    setText(this.item, name);
  }

  shownLatLon(): LatLon {
    return latLonOf([this.shown.x, this.shown.y, this.shown.z]);
  }

  moveTo(position: LatLon, now: number, reduced: boolean): void {
    const next = new Vector3(...unitVector(position));
    if (next.distanceToSquared(this.to) < 1e-14) return;
    const far = arcMetres(RADIUS, this.shownLatLon(), position) > SNAP_M;
    this.from.copy(this.shown);
    this.to.copy(next);
    this.glideStart = reduced || far ? -Infinity : now;
  }

  setEmote(emote: string | null, now: number): void {
    const next = emote ?? "";
    if (next === this.emote) return;
    this.emote = next;
    this.bubbleStart = now;
    this.bubbleShown = next !== "";
  }

  leave(now: number, reduced: boolean): void {
    if (this.fade === "out") return;
    this.fade = "out";
    this.fadeStart = now;
    if (reduced) this.fadeStart = -Infinity;
  }

  /** Advances glide, fade and bubble; returns false once a leaving figure is gone. */
  update(now: number, reduced: boolean): boolean {
    const t = reduced ? 1 : clamp01((now - this.glideStart) / GLIDE_MS);
    if (t >= 1) this.shown.copy(this.to);
    else {
      const angle = Math.acos(Math.max(-1, Math.min(1, this.from.dot(this.to))));
      const e = t;
      if (angle < 1e-9) this.shown.copy(this.to);
      else {
        const s = Math.sin(angle);
        this.shown
          .copy(this.from)
          .multiplyScalar(Math.sin((1 - e) * angle) / s)
          .addScaledVector(this.to, Math.sin(e * angle) / s)
          .normalize();
      }
    }
    if (this.fade === "in" && (reduced || now - this.fadeStart >= FADE_MS)) this.fade = "shown";
    if (this.fade === "out" && (reduced || now - this.fadeStart >= FADE_MS)) return false;
    const where = this.shownLatLon();
    setData(this.item, "data-shown-lat", fixed(where.lat, 2));
    setData(this.item, "data-shown-lon", fixed(where.lon, 2));
    setData(this.item, "data-fade", this.fade);
    setData(this.item, "data-emote", this.emote);
    return true;
  }

  /** Drawn opacity 0..1. */
  opacity(now: number, reduced: boolean): number {
    if (reduced) return 1;
    if (this.fade === "in") return easePrint((now - this.fadeStart) / FADE_MS);
    if (this.fade === "out") return 1 - easePrint((now - this.fadeStart) / FADE_MS);
    return 1;
  }

  /** Bubble scale 0..1. */
  bubble(now: number, reduced: boolean): number {
    const t = reduced ? 1 : easePrint((now - this.bubbleStart) / BUBBLE_MS);
    return this.bubbleShown ? t : 1 - t;
  }

  /** The emote whose bubble is still drawn (it keeps its icon while popping out). */
  bubbleIcon = "";
}

export class Figures {
  readonly list = h("ul", { "aria-label": "Couriers nearby", class: "visually-hidden" });
  readonly figures: Figure[] = [];

  apply(entries: PresenceEntry[], now: number, reduced: boolean): void {
    const live = this.figures.filter((f) => f.fade !== "out");
    const pairs = new Map<PresenceEntry, Figure>();
    const used = new Set<Figure>();
    const names = new Set(entries.map((e) => e.display_name));
    const nearest = (entry: PresenceEntry, pool: Figure[]): Figure | undefined => {
      let best: Figure | undefined;
      let bestArc = Infinity;
      for (const f of pool) {
        const d = arcMetres(RADIUS, f.shownLatLon(), entry.position);
        if (d < bestArc) {
          best = f;
          bestArc = d;
        }
      }
      return best;
    };
    for (const entry of entries) {
      const same = live.filter((f) => !used.has(f) && f.name === entry.display_name);
      const f = nearest(entry, same);
      if (f) {
        pairs.set(entry, f);
        used.add(f);
      }
    }
    for (const entry of entries) {
      if (pairs.has(entry)) continue;
      const orphans = live.filter(
        (f) => !used.has(f) && !names.has(f.name) && arcMetres(RADIUS, f.shownLatLon(), entry.position) <= SNAP_M,
      );
      const f = nearest(entry, orphans);
      if (f) {
        pairs.set(entry, f);
        used.add(f);
      }
    }
    for (const f of live) if (!used.has(f)) f.leave(now, reduced);
    for (const entry of entries) {
      let f = pairs.get(entry);
      if (!f) {
        f = new Figure(entry, now, reduced);
        this.figures.push(f);
        this.list.append(f.item);
      } else {
        if (f.name !== entry.display_name) f.rename(entry.display_name);
        f.colour = entry.satchel_colour;
        f.heading = entry.position.heading_deg;
        f.moveTo(entry.position, now, reduced);
      }
      f.setEmote(entry.emote, now);
      if (entry.emote) f.bubbleIcon = entry.emote;
    }
    this.update(now, reduced);
  }

  update(now: number, reduced: boolean): void {
    for (let i = this.figures.length - 1; i >= 0; i--) {
      const f = this.figures[i]!;
      if (!f.update(now, reduced)) {
        f.item.remove();
        this.figures.splice(i, 1);
      }
    }
  }
}
