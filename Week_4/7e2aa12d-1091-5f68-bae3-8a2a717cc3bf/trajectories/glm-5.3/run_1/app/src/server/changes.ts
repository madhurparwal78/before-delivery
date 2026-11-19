// The one place a change is applied: validation, conflicts, undo, revisions.
import type { Pool } from 'pg';
import type { LayoutData } from '../domain/layout.js';
import { Refusal, applyChange, announcementOf, structuredCloneLayout, type Announced, type Limits } from '../domain/apply.js';
import { findConflict } from '../domain/conflicts.js';
import { sortAreas } from '../domain/areas.js';
import type { AreaLine } from '../domain/layout.js';
import { cssToLayout, CssError, CSS_TOO_LONG_MESSAGE } from '../domain/read-css.js';
import * as store from '../store/store.js';
import type { UndoEntry } from '../store/store.js';

export interface ChangeOutcome {
  status: 'applied' | 'unchanged' | 'conflict' | 'refused';
  revision?: number;
  layout?: LayoutData;
  announcement?: string;
  message?: string;
  conflictWith?: { username: string; target: string };
  added?: string[];
  removed?: string[];
}

const LOCKS = new Map<string, Promise<unknown>>();

/** Changes are serialised per layout so revisions never repeat or skip. */
export async function withLayoutLock<T>(layoutId: string, work: () => Promise<T>): Promise<T> {
  const previous = LOCKS.get(layoutId) ?? Promise.resolve();
  const next = previous.then(work, work);
  LOCKS.set(layoutId, next.catch(() => {}));
  const result = await next;
  if (LOCKS.get(layoutId) === next) LOCKS.delete(layoutId);
  return result;
}

export interface ApplyRequest {
  pool: Pool;
  layoutId: string;
  username: string;
  baseRevision: number;
  change: Record<string, unknown>;
  limits: Limits;
}

/** Applies one change to a layout inside the layout's lock. */
export async function applyChangeRequest(req: ApplyRequest): Promise<ChangeOutcome> {
  const { pool, layoutId, username, baseRevision, change, limits } = req;
  const record = await store.loadLayout(pool, layoutId);
  if (!record) return { status: 'refused', message: 'not_found' };
  const layout = record.data;
  if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision > layout.revision) {
    return { status: 'refused', message: 'Unknown base revision.' };
  }
  if (change['kind'] === 'restore_version') return restoreVersion(pool, layoutId, username, baseRevision, change, record);
  if (change['kind'] === 'undo' || change['kind'] === 'redo') return undoRedo(pool, layoutId, username, baseRevision, change, limits, record);

  const later = (await store.changeRowsSince(pool, layoutId, baseRevision))
    .filter((row) => row.username !== username);
  const winner = findConflict(change, later);
  if (winner !== null) return conflictOutcome(layout, winner, change);

  let outcome: { layout: LayoutData; announced: Announced; added?: string[]; removed?: string[] };
  try {
    outcome = computeOutcome(layout, change, limits);
  } catch (error) {
    if (error instanceof Refusal) return { status: 'refused', message: error.message };
    throw error;
  }
  if (outcome.announced.kind === 'none') return { status: 'unchanged', revision: layout.revision };
  return commit(pool, layoutId, username, record.name, layout, change, outcome);
}

function conflictOutcome(layout: LayoutData, winner: string, change: Record<string, unknown>): ChangeOutcome {
  return {
    status: 'conflict',
    layout,
    revision: layout.revision,
    conflictWith: { username: winner, target: targetOf(change) },
  };
}

/** The `<target>` of a conflict notice. */
function targetOf(change: Record<string, unknown>): string {
  const kind = change['kind'];
  if (kind === 'set_track') return `${change['axis']} ${change['index']}`;
  if (kind === 'set_area') return `area ${change['name']}`;
  if (kind === 'rename_area') return `area ${change['name']}`;
  if (kind === 'set_gap') return 'the gaps';
  return 'the layout';
}

async function commit(
  pool: Pool,
  layoutId: string,
  username: string,
  layoutName: string,
  before: LayoutData,
  change: Record<string, unknown>,
  outcome: { layout: LayoutData; announced: Announced; added?: string[]; removed?: string[] },
): Promise<ChangeOutcome> {
  const nextRevision = before.revision + 1;
  const next: LayoutData = { ...outcome.layout, revision: nextRevision };
  await store.saveLayoutData(pool, layoutId, layoutName, nextRevision, next);
  await store.appendChange(pool, layoutId, nextRevision, username, change);
  await store.clearRedo(pool, layoutId, username);
  await store.appendUndo(pool, layoutId, username, change, before);
  return {
    status: 'applied',
    revision: nextRevision,
    layout: next,
    announcement: announcementOf(outcome.announced),
    added: outcome.added,
    removed: outcome.removed,
  };
}

function computeOutcome(layout: LayoutData, change: Record<string, unknown>, limits: Limits): { layout: LayoutData; announced: Announced; added?: string[]; removed?: string[] } {
  if (change['kind'] === 'apply_css') {
    const css = change['css'];
    if (typeof css !== 'string') throw new Refusal('The request body is not valid.');
    if (css.length > 20000) throw new Refusal(CSS_TOO_LONG_MESSAGE);
    try {
      const result = cssToLayout(css, limits, layout);
      if (layoutEquals(layout, result.layout)) return { layout, announced: { kind: 'none' }, added: [], removed: [] };
      return { layout: result.layout, announced: { kind: 'css', added: result.added, removed: result.removed } };
    } catch (error) {
      if (error instanceof CssError) {
        throw new Refusal(error.line === 0 ? error.message : `Line ${error.line}: ${error.message}`);
      }
      throw error;
    }
  }
  return applyChange(layout, change, limits);
}

export function layoutEquals(a: LayoutData, b: LayoutData): boolean {
  const ordered = (layout: LayoutData) => JSON.stringify(canonicalLayout(layout));
  return ordered(a) === ordered(b);
}

/** Field order is normalised so JSON comparison is exact. */
export function canonicalLayout(layout: LayoutData): LayoutData {
  return {
    name: layout.name,
    revision: layout.revision,
    columns: layout.columns,
    rows: layout.rows,
    gap: { row: layout.gap.row, column: layout.gap.column },
    areas: sortAreas(layout.areas).map(areaLine),
    breakpoints: [...layout.breakpoints]
      .sort((a, b) => a.min_width - b.min_width)
      .map((bp) => ({
        min_width: bp.min_width,
        columns: bp.columns,
        rows: bp.rows,
        areas: sortAreas(bp.areas).map(areaLine),
        gap: bp.gap,
      })),
  };
}

function areaLine(area: AreaLine): AreaLine {
  return { name: area.name, row_start: area.row_start, column_start: area.column_start, row_end: area.row_end, column_end: area.column_end };
}

async function restoreVersion(
  pool: Pool,
  layoutId: string,
  username: string,
  baseRevision: number,
  change: Record<string, unknown>,
  record: store.LayoutRecord,
): Promise<ChangeOutcome> {
  const number = change['number'];
  if (typeof number !== 'number' || !Number.isInteger(number)) {
    return { status: 'refused', message: `There is no version ${String(number)}.` };
  }
  const version = await store.versionData(pool, layoutId, number);
  if (!version) return { status: 'refused', message: `There is no version ${number}.` };
  const layout = record.data;
  const later = (await store.changeRowsSince(pool, layoutId, baseRevision)).filter((row) => row.username !== username);
  const winner = findConflict(change, later);
  if (winner !== null) return conflictOutcome(layout, winner, change);
  const restored = structuredCloneLayout(version.data);
  restored.name = layout.name;
  if (layoutEquals(layout, restored)) return { status: 'unchanged', revision: layout.revision };
  const nextRevision = layout.revision + 1;
  const next: LayoutData = { ...restored, revision: nextRevision };
  await store.saveLayoutData(pool, layoutId, record.name, nextRevision, next);
  await store.appendChange(pool, layoutId, nextRevision, username, change);
  const count = await store.versionCount(pool, layoutId);
  await store.saveVersion(pool, layoutId, count + 1, `Restored from version ${number}`, nextRevision, next);
  return { status: 'applied', revision: nextRevision, layout: next, announcement: `Restored version ${number}.` };
}

async function undoRedo(
  pool: Pool,
  layoutId: string,
  username: string,
  baseRevision: number,
  change: Record<string, unknown>,
  limits: Limits,
  record: store.LayoutRecord,
): Promise<ChangeOutcome> {
  const redo = change['kind'] === 'redo';
  const entries = await store.lastUndoEntries(pool, layoutId, username);
  const candidate: UndoEntry | null = redo ? lastRedoable(entries) : lastUndoable(entries);
  if (!candidate) return { status: 'refused', message: redo ? 'Nothing to redo.' : 'Nothing to undo.' };
  const target = candidate.change;
  const layout = record.data;
  const later = (await store.changeRowsSince(pool, layoutId, baseRevision)).filter((row) => row.username !== username);
  const winner = findConflict(target, later);
  if (winner !== null) return conflictOutcome(layout, winner, target);
  let outcome: { layout: LayoutData; announced: Announced };
  try {
    outcome = redo ? applyChange(layout, target, limits) : undoOutcome(candidate, layout);
  } catch (error) {
    if (error instanceof Refusal) return { status: 'refused', message: error.message };
    throw error;
  }
  if (outcome.announced.kind === 'none') return { status: 'unchanged', revision: layout.revision };
  const nextRevision = layout.revision + 1;
  const next: LayoutData = { ...outcome.layout, revision: nextRevision };
  await store.saveLayoutData(pool, layoutId, record.name, nextRevision, next);
  await store.appendChange(pool, layoutId, nextRevision, username, { kind: redo ? 'redo' : 'undo', of: target });
  await store.markUndone(pool, layoutId, username, candidate.seq, !redo);
  return { status: 'applied', revision: nextRevision, layout: next, announcement: redo ? 'Redone.' : 'Undone.' };
}

function lastUndoable(entries: UndoEntry[]): UndoEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (!entries[i]!.undone) return entries[i]!;
  }
  return null;
}

function lastRedoable(entries: UndoEntry[]): UndoEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]!.undone) return entries[i]!;
  }
  return null;
}

/** Undo puts back the layout the designer's own change replaced. */
function undoOutcome(candidate: UndoEntry, current: LayoutData): { layout: LayoutData; announced: Announced } {
  const before = structuredCloneLayout(candidate.before);
  before.name = current.name;
  return { layout: before, announced: { kind: 'undo' } };
}
