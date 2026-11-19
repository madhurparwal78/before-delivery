// Asset lifecycle and derivatives: the state machine, the release checks and the derivative bookkeeping
// (brief: Business rules / Assets, Release).
import type { Tx } from "./db.ts";
import { ApiError, tooLarge, wrongState } from "./errors.ts";
import { contentTypeFor, detectFormat, inspectImage } from "./images.ts";
import { deleteObject, derivativeKey, objectSize, putObject } from "./storage.ts";
import { ASSET_CLASS_LABELS, DERIVATIVE_MAX_BYTES, SIZE_CONTRACTS, type AssetClass, type AssetState } from "../shared/domain.ts";
import type { AdminAsset } from "../shared/api.ts";

export interface AssetRow {
  id: string;
  name: string;
  class: AssetClass;
  state: AssetState;
  successor_id: string | null;
}

export type AssetAction = "release" | "restrict" | "retire";

const ALLOWED_FROM: Record<AssetAction, readonly AssetState[]> = {
  release: ["draft", "restricted"],
  restrict: ["released"],
  retire: ["released", "restricted"],
};

/** The one place asset transitions are decided; every other transition answers 409 `wrong_state`. */
export function assertTransition(asset: AssetRow, action: AssetAction): void {
  if (!ALLOWED_FROM[action].includes(asset.state)) throw wrongState(`${asset.name} is ${asset.state}.`);
}

export const findAsset = (tx: Tx, id: string, lock = false): Promise<AssetRow | undefined> =>
  tx.one<AssetRow>(`SELECT id, name, class, state, successor_id FROM assets WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);

export async function adminAssets(tx: Tx): Promise<AdminAsset[]> {
  const assets = await tx.q<AssetRow>("SELECT id, name, class, state, successor_id FROM assets ORDER BY position");
  const derivatives = await tx.q<{
    id: string; asset_id: string; variant: string | null; file_name: string; format: "png" | "svg"; width: number; height: number; byte_size: number;
  }>(
    `SELECT d.id, d.asset_id, v.key AS variant, d.file_name, d.format, d.width, d.height, d.byte_size
       FROM derivatives d LEFT JOIN variants v ON v.id = d.variant_id ORDER BY d.asset_id, d.position`,
  );
  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    class: a.class,
    state: a.state,
    successorId: a.successor_id,
    derivatives: derivatives
      .filter((d) => d.asset_id === a.id)
      .map((d) => ({ id: d.id, variant: d.variant, fileName: d.file_name, format: d.format, width: d.width, height: d.height, byteSize: d.byte_size })),
  }));
}

interface StoredDerivative {
  id: string;
  file_name: string;
  width: number;
  height: number;
  byte_size: number;
  variant_key: string | null;
}

const derivativesOf = (tx: Tx, assetId: string): Promise<StoredDerivative[]> =>
  tx.q<StoredDerivative>(
    `SELECT d.id, d.file_name, d.width, d.height, d.byte_size, v.key AS variant_key
       FROM derivatives d LEFT JOIN variants v ON v.id = d.variant_id WHERE d.asset_id = $1 ORDER BY d.position`,
    [assetId],
  );

/** One `size_contract` line per failing derivative, or none when the asset may be released. Throws 422 `no_derivatives`;
 * a storage transport failure is a StorageUnavailable for the caller to answer 503. */
export async function releaseFailures(tx: Tx, asset: AssetRow): Promise<string[]> {
  const derivatives = await derivativesOf(tx, asset.id);
  if (derivatives.length === 0) throw new ApiError(422, "no_derivatives", `Cannot release: ${asset.name} has no derivatives.`);
  const stored = await Promise.all(derivatives.map((d) => objectSize(derivativeKey(asset.id, d.variant_key, d.file_name))));
  const contract = SIZE_CONTRACTS[asset.class];
  const lines: string[] = [];
  derivatives.forEach((d, i) => {
    if (stored[i] !== d.byte_size) lines.push(`Cannot release: ${d.file_name} is missing from storage.`);
    else if (contract && (d.width !== contract[0] || d.height !== contract[1])) {
      lines.push(`Cannot release: ${d.file_name} is ${d.width} x ${d.height}; a ${ASSET_CLASS_LABELS[asset.class]} must be ${contract[0]} x ${contract[1]}.`);
    }
  });
  return lines;
}

export const sizeContractError = (lines: string[]): ApiError => new ApiError(422, "size_contract", lines.join("\n"));

/** Stores an uploaded derivative (replacing one with the same file name) and returns its row for the response. */
export async function addDerivative(
  tx: Tx,
  asset: AssetRow,
  variantKey: string | null,
  fileName: string,
  bytes: Buffer,
): Promise<{ id: string; fileName: string; format: "png" | "svg"; width: number; height: number; byteSize: number; variant: string | null }> {
  const notAnImage = new ApiError(422, "derivative_type", "Derivative must be a PNG or SVG file.");
  if (!detectFormat(bytes)) throw notAnImage;
  if (bytes.length > DERIVATIVE_MAX_BYTES) throw tooLarge();
  const image = inspectImage(bytes);
  if (!image) throw notAnImage;
  const variant = variantKey === null ? null : await tx.one<{ id: string }>("SELECT id FROM variants WHERE asset_id = $1 AND key = $2", [asset.id, variantKey]);
  const replaced = await tx.one<{ id: string; position: number }>(
    "SELECT id, position FROM derivatives WHERE asset_id = $1 AND variant_id IS NOT DISTINCT FROM $2 AND file_name = $3",
    [asset.id, variant?.id ?? null, fileName],
  );
  if (replaced) await tx.q("DELETE FROM derivatives WHERE id = $1", [replaced.id]);
  const n = await tx.next(`derivative:${asset.id}`);
  const id = `drv_${asset.id.slice("ast_".length)}_${n}`;
  const position = replaced?.position ?? n;
  await tx.q(
    `INSERT INTO derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, asset.id, variant?.id ?? null, fileName, image.format, image.width, image.height, bytes.length, position],
  );
  await putObject(derivativeKey(asset.id, variantKey, fileName), bytes, contentTypeFor(image.format));
  return { id, fileName, format: image.format, width: image.width, height: image.height, byteSize: bytes.length, variant: variantKey };
}

interface DerivativeRef {
  id: string;
  asset_id: string;
  file_name: string;
  variant_key: string | null;
}

export const findDerivative = (tx: Tx, id: string): Promise<DerivativeRef | undefined> =>
  tx.one<DerivativeRef>(
    "SELECT d.id, d.asset_id, d.file_name, v.key AS variant_key FROM derivatives d LEFT JOIN variants v ON v.id = d.variant_id WHERE d.id = $1",
    [id],
  );

/** Removes a derivative of a draft asset from the database and from storage; returns the file name. */
export async function removeDerivative(tx: Tx, derivative: DerivativeRef): Promise<string> {
  assertDraft((await findAsset(tx, derivative.asset_id, true))!);
  await tx.q("DELETE FROM derivatives WHERE id = $1", [derivative.id]);
  await deleteObject(derivativeKey(derivative.asset_id, derivative.variant_key, derivative.file_name));
  return derivative.file_name;
}

/** Derivatives change only while the asset is a draft. */
export function assertDraft(asset: AssetRow): void {
  if (asset.state !== "draft") throw wrongState(`${asset.name} is ${asset.state}.`);
}
