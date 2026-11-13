// Pre-flight: a part's own values checked against a chosen process, with cost bands and a signed-out allowance.
import type { Finding, PreflightReport } from "../shared/api";
import { canonicalJson, type Json } from "../shared/canonical";
import { NNBSP, bboxText, display, significant, trimmed } from "../shared/numbers";
import { compareText } from "../shared/order";
import { PROCESSES, type Process } from "../shared/processes";
import { bodyHeight, evaluate, measure, poseOfBox, poseOfSolid, type Model, type Outcome, type Values } from "../shared/tine";
import { config } from "./config";
import { db } from "./db";
import { ApiError, evaluationFailed, invalid } from "./errors";
import { partModel } from "./evaluation";
import type { Ctx } from "./http";
import { post, type Route } from "./route";
import { readablePart } from "./records";
import { jsonReply } from "./reply";
import { digestOf, sha256 } from "./solids";
import { attempt, key } from "./valkey";
import { numericParameters, validateValues } from "./values";

const COUNTER_SECONDS = 86_400;
const QUANTITIES = [1, 10, 100];
const UNSUPPORTED = "Laser-cut sheet needs a part of one uniform thickness.";
const SEVERITY_ORDER = { Blocking: 0, Advisory: 1, Pass: 2 } as const;

// ------------------------------------------------------------------------------------------------ allowance

const counterKey = (visitorId: string) => key(`preflight:${visitorId}`);

/** How many reports this signed-out session has stored. */
export async function allowanceUsed(visitorId: string): Promise<number> {
  return Number(await attempt((client) => client.get(counterKey(visitorId)), null)) || 0;
}

/** Claims one report atomically; the seconds until the allowance returns when it is used up, otherwise null. */
async function claim(visitorId: string): Promise<number | null> {
  return attempt(async (client) => {
    const used = await client.incr(counterKey(visitorId));
    if (used === 1) await client.expire(counterKey(visitorId), COUNTER_SECONDS);
    if (used <= config.preflightSignedOutLimit) return null;
    await client.decr(counterKey(visitorId));
    return Math.min(COUNTER_SECONDS, Math.max(1, await client.ttl(counterKey(visitorId))));
  }, null);
}

const giveBack = (visitorId: string) => attempt((client) => client.decr(counterKey(visitorId)), 0);

// ------------------------------------------------------------------------------------------------ findings

interface Candidate {
  finding: Finding;
  shortfall: number;
  /** 0 for the envelope finding, 1 for cut findings. */
  group: number;
  /** The cut's place in evaluated order. */
  cut: number;
}

type Passed = Extract<Outcome, { ok: true }>;

function money(x: number): string {
  return `$${display(x, x >= 1 ? 0 : -Math.floor(Math.log10(x)))}`;
}

function findings(model: Model, part: Passed, process: Process): Candidate[] {
  const { solid, body, placed } = part;
  const { bbox } = measure(solid);
  const height = bodyHeight(solid);
  const found: Candidate[] = [];
  const add = (finding: Omit<Finding, "id">, shortfall: number, group: number, cut: number) => {
    found.push({ finding: { ...finding, id: `f${found.length + 1}` }, shortfall, group, cut });
  };

  const overruns = bbox.map((size, axis) => size - process.envelope[axis]);
  const worst = overruns.indexOf(Math.max(...overruns));
  if (overruns[worst] > 0) {
    const limit = process.envelope[worst];
    add(
      {
        severity: "Blocking",
        code: "ENVELOPE",
        message: `Part is ${bboxText(bbox)}; the ${process.label} envelope is ${bboxText(process.envelope)}.`,
        cutLabel: null,
        measured: bbox[worst],
        threshold: limit,
        operation: model.bodyIndex,
        parameters: body?.parameters ?? [],
        pose: poseOfSolid(solid),
      },
      overruns[worst] / limit,
      0,
      0,
    );
  }

  placed.forEach((cut, order) => {
    if (cut.verb !== "hole" && cut.verb !== "slot") return;
    const reach = cut.verb === "slot" ? cut.v.len / 2 + cut.v.w / 2 : cut.v.dia / 2;
    const across = cut.verb === "slot" ? cut.v.w / 2 : cut.v.dia / 2;
    const base = {
      cutLabel: cut.label,
      operation: cut.opIndex,
      parameters: cut.parameters,
      pose: poseOfBox([cut.v.x - reach, cut.v.y - across, 0], [cut.v.x + reach, cut.v.y + across, height]),
    };
    const wall = cut.wall ?? 0;
    if (wall < process.wall.advisory) {
      const blocking = wall < process.wall.blocking;
      const threshold = blocking ? process.wall.blocking : process.wall.advisory;
      const message = `Wall beside ${cut.label} is ${trimmed(wall)}${NNBSP}mm; ${process.label} needs at least ${trimmed(threshold)}${NNBSP}mm.`;
      add({ ...base, severity: blocking ? "Blocking" : "Advisory", code: "WALL", message, measured: wall, threshold }, Math.abs(wall - threshold) / threshold, 1, order);
    }
    const ratio = height / cut.v.dia;
    if (cut.verb === "hole" && process.depthLimit !== null && ratio > process.depthLimit) {
      const message = `${cut.label} is ${trimmed(ratio)}× deeper than its diameter; ${process.label} allows at most ${trimmed(process.depthLimit)}×.`;
      add({ ...base, severity: "Blocking", code: "HOLE_DEPTH", message, measured: ratio, threshold: process.depthLimit }, Math.abs(ratio - process.depthLimit) / process.depthLimit, 1, order);
    }
  });
  return found;
}

/** House rule H3: Blocking, Advisory, Pass; shortfall descending; envelope before cuts, cuts in evaluated order; code; id. */
function byOrder(a: Candidate, b: Candidate): number {
  return (
    SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] ||
    b.shortfall - a.shortfall ||
    a.group - b.group ||
    a.cut - b.cut ||
    compareText(a.finding.code, b.finding.code) ||
    compareText(a.finding.id, b.finding.id)
  );
}

function costBands(process: Process, volume: number): PreflightReport["costBands"] {
  return QUANTITIES.map((quantity) => {
    const unit = process.setup / quantity + (volume / 1000) * process.rate;
    const low = Number(significant(0.8 * unit, 1));
    const high = Number(significant(1.25 * unit, 1));
    return { quantity, low, high, text: `${money(low)}–${money(high)} each` };
  });
}

type Computed = Pick<PreflightReport, "status" | "message" | "findings" | "costBands" | "confidence" | "geometryDigest">;

function compute(model: Model, part: Passed, process: Process): Computed {
  const geometryDigest = digestOf(part.solid);
  if (process.id === "laser-sheet" && part.placed.some((cut) => cut.verb === "boss")) {
    return { status: "unsupported", message: UNSUPPORTED, findings: [], costBands: [], confidence: null, geometryDigest };
  }
  const ordered = findings(model, part, process).sort(byOrder).map((candidate) => candidate.finding);
  const listed: Finding[] =
    ordered.length > 0
      ? ordered
      : [
          {
            id: "f1",
            severity: "Pass",
            code: "PASS",
            message: `Every check passed for ${process.label}.`,
            cutLabel: null,
            measured: null,
            threshold: null,
            operation: model.bodyIndex,
            parameters: part.body?.parameters ?? [],
            pose: poseOfSolid(part.solid),
          },
        ];
  const confidence = listed.some((f) => f.severity === "Blocking") ? "Low" : listed.some((f) => f.severity === "Advisory") ? "Medium" : "High";
  return { status: "complete", message: null, findings: listed, costBands: costBands(process, measure(part.solid).volume), confidence, geometryDigest };
}

// ------------------------------------------------------------------------------------------------ route

interface ReportRow {
  id: string;
  part_slug: string;
  process: string;
  param_values: Values;
  geometry_digest: string;
  status: PreflightReport["status"];
  message: string | null;
  findings: Finding[];
  cost_bands: PreflightReport["costBands"];
  confidence: PreflightReport["confidence"];
  created_at: Date;
}

export function reportJson(row: ReportRow): PreflightReport {
  return {
    id: row.id,
    partSlug: row.part_slug,
    process: row.process,
    values: row.param_values,
    geometryDigest: row.geometry_digest,
    status: row.status,
    message: row.message,
    findings: row.findings,
    costBands: row.cost_bands,
    confidence: row.confidence,
    createdAt: row.created_at.toISOString(),
  };
}

async function runPreflight(ctx: Ctx) {
  const body = ctx.json();
  if (typeof body.partSlug !== "string") throw invalid({ partSlug: "Choose a part." });
  const part = await readablePart(ctx, body.partSlug);
  const model = await partModel(part.slug, body.revisionId);
  const user = await ctx.user();
  const retryAfter = user ? null : await claim(ctx.visitorId);
  if (retryAfter !== null) {
    throw new ApiError(429, "preflight_limit", "Sign in to run more pre-flight reports.", {}, { "Retry-After": String(retryAfter) });
  }
  try {
    ctx.checkNumbers(numericParameters(model));
    const values = validateValues(model, body.values);
    const process = PROCESSES.find((p) => p.id === body.process);
    if (!process) throw invalid({ process: "Choose a process." });
    const outcome = evaluate(model, values);
    if (!outcome.ok) throw evaluationFailed(outcome.diagnostics);
    const computed = compute(model, outcome, process);
    // A report is a pure function of its part, process, values and solid, so the same inputs are the same stored report.
    const id = sha256(canonicalJson({ slug: part.slug, process: process.id, digest: computed.geometryDigest, values } as Json));
    const row = await db.one<ReportRow>(
      `INSERT INTO preflight_reports (id, part_slug, process, param_values, geometry_digest, status, message, findings, cost_bands, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING *`,
      [
        id, part.slug, process.id, JSON.stringify(values), computed.geometryDigest, computed.status, computed.message,
        JSON.stringify(computed.findings), JSON.stringify(computed.costBands), computed.confidence, new Date(),
      ],
    );
    return jsonReply(201, reportJson(row));
  } catch (error) {
    if (!user) await giveBack(ctx.visitorId);
    throw error;
  }
}

export const preflightRoutes: Route[] = [post("/api/preflight", runPreflight)];
