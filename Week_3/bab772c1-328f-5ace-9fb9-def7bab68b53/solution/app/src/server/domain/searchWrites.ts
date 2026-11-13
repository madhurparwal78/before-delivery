/** Confirmed search writes, pending search writes and the catch-up that drains them. */

import { PASS_LOCK, withAdvisoryLock } from "../db/locks.js";
import { pool, withTransaction, type Queryable } from "../db/pool.js";
import {
  deletePassDocuments,
  indexDocuments,
  type TranscriptDocument,
} from "../services/search.js";

type PendingWrite = {
  op: "index_line" | "index_event" | "delete_pass";
  doc_id: string | null;
  ref_id: string | null;
  mission_id: string;
  pass_id: string | null;
};

export function lineDocument(
  missionId: string,
  passId: string,
  line: { id: string; met: number; speaker: string; text: string },
): TranscriptDocument {
  return {
    id: `line-${line.id}`,
    mission_id: missionId,
    pass_id: passId,
    kind: "line",
    met: line.met,
    speaker: line.speaker,
    text: line.text,
  };
}

export function eventDocument(
  missionId: string,
  passId: string,
  event: { id: string; met: number; title: string },
): TranscriptDocument {
  return {
    id: `event-${event.id}`,
    mission_id: missionId,
    pass_id: passId,
    kind: "event",
    met: event.met,
    speaker: null,
    text: event.title,
  };
}

/** Indexes documents; the pending writes it returns must be written in the change's transaction. */
export async function indexOrPend(
  missionId: string,
  passId: string,
  documents: readonly TranscriptDocument[],
  references: readonly { op: PendingWrite["op"]; docId: string; refId: string }[],
): Promise<PendingWrite[]> {
  if (documents.length === 0) {
    return [];
  }
  let confirmed = false;
  try {
    confirmed = await indexDocuments([...documents]);
  } catch {
    confirmed = false;
  }
  if (confirmed) {
    return [];
  }
  return references.map((reference) => ({
    op: reference.op,
    doc_id: reference.docId,
    ref_id: reference.refId,
    mission_id: missionId,
    pass_id: passId,
  }));
}

export async function writePendingWrites(
  tx: Queryable,
  writes: readonly PendingWrite[],
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  await tx.query(
    `insert into pending_search_writes (op, doc_id, ref_id, mission_id, pass_id, created_ms)
     select op, doc_id, ref_id, mission_id, pass_id, $6
     from unnest($1::text[], $2::text[], $3::uuid[], $4::uuid[], $5::uuid[])
       as t(op, doc_id, ref_id, mission_id, pass_id)`,
    [
      writes.map((write) => write.op),
      writes.map((write) => write.doc_id),
      writes.map((write) => write.ref_id),
      writes.map((write) => write.mission_id),
      writes.map((write) => write.pass_id),
      Date.now(),
    ],
  );
}

type PendingRow = PendingWrite & { id: number };

let catchUpRunning = false;

/** Retries pending writes; it never indexes a line or event that no longer exists. */
export async function runSearchCatchUp(): Promise<void> {
  if (catchUpRunning) {
    return;
  }
  catchUpRunning = true;
  try {
    const pending = await pool.query<PendingRow>(
      `select id, op, doc_id, ref_id, mission_id, pass_id from pending_search_writes
       order by id limit 500`,
    );
    for (const row of pending.rows) {
      const done = row.pass_id
        ? await withAdvisoryLock(PASS_LOCK, row.pass_id, () => drain(row))
        : await drain(row);
      if (done) {
        await pool.query("delete from pending_search_writes where id = $1", [row.id]);
      }
    }
  } catch {
    /* the next catch-up tries again */
  } finally {
    catchUpRunning = false;
  }
}

async function drain(row: PendingRow): Promise<boolean> {
  try {
    if (row.op === "delete_pass" && row.pass_id) {
      return await deletePassDocuments(row.pass_id);
    }
    if (row.op === "index_line" && row.ref_id) {
      const line = await pool.query<{
        id: string;
        met: number;
        speaker: string;
        text: string;
        pass_id: string;
        mission_id: string;
      }>(
        `select l.id, l.met, l.speaker, l.text, l.pass_id, l.mission_id
         from transcript_lines l join passes p on p.id = l.pass_id
         where l.id = $1 and p.state <> 'deleted'`,
        [row.ref_id],
      );
      const found = line.rows[0];
      if (!found) {
        return true;
      }
      return await indexDocuments([lineDocument(found.mission_id, found.pass_id, found)]);
    }
    if (row.op === "index_event" && row.ref_id) {
      const event = await pool.query<{
        id: string;
        met: number;
        title: string;
        pass_id: string;
        mission_id: string;
      }>(
        `select e.id, e.met, e.title, e.pass_id, e.mission_id
         from events e join passes p on p.id = e.pass_id
         where e.id = $1 and p.state <> 'deleted'`,
        [row.ref_id],
      );
      const found = event.rows[0];
      if (!found) {
        return true;
      }
      return await indexDocuments([eventDocument(found.mission_id, found.pass_id, found)]);
    }
    return true;
  } catch {
    return false;
  }
}

/** Records index writes that restore a pass whose documents a refused deletion may have dropped. */
export async function pendRestoreOfPass(missionId: string, passId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const lines = await tx.query<{ id: string }>(
      "select id from transcript_lines where pass_id = $1",
      [passId],
    );
    const events = await tx.query<{ id: string }>("select id from events where pass_id = $1", [
      passId,
    ]);
    const writes: PendingWrite[] = [
      ...lines.rows.map((line) => ({
        op: "index_line" as const,
        doc_id: `line-${line.id}`,
        ref_id: line.id,
        mission_id: missionId,
        pass_id: passId,
      })),
      ...events.rows.map((event) => ({
        op: "index_event" as const,
        doc_id: `event-${event.id}`,
        ref_id: event.id,
        mission_id: missionId,
        pass_id: passId,
      })),
    ];
    await writePendingWrites(tx, writes);
  });
}
