import { createHash } from 'node:crypto';
import type { AccountRole, PlanId } from '../shared/types.js';

/** Stable ids so the seed can be applied again and again without creating duplicates. */
export function seedId(name: string): string {
  const digest = createHash('sha1').update(`rushes:${name}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const seedPassword = 'rushes-demo-2026';

export interface SeedGroup {
  name: string;
}

export const seedGroups: SeedGroup[] = [{ name: 'Halden Group' }, { name: 'Vartan Studio' }];

export interface SeedWorkspace {
  group: string;
  slug: string;
  name: string;
  timeZone: string;
  plan: PlanId;
}

export const seedWorkspaces: SeedWorkspace[] = [
  { group: 'Halden Group', slug: 'northvale', name: 'Northvale', timeZone: 'Europe/London', plan: 'rushes-pro-5' },
  { group: 'Halden Group', slug: 'kesto', name: 'Kesto', timeZone: 'America/New_York', plan: 'rushes-pro-10' },
  {
    group: 'Halden Group',
    slug: 'brisk-tonic',
    name: 'Brisk Tonic',
    timeZone: 'Australia/Sydney',
    plan: 'rushes-pro-5',
  },
  { group: 'Vartan Studio', slug: 'vartan', name: 'Vartan Studio', timeZone: 'Europe/Berlin', plan: 'rushes-pro-5' },
];

export interface SeedAccount {
  displayName: string;
  handle: string;
  email: string;
  role: AccountRole;
  group?: string;
  workspace?: string;
  seat?: boolean;
}

export const seedAccounts: SeedAccount[] = [
  { displayName: 'Mara Quill', handle: 'mara', email: 'mara@halden.example', role: 'ops_lead', group: 'Halden Group' },
  { displayName: 'Dev Okafor', handle: 'dev', email: 'dev@halden.example', role: 'ops_lead', group: 'Halden Group' },
  {
    displayName: 'Juno Park',
    handle: 'juno',
    email: 'juno@northvale.example',
    role: 'designer',
    workspace: 'northvale',
    seat: true,
  },
  {
    displayName: 'Tomas Reyes',
    handle: 'tomas',
    email: 'tomas@northvale.example',
    role: 'designer',
    workspace: 'northvale',
    seat: true,
  },
  {
    displayName: 'Ines Laurent',
    handle: 'ines',
    email: 'ines@northvale.example',
    role: 'designer',
    workspace: 'northvale',
    seat: true,
  },
  {
    displayName: 'Priya Shah',
    handle: 'priya',
    email: 'priya@northvale.example',
    role: 'designer',
    workspace: 'northvale',
    seat: true,
  },
  {
    displayName: 'Ola Berg',
    handle: 'ola',
    email: 'ola@northvale.example',
    role: 'designer',
    workspace: 'northvale',
    seat: false,
  },
  {
    displayName: 'Kit Morrow',
    handle: 'kit',
    email: 'kit@northvale.example',
    role: 'designer',
    workspace: 'northvale',
    seat: false,
  },
  {
    displayName: 'Sam Ilori',
    handle: 'sam',
    email: 'sam@kesto.example',
    role: 'designer',
    workspace: 'kesto',
    seat: true,
  },
  {
    displayName: 'Remy Doucet',
    handle: 'remy',
    email: 'remy@kesto.example',
    role: 'designer',
    workspace: 'kesto',
    seat: true,
  },
  {
    displayName: 'Bea Lund',
    handle: 'bea',
    email: 'bea@brisktonic.example',
    role: 'designer',
    workspace: 'brisk-tonic',
    seat: true,
  },
  {
    displayName: 'Ilse Vartan',
    handle: 'ilse',
    email: 'ilse@vartan.example',
    role: 'designer',
    workspace: 'vartan',
    seat: true,
  },
  { displayName: 'Lee Chen', handle: 'lee', email: 'lee@followers.example', role: 'follower' },
  { displayName: 'Noor Haddad', handle: 'noor', email: 'noor@followers.example', role: 'follower' },
];

export interface SeedReference {
  workspace: string;
  title: string;
  createdBy: string;
  kind: 'image' | 'clip';
}

const northvaleImages = [
  'Salt-stained canvas',
  'Rope coil',
  'Harbour sodium light',
  'Oilskin fold',
  "Net mender's hands",
  'Tide chart',
  'Rusted cleat',
  'Fog over slipway',
];

const kestoImages = ['Trail grit macro', 'Midsole foam cut', 'Ridge at dawn', 'SS27 lace study', 'Scree field'];

const vartanPlates = Array.from(
  { length: 24 },
  (_, index) => `Field Study ${String(index + 1).padStart(2, '0')} plate`,
);

export const seedReferences: SeedReference[] = [
  ...northvaleImages.map((title) => ({ workspace: 'northvale', title, createdBy: 'juno', kind: 'image' as const })),
  ...kestoImages.map((title) => ({ workspace: 'kesto', title, createdBy: 'sam', kind: 'image' as const })),
  { workspace: 'brisk-tonic', title: 'Citrus peel spiral', createdBy: 'bea', kind: 'image' },
  ...vartanPlates.map((title) => ({ workspace: 'vartan', title, createdBy: 'ilse', kind: 'image' as const })),
  { workspace: 'northvale', title: 'Capstan reel', createdBy: 'juno', kind: 'clip' },
];

export interface SeedEntry {
  reference: string;
  addedBy: string;
  isPrivate?: boolean;
}

export interface SeedComment {
  authorHandle: string;
  body: string;
}

export interface SeedReviewLink {
  email: string;
  token: string;
  canComment: boolean;
  expiresAt: string;
}

export interface SeedCluster {
  workspace: string;
  title: string;
  owner: string;
  status: 'draft' | 'in_review' | 'public';
  publishedAt?: string;
  publicDescription?: string;
  internalNote?: string;
  entries: SeedEntry[];
  comments?: SeedComment[];
  reviewLinks?: SeedReviewLink[];
}

function fieldStudyPublishedAt(number: number): string {
  if (number >= 13 && number <= 16) {
    return '2026-09-01T22:00:00.000Z';
  }
  return new Date(Date.parse('2026-09-01T10:00:00.000Z') + (number - 1) * 3_600_000).toISOString();
}

export const seedClusters: SeedCluster[] = [
  {
    workspace: 'northvale',
    title: 'SS27 Coastal Workwear',
    owner: 'juno',
    status: 'draft',
    publicDescription: 'Harbour-side workwear direction for the SS27 season.',
    internalNote: 'Do not share before buyer preview on 12 Nov.',
    entries: [
      { reference: 'Salt-stained canvas', addedBy: 'juno' },
      { reference: 'Rope coil', addedBy: 'juno' },
      { reference: 'Harbour sodium light', addedBy: 'juno' },
      { reference: 'Oilskin fold', addedBy: 'juno' },
      { reference: "Net mender's hands", addedBy: 'juno' },
      { reference: 'Tide chart', addedBy: 'juno', isPrivate: true },
    ],
  },
  {
    workspace: 'northvale',
    title: 'AW26 Night Shift',
    owner: 'juno',
    status: 'public',
    publishedAt: '2026-10-01T08:00:00.000Z',
    publicDescription: 'Sodium light and oilskin after dark.',
    internalNote: 'Lighting budget pending.',
    entries: [
      { reference: 'Harbour sodium light', addedBy: 'juno' },
      { reference: 'Fog over slipway', addedBy: 'tomas' },
      { reference: 'Rusted cleat', addedBy: 'juno', isPrivate: true },
      { reference: 'Oilskin fold', addedBy: 'juno' },
    ],
    comments: [{ authorHandle: 'tomas', body: 'Swap the third frame for the wider crop.' }],
  },
  {
    workspace: 'northvale',
    title: 'SS27 Harbour Lights',
    owner: 'tomas',
    status: 'in_review',
    publicDescription: 'Night harbour lighting study.',
    entries: [
      { reference: 'Harbour sodium light', addedBy: 'tomas' },
      { reference: "Net mender's hands", addedBy: 'tomas' },
    ],
    reviewLinks: [
      {
        email: 'ren@freelance.example',
        token: 'rv-seed-harbour-0001',
        canComment: true,
        expiresAt: '2099-12-31T23:59:59.000Z',
      },
    ],
  },
  {
    workspace: 'kesto',
    title: 'SS27 Trail Runner Direction',
    owner: 'sam',
    status: 'draft',
    publicDescription: 'Trail runner direction for SS27.',
    entries: [
      { reference: 'Trail grit macro', addedBy: 'sam' },
      { reference: 'Midsole foam cut', addedBy: 'sam' },
      { reference: 'SS27 lace study', addedBy: 'sam' },
    ],
  },
  {
    workspace: 'kesto',
    title: 'Kesto Studio Pulls',
    owner: 'remy',
    status: 'public',
    publishedAt: '2026-09-20T12:00:00.000Z',
    publicDescription: 'Studio pulls from the ridge shoot.',
    entries: [
      { reference: 'Ridge at dawn', addedBy: 'remy' },
      { reference: 'Scree field', addedBy: 'remy' },
    ],
  },
  {
    workspace: 'brisk-tonic',
    title: 'Summer Fizz Palette',
    owner: 'bea',
    status: 'draft',
    publicDescription: 'Citrus palette for the summer range.',
    entries: [{ reference: 'Citrus peel spiral', addedBy: 'bea' }],
  },
  ...vartanPlates.map((plate, index) => {
    const number = index + 1;
    const label = String(number).padStart(2, '0');
    return {
      workspace: 'vartan',
      title: `Field Study ${label}`,
      owner: 'ilse',
      status: 'public' as const,
      publishedAt: fieldStudyPublishedAt(number),
      publicDescription: `Plate ${label} from the field study series.`,
      entries: [{ reference: plate, addedBy: 'ilse' }],
    };
  }),
];

export const seedFollows: { follower: string; curator: string }[] = [
  { follower: 'lee', curator: 'juno' },
  { follower: 'lee', curator: 'ilse' },
  { follower: 'noor', curator: 'juno' },
];
