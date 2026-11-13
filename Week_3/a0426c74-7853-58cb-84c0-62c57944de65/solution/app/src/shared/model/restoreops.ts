// Sheet versions RESTORE and the text format IMPORT merge: whole-model changes made as one group.
import { compareHandles, findHatch, handleNumber, midpoint, STANDARD_DIM_STYLE } from '../geometry/index.ts';
import type { Entity, EntityDraft, ModelSnapshot, Op } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';
import { buildEntity } from './entity.ts';
import { removeEntities } from './entityops.ts';
import { ZERO_LAYER } from './names.ts';
import { mergeNames } from './textformat.ts';
import { sameValue } from './workspace.ts';
import type { SeedEntity } from './index.ts';

/** `version_restore`: the model becomes the version's model. Deleted entities come back with their handles, added ones go, changed ones revert. */
export function versionRestoreOp(ctx: Context, op: Extract<Op, { type: 'version_restore' }>): OpOutcome {
  const model: ModelSnapshot = ctx.loaders.versionModel(op.version);
  const { ws } = ctx;
  const wanted = new Map(model.entities.map((entity) => [entity.handle, entity]));
  const gone = ws.entities.keys().filter((handle) => !wanted.has(handle));
  const differing: Entity[] = model.entities.filter((entity) => !sameValue(ws.entities.get(entity.handle), entity));
  const touched = [...gone.flatMap((handle) => ws.entities.get(handle) ?? []), ...differing.flatMap((entity) => ws.entities.get(entity.handle) ?? []), ...differing];
  for (const entity of touched) ctx.assertUnlocked(entity.layer);
  removeEntities(ctx, gone);
  for (const entity of differing) ws.entities.set(entity.handle, entity);
  syncRecords(model.layers, ws.layers, (layer) => layer.name, (name) => name === ZERO_LAYER);
  syncRecords(model.blocks, ws.blocks, (block) => block.name, () => false);
  syncRecords(model.xrefs, ws.xrefs, (xref) => xref.name, () => false);
  ws.nextHandle = Math.max(ws.nextHandle, ...model.entities.map((entity) => handleNumber(entity.handle) + 1));
  return { status: 'applied', handles: [] };
}

function syncRecords<V>(
  wanted: readonly V[],
  table: { keys(): string[]; get(key: string): V | undefined; set(key: string, value: V): void; delete(key: string): void },
  keyOf: (value: V) => string,
  keep: (key: string) => boolean,
): void {
  const keys = new Set(wanted.map(keyOf));
  for (const key of table.keys()) {
    if (!keys.has(key) && !keep(key)) table.delete(key);
  }
  for (const value of wanted) {
    if (!sameValue(table.get(keyOf(value)), value)) table.set(keyOf(value), value);
  }
}

/** Where a dimension's text goes when the file does not say: on its first reference. */
function anchorOf(entity: Entity | undefined): [number, number] {
  if (!entity) return [0, 0];
  switch (entity.type) {
    case 'line': return midpoint([entity.x1, entity.y1], [entity.x2, entity.y2]);
    case 'circle': case 'arc': return [entity.cx, entity.cy];
    case 'pline': return entity.points[0];
    default: return [0, 0];
  }
}

const isFollower = (entity: SeedEntity): boolean => entity.type === 'dimension' || entity.type === 'hatch';

/**
 * `import_merge`: the stored file's layers and blocks join the drawing (a taken name becomes `<name> (k)`), every entity gets a new handle in
 * file order. Entities inside block definitions come first, then the model entities (dimensions and hatches last, once what they follow exists).
 * Dimensions and hatches inside block definitions are not carried over.
 */
export function importMergeOp(ctx: Context, op: Extract<Op, { type: 'import_merge' }>): OpOutcome {
  const parsed = ctx.loaders.importedDrawing(op.import_id);
  const { ws } = ctx;
  const names = mergeNames({ layers: ws.layers.record, blocks: ws.blocks.record }, parsed);
  for (const layer of parsed.layers) {
    const name = names.layers.get(layer.name);
    if (name !== undefined) ws.layers.set(name, { ...layer, name });
  }
  const handles = new Map<string, string>();
  const claim = (entity: SeedEntity): string => {
    const handle = ctx.newHandle(entity.type);
    handles.set(entity.handle, handle);
    return handle;
  };
  const layerOf = (entity: SeedEntity): string => names.layers.get(entity.layer) ?? entity.layer;
  const renamed = (entity: SeedEntity): EntityDraft =>
    entity.type === 'insert' ? { ...entity, layer: layerOf(entity), block: names.blocks.get(entity.block) ?? entity.block } : { ...entity, layer: layerOf(entity) };
  for (const block of parsed.blocks) {
    const name = names.blocks.get(block.name) ?? block.name;
    const entities = block.entities.filter((entity) => !isFollower(entity)).map((entity) => buildEntity(ctx, renamed(entity), claim(entity), ctx.user));
    ws.blocks.set(name, { name, base: block.base, attributes: block.attributes, entities });
  }
  const items = parsed.entities.map((entity) => ({ entity, handle: claim(entity) }));
  const added: string[] = [];
  const place = (handle: string, draft: EntityDraft, carried?: Entity): void => {
    ctx.assertUnlocked(draft.layer);
    ws.entities.set(handle, buildEntity(ctx, draft, handle, ctx.user, carried));
    added.push(handle);
  };
  for (const { entity, handle } of items) {
    if (!isFollower(entity)) place(handle, renamed(entity));
  }
  for (const { entity, handle } of items) {
    if (entity.type !== 'dimension') continue;
    const refs = entity.refs.map((ref) => ({ ...ref, handle: handles.get(ref.handle) ?? ref.handle })).filter((ref) => ws.entities.has(ref.handle));
    const [text_x, text_y] = anchorOf(ws.entities.get(refs[0]?.handle ?? ''));
    if (refs.length > 0) place(handle, { ...entity, layer: layerOf(entity), refs, style: ws.dimStyles.has(entity.style) ? entity.style : STANDARD_DIM_STYLE.name, text_x, text_y });
  }
  for (const { entity, handle } of items) {
    if (entity.type !== 'hatch') continue;
    const draft = renamed(entity);
    const found = findHatch([entity.seed_x, entity.seed_y], ws.entities.record, ws.layers.record);
    const unfollowed: Entity = { ...entity, handle, type: 'hatch', layer: draft.layer, area: 0, associative: false, boundary: [] };
    place(handle, draft, found ? undefined : unfollowed);
  }
  return { status: 'applied', handles: added.sort(compareHandles) };
}
