import type { BlockDef, Entity, Layer, Xref } from './model.js';

export interface SheetAttributes {
  [tag: string]: string;
}

export interface ViewportSnapshot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: string;
  view_x: number;
  view_y: number;
  frozen_layers: string[];
}

export interface SheetSnapshot {
  id: string;
  name: string;
  size: 'A3' | 'A4';
  number: number;
  attributes: SheetAttributes;
  viewports: ViewportSnapshot[];
  creator: string;
}

export interface XrefSnapshot extends Xref {
  entities: Entity[];
  layers: Layer[];
  latest_version: number | null;
}

export interface VersionSnapshot {
  sheet: SheetSnapshot;
  model: {
    layers: Layer[];
    entities: Entity[];
    blocks: BlockDef[];
    xrefs: XrefSnapshot[];
  };
}

/** Every entity of a snapshot by its compare id: the handle, or <xref name>|<handle>. */
export function snapshotEntities(snapshot: VersionSnapshot): { id: string; entity: Entity; block?: BlockDef }[] {
  const out: { id: string; entity: Entity; block?: BlockDef }[] = [];
  for (const entity of snapshot.model.entities) {
    const block =
      entity.type === 'insert' ? snapshot.model.blocks.find((candidate) => candidate.name === entity.block) : undefined;
    out.push({ id: entity.handle, entity, block });
  }
  for (const xref of snapshot.model.xrefs) {
    for (const entity of xref.entities) {
      out.push({ id: `${xref.name}|${entity.handle}`, entity });
    }
  }
  return out;
}
