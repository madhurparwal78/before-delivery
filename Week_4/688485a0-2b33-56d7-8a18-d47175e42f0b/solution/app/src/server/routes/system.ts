import { SAMPLE_PIPELINE, houseplants } from "../../shared/sample.js";
import { config } from "../config.js";
import { state } from "../db.js";
import { compilePipeline, previewBody, runPipeline } from "../engine/aggregate.js";
import { route } from "../http.js";
import { storageReachable } from "../s3.js";

/** Health and the public landing-page sample. */

const HEALTH_LIMIT_MS = 2000;

route("GET", "/api/health", async () => {
  if (!state.ready) return { status: 503, body: { status: "starting" } };
  return { status: 200, body: { status: (await storageReachable(HEALTH_LIMIT_MS)) ? "ok" : "unavailable" } };
});

const sample = (() => {
  const docs = houseplants();
  const run = runPipeline(compilePipeline(SAMPLE_PIPELINE, SAMPLE_PIPELINE.length), new Set(), docs, config.limits.previewDocs, null);
  return previewBody(run, docs.length, null);
})();

route("GET", "/api/sample/sieve", async () => ({ status: 200, body: sample }));
