/**
 * Product image ripple: one shared WebGL canvas that moves over the hovered image and draws it with a liquid
 * ripple centred on the pointer and RGB fringes 2 to 6 px wide. Without WebGL the page falls back to a CSS scale.
 */

const SETTLE_MS = 550;
const MAX_DPR = 2;

const VERTEX = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_pointer;
uniform vec2 u_px;
uniform float u_ratio;
uniform float u_time;
uniform float u_amp;
void main() {
  vec2 d = (v_uv - u_pointer) * vec2(u_ratio, 1.0);
  float dist = length(d);
  vec2 dir = dist > 0.0005 ? d / dist : vec2(0.0);
  dir.x /= u_ratio;
  float envelope = exp(-dist * 4.5);
  float wave = sin(dist * 36.0 - u_time * 8.0);
  vec2 shift = dir * wave * envelope * u_amp * 0.03;
  float fringePx = u_amp * (2.0 + 4.0 * envelope);
  vec2 fringe = dir * fringePx * u_px;
  vec4 r = texture2D(u_tex, v_uv + shift + fringe);
  vec4 g = texture2D(u_tex, v_uv + shift);
  vec4 b = texture2D(u_tex, v_uv + shift - fringe);
  gl_FragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}`;

interface Engine {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  texture: WebGLTexture;
  uniforms: Record<"pointer" | "px" | "ratio" | "time" | "amp", WebGLUniformLocation>;
  raster: HTMLCanvasElement;
}

interface Session {
  media: HTMLElement;
  image: HTMLImageElement;
  pointer: { x: number; y: number };
  startedAt: number | null;
  leaveAt: number | null;
  leaving: boolean;
  frame: number;
  width: number;
  height: number;
}

let engine: Engine | null | undefined;
let session: Session | null = null;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function build(): Engine | null {
  const canvas = document.createElement("canvas");
  canvas.className = "ripple-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = (canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false }) ?? canvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: true })) as WebGLRenderingContext | null;
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  const texture = gl.createTexture();
  if (!vertex || !fragment || !program || !texture) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const uniform = (name: string): WebGLUniformLocation => gl.getUniformLocation(program, name) as WebGLUniformLocation;
  return {
    canvas,
    gl,
    texture,
    raster: document.createElement("canvas"),
    uniforms: { pointer: uniform("u_pointer"), px: uniform("u_px"), ratio: uniform("u_ratio"), time: uniform("u_time"), amp: uniform("u_amp") },
  };
}

/** True when a WebGL context can be made; the page then ripples instead of scaling. */
export function webglAvailable(): boolean {
  engine ??= build();
  document.documentElement.dataset.ripple = engine ? "gl" : "css";
  return engine !== null;
}

function reduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Draws the image as it is laid out (object-fit: contain) into a texture at the canvas resolution. */
function upload(active: Engine, current: Session, scale: number): boolean {
  const image = current.image;
  if (!image.complete || image.naturalWidth === 0) return false;
  const width = Math.max(1, Math.round(current.width * scale));
  const height = Math.max(1, Math.round(current.height * scale));
  const raster = active.raster;
  raster.width = width;
  raster.height = height;
  const context = raster.getContext("2d");
  if (!context) return false;
  const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawW = image.naturalWidth * fit;
  const drawH = image.naturalHeight * fit;
  context.drawImage(image, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  active.gl.bindTexture(active.gl.TEXTURE_2D, active.texture);
  active.gl.texImage2D(active.gl.TEXTURE_2D, 0, active.gl.RGBA, active.gl.RGBA, active.gl.UNSIGNED_BYTE, raster);
  return true;
}

function draw(active: Engine, current: Session, seconds: number, amplitude: number): void {
  const { gl, uniforms, canvas } = active;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(uniforms.pointer, current.pointer.x, 1 - current.pointer.y);
  gl.uniform2f(uniforms.px, 1 / current.width, 1 / current.height);
  gl.uniform1f(uniforms.ratio, current.width / current.height);
  gl.uniform1f(uniforms.time, seconds);
  gl.uniform1f(uniforms.amp, amplitude);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function release(current: Session): void {
  cancelAnimationFrame(current.frame);
  if (engine?.canvas.parentElement === current.media) current.media.removeChild(engine.canvas);
  current.image.style.opacity = "";
  if (session === current) session = null;
}

function tick(current: Session, now: number): void {
  const active = engine as Engine;
  if (session !== current) return;
  current.startedAt ??= now;
  let amplitude = 1;
  if (current.leaving) {
    current.leaveAt ??= now;
    const progress = (now - current.leaveAt) / SETTLE_MS;
    if (progress >= 1) {
      release(current);
      return;
    }
    amplitude = (1 - progress) * (1 - progress);
  }
  draw(active, current, (now - current.startedAt) / 1000, amplitude);
  current.frame = requestAnimationFrame((next) => tick(current, next));
}

function begin(media: HTMLElement, image: HTMLImageElement, event: PointerEvent): void {
  const active = engine;
  if (!active) return;
  if (session) release(session);
  const box = media.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const current: Session = {
    media,
    image,
    pointer: { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height },
    startedAt: null,
    leaveAt: null,
    leaving: false,
    frame: 0,
    width: box.width,
    height: box.height,
  };
  active.canvas.width = Math.max(1, Math.round(box.width * scale));
  active.canvas.height = Math.max(1, Math.round(box.height * scale));
  if (!upload(active, current, scale)) return;
  session = current;
  media.appendChild(active.canvas);
  draw(active, current, 0, 1);
  image.style.opacity = "0";
  current.frame = requestAnimationFrame((now) => tick(current, now));
}

/** Wires one product image: hover ripples under a mouse, never under touch or reduced motion. */
export function bindRipple(media: HTMLElement, image: HTMLImageElement): () => void {
  if (!webglAvailable()) return () => undefined;
  const enter = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || reduced()) return;
    begin(media, image, event);
  };
  const move = (event: PointerEvent): void => {
    if (!session || session.media !== media) return;
    const box = media.getBoundingClientRect();
    session.pointer = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const leave = (): void => {
    if (session?.media === media) session.leaving = true;
  };
  media.addEventListener("pointerenter", enter);
  media.addEventListener("pointermove", move);
  media.addEventListener("pointerleave", leave);
  return () => {
    media.removeEventListener("pointerenter", enter);
    media.removeEventListener("pointermove", move);
    media.removeEventListener("pointerleave", leave);
    if (session?.media === media) release(session);
  };
}
