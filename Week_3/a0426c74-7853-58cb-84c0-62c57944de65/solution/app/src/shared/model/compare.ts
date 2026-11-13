// Publishing and comparing: the snapshot of a sheet version, and the compare counts and markup flags between two models.
import { compareHandles, diffModels, markupFlags } from '../geometry/index.ts';
import type { CompareResult, DrawingState, Markup, ModelSnapshot, Sheet, VersionSnapshot } from '../types.ts';

export function buildSnapshot(state: DrawingState, sheet: Sheet): VersionSnapshot {
  return {
    sheet,
    model: {
      layers: Object.values(state.layers),
      entities: Object.values(state.entities).sort((a, b) => compareHandles(a.handle, b.handle)),
      blocks: Object.values(state.blocks),
      xrefs: Object.values(state.xrefs),
    },
  };
}

export function compareModels(earlier: ModelSnapshot, later: ModelSnapshot): CompareResult {
  return diffModels(earlier, later).result;
}

export function flagMarkups(markups: readonly Pick<Markup, 'x1' | 'y1' | 'x2' | 'y2'>[], earlier: ModelSnapshot, later: ModelSnapshot): Markup['flag'][] {
  return markupFlags(markups, diffModels(earlier, later));
}
