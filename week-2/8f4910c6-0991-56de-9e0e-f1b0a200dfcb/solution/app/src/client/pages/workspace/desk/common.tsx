// Shapes of the API records the desk screens read, and small helpers they share.

import { useCallback, useEffect, useRef, useState } from "react";
import { keepDraft, sessionCopy } from "../../../session.js";
import { officeToday, type OfficeId } from "../../../../shared/zones.js";

export interface TalentSummary {
  id: string;
  slug: string;
  displayName: string;
  state: string;
  office: OfficeId;
  board: string;
}

export interface ClientSummary {
  id: string;
  slug: string;
  company: string;
}

export type OptionState = "placed" | "challenged" | "confirmed" | "released" | "expired";

export interface OptionRecord {
  id: string;
  talentId: string;
  clientId: string;
  clientCompany: string;
  date: string;
  jobTitle: string;
  note: string;
  rank: number | null;
  state: OptionState;
  autoReleaseAt: string;
  holdUntil: string | null;
  releaseAt: string;
  challengeDeadline: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  version: number;
}

export interface LadderDay {
  date: string;
  dayState: "open" | "held" | "booked";
  options: OptionRecord[];
  bookingId: string | null;
}

export interface Ladder {
  talentId: string;
  office: OfficeId;
  days: LadderDay[];
}

export interface FeeLine {
  kind: string;
  label: string;
  talentId: string | null;
  amountCents: number;
}

export interface Booking {
  id: string;
  reference: string;
  state: "confirmed" | "invoiced" | "corrected";
  date: string;
  office: OfficeId;
  clientId: string;
  clientCompany: string;
  jobTitle: string;
  rateCard: { id: string; name: string; effectiveFrom: string };
  talent: Array<{ talentId: string; displayName: string; talentFeesCents: number; serviceFeeShareCents: number }>;
  lines: FeeLine[];
  talentFeesCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalCents: number;
  confirmedBy: string;
  confirmedAt: string;
  issuedBy: string | null;
  issuedAt: string | null;
}

export const LIVE: OptionState[] = ["placed", "challenged"];

export function isLive(option: OptionRecord): boolean {
  return LIVE.includes(option.state);
}

/** Focuses `target()` after the next render (once its element exists and is enabled). */
export function useFocusAfterRender(): (target: () => HTMLElement | null) => void {
  const [, setTick] = useState(0);
  const pending = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const element = pending.current?.();
    if (element) {
      pending.current = null;
      element.focus();
    }
  });
  return useCallback((target: () => HTMLElement | null) => {
    pending.current = target;
    setTick((tick) => tick + 1);
  }, []);
}

/** The current address, as kept drafts and "Sign in again" record it. */
export function here(): string {
  return location.pathname + location.search;
}

/**
 * For a refused call whose session is gone: keeps the open dialog's values and returns the copy to announce.
 * Null for every other refusal.
 */
export function endedSession(error: { error: string }, dialog: string, values: Record<string, string>): string | null {
  const copy = sessionCopy(error);
  if (copy && error.error !== "access_removed") keepDraft({ path: here(), dialog, values });
  return copy;
}

/** Downloads a file response under the server's Content-Disposition name. */
export async function download(path: string): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: `http_${response.status}` }))) as { error: string };
    return { ok: false, error: body.error };
  }
  const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "download";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { ok: true, filename };
}

/**
 * Today's office date by the server's clock (its Date header), so a page's calendar never depends on the
 * browser's clock. Null until the server answers.
 */
export function useOfficeToday(office: OfficeId): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    void fetch("/api/health", { credentials: "same-origin" }).then((response) => {
      const stamp = Date.parse(response.headers.get("date") ?? "");
      setNow(Number.isNaN(stamp) ? null : stamp);
    }, () => setNow(null));
  }, []);
  return now === null ? null : officeToday(office, now);
}
