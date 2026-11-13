// The operation engine: the one place where changes to a drawing are decided. The server applies groups with it
// authoritatively, the browser applies the same groups optimistically. Also: undo/redo inversion, patches, the
// Plotfold drawing text format, compare and markup flags.
import type {
  BlockAttribute, BlockDef, Constraint, ConstraintRef, DimStyle, DrawingDocument, DrawingState, Entity, EntityDraft, EntityType, Layer,
  LayerState, ModelSnapshot, OpResult, Parameter, Point, StatePatch, Underlay, Xref,
} from '../types.ts';

// ---------------------------------------------------------------- changes (what a group did, net per target)

export type TargetKind = 'entity' | 'layer' | 'block' | 'dim_style' | 'parameter' | 'constraint' | 'xref' | 'layer_state' | 'underlay';
export interface TargetValue {
  entity: Entity; layer: Layer; block: BlockDef; dim_style: DimStyle; parameter: Parameter;
  constraint: Constraint; xref: Xref; layer_state: LayerState; underlay: Underlay;
}
/**
 * The net effect of a group on one target. `key` is the handle, layer name, block name, dimension style name, parameter name,
 * constraint id, xref name, layer state name or underlay id. `before` is null when the group created the target, `after` null when it
 * deleted it. `derived` marks a dimension or hatch whose only change is the recomputed value, area, boundary or association
 * (never counted as a conflict or as a reason to refuse an undo).
 */
export interface TargetChange<K extends TargetKind> { kind: K; key: string; before: TargetValue[K] | null; after: TargetValue[K] | null; derived: boolean }
export type Change = { [K in TargetKind]: TargetChange<K> }[TargetKind];

/** A toast aimed at one person (`username`), sent over the live channel as a `notice` message. */
export interface Notice { username: string; text: string }

// ---------------------------------------------------------------- the environment of one application

/** The change log the Conflict rules and the Per-person undo rule ask about other people (the server's `ChangeLog`; the browser has none). */
export interface ConflictProbe {
  /**
   * The most recent NON-derived change to the target by someone other than `user` at a revision greater than `revision`, else null.
   * `revision` of a change is the drawing revision after its group.
   */
  otherChangeSince(kind: TargetKind, key: string, user: string, revision: number): { user: string; revision: number } | null;
  /** The entity as it was at `revision` (null if it did not exist then). */
  entityAt(handle: string, revision: number): Entity | null;
}

/** What an xref attach or reload copies: the source drawing's last published model, or an empty one when it has none. */
export interface XrefSource { version_id: string | null; model: ModelSnapshot }
/** Drawing names and their xref sources, for the circular reference chain. */
export interface XrefDirectory { name(drawingId: string): string; sources(drawingId: string): string[] }

/** Loaders only the server has. The browser applies groups without them (see `isServerOnlyOp`). */
export interface ServerLoaders {
  /** id of the drawing being edited */
  drawingId: string;
  xrefSource(drawingId: string): XrefSource;
  xrefDirectory: XrefDirectory;
  /** the model of a published version (for `version_restore`) */
  versionModel(versionId: string): ModelSnapshot;
  /** the parsed text file stored by an upload (for `import_merge`) */
  importedDrawing(importId: string): ParsedDrawing;
}

export interface EngineEnv {
  /** the person whose group this is: author of new entities, target of the "dropped" and "redirected" toasts */
  username: string;
  /** server only: without it no operation conflicts */
  conflicts?: ConflictProbe;
  /** browser only: hands out `new-<n>` instead of taking the drawing's next handle number */
  assignHandle?: (type: EntityType) => string;
  loaders?: ServerLoaders;
}

export interface GroupOutcome {
  /** the new state; `revision` advanced by the number of ops in the group (by 1 for an undo or redo) */
  state: DrawingState;
  /** one per op, in order (empty for an undo or redo) */
  results: OpResult[];
  /** net per target, to be stored for undo/redo and the entity history */
  changes: Change[];
  notices: Notice[];
  /** what clients apply to their confirmed state */
  patch: StatePatch;
  /** set by a `purge` op */
  purged: { blocks: number; layers: number } | null;
}

// ---------------------------------------------------------------- applying and inverting groups

/** Applies a whole group atomically, in order: every op rule, conflict rules, constraints, derived values. Throws `ApiError`. */
export { applyGroup, isServerOnlyOp } from './engine.ts';
/** Undo (restore every `before`) or redo (every `after`) of a recorded group as one synthetic op (+1 revision), then recompute derived values. */
export { applyRestore, findSuperseded, restoreCommand } from './undo.ts';
export type { RestoreDirection } from './undo.ts';
export { ChangeLog } from './changelog.ts';
export { applyPatch, makePatch } from './patch.ts';

// ---------------------------------------------------------------- state <-> documents, seeds

export { emptyDrawingState, documentCollections, stateFromDocument, parameterViews } from './state.ts';
export type DocumentCollections = Pick<DrawingDocument, 'layers' | 'entities' | 'blocks' | 'dim_styles' | 'parameters' | 'constraints' | 'xrefs' | 'layer_states' | 'underlays'>;

/** An entity in a seed or a parsed file: it carries its handle, derived fields are computed. */
export type SeedEntity = EntityDraft & { handle: string };
export interface SeedBlock { name: string; base: Point; entities: SeedEntity[]; attributes: BlockAttribute[] }
/** A grading-seed drawing record with its references resolved by the server (xrefs carry their loaded model and drawing id as `source`). */
export interface DrawingSeed {
  layers?: Layer[];
  entities?: SeedEntity[];
  generate?: { lines: number; spacing: number };
  blocks?: SeedBlock[];
  dim_styles?: DimStyle[];
  parameters?: Parameter[];
  constraints?: { kind: Constraint['kind']; refs: ConstraintRef[]; expression?: string }[];
  xrefs?: Xref[];
  layer_states?: { name: string }[];
}
/** Builds the starting state of a seeded drawing (revision 0, given handles kept, next_handle one past the highest). Throws `ApiError` on bad records. */
export { seedDrawing } from './seed.ts';

// ---------------------------------------------------------------- rules other modules ask for

/** What PURGE would remove right now: block definitions not reachable from model inserts, and empty layers other than `0`. */
export { purgeCandidates } from './blockops.ts';
/** The Xrefs circular rule: the chain `[current, source, …, current]` of drawing names when attaching `sourceId` to `currentId` would loop, else null. */
export { xrefCircularChain } from './xrefops.ts';
// ---------------------------------------------------------------- Plotfold drawing text format

export interface ParsedBlock { name: string; base: Point; entities: SeedEntity[]; attributes: BlockAttribute[] }
export interface ParsedDrawing { layers: Layer[]; blocks: ParsedBlock[]; entities: SeedEntity[] }
export type ParseResult = { ok: true; drawing: ParsedDrawing } | { ok: false; errors: string[] };
export interface ImportPreview { adds: { entities: number; layers: number; blocks: number }; renames: { from: string; to: string }[] }

/** The upload type rule for text files: valid UTF-8 without null characters (PostgreSQL cannot store them) whose first line is exactly `plotfold 1`. */
export { isPlotfoldText } from './textformat.ts';
/** Parses a file that passed `isPlotfoldText`. Errors: at most 20, 1-based, top to bottom, one per line, with the published texts. */
export { parsePlotfold } from './textformat.ts';
/** What merging would add to `state` and which layers and blocks it would rename to `<name> (k)`. */
export { previewImport } from './textformat.ts';
/** The canonical text of the model: byte-identical for canonical input. */
export { serializeCanonical } from './textformat.ts';

// ---------------------------------------------------------------- compare and markup flags

/** The snapshot published for a sheet version: the sheet and the drawing's model. */
export { buildSnapshot } from './compare.ts';
/** Delta swipe: entities match by id (`<xref name>|<handle>` for xref entities), 0.001 tolerance, insert with changed definition = changed. */
export { compareModels } from './compare.ts';
/** The carry-forward flag of each markup (same order): `geometry-changed` when an added, removed or changed entity's box meets the markup's box. */
export { flagMarkups } from './compare.ts';

// ---------------------------------------------------------------- JSON boundary

/** The body of `POST /api/drawings/<id>/ops` as a typed group. Throws `invalid` with `fields`. State rules stay in `applyGroup`. */
export { parseOperationGroup, parseDrawingSeed } from './wire.ts';
export type { SeedRecord } from './wire.ts';
