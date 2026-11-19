import type { FastifyInstance } from "fastify";
import { instantOf } from "../engine/time.js";
import { ESTIMATE_COUNTRIES, ESTIMATE_FIBRES, ESTIMATE_GARMENT_KG, GARMENTS } from "../engine/domain.js";
import { workOutEstimate } from "../engine/footprint.js";
import { errValidation } from "./errors.js";

/** Try one garment: public, with no library call. */
export function registerEstimateRoute(app: FastifyInstance): void {
  app.get("/api/estimate", async (req) => {
    const query = req.query as Record<string, string>;
    const garment = query.garment ?? "tshirt";
    const fibre = query.fibre ?? "organic-cotton";
    const country = query.country ?? "PT";
    const fields: Record<string, string> = {};
    if (!GARMENTS.includes(garment as never)) fields.garment = `Give a value here.`;
    if (!(fibre in ESTIMATE_FIBRES)) fields.fibre = `Give a value here.`;
    if (!(country in ESTIMATE_COUNTRIES)) fields.country = `Give a value here.`;
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const out = workOutEstimate(ESTIMATE_GARMENT_KG[garment as "tshirt"], ESTIMATE_FIBRES[fibre], ESTIMATE_COUNTRIES[country]);
    return {
      garment,
      fibre,
      country,
      climate: out.climate,
      shown: out.shown,
      answeredAt: instantOf(new Date()),
    };
  });
}
