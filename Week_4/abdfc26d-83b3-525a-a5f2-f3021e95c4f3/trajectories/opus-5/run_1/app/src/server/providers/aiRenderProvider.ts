import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

const SHADER_GRAPH_TIMEOUT_SECONDS = Math.min(20, config.providerTimeoutSeconds);

const REQUIRED_UNIFORM_DECLARATIONS = ['uResolution', 'uTime', 'uSeed'] as const;

export interface ProviderUniform {
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export interface ShaderGraph {
  readonly graphId: string;
  readonly titleSuggestion: string;
  readonly fragmentSource: string;
  readonly uniforms: readonly ProviderUniform[];
}

/** A provider call that errored or ran out of time; the retry rule decides what happens next. */
export class ProviderCallFailed extends Error {
  readonly timedOut: boolean;
  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = 'ProviderCallFailed';
    this.timedOut = timedOut;
  }
}

/** A 200 the server cannot use. Fails at once, with no retry. */
export class ProviderResultMalformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderResultMalformed';
  }
}

async function postJson(
  path: string,
  body: unknown,
  timeoutSeconds: number,
  headers: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(`${config.wiremockUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status >= 500) {
      throw new ProviderCallFailed(`Provider answered ${response.status}`, false);
    }
    if (!response.ok) {
      throw new ProviderResultMalformed(`Provider answered ${response.status}`);
    }
    return await response.json().catch(() => {
      throw new ProviderResultMalformed('Provider answered with unreadable JSON');
    });
  } catch (error) {
    if (error instanceof ProviderCallFailed || error instanceof ProviderResultMalformed) throw error;
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new ProviderCallFailed(timedOut ? 'Provider timed out' : 'Provider is unreachable', timedOut);
  } finally {
    clearTimeout(timer);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function declaresUniform(source: string, name: string): boolean {
  return new RegExp(`\\buniform\\s+\\w+\\s+${name}\\b`).test(source);
}

/** The whole 502 rule. The server never compiles GLSL. */
function readShaderGraph(payload: unknown): ShaderGraph {
  if (typeof payload !== 'object' || payload === null) {
    throw new ProviderResultMalformed('Provider sent no object');
  }
  const body = payload as Record<string, unknown>;
  const { graph_id: graphId, engine, title_suggestion: title, fragment_source: source } = body;

  if (
    typeof graphId !== 'string' ||
    graphId === '' ||
    typeof engine !== 'string' ||
    engine === '' ||
    typeof title !== 'string' ||
    title === '' ||
    typeof source !== 'string' ||
    source === '' ||
    !Array.isArray(body.uniforms)
  ) {
    throw new ProviderResultMalformed('Provider left a field out');
  }

  if (body.uniforms.length === 0) {
    throw new ProviderResultMalformed('Provider sent no uniforms');
  }

  const uniforms: ProviderUniform[] = body.uniforms.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ProviderResultMalformed('Provider sent a uniform that is not an object');
    }
    const uniform = entry as Record<string, unknown>;
    const { name, label, min, max } = uniform;
    const fallback = uniform.default;
    if (
      typeof name !== 'string' ||
      name === '' ||
      typeof label !== 'string' ||
      label === '' ||
      !isFiniteNumber(min) ||
      !isFiniteNumber(max) ||
      !isFiniteNumber(fallback)
    ) {
      throw new ProviderResultMalformed('Provider sent an incomplete uniform');
    }
    if (!(min < max) || fallback < min || fallback > max) {
      throw new ProviderResultMalformed(`Uniform ${name} has an unusable range`);
    }
    return { name, label, min, max, default: fallback };
  });

  if (!source.includes('void main')) {
    throw new ProviderResultMalformed('Shader has no void main');
  }
  for (const name of [...REQUIRED_UNIFORM_DECLARATIONS, ...uniforms.map((u) => u.name)]) {
    if (!declaresUniform(source, name)) {
      throw new ProviderResultMalformed(`Shader does not declare uniform ${name}`);
    }
  }

  return { graphId, titleSuggestion: title, fragmentSource: source, uniforms };
}

/** Asks the provider for a shader graph. One attempt; failures map to 503 or 502. */
export async function requestShaderGraph(prompt: string): Promise<ShaderGraph> {
  let payload: unknown;
  try {
    payload = await postJson(
      '/v1/shader-graphs',
      { prompt, engine: 'GLSL' },
      SHADER_GRAPH_TIMEOUT_SECONDS,
    );
  } catch (error) {
    if (error instanceof ProviderCallFailed) throw ApiError.providerUnavailable();
    throw ApiError.providerMalformed();
  }
  try {
    return readShaderGraph(payload);
  } catch {
    throw ApiError.providerMalformed();
  }
}

export interface RenderRequest {
  readonly renderId: string;
  readonly fragmentSource: string;
  readonly uniforms: Readonly<Record<string, number>>;
  readonly timeline: unknown;
  readonly format: 'mp4' | 'webm';
  readonly resolution: '720p' | '1080p';
  readonly durationSeconds: number;
  readonly aspect: string;
}

export interface RenderResult {
  readonly bytes: Buffer;
  readonly sha256: string;
}

/**
 * Renders an export. A malformed 200 (missing fields, invalid base64 or a
 * checksum that does not match the bytes) fails at once with no retry.
 */
export async function requestRender(request: RenderRequest): Promise<RenderResult> {
  const payload = await postJson(
    '/v1/renders',
    {
      job_id: request.renderId,
      fragment_source: request.fragmentSource,
      uniforms: request.uniforms,
      timeline: request.timeline,
      format: request.format,
      resolution: request.resolution,
      duration_s: request.durationSeconds,
      aspect: request.aspect,
    },
    config.providerTimeoutSeconds,
    { 'x-job-id': request.renderId },
  );

  if (typeof payload !== 'object' || payload === null) {
    throw new ProviderResultMalformed('Provider sent no object');
  }
  const body = payload as Record<string, unknown>;
  const { content_base64: content, sha256 } = body;
  if (typeof content !== 'string' || typeof sha256 !== 'string' || sha256 === '') {
    throw new ProviderResultMalformed('Provider left content_base64 or sha256 out');
  }

  const bytes = Buffer.from(content, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== content.replace(/=+$/, '')) {
    throw new ProviderResultMalformed('Provider sent invalid base64');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
    throw new ProviderResultMalformed('Provider checksum does not match its bytes');
  }

  return { bytes, sha256: sha256.toLowerCase() };
}

export async function probeProvider(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${config.wiremockUrl}/v1/shader-graphs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'probe', engine: 'GLSL' }),
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
