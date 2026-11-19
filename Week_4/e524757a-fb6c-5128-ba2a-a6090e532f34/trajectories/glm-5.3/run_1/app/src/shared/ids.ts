// Literal-text helpers: notes, captions and postcard lines are plain text.

export function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export function makeConfirmCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function newId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${s}`;
}

export function makeSafariCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function handleFromName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "explorer";
  return base.slice(0, 24);
}

export function makeSessionToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 48; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function thousandsSep(n: number): string {
  return n.toLocaleString("en-US");
}
