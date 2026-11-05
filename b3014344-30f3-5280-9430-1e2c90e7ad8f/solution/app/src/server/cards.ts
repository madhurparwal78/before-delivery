import { COPY } from "../shared/copy";
import { errors, HttpError, record } from "./http";
import { studioDate } from "./time";

// Card checks are simulated with the published test numbers; there is no live card processor.
// Only the last four digits are ever kept.

const APPROVING = "4242424242424242";
const DECLINING = "4000000000000002";

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

interface Card {
  last4: string;
}

/** Validates the card fields (422 under each field) and returns the card to charge. */
export function readCard(body: unknown, now: Date): Card {
  const card = record(record(body).card);
  const fields: Record<string, string> = {};
  const number = typeof card.number === "string" ? card.number.replace(/ /g, "") : "";
  if (!/^\d{12,19}$/.test(number) || !luhn(number)) fields.number = "Enter a valid card number.";
  else if (number !== APPROVING && number !== DECLINING) fields.number = "Use one of the published test card numbers.";
  const expiry = typeof card.expiry === "string" ? /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(card.expiry.trim()) : null;
  if (!expiry) fields.expiry = "Enter the expiry as MM/YY.";
  else {
    const [year, month] = studioDate(now).split("-").map(Number) as [number, number];
    const expiresYear = 2000 + Number(expiry[2]);
    if (expiresYear < year || (expiresYear === year && Number(expiry[1]) < month)) fields.expiry = "This card has expired.";
  }
  if (typeof card.cvc !== "string" || !/^\d{3}$/.test(card.cvc)) fields.cvc = "Enter the 3-digit CVC.";
  if (Object.keys(fields).length) throw errors.invalid(fields);
  return { last4: number.slice(-4) };
}

/** The card on file approves unless it is the published declining card. */
export function approves(last4: string | null): boolean {
  return last4 !== null && last4 !== DECLINING.slice(-4);
}

export function declined(): HttpError {
  return new HttpError(402, "card_declined", COPY.declined);
}
