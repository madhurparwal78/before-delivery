export const RANKS = ['Feather', 'Linen', 'Cedar', 'Granite'] as const;
export type Rank = (typeof RANKS)[number];
export type AssetKind = 'room' | 'avatar';

export const MEASURE_ORDER = ['triangles', 'materials', 'textureSize', 'fileSize'] as const;
export type MeasureKey = (typeof MEASURE_ORDER)[number];

export const MEASURE_LABELS: Record<MeasureKey, string> = {
  triangles: 'triangles',
  materials: 'materials',
  textureSize: 'texture size',
  fileSize: 'file size'
};

export interface Measures {
  triangles: number;
  materials: number;
  textureSize: number;
  fileSize: number;
}

const LIMITS: Record<AssetKind, Record<Rank, Measures>> = {
  avatar: {
    Feather: { triangles: 5000, materials: 2, textureSize: 512, fileSize: 1_000_000 },
    Linen: { triangles: 15000, materials: 4, textureSize: 1024, fileSize: 4_000_000 },
    Cedar: { triangles: 40000, materials: 8, textureSize: 2048, fileSize: 10_000_000 },
    Granite: { triangles: 100000, materials: 16, textureSize: 4096, fileSize: 20_000_000 }
  },
  room: {
    Feather: { triangles: 20000, materials: 8, textureSize: 1024, fileSize: 4_000_000 },
    Linen: { triangles: 60000, materials: 16, textureSize: 2048, fileSize: 12_000_000 },
    Cedar: { triangles: 150000, materials: 32, textureSize: 4096, fileSize: 30_000_000 },
    Granite: { triangles: 400000, materials: 64, textureSize: 8192, fileSize: 50_000_000 }
  }
};

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

export function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank);
}

export function measureRank(kind: AssetKind, measure: MeasureKey, value: number): Rank | null {
  for (const rank of RANKS) {
    if (value <= LIMITS[kind][rank][measure]) return rank;
  }
  return null;
}

export interface RankResult {
  rank: Rank;
  worstMeasure: MeasureKey;
  perMeasure: Record<MeasureKey, Rank>;
}

export function rankOf(kind: AssetKind, measures: Measures): RankResult {
  const perMeasure = {} as Record<MeasureKey, Rank>;
  let worstMeasure: MeasureKey = 'triangles';
  let worstRank: Rank = 'Feather';
  for (const measure of MEASURE_ORDER) {
    const rank = measureRank(kind, measure, measures[measure]) ?? 'Granite';
    perMeasure[measure] = rank;
    if (rankIndex(rank) > rankIndex(worstRank)) {
      worstRank = rank;
      worstMeasure = measure;
    }
  }
  return { rank: worstRank, worstMeasure, perMeasure };
}

export function hiddenByRankSetting(setting: Rank | null, avatarRank: Rank): boolean {
  if (setting === null) return false;
  return rankIndex(avatarRank) > rankIndex(setting);
}
