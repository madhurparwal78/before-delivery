// The procedural acoustic-panel corridor. Each station's geometry is generated from its slug: wedge foam,
// slatted diffusers and corner bass traps line the walls, and a skyline diffuser closes the far end.
// WebGL renders it on demand (camera dolly and panel glow only); without WebGL the same geometry is
// drawn once onto a 2D canvas as a still.

type Vec3 = [number, number, number];
type Mat4 = Float32Array;

const GROUND: Vec3 = [0x12 / 255, 0x14 / 255, 0x09 / 255];
const GLOW: Vec3 = [0x58 / 255, 0xa8 / 255, 0x8c / 255];
const LENGTH = 36;
const HALF_WIDTH = 3.2;
const HEIGHT = 4.2;
const DOLLY_MS = 900;
const GLOW_MS = 400;

interface Shot {
  eye: Vec3;
  target: Vec3;
  fov: number;
}

const WIDE: Shot = { eye: [0, 2.1, 7], target: [0, 1.9, -LENGTH], fov: 68 };
const CLOSE: Shot = { eye: [0.35, 2.05, -LENGTH + 9], target: [0, 2.1, -LENGTH], fov: 46 };

class Mesh {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly glows: number[] = [];

  triangle(a: Vec3, b: Vec3, c: Vec3, color: Vec3, glow: number): void {
    const u = sub(b, a);
    const v = sub(c, a);
    const n = normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    for (const p of [a, b, c]) {
      this.positions.push(...p);
      this.normals.push(...n);
      this.colors.push(...color);
      this.glows.push(glow);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3, glow = 0): void {
    this.triangle(a, b, c, color, glow);
    this.triangle(a, c, d, color, glow);
  }

  /** An axis-aligned box from min to max (only the five faces that can be seen from the corridor). */
  box(min: Vec3, max: Vec3, color: Vec3, glow = 0): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, glow);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(color, 0.85), glow);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(color, 0.85), glow);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], shade(color, 1.1), glow);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(color, 0.7), glow);
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function shade(color: Vec3, factor: number): Vec3 {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function seeded(slug: string): () => number {
  let state = 2166136261;
  for (const character of slug) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OLIVE: Vec3[] = [[0.2, 0.215, 0.15], [0.235, 0.25, 0.175], [0.17, 0.185, 0.125], [0.27, 0.265, 0.2]];

/** Wedge foam on one wall: rows of ridged wedges whose ridges alternate direction tile by tile. */
function wedgeFoam(mesh: Mesh, side: 1 | -1, z0: number, z1: number, color: Vec3, depth: number): void {
  const wall = side * HALF_WIDTH;
  const tile = (z1 - z0) / 4;
  for (let row = 0; row < 6; row += 1) {
    const y0 = 0.6 + row * 0.55;
    const y1 = y0 + 0.55;
    for (let col = 0; col < 4; col += 1) {
      const za = z0 + col * tile;
      const zb = za + tile;
      const tip = wall - side * depth;
      const vertical = (row + col) % 2 === 0;
      const tone = shade(color, 0.92 + ((row * 3 + col) % 4) * 0.04);
      const ridges = 3;
      for (let r = 0; r < ridges; r += 1) {
        if (vertical) {
          const a = za + (r * tile) / ridges;
          const b = a + tile / ridges;
          const m = (a + b) / 2;
          mesh.quad([wall, y0, a], [wall, y1, a], [tip, y1, m], [tip, y0, m], shade(tone, 1.08));
          mesh.quad([tip, y0, m], [tip, y1, m], [wall, y1, b], [wall, y0, b], shade(tone, 0.82));
        } else {
          const a = y0 + (r * (y1 - y0)) / ridges;
          const b = a + (y1 - y0) / ridges;
          const m = (a + b) / 2;
          mesh.quad([wall, a, za], [tip, m, za], [tip, m, zb], [wall, a, zb], shade(tone, 0.8));
          mesh.quad([tip, m, za], [wall, b, za], [wall, b, zb], [tip, m, zb], shade(tone, 1.12));
        }
      }
    }
  }
}

/** A slatted diffuser: vertical slats of quadratic-residue depths with a glowing edge strip. */
function slattedDiffuser(mesh: Mesh, side: 1 | -1, z0: number, z1: number, color: Vec3, prime: number): void {
  const wall = side * HALF_WIDTH;
  const count = 13;
  const width = (z1 - z0) / count;
  for (let i = 0; i < count; i += 1) {
    const depth = 0.08 + ((i * i) % prime) / prime * 0.5;
    const za = z0 + i * width + width * 0.12;
    const zb = za + width * 0.76;
    const inner = wall - side * depth;
    const [xa, xb] = side > 0 ? [inner, wall] : [wall, inner];
    mesh.box([xa, 0.5, za], [xb, 3.7, zb], shade(color, 0.95 + (i % 3) * 0.05), i % 4 === 0 ? 1 : 0.25);
  }
}

/** Bass traps: triangular prisms running along the floor and ceiling corners of one wall. */
function bassTraps(mesh: Mesh, side: 1 | -1, z0: number, z1: number, color: Vec3): void {
  const wall = side * HALF_WIDTH;
  const reach = 0.75;
  mesh.quad([wall, reach, z1], [wall - side * reach, 0, z1], [wall - side * reach, 0, z0], [wall, reach, z0], shade(color, 1.05), 0.5);
  mesh.quad([wall, HEIGHT - reach, z0], [wall - side * reach, HEIGHT, z0], [wall - side * reach, HEIGHT, z1], [wall, HEIGHT - reach, z1], shade(color, 0.75), 0.5);
}

/**
 * The station's own panel at the far end: a skyline diffuser of narrow square columns, tiled in
 * prime-by-prime modules whose column depths step with (i² + j²) mod p, so the key light picks out each step.
 */
function skyline(mesh: Mesh, random: () => number, color: Vec3): void {
  const z = -LENGTH;
  const prime = random() < 0.5 ? 7 : 11;
  const column = prime === 7 ? 0.2 : 0.14;
  const reach = 0.25 + random() * 0.35;
  const across = Math.floor((HALF_WIDTH * 2 - 0.4) / column);
  const up = Math.floor((HEIGHT - 0.6) / column);
  const x0 = -(across * column) / 2;
  const y0 = 0.3;
  for (let row = 0; row < up; row += 1) {
    for (let col = 0; col < across; col += 1) {
      const i = col % prime;
      const j = row % prime;
      const step = ((i * i + j * j) % prime) / (prime - 1);
      const depth = 0.04 + step * reach;
      const x = x0 + col * column;
      const y = y0 + row * column;
      mesh.box([x + 0.008, y + 0.008, z], [x + column - 0.008, y + column - 0.008, z + depth],
        shade(color, 0.8 + step * 0.45), step > 0.8 ? 1 : 0.3);
    }
  }
}

/** A quadratic-residue diffuser across the end wall: deep vertical wells of seeded prime. */
function residueWall(mesh: Mesh, random: () => number, color: Vec3): void {
  const z = -LENGTH;
  const prime = [7, 11, 13, 17][Math.floor(random() * 4)] ?? 7;
  const wells = prime * 2;
  const width = (HALF_WIDTH * 2 - 0.4) / wells;
  for (let i = 0; i < wells; i += 1) {
    const depth = 0.1 + (((i * i) % prime) / prime) * 1.4;
    const x0 = -HALF_WIDTH + 0.2 + i * width;
    mesh.box([x0 + 0.015, 0.3, z], [x0 + width - 0.015, HEIGHT - 0.3, z + depth], shade(color, 0.85 + depth * 0.2), i % 3 === 0 ? 1 : 0.3);
  }
}

/** A wall of large wedge-foam tiles at the far end, ridges alternating tile by tile. */
function foamWall(mesh: Mesh, random: () => number, color: Vec3): void {
  const z = -LENGTH;
  const tiles = 3 + Math.floor(random() * 3);
  const size = (HALF_WIDTH * 2 - 0.4) / tiles;
  const depth = 0.35 + random() * 0.4;
  for (let row = 0; row * size < HEIGHT - 0.4; row += 1) {
    for (let col = 0; col < tiles; col += 1) {
      const x0 = -HALF_WIDTH + 0.2 + col * size;
      const y0 = 0.2 + row * size;
      const y1 = Math.min(HEIGHT - 0.2, y0 + size);
      const ridges = 4;
      for (let r = 0; r < ridges; r += 1) {
        const tone = shade(color, 0.9 + ((row + col) % 2) * 0.12);
        if ((row + col) % 2 === 0) {
          const a = x0 + (r * size) / ridges;
          const b = a + size / ridges;
          const m = (a + b) / 2;
          mesh.quad([a, y0, z], [m, y0, z + depth], [m, y1, z + depth], [a, y1, z], shade(tone, 1.1), r === 0 ? 0.6 : 0.2);
          mesh.quad([m, y0, z + depth], [b, y0, z], [b, y1, z], [m, y1, z + depth], shade(tone, 0.8), 0.2);
        } else {
          const a = y0 + (r * (y1 - y0)) / ridges;
          const b = a + (y1 - y0) / ridges;
          const m = (a + b) / 2;
          mesh.quad([x0, a, z], [x0 + size, a, z], [x0 + size, m, z + depth], [x0, m, z + depth], shade(tone, 0.75), 0.2);
          mesh.quad([x0, m, z + depth], [x0 + size, m, z + depth], [x0 + size, b, z], [x0, b, z], shade(tone, 1.15), r === 0 ? 0.6 : 0.2);
        }
      }
    }
  }
}

function corridorMesh(slug: string): Mesh {
  const random = seeded(slug);
  const lean = Math.floor(random() * 3);
  const endWall = [skyline, residueWall, foamWall][Math.floor(random() * 3)] ?? skyline;
  const mesh = new Mesh();
  const floor: Vec3 = [0.1, 0.11, 0.07];
  mesh.quad([-HALF_WIDTH, 0, 8], [HALF_WIDTH, 0, 8], [HALF_WIDTH, 0, -LENGTH], [-HALF_WIDTH, 0, -LENGTH], floor);
  mesh.quad([-HALF_WIDTH, HEIGHT, -LENGTH], [HALF_WIDTH, HEIGHT, -LENGTH], [HALF_WIDTH, HEIGHT, 8], [-HALF_WIDTH, HEIGHT, 8], shade(floor, 0.8));
  mesh.quad([-HALF_WIDTH, 0, -LENGTH], [HALF_WIDTH, 0, -LENGTH], [HALF_WIDTH, HEIGHT, -LENGTH], [-HALF_WIDTH, HEIGHT, -LENGTH], shade(floor, 1.2));
  for (let i = 0; i < 6; i += 1) {
    const z = -LENGTH + 1 + i * 0.5;
    mesh.quad([-HALF_WIDTH, 0.002, z], [HALF_WIDTH, 0.002, z], [HALF_WIDTH, 0.002, z - 0.04], [-HALF_WIDTH, 0.002, z - 0.04], shade(floor, 1.6), 0.15);
  }
  // Each station leans on one treatment: mostly foam, mostly slats, or mostly traps and flat absorbers.
  const weights = [[0.7, 0.9], [0.15, 0.85], [0.3, 0.55]][lean] ?? [0.4, 0.75];
  const segment = 4 + Math.floor(random() * 3);
  for (const side of [-1, 1] as const) {
    for (let z1 = 8; z1 > -LENGTH + 0.5; z1 -= segment) {
      const z0 = Math.max(-LENGTH, z1 - segment);
      const color = OLIVE[Math.floor(random() * OLIVE.length)] ?? OLIVE[0] as Vec3;
      const pick = random();
      if (pick < (weights[0] ?? 0.4)) wedgeFoam(mesh, side, z0, z1, color, 0.18 + random() * 0.14);
      else if (pick < (weights[1] ?? 0.75)) slattedDiffuser(mesh, side, z0, z1, color, [7, 11, 13][Math.floor(random() * 3)] ?? 7);
      else mesh.box([side > 0 ? HALF_WIDTH - 0.06 : -HALF_WIDTH, 0.4, z0 + 0.1], [side > 0 ? HALF_WIDTH : -HALF_WIDTH + 0.06, 3.8, z1 - 0.1], shade(color, 0.8), 0.2);
      if (random() < (lean === 2 ? 0.9 : 0.4)) bassTraps(mesh, side, z0, z1, shade(color, 0.9));
    }
  }
  const endColor = OLIVE[Math.floor(random() * OLIVE.length)] ?? OLIVE[1] as Vec3;
  endWall(mesh, random, endColor);
  return mesh;
}

// ---- Matrices ----

function perspective(fovDegrees: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: Vec3, target: Vec3): Mat4 {
  const z = normalize(sub(eye, target));
  const x = normalize([z[2], 0, -z[0]]);
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixVec = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
/** Starts quickly and settles gently, matching cubic-bezier(0.16, 1, 0.3, 1). */
const settle = (t: number): number => 1 - (1 - t) ** 4;

// ---- Renderers ----

const VERTEX = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor; attribute float aGlow;
uniform mat4 uProjection; uniform mat4 uView;
varying vec3 vColor; varying vec3 vNormal; varying float vGlow; varying float vDepth;
void main() {
  vec4 view = uView * vec4(aPosition, 1.0);
  gl_Position = uProjection * view;
  vColor = aColor; vNormal = aNormal; vGlow = aGlow; vDepth = -view.z;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uFog; uniform vec3 uGlowColor; uniform float uGlow;
varying vec3 vColor; varying vec3 vNormal; varying float vGlow; varying float vDepth;
void main() {
  vec3 key = normalize(vec3(0.35, 0.8, 0.45));
  float light = 0.38 + 0.62 * max(dot(normalize(vNormal), key), 0.0);
  vec3 color = vColor * light + uGlowColor * vGlow * uGlow * 0.7;
  float fog = smoothstep(4.0, 44.0, vDepth);
  gl_FragColor = vec4(mix(color, uFog, fog), 1.0);
}`;

interface Animation {
  from: number;
  to: number;
  start: number;
  duration: number;
}

interface Corridor {
  /** Shows the station's corridor; `close` dollies the camera in, otherwise out to the wide shot. */
  show(slug: string, close: boolean, instant: boolean): void;
  /** Panel glow, 0 to 1, for the share of active layers. */
  glow(strength: number, instant: boolean): void;
}

function sample(animation: Animation, now: number): number {
  const t = animation.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - animation.start) / animation.duration));
  return mix(animation.from, animation.to, settle(t));
}

function shotAt(closeness: number): Shot {
  return {
    eye: mixVec(WIDE.eye, CLOSE.eye, closeness),
    target: mixVec(WIDE.target, CLOSE.target, closeness),
    fov: mix(WIDE.fov, CLOSE.fov, closeness),
  };
}

function webgl(canvas: HTMLCanvasElement): Corridor | null {
  const gl = canvas.getContext("webgl", { antialias: true, depth: true, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const projection = uniform("uProjection");
  const view = uniform("uView");
  const glowUniform = uniform("uGlow");
  gl.uniform3fv(uniform("uFog"), GROUND);
  gl.uniform3fv(uniform("uGlowColor"), GLOW);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);

  const meshes = new Map<string, { buffers: WebGLBuffer[]; count: number }>();
  const upload = (slug: string) => {
    let found = meshes.get(slug);
    if (!found) {
      const mesh = corridorMesh(slug);
      const buffers = [mesh.positions, mesh.normals, mesh.colors, mesh.glows].map((data) => {
        const buffer = gl.createBuffer() as WebGLBuffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return buffer;
      });
      found = { buffers, count: mesh.glows.length };
      meshes.set(slug, found);
    }
    return found;
  };
  const attributes = ["aPosition", "aNormal", "aColor", "aGlow"].map((name) => gl.getAttribLocation(program, name));

  let slug = "";
  let camera: Animation = { from: 0, to: 0, start: 0, duration: 0 };
  let glow: Animation = { from: 0, to: 0, start: 0, duration: 0 };
  let frame = 0;

  const draw = (): void => {
    frame = 0;
    const now = performance.now();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!slug) return;
    const shot = shotAt(sample(camera, now));
    gl.uniformMatrix4fv(projection, false, perspective(shot.fov, width / Math.max(1, height), 0.1, 80));
    gl.uniformMatrix4fv(view, false, lookAt(shot.eye, shot.target));
    gl.uniform1f(glowUniform, sample(glow, now));
    const mesh = upload(slug);
    mesh.buffers.forEach((buffer, i) => {
      const location = attributes[i] ?? -1;
      if (location < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, i === 3 ? 1 : 3, gl.FLOAT, false, 0, 0);
    });
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (now < camera.start + camera.duration || now < glow.start + glow.duration) request();
  };
  const request = (): void => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  window.addEventListener("resize", request);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") request();
  });

  return {
    show(next, close, instant) {
      const now = performance.now();
      const current = slug === next ? sample(camera, now) : 0;
      slug = next;
      camera = { from: current, to: close ? 1 : 0, start: now, duration: instant ? 0 : DOLLY_MS };
      request();
    },
    glow(strength, instant) {
      const now = performance.now();
      glow = { from: sample(glow, now), to: strength, start: now, duration: instant ? 0 : GLOW_MS };
      request();
    },
  };
}

/** The no-WebGL still: the same geometry projected and painted back to front on a 2D canvas. */
function still(canvas: HTMLCanvasElement): Corridor {
  const context = canvas.getContext("2d");
  let slug = "";
  const paint = (): void => {
    if (!context || !slug) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    const { width, height } = canvas;
    context.fillStyle = "#121409";
    context.fillRect(0, 0, width, height);
    const mesh = corridorMesh(slug);
    const projection = perspective(WIDE.fov, width / height, 0.1, 80);
    const viewMatrix = lookAt(WIDE.eye, WIDE.target);
    const project = (i: number): [number, number, number] | null => {
      const p = mesh.positions;
      const x = p[i] ?? 0, y = p[i + 1] ?? 0, z = p[i + 2] ?? 0;
      const v = (k: number): number => viewMatrix[k] ?? 0;
      const vx = v(0) * x + v(4) * y + v(8) * z + v(12);
      const vy = v(1) * x + v(5) * y + v(9) * z + v(13);
      const vz = v(2) * x + v(6) * y + v(10) * z + v(14);
      if (vz > -0.1) return null;
      const w = -vz;
      return [((projection[0] ?? 1) * vx / w + 1) * width / 2, (1 - (projection[5] ?? 1) * vy / w) * height / 2, w];
    };
    const triangles: { points: [number, number][]; depth: number; color: string }[] = [];
    for (let t = 0; t < mesh.glows.length; t += 3) {
      const corners = [project(t * 3), project(t * 3 + 3), project(t * 3 + 6)];
      if (corners.some((c) => c === null)) continue;
      const pts = corners as [[number, number, number], [number, number, number], [number, number, number]];
      const n: Vec3 = [mesh.normals[t * 3] ?? 0, mesh.normals[t * 3 + 1] ?? 0, mesh.normals[t * 3 + 2] ?? 0];
      const light = 0.38 + 0.62 * Math.max(0, n[0] * 0.36 + n[1] * 0.82 + n[2] * 0.46);
      const depth = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
      const fog = Math.min(1, Math.max(0, (depth - 4) / 40));
      const channel = (k: number): number =>
        Math.round(255 * mix((mesh.colors[t * 3 + k] ?? 0) * light, GROUND[k] ?? 0, fog));
      triangles.push({
        points: pts.map(([x, y]) => [x, y] as [number, number]),
        depth,
        color: `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`,
      });
    }
    triangles.sort((a, b) => b.depth - a.depth);
    for (const triangle of triangles) {
      const [a, b, c] = triangle.points as [[number, number], [number, number], [number, number]];
      context.beginPath();
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.lineTo(c[0], c[1]);
      context.closePath();
      context.fillStyle = triangle.color;
      context.strokeStyle = triangle.color;
      context.fill();
      context.stroke();
    }
  };
  window.addEventListener("resize", paint);
  return {
    show(next) {
      if (next === slug) return;
      slug = next;
      paint();
    },
    glow() {
      // The still holds; only the WebGL corridor glows.
    },
  };
}

export function createCorridor(canvas: HTMLCanvasElement): Corridor {
  return webgl(canvas) ?? still(canvas);
}
