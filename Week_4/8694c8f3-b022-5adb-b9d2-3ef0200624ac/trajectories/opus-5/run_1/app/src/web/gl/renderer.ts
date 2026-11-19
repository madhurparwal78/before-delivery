import { compose, identity, lookAt, multiply, perspective, transformPoint, type Mat4 } from './mat4.js';
import { cube, gridLines, plane, sphere, torus, tube, type MeshData } from './geometry.js';
import type { LayerDoc, SetDocument } from '../../shared/types.js';
import type { OutputBus } from '../../shared/domain.js';

const MESH_VERTEX = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform float u_twist;
uniform float u_radius;
out vec3 v_normal;
out vec2 v_uv;
void main() {
  vec3 p = a_position;
  p.xz *= u_radius;
  float angle = p.y * u_twist;
  float c = cos(angle);
  float s = sin(angle);
  vec3 twisted = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  vec3 n = a_normal;
  vec3 twistedNormal = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  v_normal = mat3(u_model) * twistedNormal;
  v_uv = a_uv;
  gl_Position = u_proj * u_view * u_model * vec4(twisted, 1.0);
}`;

const MESH_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec2 v_uv;
uniform vec3 u_tint;
uniform float u_alpha;
uniform float u_light;
uniform int u_hasTexture;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
  vec3 base = u_tint;
  if (u_hasTexture == 1) base *= texture(u_texture, v_uv).rgb;
  float lambert = max(dot(normalize(v_normal), normalize(vec3(0.4, 0.85, 0.5))), 0.0);
  fragColor = vec4(base * (0.28 + 0.72 * lambert) * u_light, u_alpha);
}`;

const LINE_VERTEX = `#version 300 es
in vec3 a_position;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform int u_screen;
void main() {
  gl_Position = u_screen == 1 ? vec4(a_position, 1.0) : u_proj * u_view * vec4(a_position, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_colour;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_colour, 1.0);
}`;

const PASS_VERTEX = `#version 300 es
in vec2 a_xy;
void main() {
  gl_Position = vec4(a_xy, 0.0, 1.0);
}`;

export interface CompileError {
  line: number;
  message: string;
}

export type CompileResult = { ok: true } | { ok: false; errors: CompileError[] };

export interface GizmoGrips {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export type GizmoAxis = 'x' | 'y' | 'z';

export interface StageInput {
  doc: SetDocument;
  overrides: Map<string, Map<string, number>>;
  shaderSources: Map<string, string>;
  beat: number;
  seconds: number;
  selection: string | null;
  bus: OutputBus | null;
  showChrome: boolean;
}

interface MeshBuffers {
  vao: WebGLVertexArrayObject;
  count: number;
}

function parseCompileLog(log: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const raw of log.split('\n')) {
    const match = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(raw.trim());
    if (match === null) continue;
    const line = Number(match[1]);
    const message = (match[2] ?? '').trim();
    if (raw.trim().startsWith('ERROR')) errors.push({ line, message });
  }
  if (errors.length === 0 && log.trim() !== '') errors.push({ line: 1, message: log.trim() });
  return errors;
}

export class StageRenderer {
  readonly available: boolean;
  frames = 0;
  grips: GizmoGrips | null = null;
  gizmoDirections: Record<GizmoAxis, [number, number]> = { x: [1, 0], y: [0, -1], z: [0, 1] };
  orbitYaw = 0;
  orbitPitch = 0;
  zoom = 1;

  private gl: WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement;
  private meshProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;
  private meshes = new Map<string, MeshBuffers>();
  private lineBuffer: WebGLBuffer | null = null;
  private passBuffer: WebGLBuffer | null = null;
  private passPrograms = new Map<string, WebGLProgram | null>();
  private lastGoodPass = new Map<string, WebGLProgram>();
  private textures = new Map<string, WebGLTexture>();
  private modelMeshes = new Map<string, MeshBuffers[]>();
  private lastProjection: Mat4 = identity();
  private lastView: Mat4 = identity();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    this.available = gl !== null;
    if (gl === null) return;
    this.gl = gl;
    this.meshProgram = this.link(MESH_VERTEX, MESH_FRAGMENT);
    this.lineProgram = this.link(LINE_VERTEX, LINE_FRAGMENT);
    this.lineBuffer = gl.createBuffer();
    this.passBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.passBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const [name, data] of [
      ['cube', cube()],
      ['sphere', sphere()],
      ['plane', plane()],
      ['torus', torus()],
      ['tube', tube()],
    ] as [string, MeshData][]) {
      const buffers = this.uploadMesh(data);
      if (buffers !== null) this.meshes.set(name, buffers);
    }
  }

  private link(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl;
    if (gl === null) return null;
    const program = gl.createProgram();
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    if (program === null || vertex === null || fragment === null) return null;
    gl.shaderSource(vertex, vertexSource);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, fragmentSource);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? program : null;
  }

  /** Compiles a GLSL layer source in the browser and reports its error lines. */
  compile(source: string): CompileResult {
    const gl = this.gl;
    if (gl === null) return { ok: true };
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (shader === null) return { ok: true };
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true;
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    return ok ? { ok: true } : { ok: false, errors: parseCompileLog(log) };
  }

  private uploadMesh(data: MeshData): MeshBuffers | null {
    const gl = this.gl;
    if (gl === null || this.meshProgram === null) return null;
    const vao = gl.createVertexArray();
    if (vao === null) return null;
    gl.bindVertexArray(vao);
    const attach = (name: string, values: Float32Array, size: number): void => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(this.meshProgram as WebGLProgram, name);
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      }
    };
    attach('a_position', data.positions, 3);
    attach('a_normal', data.normals, 3);
    attach('a_uv', data.uvs, 2);
    const elements = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: data.indices.length };
  }

  setModel(assetId: string, meshes: MeshData[]): void {
    const uploaded = meshes
      .map((mesh) => this.uploadMesh(mesh))
      .filter((buffers): buffers is MeshBuffers => buffers !== null);
    this.modelMeshes.set(assetId, uploaded);
  }

  hasModel(assetId: string): boolean {
    return this.modelMeshes.has(assetId);
  }

  setTexture(assetId: string, image: ImageBitmap): void {
    const gl = this.gl;
    if (gl === null) return;
    const texture = gl.createTexture();
    if (texture === null) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.textures.set(assetId, texture);
  }

  hasTexture(assetId: string): boolean {
    return this.textures.has(assetId);
  }

  /** A source that fails to link leaves the last program that compiled on the stage. */
  private passProgram(layerId: string, source: string): WebGLProgram | null {
    const cacheKey = `${layerId}:${hash(source)}:${source.length}`;
    const cached = this.passPrograms.get(cacheKey);
    if (cached !== undefined) return cached ?? this.lastGoodPass.get(layerId) ?? null;
    const program = this.link(PASS_VERTEX, source);
    this.passPrograms.set(cacheKey, program);
    if (program !== null) this.lastGoodPass.set(layerId, program);
    return program ?? this.lastGoodPass.get(layerId) ?? null;
  }

  private value(input: StageInput, layer: LayerDoc, path: string, stored: number): number {
    return input.overrides.get(layer.id)?.get(path) ?? stored;
  }

  private layerMatrix(input: StageInput, layer: LayerDoc, doc: SetDocument): Mat4 {
    const local = compose(
      [
        this.value(input, layer, 'position.x', layer.position[0]),
        this.value(input, layer, 'position.y', layer.position[1]),
        this.value(input, layer, 'position.z', layer.position[2]),
      ],
      [
        this.value(input, layer, 'rotation.x', layer.rotation[0]),
        this.value(input, layer, 'rotation.y', layer.rotation[1]),
        this.value(input, layer, 'rotation.z', layer.rotation[2]),
      ],
      [
        this.value(input, layer, 'scale.x', layer.scale[0]),
        this.value(input, layer, 'scale.y', layer.scale[1]),
        this.value(input, layer, 'scale.z', layer.scale[2]),
      ],
    );
    if (layer.parent_id === null) return local;
    const parent = doc.layers.find((other) => other.id === layer.parent_id);
    return parent === undefined ? local : multiply(this.layerMatrix(input, parent, doc), local);
  }

  private visible(doc: SetDocument, layer: LayerDoc): boolean {
    let current: LayerDoc | undefined = layer;
    while (current !== undefined) {
      if (!current.visible) return false;
      const parentId: string | null = current.parent_id;
      current = parentId === null ? undefined : doc.layers.find((other) => other.id === parentId);
    }
    return true;
  }

  resize(): void {
    const gl = this.gl;
    if (gl === null) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  orbitBy(dx: number, dy: number): void {
    this.orbitYaw += dx * 0.01;
    this.orbitPitch = Math.max(-1.2, Math.min(1.2, this.orbitPitch + dy * 0.01));
  }

  zoomBy(delta: number): void {
    this.zoom = Math.max(0.2, Math.min(6, this.zoom * (1 + delta * 0.001)));
  }

  pickGrip(x: number, y: number): GizmoAxis | null {
    if (this.grips === null) return null;
    for (const axis of ['x', 'y', 'z'] as GizmoAxis[]) {
      const grip = this.grips[axis];
      if (Math.hypot(grip[0] - x, grip[1] - y) <= 8) return axis;
    }
    return null;
  }

  draw(input: StageInput): void {
    const gl = this.gl;
    if (gl === null) return;
    this.resize();
    const { doc } = input;
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.disable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const width = this.canvas.width;
    const height = this.canvas.height;
    const aspect = width / Math.max(1, height);
    const camera = doc.layers.find((layer) => layer.id === doc.set.active_camera_id) ?? null;
    const fov = camera === null ? 50 : this.value(input, camera, 'props.fov', camera.props['fov'] ?? 50);
    const near = camera === null ? 0.1 : this.value(input, camera, 'props.near', camera.props['near'] ?? 0.1);
    const far = camera === null ? 200 : this.value(input, camera, 'props.far', camera.props['far'] ?? 200);
    const basePosition: [number, number, number] =
      camera === null
        ? [0, 2, 8]
        : [
            this.value(input, camera, 'position.x', camera.position[0]),
            this.value(input, camera, 'position.y', camera.position[1]),
            this.value(input, camera, 'position.z', camera.position[2]),
          ];
    const distance = Math.max(0.5, Math.hypot(...basePosition)) / this.zoom;
    const baseYaw = Math.atan2(basePosition[0], basePosition[2]) + this.orbitYaw;
    const basePitch =
      Math.asin(basePosition[1] / Math.max(0.5, Math.hypot(...basePosition))) + this.orbitPitch;
    const eye: [number, number, number] = [
      Math.sin(baseYaw) * Math.cos(basePitch) * distance,
      Math.sin(basePitch) * distance,
      Math.cos(baseYaw) * Math.cos(basePitch) * distance,
    ];
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const projection = perspective(fov, aspect, Math.max(0.01, near), Math.max(near + 0.01, far));
    this.lastView = view;
    this.lastProjection = projection;

    const lightTotal = doc.layers
      .filter((layer) => layer.kind === 'light' && this.visible(doc, layer))
      .reduce((sum, layer) => sum + this.value(input, layer, 'props.intensity', layer.props['intensity'] ?? 1), 0);
    const light = Math.max(0.35, Math.min(2.2, lightTotal === 0 ? 1 : lightTotal));

    const onBus = (layer: LayerDoc): boolean =>
      input.bus === null || layer.output_buses.length === 0 || layer.output_buses.includes(input.bus);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const layer of doc.layers) {
      if (layer.kind !== 'shader' || !this.visible(doc, layer) || !onBus(layer)) continue;
      const source = input.shaderSources.get(layer.id);
      if (source === undefined) continue;
      const program = this.passProgram(layer.id, source);
      if (program === null) continue;
      gl.useProgram(program);
      this.setPassUniforms(gl, program, input, width, height);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.passBuffer);
      const location = gl.getAttribLocation(program, 'a_xy');
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.enable(gl.DEPTH_TEST);
    if (input.showChrome) this.drawGrid(gl, view, projection);

    const meshProgram = this.meshProgram;
    if (meshProgram !== null) {
      gl.useProgram(meshProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_view'), false, view);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_proj'), false, projection);
      gl.uniform1f(gl.getUniformLocation(meshProgram, 'u_light'), light);
      for (const layer of doc.layers) {
        if (!this.visible(doc, layer) || !onBus(layer)) continue;
        const buffers = this.buffersFor(layer);
        if (buffers.length === 0) continue;
        const model = this.layerMatrix(input, layer, doc);
        gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_model'), false, model);
        gl.uniform1f(
          gl.getUniformLocation(meshProgram, 'u_twist'),
          this.value(input, layer, 'props.twist', layer.props['twist'] ?? 0),
        );
        gl.uniform1f(
          gl.getUniformLocation(meshProgram, 'u_radius'),
          this.value(input, layer, 'props.radius', layer.props['radius'] ?? 1),
        );
        const material = layer.material;
        const tint = material?.tint ?? [1, 1, 1];
        gl.uniform3f(gl.getUniformLocation(meshProgram, 'u_tint'), tint[0], tint[1], tint[2]);
        gl.uniform1f(
          gl.getUniformLocation(meshProgram, 'u_alpha'),
          this.value(input, layer, 'material.tint_alpha', material?.tint_alpha ?? 1),
        );
        const textureId = material?.albedo_texture_id ?? null;
        const texture = textureId === null ? undefined : this.textures.get(textureId);
        gl.uniform1i(gl.getUniformLocation(meshProgram, 'u_hasTexture'), texture === undefined ? 0 : 1);
        if (texture !== undefined) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.uniform1i(gl.getUniformLocation(meshProgram, 'u_texture'), 0);
        }
        for (const mesh of buffers) {
          gl.bindVertexArray(mesh.vao);
          gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
        }
      }
      gl.bindVertexArray(null);
    }

    this.grips = null;
    if (input.showChrome && input.selection !== null) {
      const selected = doc.layers.find((layer) => layer.id === input.selection) ?? null;
      if (selected !== null) this.drawGizmo(gl, input, selected, doc);
    }
    this.frames += 1;
  }

  private setPassUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    input: StageInput,
    width: number,
    height: number,
  ): void {
    const time = gl.getUniformLocation(program, 'u_time');
    if (time !== null) gl.uniform1f(time, input.seconds);
    const beat = gl.getUniformLocation(program, 'u_beat');
    if (beat !== null) gl.uniform1f(beat, input.beat);
    const resolution = gl.getUniformLocation(program, 'u_resolution');
    if (resolution !== null) gl.uniform2f(resolution, width, height);
    const intensity = gl.getUniformLocation(program, 'u_intensity');
    if (intensity !== null) gl.uniform1f(intensity, 1);
  }

  private buffersFor(layer: LayerDoc): MeshBuffers[] {
    if (layer.kind === 'model') {
      const assetId = layer.model_asset_id;
      return assetId === null ? [] : this.modelMeshes.get(assetId) ?? [];
    }
    const mesh = this.meshes.get(layer.kind);
    return mesh === undefined ? [] : [mesh];
  }

  private drawLines(
    gl: WebGL2RenderingContext,
    positions: Float32Array,
    colour: [number, number, number],
    screen: boolean,
    view: Mat4,
    projection: Mat4,
  ): void {
    const program = this.lineProgram;
    if (program === null) return;
    gl.useProgram(program);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_proj'), false, projection);
    gl.uniform1i(gl.getUniformLocation(program, 'u_screen'), screen ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(program, 'u_colour'), colour[0], colour[1], colour[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    const location = gl.getAttribLocation(program, 'a_position');
    if (location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    }
    gl.drawArrays(gl.LINES, 0, positions.length / 3);
  }

  private drawGrid(gl: WebGL2RenderingContext, view: Mat4, projection: Mat4): void {
    const { grid, axes } = gridLines();
    this.drawLines(gl, grid, [0.13, 0.13, 0.13], false, view, projection);
    this.drawLines(gl, axes, [0.18, 0.55, 0.34], false, view, projection);
  }

  private toPixels(clip: [number, number, number, number]): [number, number] | null {
    if (clip[3] <= 0.0001) return null;
    const ndcX = clip[0] / clip[3];
    const ndcY = clip[1] / clip[3];
    return [
      ((ndcX * 0.5 + 0.5) * this.canvas.clientWidth),
      ((1 - (ndcY * 0.5 + 0.5)) * this.canvas.clientHeight),
    ];
  }

  private drawGizmo(
    gl: WebGL2RenderingContext,
    input: StageInput,
    layer: LayerDoc,
    doc: SetDocument,
  ): void {
    const model = this.layerMatrix(input, layer, doc);
    const origin: [number, number, number] = [model[12] ?? 0, model[13] ?? 0, model[14] ?? 0];
    const viewProjection = multiply(this.lastProjection, this.lastView);
    const originPixels = this.toPixels(transformPoint(viewProjection, origin));
    if (originPixels === null) return;
    const axes: [GizmoAxis, [number, number, number], [number, number, number]][] = [
      ['x', [1, 0, 0], [0.7, 0.08, 0.1]],
      ['y', [0, 1, 0], [0.2, 0.85, 0.25]],
      ['z', [0, 0, 1], [0.3, 0.6, 0.95]],
    ];
    const grips: Partial<GizmoGrips> = {};
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const toNdc = (point: [number, number]): [number, number] => [
      (point[0] / width) * 2 - 1,
      1 - (point[1] / height) * 2,
    ];
    for (const [axis, direction, colour] of axes) {
      const tip = this.toPixels(
        transformPoint(viewProjection, [
          origin[0] + direction[0],
          origin[1] + direction[1],
          origin[2] + direction[2],
        ]),
      );
      let screenDirection: [number, number] = axis === 'x' ? [1, 0] : axis === 'y' ? [0, -1] : [0, 1];
      if (tip !== null) {
        const dx = tip[0] - originPixels[0];
        const dy = tip[1] - originPixels[1];
        const length = Math.hypot(dx, dy);
        if (length > 0.001) screenDirection = [dx / length, dy / length];
      }
      this.gizmoDirections[axis] = screenDirection;
      const grip: [number, number] = [
        originPixels[0] + screenDirection[0] * 80,
        originPixels[1] + screenDirection[1] * 80,
      ];
      grips[axis] = [Math.round(grip[0]), Math.round(grip[1])];
      const start = toNdc(originPixels);
      const end = toNdc(grip);
      const half = 6;
      const corners: [number, number][] = [
        [grip[0] - half, grip[1] - half],
        [grip[0] + half, grip[1] - half],
        [grip[0] + half, grip[1] + half],
        [grip[0] - half, grip[1] + half],
      ];
      const square: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const a = toNdc(corners[index] as [number, number]);
        const b = toNdc(corners[(index + 1) % 4] as [number, number]);
        square.push(a[0], a[1], 0, b[0], b[1], 0);
      }
      this.drawLines(
        gl,
        new Float32Array([start[0], start[1], 0, end[0], end[1], 0, ...square]),
        colour,
        true,
        this.lastView,
        this.lastProjection,
      );
    }
    if (grips.x !== undefined && grips.y !== undefined && grips.z !== undefined) {
      this.grips = { x: grips.x, y: grips.y, z: grips.z };
    }
  }
}

function hash(source: string): number {
  let value = 0;
  for (let index = 0; index < source.length; index += 1) {
    value = (value * 31 + source.charCodeAt(index)) | 0;
  }
  return value;
}
