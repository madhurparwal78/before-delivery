// Shared shapes of the modify commands: results as neutral data, refusals, and helpers to derive new entities.
import type { Entity, EntityDraft } from '../types.ts';
import { withoutHandle } from './transform.ts';

/** A refused command: `refused` is the published sentence. */
export interface Refusal { refused: string }
export interface EntityEdit { handle: string; set: Record<string, unknown> }

/**
 * What a modify command changed: fields of existing entities, new entities in creation order (no handles yet), handles to delete, and the
 * announcement's `<n>` (`Trim: <n> entities changed`: each picked entity once, plus each new entity a split adds).
 */
export interface ModifyResult { modified: EntityEdit[]; added: EntityDraft[]; removed: string[] }

export function isRefusal(result: ModifyResult | EntityDraft | Refusal): result is Refusal {
  return 'refused' in result;
}

/** A new entity of another shape that keeps the source's layer and look. */
export function inheriting(source: Entity, shape: NewShape): EntityDraft {
  const { layer, colour, linetype, lineweight, author } = withoutHandle(source);
  return { layer, ...(colour === undefined ? {} : { colour }), ...(linetype === undefined ? {} : { linetype }), ...(lineweight === undefined ? {} : { lineweight }), ...(author === undefined ? {} : { author }), ...shape };
}

type NewShape =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
  | { type: 'pline'; points: [number, number][]; closed: boolean };
