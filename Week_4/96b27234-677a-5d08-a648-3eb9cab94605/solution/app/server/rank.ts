import { MEASURES, RANKS, type MeasureName, type Rank } from "../shared/protocol.js";

export type Kind = "room" | "avatar";

export interface Measures {
  triangles: number;
  materials: number;
  textureSize: number;
  fileSize: number;
}

const MEASURE_KEYS: Record<MeasureName, keyof Measures> = {
  triangles: "triangles",
  materials: "materials",
  "texture size": "textureSize",
  "file size": "fileSize",
};

/** Inclusive limits, in the order triangles, materials, texture size, file size. */
const LIMITS: Record<Kind, Record<Rank, [number, number, number, number]>> = {
  avatar: {
    Feather: [5_000, 2, 512, 1_000_000],
    Linen: [15_000, 4, 1024, 4_000_000],
    Cedar: [40_000, 8, 2048, 10_000_000],
    Granite: [100_000, 16, 4096, 20_000_000],
  },
  room: {
    Feather: [20_000, 8, 1024, 4_000_000],
    Linen: [60_000, 16, 2048, 12_000_000],
    Cedar: [150_000, 32, 4096, 30_000_000],
    Granite: [400_000, 64, 8192, 50_000_000],
  },
};

type Ranked =
  | { over: MeasureName }
  | { rank: Rank; worstMeasure: MeasureName; measureRanks: Record<MeasureName, Rank> };

/** The rank of each measure, the file's rank (the worst measure) and the earlier name on a tie. */
export function rankMeasures(kind: Kind, measures: Measures): Ranked {
  const ranks: Partial<Record<MeasureName, Rank>> = {};
  for (const [index, name] of MEASURES.entries()) {
    const value = measures[MEASURE_KEYS[name]];
    const rank = RANKS.find((candidate) => value <= (LIMITS[kind][candidate][index] ?? 0));
    if (!rank) return { over: name };
    ranks[name] = rank;
  }
  const measureRanks = ranks as Record<MeasureName, Rank>;
  const worstIndex = Math.max(...MEASURES.map((name) => RANKS.indexOf(measureRanks[name])));
  const worstMeasure = MEASURES.find((name) => RANKS.indexOf(measureRanks[name]) === worstIndex) ?? "triangles";
  return { rank: RANKS[worstIndex] ?? "Feather", worstMeasure, measureRanks };
}

export const rankOrder = (rank: string): number => RANKS.indexOf(rank as Rank);
