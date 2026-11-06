// Media: uploads, search, reads, deletion and lineage.

import { allow, authenticate } from "../auth";
import { pool } from "../db";
import { lineage, projectAssets, readAsset, searchAssets } from "../domain/assets";
import { currentPolicy } from "../domain/policy";
import { storeUpload } from "../domain/submission";
import { fail, invalid } from "../errors";
import { json, noContent, route } from "../http";
import { markStorageDown, storageDown } from "../services/status";
import { deleteObject, StorageUnavailable } from "../services/storage";

route("POST", "/api/uploads", "image", async (req) => {
  const caller = await authenticate(req);
  allow(caller, "member");
  const image = req.image as NonNullable<typeof req.image>;
  if (storageDown()) fail("storage_unavailable");
  const policy = await currentPolicy(pool);
  const id = await storeUpload(caller, image.type, image.bytes, policy);
  const readable = await readAsset(pool, caller, id, policy, new Date());
  const [asset] = await projectAssets(pool, caller, policy, [readable]);
  return json(201, { asset });
});

route("GET", "/api/assets", "none", async (req) => {
  const caller = await authenticate(req);
  const kind = req.query.get("kind");
  if (kind !== null && kind !== "upload" && kind !== "output") invalid({ kind: "Choose upload or output." });
  const policy = await currentPolicy(pool);
  const found = await searchAssets(pool, caller, policy, {
    q: req.query.get("q") ?? "",
    kind,
    model: req.query.get("model"),
    team: req.query.get("team"),
  }, new Date());
  return json(200, { assets: await projectAssets(pool, caller, policy, found) });
});

route("GET", "/api/assets/{id}", "none", async (req) => {
  const caller = await authenticate(req);
  const policy = await currentPolicy(pool);
  const readable = await readAsset(pool, caller, req.params.id, policy, new Date());
  const [asset] = await projectAssets(pool, caller, policy, [readable]);
  return json(200, { asset });
});

route("DELETE", "/api/assets/{id}", "none", async (req) => {
  const caller = await authenticate(req);
  const policy = await currentPolicy(pool);
  const { asset } = await readAsset(pool, caller, req.params.id, policy, new Date(), () => allow(caller, "compliance", "admin"));
  try {
    await deleteObject(asset.object_key);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    markStorageDown();
    fail("storage_unavailable");
  }
  const removed = await pool.query(
    "UPDATE assets SET removed_at = now(), object_removed = true WHERE id = $1 AND removed_at IS NULL RETURNING removed_at", [asset.id]);
  // A concurrent delete won: answer as for any gone asset.
  if (removed.rowCount === 0) await readAsset(pool, caller, asset.id, policy, new Date());
  return noContent;
});

route("GET", "/api/assets/{id}/lineage", "none", async (req) => {
  const caller = await authenticate(req);
  const policy = await currentPolicy(pool);
  const now = new Date();
  const { asset } = await readAsset(pool, caller, req.params.id, policy, now);
  return json(200, await lineage(pool, caller, policy, asset, now));
});
