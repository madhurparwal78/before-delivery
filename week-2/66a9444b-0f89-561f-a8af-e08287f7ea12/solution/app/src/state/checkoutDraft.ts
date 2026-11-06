// The checkout draft (pass counts, rate, voucher, attendee names) lives in session storage so a reload reopens
// the same step with the same choices. Each distinct draft gets one idempotency key, reused for every retry.
export type Draft = {
  full: number;
  days: Record<string, number>;
  rate: "full" | "reduced";
  voucher: string;
  voucherApplied: { code: string; balance_cents: number } | null;
  names: string[];
  key: string | null;
  keyFor: string | null;
};

const KEY = "kf-checkout-draft";
const empty: Draft = { full: 0, days: {}, rate: "full", voucher: "", voucherApplied: null, names: [], key: null, keyFor: null };

export function loadDraft(): Draft {
  try {
    return { ...empty, ...(JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Partial<Draft>) };
  } catch {
    return { ...empty };
  }
}

export function saveDraft(draft: Draft): void {
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  sessionStorage.removeItem(KEY);
}

/** The idempotency key for this exact request body: kept while the body is unchanged, new when it changes. */
export function keyFor(draft: Draft, body: string): { draft: Draft; key: string } {
  if (draft.key && draft.keyFor === body) return { draft, key: draft.key };
  const key = `kf-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { draft: { ...draft, key, keyFor: body }, key };
}
