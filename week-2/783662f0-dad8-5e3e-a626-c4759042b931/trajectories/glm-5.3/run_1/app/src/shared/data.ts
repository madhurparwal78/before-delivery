/** Static domain data: items, recipes, packs, plans, layouts, chapters, seed people. */

export interface ItemKind {
  kind: string;
  name: string;
}

export const Items: ItemKind[] = [
  { kind: "wood", name: "wood block" },
  { kind: "stone", name: "stone block" },
  { kind: "brick", name: "brick block" },
  { kind: "glass", name: "glass block" },
  { kind: "fence", name: "fence" },
  { kind: "signpost", name: "signpost" },
  { kind: "window", name: "window" },
  { kind: "milestone", name: "milestone" },
  { kind: "lantern", name: "lantern" },
  { kind: "compass", name: "compass" },
  { kind: "rope", name: "rope" },
  { kind: "trowel", name: "trowel" },
  { kind: "whistle", name: "whistle" },
  { kind: "map_case", name: "map case" },
];

export const ItemNameByKind: Record<string, string> = Object.fromEntries(Items.map((i) => [i.kind, i.name]));

export function itemName(kind: string): string {
  return ItemNameByKind[kind] ?? kind;
}

export const BlockMaterials = ["wood", "stone", "brick", "glass"] as const;
export type BlockMaterial = (typeof BlockMaterials)[number];

export const LoadoutItems = ["compass", "rope", "lantern", "trowel", "whistle", "map_case"] as const;
export const Appearances = ["surveyor", "mason", "pilot", "gardener"] as const;
export const AppearanceNames: Record<string, string> = { surveyor: "Surveyor", mason: "Mason", pilot: "Pilot", gardener: "Gardener" };

export interface Recipe {
  id: string;
  name: string;
  inputs: { kind: string; count: number }[];
  output: { kind: string; count: number };
}

export const Recipes: Recipe[] = [
  { id: "fence", name: "Fence", inputs: [{ kind: "wood", count: 2 }], output: { kind: "fence", count: 1 } },
  { id: "signpost", name: "Signpost", inputs: [{ kind: "wood", count: 1 }, { kind: "fence", count: 1 }], output: { kind: "signpost", count: 1 } },
  { id: "window", name: "Window", inputs: [{ kind: "glass", count: 1 }, { kind: "wood", count: 2 }], output: { kind: "window", count: 1 } },
  { id: "milestone", name: "Milestone", inputs: [{ kind: "stone", count: 3 }], output: { kind: "milestone", count: 1 } },
  { id: "lantern", name: "Lantern", inputs: [{ kind: "glass", count: 1 }, { kind: "brick", count: 1 }], output: { kind: "lantern", count: 1 } },
];

export interface CoinPack {
  pack: string;
  name: string;
  coins: number;
  price: string;
}

export const CoinPacks: CoinPack[] = [
  { pack: "pouch", name: "Pouch", coins: 100, price: "1.00" },
  { pack: "satchel", name: "Satchel", coins: 550, price: "5.00" },
  { pack: "chest", name: "Chest", coins: 1200, price: "10.00" },
];

export interface Plan {
  plan: string;
  name: string;
  price: string;
  monthlyDollars: string;
  characters: number;
  members: number;
}

export const Plans: Record<"hamlet" | "borough", Plan> = {
  hamlet: { plan: "hamlet", name: "Hamlet", price: "6.00", monthlyDollars: "6.00 USD a month", characters: 12, members: 6 },
  borough: { plan: "borough", name: "Borough", price: "12.00", monthlyDollars: "12.00 USD a month", characters: 40, members: 20 },
};

export const TimeZones: string[] = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Africa/Accra",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export const WorldWidth = 40;
export const WorldHeight = 24;

export type TileCode = "." | "~" | "=" | "#" | "s" | "T";

export const TileLabels: Record<string, string> = {
  ".": "Grass",
  "~": "Water",
  "=": "Road",
  "#": "Runway",
  s: "Sand",
  T: "Table",
};

export function tileLabel(code: string): string {
  return TileLabels[code] ?? "Grass";
}

/** The starter layout, 40 by 24, grass unless listed. */
export function starterLayout(tableTiles: { x: number; y: number }[]): string[] {
  const rows: string[][] = [];
  for (let y = 0; y < WorldHeight; y++) {
    const row: string[] = [];
    for (let x = 0; x < WorldWidth; x++) row.push(".");
    rows.push(row);
  }
  for (let x = 0; x < WorldWidth; x++) rows[10]![x] = "=";
  for (let y = 11; y <= 17; y++) rows[y]![20] = "=";
  for (let x = 30; x <= 37; x++) rows[2]![x] = "#";
  for (let y = 18; y <= 23; y++) {
    for (let x = 0; x <= 5; x++) rows[y]![x] = "~";
    for (let x = 34; x <= 39; x++) rows[y]![x] = "s";
  }
  for (const t of tableTiles) {
    if (t.x >= 0 && t.x < WorldWidth && t.y >= 0 && t.y < WorldHeight) rows[t.y]![t.x] = "T";
  }
  return rows.map((r) => r.join(""));
}

export const SpawnTile = { x: 16, y: 8 };

export const StarterStacks: { slot: number; kind: string; count: number }[] = [
  { slot: 1, kind: "wood", count: 16 },
  { slot: 2, kind: "stone", count: 16 },
  { slot: 3, kind: "brick", count: 8 },
  { slot: 4, kind: "glass", count: 4 },
];

export const Chapter = {
  id: "surveyors-pegs",
  title: "The Surveyor's Pegs",
  checkpoints: [
    { n: 1, name: "Old Well", x: 8, y: 12 },
    { n: 2, name: "Mill Gate", x: 24, y: 12 },
    { n: 3, name: "Runway Beacon", x: 34, y: 3 },
  ],
};

export const AchievementNames = [
  "First Stone",
  "Groundbreaker",
  "Smooth Landing",
  "Long Haul",
  "Checkmate Artist",
  "Four Down",
  "Trick Taker",
  "Maker",
] as const;

export const SeedUsers = [
  { handle: "mara", display_name: "Mara Quill", passcode: "mara-plots-01" },
  { handle: "tobias", display_name: "Tobias Wren", passcode: "tobias-plots-02" },
  { handle: "ines", display_name: "Ines Varga", passcode: "ines-plots-03" },
  { handle: "kofi", display_name: "Kofi Ansel", passcode: "kofi-plots-04" },
  { handle: "juno", display_name: "Juno Hart", passcode: "juno-plots-05" },
  { handle: "oskar", display_name: "Oskar Lind", passcode: "oskar-plots-06" },
  { handle: "priya", display_name: "Priya Sorrel", passcode: "priya-plots-07" },
  { handle: "rowan", display_name: "Rowan Ashby", passcode: "rowan-plots-08" },
  { handle: "sefa", display_name: "Sefa Okoro", passcode: "sefa-plots-09" },
  { handle: "dara", display_name: "Dara Finch", passcode: "dara-plots-10" },
  { handle: "eli", display_name: "Eli Brandt", passcode: "eli-plots-11" },
] as const;

export const SeedServers = [
  {
    slug: "larkspur-commons",
    name: "Larkspur Commons",
    owner: "mara",
    members: ["ines", "kofi", "juno", "oskar"],
    plan: "borough" as const,
    time_zone: "UTC",
    weather_seed: 0,
    world: { slug: "meadow", name: "Meadow Survey" },
    characters: [
      { name: "Quarry Mara", user: "mara", x: 19, y: 7 },
      { name: "Inkfinch", user: "ines", x: 12, y: 7 },
      { name: "Kestrel", user: "kofi", x: 13, y: 7 },
      { name: "Junebug", user: "juno", x: 12, y: 9 },
      { name: "Oxbow", user: "oskar", x: 21, y: 7 },
    ],
    vehicles: [
      { name: "Blue Hatchback", kind: "car" as const, owner: "Kestrel", x: 5, y: 10 },
      { name: "Paper Kite", kind: "plane" as const, owner: "Inkfinch", x: 31, y: 2 },
      { name: "Moth", kind: "plane" as const, owner: "Junebug", x: 33, y: 2 },
    ],
  },
  {
    slug: "fennel-reach",
    name: "Fennel Reach",
    owner: "tobias",
    members: ["priya", "ines"],
    plan: "hamlet" as const,
    time_zone: "America/Chicago",
    weather_seed: 2,
    world: { slug: "saltmarsh", name: "Saltmarsh Survey" },
    characters: [
      { name: "Tinderwren", user: "tobias", x: 12, y: 7 },
      { name: "Pennyroyal", user: "priya", x: 13, y: 7 },
      { name: "Kesh", user: "priya", x: 20, y: 7 },
      { name: "Inkwell", user: "ines", x: 21, y: 7 },
    ],
    vehicles: [{ name: "Rust Pickup", kind: "car" as const, owner: "Pennyroyal", x: 2, y: 10 }],
  },
] as const;

export const SeedTables = [
  { name: "Oak Chess Table", game: "chess", x: 12, y: 6 },
  { name: "Lantern Four Table", game: "four", x: 16, y: 6 },
  { name: "Felt Card Table", game: "tricks", x: 20, y: 6 },
  { name: "Birch Chess Table", game: "chess", x: 24, y: 6 },
] as const;

export const SeatLabels: Record<string, string[]> = {
  chess: ["White", "Black"],
  four: ["Ink", "Gold"],
  tricks: ["North", "East", "South", "West"],
};

export const GameNames: Record<string, string> = { chess: "Chess", four: "Four in a row", tricks: "Card game" };

export const MaxCharactersPerUser = 3;

export const DemonstrationGame = "a2a3 e7e5 b2b3 b8c6 h2h3 d7d6 a3a4 c8e6 f2f3 a7a6 g2g4 d8h4";
