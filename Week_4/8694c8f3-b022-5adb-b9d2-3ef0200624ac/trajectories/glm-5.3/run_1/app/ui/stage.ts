import { identity, lookAt, multiply, perspective, rotationXYZ, scaling, transformPoint, translation, type Mat4 } from './mat4.js';
import type { LayerDoc } from './api.js';
import { valueAtTick } from './beattime.js';

export interface FrameState {
  tick: number;
  beat: number;
  bpm: number;
  playing: boolean;
}

export interface GizmoPositions {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

interface Geometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
  mode: number;
  count: number;
}

interface DrawItem {
  layer: LayerDoc;
  model: Mat4;
  tint: [number, number, number];
  alpha: number;
  geometry: Geometry | null;
  shaderProgram: WebGLProgram | null;
}

export class StageRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private frameCount = 0;
  private program: WebGLProgram | null = null;
  private shaderPrograms = new Map<string, WebGLProgram>();
  private readonly geometries = new Map<string, Geometry>();
  private gridGeometry: Geometry | null = null;
  private flatProgram: WebGLProgram | null = null;

  constructor (canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (gl === null) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.init();
  }

  static isSupported (): boolean {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  }

  private init (): void {
    const { gl } = this;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    void this.buildProgram();
    this.flatProgram = this.buildFlatProgram();
  }

  private buildFlatProgram (): WebGLProgram | null {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
in vec3 a_position;
void main() { gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0); }`);
    const fs = this.compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
uniform vec4 u_colour;
out vec4 fragColor;
void main() { fragColor = u_colour; }`);
    if (vs === null || fs === null) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
  }

  private buildProgram (): WebGLProgram | null {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
in vec3 a_position;
in vec3 a_normal;
out vec3 v_normal;
void main() {
  v_normal = mat3(u_model) * a_normal;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`);
    const fs = this.compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
uniform vec3 u_tint;
uniform float u_alpha;
uniform vec3 u_light_dir;
uniform float u_light_intensity;
in vec3 v_normal;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_normal);
  float diff = max(dot(n, normalize(u_light_dir)), 0.0) * 0.7 + 0.3;
  fragColor = vec4(u_tint * diff * u_light_intensity, u_alpha);
}`);
    if (vs === null || fs === null) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    this.program = program;
    return program;
  }

  private compile (type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return null;
    }
    return shader;
  }

  // Compiles the shader layer source exactly as typed; returns null on failure.
  compileFragment (source: string): WebGLProgram | null {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform mat4 u_projection;
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0) * u_projection; }`);
    const fs = this.compile(gl.FRAGMENT_SHADER, source);
    if (vs === null || fs === null) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return program;
  }

  shaderError (source: string): { line: number; message: string } | null {
    const gl = this.gl;
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    const match = /:(\d+):(\d+):\s*(.*)/.exec(log);
    if (match !== null) {
      return { line: Number(match[1]), message: match[3] };
    }
    return { line: 1, message: log.split('\n')[0] ?? 'Shader failed to compile' };
  }

  private cubeGeometry (): Geometry {
    const p = 0.5;
    const positions = new Float32Array([
      -p, -p, p, p, -p, p, p, p, p, -p, p, p,
      -p, -p, -p, -p, p, -p, p, p, -p, p, -p, -p,
      -p, p, p, p, p, p, p, p, -p, -p, p, -p,
      -p, -p, p, -p, -p, -p, p, -p, -p, p, -p, p,
      p, -p, p, p, p, p, p, p, -p, p, -p, -p,
      -p, -p, -p, -p, p, -p, -p, p, p, -p, -p, p,
    ]);
    const normals = new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    ]);
    const indices = new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
      16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]);
    return { positions, normals, indices, mode: this.gl.TRIANGLES, count: indices.length };
  }

  private sphereGeometry (): Geometry {
    const rows = 12;
    const columns = 16;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= rows; i++) {
      const theta = (i / rows) * Math.PI;
      for (let j = 0; j <= columns; j++) {
        const phi = (j / columns) * Math.PI * 2;
        const x = Math.sin(theta) * Math.cos(phi);
        const y = Math.cos(theta);
        const z = Math.sin(theta) * Math.sin(phi);
        positions.push(x * 0.5, y * 0.5, z * 0.5);
        normals.push(x, y, z);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        const a = i * (columns + 1) + j;
        const b = a + columns + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices), mode: this.gl.TRIANGLES, count: indices.length };
  }

  private planeGeometry (): Geometry {
    const positions = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    return { positions, normals, indices, mode: this.gl.TRIANGLES, count: 6 };
  }

  private torusGeometry (): Geometry {
    const major = 0.35;
    const minor = 0.15;
    const rings = 20;
    const segments = 12;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= rings; i++) {
      const u = (i / rings) * Math.PI * 2;
      for (let j = 0; j <= segments; j++) {
        const v = (j / segments) * Math.PI * 2;
        const x = (major + minor * Math.cos(v)) * Math.cos(u);
        const y = minor * Math.sin(v);
        const z = (major + minor * Math.cos(v)) * Math.sin(u);
        positions.push(x, y, z);
        normals.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u));
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segments; j++) {
        const a = i * (segments + 1) + j;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices), mode: this.gl.TRIANGLES, count: indices.length };
  }

  private tubeGeometry (): Geometry {
    const rings = 28;
    const radius = 0.5;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const height = 1;
    for (let ring = 0; ring <= rings; ring++) {
      const z = (ring / rings - 0.5) * height;
      for (let segment = 0; segment <= 12; segment++) {
        const angle = (segment / 12) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        positions.push(x, y, z);
        normals.push(x / radius, y / radius, 0);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let segment = 0; segment < 12; segment++) {
        const a = ring * 13 + segment;
        const b = a + 13;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices), mode: this.gl.TRIANGLES, count: indices.length };
  }

  private geometryFor (kind: string): Geometry | null {
    if (this.geometries.has(kind)) return this.geometries.get(kind) ?? null;
    let geometry: Geometry;
    switch (kind) {
      case 'cube': geometry = this.cubeGeometry(); break;
      case 'sphere': geometry = this.sphereGeometry(); break;
      case 'plane': geometry = this.planeGeometry(); break;
      case 'torus': geometry = this.torusGeometry(); break;
      case 'tube': geometry = this.tubeGeometry(); break;
      default: return null;
    }
    this.geometries.set(kind, geometry);
    return geometry;
  }

  getFrameCount (): number { return this.frameCount; }

  // Draw the whole stage from the given layers and camera.
  render (options: {
    layers: LayerDoc[];
    keysByLayer: Map<string, { property: string; tick: number; value: number }[]>;
    overrides: Map<string, Map<string, number>>;
    cameraLayer: LayerDoc | null;
    tick: number;
    beat: number;
    bpm: number;
    selectedId: string | null;
    orbit: { yaw: number; pitch: number; distance: number };
    onGizmos?: (positions: GizmoPositions | null) => void;
    gizmoMode?: 'move' | 'rotate' | 'scale' | null;
    bus?: string;
  }): void {
    const gl = this.gl;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== width * devicePixelRatio || this.canvas.height !== height * devicePixelRatio) {
      this.canvas.width = Math.floor(width * devicePixelRatio);
      this.canvas.height = Math.floor(height * devicePixelRatio);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const camera = options.cameraLayer;
    const fov = camera !== null ? (camera.props.fov ?? 50) : 50;
    const near = camera !== null ? (camera.props.near ?? 0.1) : 0.1;
    const far = camera !== null ? (camera.props.far ?? 200) : 200;

    let eye: [number, number, number] = [0, 2, 8];
    let center: [number, number, number] = [0, 0, 0];
    let up: [number, number, number] = [0, 1, 0];
    let viewMatrix: Mat4;
    if (camera !== null) {
      const pos = camera.position;
      const pitch = camera.rotation[0] * Math.PI / 180;
      const yaw = camera.rotation[1] * Math.PI / 180;
      const distance = Math.hypot(0 - pos[0], 0 - pos[1], 0 - pos[2]);
      void distance;
      eye = pos;
      center = [pos[0] + Math.sin(yaw) * Math.cos(pitch), pos[1] + Math.sin(pitch), pos[2] + Math.cos(yaw) * Math.cos(pitch)];
      viewMatrix = lookAt(eye, center, up);
    } else {
      const { yaw, pitch, distance } = options.orbit;
      const px = Math.sin(yaw) * Math.cos(pitch) * distance;
      const py = Math.sin(pitch) * distance;
      const pz = Math.cos(yaw) * Math.cos(pitch) * distance;
      eye = [px, py, pz];
      viewMatrix = lookAt(eye, [0, 0, 0], up);
    }
    const projection = perspective(fov, aspect, near, far);

    // Collect visible layers in tree order, applying key and graph overrides.
    const bus = options.bus ?? 'main';
    const items: DrawItem[] = [];
    for (const layer of options.layers) {
      if (!layer.visible) continue;
      if (layer.kind === 'group' || layer.kind === 'camera' || layer.kind === 'light') continue;
      if (!layer.output_buses.includes(bus)) continue;
      const override = options.overrides.get(layer.id);
      const keys = options.keysByLayer.get(layer.id) ?? [];
      const valueFor = (path: string, fallback: number): number => {
        const graphValue = override?.get(path);
        if (graphValue !== undefined) return graphValue;
        const keyList = keys.filter((key) => key.property === path);
        if (keyList.length > 0) return valueAtTick(keyList, options.tick, fallback);
        return fallback;
      };
      const position: [number, number, number] = [valueFor('position.x', layer.position[0]), valueFor('position.y', layer.position[1]), valueFor('position.z', layer.position[2])];
      const rotation: [number, number, number] = [valueFor('rotation.x', layer.rotation[0]), valueFor('rotation.y', layer.rotation[1]), valueFor('rotation.z', layer.rotation[2])];
      const scale: [number, number, number] = [valueFor('scale.x', layer.scale[0]), valueFor('scale.y', layer.scale[1]), valueFor('scale.z', layer.scale[2])];
      let model = multiply(translation(...position), multiply(rotationXYZ(...rotation), scaling(...scale)));
      if (layer.kind === 'tube') {
        const twist = valueFor('props.twist', layer.props.twist ?? 0);
        const radius = valueFor('props.radius', layer.props.radius ?? 1);
        model = multiply(model, multiply(scaling(radius, radius, 1), rotationXYZ(0, 0, twist * 90)));
      }
      const tint = layer.material?.tint ?? [1, 1, 1];
      const alpha = layer.material !== null ? valueFor('material.tint_alpha', layer.material.tint_alpha) : 1;
      items.push({ layer, model, tint, alpha, geometry: this.geometryFor(layer.kind), shaderProgram: null });
    }

    const program = this.program ?? this.buildProgram();
    if (program !== null) {
      gl.useProgram(program);
      const projectionLoc = gl.getUniformLocation(program, 'u_projection');
      const viewLoc = gl.getUniformLocation(program, 'u_view');
      gl.uniformMatrix4fv(projectionLoc, false, projection);
      gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
      const lightDir = gl.getUniformLocation(program, 'u_light_dir');
      const lightIntensity = gl.getUniformLocation(program, 'u_light_intensity');
      const light = options.layers.find((l) => l.kind === 'light');
      gl.uniform3fv(lightDir, light !== undefined ? new Float32Array(light.position) : new Float32Array([4, 6, 4]));
      gl.uniform1f(lightIntensity, light !== undefined ? (light.props.intensity ?? 1) : 1);
      for (const item of items) {
        if (item.geometry === null) continue;
        if (item.layer.kind === 'shader') continue;
        const tintLoc = gl.getUniformLocation(program, 'u_tint');
        const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
        const modelLoc = gl.getUniformLocation(program, 'u_model');
        gl.uniform3fv(tintLoc, new Float32Array(item.tint));
        gl.uniform1f(alphaLoc, item.alpha);
        gl.uniformMatrix4fv(modelLoc, false, item.model);
        this.drawGeometry(item.geometry);
      }
    }

    // Shader layers draw as full-stage passes with their own program.
    for (const item of items) {
      if (item.layer.kind !== 'shader' || item.geometry !== null) continue;
      const program = this.shaderPrograms.get(item.layer.id) ?? null;
      if (program === null) continue;
      gl.useProgram(program);
      const beatLoc = gl.getUniformLocation(program, 'u_beat');
      const timeLoc = gl.getUniformLocation(program, 'u_time');
      const resLoc = gl.getUniformLocation(program, 'u_resolution');
      const intensityLoc = gl.getUniformLocation(program, 'u_intensity');
      if (beatLoc !== null) gl.uniform1f(beatLoc, options.beat);
      if (timeLoc !== null) gl.uniform1f(timeLoc, options.beat * 60 / options.bpm);
      if (resLoc !== null) gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);
      if (intensityLoc !== null) gl.uniform1f(intensityLoc, 1);
      this.drawFullscreenQuad(program);
    }

    // Grid: sea-green axis lines.
    if (this.gridGeometry === null) {
      const positions: number[] = [];
      const range = 10;
      for (let i = -range; i <= range; i++) {
        positions.push(i, 0, -range, i, 0, range);
        positions.push(-range, 0, i, range, 0, i);
      }
      this.gridGeometry = { positions: new Float32Array(positions), normals: new Float32Array(positions.length), indices: new Uint16Array([]), mode: gl.LINES, count: positions.length / 3 };
    }
    if (this.flatProgram !== null) {
      gl.useProgram(this.flatProgram);
      const projectionLoc = gl.getUniformLocation(this.flatProgram, 'u_projection');
      const viewLoc = gl.getUniformLocation(this.flatProgram, 'u_view');
      const modelLoc = gl.getUniformLocation(this.flatProgram, 'u_model');
      const colourLoc = gl.getUniformLocation(this.flatProgram, 'u_colour');
      gl.uniformMatrix4fv(projectionLoc, false, projection);
      gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
      gl.uniformMatrix4fv(modelLoc, false, identity());
      gl.uniform4f(colourLoc, 0.18, 0.62, 0.43, 0.35);
      this.drawLines(this.gridGeometry);
    }

    // Gizmos: three handles from the selected layer's origin, 80 px long.
    if (options.onGizmos !== undefined) {
      const positions = this.gizmoPositions(options.layers, options.selectedId, projection, viewMatrix);
      options.onGizmos(positions);
      if (positions !== null && options.gizmoMode !== null && options.gizmoMode !== undefined) {
        this.drawGizmoHandles(positions);
      }
    }
    this.frameCount += 1;
  }

  private drawGizmoHandles (positions: GizmoPositions): void {
    const gl = this.gl;
    if (this.flatProgram === null) return;
    gl.useProgram(this.flatProgram);
    const colourLoc = gl.getUniformLocation(this.flatProgram, 'u_colour');
    const colours: Record<'x' | 'y' | 'z', [number, number, number, number]> = {
      x: [0.72, 0.12, 0.12, 1],
      y: [0.2, 0.9, 0.25, 1],
      z: [0.25, 0.6, 0.95, 1],
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      const [sx, sy] = positions[axis];
      const origin = [sx, sy];
      const positionsPx: number[] = [origin[0], origin[1], sx, sy];
      const verts = positionsPx.map((v, i) => (i % 2 === 1 ? (1 - v / this.canvas.clientHeight) * 2 - 1 : (v / this.canvas.clientWidth) * 2 - 1));
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      gl.uniform4fv(colourLoc, new Float32Array(colours[axis]));
      const posLoc = gl.getAttribLocation(this.flatProgram, 'a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, 2);
      const gripSize = 12;
      const gripVerts = new Float32Array([
        (sx / this.canvas.clientWidth) * 2 - 1 + gripSize / this.canvas.clientWidth, (1 - sy / this.canvas.clientHeight) * 2 - 1 - gripSize / this.canvas.clientHeight,
        (sx / this.canvas.clientWidth) * 2 - 1 - gripSize / this.canvas.clientWidth, (1 - sy / this.canvas.clientHeight) * 2 - 1 + gripSize / this.canvas.clientHeight,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, gripVerts, gl.STATIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteBuffer(buffer);
    }
  }

  private gizmoPositions (layers: LayerDoc[], selectedId: string | null, projection: Mat4, view: Mat4): GizmoPositions | null {
    if (selectedId === null) return null;
    const layer = layers.find((l) => l.id === selectedId);
    if (layer === undefined) return null;
    const world = layer.position;
    const clip = transformPoint(multiply(projection, view), world);
    if (clip[3] === 0) return null;
    const ndcX = clip[0] / clip[3];
    const ndcY = clip[1] / clip[3];
    const cssX = (ndcX * 0.5 + 0.5) * this.canvas.clientWidth;
    const cssY = (0.5 - ndcY * 0.5) * this.canvas.clientHeight;
    const toScreen = (p: [number, number, number]): [number, number] => {
      const c = transformPoint(multiply(projection, view), p);
      if (c[3] === 0) return [cssX, cssY];
      return [(c[0] / c[3] * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - c[1] / c[3] * 0.5) * this.canvas.clientHeight];
    };
    const axisTip = (axis: 'x' | 'y' | 'z'): [number, number] => {
      const step: [number, number, number] = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const scale = Math.max(0.6, Math.hypot(world[0], world[1], world[2]) * 0.12);
      return toScreen([world[0] + step[0] * scale, world[1] + step[1] * scale, world[2] + step[2] * scale]);
    };
    const normalizeTo80 = (origin: [number, number], tip: [number, number]): [number, number] => {
      const dx = tip[0] - origin[0];
      const dy = tip[1] - origin[1];
      const length = Math.hypot(dx, dy);
      if (length < 0.001) return origin;
      return [origin[0] + (dx / length) * 80, origin[1] + (dy / length) * 80];
    };
    const origin = toScreen(world);
    return {
      x: normalizeTo80(origin, axisTip('x')),
      y: normalizeTo80(origin, axisTip('y')),
      z: normalizeTo80(origin, axisTip('z')),
    };
  }

  private drawGeometry (geometry: Geometry): void {
    const gl = this.gl;
    const program = this.program;
    if (program === null) return;
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
    const normalLoc = gl.getAttribLocation(program, 'a_normal');
    gl.enableVertexAttribArray(normalLoc);
    gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
    gl.drawElements(geometry.mode, geometry.count, gl.UNSIGNED_SHORT, 0);
    gl.deleteBuffer(posBuffer);
    gl.deleteBuffer(normalBuffer);
    gl.deleteBuffer(indexBuffer);
  }

  private drawLines (geometry: Geometry): void {
    const gl = this.gl;
    if (this.flatProgram === null) return;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(this.flatProgram, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, geometry.count);
    gl.deleteBuffer(buffer);
  }

  private drawFullscreenQuad (program: WebGLProgram): void {
    const gl = this.gl;
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.deleteBuffer(buffer);
    gl.deleteBuffer(indexBuffer);
  }

  setShaderProgram (layerId: string, program: WebGLProgram | null): void {
    if (program === null) {
      this.shaderPrograms.delete(layerId);
      return;
    }
    this.shaderPrograms.set(layerId, program);
  }

  hasShaderProgram (layerId: string): boolean {
    return this.shaderPrograms.has(layerId);
  }
}
