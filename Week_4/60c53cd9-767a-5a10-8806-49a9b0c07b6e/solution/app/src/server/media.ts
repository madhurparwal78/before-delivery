/** Short-lived signed `/media/<token>` links. The browser never sees storage credentials or object URLs. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { AppClock } from "./clock.js";

interface MediaClaim {
  /** Object key in the bucket. */
  readonly k: string;
  /** Unit code the object belongs to, or null for tower assets. */
  readonly u: string | null;
  /** Expiry as epoch milliseconds on the app clock. */
  readonly e: number;
}

const b64 = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

export class MediaSigner {
  private readonly secret: Buffer;

  constructor(
    config: Config,
    private readonly clock: AppClock,
  ) {
    this.secret = createHmac("sha256", config.s3.secretAccessKey).update("highwater-media-links").digest();
    this.lifetimeSeconds = config.mediaUrlSeconds;
  }

  private readonly lifetimeSeconds: number;

  private signature(payload: string): Buffer {
    return createHmac("sha256", this.secret).update(payload).digest();
  }

  /** A path of the form `/media/<token>` for an object key. */
  link(key: string, unitCode: string | null): string {
    const claim: MediaClaim = { k: key, u: unitCode, e: this.clock.now().getTime() + this.lifetimeSeconds * 1000 };
    const payload = b64(JSON.stringify(claim));
    return `/media/${payload}.${b64(this.signature(payload))}`;
  }

  /** The claim inside a token that is genuine and not yet expired, otherwise null. */
  verify(token: string): MediaClaim | null {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = this.signature(payload);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MediaClaim;
      return claim.e > this.clock.now().getTime() ? claim : null;
    } catch {
      return null;
    }
  }
}
