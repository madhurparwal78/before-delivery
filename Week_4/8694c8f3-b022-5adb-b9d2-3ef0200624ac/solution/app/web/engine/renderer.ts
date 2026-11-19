import type { LayerDoc, OutputBus, Vec3 } from "../../shared/types.ts";
import type { EffectiveLayer } from "./evaluate.ts";
import { parseGlb } from "./glb.ts";
import { normalMatrix, transformPoint } from "./math.ts";
import type { Mat4 } from "./math.ts";
import type { MeshData } from "./meshes.ts";
import { cubeMesh, planeMesh, sphereMesh, torusMesh, tubeMesh } from "./meshes.ts";

interface CompileProblem {
  line: number;
  message: string;
}

export type CompileResult = { ok: true } | { ok: false; problems: CompileProblem[] };

export type GizmoAxis = "x" | "y" | "z";
export type GizmoMode = "move" | "rotate" | "scale";

export interface GizmoShape {
  origin: [number, number];
  grips: Record<GizmoAxis, [number, number]>;
  directions: Record<GizmoAxis, [number, number]>;
}

interface StageFrame {
  cssWidth: number;
  cssHeight: number;
  layers: readonly LayerDoc[];
  effective: Map<string, EffectiveLayer>;
  world: Map<string, Mat4>;
  view: Mat4;
  proj: Mat4;
  eye: Vec3;
  beat: number;
  seconds: number;
  selectedId: string | null;
  activeCameraId: string | null;
  editorChrome: boolean;
  bus: OutputBus | null;
}

export interface AssetSource {
  url(assetId: string): string;
}

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  count: number;
  indexType: number;
}

const GIZMO_PX = 80;
const GRIP_HALF = 6;
const AXIS_COLOURS: Record<GizmoAxis, [number, number, number]> = {
  x: [0.78, 0.13, 0.16],
  y: [0.2, 0.9, 0.3],
  z: [0.27, 0.62, 1],
};

const MESH_VERTEX = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat3 u_normal;
uniform float u_tube;
uniform float u_twist;
uniform float u_radius;
out vec3 v_normal;
out vec3 v_world;
out vec2 v_uv;
out float v_along;
void main() {
  vec3 p = a_position;
  vec3 n = a_normal;
  if (u_tube > 0.5) {
    float angle = u_twist * a_position.y * 6.2831853;
    float c = cos(angle);
    float s = sin(angle);
    p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    n = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
    p.xz *= u_radius;
  }
  vec4 world = u_model * vec4(p, 1.0);
  v_world = world.xyz;
  v_normal = u_normal * n;
  v_uv = a_uv;
  v_along = a_position.y + 0.5;
  gl_Position = u_proj * u_view * world;
}`;

const MESH_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_world;
in vec2 v_uv;
in float v_along;
uniform vec3 u_tint;
uniform float u_alpha;
uniform sampler2D u_albedo;
uniform float u_hasAlbedo;
uniform sampler2D u_emissive;
uniform float u_hasEmissive;
uniform vec3 u_lightPos[4];
uniform float u_lightPower[4];
uniform int u_lightCount;
uniform vec3 u_eye;
uniform float u_bands;
uniform float u_beat;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_normal + vec3(1e-5));
  if (!gl_FrontFacing) n = -n;
  vec3 base = u_tint;
  if (u_hasAlbedo > 0.5) base *= texture(u_albedo, v_uv).rgb;
  vec3 lit = vec3(0.16);
  for (int i = 0; i < 4; i++) {
    if (i >= u_lightCount) break;
    vec3 toLight = u_lightPos[i] - v_world;
    float d = length(toLight);
    lit += vec3(max(dot(n, toLight / d), 0.0) * u_lightPower[i] / (1.0 + 0.004 * d * d));
  }
  if (u_lightCount == 0) lit += vec3(max(dot(n, normalize(u_eye - v_world)), 0.0) * 0.85);
  vec3 color = base * lit;
  if (u_hasEmissive > 0.5) color += texture(u_emissive, v_uv).rgb;
  if (u_bands > 0.0) {
    float b = fract(v_along * u_bands - u_beat);
    float ring = smoothstep(0.0, 0.1, b) * (1.0 - smoothstep(0.4, 0.5, b));
    vec3 glow = mix(vec3(0.03, 0.16, 0.22), vec3(0.16, 0.82, 0.76), ring);
    color = color * 0.3 + glow * (0.3 + 0.7 * ring);
  }
  fragColor = vec4(color, u_alpha);
}`;

const LINE_VERTEX = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform mat4 u_view;
uniform mat4 u_proj;
void main() { gl_Position = u_proj * u_view * vec4(a_position, 1.0); }`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 u_colour;
out vec4 fragColor;
void main() { fragColor = u_colour; }`;

const SCREEN_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pixel;
uniform vec2 u_size;
void main() { gl_Position = vec4(a_pixel.x / u_size.x * 2.0 - 1.0, 1.0 - a_pixel.y / u_size.y * 2.0, 0.0, 1.0); }`;

const PASS_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function parseProblems(log: string): CompileProblem[] {
  const problems: CompileProblem[] = [];
  for (const raw of log.split("\n")) {
    const match = /ERROR:\s*\d+:(\d+):\s*(.*)$/.exec(raw.trim());
    if (match) problems.push({ line: Number(match[1]), message: (match[2] ?? "").trim() });
  }
  return problems;
}

export class StageRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly assets: AssetSource;
  private readonly onAssetLoaded: () => void;
  private readonly meshProgram: WebGLProgram;
  private readonly lineProgram: WebGLProgram;
  private readonly screenProgram: WebGLProgram;
  private readonly primitives = new Map<string, GpuMesh>();
  private readonly models = new Map<string, GpuMesh | "loading" | "failed">();
  private readonly textures = new Map<string, WebGLTexture | "loading" | "failed">();
  private readonly passes = new Map<string, { source: string; program: WebGLProgram }>();
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly gridVao: WebGLVertexArrayObject;
  private readonly gridBuffer: WebGLBuffer;
  private readonly gridSegments: { start: number; count: number; colour: [number, number, number, number] }[] = [];
  private readonly markerVao: WebGLVertexArrayObject;
  private readonly markerBuffer: WebGLBuffer;
  private readonly screenVao: WebGLVertexArrayObject;
  private readonly screenBuffer: WebGLBuffer;
  private width = 0;
  private height = 0;

  static create(canvas: HTMLCanvasElement, assets: AssetSource, onAssetLoaded: () => void): StageRenderer | null {
    const gl = canvas.getContext("webgl2", { antialias: true, depth: true, alpha: false });
    return gl ? new StageRenderer(canvas, gl, assets, onAssetLoaded) : null;
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, assets: AssetSource, onAssetLoaded: () => void) {
    this.gl = gl;
    this.canvas = canvas;
    this.assets = assets;
    this.onAssetLoaded = onAssetLoaded;
    this.meshProgram = this.link(MESH_VERTEX, MESH_FRAGMENT);
    this.lineProgram = this.link(LINE_VERTEX, LINE_FRAGMENT);
    this.screenProgram = this.link(SCREEN_VERTEX, LINE_FRAGMENT);
    this.primitives.set("cube", this.upload(cubeMesh()));
    this.primitives.set("sphere", this.upload(sphereMesh()));
    this.primitives.set("plane", this.upload(planeMesh()));
    this.primitives.set("torus", this.upload(torusMesh()));
    this.primitives.set("tube", this.upload(tubeMesh()));
    this.emptyVao = this.must(gl.createVertexArray());
    ({ vao: this.gridVao, buffer: this.gridBuffer } = this.dynamicLines(3));
    ({ vao: this.markerVao, buffer: this.markerBuffer } = this.dynamicLines(3));
    ({ vao: this.screenVao, buffer: this.screenBuffer } = this.dynamicLines(2));
    this.buildGrid();
  }

  private must<T>(value: T | null): T {
    if (value === null) throw new Error("WebGL could not allocate a resource");
    return value;
  }

  private compile(type: number, source: string): { shader: WebGLShader | null; log: string } {
    const { gl } = this;
    const shader = this.must(gl.createShader(type));
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return { shader, log: "" };
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    return { shader: null, log };
  }

  private link(vertex: string, fragment: string): WebGLProgram {
    const { gl } = this;
    const v = this.compile(gl.VERTEX_SHADER, vertex);
    const f = this.compile(gl.FRAGMENT_SHADER, fragment);
    const program = this.must(gl.createProgram());
    if (v.shader) gl.attachShader(program, v.shader);
    if (f.shader) gl.attachShader(program, f.shader);
    gl.linkProgram(program);
    return program;
  }

  private dynamicLines(width: number): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
    const { gl } = this;
    const vao = this.must(gl.createVertexArray());
    const buffer = this.must(gl.createBuffer());
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, width, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, buffer };
  }

  private upload(data: MeshData): GpuMesh {
    const { gl } = this;
    const vao = this.must(gl.createVertexArray());
    gl.bindVertexArray(vao);
    const attributes: [number, Float32Array, number][] = [[0, data.positions, 3], [1, data.normals, 3], [2, data.uvs, 2]];
    for (const [location, values, size] of attributes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.must(gl.createBuffer()));
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.must(gl.createBuffer()));
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: data.indices.length, indexType: data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  private buildGrid(): void {
    const { gl } = this;
    const minor: number[] = [];
    const major: number[] = [];
    const axes: number[] = [];
    const extent = 20;
    for (let i = -extent; i <= extent; i += 1) {
      const target = i === 0 ? axes : i % 10 === 0 ? major : minor;
      if (i === 0) {
        target.push(-extent, 0, 0, extent, 0, 0, 0, 0, -extent, 0, 0, extent);
      } else {
        target.push(i, 0, -extent, i, 0, extent, -extent, 0, i, extent, 0, i);
      }
    }
    const all = new Float32Array([...minor, ...major, ...axes]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
    this.gridSegments.push(
      { start: 0, count: minor.length / 3, colour: [0.2, 0.2, 0.2, 1] },
      { start: minor.length / 3, count: major.length / 3, colour: [0.34, 0.34, 0.34, 1] },
      { start: (minor.length + major.length) / 3, count: axes.length / 3, colour: [0.2, 0.667, 0.467, 1] },
    );
  }

  resize(cssWidth: number, cssHeight: number, ratio: number): void {
    const dpr = Math.min(ratio, 2);
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  /** Compiles and links a fragment shader typed by the user, exactly as given, behind the stage's own vertex stage. */
  private build(source: string): { program: WebGLProgram } | { problems: CompileProblem[] } {
    const { gl } = this;
    const fragment = this.compile(gl.FRAGMENT_SHADER, source);
    if (!fragment.shader) {
      const problems = parseProblems(fragment.log);
      return { problems: problems.length > 0 ? problems : [{ line: 1, message: fragment.log.trim() || "The shader did not compile" }] };
    }
    const vertex = this.compile(gl.VERTEX_SHADER, PASS_VERTEX).shader;
    const program = this.must(gl.createProgram());
    if (vertex) gl.attachShader(program, vertex);
    gl.attachShader(program, fragment.shader);
    gl.linkProgram(program);
    if (vertex) gl.deleteShader(vertex);
    gl.deleteShader(fragment.shader);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return { program };
    const log = gl.getProgramInfoLog(program)?.trim();
    gl.deleteProgram(program);
    return { problems: [{ line: 1, message: log || "The shader could not be linked" }] };
  }

  compileShaderText(source: string): CompileResult {
    const built = this.build(source);
    if ("problems" in built) return { ok: false, problems: built.problems };
    this.gl.deleteProgram(built.program);
    return { ok: true };
  }

  /** Installs a layer's shader text if it compiles; the previous program stays in place when it does not. */
  setShader(layerId: string, source: string): CompileResult {
    const existing = this.passes.get(layerId);
    if (existing?.source === source) return { ok: true };
    const built = this.build(source);
    if ("problems" in built) return { ok: false, problems: built.problems };
    if (existing) this.gl.deleteProgram(existing.program);
    this.passes.set(layerId, { source, program: built.program });
    return { ok: true };
  }

  private textureFor(assetId: string): WebGLTexture | null {
    const known = this.textures.get(assetId);
    if (known === "loading" || known === "failed") return null;
    if (known) return known;
    this.textures.set(assetId, "loading");
    void fetch(this.assets.url(assetId))
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("texture unavailable"))))
      .then((blob) => createImageBitmap(blob, { imageOrientation: "flipY" }))
      .then((bitmap) => {
        const { gl } = this;
        const texture = this.must(gl.createTexture());
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        this.textures.set(assetId, texture);
        this.onAssetLoaded();
      })
      .catch(() => this.textures.set(assetId, "failed"));
    return null;
  }

  private modelFor(assetId: string): GpuMesh | null {
    const known = this.models.get(assetId);
    if (known === "loading" || known === "failed") return null;
    if (known) return known;
    this.models.set(assetId, "loading");
    void fetch(this.assets.url(assetId))
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("model unavailable"))))
      .then((buffer) => {
        const data = parseGlb(buffer);
        if (!data) throw new Error("model unreadable");
        this.models.set(assetId, this.upload(data));
        this.onAssetLoaded();
      })
      .catch(() => this.models.set(assetId, "failed"));
    return null;
  }

  private visibleLayers(frame: StageFrame): LayerDoc[] {
    const hidden = new Set<string>();
    const out: LayerDoc[] = [];
    for (const layer of frame.layers) {
      const inherited = layer.parent_id !== null && hidden.has(layer.parent_id);
      const offBus = frame.bus !== null && layer.output_buses.length > 0 && !layer.output_buses.includes(frame.bus);
      if (!layer.visible || inherited) hidden.add(layer.id);
      else if (!offBus) out.push(layer);
    }
    return out;
  }

  draw(frame: StageFrame): GizmoShape | null {
    const { gl } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const layers = this.visibleLayers(frame);
    this.drawPasses(frame, layers);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    if (frame.editorChrome) this.drawGrid(frame);
    this.drawMeshes(frame, layers);
    if (frame.editorChrome) this.drawMarkers(frame, layers);
    gl.disable(gl.DEPTH_TEST);
    const gizmo = frame.editorChrome ? this.gizmoFor(frame) : null;
    if (gizmo) this.drawGizmo(gizmo);
    return gizmo;
  }

  private drawPasses(frame: StageFrame, layers: LayerDoc[]): void {
    const { gl } = this;
    gl.disable(gl.DEPTH_TEST);
    for (const layer of layers.filter((candidate) => candidate.kind === "shader")) {
      const pass = this.passes.get(layer.id);
      if (!pass) continue;
      gl.useProgram(pass.program);
      const set1 = (name: string, value: number): void => {
        const location = gl.getUniformLocation(pass.program, name);
        if (location) gl.uniform1f(location, value);
      };
      set1("u_time", frame.seconds);
      set1("u_beat", frame.beat);
      set1("u_intensity", 1);
      const resolution = gl.getUniformLocation(pass.program, "u_resolution");
      if (resolution) gl.uniform2f(resolution, this.canvas.width, this.canvas.height);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  private drawGrid(frame: StageFrame): void {
    const { gl } = this;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "u_view"), false, frame.view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "u_proj"), false, frame.proj);
    const colour = gl.getUniformLocation(this.lineProgram, "u_colour");
    gl.bindVertexArray(this.gridVao);
    for (const segment of this.gridSegments) {
      gl.uniform4fv(colour, segment.colour);
      gl.drawArrays(gl.LINES, segment.start, segment.count);
    }
  }

  private drawMeshes(frame: StageFrame, layers: LayerDoc[]): void {
    const { gl } = this;
    const program = this.meshProgram;
    gl.useProgram(program);
    const loc = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    gl.uniformMatrix4fv(loc("u_view"), false, frame.view);
    gl.uniformMatrix4fv(loc("u_proj"), false, frame.proj);
    gl.uniform3fv(loc("u_eye"), frame.eye);
    const lights = layers.filter((layer) => layer.kind === "light").slice(0, 4);
    const positions = new Float32Array(12);
    const power = new Float32Array(4);
    lights.forEach((light, index) => {
      const world = frame.world.get(light.id);
      const at = world ? transformPoint(world, [0, 0, 0]) : [0, 0, 0];
      positions.set(at, index * 3);
      power[index] = (frame.effective.get(light.id)?.props["intensity"] ?? 1) * 0.9;
    });
    gl.uniform3fv(loc("u_lightPos"), positions);
    gl.uniform1fv(loc("u_lightPower"), power);
    gl.uniform1i(loc("u_lightCount"), lights.length);
    gl.uniform1i(loc("u_albedo"), 0);
    gl.uniform1i(loc("u_emissive"), 1);
    gl.uniform1f(loc("u_beat"), frame.beat);
    const opaque: LayerDoc[] = [];
    const clear: LayerDoc[] = [];
    for (const layer of layers) {
      if (layer.material === null) continue;
      ((frame.effective.get(layer.id)?.tintAlpha ?? 1) < 1 ? clear : opaque).push(layer);
    }
    gl.disable(gl.CULL_FACE);
    for (const layer of opaque) this.drawLayer(frame, layer, loc);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const layer of clear) this.drawLayer(frame, layer, loc);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private drawLayer(frame: StageFrame, layer: LayerDoc, loc: (name: string) => WebGLUniformLocation | null): void {
    const { gl } = this;
    const effective = frame.effective.get(layer.id);
    const world = frame.world.get(layer.id);
    const material = layer.material;
    if (!effective || !world || !material) return;
    const mesh = layer.kind === "model"
      ? (layer.model_asset_id ? this.modelFor(layer.model_asset_id) : null)
      : (this.primitives.get(layer.kind) ?? null);
    if (!mesh) return;
    gl.uniformMatrix4fv(loc("u_model"), false, world);
    gl.uniformMatrix3fv(loc("u_normal"), false, normalMatrix(world));
    gl.uniform3fv(loc("u_tint"), material.tint);
    gl.uniform1f(loc("u_alpha"), effective.tintAlpha);
    const tube = layer.kind === "tube";
    gl.uniform1f(loc("u_tube"), tube ? 1 : 0);
    gl.uniform1f(loc("u_twist"), effective.props["twist"] ?? 0);
    gl.uniform1f(loc("u_radius"), effective.props["radius"] ?? 1);
    gl.uniform1f(loc("u_bands"), tube ? (effective.props["bands"] ?? 0) : 0);
    const albedo = material.albedo_texture_id ? this.textureFor(material.albedo_texture_id) : null;
    const emissive = material.emissive_texture_id ? this.textureFor(material.emissive_texture_id) : null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, albedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, emissive);
    gl.uniform1f(loc("u_hasAlbedo"), albedo ? 1 : 0);
    gl.uniform1f(loc("u_hasEmissive"), emissive ? 1 : 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
  }

  private drawMarkers(frame: StageFrame, layers: LayerDoc[]): void {
    const { gl } = this;
    const lines: number[] = [];
    const cross: [Vec3, Vec3][] = [[[-0.3, 0, 0], [0.3, 0, 0]], [[0, -0.3, 0], [0, 0.3, 0]], [[0, 0, -0.3], [0, 0, 0.3]]];
    const corners: Vec3[] = [[-0.35, -0.22, -0.7], [0.35, -0.22, -0.7], [0.35, 0.22, -0.7], [-0.35, 0.22, -0.7]];
    for (const layer of layers) {
      const world = frame.world.get(layer.id);
      if (!world || (layer.kind !== "camera" && layer.kind !== "light") || layer.id === frame.activeCameraId) continue;
      const at = (point: Vec3): Vec3 => transformPoint(world, point);
      if (layer.kind === "light") {
        for (const [from, to] of cross) lines.push(...at(from), ...at(to));
      } else {
        const tip = at([0, 0, 0]);
        corners.forEach((corner, index) => {
          const next = corners[(index + 1) % corners.length] ?? corner;
          lines.push(...tip, ...at(corner), ...at(corner), ...at(next));
        });
      }
    }
    if (lines.length === 0) return;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "u_view"), false, frame.view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "u_proj"), false, frame.proj);
    gl.uniform4fv(gl.getUniformLocation(this.lineProgram, "u_colour"), [0.75, 0.75, 0.75, 1]);
    gl.bindVertexArray(this.markerVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
  }

  private gizmoFor(frame: StageFrame): GizmoShape | null {
    if (!frame.selectedId) return null;
    const layer = frame.layers.find((candidate) => candidate.id === frame.selectedId);
    const world = frame.world.get(frame.selectedId);
    if (!layer || !world) return null;
    const parentWorld = layer.parent_id ? frame.world.get(layer.parent_id) : undefined;
    const origin = transformPoint(world, [0, 0, 0]);
    const toPixels = (point: Vec3): [number, number] | null => {
      const m = frame.proj;
      const v = frame.view;
      const viewPoint = transformPoint(v, point);
      const w = -viewPoint[2];
      if (w < 0.05) return null;
      const clipX = (m[0] ?? 0) * viewPoint[0];
      const clipY = (m[5] ?? 0) * viewPoint[1];
      return [(clipX / w + 1) * 0.5 * frame.cssWidth, (1 - clipY / w) * 0.5 * frame.cssHeight];
    };
    const base = toPixels(origin);
    if (!base) return null;
    const distance = Math.hypot(origin[0] - frame.eye[0], origin[1] - frame.eye[1], origin[2] - frame.eye[2]);
    const fallback: Record<GizmoAxis, [number, number]> = { x: [1, 0], y: [0, -1], z: [-0.7071, 0.7071] };
    const directions = { x: fallback.x, y: fallback.y, z: fallback.z };
    const axes: [GizmoAxis, Vec3][] = [["x", [1, 0, 0]], ["y", [0, 1, 0]], ["z", [0, 0, 1]]];
    for (const [name, local] of axes) {
      const dir = parentWorld
        ? [
          (parentWorld[0] ?? 0) * local[0] + (parentWorld[4] ?? 0) * local[1] + (parentWorld[8] ?? 0) * local[2],
          (parentWorld[1] ?? 0) * local[0] + (parentWorld[5] ?? 0) * local[1] + (parentWorld[9] ?? 0) * local[2],
          (parentWorld[2] ?? 0) * local[0] + (parentWorld[6] ?? 0) * local[1] + (parentWorld[10] ?? 0) * local[2],
        ]
        : local;
      const size = Math.hypot(dir[0] ?? 0, dir[1] ?? 0, dir[2] ?? 0) || 1;
      const step = Math.max(0.02, distance * 0.05);
      const tip = toPixels([origin[0] + ((dir[0] ?? 0) / size) * step, origin[1] + ((dir[1] ?? 0) / size) * step, origin[2] + ((dir[2] ?? 0) / size) * step]);
      if (!tip) continue;
      const dx = tip[0] - base[0];
      const dy = tip[1] - base[1];
      const length = Math.hypot(dx, dy);
      if (length > 1e-4) directions[name] = [dx / length, dy / length];
    }
    if (Math.abs(directions.x[0] * directions.z[0] + directions.x[1] * directions.z[1]) > 0.9999
      || Math.abs(directions.y[0] * directions.z[0] + directions.y[1] * directions.z[1]) > 0.9999) {
      directions.z = [-0.7071, 0.7071];
    }
    const grip = (axis: GizmoAxis): [number, number] => [
      Math.round(base[0] + directions[axis][0] * GIZMO_PX), Math.round(base[1] + directions[axis][1] * GIZMO_PX),
    ];
    return { origin: [base[0], base[1]], grips: { x: grip("x"), y: grip("y"), z: grip("z") }, directions };
  }

  private drawGizmo(shape: GizmoShape): void {
    const { gl } = this;
    const triangles: number[] = [];
    const quad = (cx: number, cy: number, hx: number, hy: number): void => {
      triangles.push(cx - hx, cy - hy, cx + hx, cy - hy, cx + hx, cy + hy, cx - hx, cy - hy, cx + hx, cy + hy, cx - hx, cy + hy);
    };
    gl.useProgram(this.screenProgram);
    gl.uniform2f(gl.getUniformLocation(this.screenProgram, "u_size"), this.width, this.height);
    gl.bindVertexArray(this.screenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
    for (const axis of ["x", "y", "z"] as const) {
      triangles.length = 0;
      const [ox, oy] = shape.origin;
      const [gx, gy] = shape.grips[axis];
      const [dx, dy] = shape.directions[axis];
      const nx = -dy * 1.5;
      const ny = dx * 1.5;
      triangles.push(ox - nx, oy - ny, ox + nx, oy + ny, gx + nx, gy + ny, ox - nx, oy - ny, gx + nx, gy + ny, gx - nx, gy - ny);
      quad(gx, gy, GRIP_HALF, GRIP_HALF);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangles), gl.DYNAMIC_DRAW);
      gl.uniform4f(gl.getUniformLocation(this.screenProgram, "u_colour"), ...AXIS_COLOURS[axis], 1);
      gl.drawArrays(gl.TRIANGLES, 0, triangles.length / 2);
    }
  }
}
