// Owner asset routes: list, derivatives, release, restrict, retire (brief: Queue and assets).
import {
  addDerivative, adminAssets, assertDraft, assertTransition, findAsset, findDerivative, releaseFailures, removeDerivative, sizeContractError,
  type AssetAction, type AssetRow,
} from "../assetCatalog.ts";
import { read, transaction, type Tx } from "../db.ts";
import { refuse } from "../denial.ts";
import { ApiError, STORAGE_MESSAGES, forbidden, notFound, storageUnavailable, tooLarge } from "../errors.ts";
import { created, noContent, ok, type Ctx, type Router, type Reply } from "../http.ts";
import { StorageUnavailable } from "../storage.ts";
import { rejectOpenRequestsOnAsset } from "../requestWorkflow.ts";
import { DERIVATIVE_MAX_BYTES } from "../../shared/domain.ts";
import type { AdminAsset } from "../../shared/api.ts";

const UPLOAD_CEILING = DERIVATIVE_MAX_BYTES + 65_536;

/** Owner-only routes: every existing id is visible, so an unknown id is 404 and a wrong role 403. */
async function ownerAsset(ctx: Ctx, action: AssetAction | null): Promise<AssetRow> {
  const principal = ctx.user();
  const asset = await read((tx) => findAsset(tx, ctx.params.id));
  if (!asset) throw notFound();
  if (principal.role !== "owner") {
    if (action === null) throw forbidden();
    return refuse({
      actorId: principal.id,
      actorRole: principal.role,
      action: action === "release" ? "asset.released" : action === "restrict" ? "asset.restricted" : "asset.retired",
      resourceType: "asset",
      resourceId: asset.id,
      requestId: null,
    });
  }
  return asset;
}

const storageDown = (error: unknown): never => {
  if (error instanceof StorageUnavailable) throw storageUnavailable(STORAGE_MESSAGES.release);
  throw error;
};

async function listAssets(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  if (principal.role !== "owner") throw notFound();
  return ok({ assets: await read(adminAssets) });
}

async function uploadDerivative(ctx: Ctx): Promise<Reply> {
  const asset = await ownerAsset(ctx, null);
  const upload = await ctx.upload(UPLOAD_CEILING);
  return transaction(async (tx) => {
    const current = (await findAsset(tx, asset.id, true))!;
    const variant = upload?.fields.variant || null;
    if (variant !== null && !(await tx.one("SELECT 1 FROM variants WHERE asset_id = $1 AND key = $2", [current.id, variant]))) throw notFound();
    assertDraft(current);
    if (upload?.fields.exceeded) throw tooLarge();
    if (!upload) throw new ApiError(422, "derivative_type", "Derivative must be a PNG or SVG file.");
    try {
      return created(await addDerivative(tx, current, variant, upload.fileName, upload.bytes));
    } catch (error) {
      return storageDown(error);
    }
  });
}

async function deleteDerivative(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const derivative = await read((tx) => findDerivative(tx, ctx.params.id));
  if (!derivative) throw notFound();
  if (principal.role !== "owner") throw forbidden();
  try {
    await transaction((tx) => removeDerivative(tx, derivative));
  } catch (error) {
    storageDown(error);
  }
  return noContent();
}

async function release(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const asset = await ownerAsset(ctx, "release");
  return transaction(async (tx) => {
    const current = (await findAsset(tx, asset.id, true))!;
    assertTransition(current, "release");
    let failures: string[];
    try {
      failures = await releaseFailures(tx, current);
    } catch (error) {
      return storageDown(error);
    }
    if (failures.length > 0) throw sizeContractError(failures);
    await tx.q("UPDATE assets SET state = 'released' WHERE id = $1", [current.id]);
    tx.audit({
      actorId: principal.id, actorRole: principal.role, action: "asset.released", resourceType: "asset", resourceId: current.id,
      requestId: null, before: { state: current.state }, after: { state: "released" },
    });
    tx.live({ type: "library.updated" }, { all: true });
    return ok(await assetView(tx, current.id));
  });
}

async function restrict(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const asset = await ownerAsset(ctx, "restrict");
  return transaction(async (tx) => {
    const current = (await findAsset(tx, asset.id, true))!;
    assertTransition(current, "restrict");
    await tx.q("UPDATE assets SET state = 'restricted' WHERE id = $1", [current.id]);
    tx.audit({
      actorId: principal.id, actorRole: principal.role, action: "asset.restricted", resourceType: "asset", resourceId: current.id,
      requestId: null, before: { state: current.state }, after: { state: "restricted" },
    });
    tx.live({ type: "library.updated" }, { all: true });
    return ok(await assetView(tx, current.id));
  });
}

async function retire(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const asset = await ownerAsset(ctx, "retire");
  return transaction(async (tx) => {
    const current = (await findAsset(tx, asset.id, true))!;
    assertTransition(current, "retire");
    const body = await ctx.json();
    const successorId = typeof body.successorAssetId === "string" ? body.successorAssetId : null;
    const successor = successorId === null ? null : await findAsset(tx, successorId);
    if (successorId !== null && !successor) throw notFound();
    if (!successor || successor.state !== "released" || successor.id === current.id) {
      throw new ApiError(422, "successor_invalid", "Choose a released successor asset.");
    }
    await tx.q("UPDATE assets SET state = 'retired', successor_id = $2 WHERE id = $1", [current.id, successor.id]);
    tx.audit({
      actorId: principal.id, actorRole: principal.role, action: "asset.retired", resourceType: "asset", resourceId: current.id,
      requestId: null, before: { state: current.state }, after: { state: "retired", successor: successor.id },
    });
    await rejectOpenRequestsOnAsset(tx, current.id, successor.name);
    tx.live({ type: "library.updated" }, { all: true });
    return ok(await assetView(tx, current.id));
  });
}

async function assetView(tx: Tx, id: string): Promise<AdminAsset> {
  return (await adminAssets(tx)).find((a) => a.id === id)!;
}

export function registerAssets(router: Router): void {
  router.get("/api/admin/assets", listAssets);
  router.post("/api/assets/:id/derivatives", uploadDerivative);
  router.delete("/api/derivatives/:id", deleteDerivative);
  router.post("/api/assets/:id/release", release);
  router.post("/api/assets/:id/restrict", restrict);
  router.post("/api/assets/:id/retire", retire);
}
