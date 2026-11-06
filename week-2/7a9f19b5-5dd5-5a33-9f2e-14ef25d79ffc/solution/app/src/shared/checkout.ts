// Checkout field rules, used by the checkout form and the authorise endpoint alike.

/** The published decline test card (spaces removed). */
export const DECLINE_TEST_CARD = "4000000000000002";

export function cardDigits(number: string): string {
  return number.replace(/\s+/g, "");
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** 16 digits once spaces are removed, passing the Luhn check. */
export function cardNumberValid(number: string): boolean {
  const digits = cardDigits(number);
  return /^\d{16}$/.test(digits) && luhn(digits);
}

type ExpiryCheck = "valid" | "invalid" | "past";

/** `MM/YY`, not before the current month of `today` (YYYY-MM-DD). */
export function checkExpiry(expiry: string, today: string): ExpiryCheck {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return "invalid";
  return `20${match[2]}-${match[1]}` < today.slice(0, 7) ? "past" : "valid";
}

export function cvcValid(cvc: string): boolean {
  return /^\d{3}$/.test(cvc.trim());
}

export function postcodeValid(postcode: string): boolean {
  return /^\d{4}$/.test(postcode.trim());
}
