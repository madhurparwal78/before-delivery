import type { Graph, NodeT } from "./api";

export interface Camera {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  fov: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: 35, pitch: -18, distance: 6, target: [0, 0.6, 0], fov: 45 };

const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  gl_Position = uProj * uView * world;
}
`;

const FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uRoughness;
uniform float uMetalness;
uniform float uOutline;
uniform vec3 uLightDir;
uniform vec3 uEye;
void main() {
  if (uOutline > 0.5) {
    gl_FragColor = vec4(0.14, 0.34, 0.78, 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 l = normalize(uLightDir);
  float diff = max(dot(n, l), 0.0);
  vec3 viewDir = normalize(uEye - vWorld);
  vec3 halfDir = normalize(l + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), mix(8.0, 96.0, 1.0 - uRoughness)) * (1.0 - uRoughness) * (0.35 + uMetalness);
  vec3 base = uColor * (0.35 + 0.65 * diff) + vec3(spec);
  gl_FragColor = vec4(clamp(base, 0.0, 1.0), 1.0);
}
`;

/** b := a * b, column-major 4x4. */
function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      out[col * 4 + row] = sum;
    }
  }
  for (let i = 0; i < 16; i++) b[i] = out[i]!;
  return b;
}

function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function translation(x: number, y: number, z: number): Float32Array {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function rotationY(deg: number): Float32Array {
  const r = (deg * Math.PI) / 180;
  const m = identity();
  m[0] = Math.cos(r);
  m[2] = -Math.sin(r);
  m[8] = Math.sin(r);
  m[10] = Math.cos(r);
  return m;
}

function rotationX(deg: number): Float32Array {
  const r = (deg * Math.PI) / 180;
  const m = identity();
  m[5] = Math.cos(r);
  m[6] = Math.sin(r);
  m[9] = -Math.sin(r);
  m[10] = Math.cos(r);
  return m;
}

function rotationZ(deg: number): Float32Array {
  const r = (deg * Math.PI) / 180;
  const m = identity();
  m[0] = Math.cos(r);
  m[1] = Math.sin(r);
  m[4] = -Math.sin(r);
  m[5] = Math.cos(r);
  return m;
}

function scaleM(sx: number, sy: number, sz: number): Float32Array {
  const m = identity();
  m[0] = sx;
  m[5] = sy;
  m[10] = sz;
  return m;
}

function nodeMatrix(node: NodeT): Float32Array {
  const m = translation(node.position[0], node.position[1], node.position[2]);
  mat4Multiply(m, rotationY(node.rotation[1]));
  mat4Multiply(m, rotationX(node.rotation[0]));
  mat4Multiply(m, rotationZ(node.rotation[2]));
  mat4Multiply(m, scaleM(node.scale[0], node.scale[1], node.scale[2]));
  return m;
}

function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function cameraMatrix(cam: Camera): { view: Float32Array; eye: [number, number, number] } {
  const yaw = (cam.yaw * Math.PI) / 180;
  const pitch = (cam.pitch * Math.PI) / 180;
  const d = cam.distance;
  const eye: [number, number, number] = [
    cam.target[0] + d * Math.cos(pitch) * Math.sin(yaw),
    cam.target[1] + d * Math.sin(-pitch),
    cam.target[2] + d * Math.cos(pitch) * Math.cos(yaw),
  ];
  const view = translation(-eye[0], -eye[1], -eye[2]);
  mat4Multiply(view, rotationY(-cam.yaw));
  mat4Multiply(view, rotationX(-cam.pitch));
  return { view, eye };
}

interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

function meshSphere(): MeshData {
  const lat = 12;
  const lon = 18;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const theta = (i / lat) * Math.PI;
    for (let j = 0; j <= lon; j++) {
      const phi = (j / lon) * 2 * Math.PI;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = i * (lon + 1) + j;
      const b = a + lon + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function meshBox(): MeshData {
  const p = 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: [number[], number[]][] = [
    [[-1, -1, 1], [0, 0, 1]],
    [[1, -1, 1], [0, 0, 1]],
    [[1, 1, 1], [0, 0, 1]],
    [[-1, 1, 1], [0, 0, 1]],
    [[1, -1, -1], [0, 0, -1]],
    [[-1, -1, -1], [0, 0, -1]],
    [[-1, 1, -1], [0, 0, -1]],
    [[1, 1, -1], [0, 0, -1]],
    [[-1, -1, -1], [-1, 0, 0]],
    [[-1, -1, 1], [-1, 0, 0]],
    [[-1, 1, 1], [-1, 0, 0]],
    [[-1, 1, -1], [-1, 0, 0]],
    [[1, -1, 1], [1, 0, 0]],
    [[1, -1, -1], [1, 0, 0]],
    [[1, 1, -1], [1, 0, 0]],
    [[1, 1, 1], [1, 0, 0]],
    [[-1, 1, 1], [0, 1, 0]],
    [[1, 1, 1], [0, 1, 0]],
    [[1, 1, -1], [0, 1, 0]],
    [[-1, 1, -1], [0, 1, 0]],
    [[-1, -1, -1], [0, -1, 0]],
    [[1, -1, -1], [0, -1, 0]],
    [[1, -1, 1], [0, -1, 0]],
    [[-1, -1, 1], [0, -1, 0]],
  ];
  for (let f = 0; f < faces.length; f += 4) {
    const base = positions.length / 3;
    for (let k = 0; k < 4; k++) {
      const face = faces[f + k]!;
      const pos = face[0]!;
      const nrm = face[1]!;
      positions.push(pos[0]! * p, pos[1]! * p, pos[2]! * p);
      normals.push(nrm[0]!, nrm[1]!, nrm[2]!);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function meshCylinder(): MeshData {
  const segments = 20;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * 2 * Math.PI;
    const x = Math.sin(phi);
    const z = Math.cos(phi);
    positions.push(x, -1, z, x, 1, z);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const topCenter = positions.length / 3;
  positions.push(0, 1, 0);
  normals.push(0, 1, 0);
  const bottomCenter = positions.length / 3;
  positions.push(0, -1, 0);
  normals.push(0, -1, 0);
  for (let i = 0; i < segments; i++) {
    const a0 = i * 2;
    const a1 = ((i + 1) % segments) * 2;
    indices.push(a0 + 1, topCenter, a1 + 1);
    indices.push(a0, a1, bottomCenter);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function meshPlane(): MeshData {
  const positions = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, indices };
}

export class Viewport {
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private meshes: Record<string, MeshData> = {};
  private buffers: Record<string, { pos: WebGLBuffer; nrm: WebGLBuffer; idx: WebGLBuffer; count: number }> = {};
  public camera: Camera = { ...DEFAULT_CAMERA };
  public highlighted: Set<string> = new Set();
  private canvas: HTMLCanvasElement;
  private onNodeClick: ((nodeId: string) => void) | null = null;
  private onHover: ((hovering: boolean) => void) | null = null;
  private onYaw: ((yaw: number) => void) | null = null;
  private pickNodes: { nodeId: string; center: [number, number, number] }[] = [];
  private idleTurn = false;
  private idleTimer: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = (canvas.getContext("webgl", { antialias: true }) ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (this.gl) {
      this.initGl();
      this.bindControls();
    }
  }

  get ok(): boolean {
    return this.gl !== null;
  }

  private initGl(): void {
    const gl = this.gl!;
    const compile = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    gl.useProgram(program);
    this.program = program;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.114, 0.11, 0.094, 1);

    this.meshes = {
      sphere: meshSphere(),
      box: meshBox(),
      cylinder: meshCylinder(),
      plane: meshPlane(),
    };
    for (const [name, mesh] of Object.entries(this.meshes)) {
      const pos = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      const nrm = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      const idx = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      this.buffers[name] = { pos, nrm, idx, count: mesh.indices.length };
    }
  }

  setClickHandler(fn: ((nodeId: string) => void) | null): void {
    this.onNodeClick = fn;
  }

  setHoverHandler(fn: ((hovering: boolean) => void) | null): void {
    this.onHover = fn;
  }

  setYawHandler(fn: ((yaw: number) => void) | null): void {
    this.onYaw = fn;
  }

  private bindControls(): void {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let panning = false;
    let panX = 0;
    let panY = 0;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      panning = e.button === 1 || e.shiftKey || (e.pointerType === "touch" && e.isPrimary === false);
      lastX = e.clientX;
      lastY = e.clientY;
      panX = e.clientX;
      panY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      this.pointerActivity();
    });
    canvas.addEventListener("pointermove", (e) => {
      this.pointerActivity();
      this.onHover?.(true);
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (panning || (e.pointerType === "touch" && e.buttons === 4)) {
        this.camera.target[0] -= (e.clientX - panX) * 0.01;
        this.camera.target[1] += (e.clientY - panY) * 0.01;
        panX = e.clientX;
        panY = e.clientY;
      } else {
        this.camera.yaw += dx * 0.4;
        this.camera.pitch = Math.max(-89, Math.min(89, this.camera.pitch + dy * 0.4));
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (dragging && Math.abs(e.clientX - panX) < 3 && Math.abs(e.clientY - panY) < 3 && this.onNodeClick) {
        const hit = this.pick(e.clientX, e.clientY);
        if (hit) this.onNodeClick(hit);
      }
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointerleave", () => {
      this.onHover?.(false);
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.pointerActivity();
      this.camera.distance = Math.max(1, Math.min(60, this.camera.distance * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      this.pointerActivity();
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.camera.yaw = (this.camera.yaw - 5 + 360) % 360;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        this.camera.yaw = (this.camera.yaw + 5) % 360;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.camera.pitch = Math.max(-89, this.camera.pitch - 5);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.camera.pitch = Math.min(89, this.camera.pitch + 5);
      }
    });
  }

  private pointerActivity(): void {
    this.stopIdleTurn();
  }

  startIdleTurn(): void {
    this.idleTurn = true;
  }

  isIdleTurn(): boolean {
    return this.idleTurn;
  }

  stopIdleTurn(): void {
    this.idleTurn = false;
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    let best: { nodeId: string; dist: number } | null = null;
    const { view } = cameraMatrix(this.camera);
    const proj = perspective(this.camera.fov, rect.width / Math.max(1, rect.height), 0.05, 200);
    for (const node of this.pickNodes) {
      const m = nodeMatrixCenter(node.center);
      // transform center to clip space
      const world = [
        m[0]! * node.center[0] + m[4]! * node.center[1] + m[8]! * node.center[2] + m[12]!,
        m[1]! * node.center[0] + m[5]! * node.center[1] + m[9]! * node.center[2] + m[13]!,
        m[2]! * node.center[0] + m[6]! * node.center[1] + m[10]! * node.center[2] + m[14]!,
      ];
      const eyeSpace = [
        view[0]! * world[0]! + view[4]! * world[1]! + view[8]! * world[2]! + view[12]!,
        view[1]! * world[0]! + view[5]! * world[1]! + view[9]! * world[2]! + view[13]!,
        view[2]! * world[0]! + view[6]! * world[1]! + view[10]! * world[2]! + view[14]!,
      ];
      const clipX = proj[0]! * eyeSpace[0]! + proj[8]! * eyeSpace[2]!;
      const clipY = proj[5]! * eyeSpace[1]! + proj[9]! * eyeSpace[2]!;
      const clipW = -eyeSpace[2]!;
      if (clipW <= 0.1) continue;
      const sx = (clipX / clipW * 0.5 + 0.5) * rect.width;
      const sy = (0.5 - clipY / clipW * 0.5) * rect.height;
      const dist = Math.hypot(sx - cx, sy - cy);
      const hitRadius = 34;
      if (dist < hitRadius && (!best || dist < best.dist)) {
        best = { nodeId: node.nodeId, dist };
      }
    }
    return best?.nodeId ?? null;
  }

  render(graph: Graph, yawOverride?: number): void {
    const gl = this.gl;
    if (!gl) return;
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = this.camera;
    if (yawOverride !== undefined) cam.yaw = ((yawOverride % 360) + 360) % 360;
    const { view, eye } = cameraMatrix(cam);
    const proj = perspective(cam.fov, width / Math.max(1, height), 0.05, 200);

    const program = this.program!;
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "uView"), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "uProj"), false, proj);
    gl.uniform3fv(gl.getUniformLocation(program, "uEye"), eye);
    gl.uniform3fv(gl.getUniformLocation(program, "uLightDir"), new Float32Array([0.55, 0.75, 0.45]));

    const aPos = gl.getAttribLocation(program, "aPos");
    const aNormal = gl.getAttribLocation(program, "aNormal");
    const uModel = gl.getUniformLocation(program, "uModel");
    const uColor = gl.getUniformLocation(program, "uColor");
    const uRoughness = gl.getUniformLocation(program, "uRoughness");
    const uMetalness = gl.getUniformLocation(program, "uMetalness");
    const uOutline = gl.getUniformLocation(program, "uOutline");

    this.pickNodes = [];
    for (const node of graph.nodes) {
      if (node.kind !== "mesh") continue;
      if (!node.visible) continue;
      const meshName = node.primitive ?? "box";
      const buffer = this.buffers[meshName] ?? this.buffers.box!;
      const model = nodeMatrix(node);
      gl.uniformMatrix4fv(uModel, false, model);
      const layer = node.materialLayers[0];
      const color = layer ? layer.color : [0.62, 0.64, 0.7];
      gl.uniform3fv(uColor, new Float32Array(color));
      gl.uniform1f(uRoughness, layer ? layer.roughness : 0.7);
      gl.uniform1f(uMetalness, layer ? layer.metalness : 0.2);
      gl.uniform1f(uOutline, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.pos);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.nrm);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer.idx);
      gl.drawElements(gl.TRIANGLES, buffer.count, gl.UNSIGNED_SHORT, 0);

      if (this.highlighted.has(node.id)) {
        gl.uniform1f(uOutline, 1);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
        gl.drawElements(gl.TRIANGLES, buffer.count, gl.UNSIGNED_SHORT, 0);
        gl.cullFace(gl.BACK);
        gl.disable(gl.CULL_FACE);
        gl.uniform1f(uOutline, 0);
      }

      this.pickNodes.push({ nodeId: node.id, center: [node.position[0], node.position[1], node.position[2]] });
    }

    // ground grid reference
    const grid = this.buffers.plane!;
    gl.uniformMatrix4fv(uModel, false, scaleM(4, 1, 4));
    gl.uniform3fv(uColor, new Float32Array([0.16, 0.15, 0.13]));
    gl.uniform1f(uOutline, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.pos);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.nrm);
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.idx);
    gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(uOutline, 0);
  }

  getYaw(): number {
    return ((this.camera.yaw % 360) + 360) % 360;
  }

  /** Projects a world point to canvas-relative pixel coordinates, or null if behind the camera. */
  projectPoint(world: [number, number, number]): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const { view } = cameraMatrix(this.camera);
    const proj = perspective(this.camera.fov, rect.width / Math.max(1, rect.height), 0.05, 200);
    const eyeSpace = [
      view[0]! * world[0] + view[4]! * world[1] + view[8]! * world[2] + view[12]!,
      view[1]! * world[0] + view[5]! * world[1] + view[9]! * world[2] + view[13]!,
      view[2]! * world[0] + view[6]! * world[1] + view[10]! * world[2] + view[14]!,
    ];
    const clipW = -eyeSpace[2]!;
    if (clipW <= 0.1) return null;
    const clipX = proj[0]! * eyeSpace[0]! + proj[8]! * eyeSpace[2]!;
    const clipY = proj[5]! * eyeSpace[1]! + proj[9]! * eyeSpace[2]!;
    return {
      x: (clipX / clipW * 0.5 + 0.5) * rect.width,
      y: (0.5 - clipY / clipW * 0.5) * rect.height,
    };
  }

  dispose(): void {
    this.stopIdleTurn();
  }
}

function nodeMatrixCenter(center: [number, number, number]): Float32Array {
  return translation(center[0]!, center[1]!, center[2]!);
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl");
  } catch {
    return false;
  }
}
