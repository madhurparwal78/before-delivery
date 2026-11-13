/** The particle wordmark: raw WebGL points sampled from the wordmark drawn on a 2D canvas. */

interface Wordmark {
  destroy: () => void;
}

const DISPLAY_FONT = '"Darker Grotesque", "Lexend", sans-serif';
const TARGET_PARTICLES = 4000;
const MAX_PARTICLES = 6000;
/** Particles this close to the pointer scatter away. */
const RADIUS = 120;
/** Spring frequency in radians per second: a critically damped return takes about 1.6 s to settle. */
const OMEGA = 4;
const SETTLED = 0.05;
const MARGIN = 4;

const VERTEX = `
attribute vec2 a_pos;
uniform vec2 u_size;
uniform float u_point;
void main() {
  gl_Position = vec4(a_pos.x / u_size.x * 2.0 - 1.0, 1.0 - a_pos.y / u_size.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_point;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_color;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  if (dot(p, p) > 0.25) discard;
  gl_FragColor = vec4(u_color, 1.0);
}`;

function compile(gl: WebGLRenderingContext, kind: number, source: string): WebGLShader | null {
  const shader = gl.createShader(kind);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function program(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const linked = gl.createProgram();
  if (!vertex || !fragment || !linked) return null;
  gl.attachShader(linked, vertex);
  gl.attachShader(linked, fragment);
  gl.linkProgram(linked);
  return gl.getProgramParameter(linked, gl.LINK_STATUS) ? linked : null;
}

/** Home positions of the particles, as x, y pairs in CSS pixels, spread evenly over the filled pixels of the text. */
function sample(text: string, width: number, height: number): { points: Float32Array; step: number } | null {
  const paper = document.createElement("canvas");
  paper.width = width;
  paper.height = height;
  const context = paper.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.font = `900 100px ${DISPLAY_FONT}`;
  const probe = context.measureText(text);
  const wide = probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight;
  const tall = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent;
  if (wide <= 0 || tall <= 0) return null;
  const size = 100 * Math.min((width - 2 * MARGIN) / wide, (height - 2 * MARGIN) / tall);
  context.font = `900 ${size}px ${DISPLAY_FONT}`;
  const fit = context.measureText(text);
  const left = fit.actualBoundingBoxLeft;
  const top = fit.actualBoundingBoxAscent;
  context.fillStyle = "#000";
  context.fillText(text, (width - (left + fit.actualBoundingBoxRight)) / 2 + left, (height - (top + fit.actualBoundingBoxDescent)) / 2 + top);
  const data = context.getImageData(0, 0, width, height).data;
  let filled = 0;
  for (let at = 3; at < data.length; at += 4) if ((data[at] as number) > 127) filled += 1;
  const step = Math.max(1, Math.sqrt(filled / TARGET_PARTICLES));
  const found: number[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if ((data[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] as number) > 127) found.push(x, y);
    }
  }
  const stride = Math.max(1, Math.ceil(found.length / 2 / MAX_PARTICLES));
  const points = new Float32Array(Math.ceil(found.length / 2 / stride) * 2);
  for (let i = 0, out = 0; i < found.length; i += 2 * stride, out += 2) {
    points[out] = found[i] as number;
    points[out + 1] = found[i + 1] as number;
  }
  return { points, step };
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * Draws `text` as particles on `canvas`. Resolves to null when WebGL is missing, so the page can show the solid wordmark.
 * At rest nothing is scheduled and nothing moves; the pointer wakes the loop and the loop sleeps again once every particle is home.
 */
export async function startWordmark(canvas: HTMLCanvasElement, text: string, color: string): Promise<Wordmark | null> {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) return null;
  await document.fonts.load(`900 100px "Darker Grotesque"`, text);
  const width = Math.round(canvas.clientWidth);
  const height = Math.round(canvas.clientHeight);
  const sampled = width > 0 && height > 0 ? sample(text, width, height) : null;
  const linked = program(gl);
  if (!sampled || !linked) return null;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(linked);
  gl.clearColor(0, 0, 0, 0);
  const [r, g, b] = rgb(color);
  gl.uniform3f(gl.getUniformLocation(linked, "u_color"), r, g, b);
  gl.uniform2f(gl.getUniformLocation(linked, "u_size"), width, height);
  gl.uniform1f(gl.getUniformLocation(linked, "u_point"), Math.max(2, sampled.step * 1.3) * ratio);

  const home = sampled.points;
  const pos = Float32Array.from(home);
  const vel = new Float32Array(home.length);
  const count = home.length / 2;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  const place = gl.getAttribLocation(linked, "a_pos");
  gl.enableVertexAttribArray(place);
  gl.vertexAttribPointer(place, 2, gl.FLOAT, false, 0, 0);

  const draw = (): void => {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.drawArrays(gl.POINTS, 0, count);
  };
  draw();

  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  let last = 0;

  /** Pushes every particle inside the radius out to its edge, with a shove along the way so the scatter is loose. */
  const scatter = (x: number, y: number): void => {
    for (let i = 0; i < count; i += 1) {
      const dx = (pos[2 * i] as number) - x;
      const dy = (pos[2 * i + 1] as number) - y;
      const distance = Math.hypot(dx, dy);
      if (distance >= RADIUS) continue;
      const angle = distance < 0.001 ? i * 2.399963 : Math.atan2(dy, dx);
      const push = RADIUS - distance;
      pos[2 * i] = (pos[2 * i] as number) + Math.cos(angle) * push * 0.9;
      pos[2 * i + 1] = (pos[2 * i + 1] as number) + Math.sin(angle) * push * 0.9;
      vel[2 * i] = (vel[2 * i] as number) + Math.cos(angle) * push * 2;
      vel[2 * i + 1] = (vel[2 * i + 1] as number) + Math.sin(angle) * push * 2;
    }
  };

  const tick = (now: number): void => {
    const dt = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 0.05);
    last = now;
    if (pointer) scatter(pointer.x, pointer.y);
    let moving = false;
    for (let i = 0; i < 2 * count; i += 1) {
      const offset = (home[i] as number) - (pos[i] as number);
      const speed = vel[i] as number;
      if (Math.abs(offset) < SETTLED && Math.abs(speed) < SETTLED) {
        pos[i] = home[i] as number;
        vel[i] = 0;
        continue;
      }
      moving = true;
      const next = speed + (OMEGA * OMEGA * offset - 2 * OMEGA * speed) * dt;
      vel[i] = next;
      pos[i] = (pos[i] as number) + next * dt;
    }
    draw();
    const near = pointer !== null;
    if (moving || near) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      last = 0;
    }
  };

  const wake = (): void => {
    if (frame === 0) frame = requestAnimationFrame(tick);
  };

  const onMove = (event: PointerEvent): void => {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const inside = x > -RADIUS && x < width + RADIUS && y > -RADIUS && y < height + RADIUS;
    pointer = inside ? { x, y } : null;
    if (pointer) scatter(x, y);
    wake();
  };

  window.addEventListener("pointermove", onMove);
  return {
    destroy: () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      gl.deleteBuffer(buffer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
