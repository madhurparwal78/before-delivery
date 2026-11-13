export const EDITION = 240;
export const PLATES = ["Stove", "Goose", "Tree", "Star", "Grandmother"] as const;
export type Plate = (typeof PLATES)[number];

export const plateOf = (number: number): Plate => PLATES[(number - 1) % PLATES.length] as Plate;

export const CHAPTERS = ["alley", "stove", "goose", "tree", "star", "grandmother", "shelf"] as const;
export type Chapter = (typeof CHAPTERS)[number];

/** Lower edge of each chapter's progress range; the shelf range includes 1. */
export const CHAPTER_EDGES: Record<Chapter, number> = {
  alley: 0,
  stove: 0.12,
  goose: 0.3,
  tree: 0.46,
  star: 0.62,
  grandmother: 0.72,
  shelf: 0.86,
};

export const chapterOf = (progress: number): Chapter => {
  let found: Chapter = "alley";
  for (const chapter of CHAPTERS) if (progress >= CHAPTER_EDGES[chapter]) found = chapter;
  return found;
};

export const STRIKE_CHAPTERS: readonly Chapter[] = ["stove", "goose", "tree", "star", "grandmother"];

export const SHELF_COLUMNS = { phone: 6, tablet: 12, laptop: 20 } as const;
export const PHONE_MAX_WIDTH = 767;
export const TABLET_MAX_WIDTH = 1279;

export type PublicBoxState = "available" | "held" | "taken";
export type CellState = PublicBoxState | "yours";

const BOX_STATES = ["available", "awaiting_transfer", "claimed", "packed", "shipped", "returned"] as const;
export type BoxState = (typeof BOX_STATES)[number];

const PAYMENT_STATES = [
  "started", "challenge", "declined", "authorised", "captured", "partially_refunded", "refunded",
  "voided", "capture_failed", "authorisation_expired", "pending", "settled", "lapsed",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const ROLES = ["maker", "packer", "treasurer"] as const;
export type Role = (typeof ROLES)[number];

export const STORY_BURN_MS = 12000;
export const SPARK_MS = 180;
export const FLARE_MS = 320;
export const VISION_MS = 900;
export const BUNDLE_MATCHES = 12;
export const MAX_GIFT_MESSAGE = 280;
export const ORDER_LOOKUP_TRIES = 5;

export const CLOSES_AT = "2027-02-01T00:00:00+01:00";
export const CHARITY_NAME = "Varmestuen Nord";
export const EDITION_PRICE = { priceOre: 149500, netOre: 119600, vatOre: 29900, courierOre: 8900, totalOre: 158400 } as const;
export const SEED_RATE_BASIS_POINTS = 3150;
