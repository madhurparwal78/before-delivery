import { loadVisiblePen, requireVerified } from "./access";
import { newId } from "./auth";
import { config } from "./config";
import { one, pool, rows, transaction } from "./db";
import { ApiError, MailUnavailable, StorageUnavailable } from "./errors";
import { announce, publishCounts } from "./events";
import { json, requireUser, type Context, type Reply } from "./http";
import { withIdempotency } from "./idempotency";
import { sendMail } from "./mail";
import { toPen } from "./pens";
import { appendVersion, findVersion } from "./versions";
import type { Version } from "../shared/types";

export async function forkPen(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const sourceId = ctx.params[0] as string;
  return withIdempotency(ctx, user, sourceId, async () => {
    const source = await loadVisiblePen(pool, sourceId, user);
    requireVerified(user);
    if (source.head === 0) throw new ApiError("nothing_to_fork");
    const head = (await findVersion(pool, source.id, source.head)) as Version;
    const forkId = newId();
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO pens (id, owner_id, title, visibility, tags, forked_from_pen, forked_from_version) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [forkId, user.id, source.title, source.visibility === "private" ? "private" : "unlisted", source.tags, source.id, head.number],
      );
      try {
        await appendVersion(client, { id: forkId, head: 0 }, { files: head.files, libraries: head.libraries }, null);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable", { message: "Storage is unreachable, so the fork was not made." });
        throw error;
      }
      if (source.visibility === "public" && source.owner_id !== user.id) {
        const owner = await one<{ email: string }>(client, "SELECT email FROM users WHERE id = $1", [source.owner_id]);
        await client.query("INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)", [
          owner?.email,
          `${user.handle} forked your pen "${source.title}"`,
          `${user.handle} forked "${source.title}" into a new pen.\n\nSee the fork: ${config.publicUrl}/pen/${forkId}\n`,
        ]);
      }
    });
    announce(publishCounts(source.id));
    announce(deliverOutbox());
    return json(201, await toPen(pool, await loadVisiblePen(pool, forkId, user), user));
  });
}

let delivering = false;
let requestedAgain = false;

async function deliverPending(): Promise<boolean> {
  const pending = await rows<{ id: string; recipient: string; subject: string; body: string }>(
    pool,
    "SELECT id, recipient, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id",
  );
  for (const message of pending) {
    try {
      await sendMail({ to: message.recipient, subject: message.subject, body: message.body });
    } catch (error) {
      if (error instanceof MailUnavailable) return false;
      throw error;
    }
    await pool.query("UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [message.id]);
  }
  return true;
}

/** Sends every unsent notice exactly once; a notice mail refuses stays queued for the next attempt. */
export async function deliverOutbox(): Promise<void> {
  if (delivering) {
    requestedAgain = true;
    return;
  }
  delivering = true;
  try {
    let delivered = true;
    do {
      requestedAgain = false;
      delivered = await deliverPending();
    } while (delivered && requestedAgain);
  } finally {
    delivering = false;
  }
}
