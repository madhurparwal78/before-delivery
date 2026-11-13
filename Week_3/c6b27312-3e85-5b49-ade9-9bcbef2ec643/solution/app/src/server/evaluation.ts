// Evaluations: one record per run, an optional evaluator delay that counts toward the time limit, and
// cancellation that reaches whichever process runs it.
import type { EvaluationJson } from "../shared/api";
import { NNBSP, trimmed } from "../shared/numbers";
import { evaluate, measure, type Diagnostic, type Model, type Solid, type Values } from "../shared/tine";
import { config } from "./config";
import { db } from "./db";
import { invalid, notFound } from "./errors";
import type { Ctx } from "./http";
import { get, post, type Route } from "./route";
import { newId } from "./ids";
import { loadRevision, modelOf, readablePart, sourceText, headRevision } from "./records";
import { jsonReply, noContent } from "./reply";
import { digestOf } from "./solids";
import { attempt, key, listen } from "./valkey";
import { numericParameters, validateValues } from "./values";

const ENGINE_VERSION = "tine-1.4.0";
const IN_FLIGHT_SECONDS = 60;

interface EvaluationJob {
  partSlug: string;
  model: Model;
  values: Values;
  viewerId: string;
  seq: number;
}

interface EvaluationRow {
  id: string;
  part_slug: string;
  viewer_id: string;
  seq: number;
  status: EvaluationJson["status"];
  geometry_digest: string | null;
  volume: number;
  bbox: [number, number, number];
  faces: number;
  solid: Solid | null;
  diagnostics: Diagnostic[];
  started_at: Date;
  finished_at: Date;
}

function evaluationJson(row: EvaluationRow): EvaluationJson {
  return {
    id: row.id,
    partSlug: row.part_slug,
    viewerId: row.viewer_id,
    seq: row.seq,
    status: row.status,
    engineVersion: ENGINE_VERSION,
    geometryDigest: row.geometry_digest,
    volume: row.volume,
    bbox: row.bbox,
    faces: row.faces,
    solid: row.solid,
    diagnostics: row.diagnostics,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at.toISOString(),
  };
}

const running = new Map<string, AbortController>();

listen("eval-cancel", (evaluationId) => running.get(evaluationId)?.abort());

/** Cancels the in-flight evaluation of a viewer, on whichever process runs it. */
async function cancelViewer(viewerId: string): Promise<void> {
  await attempt(async (client) => {
    const id = await client.hget(key(`eval:${viewerId}`), "evaluationId");
    if (id) await client.publish(key("eval-cancel"), id);
  }, undefined);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
    if (signal.aborted) done();
  });
}

async function evaluatorDelay(partSlug: string): Promise<number> {
  return Number(await attempt((client) => client.get(key(`grading:delay:${partSlug}`)), null)) || 0;
}

type Outcome = Pick<EvaluationRow, "status"> & Partial<Pick<EvaluationRow, "geometry_digest" | "volume" | "bbox" | "faces" | "solid" | "diagnostics">>;

function settle(job: EvaluationJob, delay: number, signal: AbortSignal): Outcome {
  if (signal.aborted) return { status: "cancelled" };
  if (delay >= config.evalTimeoutMs) {
    const message = `Evaluation stopped after ${trimmed(config.evalTimeoutMs / 1000)}${NNBSP}s.`;
    return { status: "failed", diagnostics: [{ code: "E_TIMEOUT", message, parameter: null }] };
  }
  const outcome = evaluate(job.model, job.values);
  if (!outcome.ok) return { status: "failed", diagnostics: outcome.diagnostics };
  return { status: "succeeded", geometry_digest: digestOf(outcome.solid), ...measureColumns(outcome.solid), solid: outcome.solid };
}

function measureColumns(solid: Solid): Pick<EvaluationRow, "volume" | "bbox" | "faces"> {
  const { volume, bbox, faces } = measure(solid);
  return { volume, bbox, faces };
}

/**
 * Runs an evaluation to its end and stores its record. Aborting the controller stops it at once, including
 * while it waits out the evaluator delay; its record then reads cancelled.
 */
export async function runEvaluation(job: EvaluationJob, controller: AbortController): Promise<EvaluationJson> {
  const id = newId();
  await db.run(
    "INSERT INTO evaluations (id, part_slug, viewer_id, seq, status, started_at) VALUES ($1, $2, $3, $4, 'running', $5)",
    [id, job.partSlug, job.viewerId, job.seq, new Date()],
  );
  running.set(id, controller);
  const handle = key(`eval:${job.viewerId}`);
  try {
    await attempt(async (client) => {
      await client.hset(handle, { evaluationId: id, seq: job.seq });
      await client.expire(handle, IN_FLIGHT_SECONDS);
    }, undefined);
    const delay = await evaluatorDelay(job.partSlug);
    await sleep(Math.min(delay, config.evalTimeoutMs), controller.signal);
    const outcome = settle(job, delay, controller.signal);
    const finished = await db.one<EvaluationRow>(
      `UPDATE evaluations
          SET status = $2, geometry_digest = $3, volume = $4, bbox = $5, faces = $6, solid = $7, diagnostics = $8, finished_at = $9
        WHERE id = $1 RETURNING *`,
      [
        id,
        outcome.status,
        outcome.geometry_digest ?? null,
        outcome.volume ?? 0,
        JSON.stringify(outcome.bbox ?? [0, 0, 0]),
        outcome.faces ?? 0,
        outcome.solid ? JSON.stringify(outcome.solid) : null,
        JSON.stringify(outcome.diagnostics ?? []),
        new Date(),
      ],
    );
    return evaluationJson(finished);
  } finally {
    running.delete(id);
    await attempt(async (client) => {
      if ((await client.hget(handle, "evaluationId")) === id) await client.del(handle);
    }, undefined);
  }
}

/** The model an evaluation or pre-flight of a part reads: the named revision's source, or the head's. */
export async function partModel(partSlug: string, revisionId: unknown): Promise<Model> {
  const revision = typeof revisionId === "string" ? await loadRevision(db, revisionId) : await headRevision(db, partSlug);
  if (!revision || revision.part_slug !== partSlug) throw notFound();
  return modelOf(await sourceText(db, revision.source_ref));
}

async function evaluateRoute(ctx: Ctx) {
  const body = ctx.json();
  if (typeof body.partSlug !== "string") throw invalid({ partSlug: "Choose a part." });
  const part = await readablePart(ctx, body.partSlug);
  const model = await partModel(part.slug, body.revisionId);
  ctx.checkNumbers(numericParameters(model));
  const { seq, viewerId } = body;
  const errors: Record<string, string> = {};
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) errors.seq = "Enter a whole number.";
  if (typeof viewerId !== "string" || viewerId === "") errors.viewerId = "Send a viewer id.";
  if (typeof seq !== "number" || typeof viewerId !== "string" || Object.keys(errors).length > 0) throw invalid(errors);
  const values = validateValues(model, body.values);
  await cancelViewer(viewerId);
  const evaluation = await runEvaluation({ partSlug: part.slug, model, values, viewerId, seq }, ctx.closed);
  return jsonReply(200, evaluation);
}

async function cancelRoute(ctx: Ctx) {
  const { viewerId } = ctx.json();
  if (typeof viewerId !== "string" || viewerId === "") throw invalid({ viewerId: "Send a viewer id." });
  await cancelViewer(viewerId);
  return noContent;
}

async function readEvaluation(ctx: Ctx) {
  const row = await db.row<EvaluationRow>("SELECT * FROM evaluations WHERE id = $1 AND status <> 'running'", [ctx.params.id]);
  if (!row) throw notFound();
  return jsonReply(200, evaluationJson(row));
}

export const evaluationRoutes: Route[] = [
  post("/api/evaluations", evaluateRoute),
  post("/api/evaluations/cancel", cancelRoute),
  get("/api/evaluations/:id", readEvaluation),
];
