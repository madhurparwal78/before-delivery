// The Programme Lattice as geometry, built from live programme data. Four day-slabs stacked in depth, one
// pillar per venue through all of them, one bar per session along its slab at its venue (x = time of the
// festival day, 05:00 to 05:00), and a swatch per discipline. Both the WebGL scene and the static SVG draw this.
import type { Programme } from "../types.ts";

const SLAB_WIDTH = 20;
const LANE_HEIGHT = 0.9;
const SLAB_GAP = 4.2;
const BAR_DEPTH = 0.36;

type SlabShape = { key: string; date: string; label: string; index: number; z: number; width: number; height: number };
type PillarShape = { key: string; venueId: string; name: string; y: number };
type BarShape = {
  key: string; sessionId: string; title: string; discipline: string; venueId: string; date: string; cancelled: boolean;
  x0: number; x1: number; y: number; z: number;
};
type SwatchShape = { key: string; disciplineId: string; name: string; x: number; y: number; z: number };
export type LatticeModel = { slabs: SlabShape[]; pillars: PillarShape[]; bars: BarShape[]; swatches: SwatchShape[]; height: number };

const DISCIPLINE_COLOURS: Record<string, string> = {
  sound: "#7FB3FF", light: "#FFD23F", performance: "#FF8FC7", "moving-image": "#B3A6FF", code: "#3FE0C5",
};
export const colourOf = (discipline: string) => DISCIPLINE_COLOURS[discipline] ?? "#F4EDE1";

export function buildModel(programme: Programme): LatticeModel {
  const lanes = programme.venues.length;
  const height = Math.max(1, lanes) * LANE_HEIGHT;
  const laneY = (i: number) => height / 2 - LANE_HEIGHT * (i + 0.5);
  const slabs = programme.festival_days.map((d, index) => ({
    key: `day:${d.date}`, date: d.date, label: d.label, index, z: -index * SLAB_GAP, width: SLAB_WIDTH, height,
  }));
  const pillars = programme.venues.map((v, i) => ({ key: `venue:${v.id}`, venueId: v.id, name: v.name, y: laneY(i) }));
  const bars: BarShape[] = [];
  for (const s of programme.sessions) {
    const slab = slabs.find((d) => d.date === s.festival_day);
    const lane = programme.venues.findIndex((v) => v.id === s.venue_id);
    const day = programme.festival_days.find((d) => d.date === s.festival_day);
    if (!slab || lane < 0 || !day) continue;
    const dayStart = Date.parse(day.starts_at);
    const dayLength = Date.parse(day.ends_at) - dayStart;
    const at = (iso: string) => (Math.min(Math.max((Date.parse(iso) - dayStart) / dayLength, 0), 1) - 0.5) * SLAB_WIDTH;
    bars.push({
      key: `session:${s.id}`, sessionId: s.id, title: s.title, discipline: s.discipline, venueId: s.venue_id, date: s.festival_day,
      cancelled: s.status === "cancelled", x0: at(s.starts_at), x1: Math.max(at(s.ends_at), at(s.starts_at) + 0.12), y: laneY(lane), z: slab.z + BAR_DEPTH,
    });
  }
  const swatches = programme.disciplines.map((d, i, all) => ({
    key: `discipline:${d.id}`, disciplineId: d.id, name: d.name,
    x: (i - (all.length - 1) / 2) * 1.5, y: -height / 2 - 1.1, z: 1.6,
  }));
  return { slabs, pillars, bars, swatches, height };
}
