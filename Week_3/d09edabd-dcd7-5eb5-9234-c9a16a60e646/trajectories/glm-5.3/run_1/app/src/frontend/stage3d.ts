import type { Placement, Room } from '../shared/types.js';
import { multiply, orbitView, perspective } from './stage-math.js';

const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNormal = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;
  vWorld = (uModel * vec4(aPos, 1.0)).xyz;
}`;

const FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uFloor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(0.35, 0.9, 0.2));
  float diff = max(dot(n, l), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(uEye - vWorld)), 0.0), 2.0) * 0.25;
  vec3 col = uColor * (0.28 + diff * 0.62 + rim);
  if (uFloor > 0.5) {
    // toon floor grid banding
    float gx = step(mod(vWorld.x, 500.0), 2.0) + step(mod(vWorld.z, 500.0), 2.0);
    col += vec3(0.05) * gx;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

interface Geo {
  vbo: WebGLBuffer;
  nbo: WebGLBuffer;
  ibo: WebGLBuffer | null;
  count: number;
}

function boxGeo(gl: WebGLRenderingContext): Geo {
  // 24 vertices for face normals
  const s = 0.5;
  const pos: number[] = [];
  const nor: number[] = [];
  const faces: Array<[number[], number[]]> = [
    [[-s, -s, s], [0, 0, 1]], [[s, -s, s], [0, 0, 1]], [[s, s, s], [0, 0, 1]], [[-s, s, s], [0, 0, 1]],
    [[s, -s, -s], [0, 0, -1]], [[-s, -s, -s], [0, 0, -1]], [[-s, s, -s], [0, 0, -1]], [[s, s, -s], [0, 0, -1]],
    [[-s, s, s], [0, 1, 0]], [[s, s, s], [0, 1, 0]], [[s, s, -s], [0, 1, 0]], [[-s, s, -s], [0, 1, 0]],
    [[-s, -s, -s], [0, -1, 0]], [[s, -s, -s], [0, -1, 0]], [[s, -s, s], [0, -1, 0]], [[-s, -s, s], [0, -1, 0]],
    [[s, -s, s], [1, 0, 0]], [[s, -s, -s], [1, 0, 0]], [[s, s, -s], [1, 0, 0]], [[s, s, s], [1, 0, 0]],
    [[-s, -s, -s], [-1, 0, 0]], [[-s, -s, s], [-1, 0, 0]], [[-s, s, s], [-1, 0, 0]], [[-s, s, -s], [-1, 0, 0]],
  ];
  for (const [p, n] of faces) { pos.push(...p); nor.push(...n); }
  const idx: number[] = [];
  for (let f = 0; f < 6; f++) {
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
  const nbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  return { vbo, nbo, ibo, count: idx.length };
}

function cylinderGeo(gl: WebGLRenderingContext, segments = 20): Geo {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const s = 0.5;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a), si = Math.sin(a);
    pos.push(c * s, -s, si * s); nor.push(c, 0, si);
    pos.push(c * s, s, si * s); nor.push(c, 0, si);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // caps (flat-ish)
  const capStart = pos.length / 3;
  pos.push(0, -s, 0); nor.push(0, -1, 0);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(Math.cos(a) * s, -s, Math.sin(a) * s); nor.push(0, -1, 0);
  }
  for (let i = 0; i < segments; i++) idx.push(capStart, capStart + 1 + i, capStart + 2 + i);
  const topStart = pos.length / 3;
  pos.push(0, s, 0); nor.push(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(Math.cos(a) * s, s, Math.sin(a) * s); nor.push(0, 1, 0);
  }
  for (let i = 0; i < segments; i++) idx.push(topStart, topStart + 2 + i, topStart + 1 + i);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
  const nbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  return { vbo, nbo, ibo, count: idx.length };
}

const WOOD = [0.55, 0.36, 0.2];
const BRASS = [0.72, 0.58, 0.3];
const SEA = [0.16, 0.35, 0.45];
const DOOR_C = [0.45, 0.3, 0.32];
const WALL = [0.18, 0.21, 0.28];

export class Stage3D {
  private gl: WebGLRenderingContext;
  private box: Geo;
  private cyl: Geo;
  private aPos: number;
  private aNormal: number;
  private uMVP: WebGLUniformLocation;
  private uModel: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uEye: WebGLUniformLocation;
  private uFloor: WebGLUniformLocation;

  constructor(canvas: HTMLCanvasElement) {
    const gl = (canvas.getContext('webgl', { antialias: true }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext;
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aNormal = gl.getAttribLocation(prog, 'aNormal');
    this.uMVP = gl.getUniformLocation(prog, 'uMVP')!;
    this.uModel = gl.getUniformLocation(prog, 'uModel')!;
    this.uColor = gl.getUniformLocation(prog, 'uColor')!;
    this.uEye = gl.getUniformLocation(prog, 'uEye')!;
    this.uFloor = gl.getUniformLocation(prog, 'uFloor')!;
    this.box = boxGeo(gl);
    this.cyl = cylinderGeo(gl);
    gl.enable(gl.DEPTH_TEST);
  }

  resize(w: number, h: number, dpr: number): void {
    const c = this.gl.canvas;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, c.width, c.height);
  }

  private draw(geo: Geo, mvp: Float32Array, model: Float32Array, color: number[], eye: number[], floor: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.vbo);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.nbo);
    gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.aNormal);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.ibo);
    gl.uniformMatrix4fv(this.uMVP, false, mvp);
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform3fv(this.uColor, new Float32Array(color));
    gl.uniform3fv(this.uEye, new Float32Array(eye));
    gl.uniform1f(this.uFloor, floor);
    gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
  }

  render(opts: {
    room: Room;
    placements: Placement[];
    mvp: Float32Array;
    model: (p: Placement) => Float32Array;
    roomModel: Float32Array;
    eye: number[];
    selectedId: string | null;
    hiddenIds?: Set<string>;
  }): void {
    const gl = this.gl;
    gl.clearColor(0.043, 0.055, 0.078, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // room shell: floor + 4 walls, open ceiling
    const r = opts.room;
    const { mvp } = opts;
    const floorModel = opts.roomModel;
    this.draw(this.box, mvp, floorModel, [0.13, 0.16, 0.22], opts.eye, 1);
    // walls
    const wallH = r.heightMm;
    const mk = (x: number, y: number, z: number, w: number, h: number, d: number): Float32Array => {
      const m = new Float32Array(16);
      m[0] = w; m[5] = h; m[10] = d; m[15] = 1;
      m[12] = x; m[13] = y; m[14] = z;
      return m;
    };
    const t = 40; // wall thickness
    this.draw(this.box, mvp, mk(r.widthMm / 2, wallH / 2, -t / 2, r.widthMm + t * 2, wallH, t), WALL, opts.eye, 0);
    this.draw(this.box, mvp, mk(r.widthMm / 2, wallH / 2, r.depthMm + t / 2, r.widthMm + t * 2, wallH, t), WALL, opts.eye, 0);
    this.draw(this.box, mvp, mk(-t / 2, wallH / 2, r.depthMm / 2, t, wallH, r.depthMm + t * 2), WALL, opts.eye, 0);
    this.draw(this.box, mvp, mk(r.widthMm + t / 2, wallH / 2, r.depthMm / 2, t, wallH, r.depthMm + t * 2), WALL, opts.eye, 0);

    // placements in scene order given by opts.model
    for (const p of opts.placements) {
      if (opts.hiddenIds?.has(p.id)) continue;
      const model = opts.model(p);
      const color = p.id === opts.selectedId ? [0.35, 0.5, 0.9] : this.colorFor(p);
      const geo = p.kind === 'cylinder' ? this.cyl : this.box;
      this.draw(geo, mvp, model, color, opts.eye, 0);
      if (p.kind === 'door') {
        // frame highlight
        const fr = new Float32Array(model);
        this.draw(this.box, mvp, fr, DOOR_C, opts.eye, 0);
      }
    }
  }

  colorFor(p: Placement): number[] {
    if (p.kind === 'door') return DOOR_C;
    if (p.kind === 'prop') return BRASS;
    // deterministic variety by label hash
    let h = 0;
    for (const ch of p.label) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const pick = Math.abs(h) % 3;
    return pick === 0 ? WOOD : pick === 1 ? BRASS : SEA;
  }
}

/** A tiny offscreen renderer used for room-card thumbnails and the public tour. */
export function renderThumbnail(room: Room, placements: Placement[], size = 320): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.round((size * 9) / 16);
  try {
    const stage = new Stage3D(canvas as HTMLCanvasElement);
    const proj = perspective((50 * Math.PI) / 180, 16 / 9, 50, 50000);
    const view = orbitView({ yaw: 30, pitch: 35, distance: Math.max(room.widthMm, room.depthMm) * 1.1, targetY: room.heightMm * 0.4 }, { x: room.widthMm / 2, z: room.depthMm / 2 });
    const mvp = multiply(proj, view).m;
    const roomModel = (() => {
      const m = new Float32Array(16);
      m[0] = room.widthMm; m[5] = 1; m[10] = room.depthMm; m[15] = 1;
      m[12] = room.widthMm / 2; m[13] = -0.5; m[14] = room.depthMm / 2;
      return m;
    })();
    const model = (p: Placement): Float32Array => {
      const m = new Float32Array(16);
      m[0] = p.widthMm; m[5] = p.heightMm; m[10] = p.depthMm; m[15] = 1;
      m[12] = p.xMm + p.widthMm / 2; m[13] = p.yMm + p.heightMm / 2; m[14] = p.zMm + p.depthMm / 2;
      return m;
    };
    const eye = [room.widthMm / 2, room.heightMm * 2, -Math.max(room.widthMm, room.depthMm)];
    stage.render({ room, placements, mvp, model, roomModel, eye, selectedId: null });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

