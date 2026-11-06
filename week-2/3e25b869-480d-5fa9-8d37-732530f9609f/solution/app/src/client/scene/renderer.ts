// The loaf drawn procedurally with WebGL: matte slices with a domed top, a seeded marble on every cut face,
// kraft wraps with a folded corner and a tag, and a taut rust wire with a handle at each end.
import type { Tint } from '../../shared/catalog.js';
import { type Camera, CROWN, crown, DEPTH, DOME, FALL_DROP, FALL_FORWARD, FALL_SHIFT, HEIGHT } from './geometry';

const GROUND: [number, number, number] = [0xef, 0xe7, 0xd6];
const TINTS: Record<Tint, [number, number, number]> = {
  lilac: [0x8b, 0x76, 0xa6],
  ash: [0x6e, 0x68, 0x63],
  mint: [0x5a, 0x8f, 0x74],
  rose: [0xb0, 0x6f, 0x78],
};
const RUST: [number, number, number] = [0x9e, 0x42, 0x1d];
const HANDLE: [number, number, number] = [0x4a, 0x36, 0x28];

export interface BarPose {
  index: number;
  tip: number;
  wrap: number;
  presence: number;
}

interface Frame {
  width: number;
  height: number;
  cam: Camera;
  bars: number;
  poses: BarPose[];
  wire: number;
}

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aFace;
uniform mat4 uModel;
uniform vec2 uYawPitch;
uniform vec3 uScreen;
uniform vec2 uSize;
uniform float uBarOffset;
uniform float uBars;
uniform float uCrown;
varying vec3 vLocal;
varying vec3 vNormal;
varying float vFace;
vec3 viewOf(vec3 p) {
  float cy = cos(uYawPitch.x), sy = sin(uYawPitch.x), cp = cos(uYawPitch.y), sp = sin(uYawPitch.y);
  float x1 = p.x * cy + p.z * sy;
  float z1 = -p.x * sy + p.z * cy;
  return vec3(x1, p.y * cp - z1 * sp, p.y * sp + z1 * cp);
}
void main() {
  vec3 local = aPosition;
  float along = 2.0 * (aPosition.x + uBarOffset) / uBars - 1.0;
  if (aPosition.y > 0.001) local.y += uCrown * (1.0 - along * along);
  vec4 world = uModel * vec4(local, 1.0);
  vec3 v = viewOf(world.xyz);
  vec2 px = vec2(uScreen.x + v.x * uScreen.z, uScreen.y - v.y * uScreen.z);
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, -v.z / 60.0, 1.0);
  vLocal = vec3(aPosition.x + uBarOffset, local.y, aPosition.z);
  vNormal = viewOf((uModel * vec4(aNormal, 0.0)).xyz);
  vFace = aFace;
}`;

const FRAGMENT = `
precision highp float;
varying vec3 vLocal;
varying vec3 vNormal;
varying float vFace;
uniform vec3 uTint;
uniform vec3 uSeed;
uniform float uWrap;
uniform float uFirst;
uniform float uLast;
uniform float uFlat;
uniform vec3 uFlatColour;
uniform sampler2D uTag;
uniform float uHeight;
uniform float uBars;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec3 marble(vec3 p) {
  vec3 q = p * 0.55 + uSeed;
  float warp = fbm(q + vec3(fbm(q * 1.7), fbm(q + 3.1), 0.0) * 1.8);
  float band = sin((p.y * 1.4 + p.z * 0.9 + warp * 6.0 + uSeed.x));
  vec3 dark = uTint * 0.58;
  vec3 light = mix(uTint, vec3(1.0), 0.3);
  vec3 c = mix(uTint, dark, smoothstep(0.25, 0.75, band));
  return mix(c, light, smoothstep(0.55, 0.95, -band) * 0.85);
}
void main() {
  vec3 n = normalize(vNormal);
  float light = 0.52 + 0.48 * max(dot(n, normalize(vec3(-0.45, 0.65, 0.65))), 0.0);
  if (uFlat > 0.5) { gl_FragColor = vec4(uFlatColour * light, 1.0); return; }
  int face = int(vFace + 0.5);
  float xl = vLocal.x - floor(vLocal.x + 0.0001);
  bool cut = (face == 2 && uFirst < 0.5) || (face == 3 && uLast < 0.5);
  vec3 albedo = uTint;
  if (cut) albedo = marble(vLocal);
  if (face == 4) {
    float grain = fbm(vLocal * vec3(3.1, 3.1, 3.1) + uSeed) - 0.5;
    float rise = 1.0 - abs(vLocal.z) / ${(DEPTH / 2).toFixed(2)};
    albedo = uTint * (1.0 + grain * 0.22 + rise * 0.12);
    light += grain * 0.08;
  }
  if (face != 4 && !cut) albedo = uTint * (0.98 + (fbm(vLocal * vec3(2.0, 3.0, 2.0) + uSeed) - 0.5) * 0.14);
  if ((face == 0 || face == 4) && ((xl < 0.02 && uFirst < 0.5) || (xl > 0.98 && uLast < 0.5))) albedo *= 0.86;
  if (face == 0) light *= 1.05 - 0.12 * clamp(vLocal.x / uBars, 0.0, 1.0);
  float top = uHeight + ${(DOME + CROWN).toFixed(2)};
  if (uWrap > 0.001 && vLocal.y <= uWrap * (top + 0.01)) {
    vec3 kraft = vec3(0.604, 0.439, 0.267) * (0.97 + (noise(vLocal * 9.0) - 0.5) * 0.08);
    albedo = kraft;
    if (face == 0) {
      vec2 fold = vec2((xl - 0.62) / 0.38, (vLocal.y - (uHeight - 0.42)) / 0.42);
      if (uWrap > 0.98 && fold.x > 0.0 && fold.y > 0.0) {
        float d = fold.x + fold.y - 1.0;
        if (d > 0.0) albedo = vec3(0.761, 0.604, 0.408);
        if (abs(d) < 0.07) albedo = vec3(0.45, 0.32, 0.2);
      }
      vec2 tag = vec2((xl - 0.12) / 0.58, (vLocal.y - (uHeight - 0.98)) / 0.5);
      if (uWrap > 0.98 && tag.x > 0.0 && tag.x < 1.0 && tag.y > 0.0 && tag.y < 1.0) {
        albedo = texture2D(uTag, vec2(tag.x, 1.0 - tag.y)).rgb;
      }
    }
  }
  gl_FragColor = vec4(albedo * light, 1.0);
}`;

/** One slice: x in [0, 1], y from 0 to the domed top, z across the depth; faces 0 front, 1 back, 2 left, 3 right, 4 top, 5 bottom. */
function sliceMesh(): Float32Array {
  const out: number[] = [];
  const steps = 8;
  const dome = (z: number) => HEIGHT + DOME * (1 - ((2 * z) / DEPTH) ** 2);
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], face: number) => {
    for (const p of [a, b, c, a, c, d]) out.push(p[0] as number, p[1] as number, p[2] as number, n[0] as number, n[1] as number, n[2] as number, face);
  };
  const h = DEPTH / 2;
  quad([0, 0, h], [1, 0, h], [1, dome(h), h], [0, dome(h), h], [0, 0, 1], 0);
  quad([1, 0, -h], [0, 0, -h], [0, dome(-h), -h], [1, dome(-h), -h], [0, 0, -1], 1);
  quad([0, 0, -h], [1, 0, -h], [1, 0, h], [0, 0, h], [0, -1, 0], 5);
  for (let i = 0; i < steps; i++) {
    const z0 = -h + (DEPTH * i) / steps;
    const z1 = -h + (DEPTH * (i + 1)) / steps;
    const slope = -(dome(z1) - dome(z0)) / (z1 - z0);
    const len = Math.hypot(slope, 1);
    quad([0, dome(z1), z1], [1, dome(z1), z1], [1, dome(z0), z0], [0, dome(z0), z0], [0, 1 / len, slope / len], 4);
    quad([0, 0, z0], [0, 0, z1], [0, dome(z1), z1], [0, dome(z0), z0], [-1, 0, 0], 2);
    quad([1, 0, z1], [1, 0, z0], [1, dome(z0), z0], [1, dome(z1), z1], [1, 0, 0], 3);
  }
  return new Float32Array(out);
}

function boxMesh(): Float32Array {
  const out: number[] = [];
  const faces: [number[], number[][]][] = [
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
    [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
  ];
  for (const [n, [a, b, c, d]] of faces) {
    for (const p of [a, b, c, a, c, d]) out.push(...(p as number[]), ...n, 6);
  }
  return new Float32Array(out);
}

type Mat = Float32Array;
const identity = (): Mat => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a: Mat, b: Mat): Mat {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}
const translate = (x: number, y: number, z: number): Mat => {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
};
const scale = (x: number, y: number, z: number): Mat => {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
};
const rotateZ = (a: number): Mat => {
  const m = identity();
  m[0] = Math.cos(a);
  m[1] = Math.sin(a);
  m[4] = -Math.sin(a);
  m[5] = Math.cos(a);
  return m;
};

const rgb = (c: [number, number, number]) => c.map((v) => v / 255) as [number, number, number];

function seedOf(code: string): [number, number, number] {
  let h = 2166136261;
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return [(h % 997) / 37, ((h >>> 10) % 991) / 41, ((h >>> 20) % 983) / 43];
}

function tagTexture(gl: WebGLRenderingContext): WebGLTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#e6d6b6';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#2a2420';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 122);
  ctx.fillStyle = '#2a2420';
  ctx.textAlign = 'center';
  ctx.font = '600 50px "Instrument Sans", system-ui, sans-serif';
  ctx.fillText('held', 128, 56);
  ctx.font = '500 38px "Instrument Sans", system-ui, sans-serif';
  ctx.fillText('réservé', 128, 104);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export class LoafRenderer {
  private readonly program: WebGLProgram;
  private readonly slice: { buffer: WebGLBuffer | null; count: number };
  private readonly box: { buffer: WebGLBuffer | null; count: number };
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly tag: WebGLTexture | null;
  private tint: [number, number, number] = rgb(TINTS.lilac);
  private seed: [number, number, number] = [0, 0, 0];

  constructor(private readonly gl: WebGLRenderingContext) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    this.program = gl.createProgram() as WebGLProgram;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    const upload = (data: Float32Array) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { buffer, count: data.length / 7 };
    };
    this.slice = upload(sliceMesh());
    this.box = upload(boxMesh());
    this.tag = tagTexture(gl);
  }

  setBatch(tint: Tint, code: string): void {
    this.tint = rgb(TINTS[tint]);
    this.seed = seedOf(code);
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name) ?? null;
  }

  private bind(mesh: { buffer: WebGLBuffer | null }): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    const stride = 7 * 4;
    const attribute = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    };
    attribute('aPosition', 3, 0);
    attribute('aNormal', 3, 12);
    attribute('aFace', 1, 24);
  }

  draw(frame: Frame, pixelRatio: number): void {
    const gl = this.gl;
    const { cam } = frame;
    gl.viewport(0, 0, Math.round(frame.width * pixelRatio), Math.round(frame.height * pixelRatio));
    gl.clearColor(GROUND[0] / 255, GROUND[1] / 255, GROUND[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniform2f(this.u('uYawPitch'), (cam.yaw * Math.PI) / 180, (20 * Math.PI) / 180);
    gl.uniform3f(this.u('uScreen'), cam.cx, cam.cy, cam.scale);
    gl.uniform2f(this.u('uSize'), frame.width, frame.height);
    gl.uniform3fv(this.u('uTint'), this.tint);
    gl.uniform3fv(this.u('uSeed'), this.seed);
    gl.uniform1f(this.u('uHeight'), HEIGHT);
    gl.uniform1f(this.u('uBars'), frame.bars);
    gl.uniform1f(this.u('uCrown'), CROWN);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tag);
    gl.uniform1i(this.u('uTag'), 0);
    gl.uniform1f(this.u('uFlat'), 0);

    this.bind(this.slice);
    const half = frame.bars / 2;
    for (const pose of frame.poses) {
      if (pose.presence <= 0.001) continue;
      const x0 = pose.index - half;
      const angle = (Math.PI / 2) * pose.tip;
      let model = translate(x0, 0, 0);
      model = multiply(translate(FALL_SHIFT * pose.tip, -FALL_DROP * pose.tip + 0.03 * pose.index * pose.tip, FALL_FORWARD * pose.tip), model);
      model = multiply(model, rotateZ(angle));
      model = multiply(model, scale(1, pose.presence, 1));
      gl.uniformMatrix4fv(this.u('uModel'), false, model);
      gl.uniform1f(this.u('uBarOffset'), pose.index);
      gl.uniform1f(this.u('uWrap'), pose.wrap);
      gl.uniform1f(this.u('uFirst'), pose.index === 0 ? 1 : 0);
      gl.uniform1f(this.u('uLast'), pose.index === frame.bars - 1 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.slice.count);
    }

    this.bind(this.box);
    gl.uniform1f(this.u('uFlat'), 1);
    const thin = Math.max(2 / cam.scale, 0.03);
    const wireX = frame.wire - half;
    const wireY = HEIGHT + DOME + crown(wireX, frame.bars) + 0.06;
    const span = DEPTH + 0.9;
    const parts: [Mat, [number, number, number]][] = [
      [multiply(translate(wireX, wireY, 0), scale(thin, thin, span)), RUST],
      [multiply(translate(wireX, wireY, DEPTH / 2 + 0.55), scale(Math.max(5 / cam.scale, 0.16), Math.max(5 / cam.scale, 0.16), 0.32)), HANDLE],
      [multiply(translate(wireX, wireY, -DEPTH / 2 - 0.55), scale(Math.max(5 / cam.scale, 0.16), Math.max(5 / cam.scale, 0.16), 0.32)), HANDLE],
    ];
    for (const [model, colour] of parts) {
      gl.uniformMatrix4fv(this.u('uModel'), false, model);
      gl.uniform3fv(this.u('uFlatColour'), rgb(colour));
      gl.drawArrays(gl.TRIANGLES, 0, this.box.count);
    }
  }
}
