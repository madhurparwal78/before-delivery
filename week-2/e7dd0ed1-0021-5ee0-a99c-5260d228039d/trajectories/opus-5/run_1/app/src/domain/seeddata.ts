export interface RegionSeed {
  id: string;
  name: string;
  continent: string;
  lon: number;
  lat: number;
}

export const regionSeeds: RegionSeed[] = [
  { id: 'cascade', name: 'Cascade', continent: 'North America West', lon: -122, lat: 47 },
  { id: 'meridian', name: 'Meridian', continent: 'Europe Central', lon: 9, lat: 50 },
  { id: 'monsoon', name: 'Monsoon', continent: 'Southeast Asia', lon: 104, lat: 1 },
  { id: 'pampas', name: 'Pampas', continent: 'South America East', lon: -47, lat: -23 },
];

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: string;
  includedStorageBytes: number;
  includedEgressBytes: number;
  storageOverage: string;
  egressOverage: string;
  requestUnits: string;
  killbillPlan: string;
}

export const plans: Plan[] = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    monthlyPrice: '$0.00',
    includedStorageBytes: 1000000,
    includedEgressBytes: 2000000,
    storageOverage: 'none',
    egressOverage: 'none',
    requestUnits: 'none',
    killbillPlan: 'farshore-sandbox-monthly',
  },
  {
    id: 'indie',
    name: 'Indie',
    monthlyPrice: '$19.00',
    includedStorageBytes: 50000000000,
    includedEgressBytes: 100000000000,
    storageOverage: '$0.006 per GB-month, billed by the GB-hour',
    egressOverage: '$0.010 per GB',
    requestUnits: '$0.40 per million',
    killbillPlan: 'farshore-indie-monthly',
  },
];

export function planById(id: string): Plan {
  const found = plans.find((plan) => plan.id === id);
  if (!found) throw new Error(`unknown plan ${id}`);
  return found;
}

export const seedPassword = 'farshore-demo-26';

export interface UserSeed {
  id: string;
  name: string;
  email: string;
  operator?: boolean;
  twoStepSecret?: string;
  recoveryCodes?: string[];
}

export const userSeeds: UserSeed[] = [
  { id: 'usr_mara', name: 'Mara Okonkwo', email: 'mara@lanternfish.test' },
  { id: 'usr_theo', name: 'Theo Lindqvist', email: 'theo@lanternfish.test' },
  { id: 'usr_priya', name: 'Priya Raman', email: 'priya@lanternfish.test' },
  {
    id: 'usr_jun',
    name: 'Jun Arai',
    email: 'jun@paperkite.test',
    twoStepSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    recoveryCodes: [
      'kite1-jun01',
      'kite1-jun02',
      'kite1-jun03',
      'kite1-jun04',
      'kite1-jun05',
      'kite1-jun06',
      'kite1-jun07',
      'kite1-jun08',
      'kite1-jun09',
      'kite1-jun10',
    ],
  },
  { id: 'usr_sol', name: 'Sol Benitez', email: 'sol@paperkite.test' },
  { id: 'usr_ada', name: 'Ada Nwosu', email: 'ada@tidepool.test' },
  { id: 'usr_rui', name: 'Rui Castellan', email: 'operator@farshore.test', operator: true },
];

export interface WorkspaceSeed {
  slug: string;
  name: string;
  plan: string;
  members: { userId: string; role: 'owner' | 'developer' | 'viewer' }[];
  buckets: { name: string; placement: string[] }[];
}

export const workspaceSeeds: WorkspaceSeed[] = [
  {
    slug: 'lanternfish',
    name: 'Lanternfish Games',
    plan: 'indie',
    members: [
      { userId: 'usr_mara', role: 'owner' },
      { userId: 'usr_theo', role: 'developer' },
      { userId: 'usr_priya', role: 'viewer' },
    ],
    buckets: [
      { name: 'lanternfish-replays', placement: ['cascade', 'meridian', 'monsoon'] },
      { name: 'lanternfish-avatars', placement: ['meridian', 'cascade'] },
    ],
  },
  {
    slug: 'paperkite',
    name: 'Paper Kite Studio',
    plan: 'indie',
    members: [
      { userId: 'usr_jun', role: 'owner' },
      { userId: 'usr_sol', role: 'developer' },
    ],
    buckets: [{ name: 'paperkite-replays', placement: ['monsoon', 'cascade'] }],
  },
  {
    slug: 'tidepool',
    name: 'Tidepool Tools',
    plan: 'sandbox',
    members: [{ userId: 'usr_ada', role: 'owner' }],
    buckets: [{ name: 'tidepool-builds', placement: ['cascade'] }],
  },
];

export interface ObjectSeed {
  bucket: string;
  key: string;
  contentType: string;
  body: Buffer;
  tags: Record<string, string>;
}

export const objectSeeds: ObjectSeed[] = [
  {
    bucket: 'lanternfish-replays',
    key: 'season-1/manifest.json',
    contentType: 'application/json',
    body: Buffer.from('{"season":1,"build":"1.4.2"}', 'utf8'),
    tags: { env: 'prod', team: 'netcode' },
  },
  {
    bucket: 'lanternfish-replays',
    key: 'season-1/replays/r-0001.bin',
    contentType: 'application/octet-stream',
    body: Buffer.alloc(2048, 0),
    tags: { env: 'qa' },
  },
  {
    bucket: 'lanternfish-avatars',
    key: 'avatars/README.txt',
    contentType: 'text/plain',
    body: Buffer.from('Avatar uploads land here.\n', 'utf8'),
    tags: {},
  },
  {
    bucket: 'paperkite-replays',
    key: 'season-1/manifest.json',
    contentType: 'application/json',
    body: Buffer.from('{"studio":"paperkite","season":1}', 'utf8'),
    tags: { env: 'prod' },
  },
  {
    bucket: 'tidepool-builds',
    key: 'builds/tidepool-0.9.0.txt',
    contentType: 'text/plain',
    body: Buffer.from('tidepool build 0.9.0\n', 'utf8'),
    tags: {},
  },
];
