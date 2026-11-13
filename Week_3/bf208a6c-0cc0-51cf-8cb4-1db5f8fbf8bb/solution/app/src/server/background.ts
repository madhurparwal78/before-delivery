import { pool, rows } from "./db";
import { writeBoard } from "./events";
import { ApiError } from "./http";
import * as mail from "./services/mail";
import * as push from "./services/push";
import * as storage from "./services/storage";
import { report } from "./services/status";

const RETRY_MS = 10_000;

/** Sends every held post's push that ntfy has not accepted yet; each is accepted at most once. */
let flushing = false;
let flushAgain = false;

async function flushPushes(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const pending = await rows<{ id: string; board_id: string; title: string; board_title: string }>(
        pool,
        `SELECT p.id, p.board_id, p.title, b.title AS board_title FROM posts p JOIN boards b ON b.id = p.board_id
         WHERE p.state = 'awaiting_approval' AND p.push = 'pending' ORDER BY p.seq`,
      );
      for (const post of pending) {
        if (!(await push.publish(`pinsheet-approvals-${post.board_id}`, `Post waiting on ${post.board_title}`, post.title))) break;
        await writeBoard(post.board_id, async ({ db, emit }) => {
          await db.query(`UPDATE posts SET push = 'sent' WHERE id = $1`, [post.id]);
          await emit({ type: "push_sent", post_id: post.id }, { scope: "staff" });
        }).catch((error: unknown) => {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        });
      }
    } while (flushAgain);
  } finally {
    flushing = false;
  }
}

/** Removes the objects of deleted posts and boards; what storage refuses stays queued for the next round. */
let removing = false;

async function removeObjects(): Promise<void> {
  if (removing) return;
  removing = true;
  try {
    for (const { prefix } of await rows<{ prefix: string }>(pool, `SELECT prefix FROM storage_removals`)) {
      try {
        await storage.deletePrefix(prefix);
      } catch {
        return;
      }
      await pool.query(`DELETE FROM storage_removals WHERE prefix = $1`, [prefix]);
    }
  } finally {
    removing = false;
  }
}

async function attempt(service: "storage" | "mail" | "push", ping: () => Promise<void>): Promise<void> {
  try {
    await ping();
    report(service, true);
  } catch {
    report(service, false);
  }
}

export const checkServices = (): Promise<unknown> =>
  Promise.all([attempt("storage", storage.ping), attempt("mail", mail.ping), attempt("push", push.ping)]);

const quietly = (work: () => Promise<unknown>): void => {
  work().catch((error: unknown) => console.error("background work failed:", error instanceof Error ? error.message : error));
};

/** Starts a round of sending pending pushes, without waiting for it. */
export const kickPushes = (): void => quietly(flushPushes);

/** Starts a round of removing objects of deleted posts and boards, without waiting for it. */
export const kickRemoval = (): void => quietly(removeObjects);

export function startLoops(): void {
  setInterval(() => quietly(checkServices), RETRY_MS);
  setInterval(kickPushes, RETRY_MS);
  setInterval(kickRemoval, RETRY_MS);
}
