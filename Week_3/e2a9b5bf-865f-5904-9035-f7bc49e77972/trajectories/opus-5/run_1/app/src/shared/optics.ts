import { roundHalfUp, formatAperture, formatExitPupil } from './round.js';
import type {
  Barlow,
  DerivedOptics,
  Eyepiece,
  Kit,
  Optics,
  Telescope,
  Train,
  TrainId,
} from './types.js';

export const MM_PER_INCH = 25.4;

export const TRAINS: readonly Train[] = [
  {
    id: 'straight',
    name: 'Straight through',
    rotation_deg: 180,
    mirrored: false,
    sentence: 'North down, east right.',
  },
  {
    id: 'mirror_diagonal',
    name: 'Mirror diagonal',
    rotation_deg: 0,
    mirrored: true,
    sentence: 'North up, east right.',
  },
  {
    id: 'erecting_prism',
    name: 'Erecting prism',
    rotation_deg: 0,
    mirrored: false,
    sentence: 'North up, east left.',
  },
];

export const TRAIN_IDS: readonly TrainId[] = TRAINS.map((t) => t.id);

export function isTrainId(value: unknown): value is TrainId {
  return typeof value === 'string' && TRAIN_IDS.includes(value as TrainId);
}

export function train(id: TrainId): Train {
  const found = TRAINS.find((t) => t.id === id);
  if (!found) throw new Error(`unknown train ${id}`);
  return found;
}

/** Telescope aperture in millimetres, from millimetres or inches. */
export function apertureToMm(aperture: number, unit: 'mm' | 'in'): number {
  return roundHalfUp(unit === 'in' ? aperture * MM_PER_INCH : aperture, 1);
}

export interface OpticsParts {
  telescope: Telescope;
  eyepiece: Eyepiece;
  barlow: Barlow | null;
  train: TrainId;
}

export function deriveOptics(parts: OpticsParts): DerivedOptics {
  const factor = parts.barlow ? parts.barlow.factor : 1;
  const exactMagnification =
    (parts.telescope.focal_length_mm / parts.eyepiece.focal_length_mm) * factor;
  const t = train(parts.train);
  return {
    aperture_mm: roundHalfUp(parts.telescope.aperture_mm, 1),
    magnification: roundHalfUp(exactMagnification),
    true_field_arcmin: roundHalfUp((parts.eyepiece.apparent_field_deg * 60) / exactMagnification),
    exit_pupil_mm: roundHalfUp(parts.telescope.aperture_mm / exactMagnification, 1),
    orientation: {
      train: t.id,
      rotation_deg: t.rotation_deg,
      mirrored: t.mirrored,
      sentence: t.sentence,
    },
  };
}

/** Resolve an optics selection against a kit, or return null when it names nothing in it. */
export function resolveOptics(kit: Kit, optics: Optics): OpticsParts | null {
  const telescope = kit.telescopes.find((x) => x.id === optics.telescope_id);
  const eyepiece = kit.eyepieces.find((x) => x.id === optics.eyepiece_id);
  if (!telescope || !eyepiece || !isTrainId(optics.train)) return null;
  let barlow: Barlow | null = null;
  if (optics.barlow_id !== null && optics.barlow_id !== undefined) {
    barlow = kit.barlows.find((x) => x.id === optics.barlow_id) ?? null;
    if (!barlow) return null;
  }
  return { telescope, eyepiece, barlow, train: optics.train };
}

export function deriveFromKit(kit: Kit, optics: Optics): DerivedOptics | null {
  const parts = resolveOptics(kit, optics);
  return parts ? deriveOptics(parts) : null;
}

/** The readout line shown under the field circle. */
export function readoutLine(derived: DerivedOptics): string {
  return (
    `${derived.magnification}× · ${derived.true_field_arcmin}′ field · ` +
    `${formatExitPupil(derived.exit_pupil_mm)} mm exit pupil · ${derived.orientation.sentence}`
  );
}

/** Eyepieces are offered longest focal length first; equal lengths keep insertion order. */
export function sortEyepieces<T extends { focal_length_mm: number }>(eyepieces: T[]): T[] {
  return eyepieces
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      b.item.focal_length_mm - a.item.focal_length_mm !== 0
        ? b.item.focal_length_mm - a.item.focal_length_mm
        : a.index - b.index,
    )
    .map((x) => x.item);
}

/** The optics a new session starts with. */
export function defaultOptics(kit: Kit): Optics | null {
  const telescope = kit.telescopes[0];
  const eyepiece = sortEyepieces(kit.eyepieces)[0];
  if (!telescope || !eyepiece) return null;
  return {
    telescope_id: telescope.id,
    eyepiece_id: eyepiece.id,
    barlow_id: null,
    train: 'straight',
  };
}

export { formatAperture, formatExitPupil };
