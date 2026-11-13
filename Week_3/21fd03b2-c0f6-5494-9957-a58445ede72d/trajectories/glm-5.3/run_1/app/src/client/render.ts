// Minimal WebGL renderer: draws the bench look with flat sky, grid ground,
// ramps, pendulums, launchers, crates and model boxes.
import type { SceneDocument, SceneObject } from '../bench/scene';
import { KIND_SPECS } from '../bench/scene';
import { mat4, vec3, type Mat4Like } from './mat';

export type CameraState = {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
};

export const DEFAULT_CAMERA: CameraState = { yaw: 0.9, pitch: 0.6, distance: 14, target: [0, 1, 0] };

const VIEW_PRESETS: Record<string, { yaw: number; pitch: number; distance: number }> = {
  top: { yaw: 0, pitch: -Math.PI / 2 + 0.001, distance: 16 },
  bottom: { yaw: 0, pitch: Math.PI / 2 - 0.001, distance: 16 },
  front: { yaw: Math.PI / 2, pitch: 0, distance: 16 },
  back: { yaw: -Math.PI / 2, pitch: 0, distance: 16 },
  right: { yaw: 0, pitch: 0, distance: 16 },
  left: { yaw: Math.PI, pitch: 0, distance: 16 },
  iso: { yaw: 0.9, pitch: 0.6, distance: 14 },
};

const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vPos = world.xyz;
  gl_Position = uProj * uView * world;
}`;

const FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vPos;
uniform vec3 uColor;
void main() {
  vec3 lightDir = normalize(vec3(0.5, 0.9, 0.3));
  float diff = max(dot(normalize(vNormal), lightDir), 0.15);
  vec3 col = uColor * (0.5 + 0.5 * diff);
  gl_FragColor = vec4(col, 1.0);
}`;

const GRID_VS = `
attribute vec3 aPos;
uniform mat4 uProj;
uniform mat4 uView;
varying float vY;
void main() { vY = aPos.y; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

const GRID_FS = `
precision mediump float;
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0); }`;

export class StageRenderer {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  gridProgram: WebGLProgram;
  buffers = new Map<string, { vbo: WebGLBuffer; count: number }>();
  camera: CameraState = { ...DEFAULT_CAMERA };
  private reducedMotion: boolean;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    this.program = buildProgram(gl, VS, FS);
    this.gridProgram = buildProgram(gl, GRID_VS, GRID_FS);
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gl.enable(gl.DEPTH_TEST);
  }

  resize(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  setView(name: keyof typeof VIEW_PRESETS): void {
    const preset = VIEW_PRESETS[name];
    if (!preset) return;
    this.camera = { ...this.camera, yaw: preset.yaw, pitch: preset.pitch, distance: preset.distance };
  }

  draw(doc: SceneDocument | null, showGrid: boolean, overrides: Map<string, [number, number, number]> | null): void {
    const gl = this.gl;
    this.resize();
    const canvas = gl.canvas as HTMLCanvasElement;
    const aspect = canvas.width / Math.max(1, canvas.height);
    gl.clearColor(0.56, 0.78, 0.93, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = mat4.perspective((50 * Math.PI) / 180, aspect, 0.1, 500);
    const cam = mat4.orbit(this.camera);
    const view = mat4.lookAt(cam.eye, this.camera.target, [0, 1, 0]);

    // ground plane + grid
    gl.useProgram(this.gridProgram);
    const groundModel = mat4.identity();
    this.drawGround(gl, this.gridProgram, proj, view, groundModel, showGrid);

    gl.useProgram(this.program);
    if (!doc) return;
    for (const object of doc.objects) {
      const model = mat4.fromObject(object);
      const pos = overrides?.get(object.id) ?? object.position;
      const m2 = mat4.multiply(model, mat4.translation(pos[0], pos[1], pos[2]));
      this.drawObject(gl, object, m2, proj, view);
    }
  }

  private drawGround(gl: WebGLRenderingContext, program: WebGLProgram, proj: Float32Array, view: Float32Array, model: Float32Array, showGrid: boolean): void {
    const quad = new Float32Array([
      -100, 0, -100, 0, 1, 0,
      100, 0, -100, 0, 1, 0,
      100, 0, 100, 0, 1, 0,
      -100, 0, -100, 0, 1, 0,
      100, 0, 100, 0, 1, 0,
      -100, 0, 100, 0, 1, 0,
    ]);
    this.setBuffers(gl, program, quad);
    this.setUniforms(gl, program, proj, view, model, [0.36, 0.64, 0.38]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!showGrid) return;
    // grid lines
    const lines: number[] = [];
    for (let i = -20; i <= 20; i++) {
      lines.push(i, 0.01, -20, 0, 1, 0, i, 0.01, 20, 0, 1, 0);
      lines.push(-20, 0.01, i, 0, 1, 0, 20, 0.01, i, 0, 1, 0);
    }
    this.setBuffers(gl, program, new Float32Array(lines));
    this.setUniforms(gl, program, proj, view, model, [0.30, 0.55, 0.33]);
    gl.drawArrays(gl.LINES, 0, lines.length / 6);
  }

  private setBuffers(gl: WebGLRenderingContext, program: WebGLProgram, data: Float32Array): void {
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    const aNormal = gl.getAttribLocation(program, 'aNormal');
    const stride = 24;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    if (aNormal >= 0) {
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, stride, 12);
    }
  }

  private setUniforms(gl: WebGLRenderingContext, program: WebGLProgram, proj: Float32Array, view: Float32Array, model: Float32Array, color: [number, number, number]): void {
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uView'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uModel'), false, model);
    const uColor = gl.getUniformLocation(program, 'uColor');
    if (uColor) gl.uniform3fv(uColor, color);
  }

  private drawObject(gl: WebGLRenderingContext, object: SceneObject, model: Float32Array, proj: Float32Array, view: Float32Array): void {
    const colorFor: Record<string, [number, number, number]> = {
      ramp: [0.72, 0.5, 0.3],
      pendulum: [0.55, 0.6, 0.7],
      launcher: [0.45, 0.5, 0.62],
      crate: [0.68, 0.55, 0.35],
      model: [0.6, 0.62, 0.7],
    };
    if (object.kind === 'ramp') {
      const angle = (object.params.angle_deg ?? 30) * Math.PI / 180;
      const length = object.params.length_m ?? 3;
      this.drawRamp(gl, model, proj, view, angle, length, colorFor.ramp!);
      return;
    }
    if (object.kind === 'pendulum') {
      this.drawPendulum(gl, model, proj, view, object, colorFor.pendulum!);
      return;
    }
    // boxes for crate/launcher/model
    const size = object.kind === 'model' ? 1 : 0.6;
    const sx = object.scale[0] * size;
    const sy = object.scale[1] * size;
    const sz = object.scale[2] * size;
    const color = colorFor[object.kind] ?? [0.7, 0.7, 0.7];
    this.drawBox(gl, mat4.multiply(model, mat4.scale(sx, sy, sz)), proj, view, color);
  }

  private drawRamp(gl: WebGLRenderingContext, model: Float32Array, proj: Float32Array, view: Float32Array, angle: number, length: number, color: [number, number, number]): void {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const ax = 0, ay = 0, az = -0.6;
    const bx = length * cosA, by = length * sinA, bz = -0.6;
    const cx = length * cosA, cy = length * sinA, cz = 0.6;
    const dx = 0, dy = 0, dz = 0.6;
    const quad = new Float32Array([
      ax, ay, az, 0, 0, -1, bx, by, bz, 0, 0, -1, cx, cy, cz, 0, 0, -1,
      ax, ay, az, 0, 0, -1, cx, cy, cz, 0, 0, -1, dx, dy, dz, 0, 0, -1,
    ]);
    this.setBuffers(gl, this.program, quad);
    this.setUniforms(gl, this.program, proj, view, model, color);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawPendulum(gl: WebGLRenderingContext, model: Float32Array, proj: Float32Array, view: Float32Array, object: SceneObject, color: [number, number, number]): void {
    const length = object.params.length_m ?? 1;
    const angle = ((object.params.release_deg ?? 20) * Math.PI) / 180;
    const bx = Math.sin(angle) * length;
    const by = -Math.cos(angle) * length;
    const line = new Float32Array([
      0, 0, 0, 1, 0, 0,
      bx, by, 0, 1, 0, 0,
    ]);
    this.setBuffers(gl, this.program, line);
    this.setUniforms(gl, this.program, proj, view, model, [0.4, 0.42, 0.5]);
    gl.drawArrays(gl.LINES, 0, 2);
    const bobModel = mat4.multiply(model, mat4.translation(bx, by, 0));
    this.drawBox(gl, mat4.multiply(bobModel, mat4.scale(0.2, 0.2, 0.2)), proj, view, color);
  }

  private drawBox(gl: WebGLRenderingContext, model: Float32Array, proj: Float32Array, view: Float32Array, color: [number, number, number]): void {
    const v = new Float32Array(36 * 6);
    const faces: Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> = cubeFaces();
    let i = 0;
    for (const face of faces) {
      for (const corner of face.c) {
        v[i++] = corner[0]; v[i++] = corner[1]; v[i++] = corner[2];
        v[i++] = face.n[0]; v[i++] = face.n[1]; v[i++] = face.n[2];
      }
    }
    this.setBuffers(gl, this.program, v);
    this.setUniforms(gl, this.program, proj, view, model, color);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }
}

function cubeFaces(): Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> {
  const p = 0.5;
  return [
    { n: [0, 0, 1], c: [[-p, -p, p], [p, -p, p], [p, p, p], [-p, -p, p], [p, p, p], [-p, p, p]] },
    { n: [0, 0, -1], c: [[p, -p, -p], [-p, -p, -p], [-p, p, -p], [p, -p, -p], [-p, p, -p], [p, p, -p]] },
    { n: [1, 0, 0], c: [[p, -p, p], [p, -p, -p], [p, p, -p], [p, -p, p], [p, p, -p], [p, p, p]] },
    { n: [-1, 0, 0], c: [[-p, -p, -p], [-p, -p, p], [-p, p, p], [-p, -p, -p], [-p, p, p], [-p, p, -p]] },
    { n: [0, 1, 0], c: [[-p, p, p], [p, p, p], [p, p, -p], [-p, p, p], [p, p, -p], [-p, p, -p]] },
    { n: [0, -1, 0], c: [[-p, -p, -p], [p, -p, -p], [p, -p, p], [-p, -p, -p], [p, -p, p], [-p, -p, p]] },
  ];
}

function buildProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
