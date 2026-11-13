import {
  extrusionBox,
  extrusionTriangles,
  meshTriangles,
  primitiveHalfExtents,
  primitiveMesh,
  textCells,
  textWidth,
  type Box,
  type ExtrusionShape,
} from '../geometry';
import { presetModel } from '../presets';
import { vec, type Transform } from '../projection';
import { MODEL_PRESETS, PRIMITIVES, type AssetInfo, type Json, type ModelPreset, type ModelSummary, type OutlinePoint, type Primitive, type Vec3 } from '../types';
import { bool, num, str, type ResolvedLayer } from './resolve';

export type Assets = ReadonlyMap<string, AssetInfo>;

const CUBE_CORNERS = ['+x +y +z', '-x +y +z', '+x -y +z', '-x -y +z', '+x +y -z', '-x +y -z', '+x -y -z', '-x -y -z'] as const;
const PLANE_CORNERS = ['+x +y', '-x +y', '+x -y', '-x -y'] as const;

export function transformOf(values: Record<string, Json>): Transform {
  return {
    position: vec(num(values, 'position.x'), num(values, 'position.y'), num(values, 'position.z')),
    rotation: vec(num(values, 'rotation.x'), num(values, 'rotation.y'), num(values, 'rotation.z')),
    scale: vec(num(values, 'scale.x', 1), num(values, 'scale.y', 1), num(values, 'scale.z', 1)),
  };
}

export const primitiveOf = (values: Record<string, Json>): Primitive => {
  const name = str(values, 'primitive', 'Cube');
  return (PRIMITIVES as readonly string[]).includes(name) ? (name as Primitive) : 'Cube';
};

export function modelSummaryOf(values: Record<string, Json>, assets: Assets): ModelSummary | null {
  const assetId = values['modelAssetId'];
  if (typeof assetId === 'string') return assets.get(assetId)?.model ?? null;
  const preset = str(values, 'preset');
  return (MODEL_PRESETS as readonly string[]).includes(preset) ? presetModel(preset as ModelPreset).summary : null;
}

interface ExtrusionInfo {
  shape: ExtrusionShape;
  box: Box;
  triangles: number;
  /** Z of the front face. */
  front: number;
}

export function extrusionOf(values: Record<string, Json>, assets: Assets): ExtrusionInfo | null {
  const depth = num(values, 'depth', 0.2);
  const bevelSize = num(values, 'bevelSize');
  const bevelSegments = Math.round(num(values, 'bevelSegments', 1));
  const front = depth / 2 + bevelSize;
  if (str(values, 'source', 'text') === 'text') {
    const text = str(values, 'text');
    const height = num(values, 'letterHeight', 1);
    const shape = { outlines: textCells(text, height).map((c) => c.outline), depth, bevelSize, bevelSegments };
    return { shape, box: extrusionBox(textWidth(text, height), height, depth, bevelSize), triangles: extrusionTriangles(shape), front };
  }
  const assetId = values['svgAssetId'];
  const outline: OutlinePoint[] | null = typeof assetId === 'string' ? (assets.get(assetId)?.outline ?? null) : null;
  if (!outline) return null;
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const shape = { outlines: [outline], depth, bevelSize, bevelSegments };
  const box = extrusionBox(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), depth, bevelSize);
  return { shape, box, triangles: extrusionTriangles(shape), front };
}

interface Extent {
  min: Vec3;
  max: Vec3;
}

/** The local bounding box of a solid layer. */
export function extentOf(layer: ResolvedLayer, assets: Assets): Extent | null {
  const { values } = layer;
  switch (layer.layer.kind) {
    case 'Primitive': {
      const h = primitiveHalfExtents(primitiveOf(values));
      return { min: vec(-h.x, -h.y, -h.z), max: h };
    }
    case 'Extrusion': {
      const info = extrusionOf(values, assets);
      return info ? { min: vec(-info.box.width / 2, -info.box.height / 2, -info.box.depth / 2), max: vec(info.box.width / 2, info.box.height / 2, info.box.depth / 2) } : null;
    }
    case 'Model':
      return modelSummaryOf(values, assets)?.bounds ?? null;
    case 'Cloth': {
      const columns = num(values, 'columns', 10);
      const rows = num(values, 'rows', 10);
      return { min: vec(-((columns - 1) * 0.05), -(rows - 1) * 0.1, -0.01), max: vec((columns - 1) * 0.05, 0, 0.01) };
    }
    default:
      return null;
  }
}

const sign = (flag: boolean): number => (flag ? 1 : -1);

/** The chosen corner of a box, in cube corner order. */
function cornerOf(extent: Extent, index: number): Vec3 {
  return vec(
    index % 2 === 0 ? extent.max.x : extent.min.x,
    Math.floor(index / 2) % 2 === 0 ? extent.max.y : extent.min.y,
    index < 4 ? extent.max.z : extent.min.z,
  );
}

interface NamedPoint {
  name: string;
  point: Vec3;
}

/** The points the `Vertex` combobox offers for a layer, in the brief's order. */
export function vertexList(layer: ResolvedLayer, assets: Assets): NamedPoint[] {
  const { values } = layer;
  if (layer.layer.kind === 'Primitive' && primitiveOf(values) === 'Plane') {
    return PLANE_CORNERS.map((name) => ({ name, point: vec(sign(name.startsWith('+')) * 0.5, sign(name.includes('+y')) * 0.5, 0) }));
  }
  if (layer.layer.kind === 'Extrusion' && str(values, 'source', 'text') === 'svg') {
    const info = extrusionOf(values, assets);
    const outline = info?.shape.outlines[0];
    if (!info || !outline) return [];
    const first = outline[0] as OutlinePoint;
    const last = outline[outline.length - 1] as OutlinePoint;
    return [
      { name: 'Outline 1', point: vec(first[0], first[1], info.front) },
      { name: `Outline ${outline.length}`, point: vec(last[0], last[1], info.front) },
    ];
  }
  const extent = extentOf(layer, assets);
  if (!extent || layer.layer.kind === 'Cloth') return [];
  return CUBE_CORNERS.map((name, index) => ({ name, point: cornerOf(extent, index) }));
}

export function triangleCount(layer: ResolvedLayer, assets: Assets): number | null {
  const { values } = layer;
  switch (layer.layer.kind) {
    case 'Primitive':
      return meshTriangles(primitiveMesh(primitiveOf(values)));
    case 'Extrusion':
      return extrusionOf(values, assets)?.triangles ?? null;
    case 'Model':
      return modelSummaryOf(values, assets)?.triangles ?? null;
    case 'Cloth':
      return (num(values, 'columns', 10) - 1) * (num(values, 'rows', 10) - 1) * 2;
    default:
      return null;
  }
}

export const isGlass = (values: Record<string, Json>): boolean => str(values, 'material.kind', 'Matcap') === 'Glass';

/** Glass with back-face refraction always draws both sides. */
export function drawsBothSides(values: Record<string, Json>): boolean {
  return str(values, 'faces', 'front') === 'both' || (isGlass(values) && bool(values, 'material.backFaceRefraction'));
}

export function glassIor(values: Record<string, Json>): number {
  return 1 + 0.25 * num(values, 'material.refraction', 1);
}
