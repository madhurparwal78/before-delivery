// IBANs: the ISO 13616 MOD-97 check and the stored form.

export function storedIban(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

export function ibanIsValid(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = [...`${iban.slice(4)}${iban.slice(0, 4)}`].map((character) => parseInt(character, 36)).join("");
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
