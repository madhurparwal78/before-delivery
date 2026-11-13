import type { ExposedParameter, LabBundle } from './api.js';
import { canonicalJson, type Json } from './canonical.js';
import { findSpec } from './params.js';
import { documentToJson, SOLVER, type SceneDocument } from './scene.js';
import { sha256HexOfText, utf8 } from './sha256.js';
import type { AssetKind } from './uploads.js';

export interface BundleAssetSource {
  assetId: string;
  kind: AssetKind;
  scaleToMetres: number | null;
  sha256: string;
}

export const MAX_EXPOSED = 8;

/** The unit shown beside a lab slider, taken from the parameter label. */
export function unitFromLabel(label: string): string {
  const match = /\(([^)]+)\)/.exec(label);
  return match ? match[1] : '';
}

export function buildBundle(input: {
  checkpointId: string;
  document: SceneDocument;
  exposed: readonly string[];
  assets: readonly BundleAssetSource[];
}): { bundle: LabBundle; bytes: Uint8Array; bundleHash: string } {
  const usedAssetIds = new Set(
    input.document.objects
      .filter((object) => object.kind === 'model' && object.assetId !== null)
      .map((object) => object.assetId as string),
  );
  const assets = input.assets
    .filter((asset) => usedAssetIds.has(asset.assetId))
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0))
    .map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      scaleToMetres: asset.scaleToMetres,
      sha256: asset.sha256,
    }));

  const bundle: LabBundle = {
    assets,
    bundleVersion: 1,
    checkpointId: input.checkpointId,
    document: input.document,
    exposed: [...input.exposed],
    solver: { iterations: SOLVER.iterations, step: SOLVER.step },
  };
  const text = canonicalJson({
    assets: assets as unknown as Json,
    bundleVersion: 1,
    checkpointId: input.checkpointId,
    document: documentToJson(input.document),
    exposed: [...input.exposed],
    solver: { iterations: SOLVER.iterations, step: SOLVER.step },
  } as Json);
  return { bundle, bytes: utf8(text), bundleHash: sha256HexOfText(text) };
}

/** The sliders a lab shows, in the order the owner's keys were recorded. */
export function exposedParameters(
  document: SceneDocument,
  exposed: readonly string[],
): ExposedParameter[] {
  const parameters: ExposedParameter[] = [];
  for (const key of exposed) {
    const separator = key.lastIndexOf('.');
    if (separator < 0) continue;
    const objectId = key.slice(0, separator);
    const paramKey = key.slice(separator + 1);
    const object = document.objects.find((candidate) => candidate.id === objectId);
    if (!object) continue;
    const spec = findSpec(object.kind, paramKey);
    if (!spec) continue;
    parameters.push({
      key,
      label: `${object.name}: ${spec.label}`,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      unit: unitFromLabel(spec.label),
      value: object.params[paramKey],
    });
  }
  return parameters;
}

/** The keys a publish may expose: every rig parameter of the checkpoint document. */
export function exposableKeys(document: SceneDocument): string[] {
  const keys: string[] = [];
  for (const object of document.objects)
    for (const key of Object.keys(object.params)) keys.push(`${object.id}.${key}`);
  return keys;
}
