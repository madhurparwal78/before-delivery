import { cameraAt, boxShelfPosition, shelfColumnsFor, lerpVec, Vec3 } from './cameraPath.js';
import { Chapter } from './chapters.js';

export interface SceneState {
  progress: number;
  chapter: Chapter;
  cameraPosition: Vec3;
  lightIntensity: number;
  litMatches: number;
  holdRemainingMs: number | null;
  matchLength: number | null;
}

interface BoxView { number: number; state: string }

export interface Renderer {
  render(state: SceneState, boxes: BoxView[], heldNumber: number | null): void;
  resize(): void;
  dispose(): void;
  lastCamera: Vec3;
}

function makeShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec3 uTint;
out vec3 vNorm;
out vec3 vTint;
out float vDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 viewPos = uView * world;
  gl_Position = uProj * viewPos;
  vNorm = mat3(uModel) * aNorm;
  vTint = uTint;
  vDepth = viewPos.z;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec3 vTint;
in float vDepth;
uniform vec3 uLightPos;
uniform float uLightIntensity;
uniform vec3 uAmbient;
uniform vec3 uLamp;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNorm);
  vec3 L = normalize(uLightPos - vec3(0.0));
  float diff = max(dot(N, L), 0.0) * 0.001; // light comes via distance term below
  float dist = length(uLightPos);
  float att = uLightIntensity / (1.0 + dist * dist * 0.15);
  vec3 col = vTint * (uAmbient + uLamp * max(0.25, dot(N, vec3(0.0, 1.0, 0.0))));
  col += vTint * uLightIntensity * 0.35 * att;
  fragColor = vec4(col, 1.0);
}`;

function mat4Identity(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye: Vec3, target: Vec3): Float32Array {
  const up = { x: 0, y: 1, z: 0 };
  let zx = eye.x - target.x, zy = eye.y - target.y, zz = eye.z - target.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye.x + xy * eye.y + xz * eye.z),
    -(yx * eye.x + yy * eye.y + yz * eye.z),
    -(zx * eye.x + zy * eye.y + zz * eye.z),
    1,
  ]);
}

function mat4Scale(x: number, y: number, z: number): Float32Array {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

/** A unit box geometry with normals. */
function boxGeometry(gl: WebGL2RenderingContext): { vao: WebGLVertexArrayObject; count: number } {
  const faces: number[][] = [
    // +x
    [1, 0, 0], [0, 0, -1], [0, 1, 0],
    // -x
    [-1, 0, 0], [0, 0, 1], [0, 1, 0],
    // +y
    [0, 1, 0], [1, 0, 0], [0, 0, 1],
    // -y
    [0, -1, 0], [1, 0, 0], [0, 0, -1],
    // +z
    [0, 0, 1], [1, 0, 0], [0, 1, 0],
    // -z
    [0, 0, -1], [-1, 0, 0], [0, 1, 0],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of faces as unknown as number[][]) {
    const corners = [
      [-1, -1], [1, -1], [1, 1], [-1, 1],
    ];
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      const [a, b] = corners[i];
      positions.push(
        0.5 * (nx + a * ux + b * vx),
        0.5 * (ny + a * uy + b * vy),
        0.5 * (nz + a * uz + b * vz),
      );
      normals.push(nx, ny, nz);
    }
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const data = new Float32Array([...positions, ...normals]);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 0;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, stride);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, count: positions.length / 3 };
}

/** A unit cylinder geometry with normals, for matches and snow. */
function cylinderGeometry(gl: WebGL2RenderingContext, segments: number): { vao: WebGLVertexArrayObject; count: number } {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0), z0 = Math.sin(a0);
    const x1 = Math.cos(a1), z1 = Math.sin(a1);
    // side quad
    const quad = [
      [x0, -0.5, z0, x0, 0, z0], [x1, -0.5, z1, x1, 0, z1],
      [x1, 0.5, z1, x1, 0, z1], [x0, 0.5, z0, x0, 0, z0],
    ];
    for (const i2 of [0, 1, 2, 0, 2, 3]) {
      positions.push(quad[i2][0], quad[i2][1], quad[i2][2]);
      normals.push(quad[i2][3], quad[i2][4], quad[i2][5]);
    }
    // top cap
    positions.push(0, 0.5, 0, x0, 0.5, z0, x1, 0.5, z1);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...positions, ...normals]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, count: positions.length / 3 };
}

const SNOW_COUNT = 220;

export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) return null;
  const ctx = gl;

  const vs = makeShader(gl, ctx.VERTEX_SHADER, VS);
  const fs = makeShader(gl, ctx.FRAGMENT_SHADER, FS);
  const program = ctx.createProgram()!;
  if (!vs || !fs) return null;
  ctx.attachShader(program, vs);
  ctx.attachShader(program, fs);
  ctx.linkProgram(program);
  if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) return null;

  const uProj = ctx.getUniformLocation(program, 'uProj');
  const uView = ctx.getUniformLocation(program, 'uView');
  const uModel = ctx.getUniformLocation(program, 'uModel');
  const uTint = ctx.getUniformLocation(program, 'uTint');
  const uLightPos = ctx.getUniformLocation(program, 'uLightPos');
  const uLightIntensity = ctx.getUniformLocation(program, 'uLightIntensity');
  const uAmbient = ctx.getUniformLocation(program, 'uAmbient');
  const uLamp = ctx.getUniformLocation(program, 'uLamp');

  const box = boxGeometry(gl);
  const cyl = cylinderGeometry(gl, 10);

  const snow: { x: number; y: number; z: number; speed: number }[] = [];
  for (let i = 0; i < SNOW_COUNT; i++) {
    snow.push({
      x: (Math.random() - 0.5) * 24,
      y: Math.random() * 14,
      z: (Math.random() - 0.5) * 40,
      speed: 0.7 + Math.random() * 0.9,
    });
  }

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function drawBox(model: Float32Array, tint: [number, number, number]): void {
    ctx.uniformMatrix4fv(uModel, false, model);
    ctx.uniform3fv(uTint, tint);
    ctx.bindVertexArray(box.vao);
    ctx.drawArrays(ctx.TRIANGLES, 0, box.count);
  }

  function drawCyl(model: Float32Array, tint: [number, number, number]): void {
    ctx.uniformMatrix4fv(uModel, false, model);
    ctx.uniform3fv(uTint, tint);
    ctx.bindVertexArray(cyl.vao);
    ctx.drawArrays(ctx.TRIANGLES, 0, cyl.count);
  }

  function withModel(x: number, y: number, z: number, sx: number, sy: number, sz: number): Float32Array {
    const m = mat4Scale(sx, sy, sz);
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  const INK: [number, number, number] = [0.045, 0.075, 0.13];
  const SNOW_TINT: [number, number, number] = [0.55, 0.62, 0.72];
  const WOOD: [number, number, number] = [0.36, 0.28, 0.2];
  const FLAME: [number, number, number] = [1.0, 0.78, 0.32];

  const lastCamera: Vec3 = { x: 0, y: 1.6, z: 6 };

  function render(state: SceneState, boxes: BoxView[], heldNumber: number | null): void {
    resize();
    const w = ctx.drawingBufferWidth;
    const h = ctx.drawingBufferHeight;
    ctx.viewport(0, 0, w, h);
    ctx.clearColor(0.035, 0.055, 0.095, 1);
    ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
    ctx.enable(ctx.DEPTH_TEST);
    ctx.useProgram(program);

    const cam = cameraAt(state.progress);
    let eye = cam.position;
    let look = cam.look;
    lastCamera.x = eye.x;
    lastCamera.y = eye.y;
    lastCamera.z = eye.z;

    // Hold focus: the camera turns to the held box while a hold is live and
    // progress is in the shelf range.
    if (heldNumber !== null && state.holdRemainingMs !== null && state.progress >= 0.86) {
      const columns = shelfColumnsFor(window.innerWidth);
      const target = boxShelfPosition(heldNumber, columns);
      eye = lerpVec(eye, { x: target.x * 0.6, y: target.y + 0.6, z: target.z + 3.4 }, 0.86);
      look = lerpVec(look, target, 0.9);
      lastCamera.x = eye.x;
      lastCamera.y = eye.y;
      lastCamera.z = eye.z;
    }

    const proj = mat4Perspective((55 * Math.PI) / 180, w / h, 0.05, 300);
    const view = mat4LookAt(eye, look);
    ctx.uniformMatrix4fv(uProj, false, proj);
    ctx.uniformMatrix4fv(uView, false, view);

    // The match's point light sits near the camera.
    const lightPos: Vec3 = { x: eye.x, y: eye.y + 0.2, z: eye.z - 0.4 };
    ctx.uniform3f(uLightPos, lightPos.x, lightPos.y, lightPos.z);
    ctx.uniform1f(uLightIntensity, state.lightIntensity);
    ctx.uniform3f(uAmbient, 0.06, 0.09, 0.14);
    ctx.uniform3f(uLamp, 0.10, 0.13, 0.19);

    // Snow ground and walls down the alley.
    drawBox(withModel(0, -0.05, cam.position.z - 20, 0.5, 1.4, 60), [0.09, 0.13, 0.2]);
    drawBox(withModel(-9, 2.5, cam.position.z - 20, 0.4, 7, 60), INK);
    drawBox(withModel(9, 2.5, cam.position.z - 20, 0.4, 7, 60), INK);

    // Chapter visions, lit only while a match burns.
    if (state.lightIntensity > 0) {
      const zc = cam.position.z - 8;
      const rise = Math.min(1, state.lightIntensity);
      switch (state.chapter) {
        case 'stove':
          drawBox(withModel(1.6, 0.7 * rise, zc, 1.1, 1.5, 1.1), [0.16, 0.14, 0.13]);
          drawBox(withModel(1.6, 1.9 * rise, zc, 0.9, 0.4, 0.9), [0.05, 0.05, 0.06]);
          break;
        case 'goose':
          drawBox(withModel(0, 0.9 * rise, zc, 3.4, 0.12, 2.0), [0.78, 0.80, 0.85]);
          drawCyl(withModel(0.4, 1.05 * rise, zc, 0.28, 0.28, 0.3), [0.72, 0.6, 0.4]);
          break;
        case 'tree':
          drawCyl(withModel(0, 0.8 * rise, zc, 0.16, 1.6 * rise, 0.16), WOOD);
          drawCyl(withModel(0, 2.4 * rise, zc, 1.0 * rise, 0.8 * rise, 1.0 * rise), [0.05, 0.16, 0.09]);
          break;
        case 'star': {
          const fall = 1 - (state.progress - 0.62) / 0.1;
          drawCyl(withModel(2.5, 4.5 - fall * 2.5, zc, 0.06, 1.4, 0.06), FLAME);
          break;
        }
        case 'grandmother':
          drawCyl(withModel(1.3, 0.8 * rise, zc, 0.32, 1.6 * rise, 0.32), [0.09, 0.13, 0.18]);
          drawCyl(withModel(1.3, 1.75 * rise, zc, 0.26, 0.26, 0.26), [0.7, 0.66, 0.6]);
          break;
        default:
          break;
      }
    }

    // The shelf of 240 boxes.
    if (state.progress >= 0.8) {
      const columns = shelfColumnsFor(window.innerWidth);
      const near = Math.max(0.0, 1 - (1 - state.progress) * 5);
      const shelfZ = boxShelfPosition(1, columns).z;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const p = boxShelfPosition(b.number, columns);
        const isHeld = heldNumber === b.number;
        const taken = b.state === 'taken';
        const heldByOther = b.state === 'held' && !isHeld;
        // Available boxes show as closed lids; taken have a notched corner
        // (slightly smaller, offset); the held box carries a standing match.
        const tint: [number, number, number] = taken
          ? [0.075, 0.105, 0.16]
          : heldByOther
            ? [0.10, 0.13, 0.19]
            : isHeld
              ? [0.24, 0.21, 0.17]
              : [0.13, 0.17, 0.24];
        const scale = taken ? [0.16, 0.26, 0.14] : [0.18, 0.28, 0.16];
        drawBox(withModel(p.x, p.y, shelfZ, scale[0], scale[1], scale[2]), tint);
        if (isHeld && state.holdRemainingMs !== null) {
          // A standing match whose length falls linearly with remaining time.
          const length = Math.max(0.02, state.matchLength ?? 1);
          const h = 0.4 * length;
          drawCyl(withModel(p.x, p.y + 0.14 + h / 2, shelfZ + 0.09, 0.012, h, 0.012), WOOD);
          if (length > 0.03) {
            const flick = 1 + Math.sin(Date.now() / 90) * 0.12;
            drawCyl(withModel(p.x, p.y + 0.16 + h, shelfZ + 0.09, 0.02 * flick, 0.05, 0.02 * flick), FLAME);
          }
        }
      }
      // Shelf boards
      for (let r = 0; r < 6; r++) {
        drawBox(withModel(0, 0.86 + r * 0.5, shelfZ - 0.12, 9.2, 0.03, 0.3), [0.10, 0.13, 0.18]);
      }
      void near;
    }
    // Snow drifts across every story chapter.
    if (state.progress < 0.86) {
      const now = Date.now() / 1000;
      for (const f of snow) {
        const y = ((f.y - now * f.speed) % 14 + 14) % 14;
        const sway = Math.sin(now * 0.6 + f.x) * 0.4;
        drawCyl(withModel(f.x + sway, y - 1, cam.position.z - 12 + f.z, 0.014, 0.014, 0.014), SNOW_TINT);
      }
    }
  }

  function dispose(): void {
    ctx.deleteProgram(program);
    ctx.deleteVertexArray(box.vao);
    ctx.deleteVertexArray(cyl.vao);
  }

  return { render, resize, dispose, lastCamera };
}
