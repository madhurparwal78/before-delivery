// Email addresses are compared case-insensitively (brief: Accounts).

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value);
}
