// Versions and restore (Business rules · Versions and restore). A version exists only if its snapshot
// was stored: every snapshot put happens inside the database transaction, and when anything after it
// fails the stored objects are deleted again before the error answers.
import { randomUUID } from "node:crypto";
import { type WorkbookContent } from "../shared/engine.js";
import { type Member } from "./auth.js";
import { type Tx } from "./db.js";
import { type Storage } from "./services/storage.js";
import { appendOps, recordHead } from "./sync.js";
import { type DerivedWorkbook, type WorkbookRow } from "./workbook.js";

type VersionKind = "saved" | "restore" | "before_restore";

export interface VersionRow {
  id: string;
  number: number;
  label: string;
  kind: VersionKind;
  seq: number;
  created_at: Date;
  created_by_id: string;
  created_by_name: string;
}

export function versionOut(v: VersionRow): Record<string, unknown> {
  return {
    id: v.id,
    number: v.number,
    label: v.label,
    kind: v.kind,
    seq: v.seq,
    createdAt: v.created_at.toISOString(),
    createdBy: { id: v.created_by_id, name: v.created_by_name },
  };
}

function snapshotKey(row: WorkbookRow, number: number): string {
  return `stations/${row.station_id}/workbooks/${row.id}/versions/${number}.json`;
}

/** Tracks what a multi-step write has put into storage, so a failure can take it back out. */
export class StoredObjects {
  private keys: string[] = [];

  constructor(private readonly storage: Storage) {}

  async put(key: string, body: Buffer, type: string): Promise<void> {
    await this.storage.put(key, body, type);
    this.keys.push(key);
  }

  /** Undo: removes every object this write stored. */
  async undo(): Promise<void> {
    await Promise.all(this.keys.map((k) => this.storage.remove(k).catch(() => undefined)));
    this.keys = [];
  }
}

async function nextNumber(t: Tx, workbookId: string): Promise<number> {
  const r = await t.query<{ n: number }>("SELECT coalesce(max(number), 0) + 1 AS n FROM versions WHERE workbook_id = $1", [workbookId]);
  return r.rows[0].n;
}

/** Stores a snapshot of `content` and records it as the next version number. */
export async function recordVersion(
  t: Tx,
  objects: StoredObjects,
  row: WorkbookRow,
  member: Member,
  version: { label: string; kind: VersionKind; seq: number; content: WorkbookContent },
): Promise<VersionRow> {
  const number = await nextNumber(t, row.id);
  const snapshot = { workbookId: row.id, number, label: version.label, kind: version.kind, seq: version.seq, content: version.content };
  await objects.put(snapshotKey(row, number), Buffer.from(JSON.stringify(snapshot), "utf8"), "application/json");
  const r = await t.query<VersionRow>(
    `INSERT INTO versions (id, workbook_id, number, label, kind, seq, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [randomUUID(), row.id, number, version.label, version.kind, version.seq, member.id, member.name],
  );
  return r.rows[0];
}

/**
 * Restores version `target` as one action: saves the current state as `before_restore`, appends one
 * restore op that makes the workbook equal to the snapshot, and records the `restore` version.
 */
export async function restoreVersion(
  t: Tx,
  storage: Storage,
  objects: StoredObjects,
  row: WorkbookRow,
  derived: DerivedWorkbook,
  member: Member,
  target: VersionRow,
): Promise<{ restored: VersionRow; undo: VersionRow; headSeq: number }> {
  const snapshot = JSON.parse((await storage.get(snapshotKey(row, target.number))).toString("utf8")) as { content: WorkbookContent };
  const undo = await recordVersion(t, objects, row, member, {
    label: `Before restoring version ${target.number}`,
    kind: "before_restore",
    seq: derived.headSeq,
    content: derived.engine.content(),
  });
  const seq = derived.headSeq + 1;
  const op = { type: "restore" as const, versionNumber: target.number, content: snapshot.content };
  derived.apply(op, seq, { id: member.id, name: member.name });
  await appendOps(t, row.id, [{ seq, op }], { id: member.id, name: member.name });
  await recordHead(t, row.id, derived);
  const restored = await recordVersion(t, objects, row, member, {
    label: `Restored version ${target.number}`,
    kind: "restore",
    seq,
    content: snapshot.content,
  });
  return { restored, undo, headSeq: seq };
}
