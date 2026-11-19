import { createHash } from "node:crypto";
import { config } from "./config.js";
import { ApiError, ProviderDown } from "./errors.js";

// The one client for the AI and render provider. Each call applies the brief's timeout and maps
// failures to the brief's outcomes.

interface GraphUniform {
  name: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

interface ShaderGraph {
  title: string;
  fragmentSource: string;
  uniforms: GraphUniform[];
}

const UNIFORM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REQUIRED_UNIFORMS = ["uResolution", "uTime", "uSeed"];

const providerUnavailable = () =>
  new ApiError(503, "provider_unavailable", "The shader assistant is offline. Your prompt is kept; try again in a minute.");
const providerMalformed = () =>
  new ApiError(502, "provider_malformed", "The shader assistant sent something we can't run. Try a different prompt.");

async function post(path: string, body: unknown, timeoutSeconds: number, headers: Record<string, string> = {}): Promise<Response> {
  try {
    const response = await fetch(`${config.providerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    if (response.status >= 500) throw new ProviderDown("provider", `${path} HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ProviderDown("provider", error instanceof Error ? error.message : String(error), timedOut);
  }
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const declares = (source: string, name: string): boolean => new RegExp(`\\buniform\\b[^;]*\\b${name}\\b[^;]*;`).test(source);

/** The server's whole shape check for a drafted shader graph; it never compiles GLSL. */
function shapeOf(raw: unknown): ShaderGraph | null {
  const body = record(raw);
  if (!body) return null;
  const { graph_id, engine, title_suggestion, fragment_source, uniforms } = body;
  if (typeof graph_id !== "string" || engine !== "GLSL" || typeof title_suggestion !== "string" || !title_suggestion.trim()) return null;
  if (typeof fragment_source !== "string" || !fragment_source.includes("void main")) return null;
  if (!Array.isArray(uniforms) || uniforms.length === 0) return null;
  const parsed: GraphUniform[] = [];
  for (const item of uniforms) {
    const uniform = record(item);
    if (!uniform) return null;
    const { name, label, min, max } = uniform;
    const fallback = uniform.default;
    if (typeof name !== "string" || !UNIFORM_NAME.test(name) || typeof label !== "string" || !label.trim()) return null;
    if (!isNumber(min) || !isNumber(max) || !isNumber(fallback) || !(min < max) || fallback < min || fallback > max) return null;
    parsed.push({ name, label: label.trim(), min, max, default: fallback });
  }
  if (new Set(parsed.map((u) => u.name)).size !== parsed.length) return null;
  if (![...REQUIRED_UNIFORMS, ...parsed.map((u) => u.name)].every((name) => declares(fragment_source, name))) return null;
  return { title: title_suggestion.trim().slice(0, 120), fragmentSource: fragment_source, uniforms: parsed };
}

/** Asks for a shader graph: one attempt; 503 when unreachable, 502 when the answer fails the shape check. */
export async function draftShaderGraph(prompt: string): Promise<ShaderGraph> {
  let response: Response;
  try {
    response = await post("/v1/shader-graphs", { prompt, engine: "GLSL" }, Math.min(20, config.providerTimeoutSeconds));
  } catch (error) {
    if (error instanceof ProviderDown) throw providerUnavailable();
    throw error;
  }
  if (response.status !== 200) throw providerMalformed();
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw providerMalformed();
  }
  const graph = shapeOf(raw);
  if (!graph) throw providerMalformed();
  return graph;
}

interface RenderJobRequest {
  jobId: string;
  fragmentSource: string;
  uniforms: Record<string, number>;
  timeline: unknown;
  format: string;
  resolution: string;
  durationS: number;
  aspect: string;
}

type RenderAttempt =
  | { kind: "ok"; bytes: Buffer; sha256: string }
  | { kind: "malformed" }
  | { kind: "failed"; reason: "provider_error" | "timeout" };

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** One render attempt: a well-formed result whose checksum matches its bytes, or why it is not. */
export async function renderAttempt(job: RenderJobRequest): Promise<RenderAttempt> {
  let response: Response;
  try {
    response = await post(
      "/v1/renders",
      {
        job_id: job.jobId,
        fragment_source: job.fragmentSource,
        uniforms: job.uniforms,
        timeline: job.timeline,
        format: job.format,
        resolution: job.resolution,
        duration_s: job.durationS,
        aspect: job.aspect,
      },
      config.providerTimeoutSeconds,
      { "X-Job-Id": job.jobId },
    );
  } catch (error) {
    if (error instanceof ProviderDown) return { kind: "failed", reason: error.timedOut ? "timeout" : "provider_error" };
    throw error;
  }
  if (response.status !== 200) return { kind: "failed", reason: "provider_error" };
  let body: Record<string, unknown> | null;
  try {
    body = record(await response.json());
  } catch {
    return { kind: "malformed" };
  }
  const content = body?.content_base64;
  const sha256 = body?.sha256;
  if (typeof content !== "string" || typeof sha256 !== "string" || !BASE64.test(content) || !/^[0-9a-f]{64}$/.test(sha256)) {
    return { kind: "malformed" };
  }
  const bytes = Buffer.from(content, "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) return { kind: "malformed" };
  return { kind: "ok", bytes, sha256 };
}

export async function reachable(): Promise<boolean> {
  try {
    await fetch(`${config.providerUrl}/`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}
