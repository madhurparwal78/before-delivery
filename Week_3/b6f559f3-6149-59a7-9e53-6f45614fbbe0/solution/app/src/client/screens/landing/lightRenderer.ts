/** Draws the Follow Light volume: a WebGL2 fragment shader, or flat gradients on a 2D canvas. */

export interface LightFrame {
  /** 0..1, how far the light has risen. */
  level: number;
  /** Light focus in stage fractions, rest 0.8, 0.9. */
  x: number;
  y: number;
}

/** The headline stack in canvas pixels: the glow behind it is capped so the text keeps its contrast. */
export interface TextBox {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
}

export interface LightRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  resize: (width: number, height: number) => void;
  draw: (frame: LightFrame, text: TextBox) => void;
  dispose: () => void;
}

/** The brightest colour allowed behind the text stack. */
const CAP: [number, number, number] = [0x4c / 255, 0x3c / 255, 0x80 / 255];

const VERTEX = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_level;
uniform vec2 u_focus;
uniform vec4 u_text;
uniform vec3 u_cap;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = frag / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - u_focus) * vec2(aspect, 1.0);
  float d = length(p);
  vec2 dir = p / max(d, 0.0001);
  float warp = fbm(p * 2.2 + 3.0);
  float streak = fbm(dir * 2.6 + vec2(warp * 1.6 + d * 1.1, warp * 0.8 - d * 0.6));
  float rays = smoothstep(0.28, 0.82, streak);
  float haze = exp(-d * 1.55);
  float core = exp(-d * d * 10.0);
  float field = (haze * (0.3 + 0.95 * rays) + core * 0.7) * u_level;
  vec3 accent = vec3(0.557, 0.424, 0.949);
  vec3 pale = vec3(0.718, 0.643, 1.0);
  vec3 glow = mix(accent, pale, smoothstep(0.7, 1.9, field)) * smoothstep(0.0, 1.0, field);
  float grain = (hash(floor(frag)) - 0.5) * 0.07 * smoothstep(0.02, 0.35, field);
  vec3 colour = clamp(glow + grain, 0.0, 1.0);
  vec2 q = (frag - u_text.xy) / u_text.zw;
  float mask = 1.0 - smoothstep(0.85, 1.5, length(q));
  colour = min(colour, mix(vec3(1.0), u_cap, mask));
  outColor = vec4(colour, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function webglRenderer(canvas: HTMLCanvasElement): LightRenderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  const res = uniform('u_res');
  const level = uniform('u_level');
  const focus = uniform('u_focus');
  const text = uniform('u_text');
  const cap = uniform('u_cap');
  gl.uniform3f(cap, ...CAP);
  return {
    kind: 'webgl2',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    },
    draw(frame, box) {
      gl.uniform2f(res, canvas.width, canvas.height);
      gl.uniform1f(level, frame.level);
      gl.uniform2f(focus, frame.x, frame.y);
      gl.uniform4f(text, box.cx, box.cy, box.hx, box.hy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

function noiseTile(): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const context = tile.getContext('2d') as CanvasRenderingContext2D;
  const image = context.createImageData(128, 128);
  let seed = 7;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const v = (seed >>> 24) & 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return tile;
}

function canvasRenderer(canvas: HTMLCanvasElement): LightRenderer | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const grain = noiseTile();
  const rgb = (c: readonly number[], alpha = 1): string => `rgba(${Math.round(c[0] as number * 255)}, ${Math.round(c[1] as number * 255)}, ${Math.round(c[2] as number * 255)}, ${alpha})`;
  const accent = [0.557, 0.424, 0.949] as const;
  const pale = [0.718, 0.643, 1] as const;
  return {
    kind: 'canvas2d',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    draw(frame, box) {
      const { width, height } = canvas;
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      const fx = frame.x * width;
      const fy = frame.y * height;
      const reach = Math.hypot(width, height) * 0.75;
      context.globalCompositeOperation = 'lighter';
      const haze = context.createRadialGradient(fx, fy, 0, fx, fy, reach);
      haze.addColorStop(0, rgb(pale, 0.7 * frame.level));
      haze.addColorStop(0.18, rgb(accent, 0.34 * frame.level));
      haze.addColorStop(0.55, rgb(accent, 0.08 * frame.level));
      haze.addColorStop(1, rgb(accent, 0));
      context.fillStyle = haze;
      context.fillRect(0, 0, width, height);
      const rays = 22;
      for (let i = 0; i < rays; i++) {
        const t = (i + 0.5) / rays;
        const angle = Math.PI * (1.02 + 0.4 * t) + Math.sin(i * 12.9898) * 0.04;
        const spread = 0.012 + 0.016 * ((Math.sin(i * 78.233) + 1) / 2);
        const gradient = context.createRadialGradient(fx, fy, 0, fx, fy, reach);
        gradient.addColorStop(0, rgb(pale, 0.16 * Math.sin(Math.PI * t) * frame.level));
        gradient.addColorStop(1, rgb(accent, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(fx, fy);
        context.lineTo(fx + Math.cos(angle - spread) * reach, fy + Math.sin(angle - spread) * reach);
        context.lineTo(fx + Math.cos(angle + spread) * reach, fy + Math.sin(angle + spread) * reach);
        context.closePath();
        context.fill();
      }
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 0.07 * frame.level;
      context.fillStyle = context.createPattern(grain, 'repeat') as CanvasPattern;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'darken';
      context.save();
      context.translate(box.cx, box.cy);
      context.scale(box.hx, box.hy);
      const cap = context.createRadialGradient(0, 0, 0, 0, 0, 1.5);
      cap.addColorStop(0, rgb(CAP));
      cap.addColorStop(0.85 / 1.5, rgb(CAP));
      cap.addColorStop(1, 'rgb(255, 255, 255)');
      context.fillStyle = cap;
      context.fillRect(-2, -2, 4, 4);
      context.restore();
      context.globalCompositeOperation = 'source-over';
    },
    dispose() {},
  };
}

/** WebGL2 when available, otherwise the 2D canvas. A canvas keeps its first kind of context, so each try gets its own. */
export function createLightRenderer(host: HTMLElement): { canvas: HTMLCanvasElement; renderer: LightRenderer } | null {
  for (const make of [webglRenderer, canvasRenderer]) {
    const canvas = document.createElement('canvas');
    canvas.className = 'stage-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    const renderer = make(canvas);
    if (renderer) return { canvas, renderer };
    canvas.remove();
  }
  return null;
}
