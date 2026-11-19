import { randomBytes } from "node:crypto";
import { config } from "./config";
import { serverNow } from "./clock";
import { sha256Hex } from "./digest";
import type { Queryable } from "./db";
import { MailError, sendMail } from "./mail";

export const RESEND_WINDOW_SECONDS = 60;

/**
 * Mails a fresh verification link. Only a message the mail server accepted replaces the old token and starts the resend
 * window; returns whether it did.
 */
export async function sendVerificationEmail(db: Queryable, account: { id: string; email: string }): Promise<boolean> {
  const token = randomBytes(32).toString("base64url");
  const sentAt = serverNow();
  const expiresAt = new Date(sentAt.getTime() + config.verifyTtlSeconds * 1000);
  try {
    await sendMail({
      to: account.email,
      subject: "Verify your Quarkyard email",
      body: [
        "Welcome to Quarkyard. Open this link to verify your email:",
        "",
        `${config.publicUrl}/verify?token=${token}`,
        "",
        `This link expires at ${expiresAt.toISOString()}.`,
        "",
      ].join("\n"),
    });
  } catch (error) {
    if (error instanceof MailError) return false;
    throw error;
  }
  await db.query(
    `WITH cleared AS (DELETE FROM verification_tokens WHERE account_id = $1),
          stamped AS (UPDATE accounts SET verification_sent_at = $4 WHERE id = $1)
     INSERT INTO verification_tokens (token_hash, account_id, expires_at) VALUES ($2, $1, $3)`,
    [account.id, sha256Hex(token), expiresAt, sentAt],
  );
  return true;
}
