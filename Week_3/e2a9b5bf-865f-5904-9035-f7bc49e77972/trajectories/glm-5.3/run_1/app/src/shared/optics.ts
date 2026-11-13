// Derived optics and orientation, shared by browser and server (DP-04).
export type TrainId = "straight" | "mirror_diagonal" | "erecting_prism";

export interface TrainInfo {
  readonly id: TrainId;
  readonly name: string;
  readonly rotation_deg: number;
  readonly mirrored: boolean;
  readonly sentence: string;
}

export const trains: readonly TrainInfo[] = [
  { id: "straight", name: "Straight through", rotation_deg: 180, mirrored: false, sentence: "North down, east right." },
  { id: "mirror_diagonal", name: "Mirror diagonal", rotation_deg: 0, mirrored: true, sentence: "North up, east right." },
  { id: "erecting_prism", name: "Erecting prism", rotation_deg: 0, mirrored: false, sentence: "North up, east left." },
];

export function trainById(id: TrainId): TrainInfo {
  const found = trains.find((t) => t.id === id);
  return found ?? trains[0]!;
}

export interface OpticsChoice {
  readonly telescope_id: string;
  readonly eyepiece_id: string;
  readonly barlow_id: string | null;
  readonly train: TrainId;
}

export interface TelescopeSpec {
  readonly aperture_mm: number;
  readonly focal_length_mm: number;
}

export interface EyepieceSpec {
  readonly focal_length_mm: number;
  readonly apparent_field_deg: number;
}

export interface DerivedOptics {
  readonly aperture_mm: number;
  readonly magnification: number;
  readonly true_field_arcmin: number;
  readonly exit_pupil_mm: number;
  readonly orientation: {
    readonly train: TrainId;
    readonly rotation_deg: number;
    readonly mirrored: boolean;
    readonly sentence: string;
  };
}

// Round half up, away from zero for negatives (the value's magnitude grows).
export function roundHalfUp(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  // Snap values that are a hair below x.5 because of binary representation.
  const scaled = value * factor;
  const epsilon = Math.abs(scaled) < 1e-9 ? 0 : (Math.sign(scaled) * 1e-9);
  const snapped = scaled + epsilon;
  if (snapped >= 0) {
    return Math.floor(snapped + 0.5) / factor;
  }
  return -Math.floor(-snapped + 0.5) / factor;
}

export function apertureToMm(aperture: number, unit: "mm" | "in"): number {
  return unit === "mm" ? aperture : roundHalfUp(aperture * 25.4, 1);
}

export function deriveOptics(
  telescope: TelescopeSpec,
  eyepiece: EyepieceSpec,
  barlowFactor: number,
  train: TrainId,
): DerivedOptics {
  const unroundedMag = telescope.focal_length_mm / eyepiece.focal_length_mm * barlowFactor;
  const magnification = roundHalfUp(unroundedMag, 0);
  const trueFieldArcmin = roundHalfUp((eyepiece.apparent_field_deg * 60) / unroundedMag, 0);
  const exitPupilMm = roundHalfUp(telescope.aperture_mm / unroundedMag, 1);
  const info = trainById(train);
  return {
    aperture_mm: telescope.aperture_mm,
    magnification,
    true_field_arcmin: trueFieldArcmin,
    exit_pupil_mm: exitPupilMm,
    orientation: { train, rotation_deg: info.rotation_deg, mirrored: info.mirrored, sentence: info.sentence },
  };
}

export function formatAperture(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : roundHalfUp(mm, 1).toFixed(1);
}

export function formatExitPupil(mm: number): string {
  return roundHalfUp(mm, 1).toFixed(1);
}

export function readoutLine(derived: DerivedOptics): string {
  return `${derived.magnification}× · ${derived.true_field_arcmin}′ field · ${formatExitPupil(derived.exit_pupil_mm)} mm exit pupil · ${derived.orientation.sentence}`;
}

export function swapAnnouncement(derived: DerivedOptics): string {
  return `Field now ${derived.true_field_arcmin}′ at ${derived.magnification}×. ${derived.orientation.sentence}`;
}
