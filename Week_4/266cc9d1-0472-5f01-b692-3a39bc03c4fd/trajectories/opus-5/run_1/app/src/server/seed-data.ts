/** The seeded tenants, staff, utilities, corridors, assets and findings. */

export interface SeedTenant {
  id: string;
  name: string;
}

export interface SeedStaff {
  id: string;
  tenantId: string;
  name: string;
  role: "survey_processor" | "vegetation_analyst";
  accessCode: string;
  email: string;
}

export interface SeedUtility {
  id: string;
  name: string;
  tenantId: string;
  timeZone: string;
  foresterName: string;
  foresterEmail: string;
}

export interface SeedTower {
  number: number;
  chainageM: number;
  baseHeightM: number;
}

export interface SeedCorridor {
  id: string;
  name: string;
  utilityId: string;
  voltageKv: number;
  clearanceThresholdM: number;
  inspectionDue: string;
  originLatDeg: number;
  originLonDeg: number;
  azimuthDeg: number;
  attachmentHeightM: number;
  towers: SeedTower[];
}

export interface SeedAsset {
  id: string;
  corridorId: string;
  kind: "tileset" | "terrain" | "czml";
}

export interface SeedFinding {
  labelN: number;
  chainageM: number;
  offsetM: number;
  groundHeightM: number;
  terrainLevel: number | null;
  canopyHeightM: number;
  canopyRadiusM: number;
  comment: string;
}

export interface SeedFindingsSet {
  id: string;
  corridorId: string;
  revision: number;
  createdByCode: string;
  findings: SeedFinding[];
}

export const SEED_TENANTS: SeedTenant[] = [
  { id: "kestrel", name: "Kestrel Ridge Aerial" },
  { id: "bluefen", name: "Blue Fen Survey" },
];

export const SEED_STAFF: SeedStaff[] = [
  {
    id: "stf-tomas-adeyemi",
    tenantId: "kestrel",
    name: "Tomas Adeyemi",
    role: "survey_processor",
    accessCode: "kestrel-processor-4417",
    email: "tomas.adeyemi@kestrelridge.example",
  },
  {
    id: "stf-rosa-lindqvist",
    tenantId: "kestrel",
    name: "Rosa Lindqvist",
    role: "vegetation_analyst",
    accessCode: "kestrel-analyst-2093",
    email: "rosa.lindqvist@kestrelridge.example",
  },
  {
    id: "stf-jun-park",
    tenantId: "bluefen",
    name: "Jun Park",
    role: "survey_processor",
    accessCode: "bluefen-processor-6620",
    email: "jun.park@bluefen.example",
  },
  {
    id: "stf-mika-osei",
    tenantId: "bluefen",
    name: "Mika Osei",
    role: "vegetation_analyst",
    accessCode: "bluefen-analyst-7731",
    email: "mika.osei@bluefen.example",
  },
];

export const SEED_UTILITIES: SeedUtility[] = [
  {
    id: "northmere",
    name: "Northmere Power Cooperative",
    tenantId: "kestrel",
    timeZone: "America/Chicago",
    foresterName: "Dana Okafor",
    foresterEmail: "dana.okafor@northmere.example",
  },
  {
    id: "sallow",
    name: "Sallow Valley Electric",
    tenantId: "kestrel",
    timeZone: "America/Denver",
    foresterName: "Lee Marchetti",
    foresterEmail: "lee.marchetti@sallowvalley.example",
  },
  {
    id: "harrow",
    name: "Harrow Coast Utilities",
    tenantId: "bluefen",
    timeZone: "America/Los_Angeles",
    foresterName: "Sam Whitlock",
    foresterEmail: "sam.whitlock@harrowcoast.example",
  },
];

export const SEED_CORRIDORS: SeedCorridor[] = [
  {
    id: "nm-ash-creek",
    name: "Ash Creek 345 kV",
    utilityId: "northmere",
    voltageKv: 345,
    clearanceThresholdM: 3.0,
    inspectionDue: "2026-03-31",
    originLatDeg: 44.5,
    originLonDeg: -93.2,
    azimuthDeg: 90,
    attachmentHeightM: 24.0,
    towers: [
      { number: 1, chainageM: 0, baseHeightM: 248.0 },
      { number: 2, chainageM: 312, baseHeightM: 251.5 },
      { number: 3, chainageM: 640, baseHeightM: 255.0 },
      { number: 4, chainageM: 955, baseHeightM: 253.0 },
      { number: 5, chainageM: 1268, baseHeightM: 249.5 },
      { number: 6, chainageM: 1590, baseHeightM: 246.0 },
      { number: 7, chainageM: 1904, baseHeightM: 247.5 },
      { number: 8, chainageM: 2231, baseHeightM: 252.0 },
      { number: 9, chainageM: 2550, baseHeightM: 256.5 },
      { number: 10, chainageM: 2870, baseHeightM: 254.0 },
    ],
  },
  {
    id: "nm-birch-hollow",
    name: "Birch Hollow 138 kV",
    utilityId: "northmere",
    voltageKv: 138,
    clearanceThresholdM: 1.6,
    inspectionDue: "2030-06-30",
    originLatDeg: 44.62,
    originLonDeg: -93.05,
    azimuthDeg: 45,
    attachmentHeightM: 18.0,
    towers: [
      { number: 1, chainageM: 0, baseHeightM: 300.0 },
      { number: 2, chainageM: 210, baseHeightM: 300.0 },
      { number: 3, chainageM: 430, baseHeightM: 300.0 },
      { number: 4, chainageM: 655, baseHeightM: 300.0 },
      { number: 5, chainageM: 870, baseHeightM: 300.0 },
      { number: 6, chainageM: 1085, baseHeightM: 300.0 },
    ],
  },
  {
    id: "sv-cutbank",
    name: "Cutbank 230 kV",
    utilityId: "sallow",
    voltageKv: 230,
    clearanceThresholdM: 2.2,
    inspectionDue: "2030-09-30",
    originLatDeg: 40.1,
    originLonDeg: -105.3,
    azimuthDeg: 0,
    attachmentHeightM: 30.0,
    towers: [
      { number: 1, chainageM: 0, baseHeightM: 1650.0 },
      { number: 2, chainageM: 380, baseHeightM: 1650.0 },
      { number: 3, chainageM: 760, baseHeightM: 1650.0 },
      { number: 4, chainageM: 1150, baseHeightM: 1650.0 },
    ],
  },
  {
    id: "hc-dune-road",
    name: "Dune Road 115 kV",
    utilityId: "harrow",
    voltageKv: 115,
    clearanceThresholdM: 1.4,
    inspectionDue: "2030-05-31",
    originLatDeg: 36.8,
    originLonDeg: -121.7,
    azimuthDeg: 120,
    attachmentHeightM: 20.0,
    towers: [
      { number: 1, chainageM: 0, baseHeightM: 20.0 },
      { number: 2, chainageM: 250, baseHeightM: 20.0 },
      { number: 3, chainageM: 500, baseHeightM: 20.0 },
    ],
  },
];

export const SEED_ASSETS: SeedAsset[] = [
  { id: "ast-ash-terrain", corridorId: "nm-ash-creek", kind: "terrain" },
  { id: "ast-ash-tileset", corridorId: "nm-ash-creek", kind: "tileset" },
  { id: "ast-ash-czml", corridorId: "nm-ash-creek", kind: "czml" },
  { id: "ast-birch-terrain", corridorId: "nm-birch-hollow", kind: "terrain" },
];

export const SEED_FINDINGS_SETS: SeedFindingsSet[] = [
  {
    id: "set-ash-creek-r1",
    corridorId: "nm-ash-creek",
    revision: 1,
    createdByCode: "kestrel-analyst-2093",
    findings: [
      {
        labelN: 1,
        chainageM: 470.0,
        offsetM: 1.5,
        groundHeightM: 253.0,
        terrainLevel: 15,
        canopyHeightM: 24.0,
        canopyRadiusM: 3.0,
        comment: "Silver maple leader under conductor, east of T2",
      },
      {
        labelN: 2,
        chainageM: 1180.0,
        offsetM: -9.0,
        groundHeightM: 251.0,
        terrainLevel: 9,
        canopyHeightM: 12.0,
        canopyRadiusM: 4.0,
        comment: "Aspen clump on north edge",
      },
      {
        labelN: 3,
        chainageM: 1915.0,
        offsetM: 2.0,
        groundHeightM: 248.0,
        terrainLevel: 15,
        canopyHeightM: 22.5,
        canopyRadiusM: 2.5,
        comment: "Cottonwood just past T7",
      },
      {
        labelN: 4,
        chainageM: 2700.0,
        offsetM: -4.0,
        groundHeightM: 255.0,
        terrainLevel: 15,
        canopyHeightM: 15.0,
        canopyRadiusM: 3.0,
        comment: "Boxelder regrowth",
      },
    ],
  },
  {
    id: "set-dune-road-r1",
    corridorId: "hc-dune-road",
    revision: 1,
    createdByCode: "bluefen-analyst-7731",
    findings: [
      {
        labelN: 1,
        chainageM: 120.0,
        offsetM: 3.0,
        groundHeightM: 20.5,
        terrainLevel: 12,
        canopyHeightM: 16.0,
        canopyRadiusM: 3.0,
        comment: "Monterey cypress",
      },
    ],
  },
];

/** The seeded flight track for Ash Creek. */
export const ASH_CREEK_TRACK = {
  assetId: "ast-ash-czml",
  path: "ash-creek-2026-06-14.czml",
  epoch: "2026-06-14T14:00:00Z",
  heightM: 320.0,
  stepSeconds: 10,
  intervals: [
    { start: "2026-06-14T14:00:00Z", end: "2026-06-14T14:08:00Z", fromM: 0, toM: 1268 },
    { start: "2026-06-14T14:15:00Z", end: "2026-06-14T14:22:00Z", fromM: 1904, toM: 2870 },
    { start: "2026-06-14T14:30:00Z", end: "2026-06-14T14:37:00Z", fromM: 2870, toM: 1904 },
  ],
  strays: [
    { seconds: 540, chainageM: 1400 },
    { seconds: 1560, chainageM: 2500 },
  ],
} as const;
