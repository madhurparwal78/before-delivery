// API client and shared app state for the browser.
import type { Locale } from "./i18n.js";

export interface Money { cents: number; currency: "CAD"; }
export interface TaxLine { code: "GST" | "QST" | "HST"; rate: string; amount: Money; }
export interface Bar { number: number; status: "available" | "held" | "sold"; }
export interface Batch {
  code: string; scent: string; state: string; bars_cut: number;
  available: number; held: number; sold: number; bars: Bar[];
  unit_price: Money; cure_date: string; drop_at: string | null; drop_at_local: string | null;
  poured_on?: string; cure_days?: number; holds?: { bar: number; expires_at: string }[];
}
export interface Hold {
  id: string; batch: string; bar: number; status: string;
  created_at: string; expires_at: string; amount: Money;
}
export interface Cart {
  server_now: string; holds: Hold[]; batches: { code: string; available: number; held: number; sold: number }[];
  province: string; subtotal: Money; shipping_fee: Money; taxes: TaxLine[]; total: Money;
}
export interface Order {
  number: string; status: string; fulfilment: string; placed_at: string; ship_on: string;
  locale: string; email: string;
  shipping: { name: string; line1: string; city: string; province: string; postal_code: string };
  lines: { batch: string; scent: string; bar: number; unit_price: Money; refunded: boolean }[];
  subtotal: Money; shipping_fee: Money; taxes: TaxLine[]; total: Money; refunded: Money; version: number;
  refunds?: Refund[]; credits?: Credit[];
}
export interface Refund {
  number: string; order: string; status: string; bars: { batch: string; bar: number }[];
  restock: boolean; amount: Money;
  allocation: { bars: Money; shipping: Money; taxes: TaxLine[] };
  reason: string; killbill_ref: string | null; created_at: string;
}
export interface Credit {
  number: string; target: string; status: string; amount: Money;
  reason: string; killbill_ref: string | null; created_at: string;
}
export interface Subscription {
  number: string; state: string; scent: string; cadence: string; pending_cadence: string | null;
  started_on: string; next_bill_date: string | null; skipped_bill_date: string | null; paused_from: string | null;
  locks_at: string | null; locked: boolean;
  shipping: { name: string; line1: string; city: string; province: string; postal_code: string };
  price: { subtotal: Money; discount: Money; pre_tax: Money; taxes: TaxLine[]; total: Money };
  version: number;
  email?: string; credits?: Credit[];
}
export interface PackingOrder {
  number: string; ship_on: string; name: string;
  address: { line1: string; city: string; province: string; postal_code: string };
  bars: { batch: string; scent: string; bar: number }[];
  fulfilment: string; version: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public fields: Record<string, string> | null
  ) {
    super(message);
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  ifMatch?: string;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  if (options.ifMatch) {
    headers["If-Match"] = options.ifMatch;
  }
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: { ...headers, ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin"
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text === "" ? undefined : JSON.parse(text);
  if (res.status >= 400) {
    const error = (data as { error?: { code: string; message: string; fields?: Record<string, string> } })?.error;
    throw new ApiError(res.status, error?.code ?? "error", error?.message ?? "", error?.fields ?? null);
  }
  return data as T;
}

export type Api = typeof api;

export function setLocaleCookie(locale: Locale): void {
  document.cookie = `pdl_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function readLocaleCookie(): Locale | null {
  const match = /(?:^|;\s*)pdl_locale=(fr-CA|en-CA)(?:;|$)/.exec(document.cookie);
  return match ? (match[1] as Locale) : null;
}

export function initialLocale(): Locale {
  return readLocaleCookie() ?? ((navigator.language ?? "").toLowerCase().startsWith("fr") ? "fr-CA" : "en-CA");
}

/** Generate an idempotency key for a checkout or subscription start. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export const PROVINCES: { code: string; en: string; fr: string }[] = [
  { code: "AB", en: "Alberta", fr: "Alberta" },
  { code: "BC", en: "British Columbia", fr: "Colombie-Britannique" },
  { code: "MB", en: "Manitoba", fr: "Manitoba" },
  { code: "NB", en: "New Brunswick", fr: "Nouveau-Brunswick" },
  { code: "NL", en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador" },
  { code: "NS", en: "Nova Scotia", fr: "Nouvelle-Écosse" },
  { code: "NT", en: "Northwest Territories", fr: "Territoires du Nord-Ouest" },
  { code: "NU", en: "Nunavut", fr: "Nunavut" },
  { code: "ON", en: "Ontario", fr: "Ontario" },
  { code: "PE", en: "Prince Edward Island", fr: "Île-du-Prince-Édouard" },
  { code: "QC", en: "Québec", fr: "Québec" },
  { code: "SK", en: "Saskatchewan", fr: "Saskatchewan" },
  { code: "YT", en: "Yukon", fr: "Yukon" }
];

export const DROP_SCENTS = [
  { slug: "lavender-oat", en: "Lavender & Oat", fr: "Lavande et avoine", tint: "lilac", notesEn: "Lavender, colloidal oat, a little honey", notesFr: "Lavande, avoine colloïdale, un peu de miel" },
  { slug: "smoked-birch", en: "Smoked Birch", fr: "Bouleau fumé", tint: "ash", notesEn: "Birch tar, cedar leaf, black pepper", notesFr: "Goudron de bouleau, feuille de cèdre, poivre noir" },
  { slug: "wild-mint", en: "Wild Mint", fr: "Menthe sauvage", tint: "mint", notesEn: "Spearmint, nettle, green clay", notesFr: "Menthe verte, ortie, argile verte" },
  { slug: "rose-clay", en: "Rose Clay", fr: "Argile rose", tint: "rose", notesEn: "Rose geranium, pink kaolin", notesFr: "Géranium rosat, kaolin rose" }
];

export const TRIO_SCENTS = [
  { slug: "oat-milk", en: "Oat Milk", fr: "Lait d'avoine" },
  { slug: "cedar-sage", en: "Cedar & Sage", fr: "Cèdre et sauge" },
  { slug: "unscented", en: "Unscented", fr: "Sans parfum" }
];

export function scentName(slug: string, locale: Locale): string {
  const scent = DROP_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return slug;
  return locale === "fr-CA" ? scent.fr : scent.en;
}

export function trioScentName(slug: string, locale: Locale): string {
  const scent = TRIO_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return slug;
  return locale === "fr-CA" ? scent.fr : scent.en;
}

export function scentTint(slug: string): string {
  return DROP_SCENTS.find((candidate) => candidate.slug === slug)?.tint ?? "lilac";
}

export function scentNotes(slug: string, locale: Locale): string {
  const scent = DROP_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return "";
  return locale === "fr-CA" ? scent.notesFr : scent.notesEn;
}

export function cadenceLabel(cadence: string, locale: Locale): string {
  if (cadence === "MONTHLY") return locale === "fr-CA" ? "Chaque mois" : "Every month";
  if (cadence === "BIMESTRIAL") return locale === "fr-CA" ? "Tous les deux mois" : "Every two months";
  return locale === "fr-CA" ? "Tous les trois mois" : "Every three months";
}

export function cadenceLabelLower(cadence: string, locale: Locale): string {
  const label = cadenceLabel(cadence, locale);
  return locale === "fr-CA" ? label : label.toLowerCase();
}
