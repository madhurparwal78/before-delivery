export interface NoticeRef {
  number: string;
  version: number;
}

export interface UnitSalePrice {
  rupees: string;
  per: 'ml' | 'litre';
}

export interface PackFacts {
  batchCode: string;
  skuCode: string;
  drinkName: string;
  skuName: string;
  format: 'carton' | 'pet' | 'glass' | 'can';
  sizeMl: number;
  packedDate: string;
  printDate: string;
  oldWrapper: boolean;
  wrapperNotice: NoticeRef | null;
  bestBeforeDate: string;
  printedMrpPaise: number;
  revisedMrpPaise: number | null;
  retailPricePaise: number;
  unitSalePrice: UnitSalePrice | null;
  sugarMgPerPack: number;
  stickerApplies: boolean;
  stickerNote: string | null;
  pastBestBefore: boolean;
  dateNote: string | null;
  sourceNotice: NoticeRef | null;
}

export interface CatalogueSku {
  code: string;
  variant: string;
  name: string;
  format: 'carton' | 'pet' | 'glass' | 'can';
  sizeMl: number;
  shelfDays: number;
  sugarMgPerPack: number;
  currentMrpPaise: number;
}

export interface CatalogueDrink {
  id: string;
  name: string;
  carbonated: boolean;
  skus: CatalogueSku[];
}

export interface Counts {
  drinks: number;
  skus: number;
  notices: number;
  scheduledRevisions: number;
}

export interface Catalogue {
  today: string;
  counts: Counts;
  drinks: CatalogueDrink[];
}

export interface SkuDetail extends CatalogueSku {
  drinkId: string;
  drinkName: string;
  currentSource: NoticeRef | null;
  unitSalePrice: UnitSalePrice | null;
  storyBatch: PackFacts | null;
}

export interface NoticeRow {
  skuCode: string;
  name: string;
  kind: 'sticker' | 'new_print';
  oldMrpPaise: number;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
  ceilingPaise: number | null;
}

export interface NoticeVersion {
  version: number;
  state: 'scheduled' | 'in_effect' | 'superseded';
  supersededBy: number | null;
  title: string;
  effectiveDate: string;
  runOutUntil: string | null;
  publishedAt: string;
  reason: string | null;
  printState: 'pending' | 'printable' | 'failed';
  pdfSha256: string | null;
  sheet: { id: string; sha256: string } | null;
  rows: NoticeRow[];
}

export interface NoticeSummary {
  number: string;
  state: 'scheduled' | 'in_effect' | 'superseded';
  currentVersion: NoticeVersion;
}

export interface NoticeDetail {
  number: string;
  state: 'scheduled' | 'in_effect' | 'superseded';
  versions: NoticeVersion[];
}

export interface SearchResult {
  kind: 'sku' | 'batch';
  skuCode: string;
  name: string;
  batchCode: string | null;
  retailPricePaise: number;
  sourceNotice: NoticeRef | null;
}

export interface SearchAnswer {
  query: string;
  searchState: 'current' | 'behind' | 'down';
  results: SearchResult[];
}

export interface SessionInfo {
  role: 'editor' | 'stockist';
  email: string;
  displayName: string;
  accountId: string;
}

export interface SignedLink {
  url: string;
  expiresInSeconds: number;
  sha256: string;
}
