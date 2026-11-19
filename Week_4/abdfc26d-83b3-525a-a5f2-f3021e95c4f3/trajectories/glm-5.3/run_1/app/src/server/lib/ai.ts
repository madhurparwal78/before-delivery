import { config } from '../../config.js';
import type { Uniform } from '../../types.js';
import { fetchWithTimeout, readJson } from './http.js';

export interface ShaderGraph {
  graph_id: string;
  title_suggestion: string;
  fragment_source: string;
  uniforms: { name: string; label: string; min: number; max: number; default: number }[];
}

interface RawGraph {
  graph_id?: unknown;
  engine?: unknown;
  title_suggestion?: unknown;
  fragment_source?: unknown;
  uniforms?: unknown;
}

export class MalformedGraph extends Error {
  readonly graph: ShaderGraph | null;
  constructor(graph: ShaderGraph | null) {
    super('provider_malformed');
    this.graph = graph;
  }
}

export type DescribeOutcome =
  | { ok: true; graph: ShaderGraph }
  | { ok: false; reason: 'unavailable' | 'malformed' };

const REQUIRED_UNIFORMS = ['uResolution', 'uTime', 'uSeed'];

export class AiProviderClient {
  async describe(prompt: string, signal?: AbortSignal): Promise<DescribeOutcome> {
    let res;
    try {
      res = await fetchWithTimeout(
        `${config.wiremockUrl}/v1/shader-graphs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, engine: 'GLSL' })
        },
        Math.min(20_000, config.providerTimeoutSeconds * 1000),
        signal
      );
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (res.status !== 200) return { ok: false, reason: 'unavailable' };
    let raw: RawGraph;
    try {
      raw = (await readJson(res)) as RawGraph;
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    const graph = this.checkShape(raw);
    if (graph === null) return { ok: false, reason: 'malformed' };
    return { ok: true, graph };
  }

  private checkShape(raw: RawGraph): ShaderGraph | null {
    if (typeof raw.graph_id !== 'string' || typeof raw.title_suggestion !== 'string' || typeof raw.fragment_source !== 'string') return null;
    if (raw.engine !== 'GLSL') return null;
    if (!Array.isArray(raw.uniforms) || raw.uniforms.length === 0) return null;
    const uniforms: ShaderGraph['uniforms'] = [];
    for (const u of raw.uniforms) {
      const item = u as Record<string, unknown>;
      if (typeof item.name !== 'string' || typeof item.label !== 'string') return null;
      if (typeof item.min !== 'number' || typeof item.max !== 'number' || typeof item.default !== 'number') return null;
      if (!(item.min < item.max)) return null;
      if (item.default < item.min || item.default > item.max) return null;
      uniforms.push({ name: item.name, label: item.label, min: item.min, max: item.max, default: item.default });
    }
    const source = raw.fragment_source;
    if (!source.includes('void main')) return null;
    const names = [...REQUIRED_UNIFORMS, ...uniforms.map((u) => u.name)];
    for (const name of names) {
      if (!new RegExp(`uniform[^;]*\\b${name}\\b`).test(source)) return null;
    }
    return { graph_id: raw.graph_id, title_suggestion: raw.title_suggestion, fragment_source: source, uniforms };
  }
}

export interface RenderJobSpec {
  job_id: string;
  fragment_source: string;
  uniforms: Record<string, number>;
  timeline: unknown;
  format: 'mp4' | 'webm';
  resolution: '720p' | '1080p';
  duration_s: number;
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
}

export type RenderCallOutcome =
  | { ok: true; content_base64: string; sha256: string }
  | { ok: false; reason: 'timeout' | 'error' | 'malformed'; detail?: string };

export class RenderProviderClient {
  async call(spec: RenderJobSpec, signal?: AbortSignal): Promise<RenderCallOutcome> {
    let res;
    try {
      res = await fetchWithTimeout(
        `${config.wiremockUrl}/v1/renders`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Job-Id': spec.job_id },
          body: JSON.stringify(spec)
        },
        config.providerTimeoutSeconds * 1000,
        signal
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const timedOut = msg.includes('aborted') || msg.includes('abort');
      return { ok: false, reason: timedOut ? 'timeout' : 'error', detail: msg };
    }
    if (res.status >= 500) return { ok: false, reason: 'error', detail: `http ${res.status}` };
    if (res.status !== 200) return { ok: false, reason: 'error', detail: `http ${res.status}` };
    let raw: Record<string, unknown>;
    try {
      raw = (await readJson(res)) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: 'malformed', detail: 'bad json' };
    }
    if (typeof raw.content_base64 !== 'string' || typeof raw.sha256 !== 'string') {
      return { ok: false, reason: 'malformed', detail: 'missing fields' };
    }
    return { ok: true, content_base64: raw.content_base64, sha256: raw.sha256 };
  }
}

export function uniformsMap(uniforms: Uniform[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of uniforms) out[u.name] = u.value;
  return out;
}
