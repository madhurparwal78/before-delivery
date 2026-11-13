import type { FeeTier } from "../shared/transitions";

// The desk's API as the browser sees it (brief: API). Every call is same-origin and carries the session cookie.

export type Role = "director" | "juror" | "studio";
export type Award = "winner" | "finalist" | "honourable_mention";
export type Cut = "above" | "below";

export interface User {
  id: string;
  role: Role;
  name: string;
  email: string;
  studioId: string | null;
  studioName: string | null;
}

export interface Category {
  id: string;
  name: string;
  shortlistSize: number;
  finalistCount: number;
  rounds?: { id: string; name: string; kind: "round_1" | "final"; state: string }[];
}

export interface Program {
  id: string;
  name: string;
  year: number;
  timeZone: string;
  earlyBirdDate: string;
  deadlineDate: string;
  earlyBirdEndsAt: string;
  deadlineAt: string;
  earlyBirdLabel: string;
  deadlineLabel: string;
  earlyBirdFeeCents: number;
  standardFeeCents: number;
  currentTier: FeeTier;
  currentFeeCents: number;
  entriesOpen: boolean;
  categories: Category[];
}

export interface Asset {
  id: string;
  url: string;
  name: string;
  type: string;
  width: number;
  height: number;
  bytes: number;
}

export interface Entry {
  id: string;
  entryNumber: number;
  programId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  summary: string;
  siteUrl: string;
  credits: string;
  state: string;
  statusLabel: string;
  disqualifyReason: string | null;
  award: Award | null;
  score: string | null;
  assets: Asset[];
  fee: { tier: FeeTier; amountCents: number } | null;
  submittedAt: string | null;
  deadlineLabel: string;
  canWithdraw: boolean;
  refundOnWithdraw: boolean;
  studioId?: string;
  studioName?: string;
  studioEmail?: string;
}

export interface Receipt {
  entryNumber: number;
  title: string;
  amountCents: number;
  currency: string;
  tier: FeeTier;
  invoiceId: string;
  paymentId: string;
  paidAt: string;
  refund: { amountCents: number; refundedAt: string } | null;
}

export interface Round {
  id: string;
  categoryId: string;
  name: string;
  kind: "round_1" | "final";
  state: string;
  ballotDeadline: string | null;
  ballotDeadlineLabel: string | null;
  ballotDeadlineAt: string | null;
}

export interface PanelRow {
  jurorId: string;
  name: string;
  assigned: number;
  scored: number;
  remaining: number;
  ballotSubmitted: boolean;
}

interface StandingRow {
  rank: number;
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  score: string | null;
  cut: Cut;
  award: Award | null;
}

export interface Standings {
  provisional: boolean;
  cut: number;
  cutLabel: string;
  rows: StandingRow[];
}

export interface Scores {
  craft: number;
  clarity: number;
  idea: number;
  story: number;
}

export interface BlindEntry {
  entryId: string;
  entryNumber: number;
  title: string;
  summary: string;
  images: { url: string; width: number; height: number }[];
  scores: Scores | null;
}

export interface Ballot {
  round: { id: string; name: string; categoryName: string; ballotDeadlineLabel: string; ballotDeadlineAt: string; state: string };
  entries: BlindEntry[];
  assigned: number;
  scored: number;
  remaining: number;
  submitted: boolean;
}

interface LeaderRow {
  rank: number;
  entryNumber: number;
  title: string;
  studioName: string;
  score: string | null;
  previousRank: number;
  previousScore: string | null;
  award: Award | null;
  cut: Cut;
}

export interface LeaderCategory {
  id: string;
  name: string;
  state: "pending" | "embargoed" | "revealed";
  revealsAt: string | null;
  revealsLabel: string | null;
  cut: number;
  rows: LeaderRow[];
}

export interface Board {
  program: { id: string; name: string; year: number; timeZone: string };
  categories: LeaderCategory[];
}

export interface GalleryItem {
  entryNumber: number;
  title: string;
  studioName: string;
  programName: string;
  year: number;
  category: string;
  award: Award;
  score: string | null;
  images: string[];
}

const NETWORK_COPY = "The desk can't be reached. Check your connection and try again.";

export type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string | null; message: string; fields: Record<string, string> };

interface ErrorBody {
  error?: string;
  message?: string;
  errors?: Record<string, string>;
}

/** The copy to show for a refusal: the server's message, or the field errors joined. */
function refusal<T>(status: number, body: ErrorBody | null): Result<T> {
  const fields = body?.errors ?? {};
  const message = body?.message ?? (Object.values(fields).join(" ") || NETWORK_COPY);
  return { ok: false, status, code: body?.error ?? null, message, fields };
}

export async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: null, message: NETWORK_COPY, fields: {} };
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return refusal(response.status, parsed as ErrorBody | null);
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}, headers: Record<string, string> = {}) => request<T>("POST", path, body, headers);
export const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
export const del = <T>(path: string) => request<T>("DELETE", path);

/** Multipart upload with real progress events (brief: Interactions, Images). */
export function upload(path: string, file: File, onProgress: (fraction: number) => void): Promise<Result<{ asset: Asset }>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      const parsed: unknown = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      resolve(xhr.status >= 200 && xhr.status < 300
        ? { ok: true, status: xhr.status, data: parsed as { asset: Asset } }
        : refusal(xhr.status, parsed as ErrorBody | null));
    });
    xhr.addEventListener("error", () => resolve({ ok: false, status: 0, code: null, message: NETWORK_COPY, fields: {} }));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
