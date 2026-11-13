import {
  booleanAt,
  cameraAzimuth,
  clipPlaybacks,
  clothSettingsOf,
  formationPositions,
  formationTargets,
  layerMesh,
  layerTransform,
  modelFor,
  numberAt,
  particleSettingsOf,
  resolveLayer,
  stringAt,
} from '../shared/evaluator';
import type { EvaluateInput, LoadedAsset } from '../shared/evaluator';
import { simulateEmitter } from '../shared/particles';
import { simulateCloth } from '../shared/cloth';
import { applyTransform, orbitedCamera, projectPoint, vec } from '../shared/math3d';
import type { Mesh } from '../shared/math3d';
import { is2D, is3D } from '../shared/properties';
import { ARTBOARDS } from '../shared/types';
import type { Breakpoint, Layer, Scene, SceneDocument, Vec3 } from '../shared/types';
import { hexToRgb } from '../shared/format';
import { gradientColour, gradientT, polygonPoints } from '../shared/raster';
import {
  applyNodeTransform,
  nodeTransformAt,
} from '../shared/gltf';

const MATCAP_COLOURS: Record<string, [number, number, number]> = {
  Clay: [196, 168, 150],
  Chrome: [214, 222, 240],
  Jade: [128, 206, 170],
  Ember: [236, 148, 88],
};

const ENVIRONMENT_TOPS: Record<string, [number, number, number]> = {
  'Dusk room': [38, 32, 54],
  'Night grid': [16, 18, 30],
  Flat: [12, 12, 16],
};

const BLEND_OPERATIONS: Record<string, GlobalCompositeOperation> = {
  Normal: 'source-over',
  Multiply: 'multiply',
  Screen: 'screen',
  Overlay: 'overlay',
  Darken: 'darken',
  Lighten: 'lighten',
};

export interface StageInput extends EvaluateInput {
  imageUrl: (assetId: string) => string;
  /** A demo stage draws at its own size instead of the artboard. */
  viewport?: { width: number; height: number };
}

interface Triangle {
  points: { x: number; y: number }[];
  depth: number;
  colour: [number, number, number];
  alpha: number;
}

const imageCache = new Map<string, HTMLImageElement>();

function imageFor(url: string, onLoad: () => void): HTMLImageElement | null {
  const cached = imageCache.get(url);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const image = new Image();
  image.addEventListener('load', onLoad);
  image.addEventListener('error', onLoad);
  image.src = url;
  imageCache.set(url, image);
  return null;
}

function sceneOf(document: SceneDocument, sceneId: string): Scene | null {
  return document.scenes.find((scene) => scene.id === sceneId) ?? null;
}

function shade(base: [number, number, number], normalY: number, facing: number): [number, number, number] {
  const lambert = 0.35 + 0.5 * Math.max(0, normalY * 0.5 + 0.5) + 0.25 * facing;
  return [
    Math.max(0, Math.min(255, base[0] * lambert)),
    Math.max(0, Math.min(255, base[1] * lambert)),
    Math.max(0, Math.min(255, base[2] * lambert)),
  ];
}

function meshTriangles(
  mesh: Mesh,
  transformPoint: (point: Vec3) => Vec3,
  camera: Scene['camera'],
  breakpoint: Breakpoint,
  colour: [number, number, number],
  alpha: number,
  viewport?: { width: number; height: number },
): Triangle[] {
  const out: Triangle[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const corners: Vec3[] = [];
    for (let c = 0; c < 3; c += 1) {
      const index = mesh.indices[i + c] * 3;
      corners.push(
        transformPoint(vec(mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2])),
      );
    }
    const screen = corners.map((corner) => projectPoint(corner, camera, breakpoint, viewport));
    if (screen.some((point) => !point.visible)) continue;
    const edge1 = vec(
      corners[1].x - corners[0].x,
      corners[1].y - corners[0].y,
      corners[1].z - corners[0].z,
    );
    const edge2 = vec(
      corners[2].x - corners[0].x,
      corners[2].y - corners[0].y,
      corners[2].z - corners[0].z,
    );
    const normal = vec(
      edge1.y * edge2.z - edge1.z * edge2.y,
      edge1.z * edge2.x - edge1.x * edge2.z,
      edge1.x * edge2.y - edge1.y * edge2.x,
    );
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const signedArea =
      (screen[1].x - screen[0].x) * (screen[2].y - screen[0].y) -
      (screen[2].x - screen[0].x) * (screen[1].y - screen[0].y);
    out.push({
      points: screen.map((point) => ({ x: point.x, y: point.y })),
      depth: (corners[0].z + corners[1].z + corners[2].z) / 3,
      colour: shade(colour, normal.y / length, signedArea < 0 ? 1 : 0),
      alpha,
    });
  }
  return out;
}

interface Draw3D {
  layer: Layer;
  triangles: Triangle[];
  depthTest: boolean;
}

export function build3D(input: StageInput): Draw3D[] {
  const scene = sceneOf(input.document, input.sceneId);
  if (!scene) return [];
  const azimuth = cameraAzimuth(scene, input.scroll, input.reducedMotion);
  const camera = orbitedCamera(scene.camera, azimuth);
  const draws: Draw3D[] = [];
  const ordered = [...scene.layers].filter((layer) => is3D(layer.kind)).sort((a, b) => a.order - b.order);
  for (const layer of ordered) {
    const resolution = resolveLayer(input.document, layer, input);
    if (!booleanAt(resolution, 'visible', true)) continue;
    const transform = layerTransform(resolution);
    if (layer.events.tilt.enabled && !input.reducedMotion && input.tilt) {
      transform.rotation = vec(
        transform.rotation.x + input.tilt.x,
        transform.rotation.y + input.tilt.y,
        transform.rotation.z,
      );
    }
    const materialKind = stringAt(resolution, 'material.kind', 'Matcap');
    const colour =
      materialKind === 'Glass'
        ? hexToRgb(stringAt(resolution, 'material.color', '#B7A4FF'))
        : MATCAP_COLOURS[stringAt(resolution, 'material.matcap', 'Clay')] ?? [196, 168, 150];
    const alpha = numberAt(resolution, 'material.opacity', 1);
    const depthTest = booleanAt(resolution, 'depthTest', true);
    const place = (point: Vec3): Vec3 => applyTransform(point, transform);
    let triangles: Triangle[] = [];
    if (layer.kind === 'Model') {
      const model = modelFor(resolution, input.assets);
      if (model) {
        const playbacks = clipPlaybacks(resolution, model);
        const seconds = input.reducedMotion ? 0 : input.frame / 60;
        model.nodes.forEach((node, index) => {
          if (node.mesh === null || !model.meshes[node.mesh]) return;
          const nodeTransform = nodeTransformAt(model, index, playbacks, seconds);
          const mesh = model.meshes[node.mesh];
          triangles = triangles.concat(
            meshTriangles(
              { positions: mesh.positions, indices: mesh.indices },
              (point) => place(
                (() => {
                  const moved = applyNodeTransform(nodeTransform, [point.x, point.y, point.z]);
                  return vec(moved[0], moved[1], moved[2]);
                })(),
              ),
              camera,
              input.breakpoint,
              colour,
              alpha,
              input.viewport,
            ),
          );
        });
      }
    } else if (layer.kind === 'Particles') {
      const frame = input.reducedMotion ? 0 : input.frame;
      let positions: Vec3[] = [];
      if (stringAt(resolution, 'mode', 'emit') === 'form') {
        positions = formationPositions(
          {
            seed: Math.round(numberAt(resolution, 'seed', 7)),
            count: Math.round(numberAt(resolution, 'formation.count', 200)),
            durationMs: numberAt(resolution, 'formation.durationMs', 1500),
            targets: formationTargets(input.document, scene, resolution, input, input.assets),
          },
          frame,
        );
      } else {
        positions = simulateEmitter(particleSettingsOf(resolution), frame, input.particleMax).map(
          (particle) => particle.position,
        );
      }
      triangles = positions.flatMap((position) => {
        const world = place(position);
        const point = projectPoint(world, camera, input.breakpoint, input.viewport);
        if (!point.visible) return [];
        const size = 2.4;
        return [
          {
            points: [
              { x: point.x - size, y: point.y - size },
              { x: point.x + size, y: point.y - size },
              { x: point.x, y: point.y + size },
            ],
            depth: world.z,
            colour,
            alpha,
          },
        ];
      });
    } else if (layer.kind === 'Cloth') {
      const settings = clothSettingsOf(resolution);
      const points = simulateCloth(settings, input.reducedMotion ? 0 : input.frame);
      const columns = Math.round(settings.columns);
      const rows = Math.round(settings.rows);
      const at = (row: number, column: number): Vec3 => points[(row - 1) * columns + (column - 1)].position;
      const mesh: Mesh = { positions: [], indices: [] };
      points.forEach((point) => mesh.positions.push(point.position.x, point.position.y, point.position.z));
      for (let row = 1; row < rows; row += 1) {
        for (let column = 1; column < columns; column += 1) {
          const a = (row - 1) * columns + (column - 1);
          const b = a + 1;
          const c = a + columns;
          const d = c + 1;
          mesh.indices.push(a, c, d, a, d, b);
        }
      }
      void at;
      triangles = meshTriangles(mesh, place, camera, input.breakpoint, colour, alpha, input.viewport);
    } else {
      const mesh = layerMesh(layer, resolution, input.assets);
      if (mesh) {
        triangles = meshTriangles(
          mesh,
          place,
          camera,
          input.breakpoint,
          colour,
          alpha,
          input.viewport,
        );
      }
    }
    draws.push({ layer, triangles, depthTest });
  }
  return draws;
}

export function drawBackground(
  context: CanvasRenderingContext2D,
  scene: Scene,
  width: number,
  height: number,
  lightFocus: { x: number; y: number } | null,
  lightLevel: number,
): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = scene.background;
  context.fillRect(0, 0, width, height);
  const top = ENVIRONMENT_TOPS[scene.environment] ?? ENVIRONMENT_TOPS.Flat;
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `rgba(${top[0]}, ${top[1]}, ${top[2]}, 0.85)`);
  sky.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  if (scene.light.enabled && lightFocus && lightLevel > 0) {
    const centre = { x: lightFocus.x * width, y: lightFocus.y * height };
    const radius = Math.max(width, height) * 0.75;
    const glow = context.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
    glow.addColorStop(0, `rgba(143, 118, 255, ${0.55 * lightLevel})`);
    glow.addColorStop(0.45, `rgba(104, 92, 214, ${0.22 * lightLevel})`);
    glow.addColorStop(1, 'rgba(10, 10, 16, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }
  if (scene.environment === 'Night grid') {
    context.strokeStyle = 'rgba(150, 140, 220, 0.12)';
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += Math.max(24, width / 24)) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += Math.max(24, height / 16)) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }
}

function shapePath(
  context: CanvasRenderingContext2D,
  layer: Layer,
  box: { x: number; y: number; width: number; height: number; sides: number },
): void {
  context.beginPath();
  if (layer.kind === 'Ellipse') {
    context.ellipse(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width / 2,
      box.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    return;
  }
  if (layer.kind === 'Polygon') {
    const points = polygonPoints(box);
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    return;
  }
  context.rect(box.x, box.y, box.width, box.height);
}

export function draw2D(
  context: CanvasRenderingContext2D,
  input: StageInput,
  onImageLoad: () => void,
): void {
  const scene = sceneOf(input.document, input.sceneId);
  if (!scene) return;
  const ordered = [...scene.layers]
    .filter((layer) => is2D(layer.kind))
    .sort((a, b) => a.order - b.order);
  ordered.forEach((layer, index) => {
    const resolution = resolveLayer(input.document, layer, input);
    if (!booleanAt(resolution, 'visible', true)) return;
    if (layer.maskAbove) return;
    const box = {
      x: numberAt(resolution, 'x', 0),
      y: numberAt(resolution, 'y', 0),
      width: numberAt(resolution, 'width', 200),
      height: numberAt(resolution, 'height', 200),
      sides: numberAt(resolution, 'sides', 6),
    };
    let alpha = numberAt(resolution, 'opacity', 100) / 100;
    const below = ordered[index - 1];
    let mask: { layer: Layer; box: typeof box; alpha: number } | null = null;
    if (below && below.maskAbove) {
      const maskResolution = resolveLayer(input.document, below, input);
      if (booleanAt(maskResolution, 'visible', true)) {
        mask = {
          layer: below,
          box: {
            x: numberAt(maskResolution, 'x', 0),
            y: numberAt(maskResolution, 'y', 0),
            width: numberAt(maskResolution, 'width', 200),
            height: numberAt(maskResolution, 'height', 200),
            sides: numberAt(maskResolution, 'sides', 6),
          },
          alpha: numberAt(maskResolution, 'opacity', 100) / 100,
        };
        alpha *= mask.alpha;
      } else {
        alpha = 0;
      }
    }
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    context.globalCompositeOperation = BLEND_OPERATIONS[layer.blendMode] ?? 'source-over';
    if (mask) {
      context.beginPath();
      shapePath(context, mask.layer, mask.box);
      context.clip();
    }
    if (layer.kind === 'Gradient') {
      const gradient = {
        type: stringAt(resolution, 'gradient.type', 'Linear'),
        angle: numberAt(resolution, 'gradient.angle', 0),
        centerX: numberAt(resolution, 'gradient.centerX', 50),
        centerY: numberAt(resolution, 'gradient.centerY', 50),
        radius: numberAt(resolution, 'gradient.radius', 100),
        stops: (() => {
          const stored = resolution.values.get('gradient.stops');
          if (!Array.isArray(stored)) return [];
          return stored.map((stop) => {
            const record = stop as Record<string, unknown>;
            return {
              color: typeof record.color === 'string' ? record.color : '#000000',
              position: typeof record.position === 'number' ? record.position : 0,
            };
          });
        })(),
      };
      const sampleLayer = { ...box, id: layer.id, kind: layer.kind } as never;
      const steps = 48;
      for (let step = 0; step < steps; step += 1) {
        const fraction = (step + 0.5) / steps;
        const point =
          gradient.type === 'Radial'
            ? {
                x: box.x + (gradient.centerX / 100) * box.width + fraction * gradient.radius,
                y: box.y + (gradient.centerY / 100) * box.height,
              }
            : {
                x: box.x + fraction * box.width,
                y: box.y + box.height / 2,
              };
        const t = gradientT(gradient, sampleLayer as never, point);
        const rgb = gradientColour(gradient.stops, t);
        context.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        if (gradient.type === 'Radial') {
          context.beginPath();
          context.arc(
            box.x + (gradient.centerX / 100) * box.width,
            box.y + (gradient.centerY / 100) * box.height,
            gradient.radius * (1 - fraction),
            0,
            Math.PI * 2,
          );
          context.fill();
        } else {
          const angle = (gradient.angle * Math.PI) / 180;
          context.save();
          context.translate(box.x + box.width / 2, box.y + box.height / 2);
          context.rotate(angle);
          const span = Math.hypot(box.width, box.height);
          context.fillRect(-span / 2 + fraction * span, -span / 2, span / steps + 1, span);
          context.restore();
        }
      }
      context.restore();
      return;
    }
    if (layer.kind === 'Text') {
      const size = numberAt(resolution, 'textSize', 48);
      context.fillStyle = stringAt(resolution, 'fill', '#FFFFFF');
      context.font = `600 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
      context.textBaseline = 'top';
      context.fillText(stringAt(resolution, 'text', 'Text'), box.x, box.y);
      context.restore();
      return;
    }
    if (layer.kind === 'Image') {
      const assetId = resolution.values.get('assetId');
      if (typeof assetId === 'string' && assetId) {
        const image = imageFor(input.imageUrl(assetId), onImageLoad);
        if (image) {
          context.drawImage(image, box.x, box.y, box.width, box.height);
          context.restore();
          return;
        }
      }
      context.fillStyle = 'rgba(120, 112, 160, 0.35)';
      context.fillRect(box.x, box.y, box.width, box.height);
      context.restore();
      return;
    }
    context.fillStyle = stringAt(resolution, 'fill', '#FFFFFF');
    shapePath(context, layer, box);
    context.fill();
    context.restore();
  });
}

export function draw3DOnCanvas(
  context: CanvasRenderingContext2D,
  draws: Draw3D[],
): void {
  const render = (triangles: Triangle[]): void => {
    for (const triangle of triangles) {
      context.globalAlpha = Math.max(0, Math.min(1, triangle.alpha));
      context.fillStyle = `rgb(${Math.round(triangle.colour[0])}, ${Math.round(
        triangle.colour[1],
      )}, ${Math.round(triangle.colour[2])})`;
      context.beginPath();
      triangle.points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.closePath();
      context.fill();
    }
  };
  const depthTested = draws.filter((draw) => draw.depthTest).flatMap((draw) => draw.triangles);
  depthTested.sort((a, b) => a.depth - b.depth);
  render(depthTested);
  for (const draw of draws.filter((item) => !item.depthTest)) {
    const sorted = [...draw.triangles].sort((a, b) => a.depth - b.depth);
    render(sorted);
  }
  context.globalAlpha = 1;
}

const VERTEX_SHADER = `#version 300 es
in vec2 position;
in vec4 colour;
uniform vec2 resolution;
out vec4 vertexColour;
void main() {
  vec2 clip = vec2(position.x / resolution.x * 2.0 - 1.0, 1.0 - position.y / resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vertexColour = colour;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 vertexColour;
out vec4 fragColour;
void main() { fragColour = vertexColour; }`;

export interface GlRenderer {
  draw: (draws: Draw3D[], width: number, height: number) => void;
}

export function createGlRenderer(canvas: HTMLCanvasElement): GlRenderer | null {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
  if (!gl) return null;
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  const positionBuffer = gl.createBuffer()!;
  const colourBuffer = gl.createBuffer()!;
  const positionLocation = gl.getAttribLocation(program, 'position');
  const colourLocation = gl.getAttribLocation(program, 'colour');
  const resolutionLocation = gl.getUniformLocation(program, 'resolution');

  return {
    draw(draws, width, height) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, width, height);
      const groups: Triangle[][] = [
        (() => {
          const list = draws.filter((draw) => draw.depthTest).flatMap((draw) => draw.triangles);
          list.sort((a, b) => a.depth - b.depth);
          return list;
        })(),
        ...draws.filter((draw) => !draw.depthTest).map((draw) =>
          [...draw.triangles].sort((a, b) => a.depth - b.depth),
        ),
      ];
      for (const triangles of groups) {
        if (triangles.length === 0) continue;
        const positions = new Float32Array(triangles.length * 6);
        const colours = new Float32Array(triangles.length * 12);
        triangles.forEach((triangle, index) => {
          triangle.points.forEach((point, corner) => {
            positions[index * 6 + corner * 2] = point.x;
            positions[index * 6 + corner * 2 + 1] = point.y;
            colours[index * 12 + corner * 4] = triangle.colour[0] / 255;
            colours[index * 12 + corner * 4 + 1] = triangle.colour[1] / 255;
            colours[index * 12 + corner * 4 + 2] = triangle.colour[2] / 255;
            colours[index * 12 + corner * 4 + 3] = triangle.alpha;
          });
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, colourBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, colours, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(colourLocation);
        gl.vertexAttribPointer(colourLocation, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, triangles.length * 3);
      }
    },
  };
}

export function artboardSize(breakpoint: Breakpoint): { width: number; height: number } {
  return ARTBOARDS[breakpoint];
}

export type { Draw3D, LoadedAsset };
