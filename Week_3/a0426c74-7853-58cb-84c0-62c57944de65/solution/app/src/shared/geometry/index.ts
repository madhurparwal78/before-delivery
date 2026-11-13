// The pure geometry layer: scene, snaps, picking, grips, modify results, hatch, dimensions, expressions, constraints,
// xref and block transforms, rendering to SvgNode trees, sheets and compare. No DOM, no node:*; used by server and browser.
//
// Conventions
// - World units have Y up. Screen X = world X * zoom + panX, screen Y = -world Y * zoom + panY (`View`).
// - Every function returns stored numbers already rounded to 6 decimals (half away from zero); display strings use fmt3 / fmtAngle / fmtFixed.
// - An `Entity` handed to a function is a world-space entity. Model entities are the stored ones; xref entities are the transformed copies
//   held in `SceneEntity.entity` (handle = `Site|L1`, layer = `Site|Walls`).
// - `SceneEntity` objects are replaced (new identity) whenever anything about them changes, so a view may memoise by identity.
export { SOLVE_TOL, TOL, clamp, compareHandles, distance, fmt3, fmtAngle, fmtData, handleNumber, isOptimisticHandle, measureDistance, midpoint, normalizeAngle, optimisticHandle, pointAtAngle, round6, roundPoint } from './numbers.ts';

export type { Size, PinchStart, View } from './view.ts';
export { panToReveal, pinchView, screenToWorld, wheelZoom, worldToScreen, zoomAllView } from './view.ts';

export type { Scene, SceneEntity, SceneInput } from './scene.ts';
export { arcSweep, rectBetween, rectsMeet, unionRect } from './curves.ts';
export { outlineBox } from './prims.ts';
export { buildScene, domEntities, findEntities, modelInput, updateScene } from './scene.ts';
export { STANDARD_DIM_STYLE } from './dimension.ts';
export { XREF_SEPARATOR, isXrefId } from './xref.ts';
export { explodeInsert, findBlockCycle } from './transform.ts';

export { areaOf, distReport, entityLabel, propertyText, xrefRow } from './measure.ts';

export type { DraftingAids, ResolvedPointer, SnapCandidate, SnapKind } from './snap.ts';
export { SNAP_APERTURE_PX, resolvePointer } from './snap.ts';
export type { WindowMode } from './pick.ts';
export { pickEntity, selectInWindow, windowMode } from './pick.ts';

export type { Grip } from './grips.ts';
export { dragGrip, gripsOf } from './grips.ts';

export type { ModifyResult, Refusal } from './modify.ts';
export { isRefusal } from './modify.ts';
export type { Transform } from './transform.ts';
export { changedFields, transformEntity } from './transform.ts';
export { extend, trim } from './trim.ts';
export { chamfer, fillet } from './fillet.ts';
export { offsetEntity, polarArray, rectangularArray } from './offset.ts';

export { findHatch } from './hatch.ts';

export { dimensionStyle, dimensionValue, linkDimensionPoint } from './dimension.ts';

export { evaluateExpression, evaluateParameters, isParameterName } from './expression.ts';
export type { SolveInput } from './constraints.ts';
export { constraintLabel, solveConstraints } from './constraints.ts';

export type { DiffState, SvgNode } from './render.ts';
export { arcPath, modelSvg, renderDefs, renderEntity } from './render.ts';

export { PAPER_SIZES, sheetNode, sheetSvg, titleBlockFields } from './sheet.ts';

export { diffModels, markupFlags } from './compare.ts';
