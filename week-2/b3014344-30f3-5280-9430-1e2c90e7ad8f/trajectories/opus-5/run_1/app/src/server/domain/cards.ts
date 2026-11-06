import { type FieldErrors } from "../errors.js";
import { studioDate } from "../time.js";

const APPROVING_CARD = "4242424242424242";
const DECLINING_CARD = "4000000000000002";

export interface CardInput {
  number?: unknown;
  expiry?: unknown;
  cvc?: unknown;
}

export interface CheckedCard {
  last4: string;
  approves: boolean;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The one place a simulated card is judged. */
export function checkCard(card: CardInput, now: Date): { card: CheckedCard | null; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const rawNumber = typeof card.number === "string" ? card.number.replace(/\s+/g, "") : "";
  const expiry = typeof card.expiry === "string" ? card.expiry.trim() : "";
  const cvc = typeof card.cvc === "string" ? card.cvc.trim() : "";

  if (rawNumber.length === 0) {
    fields["Card number"] = "Enter the card number.";
  } else if (!/^\d{12,19}$/.test(rawNumber)) {
    fields["Card number"] = "Enter the card number as digits only.";
  } else if (rawNumber !== APPROVING_CARD && rawNumber !== DECLINING_CARD && !luhnValid(rawNumber)) {
    fields["Card number"] = "That card number is not valid.";
  } else if (rawNumber !== APPROVING_CARD && rawNumber !== DECLINING_CARD) {
    fields["Card number"] = "Use one of the published test cards.";
  }

  const expiryMatch = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!expiryMatch) {
    fields["Expiry (MM/YY)"] = "Enter the expiry as MM/YY.";
  } else {
    const month = Number(expiryMatch[1]);
    const year = 2000 + Number(expiryMatch[2]);
    const today = studioDate(now);
    const currentYear = Number(today.slice(0, 4));
    const currentMonth = Number(today.slice(5, 7));
    if (month < 1 || month > 12) {
      fields["Expiry (MM/YY)"] = "Enter the expiry as MM/YY.";
    } else if (year < currentYear || (year === currentYear && month < currentMonth)) {
      fields["Expiry (MM/YY)"] = "That card has expired.";
    }
  }

  if (!/^\d{3}$/.test(cvc)) fields.CVC = "Enter the three-digit CVC.";

  if (Object.keys(fields).length > 0) return { card: null, fields };
  return { card: { last4: rawNumber.slice(-4), approves: rawNumber === APPROVING_CARD }, fields };
}

export function cardApproves(last4: string | null): boolean {
  return last4 === APPROVING_CARD.slice(-4);
}
