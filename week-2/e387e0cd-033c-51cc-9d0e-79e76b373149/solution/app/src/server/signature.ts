// The message signature check (adapted from kit/modules/webhooks): HMAC-SHA256 over the timestamp, a dot and
// the raw body bytes, keyed with the sender's signing value, within 300 seconds either way.
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_WINDOW_SECONDS = 300;

export function verifySignature(rawBody: Buffer, header: string | undefined, signingValue: string, nowSeconds: number): boolean {
  if (!header) return false;
  const pairs = header.split(",").map((part) => part.trim().split("="));
  const t = pairs.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = pairs.filter(([key, value]) => key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "")).map(([, v]) => v);
  if (!/^\d{1,12}$/.test(t) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - parseInt(t, 10)) > SIGNATURE_WINDOW_SECONDS) return false;
  const expected = createHmac("sha256", Buffer.from(signingValue, "utf8")).update(`${t}.`).update(rawBody).digest();
  return signatures.some((s) => timingSafeEqual(Buffer.from(s, "hex"), expected));
}
