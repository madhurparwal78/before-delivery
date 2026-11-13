// Numerals: how stored whole millimetres and whole cents are written, on screen and in mail.

/** Metres with two decimals: the size is rounded half up to the centimetre, then the sign applies. */
export function metres(mm: number): string {
  const cm = Math.floor((Math.abs(mm) + 5) / 10);
  return `${mm < 0 ? "-" : ""}${Math.floor(cm / 100)}.${String(cm % 100).padStart(2, "0")}`;
}

/** A margin always carries a sign taken from its stored value: 0 mm or more is `+`. */
export function signedMetres(mm: number): string {
  const size = metres(Math.abs(mm));
  return `${mm >= 0 ? "+" : "-"}${size}`;
}

/** Draught in metres with three decimals, exact from the stored millimetres. */
export function draughtMetres(mm: number): string {
  return `${Math.floor(mm / 1000)}.${String(mm % 1000).padStart(3, "0")}`;
}

/** Feet and whole-quarter inches from millimetres, rounded half up to the nearest quarter inch. */
export function feetAndQuarters(mm: number): { feet: number; inches: number } {
  const quarters = Math.floor((Math.abs(mm) * 80 + 254) / 508);
  return { feet: Math.floor(quarters / 48), inches: (quarters % 48) / 4 };
}

/** `36 ft 9 in`, `24 ft 11.25 in`, with a leading minus when negative. */
export function feetText(mm: number): string {
  const { feet, inches } = feetAndQuarters(mm);
  return `${mm < 0 ? "-" : ""}${feet} ft ${inches} in`;
}

/** A clearance cell: `1.14 m / 3 ft 9 in`. */
export function clearanceCell(mm: number): string {
  return `${metres(mm)} m / ${feetText(mm)}`;
}

/** Money without its dollar sign: `2,912.50`. */
export function money(cents: number): string {
  const size = Math.abs(cents);
  const dollars = Math.floor(size / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}${dollars}.${String(size % 100).padStart(2, "0")}`;
}

/** Dollars with up to two decimals, as typed into a tariff field, to whole cents; null when not money. */
export function centsFromDollars(text: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Whole cents as a dollar field value: `42.50`. */
export function dollarsField(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
