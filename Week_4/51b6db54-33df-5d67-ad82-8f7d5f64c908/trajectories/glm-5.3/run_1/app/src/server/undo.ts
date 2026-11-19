import type { Express } from 'express';
import { q, one } from './db.js';
import { notFound, forbidden, conflict } from './errors.js';
import { requireUser, config } from './http.js';
import { getSprite, getLayers, getFrames, celRows, writeCel, blankRows, nextSeq } from './sprites.js';
import { requireMember } from './projects.js';

interface UndoRow { idx: number; action: Record<string, unknown> }

/** Undo reverses that person's last undoable action as a new sequenced
 * operation; a change by someone else refuses it. */
async function personStack(userId: number, spriteId: number): Promise<UndoRow[]> {
  return q<UndoRow>('select idx, action from undo_stack where user_id = $1 and sprite_id = $2 order by idx asc', [userId, spriteId]);
}

export function registerUndoRoutes(app: Express): void {
  app.post('/api/sprites/:id/undo', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      if (role === 'reviewer') throw forbidden("Reviewers can't draw");
      const stack = await personStack(user.id, Number(sprite.id));
      if (stack.length === 0) throw conflict('nothing_to_undo', { message: 'Nothing to undo' });
      const top = stack[stack.length - 1];
      const { seq, changed } = await applyUndoAction(Number(sprite.id), user.id, top.action, 'undo');
      await q('delete from undo_stack where user_id = $1 and sprite_id = $2 and idx = $3', [user.id, sprite.id, top.idx]);
      res.json({ seq, pixels_changed: changed });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/redo', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      if (role === 'reviewer') throw forbidden("Reviewers can't draw");
      const stack = await personStack(user.id, Number(sprite.id));
      const redoEntries = stack.filter((s) => Number(s.idx) < 0);
      if (redoEntries.length === 0) throw conflict('nothing_to_redo', { message: 'Nothing to redo' });
      const top = redoEntries[redoEntries.length - 1];
      const { seq, changed } = await applyUndoAction(Number(sprite.id), user.id, top.action, 'redo');
      await q('delete from undo_stack where user_id = $1 and sprite_id = $2 and idx = $3', [user.id, sprite.id, top.idx]);
      res.json({ seq, pixels_changed: changed });
    } catch (e) { next(e); }
  });
}

async function applyUndoAction(spriteId: number, userId: number, action: Record<string, unknown>, direction: 'undo' | 'redo'): Promise<{ seq: number; changed: number }> {
  const sprite = await getSprite(spriteId);
  const frames = await getFrames(spriteId);
  const layers = await getLayers(spriteId);
  const frameNo = Number(action['frame'] ?? 0);
  const frame = frames.find((f) => f.position === frameNo);
  const layerId = String(action['layer'] ?? '');
  const layer = layers.find((l) => l.id === layerId);
  if (!frame || !layer) {
    const seq = await nextSeq(spriteId, direction === 'undo' ? 'undo' : 'redo', userId, {});
    return { seq, changed: 0 };
  }
  const beforeKey = direction === 'undo' ? 'before' : 'after';
  const rows = (action[beforeKey] as number[][] | undefined) ?? null;
  const current = await celRows(Number(frame.id), Number(layer.id));
  const before = current ?? blankRows(sprite.width, sprite.height);
  let changed = 0;
  const next = rows ?? before;
  for (let y = 0; y < next.length; y++) {
    for (let x = 0; x < next[y].length; x++) {
      if (before[y][x] !== next[y][x]) changed++;
    }
  }
  await writeCel(Number(frame.id), Number(layer.id), next);
  const seq = await nextSeq(spriteId, direction === 'undo' ? 'undo' : 'redo', userId, { frame: frameNo });
  return { seq, changed };
}
