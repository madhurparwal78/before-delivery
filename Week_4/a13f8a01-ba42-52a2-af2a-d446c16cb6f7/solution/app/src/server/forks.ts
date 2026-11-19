import type { User } from "../shared/types.js";
import { requireVisible } from "./access.js";
import type { Reply } from "./context.js";
import type { Tx } from "./db.js";
import { forkNoticeMessage } from "./mail.js";
import { queueNotice } from "./outbox.js";
import { findPen, fullPen, insertPen, type PenRow } from "./pens.js";
import { readVersion, saveVersion } from "./versions.js";

export async function forkPen(tx: Tx, source: PenRow, forker: User): Promise<Reply> {
  const visibility = source.visibility === "private" ? "private" : "unlisted";
  const forkId = await insertPen(tx, {
    ownerId: forker.id,
    title: source.title,
    visibility,
    tags: source.tags,
    forkOf: { pen: source.id, version: source.head },
  });
  const version = await saveVersion(tx, {
    penId: forkId,
    base: 0,
    content: () => readVersion(source.id, source.head),
  });
  if (source.visibility === "public" && source.ownerId !== forker.id) {
    await queueNotice(tx, forkNoticeMessage(forker.handle, source.title, source.ownerEmail, forkId));
  }
  const row = requireVisible(await findPen(forkId, tx), forker);
  return { status: 201, body: await fullPen(row, forker, tx, version) };
}
