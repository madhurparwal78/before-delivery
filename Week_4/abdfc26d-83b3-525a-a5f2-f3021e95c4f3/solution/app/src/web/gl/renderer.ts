export type ProgramSpec = { kind: "house"; slug: string } | { kind: "source"; source: string };

interface DrawRequest {
  program: ProgramSpec;
  width: number;
  height: number;
  time: number;
  seed: number;
  uniforms: Record<string, number>;
  crop?: { x: number; y: number; w: number; h: number };
}

const MAX_SIZE = 2048;
// Editors validate on every edit; old programs are evicted so GPU memory stays bounded.
const MAX_PROGRAMS = 48;

const VERTEX_SOURCE = `attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const HOUSE_SOURCE = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime, uSeed;
uniform float uHueA;
uniform float uHueB;
uniform float uFilm;

// One hue at a time, kept off the violet and magenta arc (250 to 345 degrees). The dial folds back at its ends
// instead of wrapping, so two nearby values never land on opposite sides of that arc and blend into violet.
vec3 tint(float u) {
  float v = 1.0 - abs(1.0 - 2.0 * fract(u * 0.5));
  float h = fract(0.958 + v * 0.736);
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), k, 0.72);
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  vec2 q = (p - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * 0.35;
  float s = uSeed * 6.28318;
  vec2 w = q * (2.2 + 1.5 * uSeed);
  w += 0.45 * vec2(sin(w.y * 1.9 + t + s), cos(w.x * 1.6 - t * 0.8 + s * 2.0));
  w += 0.25 * vec2(sin(w.y * 3.1 - t * 1.3 + s * 3.0), cos(w.x * 2.7 + t * 1.1));
  float swell = (0.8 + 1.8 * uFilm) * (1.0 + 0.25 * sin(t * 0.5));
  float thick = swell * (length(w + 0.6 * vec2(sin(s), cos(s))) + 0.35 * sin(w.x * 1.3 + w.y * 0.7 + s)) - t * 0.6;
  float sheen = pow(0.5 + 0.5 * cos(thick * 6.28318), 4.0);
  vec3 col = mix(tint(uHueA + thick * 0.06), tint(uHueB - thick * 0.04), 0.5 + 0.5 * sin(thick * 3.14159 + s));
  float pool = smoothstep(1.3, 0.1, length(q - 0.25 * vec2(cos(s + t * 0.2), sin(s * 1.3))));
  vec3 c = vec3(0.012, 0.012, 0.014) + col * (0.05 + 0.62 * sheen * (0.3 + 0.7 * pool));
  gl_FragColor = vec4(c, 1.0);
}
`;

type Built =
  | { ok: true; log: string; program: WebGLProgram; locations: Map<string, WebGLUniformLocation | null> }
  | { ok: false; log: string };

interface Resources {
  buffer: WebGLBuffer;
  vertex: WebGLShader;
  programs: Map<string, Built>;
}

interface Shared {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  res: Resources | null;
}

type Ready = { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; res: Resources };

// undefined: not attempted yet; null: this browser has no WebGL.
let shared: Shared | null | undefined;

function setup(gl: WebGLRenderingContext): Resources | null {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const buffer = gl.createBuffer();
  if (!vertex || !buffer) return null;
  gl.shaderSource(vertex, VERTEX_SOURCE);
  gl.compileShader(vertex);
  if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return { buffer, vertex, programs: new Map() };
}

function create(): Shared | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const options: WebGLContextAttributes = { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false };
  const gl =
    canvas.getContext("webgl", options) ??
    (canvas.getContext("experimental-webgl", options) as WebGLRenderingContext | null);
  if (!gl) return null;
  const state: Shared = { canvas, gl, res: setup(gl) };
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    state.res = null;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    state.res = setup(gl);
  });
  return state;
}

function acquire(): Ready | null {
  if (shared === undefined) shared = create();
  if (!shared || !shared.res || shared.gl.isContextLost()) return null;
  return { canvas: shared.canvas, gl: shared.gl, res: shared.res };
}

function compile(ready: Ready, source: string): Built {
  const { gl, res } = ready;
  const shader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!shader) return { ok: false, log: "Could not create a fragment shader." };
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const compileLog = (gl.getShaderInfoLog(shader) ?? "").trim();
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return { ok: false, log: compileLog };
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(shader);
    return { ok: false, log: "Could not create a program." };
  }
  gl.attachShader(program, res.vertex);
  gl.attachShader(program, shader);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(shader);
  const linkLog = (gl.getProgramInfoLog(program) ?? "").trim();
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return { ok: false, log: linkLog || compileLog };
  }
  return { ok: true, log: [compileLog, linkLog].filter((line) => line !== "").join("\n"), program, locations: new Map() };
}

function build(ready: Ready, source: string): Built {
  const { programs } = ready.res;
  const cached = programs.get(source);
  if (cached) {
    programs.delete(source);
    programs.set(source, cached);
    return cached;
  }
  const built = compile(ready, source);
  programs.set(source, built);
  while (programs.size > MAX_PROGRAMS) {
    const oldest = programs.entries().next().value;
    if (!oldest) break;
    programs.delete(oldest[0]);
    if (oldest[1].ok) ready.gl.deleteProgram(oldest[1].program);
  }
  return built;
}

function uniformLocation(
  gl: WebGLRenderingContext,
  built: Extract<Built, { ok: true }>,
  name: string,
): WebGLUniformLocation | null {
  if (!built.locations.has(name)) built.locations.set(name, gl.getUniformLocation(built.program, name));
  return built.locations.get(name) ?? null;
}

export function webglAvailable(): boolean {
  return acquire() !== null;
}

export function draw(target: CanvasRenderingContext2D, request: DrawRequest): boolean {
  const ready = acquire();
  if (!ready) return false;
  const source = request.program.kind === "house" ? HOUSE_SOURCE : request.program.source;
  const built = build(ready, source);
  if (!built.ok) return false;
  const { gl, canvas, res } = ready;

  // Fields larger than the GL canvas cap are rendered smaller and scaled up on copy.
  const scale = Math.min(1, MAX_SIZE / Math.max(1, request.width), MAX_SIZE / Math.max(1, request.height));
  const width = Math.max(1, Math.round(request.width * scale));
  const height = Math.max(1, Math.round(request.height * scale));
  if (width > canvas.width || height > canvas.height) {
    canvas.width = Math.max(canvas.width, width);
    canvas.height = Math.max(canvas.height, height);
  }

  gl.useProgram(built.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, res.buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, width, height);

  const set = (name: string, value: number): void => {
    const loc = uniformLocation(gl, built, name);
    if (loc) gl.uniform1f(loc, value);
  };
  if (request.program.kind === "house") {
    const colours = palette(request.program.slug);
    set("uHueA", colours.hueA);
    set("uHueB", colours.hueB);
    set("uFilm", colours.film);
  }
  for (const [name, value] of Object.entries(request.uniforms)) set(name, value);
  const resolution = uniformLocation(gl, built, "uResolution");
  if (resolution) gl.uniform2f(resolution, width, height);
  set("uTime", request.time);
  set("uSeed", request.seed);

  let crop: { x: number; y: number; w: number; h: number } | null = null;
  if (request.crop) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(request.crop.x * scale)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(request.crop.y * scale)));
    crop = {
      x,
      y,
      w: Math.max(1, Math.min(width - x, Math.ceil(request.crop.w * scale))),
      h: Math.max(1, Math.min(height - y, Math.ceil(request.crop.h * scale))),
    };
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(crop.x, height - (crop.y + crop.h), crop.w, crop.h);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.SCISSOR_TEST);

  // GL's origin is bottom-left, so the field sits in the bottom-left width x height of the GL canvas.
  const fieldTop = canvas.height - height;
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  if (crop && request.crop) {
    target.drawImage(canvas, crop.x, fieldTop + crop.y, crop.w, crop.h, 0, 0, request.crop.w, request.crop.h);
  } else {
    target.drawImage(canvas, 0, fieldTop, width, height, 0, 0, target.canvas.width, target.canvas.height);
  }
  return true;
}

export function validate(source: string): { ok: boolean; log: string } {
  const ready = acquire();
  if (!ready) return { ok: false, log: "WebGL is not available in this browser." };
  const built = build(ready, source);
  return { ok: built.ok, log: built.log };
}

function hsla(hue: number, saturation: number, lightness: number, alpha = 1): string {
  const h = (((hue % 1) + 1) % 1) * 360;
  return `hsla(${h.toFixed(1)}, ${(saturation * 100).toFixed(1)}%, ${(lightness * 100).toFixed(1)}%, ${alpha})`;
}

/** The palette index (0..1) as a hue fraction off the violet and magenta arc, as the house shader maps it. */
const allowedHue = (u: number): number => (0.958 + Math.min(Math.max(u, 0), 1) * 0.736) % 1;

export function drawStill(target: CanvasRenderingContext2D, slug: string, width: number, height: number): void {
  const index = palette(slug);
  const hueA = allowedHue(index.hueA);
  const hueB = allowedHue(index.hueB);
  const hueMid = allowedHue((index.hueA + index.hueB) / 2);
  const film = index.film;
  const bits = fnv1a(`${slug}:still`);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  target.save();
  target.globalAlpha = 1;
  target.globalCompositeOperation = "source-over";
  target.clearRect(0, 0, w, h);

  const base = target.createLinearGradient(0, h, w, 0);
  base.addColorStop(0, hsla(hueA, 0.55, 0.06));
  base.addColorStop(0.3, hsla(hueB, 0.7, 0.36));
  base.addColorStop(0.55, hsla(hueA, 0.75, 0.2));
  base.addColorStop(0.78, hsla(hueMid, 0.8, 0.44));
  base.addColorStop(1, hsla(hueB, 0.5, 0.05));
  target.fillStyle = base;
  target.fillRect(0, 0, w, h);

  target.globalCompositeOperation = "lighter";
  for (let i = 0; i < 2; i++) {
    const cx = (((bits >>> (i * 8)) & 0xff) / 255) * w;
    const cy = (((bits >>> (i * 8 + 16)) & 0xff) / 255) * h;
    const radius = Math.max(w, h) * (0.35 + 0.15 * i);
    const glow = target.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, hsla(i === 0 ? hueB : hueA, 0.85, 0.55, 0.5));
    glow.addColorStop(1, hsla(i === 0 ? hueB : hueA, 0.85, 0.55, 0));
    target.fillStyle = glow;
    target.fillRect(0, 0, w, h);
  }

  target.globalCompositeOperation = "source-over";
  const bands = 6 + Math.round(film * 10);
  target.lineWidth = Math.max(1, h / (bands * 4));
  for (let k = 0; k < bands; k++) {
    const y = ((k + 0.5) / bands) * h;
    const amp = h * 0.08 * (1 + film);
    target.strokeStyle = hsla(k % 2 === 0 ? hueA : hueB, 0.6, 0.8, 0.07);
    target.beginPath();
    target.moveTo(0, y);
    target.bezierCurveTo(w * 0.33, y - amp, w * 0.66, y + amp, w, y - amp * 0.5);
    target.stroke();
  }

  const vignette = target.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, "rgba(6, 6, 8, 0)");
  vignette.addColorStop(1, "rgba(6, 6, 8, 0.7)");
  target.fillStyle = vignette;
  target.fillRect(0, 0, w, h);
  target.restore();
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function palette(slug: string): { hueA: number; hueB: number; film: number } {
  const hash = fnv1a(slug);
  const hueA = ((hash & 0x3ff) / 1024) * 0.78;
  const hueB = hueA + 0.08 + (((hash >>> 10) & 0x3ff) / 1024) * 0.14;
  const film = 0.3 + (((hash >>> 20) & 0xfff) / 4096) * 0.6;
  return { hueA, hueB, film };
}
