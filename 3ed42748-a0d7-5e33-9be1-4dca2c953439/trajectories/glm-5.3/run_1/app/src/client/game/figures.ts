// Presence: heartbeats, the read cycle, and the matching of entries to drawn figures.

import { arcM } from "../../shared/geometry.js";

export type PresenceEntry = {
  display_name: string;
  satchel_colour: string;
  position: { lat: number; lon: number; heading_deg: number };
  emote: "wave" | "cheer" | "sleepy" | "heart" | null;
};

export type Figure = {
  id: string;
  group: THREE.Group;
  tag: string;
  shownLat: number;
  shownLon: number;
  targetLat: number;
  targetLon: number;
  headingDeg: number;
  glideFrom: { lat: number; lon: number };
  glideStartedAt: number;
  glideDurationMs: number;
  fade: "in" | "shown" | "out";
  fadeStartedAt: number;
  satchelColour: string;
  emote: string | null;
  emoteAt: number | null;
};

import type * as THREE from "three";

export const GLIDE_MS = 1000; // 0.8–1.2 s
export const FADE_MS = 300; // 0.2–0.4 s
export const SNAP_ARC_M = 20;

/**
 * Matches presence entries to drawn figures: first by equal display name (nearest shown
 * position wins), then each remaining entry takes over a remaining figure whose courier is
 * gone and whose shown position is within 20 m of arc; the rest are new or leaving.
 */
export function matchFigures(entries: PresenceEntry[], figures: Map<string, Figure>, now: number): {
  pairings: Array<{ entry: PresenceEntry; figure: Figure }>;
  newEntries: PresenceEntry[];
  takenOver: Array<{ entry: PresenceEntry; figure: Figure }>;
  leaving: Figure[];
} {
  const remainingEntries = [...entries];
  const pairings: Array<{ entry: PresenceEntry; figure: Figure }> = [];
  const usedFigures = new Set<string>();

  // 1. Equal display names, several figures sharing a name paired by nearest shown position.
  for (const figure of [...figures.values()]) {
    if (figure.fade === "out") continue;
    const candidates = remainingEntries.filter((e) => e.display_name === figure.tag);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => arcM({ lat: figure.shownLat, lon: figure.shownLon }, a.position) - arcM({ lat: figure.shownLat, lon: figure.shownLon }, b.position));
    const entry = candidates[0];
    remainingEntries.splice(remainingEntries.indexOf(entry), 1);
    pairings.push({ entry, figure });
    usedFigures.add(figure.id);
  }

  // 2. Remaining entries take over remaining figures whose courier is gone, within 20 m of arc.
  const orphanFigures = [...figures.values()].filter((f) => !usedFigures.has(f.id) && f.fade !== "out");
  const takenOver: Array<{ entry: PresenceEntry; figure: Figure }> = [];
  for (const figure of orphanFigures) {
    const idx = remainingEntries.findIndex((e) => arcM({ lat: figure.shownLat, lon: figure.shownLon }, e.position) <= SNAP_ARC_M);
    if (idx >= 0) {
      const entry = remainingEntries.splice(idx, 1)[0];
      takenOver.push({ entry, figure });
      usedFigures.add(figure.id);
    }
  }

  const newEntries = [...remainingEntries];
  const leaving = [...figures.values()].filter((f) => !usedFigures.has(f.id) && f.fade !== "out");
  return { pairings, newEntries, takenOver, leaving };
}
