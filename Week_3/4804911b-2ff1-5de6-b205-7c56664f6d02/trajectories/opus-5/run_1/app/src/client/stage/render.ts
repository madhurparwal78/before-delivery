import {
  FRONT_BOX,
  PACK_SIZES,
  PANEL_GEOMETRY,
  boundingRect,
  frontPoint,
  panelPoint,
  project,
  rectCorners,
  type Camera,
  type PackFormat,
  type Point,
  type Rect,
} from './geometry.js';
import { ACCENT } from './textures.js';

export interface PackLayer {
  format: PackFormat;
  frontTexture: HTMLCanvasElement;
  panelTexture: HTMLCanvasElement;
  stickerTexture: HTMLCanvasElement | null;
  stickerQuad: Point[] | null;
  panelLines: string[];
  mrpLine: string;
  frontLines: { name: string; variant: string };
  stickerLine: string;
  alpha: number;
}

export interface Scene {
  camera: Camera;
  layers: PackLayer[];
  width: number;
  height: number;
  pixelRatio: number;
}

export interface Renderer {
  readonly kind: 'webgl' | 'svg';
  draw(scene: Scene): void;
  destroy(): void;
}

interface Face {
  points: { x: number; y: number; z: number }[];
  texture: HTMLCanvasElement;
  light: number;
  flat: boolean;
}

const LAMP = { x: 0.45, y: 0.5, z: 0.75 };

function normalLight(normal: { x: number; y: number; z: number }, yawDegrees: number): number {
  const angle = (yawDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotated = {
    x: normal.x * cos + normal.z * sin,
    y: normal.y,
    z: -normal.x * sin + normal.z * cos,
  };
  const dot = rotated.x * LAMP.x + rotated.y * LAMP.y + rotated.z * LAMP.z;
  return 0.55 + 0.45 * Math.max(0, dot);
}

function facesOf(layer: PackLayer, side: HTMLCanvasElement, yawDegrees: number): Face[] {
  const size = PACK_SIZES[layer.format];
  const hx = size.w / 2;
  const hy = size.h / 2;
  const hz = size.d / 2;
  const faces: Face[] = [
    {
      points: [
        { x: -hx, y: hy, z: hz },
        { x: hx, y: hy, z: hz },
        { x: hx, y: -hy, z: hz },
        { x: -hx, y: -hy, z: hz },
      ],
      texture: layer.frontTexture,
      light: normalLight({ x: 0, y: 0, z: 1 }, yawDegrees),
      flat: false,
    },
    {
      points: [
        { x: hx, y: hy, z: -hz },
        { x: -hx, y: hy, z: -hz },
        { x: -hx, y: -hy, z: -hz },
        { x: hx, y: -hy, z: -hz },
      ],
      texture: layer.panelTexture,
      light: normalLight({ x: 0, y: 0, z: -1 }, yawDegrees),
      flat: false,
    },
    {
      points: [
        { x: -hx, y: hy, z: -hz },
        { x: -hx, y: hy, z: hz },
        { x: -hx, y: -hy, z: hz },
        { x: -hx, y: -hy, z: -hz },
      ],
      texture: side,
      light: normalLight({ x: -1, y: 0, z: 0 }, yawDegrees),
      flat: false,
    },
    {
      points: [
        { x: hx, y: hy, z: hz },
        { x: hx, y: hy, z: -hz },
        { x: hx, y: -hy, z: -hz },
        { x: hx, y: -hy, z: hz },
      ],
      texture: side,
      light: normalLight({ x: 1, y: 0, z: 0 }, yawDegrees),
      flat: false,
    },
    {
      points: [
        { x: -hx, y: hy, z: -hz },
        { x: hx, y: hy, z: -hz },
        { x: hx, y: hy, z: hz },
        { x: -hx, y: hy, z: hz },
      ],
      texture: side,
      light: normalLight({ x: 0, y: 1, z: 0 }, yawDegrees),
      flat: false,
    },
  ];
  if (size.neck > 0) {
    const nx = hx * 0.34;
    const nz = hz * 0.34;
    faces.push(
      {
        points: [
          { x: -nx, y: hy + size.neck, z: nz },
          { x: nx, y: hy + size.neck, z: nz },
          { x: nx, y: hy, z: nz },
          { x: -nx, y: hy, z: nz },
        ],
        texture: side,
        light: normalLight({ x: 0, y: 0, z: 1 }, yawDegrees),
        flat: false,
      },
      {
        points: [
          { x: nx, y: hy + size.neck, z: -nz },
          { x: -nx, y: hy + size.neck, z: -nz },
          { x: -nx, y: hy, z: -nz },
          { x: nx, y: hy, z: -nz },
        ],
        texture: side,
        light: normalLight({ x: 0, y: 0, z: -1 }, yawDegrees),
        flat: false,
      },
    );
  }
  return faces;
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec2 aUv;
uniform vec2 uViewport;
varying vec2 vUv;
void main() {
  float w = aPosition.z;
  vec2 clip = vec2(aPosition.x / uViewport.x * 2.0 - 1.0, 1.0 - aPosition.y / uViewport.y * 2.0);
  gl_Position = vec4(clip * w, 0.0, w);
  vUv = aUv;
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTexture;
uniform float uLight;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec4 colour = texture2D(uTexture, vUv);
  gl_FragColor = vec4(colour.rgb * uLight, colour.a * uAlpha);
}`;

export function createWebglRenderer(
  canvas: HTMLCanvasElement,
  side: HTMLCanvasElement,
): Renderer | null {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: true });
  if (gl === null) return null;

  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);

  const positionBuffer = gl.createBuffer();
  const uvBuffer = gl.createBuffer();
  const positionAt = gl.getAttribLocation(program, 'aPosition');
  const uvAt = gl.getAttribLocation(program, 'aUv');
  const viewportAt = gl.getUniformLocation(program, 'uViewport');
  const lightAt = gl.getUniformLocation(program, 'uLight');
  const alphaAt = gl.getUniformLocation(program, 'uAlpha');

  const textures = new WeakMap<HTMLCanvasElement, WebGLTexture>();
  const textureFor = (source: HTMLCanvasElement): WebGLTexture => {
    const existing = textures.get(source);
    if (existing !== undefined) return existing;
    const texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    textures.set(source, texture);
    return texture;
  };

  const drawQuad = (
    corners: { x: number; y: number; depth: number }[],
    texture: HTMLCanvasElement,
    light: number,
    alpha: number,
  ): void => {
    const w = corners.map((corner) => 1 / corner.depth);
    const positions: number[] = [];
    const uvs: number[] = [];
    const quadUvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const [a, b, c] of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      for (const index of [a, b, c]) {
        positions.push(corners[index].x, corners[index].y, w[index]);
        uvs.push(quadUvs[index][0], quadUvs[index][1]);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(positionAt);
    gl.vertexAttribPointer(positionAt, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(uvAt);
    gl.vertexAttribPointer(uvAt, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, textureFor(texture));
    gl.uniform1f(lightAt, light);
    gl.uniform1f(alphaAt, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  return {
    kind: 'webgl',
    draw(scene: Scene): void {
      const width = Math.max(1, Math.round(scene.width * scene.pixelRatio));
      const height = Math.max(1, Math.round(scene.height * scene.pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.uniform2f(viewportAt, scene.width, scene.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (const layer of scene.layers) {
        if (layer.alpha <= 0.001) continue;
        const faces = facesOf(layer, side, scene.camera.yawDegrees).map((face) => {
          const corners = face.points.map((point) => project(scene.camera, point.x, point.y, point.z));
          const depth = corners.reduce((total, corner) => total + corner.depth, 0) / corners.length;
          return { face, corners, depth };
        });
        faces.sort((a, b) => b.depth - a.depth);
        for (const entry of faces) {
          drawQuad(entry.corners, entry.face.texture, entry.face.light, layer.alpha);
        }
        if (layer.stickerQuad !== null && layer.stickerTexture !== null) {
          const size = PACK_SIZES[layer.format];
          const corners = layer.stickerQuad.map((corner) => {
            const point = panelPoint(layer.format, corner.x, corner.y);
            return project(scene.camera, point.x, point.y, point.z - size.d * 0.016);
          });
          drawQuad(corners, layer.stickerTexture, 1, layer.alpha);
        }
      }
    },
    destroy(): void {
      /* the context is kept for the life of the document */
    },
  };
}

function shade(level: number): string {
  const value = Math.round(255 * Math.min(1, level));
  return `rgb(${value},${Math.round(value * 0.99)},${Math.round(value * 0.97)})`;
}

function polygonPoints(corners: Point[]): string {
  return corners.map((corner) => `${corner.x.toFixed(2)},${corner.y.toFixed(2)}`).join(' ');
}

/** The SVG panel: the same facts and the same front, as real text following the yaw. */
export function createSvgRenderer(svg: SVGElement): Renderer {
  const namespace = 'http://www.w3.org/2000/svg';
  const make = (tag: string, attributes: Record<string, string | number>): SVGElement => {
    const node = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  };

  return {
    kind: 'svg',
    draw(scene: Scene): void {
      while (svg.firstChild !== null) svg.firstChild.remove();
      svg.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
      svg.setAttribute('width', String(scene.width));
      svg.setAttribute('height', String(scene.height));

      for (const layer of scene.layers) {
        if (layer.alpha <= 0.001) continue;
        const group = make('g', { opacity: layer.alpha });
        const size = PACK_SIZES[layer.format];
        const faces = facesOf(layer, layer.frontTexture, scene.camera.yawDegrees).map((face) => {
          const corners = face.points.map((point) => project(scene.camera, point.x, point.y, point.z));
          const depth = corners.reduce((total, corner) => total + corner.depth, 0) / corners.length;
          return { face, corners, depth };
        });
        faces.sort((a, b) => b.depth - a.depth);
        for (const entry of faces) {
          group.append(
            make('polygon', {
              points: polygonPoints(entry.corners),
              fill: shade(entry.face.light),
              stroke: '#2a2a2a',
              'stroke-width': 1,
            }),
          );
        }

        const yaw = scene.camera.yawDegrees;
        if (yaw >= 90) {
          const mrp = PANEL_GEOMETRY[layer.format].mrp;
          const mrpCorners = rectCorners(mrp).map((corner) => {
            const point = panelPoint(layer.format, corner.x, corner.y);
            return project(scene.camera, point.x, point.y, point.z);
          });
          const mrpRect = boundingRect(mrpCorners);
          group.append(
            make('polygon', {
              points: polygonPoints(mrpCorners),
              fill: 'none',
              stroke: '#2a2a2a',
              'stroke-width': 2,
            }),
          );
          const mrpText = make('text', {
            x: mrpRect.x + mrpRect.w * 0.06,
            y: mrpRect.y + mrpRect.h * 0.68,
            'font-size': Math.max(9, mrpRect.h * 0.52),
            'font-family': '"Bebas Neue", sans-serif',
            fill: '#2a2a2a',
          });
          mrpText.textContent = layer.mrpLine;
          group.append(mrpText);

          const panelTop = panelPoint(layer.format, 0.08, 0.54);
          const anchor = project(scene.camera, panelTop.x, panelTop.y, panelTop.z);
          const panelCorners = rectCorners({ x: 0, y: 0, w: 1, h: 1 }).map((corner) => {
            const point = panelPoint(layer.format, corner.x, corner.y);
            return project(scene.camera, point.x, point.y, point.z);
          });
          const panelRect = boundingRect(panelCorners);
          const lineSize = Math.max(8, panelRect.h * 0.035);
          layer.panelLines.forEach((line, index) => {
            const node = make('text', {
              x: anchor.x,
              y: anchor.y + index * lineSize * 1.3,
              'font-size': lineSize,
              'font-family': '"EB Garamond", serif',
              fill: '#2a2a2a',
            });
            node.textContent = line;
            group.append(node);
          });
        } else {
          const boxCorners = rectCorners(FRONT_BOX).map((corner) => {
            const point = frontPoint(layer.format, corner.x, corner.y);
            return project(scene.camera, point.x, point.y, point.z);
          });
          const box = boundingRect(boxCorners);
          const clipId = `front-clip-${Math.round(box.x)}-${Math.round(box.y)}`;
          const clip = make('clipPath', { id: clipId });
          clip.append(make('rect', { x: box.x + 2, y: box.y + 2, width: Math.max(1, box.w - 4), height: Math.max(1, box.h - 4) }));
          group.append(clip);
          const inner = make('g', { 'clip-path': `url(#${clipId})` });
          const nameSize = Math.max(9, Math.min(box.h * 0.3, (box.w * 1.6) / Math.max(6, layer.frontLines.name.length)));
          const nameNode = make('text', {
            x: box.x + 4,
            y: box.y + nameSize,
            'font-size': nameSize,
            'font-family': '"Bebas Neue", sans-serif',
            fill: '#2a2a2a',
          });
          nameNode.textContent = layer.frontLines.name;
          inner.append(nameNode);
          const variantSize = Math.max(8, nameSize * 0.6);
          const variantNode = make('text', {
            x: box.x + 4,
            y: box.y + nameSize + variantSize * 1.3,
            'font-size': variantSize,
            'font-family': '"EB Garamond", serif',
            fill: '#2a2a2a',
          });
          variantNode.textContent = layer.frontLines.variant;
          inner.append(variantNode);
          group.append(inner);
        }

        if (layer.stickerQuad !== null) {
          const corners = layer.stickerQuad.map((corner) => {
            const point = panelPoint(layer.format, corner.x, corner.y);
            return project(scene.camera, point.x, point.y, point.z - size.d * 0.016);
          });
          const rect = boundingRect(corners);
          group.append(
            make('polygon', {
              points: polygonPoints(corners),
              fill: `rgb(${ACCENT.r},${ACCENT.g},${ACCENT.b})`,
            }),
          );
          const label = make('text', {
            x: rect.x + rect.w / 2,
            y: rect.y + rect.h * 0.6,
            'font-size': Math.max(9, rect.h * 0.3),
            'font-family': '"Bebas Neue", sans-serif',
            fill: '#9c1220',
            'text-anchor': 'middle',
          });
          label.textContent = layer.stickerLine;
          group.append(label);
        }
        svg.append(group);
      }
    },
    destroy(): void {
      while (svg.firstChild !== null) svg.firstChild.remove();
    },
  };
}

export function packScreenRect(camera: Camera, format: PackFormat): Rect {
  const size = PACK_SIZES[format];
  const corners: Point[] = [];
  for (const x of [-size.w / 2, size.w / 2]) {
    for (const y of [-size.h / 2, size.h / 2 + size.neck]) {
      for (const z of [-size.d / 2, size.d / 2]) {
        corners.push(project(camera, x, y, z));
      }
    }
  }
  return boundingRect(corners);
}
