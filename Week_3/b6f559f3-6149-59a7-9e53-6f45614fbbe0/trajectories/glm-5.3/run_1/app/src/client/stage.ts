// The stage: WebGL2 with a flat-shaded 2D canvas fallback. Both draw the same
// resolved scene from the shared evaluator.
import type { SceneBundle, SceneDocument } from '../domain/types';
import type { ResolvedLayer, EvalContext, ModelInfo } from '../domain/evaluate';
import { evaluateScene, extrusionFor } from '../domain/evaluate';
import { ARTBOARDS } from '../domain/props';
import { hexToRgb } from '../domain/format';
import {
  cubeMesh,
  sphereMesh,
  cylinderMesh,
  torusMesh,
  planeMesh,
  extrusionMesh,
  presetMesh,
  type Mesh,
} from './meshes';
import { transformPoint, projectToScreen, type Mat4 } from '../domain/math3d';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormal;
out vec3 vNormal;
out vec3 vViewPos;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 viewPos = uView * world;
  gl_Position = uProj * viewPos;
  vNormal = normalize(uNormal * aNormal);
  vViewPos = viewPos.xyz;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vViewPos;
uniform vec3 uColour;
uniform float uOpacity;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float rim = pow(1.0 - abs(n.z), 2.0) * 0.4;
  vec3 col = uColour * (0.35 + 0.65 * diff) + vec3(0.16, 0.13, 0.28) * rim;
  float spec = pow(max(dot(reflect(-normalize(uLightDir), n), normalize(-vViewPos)), 0.0), 40.0);
  col += vec3(spec) * 0.25;
  frag = vec4(col, uOpacity);
}`;

export interface StageRenderOptions {
  bundle: SceneBundle;
  scene: SceneDocument;
  ctx: EvalContext;
  variables: SceneBundle['variables'];
  meshes?: Map<string, Mesh>;
}

export interface StageHandle {
  canvas: HTMLCanvasElement;
  renderer: 'webgl2' | 'canvas2d';
  render(options: StageRenderOptions): void;
  resize(): void;
  dispose(): void;
}

function buildMeshesFor(doc: SceneDocument, _bundle: SceneBundle, modelInfo: Map<string, ModelInfo>): Map<string, Mesh> {
  const out = new Map<string, Mesh>();
  for (const layer of doc.layers) {
    if (layer.kind === 'Primitive') {
      const prim = layer.props.primitive as string;
      out.set(
        layer.id,
        prim === 'Sphere'
          ? sphereMesh()
          : prim === 'Cylinder'
            ? cylinderMesh()
            : prim === 'Torus'
              ? torusMesh()
              : prim === 'Plane'
                ? planeMesh()
                : cubeMesh(),
      );
    } else if (layer.kind === 'Extrusion') {
      const geom = extrusionFor(layer.props);
      if (geom) {
        out.set(
          layer.id,
          extrusionMesh({
            outlines: geom.outlines,
            depth: geom.depth,
            bevel: geom.bevel,
            bevelSegments: 0,
          }),
        );
      }
    } else if (layer.kind === 'Model') {
      const preset = layer.props.preset as string | null;
      if (preset) out.set(layer.id, presetMesh(preset));
      else {
        const info = modelInfo.get(layer.id);
        void info;
        out.set(layer.id, cubeMesh(0.4, 0.4, 0.4));
      }
    } else if (layer.kind === 'Cloth') {
      // The cloth mesh is rebuilt per frame from the simulation.
      out.set(layer.id, planeMesh());
    }
  }
  return out;
}

export function createStage(container: HTMLElement): StageHandle {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.append(canvas);

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (gl) {
    return createWebglStage(canvas, gl);
  }
  return create2dStage(canvas);
}

interface GpuObj {
  vao: WebGLVertexArrayObject;
  count: number;
}

function createWebglStage(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): StageHandle {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const uProj = gl.getUniformLocation(prog, 'uProj');
  const uView = gl.getUniformLocation(prog, 'uView');
  const uModel = gl.getUniformLocation(prog, 'uModel');
  const uNormal = gl.getUniformLocation(prog, 'uNormal');
  const uColour = gl.getUniformLocation(prog, 'uColour');
  const uOpacity = gl.getUniformLocation(prog, 'uOpacity');
  const uLightDir = gl.getUniformLocation(prog, 'uLightDir');
  const uCamPos = gl.getUniformLocation(prog, 'uCamPos');

  const meshes = new Map<string, Mesh>();
  const gpu = new Map<string, GpuObj>();

  const upload = (id: string, mesh: Mesh): GpuObj => {
    const existing = gpu.get(id);
    if (existing) return existing;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const obj: GpuObj = { vao, count: mesh.indices.length };
    gpu.set(id, obj);
    return obj;
  };

  const makePerspective = (fov: number, aspect: number, near: number, far: number): Float32Array => {
    const f = 1 / Math.tan(((fov * Math.PI) / 180) / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  };

  const normalMatrix = (model: Mat4): Float32Array => {
    // Upper-left 3×3 of the inverse transpose; for our uniform-ish transforms
    // the rotation part is close enough for shading.
    const m = new Float32Array(9);
    m[0] = model[0]; m[1] = model[4]; m[2] = model[8];
    m[3] = model[1]; m[4] = model[5]; m[5] = model[9];
    m[6] = model[2]; m[7] = model[6]; m[8] = model[10];
    return m;
  };

  const render = (options: StageRenderOptions): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(containerWidth(canvas) * dpr));
    const h = Math.max(1, Math.floor(containerHeight(canvas) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const ab = ARTBOARDS[options.ctx.breakpoint];
    const doc = options.scene;
    if (options.meshes) for (const [id, m] of options.meshes) meshes.set(id, m);
    const resolved = evaluateScene(doc, options.ctx, options.variables);
    const bg = hexToRgb(doc.background);
    gl.clearColor(bg.r / 255, bg.g / 255, bg.b / 255, 1);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = ab.w / ab.h;
    const proj = makePerspective(
      resolved.camera.fov,
      aspect,
      doc.camera.near,
      doc.camera.far,
    );
    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, new Float32Array(resolved.camera.view));
    gl.uniform3fv(uLightDir, new Float32Array([0.4, 0.5, 1]));
    gl.uniform3fv(uCamPos, new Float32Array([resolved.camera.pos.x, resolved.camera.pos.y, resolved.camera.pos.z]));

    // Draw order: depth-tested layers in stack order, then depth-off layers.
    const visible = resolved.layers.filter((l) => l.layer.visible);
    const depthOn = visible.filter((l) => (l.props.depthTest as boolean) !== false);
    const depthOff = visible.filter((l) => (l.props.depthTest as boolean) === false);
    const drawLayer = (layer: ResolvedLayer): void => {
      const mesh = meshes.get(layer.layer.id);
      if (!mesh) return;
      const obj = upload(layer.layer.id, mesh);
      gl.uniformMatrix4fv(uModel, false, new Float32Array(layer.world));
      gl.uniformMatrix3fv(uNormal, false, normalMatrix(layer.world));
      const mat = layer.props.material as { color?: string; opacity?: number };
      const c = hexToRgb(mat?.color ?? '#FFFFFF');
      gl.uniform3fv(uColour, new Float32Array([c.r / 255, c.g / 255, c.b / 255]));
      gl.uniform1f(uOpacity, mat?.opacity ?? 1);
      const faces = layer.props.faces as string;
      if (faces === 'both') gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(obj.vao);
      gl.drawElements(gl.TRIANGLES, obj.count, mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    };
    for (const layer of depthOn) drawLayer(layer);
    gl.disable(gl.DEPTH_TEST);
    for (const layer of depthOff) drawLayer(layer);
    gl.enable(gl.DEPTH_TEST);
  };

  return {
    canvas,
    renderer: 'webgl2',
    render,
    resize: () => undefined,
    dispose: () => {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };

}

function containerWidth(canvas: HTMLCanvasElement): number {
  return canvas.parentElement?.clientWidth ?? canvas.clientWidth ?? 300;
}
function containerHeight(canvas: HTMLCanvasElement): number {
  return canvas.parentElement?.clientHeight ?? canvas.clientHeight ?? 300;
}

// --- 2D fallback ---------------------------------------------------------

function create2dStage(canvas: HTMLCanvasElement): StageHandle {
  const ctx2d = canvas.getContext('2d')!;
  const meshes = new Map<string, Mesh>();

  const render = (options: StageRenderOptions): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = containerWidth(canvas);
    const ch = containerHeight(canvas);
    const w = Math.max(1, Math.floor(cw * dpr));
    const h = Math.max(1, Math.floor(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const doc = options.scene;
    if (options.meshes) for (const [id, m] of options.meshes) meshes.set(id, m);
    const resolved = evaluateScene(doc, options.ctx, options.variables);
    const bg = hexToRgb(doc.background);
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
    ctx2d.fillRect(0, 0, w, h);

    const scale = Math.min(w / 1440, h / 810);
    const offX = (w - 1440 * scale) / 2;
    const offY = (h - 810 * scale) / 2;

    const visible = resolved.layers.filter((l) => l.layer.visible);
    for (const layer of visible) {
      const mesh = meshes.get(layer.layer.id);
      if (!mesh) continue;
      const mat = layer.props.material as { color?: string; opacity?: number } | undefined;
      const c = hexToRgb(mat?.color ?? '#FFFFFF');
      ctx2d.globalAlpha = mat?.opacity ?? 1;
      ctx2d.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      // Flat shading: project every triangle and fill.
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]!;
        const b = mesh.indices[i + 1]!;
        const cIdx = mesh.indices[i + 2]!;
        const p0 = transformPoint(layer.world, {
          x: mesh.positions[a * 3]!,
          y: mesh.positions[a * 3 + 1]!,
          z: mesh.positions[a * 3 + 2]!,
        });
        const p1 = transformPoint(layer.world, {
          x: mesh.positions[b * 3]!,
          y: mesh.positions[b * 3 + 1]!,
          z: mesh.positions[b * 3 + 2]!,
        });
        const p2 = transformPoint(layer.world, {
          x: mesh.positions[cIdx * 3]!,
          y: mesh.positions[cIdx * 3 + 1]!,
          z: mesh.positions[cIdx * 3 + 2]!,
        });
        const s0 = projectToScreen(p0, resolved.camera.view, resolved.camera.fov, 1440, 810, doc.camera.near, doc.camera.far);
        const s1 = projectToScreen(p1, resolved.camera.view, resolved.camera.fov, 1440, 810, doc.camera.near, doc.camera.far);
        const s2 = projectToScreen(p2, resolved.camera.view, resolved.camera.fov, 1440, 810, doc.camera.near, doc.camera.far);
        if (!s0.visible || !s1.visible || !s2.visible) continue;
        ctx2d.beginPath();
        ctx2d.moveTo(offX + s0.x * scale, offY + s0.y * scale);
        ctx2d.lineTo(offX + s1.x * scale, offY + s1.y * scale);
        ctx2d.lineTo(offX + s2.x * scale, offY + s2.y * scale);
        ctx2d.closePath();
        ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;
    }
  };

  return {
    canvas,
    renderer: 'canvas2d',
    render,
    resize: () => undefined,
    dispose: () => undefined,
  };
}

export function meshesFor(doc: SceneDocument, bundle: SceneBundle, modelInfo: Map<string, ModelInfo>): Map<string, Mesh> {
  return buildMeshesFor(doc, bundle, modelInfo);
}
