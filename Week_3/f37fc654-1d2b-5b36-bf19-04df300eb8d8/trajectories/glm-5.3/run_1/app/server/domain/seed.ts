export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  timeZone: string;
  taxRateBp: number;
}

export interface PieceFootprint {
  kind: string;
  label: string;
  w: number; // first footprint dimension, along x at 0 degrees
  d: number; // second footprint dimension
}

export const VENUES: Venue[] = [
  { id: 'halsted-works', name: 'Halsted Works Hall', address: '1100 W Fulton Market', city: 'Chicago', timeZone: 'America/Chicago', taxRateBp: 1025 },
  { id: 'pier-nine', name: 'Pier Nine Pavilion', address: '2 Harbor Way', city: 'Seattle', timeZone: 'America/Los_Angeles', taxRateBp: 1035 },
  { id: 'lantern-court', name: 'Lantern Court Museum Lobby', address: '40 Esplanade', city: 'Denver', timeZone: 'America/Denver', taxRateBp: 881 },
  { id: 'saltmarsh-grounds', name: 'Saltmarsh Festival Grounds', address: '9 Cholla Road', city: 'Phoenix', timeZone: 'America/Phoenix', taxRateBp: 860 },
  { id: 'brightwater-atrium', name: 'Brightwater Atrium', address: '300 Water Street', city: 'New York', timeZone: 'America/New_York', taxRateBp: 888 },
];

export type InstallationType = 'camera-reactive-wall' | 'portrait-kiosk' | 'projection-room';
export type AddOn = 'ambient-sound' | 'night-lighting' | 'photo-takeaway';
export type Size = 'compact' | 'standard' | 'grand';
export type DoorWall = 'front' | 'back' | 'left' | 'right';
export type Audience = 'up-to-25' | '25-100' | '100-300' | 'over-300';

export const MAIN_PIECE_PRICE_CENTS: Record<InstallationType, number> = {
  'camera-reactive-wall': 1_800_000,
  'portrait-kiosk': 950_000,
  'projection-room': 2_600_000,
};

export const SIZE_PRICE_CENTS: Record<Size, number> = {
  compact: 0,
  standard: 350_000,
  grand: 725_000,
};

export const ADD_ON_PRICE_CENTS: Record<AddOn, number> = {
  'ambient-sound': 180_000,
  'night-lighting': 240_000,
  'photo-takeaway': 115_000,
};

export const INSTALLATION_LABELS: Record<InstallationType, string> = {
  'camera-reactive-wall': 'Camera-reactive wall',
  'portrait-kiosk': 'Generative portrait kiosk',
  'projection-room': 'Voice-driven projection room',
};

export const SIZE_LABELS: Record<Size, string> = { compact: 'Compact', standard: 'Standard', grand: 'Grand' };

export const ADD_ON_LABELS: Record<AddOn, string> = {
  'ambient-sound': 'Ambient sound',
  'night-lighting': 'Night-mode lighting',
  'photo-takeaway': 'Photo takeaway',
};

export const MAIN_PIECE_BY_TYPE: Record<InstallationType, PieceFootprint> = {
  'camera-reactive-wall': { kind: 'camera-reactive-wall', label: 'Camera-reactive wall', w: 4.0, d: 0.4 },
  'portrait-kiosk': { kind: 'portrait-kiosk', label: 'Portrait kiosk', w: 1.2, d: 1.2 },
  'projection-room': { kind: 'projection-room', label: 'Projection tower', w: 1.0, d: 1.0 },
};

export const EXTRA_PIECE_BY_ADDON: Record<AddOn, PieceFootprint> = {
  'ambient-sound': { kind: 'ambient-sound', label: 'Speaker column', w: 0.6, d: 0.6 },
  'night-lighting': { kind: 'night-lighting', label: 'Light rig', w: 0.8, d: 0.8 },
  'photo-takeaway': { kind: 'photo-takeaway', label: 'Print station', w: 1.0, d: 0.6 },
};

export const PIECE_LABELS: Record<string, string> = {
  'camera-reactive-wall': 'Camera-reactive wall',
  'portrait-kiosk': 'Portrait kiosk',
  'projection-room': 'Projection tower',
  'ambient-sound': 'Speaker column',
  'night-lighting': 'Light rig',
  'photo-takeaway': 'Print station',
};

export const MILESTONE_SCHEDULE: Array<{ label: string; bp: number }> = [
  { label: 'Deposit', bp: 4000 },
  { label: 'Concept approval', bp: 2000 },
  { label: 'Fabrication', bp: 2000 },
  { label: 'Signed acceptance', bp: 2000 },
];

export const MAINTENANCE_PLANS: Record<'essential' | 'priority', { label: string; kbPlanId: string; monthlyCents: number }> = {
  essential: { label: 'Essential', kbPlanId: 'maintenance-essential-monthly', monthlyCents: 24000 },
  priority: { label: 'Priority', kbPlanId: 'maintenance-priority-monthly', monthlyCents: 48000 },
};

export function requiredPieces(type: InstallationType, addOns: AddOn[]): PieceFootprint[] {
  return [MAIN_PIECE_BY_TYPE[type], ...addOns.map((a) => EXTRA_PIECE_BY_ADDON[a])];
}
