export type CardNetwork = "Visa" | "Mastercard" | "RuPay";

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** The network from the leading digits, or null when the number is not one we accept. */
function networkOf(digits: string): CardNetwork | null {
  const lead4 = Number(digits.slice(0, 4));
  const lead2 = Number(digits.slice(0, 2));
  if (digits.startsWith("4")) return "Visa";
  if ((lead2 >= 51 && lead2 <= 55) || (lead4 >= 2221 && lead4 <= 2720)) return "Mastercard";
  if (["60", "65", "81", "82"].includes(digits.slice(0, 2)) || digits.startsWith("508")) return "RuPay";
  return null;
}

type CardNumberVerdict = { ok: true; network: CardNetwork; last4: string } | { ok: false; reason: "number" | "network" };

/** 12 to 19 digits that pass the Luhn check, on a known network. */
export function checkCardNumber(raw: string): CardNumberVerdict {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(digits) || !luhnValid(digits)) return { ok: false, reason: "number" };
  const network = networkOf(digits);
  return network ? { ok: true, network, last4: digits.slice(-4) } : { ok: false, reason: "network" };
}

export function expiryValid(month: number, year: number, todayIso: string): boolean {
  const [thisYear, thisMonth] = todayIso.split("-").map(Number) as [number, number];
  return month >= 1 && month <= 12 && year * 12 + month >= thisYear * 12 + thisMonth;
}
