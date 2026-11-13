export const STUDIO_NAME = 'Spindrift Rooms';

export type InstallationType = 'camera-reactive-wall' | 'portrait-kiosk' | 'projection-room';
export type SizeOption = 'compact' | 'standard' | 'grand';
export type AddOn = 'ambient-sound' | 'night-lighting' | 'photo-takeaway';
export type DoorWall = 'front' | 'back' | 'left' | 'right';
export type Audience = 'up-to-25' | '25-100' | '100-300' | 'over-300';
export type PieceKind =
  | 'camera-reactive-wall'
  | 'portrait-kiosk'
  | 'projection-tower'
  | 'speaker-column'
  | 'light-rig'
  | 'print-station';
export type MaintenancePlan = 'essential' | 'priority';

export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  timeZone: string;
  taxRateBp: number;
}

export const VENUES: readonly Venue[] = [
  { id: 'halsted-works', name: 'Halsted Works Hall', address: '1100 W Fulton Market', city: 'Chicago', timeZone: 'America/Chicago', taxRateBp: 1025 },
  { id: 'pier-nine', name: 'Pier Nine Pavilion', address: '2 Harbor Way', city: 'Seattle', timeZone: 'America/Los_Angeles', taxRateBp: 1035 },
  { id: 'lantern-court', name: 'Lantern Court Museum Lobby', address: '40 Esplanade', city: 'Denver', timeZone: 'America/Denver', taxRateBp: 881 },
  { id: 'saltmarsh-grounds', name: 'Saltmarsh Festival Grounds', address: '9 Cholla Road', city: 'Phoenix', timeZone: 'America/Phoenix', taxRateBp: 860 },
  { id: 'brightwater-atrium', name: 'Brightwater Atrium', address: '300 Water Street', city: 'New York', timeZone: 'America/New_York', taxRateBp: 888 },
];

export function findVenue(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

export const INSTALLATION_LABELS: Record<InstallationType, string> = {
  'camera-reactive-wall': 'Camera-reactive wall',
  'portrait-kiosk': 'Generative portrait kiosk',
  'projection-room': 'Voice-driven projection room',
};

export const INSTALLATION_PRICE_CENTS: Record<InstallationType, number> = {
  'camera-reactive-wall': 1_800_000,
  'portrait-kiosk': 950_000,
  'projection-room': 2_600_000,
};

export const SIZE_LABELS: Record<SizeOption, string> = {
  compact: 'Compact',
  standard: 'Standard',
  grand: 'Grand',
};

export const SIZE_PRICE_CENTS: Record<SizeOption, number> = {
  compact: 0,
  standard: 350_000,
  grand: 725_000,
};

export const ADDON_LABELS: Record<AddOn, string> = {
  'ambient-sound': 'Ambient sound',
  'night-lighting': 'Night-mode lighting',
  'photo-takeaway': 'Photo takeaway',
};

export const ADDON_PRICE_CENTS: Record<AddOn, number> = {
  'ambient-sound': 180_000,
  'night-lighting': 240_000,
  'photo-takeaway': 115_000,
};

export const ADDON_ORDER: readonly AddOn[] = ['ambient-sound', 'night-lighting', 'photo-takeaway'];

export interface PieceSpec {
  kind: PieceKind;
  label: string;
  footprintM: readonly [number, number];
}

export const PIECES: Record<PieceKind, PieceSpec> = {
  'camera-reactive-wall': { kind: 'camera-reactive-wall', label: 'Camera-reactive wall', footprintM: [4.0, 0.4] },
  'portrait-kiosk': { kind: 'portrait-kiosk', label: 'Portrait kiosk', footprintM: [1.2, 1.2] },
  'projection-tower': { kind: 'projection-tower', label: 'Projection tower', footprintM: [1.0, 1.0] },
  'speaker-column': { kind: 'speaker-column', label: 'Speaker column', footprintM: [0.6, 0.6] },
  'light-rig': { kind: 'light-rig', label: 'Light rig', footprintM: [0.8, 0.8] },
  'print-station': { kind: 'print-station', label: 'Print station', footprintM: [1.0, 0.6] },
};

export const MAIN_PIECE_FOR_INSTALLATION: Record<InstallationType, PieceKind> = {
  'camera-reactive-wall': 'camera-reactive-wall',
  'portrait-kiosk': 'portrait-kiosk',
  'projection-room': 'projection-tower',
};

export const PIECE_FOR_ADDON: Record<AddOn, PieceKind> = {
  'ambient-sound': 'speaker-column',
  'night-lighting': 'light-rig',
  'photo-takeaway': 'print-station',
};

/** Required pieces are the main piece plus one piece per chosen extra, in extra order. */
export function requiredPieces(installationType: InstallationType, addOns: readonly AddOn[]): PieceKind[] {
  const main = MAIN_PIECE_FOR_INSTALLATION[installationType];
  const extras = ADDON_ORDER.filter((a) => addOns.includes(a)).map((a) => PIECE_FOR_ADDON[a]);
  return [main, ...extras];
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  'up-to-25': 'Up to 25',
  '25-100': '25 to 100',
  '100-300': '100 to 300',
  'over-300': 'Over 300',
};

export const AUDIENCE_DUST: Record<Audience, number> = {
  'up-to-25': 40,
  '25-100': 80,
  '100-300': 140,
  'over-300': 220,
};

export const DUST_BEFORE_ANSWER = 60;

export const MAINTENANCE_PLANS: Record<MaintenancePlan, { label: string; planName: string; priceCents: number; blurb: string }> = {
  essential: {
    label: 'Essential',
    planName: 'maintenance-essential-monthly',
    priceCents: 24_000,
    blurb: 'Monthly check-in and remote fixes.',
  },
  priority: {
    label: 'Priority',
    planName: 'maintenance-priority-monthly',
    priceCents: 48_000,
    blurb: 'Next-day on-site visits.',
  },
};

export interface CaseStudy {
  id: string;
  title: string;
  venueName: string;
  installationLabel: string;
  blurb: string;
}

export const CASE_STUDIES: readonly CaseStudy[] = [
  {
    id: 'tidewall',
    title: 'Tidewall',
    venueName: 'Halsted Works Hall',
    installationLabel: 'Camera-reactive wall',
    blurb: 'A camera-reactive wall at Halsted Works Hall that turns passers-by into slow tides of light.',
  },
  {
    id: 'second-face',
    title: 'Second Face',
    venueName: 'Brightwater Atrium',
    installationLabel: 'Generative portrait kiosk',
    blurb: 'A generative portrait kiosk at Brightwater Atrium that draws each visitor as the person beside them sees them.',
  },
  {
    id: 'echo-vault',
    title: 'Echo Vault',
    venueName: 'Lantern Court Museum Lobby',
    installationLabel: 'Voice-driven projection room',
    blurb: 'A voice-driven projection room at Lantern Court Museum Lobby where spoken words become falling constellations.',
  },
];

export interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: AppRole;
}

export type AppRole = 'producer' | 'client' | 'sponsor' | 'crew';

export const APP_ROLES: readonly AppRole[] = ['producer', 'client', 'sponsor', 'crew'];

export const SEED_USERS: readonly SeedUser[] = [
  { name: 'Mara Lind', email: 'mara@spindrift.test', password: 'Spindrift-Producer-26', role: 'producer' },
  { name: 'Theo Vance (Northwake Beverages)', email: 'theo@northwake.test', password: 'Northwake-Client-26', role: 'client' },
  { name: 'Priya Raman (Lumen Hall)', email: 'priya@lumenhall.test', password: 'Lumenhall-Client-26', role: 'client' },
  { name: 'Jonah Reyes', email: 'jonah@crew.spindrift.test', password: 'Crew-Jonah-26', role: 'crew' },
  { name: 'Ama Boateng', email: 'ama@crew.spindrift.test', password: 'Crew-Ama-26', role: 'crew' },
];

export const MILESTONE_SCHEDULE: readonly { key: MilestoneKey; label: string; scheduleBp: number }[] = [
  { key: 'deposit', label: 'Deposit', scheduleBp: 4000 },
  { key: 'concept_approval', label: 'Concept approval', scheduleBp: 2000 },
  { key: 'fabrication', label: 'Fabrication', scheduleBp: 2000 },
  { key: 'signed_acceptance', label: 'Signed acceptance', scheduleBp: 2000 },
];

export type MilestoneKey = 'deposit' | 'concept_approval' | 'fabrication' | 'signed_acceptance';

export const SPONSOR_SHARE_LABEL = 'Sponsor share';

export const UPLOAD_KINDS = ['brief_pdf', 'venue_photo', 'installation_glb'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
  brief_pdf: 10_485_760,
  venue_photo: 12_582_912,
  installation_glb: 26_214_400,
};

export const UPLOAD_KIND_LABELS: Record<UploadKind, string> = {
  brief_pdf: 'brief PDF',
  venue_photo: 'venue photo',
  installation_glb: 'GLB model',
};
