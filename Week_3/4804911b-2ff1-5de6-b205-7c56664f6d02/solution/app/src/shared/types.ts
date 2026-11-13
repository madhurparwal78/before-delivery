// Wire shapes of the API section of the brief. Money is integer paise except unitSalePrice.rupees.
export type Format = "carton" | "pet" | "glass" | "can";
export interface NoticeRef { number: string; version: number }
export interface UnitSalePrice { rupees: string; per: "ml" | "litre" }

export interface PackFacts {
  batchCode: string; skuCode: string; drinkName: string; skuName: string; format: Format; sizeMl: number;
  packedDate: string; printDate: string; oldWrapper: boolean; wrapperNotice: NoticeRef | null; bestBeforeDate: string;
  printedMrpPaise: number; revisedMrpPaise: number | null; retailPricePaise: number; unitSalePrice: UnitSalePrice | null;
  sugarMgPerPack: number; stickerApplies: boolean; stickerNote: string | null; pastBestBefore: boolean;
  dateNote: string | null; sourceNotice: NoticeRef | null;
}

export interface NoticeRow {
  skuCode: string; name: string; kind: "sticker" | "new_print"; oldMrpPaise: number; revisedMrpPaise: number;
  oldRate: number | null; newRate: number | null; ceilingPaise: number | null;
}
export interface NoticeVersion {
  version: number; state: "scheduled" | "in_effect" | "superseded"; supersededBy: number | null; title: string;
  effectiveDate: string; runOutUntil: string | null; publishedAt: string; reason: string | null;
  printState: "pending" | "printable" | "failed"; pdfSha256: string | null; sheet: { id: string; sha256: string } | null;
  rows: NoticeRow[];
}
export interface NoticeDetail { number: string; state: "scheduled" | "in_effect"; versions: NoticeVersion[] }

export interface Counts { drinks: number; skus: number; notices: number; scheduledRevisions: number }
export interface SkuSummary {
  code: string; variant: string; name: string; format: Format; sizeMl: number; shelfDays: number;
  sugarMgPerPack: number; currentMrpPaise: number;
}
export interface DrinkSummary { id: string; name: string; carbonated: boolean; skus: SkuSummary[] }
export interface Catalogue { today: string; counts: Counts; drinks: DrinkSummary[] }
export interface SkuDetail extends SkuSummary {
  drinkId: string; drinkName: string; currentSource: NoticeRef | null; unitSalePrice: UnitSalePrice | null; storyBatch: PackFacts;
}

export type SearchState = "current" | "behind" | "down";
export interface SearchResult {
  kind: "sku" | "batch"; skuCode: string; name: string; batchCode: string | null; retailPricePaise: number;
  sourceNotice: NoticeRef | null;
}
export interface SearchAnswer { query: string; searchState: SearchState; results: SearchResult[] }

export interface LinkAnswer { url: string; expiresInSeconds: number; sha256: string }

export interface Session { role: "editor" | "stockist"; email: string; displayName: string; accountId: string }

export interface Endpoint { id: string; url: string; registered: boolean; createdAt: string }
export interface DeliveryAttempt { at: string; responseStatus: number | null; outcome: "success" | "pending" | "failed" }
export interface Delivery {
  eventId: string; eventType: string; noticeNumber: string | null; noticeVersion: number | null; endpointId: string;
  endpointUrl: string; endpointRemoved: boolean; state: "pending" | "delivered" | "failed" | "redelivered" | "cancelled";
  redeliveryRequested: boolean; attempts: DeliveryAttempt[];
}
export interface Deliveries { messagesQueued: boolean; workQueued: boolean; deliveries: Delivery[] }

export interface SheetRow {
  rowNumber: number; raw: { code: string; description: string; newMrp: string; oldGst: string; newGst: string };
  status: "matched" | "ambiguous" | "unmatched" | "settled"; matchedBy: "sku_code" | "alias" | "name_size" | null;
  skuCode: string | null; candidates: string[]; reason: string | null; newMrpPaise: number | null; oldRate: number | null;
  newRate: number | null; mergedIntoRow: number | null; ignored: boolean;
}
export interface Sheet {
  id: string; filename: string; sha256: string; sizeBytes: number; importedAt: string; rowCount: number;
  counts: { matched: number; ambiguous: number; unmatched: number; settled: number }; reused: boolean; rows?: SheetRow[];
}

export interface DraftRow {
  skuCode: string; name: string; kind: "sticker" | "new_print"; oldMrpPaise: number; revisedMrpPaise: number;
  oldRate: number | null; newRate: number | null; ceilingPaise: number | null;
}
export interface Draft {
  id: string; state: "draft"; revision: number; title: string; effectiveDate: string; runOutUntil: string | null;
  sheet: { id: string; sha256: string } | null; rows: DraftRow[];
}
export interface ApiError { error: string; message: string; [extra: string]: unknown }
export interface Preview {
  blocking: ApiError | null;
  rows: { skuCode: string; name: string; kind: "sticker" | "new_print"; oldMrpPaise: number; ceilingPaise: number | null; revisedMrpPaise: number; stickerBatches: string[] }[];
}
export interface EditorState {
  copyId: string; messagesQueued: boolean; workQueued: boolean; searchState: SearchState; heldWork: number; counts: Counts;
  drafts: Draft[]; notices: NoticeDetail[];
}
export interface HistoryEntry { at: string; field: "drink_name" | "variant"; from: string; to: string }
