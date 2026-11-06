import { randomUUID } from 'node:crypto';
import { db, type Queryable } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { emitNote, jobWrite } from '../events.js';
import { body, requireAccount, route, sendJson, type Ctx, type Route } from '../http.js';
import { requireJob, requireOpenJob, requireUuid, type JobContext } from '../jobctx.js';
import {
  applyEdit,
  applyRedo,
  applyUndo,
  bodyOf,
  checkEdit,
  createNote,
  currentRev,
  redoTarget,
  resultingLength,
  undoTarget,
  type NoteAuthor,
  type NoteDoc,
} from '../core/notes.js';
import { canSeeNote, loadItems, projectNote, type ItemRecord, type NoteRecord } from '../model.js';
import { requireItem } from '../itemcore.js';

const MAX_BODY_POINTS = 2000;

function pointLength(text: string): number {
  return Array.from(text).length;
}

async function saveDoc(
  tx: Queryable,
  noteId: string,
  doc: NoteDoc,
): Promise<void> {
  await tx.query(`update notes set doc = $2, rev = $3, body = $4 where id = $1`, [
    noteId,
    JSON.stringify(doc),
    currentRev(doc),
    bodyOf(doc),
  ]);
}

function authorOf(ctx: JobContext): NoteAuthor {
  return {
    personId: ctx.viewer.personId,
    memberId: ctx.viewer.memberId ?? ctx.viewer.personId,
    name: ctx.viewer.name,
    role: ctx.viewer.role,
  };
}

function findNote(item: ItemRecord, ctx: JobContext, noteId: string): NoteRecord {
  requireUuid(noteId);
  const note = item.notes.find((candidate) => candidate.id === noteId);
  if (note === undefined || !canSeeNote(ctx.viewer, note)) fail('not_found');
  return note;
}

function requireNoteEditor(ctx: JobContext, note: NoteRecord): void {
  if (ctx.viewer.role === 'owner' || ctx.viewer.role === 'lead') return;
  if (note.authorId === ctx.viewer.personId) return;
  fail('forbidden');
}

async function respond(
  ctx: Ctx,
  jobCtx: JobContext,
  itemId: string,
  noteId: string,
  status: number,
): Promise<void> {
  const items = await loadItems(db, jobCtx.job.id, [itemId]);
  const note = items[0].notes.find((candidate) => candidate.id === noteId)!;
  const replies =
    note.parentId === null
      ? items[0].notes.filter(
          (candidate) => candidate.parentId === note.id && canSeeNote(jobCtx.viewer, candidate),
        )
      : null;
  sendJson(ctx.res, status, projectNote(note, replies));
}

export const noteRoutes: Route[] = [
  route('POST', '/api/jobs/:jobId/items/:itemId/notes', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const text = raw.body;
    const fields: Record<string, string> = {};
    if (
      typeof text !== 'string' ||
      pointLength(text) < 1 ||
      pointLength(text) > MAX_BODY_POINTS
    ) {
      fields.body = 'Write a note of 1 to 2,000 characters.';
    }
    let audience: 'crew' | 'everyone' = 'everyone';
    if (raw.audience !== undefined && raw.audience !== null) {
      if (raw.audience !== 'crew' && raw.audience !== 'everyone') {
        fields.audience = 'Choose who can see this note.';
      } else {
        audience = raw.audience;
      }
    }
    if (jobCtx.viewer.role === 'homeowner' && audience === 'crew') fail('forbidden');

    let parent: NoteRecord | null = null;
    if (raw.parent_id !== undefined && raw.parent_id !== null) {
      if (typeof raw.parent_id !== 'string') fail('not_found');
      parent = findNote(item, jobCtx, raw.parent_id);
      if (parent.parentId !== null) fields.parent_id = 'Replies go one level deep.';
      else if (parent.audience === 'crew' && audience !== 'crew') {
        fields.audience = 'A reply to a crew note is crew only.';
      }
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    const noteId = randomUUID();
    await jobWrite(jobCtx.job.id, async (tx) => {
      const at = new Date();
      const doc = createNote(text as string, authorOf(jobCtx), at.toISOString());
      await tx.query(
        `insert into notes (id, job_id, item_id, parent_id, audience, author_id, doc, rev, body, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)`,
        [
          noteId,
          jobCtx.job.id,
          item.id,
          parent === null ? null : parent.id,
          audience,
          jobCtx.viewer.personId,
          JSON.stringify(doc),
          text,
          at.toISOString(),
        ],
      );
      await emitNote(tx, jobCtx.job.id, item.id, noteId, item.trade, audience);
    });
    await respond(ctx, jobCtx, item.id, noteId, 201);
  }),

  route('POST', '/api/jobs/:jobId/items/:itemId/notes/:noteId/edits', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const note = findNote(item, jobCtx, ctx.params.noteId);
    requireNoteEditor(jobCtx, note);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const edit = {
      baseRev: typeof raw.base_rev === 'number' ? raw.base_rev : -1,
      pos: typeof raw.pos === 'number' ? raw.pos : -1,
      del: typeof raw.delete === 'number' ? raw.delete : 0,
      insert: typeof raw.insert === 'string' ? raw.insert : '',
    };
    const problem = checkEdit(note.doc, edit);
    if (problem !== null) {
      const fieldByProblem = {
        base_rev: 'Base this edit on a revision of this note.',
        pos: 'That position is outside the note.',
        delete: 'Send an edit that deletes or inserts something.',
        empty: 'Send an edit that deletes or inserts something.',
        body_length: 'A note is 1 to 2,000 characters.',
      } as const;
      const key = problem === 'empty' ? 'delete' : problem;
      throw new ApiError('validation', { fields: { [key]: fieldByProblem[problem] } });
    }
    const resulting = resultingLength(note.doc, edit);
    if (resulting < 1 || resulting > MAX_BODY_POINTS) {
      throw new ApiError('validation', { fields: { insert: 'A note is 1 to 2,000 characters.' } });
    }

    await jobWrite(jobCtx.job.id, async (tx) => {
      const doc = note.doc;
      applyEdit(doc, edit, authorOf(jobCtx), new Date().toISOString());
      await saveDoc(tx, note.id, doc);
      await emitNote(tx, jobCtx.job.id, item.id, note.id, item.trade, note.audience);
    });
    await respond(ctx, jobCtx, item.id, note.id, 200);
  }),

  route('POST', '/api/jobs/:jobId/items/:itemId/notes/:noteId/undo', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const note = findNote(item, jobCtx, ctx.params.noteId);
    requireNoteEditor(jobCtx, note);
    requireOpenJob(jobCtx);
    if (undoTarget(note.doc, jobCtx.viewer.personId) === null) fail('nothing_to_undo');
    await jobWrite(jobCtx.job.id, async (tx) => {
      const doc = note.doc;
      applyUndo(doc, authorOf(jobCtx), new Date().toISOString());
      await saveDoc(tx, note.id, doc);
      await emitNote(tx, jobCtx.job.id, item.id, note.id, item.trade, note.audience);
    });
    await respond(ctx, jobCtx, item.id, note.id, 200);
  }),

  route('POST', '/api/jobs/:jobId/items/:itemId/notes/:noteId/redo', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const note = findNote(item, jobCtx, ctx.params.noteId);
    requireNoteEditor(jobCtx, note);
    requireOpenJob(jobCtx);
    if (redoTarget(note.doc, jobCtx.viewer.personId) === null) fail('nothing_to_redo');
    await jobWrite(jobCtx.job.id, async (tx) => {
      const doc = note.doc;
      applyRedo(doc, authorOf(jobCtx), new Date().toISOString());
      await saveDoc(tx, note.id, doc);
      await emitNote(tx, jobCtx.job.id, item.id, note.id, item.trade, note.audience);
    });
    await respond(ctx, jobCtx, item.id, note.id, 200);
  }),

  route('GET', '/api/jobs/:jobId/items/:itemId/notes/:noteId/history', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const note = findNote(item, jobCtx, ctx.params.noteId);
    sendJson(ctx.res, 200, {
      revisions: note.doc.revisions.map((revision) => ({
        rev: revision.rev,
        kind: revision.kind,
        author: { name: revision.authorName, role: revision.authorRole },
        body: revision.body,
        created_at: revision.createdAt,
      })),
    });
  }),
];
