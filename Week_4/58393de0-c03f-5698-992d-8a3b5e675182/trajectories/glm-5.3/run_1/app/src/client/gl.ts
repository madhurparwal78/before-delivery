// Minimal WebGL renderer for boxes, cylinders and spheres used by the
// editors, previews and the Glancet viewer. Own browser code; no libraries.

export interface CameraState { azimuth: number; elevation: number; distance: number; target: [number, number, number] }

export const DEFAULT_CAMERA: CameraState = { azimuth: 45, elevation: 35, distance: 200, target: [0, 0, 10] };

export interface GlContext {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  aPos: number;
  aNormal: number;
  uProj: WebGLUniformLocation | null;
  uView: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uLight: WebGLUniformLocation | null;
  uMode: WebGLUniformLocation | null;
  uShift: WebGLUniformLocation | null;
}

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uShift;
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vec4 world = uView * vec4(aPos + uShift, 1.0);
  vPos = world.xyz;
  vNormal = mat3(uView[0].xyz, uView[1].xyz, uView[2].xyz) * aNormal;
  gl_Position = uProj * world;
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vPos;
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uMode;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 lightDir = normalize(uLight - vPos);
  float diff = max(dot(n, lightDir), 0.15);
  float rim = pow(1.0 - max(dot(n, normalize(-vPos)), 0.0), 2.0) * 0.25;
  vec3 col = uColor * (0.35 + 0.75 * diff) + rim;
  if (uMode > 0.5) {
    // hole: translucent grey with diagonal stripe hint via screen-space bands
    float band = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 14.0));
    col = mix(vec3(0.62, 0.66, 0.74) * 0.9, vec3(0.5, 0.54, 0.62), band);
  }
  gl_FragColor = vec4(col, uMode > 0.5 ? 0.55 : 1.0);
}`;

export function createContext(canvas: HTMLCanvasElement): GlContext | null {
  const gl = (canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: true })
    ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return {
    gl, program,
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    uProj: gl.getUniformLocation(program, 'uProj'),
    uView: gl.getUniformLocation(program, 'uView'),
    uColor: gl.getUniformLocation(program, 'uColor'),
    uLight: gl.getUniformLocation(program, 'uLight'),
    uMode: gl.getUniformLocation(program, 'uMode'),
    uShift: gl.getUniformLocation(program, 'uShift'),
  };
}

export function lookAt(camera: CameraState): Float32Array {
  const { azimuth, elevation, distance, target } = camera;
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const eyeX = target[0] + distance * Math.cos(el) * Math.sin(az);
  const eyeY = target[1] - distance * Math.cos(el) * Math.cos(az);
  const eyeZ = target[2] + distance * Math.sin(el);
  const f = normalize([target[0] - eyeX, target[1] - eyeY, target[2] - eyeZ]);
  const s = normalize(cross(f, [0, 0, 1]));
  const u = cross(s, f);
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -(s[0] * eyeX + s[1] * eyeY + s[2] * eyeZ),
    -(u[0] * eyeX + u[1] * eyeY + u[2] * eyeZ),
    (f[0] * eyeX + f[1] * eyeY + f[2] * eyeZ),
    1,
  ]);
}

export function perspective(fovyDeg: number, aspect: number): Float32Array {
  // vertical fov 40 when canvas is wider than tall; horizontal fov 40 otherwise
  let fovy = (fovyDeg * Math.PI) / 180;
  if (aspect < 1) {
    // taller than wide: horizontal fov is 40, so vertical is wider
    fovy = 2 * Math.atan(Math.tan(fovy / 2) / aspect);
  }
  const f = 1 / Math.tan(fovy / 2);
  const near = 1, far = 5000;
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (far - near), 1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------- mesh generation (64 segments, 32 rings, volume-matched scaling) ----------

export interface TriMesh { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

const meshCache = new Map<string, TriMesh>();

function rotZ(x: number, y: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export function meshFor(kind: string, w: number, d: number, h: number, rotationZ: number): TriMesh {
  const key = `${kind}:${w}:${d}:${h}:${rotationZ}`;
  const cached = meshCache.get(key);
  if (cached) return cached;
  let mesh: TriMesh;
  if (kind === 'box') mesh = boxMesh(w, d, h);
  else if (kind === 'cylinder') mesh = cylinderMesh(w, h);
  else mesh = sphereMesh(w);
  if (rotationZ !== 0) mesh = rotateMesh(mesh, rotationZ);
  meshCache.set(key, mesh);
  return mesh;
}

function boxMesh(w: number, d: number, h: number): TriMesh {
  const x = w / 2, y = d / 2, z = h / 2;
  const positions = new Float32Array([
    -x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z,
    -x, -y, z, x, -y, z, x, y, z, -x, y, z,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    2, 6, 7, 2, 7, 3,
    1, 5, 6, 1, 6, 2,
    3, 7, 4, 3, 4, 0,
  ]);
  const normals = new Float32Array(24 * 3);
  const faces = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const idx = f * 4 + v;
      normals[idx * 3] = faces[f]![0];
      normals[idx * 3 + 1] = faces[f]![1];
      normals[idx * 3 + 2] = faces[f]![2];
    }
  }
  return { positions, normals, indices };
}

function cylinderMesh(diameter: number, h: number): TriMesh {
  const r = diameter / 2;
  // radial scale so mesh volume equals π r² h with 64 segments
  const exactArea = Math.PI * r * r;
  const polyArea = 64 * r * r * Math.sin(Math.PI / 64) * Math.cos(Math.PI / 64);
  const scale = Math.sqrt(exactArea / polyArea);
  const segs = 64;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const ring = (z: number, nz: number) => {
    const base = positions.length / 3;
    for (let i = 0; i < segs; i++) {
      const angle = (2 * Math.PI * i) / segs;
      const x = r * scale * Math.cos(angle);
      const y = r * scale * Math.sin(angle);
      positions.push(x, y, z);
      normals.push(x / r, y / r, nz);
    }
    return base;
  };
  const bottom = ring(-h / 2, -1);
  const top = ring(h / 2, 1);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    indices.push(bottom + i, top + i, top + j, bottom + i, top + j, bottom + j);
  }
  // caps: fans
  const bottomCenter = positions.length / 3;
  positions.push(0, 0, -h / 2);
  normals.push(0, 0, -1);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    indices.push(bottomCenter, bottom + j, bottom + i);
  }
  const topCenter = positions.length / 3;
  positions.push(0, 0, h / 2);
  normals.push(0, 0, 1);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    indices.push(topCenter, top + i, top + j);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

function sphereMesh(diameter: number): TriMesh {
  const r = diameter / 2;
  // uniform scale so the mesh volume equals 4/3 π r³
  const exactVol = (4 / 3) * Math.PI * r ** 3;
  const polyVol = polySphereVolume(r);
  const scale = Math.cbrt(exactVol / polyVol);
  const segs = 64, rings = 32;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let ri = 0; ri <= rings; ri++) {
    const phi = (Math.PI * ri) / rings;
    for (let si = 0; si < segs; si++) {
      const theta = (2 * Math.PI * si) / segs;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      positions.push(r * scale * nx, r * scale * ny, r * scale * nz);
      normals.push(nx, ny, nz);
    }
  }
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = ri * segs + si;
      const b = ri * segs + ((si + 1) % segs);
      const c = (ri + 1) * segs + si;
      const d2 = (ri + 1) * segs + ((si + 1) % segs);
      if (ri === 0) indices.push(a, c, d2);
      else if (ri === rings - 1) indices.push(a, b, c);
      else indices.push(a, b, c, b, d2, c);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

function polySphereVolume(r: number): number {
  const segs = 64, rings = 32;
  let vol = 0;
  const point = (ri: number, si: number): [number, number, number] => {
    const phi = (Math.PI * ri) / rings;
    const theta = (2 * Math.PI * si) / segs;
    return [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)];
  };
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = point(ri, si);
      const b = point(ri + 1, si);
      const c = point(ri + 1, (si + 1) % segs);
      const d = point(ri, (si + 1) % segs);
      vol += tetra([0, 0, 0], a, b, c) + tetra([0, 0, 0], a, c, d);
    }
  }
  return Math.abs(vol);
}

function tetra(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  return (ab[0] * (ac[1] * ad[2] - ac[2] * ad[1]) - ab[1] * (ac[0] * ad[2] - ac[2] * ad[0]) + ab[2] * (ac[0] * ad[1] - ac[1] * ad[0])) / 6;
}

function rotateMesh(mesh: TriMesh, deg: number): TriMesh {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [x, y] = rotZ(mesh.positions[i]!, mesh.positions[i + 1]!, deg);
    positions[i] = x; positions[i + 1] = y; positions[i + 2] = mesh.positions[i + 2]!;
    const [nx, ny] = rotZ(mesh.normals[i]!, mesh.normals[i + 1]!, deg);
    normals[i] = nx; normals[i + 1] = ny; normals[i + 2] = mesh.normals[i + 2]!;
  }
  return { positions, normals, indices: mesh.indices };
}

// ---------- drawing a scene ----------

export interface DrawItem { mesh: TriMesh; x: number; y: number; z: number; color: [number, number, number]; mode: 'solid' | 'hole' }

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.3, 0.5, 0.9];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function drawScene(ctx: GlContext, items: DrawItem[], camera: CameraState, background: [number, number, number, number]): void {
  const { gl } = ctx;
  gl.useProgram(ctx.program);
  const canvas = gl.canvas as HTMLCanvasElement;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  if (canvas.width !== width * devicePixelRatio || canvas.height !== height * devicePixelRatio) {
    canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(background[0], background[1], background[2], background[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const aspect = canvas.width / canvas.height;
  gl.uniformMatrix4fv(ctx.uProj, false, perspective(40, aspect));
  gl.uniformMatrix4fv(ctx.uView, false, lookAt(camera));
  gl.uniform3f(ctx.uLight, 120, -160, 220);
  for (const item of items) {
    gl.uniform3f(ctx.uColor, item.color[0], item.color[1], item.color[2]);
    gl.uniform1f(ctx.uMode, item.mode === 'hole' ? 1 : 0);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, item.mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(ctx.aPos);
    gl.vertexAttribPointer(ctx.aPos, 3, gl.FLOAT, false, 0, 0);
    const nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, item.mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(ctx.aNormal);
    gl.vertexAttribPointer(ctx.aNormal, 3, gl.FLOAT, false, 0, 0);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, item.mesh.indices, gl.STATIC_DRAW);
    gl.uniform3f(ctx.uShift, item.x, item.y, item.z);
    gl.drawElements(gl.TRIANGLES, item.mesh.indices.length, gl.UNSIGNED_INT, 0);
    gl.deleteBuffer(posBuf);
    gl.deleteBuffer(nrmBuf);
    gl.deleteBuffer(idxBuf);
  }
}
