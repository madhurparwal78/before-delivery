import {
  identity,
  lookAt,
  multiply,
  orbitEye,
  perspective,
  type Mat4,
  type Vec3,
} from './math.js';
import {
  capsuleMesh,
  cubeMesh,
  cylinderMesh,
  groundMesh,
  sphereMesh,
  wedgeMesh,
  type MeshData,
} from './meshes.js';

export type MeshName = 'cube' | 'wedge' | 'sphere' | 'cylinder' | 'capsule' | 'ground';

export interface DrawItem {
  mesh: MeshName;
  model: Mat4;
  colour: readonly [number, number, number];
}

export interface Camera {
  target: Vec3;
  distance: number;
  yaw: number;
  pitch: number;
}

export const FIELD_OF_VIEW = 0.9;

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProjection;
varying vec3 vNormal;
void main() {
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColour;
varying vec3 vNormal;
void main() {
  vec3 light = normalize(vec3(0.45, 0.85, 0.3));
  float shade = 0.55 + 0.45 * max(dot(normalize(vNormal), light), 0.0);
  gl_FragColor = vec4(uColour * shade, 1.0);
}`;

const LINE_VERTEX_SHADER = `
attribute vec3 aPosition;
uniform mat4 uViewProjection;
void main() { gl_Position = uViewProjection * vec4(aPosition, 1.0); }`;

const LINE_FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColour;
void main() { gl_FragColor = vec4(uColour, 0.5); }`;

interface Buffers {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  count: number;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
  return shader;
}

function program(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram | null {
  const vertexShader = compile(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const created = gl.createProgram();
  if (!vertexShader || !fragmentShader || !created) return null;
  gl.attachShader(created, vertexShader);
  gl.attachShader(created, fragmentShader);
  gl.linkProgram(created);
  if (!gl.getProgramParameter(created, gl.LINK_STATUS)) return null;
  return created;
}

export const SKY: readonly [number, number, number] = [0.42, 0.72, 0.9];
export const GRASS: readonly [number, number, number] = [0.42, 0.73, 0.45];

export class Stage {
  private readonly meshes = new Map<MeshName, Buffers>();

  private gridBuffer: WebGLBuffer | null = null;

  private gridCount = 0;

  private lastViewProjection: Mat4 = identity();

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
    private readonly solid: WebGLProgram,
    private readonly lines: WebGLProgram,
  ) {
    this.upload('cube', cubeMesh());
    this.upload('wedge', wedgeMesh());
    this.upload('sphere', sphereMesh());
    this.upload('cylinder', cylinderMesh());
    this.upload('capsule', capsuleMesh());
    this.upload('ground', groundMesh(200));
    this.buildGrid();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Returns null when the browser cannot provide WebGL. */
  static create(canvas: HTMLCanvasElement): Stage | null {
    const gl =
      (canvas.getContext('webgl', { antialias: true, alpha: false }) as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return null;
    const solid = program(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    const lines = program(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    if (!solid || !lines) return null;
    return new Stage(canvas, gl, solid, lines);
  }

  private upload(name: MeshName, data: MeshData): void {
    const gl = this.gl;
    const position = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.positions), gl.STATIC_DRAW);
    const normal = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.normals), gl.STATIC_DRAW);
    this.meshes.set(name, { position, normal, count: data.positions.length / 3 });
  }

  private buildGrid(): void {
    const gl = this.gl;
    const points: number[] = [];
    const extent = 20;
    for (let line = -extent; line <= extent; line += 1) {
      points.push(-extent, 0.002, line, extent, 0.002, line);
      points.push(line, 0.002, -extent, line, 0.002, extent);
    }
    this.gridBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    this.gridCount = points.length / 3;
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  get viewProjectionMatrix(): Mat4 {
    return this.lastViewProjection;
  }

  eyeOf(camera: Camera): Vec3 {
    return orbitEye(camera.target, camera.distance, camera.yaw, camera.pitch);
  }

  resize(): { width: number; height: number } {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height };
  }

  render(items: readonly DrawItem[], camera: Camera, grid: boolean): void {
    const gl = this.gl;
    const { width, height } = this.resize();
    gl.viewport(0, 0, width, height);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const eye = this.eyeOf(camera);
    const view = lookAt(eye, camera.target, [0, 1, 0]);
    const projection = perspective(FIELD_OF_VIEW, width / height, 0.05, 500);
    const viewProjection = multiply(projection, view);
    this.lastViewProjection = viewProjection;

    gl.useProgram(this.solid);
    const uViewProjection = gl.getUniformLocation(this.solid, 'uViewProjection');
    const uModel = gl.getUniformLocation(this.solid, 'uModel');
    const uColour = gl.getUniformLocation(this.solid, 'uColour');
    gl.uniformMatrix4fv(uViewProjection, false, viewProjection);
    const positionAttribute = gl.getAttribLocation(this.solid, 'aPosition');
    const normalAttribute = gl.getAttribLocation(this.solid, 'aNormal');
    gl.enableVertexAttribArray(positionAttribute);
    gl.enableVertexAttribArray(normalAttribute);

    const all: DrawItem[] = [
      { mesh: 'ground', model: identity(), colour: GRASS },
      ...items,
    ];
    for (const item of all) {
      const buffers = this.meshes.get(item.mesh);
      if (!buffers) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
      gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.vertexAttribPointer(normalAttribute, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(uModel, false, item.model);
      gl.uniform3fv(uColour, new Float32Array(item.colour));
      gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
    }

    if (grid && this.gridBuffer) {
      gl.useProgram(this.lines);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lines, 'uViewProjection'), false, viewProjection);
      gl.uniform3fv(gl.getUniformLocation(this.lines, 'uColour'), new Float32Array([0.33, 0.6, 0.37]));
      const attribute = gl.getAttribLocation(this.lines, 'aPosition');
      gl.enableVertexAttribArray(attribute);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
      gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, this.gridCount);
    }
  }
}
