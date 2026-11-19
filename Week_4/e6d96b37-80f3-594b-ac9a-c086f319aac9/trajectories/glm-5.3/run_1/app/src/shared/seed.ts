export interface SpecimenRef {
  key: string;
  display_label: string;
  status: string;
}

export interface OfferRef {
  key: string;
  status: string;
  dealer_items: string[];
  counterpart_items: string[];
}

export interface SeedEntries {
  dealer: string;
  dealer_peer: string;
  counterpart: string;
  outsider: string;
}

export interface SeedSessions {
  dealer: string;
  dealer_peer: string;
  counterpart: string;
  outsider: string;
}

export interface SeedMedia {
  obverse: string;
  reverse: string;
}

export type WorkflowKey =
  | "intake"
  | "attribution"
  | "catalog_reconciliation"
  | "tray_placement"
  | "set_tracking"
  | "condition_comparison"
  | "duplicate_selection"
  | "offer_assembly"
  | "counteroffers"
  | "dispatch"
  | "receipt"
  | "disputes"
  | "stock_audit"
  | "cross_cutting";

export type SeedVariant = "base" | "conflict" | "outage" | "offline" | "session";

export interface SeedResult {
  namespace: string;
  entries: SeedEntries;
  sessions: SeedSessions;
  state_url: string;
  media: SeedMedia;
  clock: string;
}

export interface ClockResult {
  clock: string;
}

export interface OtpResult {
  code: string;
}

export interface IdentityResult {
  role: "counterpart";
  action: "revoke" | "password_change";
}

export interface StorageState {
  cookies: { name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}
