import type { Change, ChangeKind, Optics } from "../../shared/types";
import { uuid } from "../lib/ids";
import { accountId, app, type EntryMeta, type JournalEntry } from "./model";
import { broadcast, readJournal, writeJournal } from "./persist";

function makeChange(kind: ChangeKind, body: Record<string, unknown>): Change {
  return { client_op_id: uuid(), kind, body };
}

export const nowIso = () => new Date().toISOString();

export const sessionCreate = (sessionId: string, siteId: string, optics: Optics) =>
  makeChange("session.create", { session_id: sessionId, site_id: siteId, started_at: nowIso(), optics });

export const sessionOptics = (sessionId: string, optics: Optics) =>
  makeChange("session.optics", { session_id: sessionId, optics });

type FieldValues = Record<string, unknown>;

export const observationCreate = (observationId: string, sessionId: string, objectId: string, editedAt: string, fields: FieldValues) =>
  makeChange("observation.create", {
    observation_id: observationId,
    session_id: sessionId,
    object_id: objectId,
    edited_at: editedAt,
    fields,
  });

export const observationUpdate = (observationId: string, baseVersion: number, editedAt: string, fields: FieldValues) =>
  makeChange("observation.update", { observation_id: observationId, base_version: baseVersion, edited_at: editedAt, fields });

export const sketchPut = (observationId: string, baseVersion: number, editedAt: string, strokes: string) =>
  makeChange("sketch.put", {
    observation_id: observationId,
    base_version: baseVersion,
    edited_at: editedAt,
    strokes,
    raster_png_base64: null,
  });

export const observationDelete = (observationId: string, baseVersion: number) =>
  makeChange("observation.delete", { observation_id: observationId, base_version: baseVersion });

export interface Queued {
  change: Change;
  meta: EntryMeta;
}

/**
 * Appends changes to the account's journal, in order. This tab sees them at once; the write to
 * disk (shared with the other tabs, under a lock) follows.
 */
export async function queueChanges(items: Queued[], announce: JournalEntry["announce"]): Promise<void> {
  const account = accountId();
  if (!account) return;
  const added: JournalEntry[] = items.map((item) => ({ change: item.change, announce, meta: item.meta }));
  app.set((state) => ({ journal: [...state.journal, ...added] }));
  await navigator.locks.request(`lowlamp-journal:${account}`, async () => {
    const ids = new Set(added.map((e) => e.change.client_op_id));
    const next = [...(await readJournal(account)).filter((e) => !ids.has(e.change.client_op_id)), ...added];
    await writeJournal(account, next);
    app.set({ journal: next });
    broadcast({ t: "data", account, touched: { journal: true } });
  });
}
