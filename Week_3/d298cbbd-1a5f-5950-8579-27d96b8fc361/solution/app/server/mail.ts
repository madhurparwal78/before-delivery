import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "./db";
import { pool, transaction } from "./db";
import { config } from "./config";
import { sendMail } from "./smtp";

type LinkPurpose = "verify" | "reset";

const MAIL = {
  verify: { subject: "Verify your Strikeproof account", label: "Verify", path: "verify", intro: "Welcome to Strikeproof. Open this link to verify your email address:" },
  reset: { subject: "Reset your Strikeproof password", label: "Reset", path: "reset", intro: "Open this link to choose a new Strikeproof password:" },
} as const;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Stores the message and its single-use link; delivery is attempted separately so a mail outage never loses it. */
export async function queueLinkMail(db: Queryable, typistId: string, email: string, purpose: LinkPurpose): Promise<number> {
  const token = randomBytes(32).toString("base64url");
  const ttl = purpose === "verify" ? config.verifyTtlSeconds : config.resetTtlSeconds;
  await db.query(
    "INSERT INTO link_tokens (token_hash, typist_id, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))",
    [hashToken(token), typistId, purpose, ttl],
  );
  const mail = MAIL[purpose];
  const body = `${mail.intro}\n\n${mail.label}: ${config.appPublicUrl}/${mail.path}/${token}\n`;
  const { rows } = await db.query<{ id: string }>("INSERT INTO pending_mail (recipient, subject, body) VALUES ($1, $2, $3) RETURNING id", [email, mail.subject, body]);
  return Number(rows[0]!.id);
}

/** Delivers one pending message exactly once: the row stays locked until the server accepted it. Returns whether it was sent. */
export async function deliver(id: number): Promise<boolean> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ recipient: string; subject: string; body: string }>(
      "SELECT recipient, subject, body FROM pending_mail WHERE id = $1 AND sent_at IS NULL FOR UPDATE SKIP LOCKED",
      [id],
    );
    const message = rows[0];
    if (!message) return false;
    try {
      await sendMail(message.recipient, message.subject, message.body);
    } catch {
      return false;
    }
    await client.query("UPDATE pending_mail SET sent_at = now() WHERE id = $1", [id]);
    return true;
  });
}

/** Retries every undelivered message each MAIL_RETRY_SECONDS until the mail server takes it. */
export function startMailRetries(): void {
  setInterval(() => {
    void pool
      .query<{ id: string }>("SELECT id FROM pending_mail WHERE sent_at IS NULL AND created_at < now() - make_interval(secs => $1) ORDER BY id", [config.mailRetrySeconds / 2])
      .then(async ({ rows }) => {
        for (const row of rows) await deliver(Number(row.id));
      })
      .catch(() => undefined);
  }, config.mailRetrySeconds * 1000).unref();
}
