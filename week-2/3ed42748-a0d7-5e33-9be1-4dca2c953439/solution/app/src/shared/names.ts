// Display-name checking, folding, normalising and counting. The server decides with it; the
// Postbox editor runs the same check before sending.

const NAME_MAX = 24;

const FOLDED = /[\p{White_Space}\p{Cc}\p{Zl}\p{Zp}\u200E\u200F\u202A-\u202E\u2066-\u2069]+/gu;
const LONE_SURROGATE = /\p{Cs}/u;

type NameCheck = { ok: true; name: string } | { ok: false; reason: "required" | "too_long" | "invalid" };

export function checkDisplayName(value: unknown): NameCheck {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return { ok: false, reason: "invalid" };
  const name = value.replace(FOLDED, " ").trim().normalize("NFC");
  const length = [...name].length;
  if (length === 0) return { ok: false, reason: "required" };
  if (length > NAME_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, name };
}
