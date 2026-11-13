import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

/** Gateway callback signatures: `t=<unix seconds>,v1=<hex HMAC-SHA256 over "<t>.<raw body>">`. */

const TOLERANCE_SECONDS = 300;

export const verifyCallback = (raw: Buffer, header: string | undefined): boolean => {
  if (!header) return false;
  const fields = new Map(header.split(",").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [name ?? "", rest.join("=")] as const;
  }));
  const stamp = Number(fields.get("t"));
  const given = fields.get("v1") ?? "";
  if (!Number.isInteger(stamp) || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Math.abs(Date.now() / 1000 - stamp) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", config.gatewayCallbackSecret).update(`${stamp}.`).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
};
