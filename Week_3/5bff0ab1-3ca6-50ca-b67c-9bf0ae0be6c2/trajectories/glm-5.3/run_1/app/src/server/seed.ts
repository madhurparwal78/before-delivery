// Seed data: every person, hub, business, price, tax rate, closed day and stock figure
// here is invented. Applied idempotently each time a server copy starts.

export interface ModelSeed {
  id: string;
  name: string;
  cc: number;
  gstPercent: number;
  insurancePaise: number;
  wheelbaseMm: number;
  cylinders: number;
  silencers: number;
  steps: { effectiveFrom: string; exFactoryPaise: number }[];
}

export interface FinishSeed {
  id: string;
  name: string;
  paint: { r: number; g: number; b: number };
}

export interface HubSeed {
  id: string;
  name: string;
  roadTaxSteps: { effectiveFrom: string; percent: number }[];
}

export const MODELS: ModelSeed[] = [
  {
    id: "megh-349",
    name: "Megh 349",
    cc: 349,
    gstPercent: 18,
    insurancePaise: 980000,
    wheelbaseMm: 1440,
    cylinders: 1,
    silencers: 1,
    steps: [
      { effectiveFrom: "2026-10-01", exFactoryPaise: 19000000 },
      { effectiveFrom: "2026-11-01", exFactoryPaise: 19500000 },
    ],
  },
  {
    id: "desh-648",
    name: "Desh 648",
    cc: 648,
    gstPercent: 40,
    insurancePaise: 1460000,
    wheelbaseMm: 1465,
    cylinders: 2,
    silencers: 2,
    steps: [
      { effectiveFrom: "2026-10-01", exFactoryPaise: 26000000 },
      { effectiveFrom: "2026-11-01", exFactoryPaise: 26500000 },
    ],
  },
];

export const FINISHES: FinishSeed[] = [
  { id: "monsoon-slate", name: "Monsoon Slate", paint: { r: 47, g: 63, b: 92 } },
  { id: "kesar", name: "Kesar", paint: { r: 232, g: 163, b: 23 } },
  { id: "raat-black", name: "Raat Black", paint: { r: 13, g: 13, b: 15 } },
];

export const HUBS: HubSeed[] = [
  { id: "pune", name: "Pune", roadTaxSteps: [{ effectiveFrom: "2026-10-01", percent: 11 }] },
  { id: "bengaluru", name: "Bengaluru", roadTaxSteps: [{ effectiveFrom: "2026-10-01", percent: 18 }] },
  { id: "gurugram", name: "Gurugram", roadTaxSteps: [{ effectiveFrom: "2026-10-01", percent: 8 }] },
  {
    id: "kochi",
    name: "Kochi",
    roadTaxSteps: [
      { effectiveFrom: "2026-10-01", percent: 12 },
      { effectiveFrom: "2026-11-02", percent: 12.5 },
    ],
  },
];

// The brand's invented closed-day calendar, decided only on the server.
export const CLOSED_DATES: Record<string, string[]> = {
  pune: ["2026-11-08"],
  bengaluru: ["2026-11-01", "2026-11-08"],
  gurugram: ["2026-11-09", "2026-11-08"],
  kochi: ["2026-11-01", "2026-11-08"],
};
// Every Tuesday is closed at every hub.
export const CLOSED_WEEKDAY = 2;

export const ON_HAND: Record<string, Record<string, number>> = {
  // hub -> `model:finish`
  pune: { "megh-349:monsoon-slate": 3, "megh-349:kesar": 1, "megh-349:raat-black": 0, "desh-648:monsoon-slate": 2, "desh-648:kesar": 0, "desh-648:raat-black": 1 },
  bengaluru: { "megh-349:monsoon-slate": 5, "megh-349:kesar": 2, "megh-349:raat-black": 1, "desh-648:monsoon-slate": 1, "desh-648:kesar": 1, "desh-648:raat-black": 0 },
  gurugram: { "megh-349:monsoon-slate": 2, "megh-349:kesar": 0, "megh-349:raat-black": 4, "desh-648:monsoon-slate": 0, "desh-648:kesar": 2, "desh-648:raat-black": 2 },
  kochi: { "megh-349:monsoon-slate": 1, "megh-349:kesar": 1, "megh-349:raat-black": 1, "desh-648:monsoon-slate": 3, "desh-648:kesar": 1, "desh-648:raat-black": 0 },
};

export const CHAPTERS: { id: string; name: string; parts: { id: string; name: string; sentence: string }[] }[] = [
  {
    id: "frame",
    name: "Frame",
    parts: [
      { id: "steering-head", name: "Steering head", sentence: "The steering head sets the rake that everything else answers to." },
      { id: "swingarm", name: "Swingarm", sentence: "The swingarm holds the rear wheel to the frame with no fuss." },
      { id: "side-stand", name: "Side stand", sentence: "The side stand parks the machine on its left." },
    ],
  },
  {
    id: "engine",
    name: "Engine",
    parts: [
      { id: "cylinder", name: "Cylinder", sentence: "The cylinder is the heart the whole machine beats around." },
      { id: "primary-cover", name: "Primary cover", sentence: "The primary cover hides the drive that never needs a look." },
    ],
  },
  {
    id: "tank",
    name: "Tank",
    parts: [
      { id: "filler-cap", name: "Filler cap", sentence: "The filler cap takes fuel without a spill." },
      { id: "knee-recess", name: "Knee recess", sentence: "The knee recess is shaped for long days in the saddle." },
    ],
  },
  {
    id: "wheels",
    name: "Wheels",
    parts: [
      { id: "front-rim", name: "Front rim", sentence: "The front rim turns nineteen inches of road into feel." },
      { id: "rear-rim", name: "Rear rim", sentence: "The rear rim carries the drive and the load." },
      { id: "chain", name: "Chain", sentence: "The chain runs on the rider's left, in the open." },
    ],
  },
  {
    id: "exhaust",
    name: "Exhaust",
    parts: [
      { id: "header", name: "Header", sentence: "The header leaves the cylinder and heads right." },
      { id: "silencer", name: "Silencer", sentence: "The silencer ends the run on the right side." },
    ],
  },
  {
    id: "seat",
    name: "Seat",
    parts: [
      { id: "rider-seat", name: "Rider seat", sentence: "The rider seat is flat and honest for a full day." },
      { id: "pillion-seat", name: "Pillion seat", sentence: "The pillion seat takes a second without complaint." },
    ],
  },
  {
    id: "cluster",
    name: "Cluster",
    parts: [
      { id: "needle", name: "Needle", sentence: "The needle settles on the hours your lock has left." },
      { id: "tell-tale", name: "Tell-tale", sentence: "The tell-tale lights only when the truth is delayed." },
      { id: "display", name: "Display", sentence: "The display reads units left and the next free ride." },
    ],
  },
];

export const SEED_HOSTS: { name: string; mobile: string; hub: string }[] = [
  { name: "Nandini Rao", mobile: "9000000101", hub: "pune" },
  { name: "Farhan Qureshi", mobile: "9000000102", hub: "bengaluru" },
  { name: "Simran Gill", mobile: "9000000103", hub: "gurugram" },
  { name: "Thomas Varghese", mobile: "9000000104", hub: "kochi" },
  { name: "Leela Kamat", mobile: "9000000105", hub: "pune" },
];

export const SEED_RIDERS: { name: string; mobile: string; licenceNumber: string | null; licenceValidUntil: string | null }[] = [
  { name: "Kabir Menon", mobile: "9000000201", licenceNumber: "MH1220190043210", licenceValidUntil: "2031-03-15" },
  { name: "Ira Deshpande", mobile: "9000000202", licenceNumber: "MH1420210098765", licenceValidUntil: "2026-10-29" },
  { name: "Tara Joseph", mobile: "9000000203", licenceNumber: "KL0720180012345", licenceValidUntil: "2030-06-30" },
  { name: "Arjun Bhatt", mobile: "9000000204", licenceNumber: null, licenceValidUntil: null },
  { name: "Meera Pillai", mobile: "9000000205", licenceNumber: null, licenceValidUntil: null },
];

export const SEED_RIDES: { riderMobile: string; hub: string; model: string; startsAtMs: number; state: string }[] = [
  // 10:00 IST is 04:30 UTC on the seeded date
  { riderMobile: "9000000201", hub: "pune", model: "megh-349", startsAtMs: Date.UTC(2026, 9, 28, 4, 30), state: "booked" },
  // 12:15 IST is 06:45 UTC
  { riderMobile: "9000000202", hub: "pune", model: "desh-648", startsAtMs: Date.UTC(2026, 9, 28, 6, 45), state: "booked" },
];

// Pune on 2026-11-06 has 11 of 12 Dhanteras places taken by earlier sales.
export const EARLIER_SALES: { hub: string; date: string; count: number }[] = [
  { hub: "pune", date: "2026-11-06", count: 11 },
];

export function modelById(id: string): ModelSeed | undefined {
  return MODELS.find((m) => m.id === id);
}

export function finishById(id: string): FinishSeed | undefined {
  return FINISHES.find((f) => f.id === id);
}

export function hubById(id: string): HubSeed | undefined {
  return HUBS.find((h) => h.id === id);
}
