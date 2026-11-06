import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.ts";
import { one, pool, type Db } from "./db.ts";
import { sendMail, type OutgoingMail } from "./smtp.ts";

export type MessageKind = "invitation" | "downgrade" | "revocation";

const RETRY_MS = 5000;
const CLAIM_SECONDS = 60;

/**
 * Invitation tokens are base64url HMAC-SHA256 values of a fresh 256-bit random seed under a key derived from the
 * deployment's secrets (never stored). The database keeps the token's SHA-256 for lookup and, while the invitation
 * waits for delivery, the seed, so any instance can rebuild the link for a queued invitation; the seed is erased once
 * the invitation is delivered, accepted or withdrawn. The token itself is never stored.
 */
const tokenKey = createHmac("sha256", config.s3.secretAccessKey).update(`scopewright invitation token\u0000${config.databaseUrl}`).digest();

interface InviteToken {
  token: string;
  seed: Buffer;
}

const inviteTokenFromSeed = (seed: Buffer): string => createHmac("sha256", tokenKey).update(seed).digest("base64url");

export function newInviteToken(): InviteToken {
  const seed = randomBytes(32);
  return { token: inviteTokenFromSeed(seed), seed };
}

/** Stores a queued message in the caller's transaction, before any delivery attempt. */
export async function queueMessage(db: Db, kind: MessageKind, shareId: string, diagramId: string, recipient: string): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO messages (id, kind, share_id, diagram_id, recipient, status) VALUES ($1, $2, $3, $4, $5, 'queued')", [id, kind, shareId, diagramId, recipient]);
  return id;
}

interface Claimed {
  id: string;
  kind: MessageKind;
  share_id: string;
  token_seed: Buffer | null;
  recipient: string;
  title: string;
  inviter: string;
  role: string;
  expires_at: Date | null;
}

const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function compose(m: Claimed): OutgoingMail {
  if (m.kind === "invitation") {
    const token = inviteTokenFromSeed(m.token_seed!);
    return {
      to: m.recipient,
      subject: "You have been invited to a diagram on Scopewright",
      body: [
        `${m.inviter} invited you to ${m.title} as ${m.role}.`,
        "",
        `Accept: ${config.publicUrl}/invite/${token}`,
        "",
        `This link expires at ${isoSeconds(m.expires_at!)} (UTC).`,
      ].join("\n"),
    };
  }
  return {
    to: m.recipient,
    subject: "Your access to a diagram on Scopewright changed",
    body: m.kind === "downgrade" ? `Your role on ${m.title} is now viewer.` : `You no longer have access to ${m.title}.`,
  };
}

/** Claims one queued message (optionally a given one) for this instance; another instance cannot claim it meanwhile. */
async function claim(messageId: string | null): Promise<Claimed | undefined> {
  return one<Claimed>(
    pool,
    `UPDATE messages m SET claimed_until = now() + make_interval(secs => $2)
       FROM shares s, diagrams d, users u
      WHERE m.id = (SELECT id FROM messages
                     WHERE status = 'queued' AND (claimed_until IS NULL OR claimed_until < now()) AND ($1::uuid IS NULL OR id = $1::uuid)
                     ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND s.id = m.share_id AND d.id = m.diagram_id AND u.id = d.owner_id
    RETURNING m.id, m.kind, m.share_id, s.token_seed, m.recipient, d.title, u.display_name AS inviter, s.role, s.expires_at`,
    [messageId, CLAIM_SECONDS],
  );
}

async function deliver(m: Claimed): Promise<boolean> {
  try {
    // A diagram deleted (or an invitation withdrawn) after the claim cancels the message; it is never sent.
    const still = await one<{ status: string }>(pool, "SELECT status FROM messages WHERE id = $1", [m.id]);
    if (still?.status !== "queued") return true;
    await sendMail(compose(m));
  } catch {
    await pool.query("UPDATE messages SET claimed_until = NULL WHERE id = $1 AND status = 'queued'", [m.id]);
    return false;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sent = await client.query("UPDATE messages SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'queued'", [m.id]);
    if (sent.rowCount && m.kind === "invitation") await client.query("UPDATE shares SET delivered = true, token_seed = NULL WHERE id = $1", [m.share_id]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
  }
  return true;
}

/** Tries one message at once, right after the transaction that queued it commits. */
export function deliverSoon(messageId: string): void {
  void claim(messageId).then((m) => (m ? deliver(m) : false)).catch(() => undefined);
}

async function drain(): Promise<void> {
  for (;;) {
    const m = await claim(null);
    if (!m || !(await deliver(m))) return;
  }
}

/** Every instance retries queued messages every few seconds. */
export function startMailWorker(): void {
  const tick = () => {
    drain().catch(() => undefined).finally(() => setTimeout(tick, RETRY_MS).unref());
  };
  setTimeout(tick, RETRY_MS).unref();
}
