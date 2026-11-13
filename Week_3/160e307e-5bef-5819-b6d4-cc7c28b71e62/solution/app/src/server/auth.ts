import { config } from "./config";
import { query, transaction } from "./db";
import { ApiError } from "./errors";
import { sendMail } from "./mail";
import type { Player } from "./players";
import { hashToken, newToken } from "./util";

/** Magic sign-in links: the email is linked only when the link is opened, never when it is sent. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendLink(player: Player, email: unknown): Promise<void> {
  if (typeof email !== "string" || !EMAIL.test(email.trim()) || email.length > 254) throw new ApiError(422, "EMAIL_INVALID");
  const address = email.trim();
  if (player.email !== null && player.email.toLowerCase() !== address.toLowerCase()) throw new ApiError(409, "ALREADY_LINKED");
  const token = newToken();
  const expires = new Date(Date.now() + config.magicLinkSeconds * 1000);
  await query("INSERT INTO link_tokens (token_hash, email, player_id, expires_at) VALUES ($1, $2, $3, $4)", [
    hashToken(token),
    address,
    player.id,
    expires,
  ]);
  const sent = await sendMail(
    address,
    "Your Due Coin sign-in link",
    `Open this link to sign in: ${config.publicUrl}/auth/link/${token}\n`,
  );
  if (!sent) {
    await query("DELETE FROM link_tokens WHERE token_hash = $1", [hashToken(token)]);
    throw new ApiError(503, "MAIL_UNAVAILABLE");
  }
}

type LinkResult = { kind: "linked" | "signed-in"; sessionToken: string | null } | null;

/** Consumes a link once. Links the email to the browser's player, or signs the browser in as the email's owner. */
export async function openLink(token: string, current: Player | null): Promise<LinkResult> {
  return transaction(async (db) => {
    const used = await db.query(
      "UPDATE link_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email, player_id",
      [hashToken(token)],
    );
    const link = used.rows[0] as { email: string; player_id: string } | undefined;
    if (!link) return null;
    const owner = await db.query("SELECT id FROM players WHERE email_key = $1", [link.email.toLowerCase()]);
    const ownerId = owner.rows[0]?.id as string | undefined;
    const target = current?.id ?? link.player_id;
    if (ownerId && ownerId !== target) {
      const opened = await openSessionIn(db, ownerId);
      return { kind: "signed-in" as const, sessionToken: opened };
    }
    await db.query("UPDATE players SET email = $2, email_key = $3 WHERE id = $1", [target, link.email, link.email.toLowerCase()]);
    return { kind: "linked" as const, sessionToken: current ? null : await openSessionIn(db, target) };
  });
}

async function openSessionIn(db: { query: (sql: string, params: unknown[]) => Promise<unknown> }, playerId: string): Promise<string> {
  const token = newToken();
  await db.query("INSERT INTO sessions (token_hash, player_id) VALUES ($1, $2)", [hashToken(token), playerId]);
  return token;
}

