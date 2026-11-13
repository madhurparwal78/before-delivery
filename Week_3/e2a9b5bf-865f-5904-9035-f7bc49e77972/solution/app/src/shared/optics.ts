import type { Derived, Optics, Train, TrainId } from "./types";

export const TRAINS: readonly Train[] = [
  { id: "straight", name: "Straight through", rotation_deg: 180, mirrored: false, sentence: "North down, east right." },
  { id: "mirror_diagonal", name: "Mirror diagonal", rotation_deg: 0, mirrored: true, sentence: "North up, east right." },
  { id: "erecting_prism", name: "Erecting prism", rotation_deg: 0, mirrored: false, sentence: "North up, east left." },
];

export function trainOf(id: TrainId): Train {
  const train = TRAINS.find((t) => t.id === id);
  if (!train) throw new Error(`unknown train ${id}`);
  return train;
}

export function halfUp(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.floor(value * factor + 0.5 + 1e-9) / factor;
}

const MM_PER_INCH = 25.4;

export function apertureMm(aperture: number, unit: "mm" | "in"): number {
  return halfUp(unit === "in" ? aperture * MM_PER_INCH : aperture, 1);
}

interface OpticsParts {
  telescope: { aperture_mm: number; focal_length_mm: number };
  eyepiece: { focal_length_mm: number; apparent_field_deg: number };
  barlow: { factor: number } | null;
  train: TrainId;
}

export function derive(parts: OpticsParts): Derived {
  const magnification = (parts.telescope.focal_length_mm / parts.eyepiece.focal_length_mm) * (parts.barlow?.factor ?? 1);
  const train = trainOf(parts.train);
  return {
    aperture_mm: parts.telescope.aperture_mm,
    magnification: halfUp(magnification),
    true_field_arcmin: halfUp((parts.eyepiece.apparent_field_deg * 60) / magnification),
    exit_pupil_mm: halfUp(parts.telescope.aperture_mm / magnification, 1),
    orientation: { train: train.id, rotation_deg: train.rotation_deg, mirrored: train.mirrored, sentence: train.sentence },
  };
}

export function deriveFor(
  optics: Optics,
  kit: {
    telescopes: { id: string; aperture_mm: number; focal_length_mm: number }[];
    eyepieces: { id: string; focal_length_mm: number; apparent_field_deg: number }[];
    barlows: { id: string; factor: number }[];
  },
): Derived | null {
  const telescope = kit.telescopes.find((t) => t.id === optics.telescope_id);
  const eyepiece = kit.eyepieces.find((e) => e.id === optics.eyepiece_id);
  const barlow = optics.barlow_id ? (kit.barlows.find((b) => b.id === optics.barlow_id) ?? null) : null;
  if (!telescope || !eyepiece || (optics.barlow_id && !barlow)) return null;
  return derive({ telescope, eyepiece, barlow, train: optics.train });
}

export function readoutLine(d: Derived): string {
  return `${d.magnification}× · ${d.true_field_arcmin}′ field · ${d.exit_pupil_mm.toFixed(1)} mm exit pupil · ${d.orientation.sentence}`;
}

export function swapSentence(d: Derived): string {
  return `Field now ${d.true_field_arcmin}′ at ${d.magnification}×. ${d.orientation.sentence}`;
}

export function apertureLabel(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}
