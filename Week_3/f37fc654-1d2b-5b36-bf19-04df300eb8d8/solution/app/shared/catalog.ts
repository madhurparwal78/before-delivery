// Seed data from the brief (Seed data, Pieces, Prices, Maintenance plans). Shared by server and client.

export type InstallationType = "camera-reactive-wall" | "portrait-kiosk" | "projection-room";
export type AddOn = "ambient-sound" | "night-lighting" | "photo-takeaway";
export type Size = "compact" | "standard" | "grand";
export type DoorWall = "front" | "back" | "left" | "right";
export type Audience = "up-to-25" | "25-100" | "100-300" | "over-300";
export type Plan = "essential" | "priority";
export type PieceKind = InstallationType | AddOn;

export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  timeZone: string;
  taxRateBp: number;
}

export const VENUES: readonly Venue[] = [
  { id: "halsted-works", name: "Halsted Works Hall", address: "1100 W Fulton Market", city: "Chicago", timeZone: "America/Chicago", taxRateBp: 1025 },
  { id: "pier-nine", name: "Pier Nine Pavilion", address: "2 Harbor Way", city: "Seattle", timeZone: "America/Los_Angeles", taxRateBp: 1035 },
  { id: "lantern-court", name: "Lantern Court Museum Lobby", address: "40 Esplanade", city: "Denver", timeZone: "America/Denver", taxRateBp: 881 },
  { id: "saltmarsh-grounds", name: "Saltmarsh Festival Grounds", address: "9 Cholla Road", city: "Phoenix", timeZone: "America/Phoenix", taxRateBp: 860 },
  { id: "brightwater-atrium", name: "Brightwater Atrium", address: "300 Water Street", city: "New York", timeZone: "America/New_York", taxRateBp: 888 },
];

export const INSTALLATIONS: Record<InstallationType, { label: string; priceCents: number; piece: string }> = {
  "camera-reactive-wall": { label: "Camera-reactive wall", priceCents: 1_800_000, piece: "Camera-reactive wall" },
  "portrait-kiosk": { label: "Generative portrait kiosk", priceCents: 950_000, piece: "Portrait kiosk" },
  "projection-room": { label: "Voice-driven projection room", priceCents: 2_600_000, piece: "Projection tower" },
};

export const SIZES: Record<Size, { label: string; priceCents: number }> = {
  compact: { label: "Compact", priceCents: 0 },
  standard: { label: "Standard", priceCents: 350_000 },
  grand: { label: "Grand", priceCents: 725_000 },
};

export const ADD_ONS: Record<AddOn, { label: string; priceCents: number; piece: string }> = {
  "ambient-sound": { label: "Ambient sound", priceCents: 180_000, piece: "Speaker column" },
  "night-lighting": { label: "Night-mode lighting", priceCents: 240_000, piece: "Light rig" },
  "photo-takeaway": { label: "Photo takeaway", priceCents: 115_000, piece: "Print station" },
};

/** Footprints in metres: the first dimension runs along x at 0°. */
export const FOOTPRINTS: Record<PieceKind, readonly [number, number]> = {
  "camera-reactive-wall": [4.0, 0.4],
  "portrait-kiosk": [1.2, 1.2],
  "projection-room": [1.0, 1.0],
  "ambient-sound": [0.6, 0.6],
  "night-lighting": [0.8, 0.8],
  "photo-takeaway": [1.0, 0.6],
};

export function pieceLabel(kind: PieceKind): string {
  return kind in INSTALLATIONS ? INSTALLATIONS[kind as InstallationType].piece : ADD_ONS[kind as AddOn].piece;
}

export const DOOR_WALLS: Record<DoorWall, string> = { front: "Front wall", back: "Back wall", left: "Left wall", right: "Right wall" };

export const AUDIENCES: Record<Audience, { label: string; dust: number }> = {
  "up-to-25": { label: "Up to 25", dust: 40 },
  "25-100": { label: "25 to 100", dust: 80 },
  "100-300": { label: "100 to 300", dust: 140 },
  "over-300": { label: "Over 300", dust: 220 },
};

export const DUST_BEFORE_ANSWER = 60;

export const PLANS: Record<Plan, { label: string; planName: string; priceCents: number; summary: string }> = {
  essential: { label: "Essential", planName: "maintenance-essential-monthly", priceCents: 24_000, summary: "Monthly check-in and remote fixes." },
  priority: { label: "Priority", planName: "maintenance-priority-monthly", priceCents: 48_000, summary: "Next-day on-site visits." },
};

export const MILESTONE_SCHEDULE = [
  { label: "Deposit", bp: 4000 },
  { label: "Concept approval", bp: 2000 },
  { label: "Fabrication", bp: 2000 },
  { label: "Signed acceptance", bp: 2000 },
] as const;

export const STUDIO_NAME = "Spindrift Rooms";

/** Placement snaps: positions to a quarter metre, turns to 15°. */
export const GRID_M = 0.25;
export const TURN_DEG = 15;
