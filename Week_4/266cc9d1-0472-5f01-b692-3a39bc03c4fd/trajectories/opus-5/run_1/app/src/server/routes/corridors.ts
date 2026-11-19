import { Router } from "express";
import { LIMITS } from "../config.js";
import { FIELD_MESSAGES, notFound, validationFailed } from "../errors.js";
import { defineRoute, requireRole } from "../http.js";
import {
  corridorGeometry,
  corridorPayload,
  listCorridors,
  listTowers,
  requireTenantCorridor,
  towerPayload,
  type CorridorRow,
} from "../domain/corridors.js";
import {
  activeAssets,
  assetPayload,
  declareAsset,
  findAsset,
  listCorridorAssets,
  storeAssetFile,
  validateManifest,
} from "../domain/assets.js";
import {
  corridorCoverage,
  corridorSamples,
  positionAtChainage,
  positionAtTime,
  type FlightAnswer,
} from "../domain/flight.js";
import { readAssetFile } from "./files.js";
import type { CorridorGeometry } from "../../shared/corridor.js";

export const corridorRouter = Router();

/** Resolves a flight query, which must carry exactly one of chainage_m or time. */
export async function answerFlight(
  corridorId: string,
  geometry: CorridorGeometry,
  queryParams: Record<string, unknown>,
): Promise<FlightAnswer> {
  const rawChainage = queryParams.chainage_m;
  const rawTime = queryParams.time;
  const hasChainage = typeof rawChainage === "string" && rawChainage !== "";
  const hasTime = typeof rawTime === "string" && rawTime !== "";
  if (hasChainage === hasTime) {
    throw validationFailed({ query: FIELD_MESSAGES.flightQuery });
  }

  const samples = await corridorSamples(corridorId);

  if (hasChainage) {
    const chainageM = Number(rawChainage);
    if (!Number.isFinite(chainageM) || chainageM < 0 || chainageM > geometry.lengthM) {
      throw validationFailed({ chainage_m: FIELD_MESSAGES.chainage(geometry.lengthM) });
    }
    return positionAtChainage(samples, chainageM);
  }

  const timeMs = Date.parse(rawTime as string);
  if (!Number.isFinite(timeMs)) {
    throw validationFailed({ query: FIELD_MESSAGES.flightQuery });
  }
  return positionAtTime(samples, timeMs, geometry);
}

corridorRouter.get(
  "/corridors",
  defineRoute({
    auth: "staff",
    async handle({ auth }) {
      const corridors = await listCorridors(auth.staff.tenant_id);
      return {
        status: 200,
        body: { corridors: await Promise.all(corridors.map(corridorPayload)) },
      };
    },
  }),
);

corridorRouter.get(
  "/corridors/:id",
  defineRoute<"staff", CorridorRow>({
    auth: "staff",
    load: ({ params, auth }) => requireTenantCorridor(params.id, auth.staff.tenant_id),
    async handle(_context, corridor) {
      return {
        status: 200,
        body: {
          corridor: await corridorPayload(corridor),
          towers: towerPayload(await listTowers(corridor.id)),
          active_assets: await activeAssets(corridor.id),
          coverage: await corridorCoverage(corridor.id),
        },
      };
    },
  }),
);

corridorRouter.get(
  "/corridors/:id/flight",
  defineRoute<"staff", CorridorRow>({
    auth: "staff",
    load: ({ params, auth }) => requireTenantCorridor(params.id, auth.staff.tenant_id),
    async handle({ req }, corridor) {
      const geometry = await corridorGeometry(corridor);
      return {
        status: 200,
        body: await answerFlight(corridor.id, geometry, req.query as Record<string, unknown>),
      };
    },
  }),
);

corridorRouter.post(
  "/corridors/:id/assets",
  defineRoute<"staff", CorridorRow>({
    auth: "staff",
    bodyLimit: LIMITS.manifestBodyBytes,
    mutating: true,
    load: ({ params, auth }) => requireTenantCorridor(params.id, auth.staff.tenant_id),
    role: ({ auth }) =>
      requireRole(auth, "survey_processor", "Only the survey processor may declare assets."),
    async handle({ body, auth }, corridor) {
      const manifest = validateManifest(body);
      const asset = await declareAsset(
        auth.staff.tenant_id,
        corridor.id,
        manifest.kind,
        manifest.files,
      );
      return { status: 201, body: { asset: await assetPayload(asset) } };
    },
  }),
);

corridorRouter.get(
  "/corridors/:id/assets",
  defineRoute<"staff", CorridorRow>({
    auth: "staff",
    load: ({ params, auth }) => requireTenantCorridor(params.id, auth.staff.tenant_id),
    async handle(_context, corridor) {
      const assets = await listCorridorAssets(corridor.id);
      return { status: 200, body: { assets: await Promise.all(assets.map(assetPayload)) } };
    },
  }),
);

async function tenantAsset(assetId: string, tenantId: string) {
  const asset = await findAsset(assetId);
  if (!asset || asset.tenant_id !== tenantId) throw notFound();
  return asset;
}

corridorRouter.get(
  "/assets/:id",
  defineRoute({
    auth: "staff",
    load: ({ params, auth }) => tenantAsset(params.id, auth.staff.tenant_id),
    async handle(_context, asset) {
      return { status: 200, body: { asset: await assetPayload(asset) } };
    },
  }),
);

corridorRouter.put(
  "/assets/:id/files/*",
  defineRoute({
    auth: "staff",
    rawBody: true,
    bodyLimit: LIMITS.fileBodyBytes,
    mutating: true,
    load: ({ params, auth }) => tenantAsset(params.id, auth.staff.tenant_id),
    role: ({ auth }) =>
      requireRole(auth, "survey_processor", "Only the survey processor may upload assets."),
    async handle({ body, params }, asset) {
      const corridor = await requireTenantCorridor(asset.corridor_id, asset.tenant_id);
      const geometry = await corridorGeometry(corridor);
      const result = await storeAssetFile(
        asset,
        params["0"],
        new Uint8Array(body as Buffer),
        geometry,
      );
      return {
        status: 200,
        body: {
          asset: await assetPayload(result.asset),
          file: {
            path: result.file.path,
            size_bytes: Number(result.file.size_bytes),
            sha256: result.file.sha256,
            state: result.file.state,
          },
        },
      };
    },
  }),
);

corridorRouter.get(
  "/assets/:id/files/*",
  defineRoute({
    auth: "staff",
    load: ({ params, auth }) => tenantAsset(params.id, auth.staff.tenant_id),
    handle: ({ req, params }, asset) => readAssetFile(asset, params["0"], req),
  }),
);
