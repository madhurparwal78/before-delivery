import { Hono } from "hono";
import { config } from "../config.ts";
import { clockNow } from "../clock.ts";
import { maybeOne, pool, transaction } from "../db.ts";
import { conflict, invalid, notFound, unavailable } from "../errors.ts";
import { isUuid } from "../ids.ts";
import { broadcast } from "../live.ts";
import { namespaceProofs, parseRowProof } from "../proofs.ts";
import { nodeOf, nodesOf, samplesOf, takeSample, verdictOf } from "../sampling.ts";
import { snapshotBytes, splitSquare } from "../square.ts";
import { getObject, putObject, storageReachable } from "../storage.ts";
import { blockDetail, blockOf, blockShares, blockSummaries } from "../views.ts";
import { read, requireWriter, write, type Scope } from "./context.ts";
import { checkNamespaceHex } from "../../shared/namespace.ts";
import { STORAGE_DOWN_SNAPSHOT } from "../../shared/copy.ts";
import { verifyRowProof } from "../../shared/nmt.ts";
import type { FraudProof } from "../../shared/api.ts";
import type { Context } from "hono";

export const chainRoutes = new Hono();

async function requireBlock(c: Context, scope: Scope, raw = c.req.param("height") ?? "") {
  const block = await blockOf(pool, scope.workspaceId, /^\d+$/.test(raw) ? Number(raw) : 0);
  if (!block) throw notFound();
  return block;
}

chainRoutes.get("/w/:id/blocks", read(async (c, scope) => c.json(await blockSummaries(pool, scope.workspaceId))));

chainRoutes.get(
  "/w/:id/blocks/:height",
  read(async (c, scope) => c.json(await blockDetail(pool, scope.workspaceId, await requireBlock(c, scope)))),
);

chainRoutes.get("/w/:id/blocks/:height/shares", read(async (c, scope) => c.json(blockShares(await requireBlock(c, scope)))));

chainRoutes.get(
  "/w/:id/blocks/:height/proofs",
  read(async (c, scope) => {
    const block = await requireBlock(c, scope);
    const checked = checkNamespaceHex(c.req.query("namespace") ?? "");
    if ("error" in checked) throw invalid("namespace", checked.error);
    return c.json({
      height: block.height,
      namespace: checked.hex,
      rows: namespaceProofs(splitSquare(block.square), block.k, block.rowRoots, checked.hex),
    });
  }),
);

chainRoutes.post(
  "/w/:id/blocks/:height/proofs/verify",
  write(async (c, scope, body) => {
    const block = await requireBlock(c, scope);
    const checked = checkNamespaceHex(typeof body.namespace === "string" ? body.namespace : "");
    if ("error" in checked) throw invalid("namespace", checked.error);
    const proof = parseRowProof(body.proof);
    const committed = proof ? block.rowRoots[proof.row] : undefined;
    if (!proof || !committed) throw invalid("proof", "Send one row entry of the namespace proof.");
    return c.json(verifyRowProof(proof, checked.hex, 2 * block.k, committed));
  }),
);

chainRoutes.get(
  "/w/:id/blocks/:height/fraud-proof",
  read(async (c, scope) => {
    const block = await requireBlock(c, scope);
    const stored = await maybeOne<{ proof: FraudProof }>(pool, "SELECT proof FROM fraud_proofs WHERE workspace_id = $1 AND height = $2", [scope.workspaceId, block.height]);
    if (!stored) throw notFound();
    return c.json(stored.proof);
  }),
);

chainRoutes.get(
  "/w/:id/blocks/:height/snapshot",
  read(async (c, scope) => {
    const block = await requireBlock(c, scope);
    const key = `squares/${scope.workspaceId}/${block.height}.bin`;
    let bytes = await getObject(key);
    if (!bytes) {
      if (!storageReachable()) throw unavailable(STORAGE_DOWN_SNAPSHOT);
      bytes = snapshotBytes(splitSquare(block.square), block.k, block.withheld);
      if (!(await putObject(key, bytes))) throw unavailable(STORAGE_DOWN_SNAPSHOT);
    }
    return c.body(Buffer.from(bytes), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="block-${block.height}-square.bin"`,
    });
  }),
);

chainRoutes.get("/w/:id/light-nodes", read(async (c, scope) => c.json(await nodesOf(pool, scope.workspaceId))));

async function requireNode(c: Context, scope: Scope) {
  const id = c.req.param("nodeId") ?? "";
  const node = isUuid(id) ? await nodeOf(pool, scope.workspaceId, id) : undefined;
  if (!node) throw notFound();
  return node;
}

chainRoutes.patch(
  "/w/:id/light-nodes/:nodeId",
  write(async (c, scope, body) => {
    const node = await requireNode(c, scope);
    requireWriter(scope);
    if (typeof body.autoSample !== "boolean") throw invalid("autoSample", "Choose on or off.");
    await pool.query("UPDATE light_nodes SET auto_sample = $2 WHERE id = $1", [node.id, body.autoSample]);
    broadcast(scope.workspaceId, { type: "changed" });
    return c.json({ ...node, autoSample: body.autoSample });
  }),
);

chainRoutes.get(
  "/w/:id/light-nodes/:nodeId/samples",
  read(async (c, scope) => {
    const node = await requireNode(c, scope);
    const block = await requireBlock(c, scope, c.req.query("height") ?? "");
    const samples = await samplesOf(pool, node.id, block.height);
    return c.json({
      height: block.height,
      k: block.k,
      samples,
      confidence: samples.at(-1)?.confidence ?? "0.0000",
      verdict: verdictOf(block.k, samples),
    });
  }),
);

chainRoutes.post(
  "/w/:id/light-nodes/:nodeId/samples",
  write(async (c, scope, body) => {
    const node = await requireNode(c, scope);
    const block = await requireBlock(c, scope, String(body.height ?? ""));
    requireWriter(scope);
    const taken = (await samplesOf(pool, node.id, block.height)).length;
    if (taken >= config.samplesPerBlock) {
      throw conflict(`Light node ${node.name} has already taken ${config.samplesPerBlock} samples of block ${block.height}.`);
    }
    const sample = await transaction((db, after) => takeSample(db, after, node, block.height, block, clockNow()));
    return c.json(sample, 201);
  }),
);
