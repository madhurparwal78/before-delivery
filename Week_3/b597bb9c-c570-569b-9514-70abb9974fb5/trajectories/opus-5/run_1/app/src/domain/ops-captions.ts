/**
 * Caption ops, including an SRT import that replaces a row in one op.
 */
import { ApiError } from './api-error.js';
import { BLOCKER } from './errors.js';
import type { ApplyOutcome } from './ops-clips.js';
import {
  captionBlocker,
  findCaption,
  findRow,
  requireUnlockedRow,
  type EngineCaption,
  type EngineContext,
} from './timeline-state.js';
import { captionTextIsValid, invalid, readString, readWhole } from './validate.js';
import type { SrtFormat, ParsedCue } from './srt.js';

function freshCaption(
  id: string,
  rowId: string,
  start: number,
  end: number,
  text: string,
  imported: ParsedCue | null,
): EngineCaption {
  return {
    id,
    row_id: rowId,
    start_frame: start,
    end_frame: end,
    text,
    import_start_ms: imported?.start_ms ?? null,
    import_end_ms: imported?.end_ms ?? null,
    import_start_frame: imported?.start_frame ?? null,
    import_end_frame: imported?.end_frame ?? null,
  };
}

function requireCaptionRow(ctx: EngineContext, rowId: string): void {
  const row = requireUnlockedRow(ctx.state, rowId);
  if (row.kind !== 'caption') throw invalid('row_id');
}

export function captionAdd(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const rowId = readString(op, 'row_id');
  const startFrame = readWhole(op, 'start_frame', { min: 0 });
  const endFrame = readWhole(op, 'end_frame', { min: 1 });
  const text = readString(op, 'text', { min: 1, max: 200, copy: 'Captions are 1 or 2 lines of at most 42 characters each.' });
  requireCaptionRow(ctx, rowId);
  if (!captionTextIsValid(text)) throw invalid('text');
  if (endFrame - startFrame < 1) throw invalid('end_frame');
  const blocker = captionBlocker(ctx.state, rowId, startFrame, endFrame, []);
  if (blocker) throw ApiError.of('blocked', { clip_name: findRow(ctx.state, rowId).name, reason: BLOCKER.inTheWay('a caption') });
  const caption = freshCaption(ctx.nextId('cap'), rowId, startFrame, endFrame, text, null);
  ctx.state.captions.push(caption);
  return { stopped: null, inverse: { type: 'caption_remove', caption_id: caption.id } };
}

export function captionEdit(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const caption = findCaption(ctx.state, op.caption_id);
  const startFrame = readWhole(op, 'start_frame', { min: 0 });
  const endFrame = readWhole(op, 'end_frame', { min: 1 });
  const text = readString(op, 'text', { min: 1, max: 200, copy: 'Captions are 1 or 2 lines of at most 42 characters each.' });
  requireCaptionRow(ctx, caption.row_id);
  if (!captionTextIsValid(text)) throw invalid('text');
  if (endFrame - startFrame < 1) throw invalid('end_frame');
  const blocker = captionBlocker(ctx.state, caption.row_id, startFrame, endFrame, [caption.id]);
  if (blocker) throw ApiError.of('blocked', { clip_name: findRow(ctx.state, caption.row_id).name, reason: BLOCKER.inTheWay('a caption') });
  const previous = { ...caption };
  caption.start_frame = startFrame;
  caption.end_frame = endFrame;
  caption.text = text;
  return {
    stopped: null,
    inverse: {
      type: 'caption_restore',
      caption: previous,
    },
  };
}

export function captionRemove(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const caption = findCaption(ctx.state, op.caption_id);
  requireCaptionRow(ctx, caption.row_id);
  const stored = { ...caption };
  ctx.state.captions = ctx.state.captions.filter((candidate) => candidate.id !== caption.id);
  return { stopped: null, inverse: { type: 'caption_restore', caption: stored } };
}

export function captionRestore(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const stored = op.caption as EngineCaption;
  const existing = ctx.state.captions.find((candidate) => candidate.id === stored.id);
  if (existing) {
    const previous = { ...existing };
    Object.assign(existing, stored);
    return { stopped: null, inverse: { type: 'caption_restore', caption: previous } };
  }
  ctx.state.captions.push({ ...stored });
  return { stopped: null, inverse: { type: 'caption_remove', caption_id: stored.id } };
}

export interface CaptionImportOp {
  row_id: string;
  cues: ParsedCue[];
  format: SrtFormat;
}

/** An SRT import replaces every cue on the row in one op. */
export function captionImport(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const rowId = readString(op, 'row_id');
  requireCaptionRow(ctx, rowId);
  const cues = op.cues as ParsedCue[];
  const format = op.format as SrtFormat;
  const previous = ctx.state.captions.filter((caption) => caption.row_id === rowId).map((caption) => ({ ...caption }));
  ctx.state.captions = ctx.state.captions.filter((caption) => caption.row_id !== rowId);
  for (const cue of cues) {
    ctx.state.captions.push(freshCaption(ctx.nextId('cap'), rowId, cue.start_frame, cue.end_frame, cue.text, cue));
  }
  return {
    stopped: null,
    inverse: { type: 'restore_captions', row_id: rowId, captions: previous, format },
  };
}

export function restoreCaptions(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const rowId = readString(op, 'row_id');
  const stored = op.captions as EngineCaption[];
  const previous = ctx.state.captions.filter((caption) => caption.row_id === rowId).map((caption) => ({ ...caption }));
  ctx.state.captions = ctx.state.captions.filter((caption) => caption.row_id !== rowId);
  for (const caption of stored) ctx.state.captions.push({ ...caption });
  return {
    stopped: null,
    inverse: { type: 'restore_captions', row_id: rowId, captions: previous, format: op.format },
  };
}
