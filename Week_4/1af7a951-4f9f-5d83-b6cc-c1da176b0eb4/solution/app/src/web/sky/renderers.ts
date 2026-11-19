import { CATEGORIES } from "../../shared/api";
import { anchorPoint, constellationLines, placeStars, TEAL, tweenAt, type SkyScene } from "./scene";

// Two ways to draw the same scene: WebGL with drifting fog, and a still 2D picture when WebGL is missing.

export interface SkyRenderer {
  readonly animated: boolean;
  draw(scene: SkyScene, width: number, height: number, ratio: number, now: number, fogSeconds: number): void;
  dispose(): void;
}

const FULLSCREEN_VERTEX = `
attribute vec2 a_corner;
void main() { gl_Position = vec4(a_corner, 0.0, 1.0); }`;

const BACKDROP_FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform vec2 u_pan;
uniform float u_ratio;
uniform float u_drift;
uniform vec3 u_halo[4];
const vec3 TEAL = vec3(${TEAL.join(", ")});
// A lattice corner's gradient direction from a sine-free hash: sin() of large arguments loses precision on some
// GPUs and software rasterisers, which shows as vertical streaks in the fog.
vec2 slope(vec2 i) {
  vec3 p = fract(vec3(i.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  float angle = fract((p.x + p.y) * p.z) * 6.2831853;
  return vec2(cos(angle), sin(angle));
}
// Gradient noise: no flat plateau at the lattice points, so its contours never trace the grid as squares.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(slope(i), f);
  float b = dot(slope(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(slope(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(slope(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return 0.5 + 0.7 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Each octave is turned and shifted off the one before, so no lattice edges line up into squares.
const mat2 TURN = mat2(0.8, -0.6, 0.6, 0.8);
float fog(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(p);
    p = TURN * p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y * u_ratio - gl_FragCoord.y) / u_ratio;
  vec2 uv = px / u_res;
  vec3 colour = mix(vec3(0.030, 0.027, 0.095), vec3(0.070, 0.055, 0.190), smoothstep(0.0, 1.0, uv.y));
  colour += vec3(0.060, 0.040, 0.150) * smoothstep(0.55, 1.0, uv.y) * 0.6;
  // One drift cycle is a closed loop through the fog field, so the cycle repeats without a seam.
  float turn = u_drift * 6.2831853;
  vec2 drift = vec2(cos(turn), sin(turn) * 0.35) * 1.6;
  vec2 q = (px - u_pan * 0.6) / 240.0 + drift;
  // A gentle warp turns the noise into wisps instead of blobs.
  float density = fog(q + vec2(fog(q * 0.7 + 3.1), fog(q * 0.7 + 7.4)) * 1.15);
  float wisps = smoothstep(0.38, 0.82, density);
  colour += vec3(0.48, 0.36, 0.90) * wisps * 0.20;
  for (int i = 0; i < 4; i++) {
    vec3 halo = u_halo[i];
    float d = distance(px, halo.xy);
    float glow = exp(-pow(d / (halo.z * 1.25), 2.0)) * 0.36;
    float bloom = exp(-pow(d / (halo.z * 3.0), 2.0)) * 0.07;
    colour += TEAL * (glow + bloom);
  }
  // Half a step of interleaved-gradient dither hides the 8-bit bands of a dark, slow gradient without tracing a grid.
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  colour += (dither - 0.5) / 255.0;
  gl_FragColor = vec4(colour, 1.0);
}`;

const STAR_VERTEX = `
attribute vec2 a_position;
attribute float a_size;
attribute float a_alpha;
uniform vec2 u_res;
uniform float u_ratio;
uniform mat4 u_view;
varying float v_alpha;
void main() {
  vec4 world = u_view * vec4(a_position, 0.0, 1.0);
  vec2 clip = world.xy / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = a_size * 4.0 * u_ratio;
  v_alpha = a_alpha;
}`;

const STAR_FRAGMENT = `
precision mediump float;
varying float v_alpha;
uniform float u_line;
const vec3 TEAL = vec3(${TEAL.join(", ")});
void main() {
  if (u_line > 0.5) {
    gl_FragColor = vec4(TEAL, 0.24 * v_alpha);
    return;
  }
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.26, 0.0, d);
  float glow = exp(-d * d * 7.0) * 0.55;
  vec3 colour = mix(TEAL, vec3(0.86, 1.0, 0.97), core * 0.55);
  gl_FragColor = vec4(colour, (core + glow) * v_alpha);
}`;

function compile(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader allocation failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  return program;
}

function translation(x: number, y: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1]);
}

export function webglRenderer(canvas: HTMLCanvasElement): SkyRenderer | null {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true, premultipliedAlpha: false });
  if (!gl) return null;
  const backdrop = compile(gl, FULLSCREEN_VERTEX, BACKDROP_FRAGMENT);
  const stars = compile(gl, STAR_VERTEX, STAR_FRAGMENT);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const points = gl.createBuffer();
  const uniform = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
  const attribute = (program: WebGLProgram, name: string) => gl.getAttribLocation(program, name);

  return {
    animated: true,
    draw(scene, width, height, ratio, now, fogSeconds) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(backdrop);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      const corner = attribute(backdrop, "a_corner");
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uniform(backdrop, "u_res"), width, height);
      gl.uniform2f(uniform(backdrop, "u_pan"), scene.pan.x, scene.pan.y);
      gl.uniform1f(uniform(backdrop, "u_ratio"), ratio);
      gl.uniform1f(uniform(backdrop, "u_drift"), (fogSeconds % 60) / 60);
      const halos = CATEGORIES.flatMap((category) => {
        const anchor = anchorPoint(category, width, height, scene.clearRight);
        return [anchor.x + scene.pan.x, anchor.y + scene.pan.y, tweenAt(scene.halos[category], now)];
      });
      gl.uniform3fv(uniform(backdrop, "u_halo"), new Float32Array(halos));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(corner);

      const placed = placeStars(scene, width, height, now);
      const lines = constellationLines(placed, width, height, scene.clearRight);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(stars);
      gl.uniform2f(uniform(stars, "u_res"), width, height);
      gl.uniform1f(uniform(stars, "u_ratio"), ratio);
      gl.uniformMatrix4fv(uniform(stars, "u_view"), false, translation(scene.pan.x, scene.pan.y));
      const position = attribute(stars, "a_position");
      const size = attribute(stars, "a_size");
      const alpha = attribute(stars, "a_alpha");
      gl.bindBuffer(gl.ARRAY_BUFFER, points);
      for (const location of [position, size, alpha]) gl.enableVertexAttribArray(location);
      const stride = 16;
      const bind = () => {
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(size, 1, gl.FLOAT, false, stride, 8);
        gl.vertexAttribPointer(alpha, 1, gl.FLOAT, false, stride, 12);
      };
      if (lines.length > 0) {
        gl.uniform1f(uniform(stars, "u_line"), 1);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines.flatMap(([a, b]) => [a.x, a.y, 1, Math.min(a.alpha, b.alpha), b.x, b.y, 1, Math.min(a.alpha, b.alpha)])), gl.DYNAMIC_DRAW);
        bind();
        gl.drawArrays(gl.LINES, 0, lines.length * 2);
      }
      if (placed.length > 0) {
        gl.uniform1f(uniform(stars, "u_line"), 0);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(placed.flatMap((star) => [star.x, star.y, star.size, star.alpha])), gl.DYNAMIC_DRAW);
        bind();
        gl.drawArrays(gl.POINTS, 0, placed.length);
      }
      for (const location of [position, size, alpha]) gl.disableVertexAttribArray(location);
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const css = (rgb: readonly number[], alpha: number): string =>
  `rgba(${rgb.map((v) => Math.round(v * 255)).join(", ")}, ${alpha})`;

/** The still picture: the same stars and halos at the same places, the fog held still. */
export function flatRenderer(canvas: HTMLCanvasElement): SkyRenderer {
  const context = canvas.getContext("2d");
  return {
    animated: false,
    draw(scene, width, height, ratio, now) {
      if (!context) return;
      const ctx = context;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const ground = ctx.createLinearGradient(0, 0, 0, height);
      ground.addColorStop(0, "#08071a");
      ground.addColorStop(1, "#140f33");
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, width, height);
      const random = seeded(7);
      ctx.save();
      ctx.translate(scene.pan.x * 0.6, scene.pan.y * 0.6);
      for (let i = 0; i < 26; i++) {
        const x = (random() * 1.6 - 0.3) * width;
        const y = (random() * 1.6 - 0.3) * height;
        const r = (0.12 + random() * 0.22) * Math.max(width, height);
        const wisp = ctx.createRadialGradient(x, y, 0, x, y, r);
        wisp.addColorStop(0, "rgba(123, 92, 230, 0.10)");
        wisp.addColorStop(1, "rgba(123, 92, 230, 0)");
        ctx.fillStyle = wisp;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(scene.pan.x, scene.pan.y);
      for (const category of CATEGORIES) {
        const anchor = anchorPoint(category, width, height, scene.clearRight);
        const radius = tweenAt(scene.halos[category], now);
        const halo = ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, radius * 2.2);
        halo.addColorStop(0, css(TEAL, 0.32));
        halo.addColorStop(0.45, css(TEAL, 0.14));
        halo.addColorStop(1, css(TEAL, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, radius * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const placed = placeStars(scene, width, height, now);
      ctx.lineWidth = 1;
      for (const [a, b] of constellationLines(placed, width, height, scene.clearRight)) {
        ctx.strokeStyle = css(TEAL, 0.24 * Math.min(a.alpha, b.alpha));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const star of placed) {
        const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.size * 2);
        glow.addColorStop(0, `rgba(220, 255, 248, ${star.alpha})`);
        glow.addColorStop(0.3, css(TEAL, 0.8 * star.alpha));
        glow.addColorStop(1, css(TEAL, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    dispose() {},
  };
}
