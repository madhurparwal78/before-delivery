export type ModelId = "megh-349" | "desh-648";
export type FinishId = "monsoon-slate" | "kesar" | "raat-black";
export type HubId = "pune" | "bengaluru" | "gurugram" | "kochi";
export type ChapterId = "frame" | "engine" | "tank" | "wheels" | "exhaust" | "seat" | "cluster";
type Rgb = readonly [number, number, number];

export const MODELS: readonly { id: ModelId; name: string; cc: number }[] = [
  { id: "megh-349", name: "Megh 349", cc: 349 },
  { id: "desh-648", name: "Desh 648", cc: 648 },
];

export const FINISHES: readonly { id: FinishId; name: string; paint: Rgb }[] = [
  { id: "monsoon-slate", name: "Monsoon Slate", paint: [47, 63, 92] },
  { id: "kesar", name: "Kesar", paint: [232, 163, 23] },
  { id: "raat-black", name: "Raat Black", paint: [13, 13, 15] },
];

export const HUBS: readonly { id: HubId; name: string }[] = [
  { id: "pune", name: "Pune" },
  { id: "bengaluru", name: "Bengaluru" },
  { id: "gurugram", name: "Gurugram" },
  { id: "kochi", name: "Kochi" },
];

export const CHAPTERS: readonly {
  id: ChapterId;
  name: string;
  statement: string;
  from: number;
  to: number;
  jump: number;
  seat: number;
  start: number;
  parts: readonly { id: string; name: string; sentence: string }[];
}[] = [
  {
    id: "frame", name: "Frame", statement: "It starts as a frame.", from: 0, to: 0.14, jump: 0.07, seat: 0.14, start: 0,
    parts: [
      { id: "steering-head", name: "Steering head", sentence: "Twenty-six degrees of rake, set in one welded head tube." },
      { id: "swingarm", name: "Swingarm", sentence: "A boxed arm that keeps the rear tyre planted over broken tar." },
      { id: "side-stand", name: "Side stand", sentence: "It rests on the left, leaning eight degrees into its stand." },
    ],
  },
  {
    id: "engine", name: "Engine", statement: "Then the heart goes in.", from: 0.14, to: 0.28, jump: 0.21, seat: 0.28, start: 0.14,
    parts: [
      { id: "cylinder", name: "Cylinder", sentence: "Finned iron and alloy, bored for a long, easy pull." },
      { id: "primary-cover", name: "Primary cover", sentence: "The left case that keeps the clutch and primary drive dry." },
    ],
  },
  {
    id: "tank", name: "Tank", statement: "The tank takes your colour.", from: 0.28, to: 0.42, jump: 0.35, seat: 0.42, start: 0.28,
    parts: [
      { id: "filler-cap", name: "Filler cap", sentence: "A quarter-turn cap, flush with the paint." },
      { id: "knee-recess", name: "Knee recess", sentence: "Scooped on both sides so your knees lock in at a stop." },
    ],
  },
  {
    id: "wheels", name: "Wheels", statement: "Nineteen in front, seventeen behind.", from: 0.42, to: 0.56, jump: 0.49, seat: 0.56, start: 0.42,
    parts: [
      { id: "front-rim", name: "Front rim", sentence: "A nineteen-inch rim that rolls over potholes instead of dropping in." },
      { id: "rear-rim", name: "Rear rim", sentence: "A seventeen-inch rim, wide enough to put the power down." },
      { id: "chain", name: "Chain", sentence: "Sealed, on the left, and quiet at every speed." },
    ],
  },
  {
    id: "exhaust", name: "Exhaust", statement: "The pipe runs on the right.", from: 0.56, to: 0.7, jump: 0.63, seat: 0.7, start: 0.56,
    parts: [
      { id: "header", name: "Header", sentence: "Equal-length pipes leave the head and sweep low to the right." },
      { id: "silencer", name: "Silencer", sentence: "A deep note at idle that settles to a murmur on the highway." },
    ],
  },
  {
    id: "seat", name: "Seat", statement: "A seat for your road.", from: 0.7, to: 0.84, jump: 0.77, seat: 0.84, start: 0.7,
    parts: [
      { id: "rider-seat", name: "Rider seat", sentence: "Dense foam cut low, so both feet reach the ground." },
      { id: "pillion-seat", name: "Pillion seat", sentence: "Raised a little, with a grab rail within easy reach." },
    ],
  },
  {
    id: "cluster", name: "Cluster", statement: "Now it reads the truth.", from: 0.84, to: 1, jump: 0.92, seat: 0.86, start: 0.78,
    parts: [
      { id: "needle", name: "Needle", sentence: "It sweeps the hours left on your lock and settles." },
      { id: "tell-tale", name: "Tell-tale", sentence: "It lights when the hub's stock cannot be trusted." },
      { id: "display", name: "Display", sentence: "Units left and the next free ride, read from the hub." },
    ],
  },
];

export const KEY_ON_AT = 0.86;
export const DEFAULTS = { model: "megh-349" as ModelId, hub: "pune" as HubId, finish: "monsoon-slate" as FinishId };

export const modelName = (id: string): string => MODELS.find((m) => m.id === id)?.name ?? id;
export const finishName = (id: string): string => FINISHES.find((f) => f.id === id)?.name ?? id;
export const hubName = (id: string): string => HUBS.find((h) => h.id === id)?.name ?? id;
export const isModel = (v: unknown): v is ModelId => MODELS.some((m) => m.id === v);
export const isFinish = (v: unknown): v is FinishId => FINISHES.some((f) => f.id === v);
export const isHub = (v: unknown): v is HubId => HUBS.some((h) => h.id === v);
export const chapterAt = (progress: number) =>
  CHAPTERS.find((c) => progress < c.to) ?? (CHAPTERS[CHAPTERS.length - 1] as (typeof CHAPTERS)[number]);
