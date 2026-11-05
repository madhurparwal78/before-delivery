import { isGlb, parseGlb, extractMesh, meshBounds, type Mesh, type Box, scaleMesh, mergeMeshes, buildBoxMesh, buildCylinderMesh } from './glb.js';
import { isZip, readZip, pathEscapes } from './zip.js';
import { ApiError } from '../errors.js';
import type { PackageKind, Plan } from '../domain/plans.js';

export interface LoadedModel {
  mesh: Mesh; // in source units, Y up
  box: Box;
}

export type PackageType = 'glb' | 'gltf-package';

/** The single place that judges a package by its bytes. */
export function detectPackageType(data: Buffer, filename: string): PackageType {
  if (isGlb(data)) return 'glb';
  if (isZip(data)) return 'gltf-package';
  if (filename.toLowerCase().endsWith('.glb')) {
    throw new ApiError(415, 'content_mismatch');
  }
  throw new ApiError(415, 'unsupported_type');
}

export function checkPackageAccepted(type: PackageType, plan: Plan): void {
  if (!plan.packages.includes(type)) {
    throw new ApiError(415, 'type_not_in_plan');
  }
}

/** Loads a package into a mesh in source units, after the type and plan checks passed. */
export function loadPackage(data: Buffer, type: PackageType): LoadedModel {
  if (type === 'glb') {
    const parsed = parseGlb(data);
    const mesh = extractMesh(parsed);
    const box = meshBounds(mesh);
    assertNonZeroBox(box);
    return { mesh, box };
  }
  const entries = readZip(data);
  for (const entry of entries) {
    if (pathEscapes(entry.name)) {
      throw new ApiError(422, 'validation_failed', undefined, { file: 'The package contains a path outside its folder.' });
    }
  }
  const gltfEntries = entries.filter(entry => entry.name.toLowerCase().endsWith('.gltf'));
  if (gltfEntries.length !== 1) {
    throw new ApiError(422, 'validation_failed', undefined, { file: 'A glTF package needs exactly one .gltf file and every file it references.' });
  }
  const gltfJson = JSON.parse(gltfEntries[0]!.data.toString('utf8')) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  const referenced = [
    ...(gltfJson.buffers ?? []).map(buffer => buffer.uri),
    ...(gltfJson.images ?? []).map(image => image.uri),
  ].filter((uri): uri is string => typeof uri === 'string' && !uri.startsWith('data:'));
  const entryNames = new Set(entries.map(entry => entry.name));
  for (const uri of referenced) {
    if (!entryNames.has(uri)) {
      throw new ApiError(422, 'validation_failed', undefined, { file: 'A glTF package needs exactly one .gltf file and every file it references.' });
    }
  }
  const mesh = meshFromPackage(gltfEntries[0]!.data, entries);
  const box = meshBounds(mesh);
  assertNonZeroBox(box);
  return { mesh, box };
}

function meshFromPackage(gltfData: Buffer, entries: { name: string; data: Buffer }[]): Mesh {
  const json = JSON.parse(gltfData.toString('utf8')) as Record<string, unknown>;
  const binaryRef = ((json.buffers as { uri?: string }[] | undefined) ?? [])
    .map(buffer => buffer.uri)
    .find((uri): uri is string => typeof uri === 'string' && !uri.startsWith('data:'));
  const gltfBinary = binaryRef !== undefined ? entries.find(entry => entry.name === binaryRef)?.data ?? null : null;
  let parsedBinary: Buffer | null = gltfBinary;
  if (gltfBinary === null) {
    const dataUri = ((json.buffers as { uri?: string }[] | undefined) ?? [])
      .map(buffer => buffer.uri)
      .find((uri): uri is string => typeof uri === 'string' && uri.startsWith('data:'));
    if (dataUri !== undefined && dataUri.startsWith('data:application/octet-stream;base64,')) {
      parsedBinary = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
    }
  }
  const mesh = extractMesh({ json, binary: parsedBinary });
  return mesh;
}

function assertNonZeroBox(box: Box): void {
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  if (size[0] === 0 || size[1] === 0 || size[2] === 0) {
    throw new ApiError(422, 'validation_failed', undefined, { file: 'Unknown field.' });
  }
}

export const UNIT_FACTORS: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
};

/** Procedural seed geometry: box and cylinder composites matching stated dimensions. */
export function seedMeshFor(dimensions: { width: number; height: number; depth: number }, kind: 'lantern' | 'warden' | 'plain' | 'filler'): { mesh: Mesh; box: Box } {
  const { width, height, depth } = dimensions;
  if (kind === 'lantern') {
    const body = buildBoxMesh(width * 0.6, height * 0.55, depth * 0.6, { x: 0, y: height * 0.06, z: 0 });
    const handle = buildCylinderMesh(width * 0.22, height * 0.22, { x: 0, y: height * 0.5, z: 0 }, 12);
    const base = buildBoxMesh(width, height * 0.18, depth, { x: 0, y: -height * 0.32, z: 0 });
    const mesh = mergeMeshes([body, handle, base]);
    return { mesh, box: meshBounds(mesh) };
  }
  if (kind === 'warden') {
    const body = buildCylinderMesh(width * 0.5, height * 0.6, { x: 0, y: height * 0.12, z: 0 }, 14);
    const base = buildBoxMesh(width, height * 0.25, depth, { x: 0, y: -height * 0.38, z: 0 });
    const mesh = mergeMeshes([body, base]);
    return { mesh, box: meshBounds(mesh) };
  }
  if (kind === 'filler') {
    const body = buildBoxMesh(width * 0.7, height * 0.7, depth * 0.7);
    const detail = buildCylinderMesh(width * 0.2, height * 0.5, { x: width * 0.3, y: 0, z: 0 }, 10);
    const mesh = mergeMeshes([body, detail]);
    return { mesh, box: meshBounds(mesh) };
  }
  const mesh = buildBoxMesh(width, height, depth);
  return { mesh, box: meshBounds(mesh) };
}

/** Build the metre-scale GLB mesh from a source-unit mesh. */
export function glbMeshFromSource(loaded: LoadedModel, unit: string): { mesh: Mesh; box: Box } {
  const factor = UNIT_FACTORS[unit] ?? 1;
  const mesh = scaleMesh(loaded.mesh, factor);
  return { mesh, box: meshBounds(mesh) };
}

/** Structural package checks at upload time: entry paths and package contents. */
export function checkPackageStructure(data: Buffer, type: PackageType): void {
  if (type !== 'gltf-package') return;
  const entries = readZip(data);
  for (const entry of entries) {
    if (pathEscapes(entry.name)) {
      throw new ApiError(422, 'validation_failed', undefined, {
        file: 'The package contains a path outside its folder.',
      });
    }
  }
  const gltfEntries = entries.filter(entry => entry.name.toLowerCase().endsWith('.gltf'));
  if (gltfEntries.length !== 1) {
    throw new ApiError(422, 'validation_failed', undefined, {
      file: 'A glTF package needs exactly one .gltf file and every file it references.',
    });
  }
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    json = JSON.parse(gltfEntries[0]!.data.toString('utf8')) as typeof json;
  } catch {
    throw new ApiError(422, 'validation_failed', undefined, {
      file: 'A glTF package needs exactly one .gltf file and every file it references.',
    });
  }
  const names = new Set(entries.map(entry => entry.name));
  const referenced = [
    ...(json.buffers ?? []).map(buffer => buffer.uri),
    ...(json.images ?? []).map(image => image.uri),
  ].filter((uri): uri is string => typeof uri === 'string' && !uri.startsWith('data:'));
  for (const uri of referenced) {
    if (!names.has(uri)) {
      throw new ApiError(422, 'validation_failed', undefined, {
        file: 'A glTF package needs exactly one .gltf file and every file it references.',
      });
    }
  }
}
