// The unsent booking draft, kept for this browser tab only and keyed by the booking page's path and query.
import type { BerthPreference, Gender } from "../../shared/api";

export interface DraftPassenger {
  name: string;
  age: string;
  gender: Gender | "";
  preference: BerthPreference;
  /** The berth on the coach plan that set the preference, if one did. */
  preferredBerth: { coach: string; berth: number } | null;
}

interface Draft {
  passengers: DraftPassenger[];
  keepInOneCoach: boolean;
  lowerBerthOnly: boolean;
  phone: string;
}

const PREFIX = "pakka:draft:";

export function loadDraft(path: string): Draft | null {
  const raw = sessionStorage.getItem(PREFIX + path);
  return raw ? (JSON.parse(raw) as Draft) : null;
}

export function saveDraft(path: string, draft: Draft): void {
  sessionStorage.setItem(PREFIX + path, JSON.stringify(draft));
}

export function clearDraft(path: string): void {
  sessionStorage.removeItem(PREFIX + path);
}

export function clearDrafts(): void {
  for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
}
