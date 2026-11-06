import type { Pool } from 'pg';
import { putObject } from './s3.js';
import { emptyModel, modelBlocks, replayDelta } from '../domain/model.js';
import type { DocModel } from '../domain/model.js';
import { SEED_DOCS, seedDeltaFor } from './seed.js';


/** The seeded open insertion on the reading nights proposal. */
export const SEED_SUGGESTIONS: Record<string, { id: string; kind: 'insert'; authorId: string; authorRole: 'editor'; inserted: { at: number; length: number }; deleted: null; contentDeleted: boolean; status: 'open'; createdAt: string; closedAt: null; closedById: null; closedAs: null; decidedById: null }[]> = {
  'riverbend-reading-nights': [
    {
      id: 'sg-seed-1',
      kind: 'insert',
      authorId: 'p-tomas-reyes',
      authorRole: 'editor',
      inserted: { at: 397, length: 23 },
      deleted: null,
      contentDeleted: false,
      status: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedById: null,
      closedAs: null,
      decidedById: null,
    },
  ],
};

/** The body a seed proposal starts from: revision 1 counts as saved once its object is written. */
export function seedBody(documentId: string): { documentId: string; revision: number; text: string; blocks: unknown[]; marks: unknown[]; lineStyles: unknown[]; suggestions: unknown[] } {
  const doc = SEED_DOCS.find((d) => d.id === documentId)!;
  const { text, delta } = seedDeltaFor(doc);
  const model: DocModel = emptyModel();
  replayDelta(model, delta as Parameters<typeof replayDelta>[1]);
  return {
    documentId,
    revision: 1,
    text,
    blocks: modelBlocks(model),
    marks: model.marks,
    lineStyles: model.lineStyles,
    suggestions: (SEED_SUGGESTIONS[documentId] ?? []).map((s) => ({ ...s })),
  };
}

/** Writes any missing seed object and marks the proposal saved once storage confirms (Services). */
export async function writeSeedObjects(pool: Pool): Promise<void> {
  for (const doc of SEED_DOCS) {
    const row = await pool.query(`SELECT saved_revision FROM documents WHERE id = $1`, [doc.id]);
    if (!row.rowCount) continue;
    const saved = (row.rows[0] as { saved_revision: number }).saved_revision;
    if (saved >= 1) continue;
    const body = seedBody(doc.id);
    const success = await withRetry(async () => {
      await putObject(`documents/${doc.id}.json`, JSON.stringify(body));
      return true;
    });
    if (success) {
      await pool.query(`UPDATE documents SET saved_revision = 1, save_failed = false, object_required = true WHERE id = $1`, [doc.id]);
      const live = (await import('./store.js')).liveDocs.get(doc.id);
      if (live) {
        live.savedRevision = 1;
        live.saveFailed = false;
        if (live.model.revision === 1) {
          for (const [, sockets] of live.joined) {
            for (const s of sockets) s.send({ type: 'saved', revision: 1 });
          }
        }
      }
    }
  }
}

/** Retries a storage write every 5 seconds until it succeeds, while the app keeps serving. */
async function withRetry(op: () => Promise<boolean>): Promise<boolean> {
  for (;;) {
    try {
      return await op();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

