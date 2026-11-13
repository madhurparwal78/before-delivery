import type { PaymentMethod } from "../../lib/types";

const KEY = "chauraha.checkout";

export type Tenure = 3 | 6 | 9 | 12;

/** What the shopper chose so far. Kept for the browser tab; a card number and a CVV are never part of it. */
export interface Choice {
  addressId: string | null;
  method: PaymentMethod | null;
  useBalance: boolean | null;
  emiTenure: Tenure | null;
  vpa: string;
  bankCode: string;
  savedCardId: string | null;
}

const EMPTY: Choice = { addressId: null, method: null, useBalance: null, emiTenure: null, vpa: "", bankCode: "", savedCardId: null };

export function readChoice(): Choice {
  try {
    return { ...EMPTY, ...(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}") as Partial<Choice>) };
  } catch {
    return EMPTY;
  }
}

export function writeChoice(patch: Partial<Choice>): Choice {
  const next = { ...readChoice(), ...patch };
  window.sessionStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearChoice(): void {
  window.sessionStorage.removeItem(KEY);
  Object.assign(cardDraft, { number: "", expiry: "", cvv: "", name: "", save: false });
}

/** A card typed on the payment step: held in memory only, so a reload clears it. */
export interface CardDraft {
  number: string;
  expiry: string;
  cvv: string;
  name: string;
  save: boolean;
}

export const cardDraft: CardDraft = { number: "", expiry: "", cvv: "", name: "", save: false };

/** The card part of the checkout body: a saved card with its CVV, or a new card. Null when nothing usable was entered. */
function cardBody(choice: Choice, draft: CardDraft): Record<string, unknown> | null {
  if (choice.savedCardId) return { saved_card_id: choice.savedCardId, cvv: draft.cvv };
  const [month, year] = draft.expiry.split("/").map((part) => Number(part.trim()));
  if (!draft.number || !month || !year) return null;
  return { number: draft.number.replace(/\D/g, ""), expiry_month: month, expiry_year: year < 100 ? 2000 + year : year, cvv: draft.cvv, name: draft.name, save: draft.save };
}

/** The `payment` object of the checkout body, or null when the chosen method lacks details held on this page. */
export function paymentBody(choice: Choice, draft: CardDraft, method: PaymentMethod | null, useBalance: boolean): Record<string, unknown> | null {
  const base = { method, use_balance: useBalance };
  const card = cardBody(choice, draft);
  switch (method) {
    case null:
    case "cod":
      return base;
    case "upi":
      return choice.vpa ? { ...base, upi: { vpa: choice.vpa } } : null;
    case "netbanking":
      return choice.bankCode ? { ...base, netbanking: { bank_code: choice.bankCode } } : null;
    case "card":
      return card ? { ...base, card } : null;
    case "emi":
      return card && choice.emiTenure ? { ...base, emi: { tenure_months: choice.emiTenure, card } } : null;
  }
}

/** A fresh Idempotency-Key: 32 letters and digits. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
