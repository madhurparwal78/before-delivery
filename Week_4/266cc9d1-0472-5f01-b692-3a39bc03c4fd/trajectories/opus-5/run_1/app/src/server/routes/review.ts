import { Router } from "express";
import { LIMITS } from "../config.js";
import { notFound } from "../errors.js";
import { defineRoute } from "../http.js";
import type { ReviewAuth } from "../auth.js";
import { corridorGeometry, corridorPayload, findCorridor, listTowers, towerPayload } from "../domain/corridors.js";
import { activeAssets, findAsset } from "../domain/assets.js";
import { corridorCoverage } from "../domain/flight.js";
import { findFinding, findingPayload, listFindings } from "../domain/findings.js";
import {
  completeReview,
  markUnderReview,
  setPayload,
  storeDecision,
  validateDecision,
} from "../domain/sets.js";
import { attemptDelivery } from "../services/mail.js";
import { queryOne } from "../db.js";
import { answerFlight } from "./corridors.js";
import { readAssetFile } from "./files.js";

export const reviewRouter = Router();

/** A link reads only its own set, that set's corridor and that corridor's assets. */
async function linkCorridor(auth: ReviewAuth) {
  const corridor = await findCorridor(auth.set.corridor_id);
  if (!corridor) throw notFound();
  return corridor;
}

reviewRouter.get(
  "/review/:token",
  defineRoute({
    auth: "review",
    async handle({ auth }) {
      await markUnderReview(auth.set.id);
      const corridor = await linkCorridor(auth);
      const set = (await queryOne<typeof auth.set>(
        "SELECT * FROM findings_sets WHERE id = $1",
        [auth.set.id],
      ))!;
      const contractor = await queryOne<{ name: string }>(
        "SELECT name FROM tenants WHERE id = $1",
        [set.tenant_id],
      );
      const findings = await listFindings(set.id);
      return {
        status: 200,
        body: {
          set: await setPayload(set, { includeLink: false }),
          corridor: await corridorPayload(corridor),
          towers: towerPayload(await listTowers(corridor.id)),
          active_assets: await activeAssets(corridor.id),
          coverage: await corridorCoverage(corridor.id),
          findings: findings.map(findingPayload),
          contractor: { name: contractor?.name ?? "" },
          expires_at: auth.link.expires_at.toISOString(),
          read_only: set.state !== "submitted" && set.state !== "under_review",
        },
      };
    },
  }),
);

reviewRouter.put(
  "/review/:token/findings/:findingId/decision",
  defineRoute({
    auth: "review",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    async load({ params, auth }) {
      const finding = await findFinding(params.findingId);
      if (!finding || finding.set_id !== auth.set.id) throw notFound();
      return finding;
    },
    async handle({ auth, body }, finding) {
      const input = validateDecision(body);
      const stored = await storeDecision(auth.set, finding.id, input);
      return {
        status: 200,
        body: {
          decision: { finding_id: finding.id, decision: stored.decision, note: stored.note },
        },
      };
    },
  }),
);

reviewRouter.post(
  "/review/:token/complete",
  defineRoute({
    auth: "review",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    idempotencyRoute: "complete",
    async handle({ auth }) {
      const corridor = await linkCorridor(auth);
      const result = await completeReview(auth.set, corridor);
      if (result.emailId) await attemptDelivery(result.emailId);
      return {
        status: 200,
        body: {
          set: await setPayload(result.set, { includeLink: false }),
          summary: result.summary,
        },
      };
    },
  }),
);

reviewRouter.get(
  "/review/:token/flight",
  defineRoute({
    auth: "review",
    async handle({ auth, req }) {
      const corridor = await linkCorridor(auth);
      const geometry = await corridorGeometry(corridor);
      return {
        status: 200,
        body: await answerFlight(corridor.id, geometry, req.query as Record<string, unknown>),
      };
    },
  }),
);

reviewRouter.get(
  "/review/:token/assets/:assetId/files/*",
  defineRoute({
    auth: "review",
    async load({ params, auth }) {
      const asset = await findAsset(params.assetId);
      if (!asset || asset.corridor_id !== auth.set.corridor_id) throw notFound();
      return asset;
    },
    handle: ({ req, params }, asset) => readAssetFile(asset, params["0"], req),
  }),
);
