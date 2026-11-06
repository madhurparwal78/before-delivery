import {
  add,
  cross,
  dot,
  identity,
  length,
  lookAt,
  multiply,
  normalise,
  perspective,
  project,
  scale,
  sub,
  frameMatrix,
  type Mat4,
  type Vec3,
} from './glmath.js';
import {
  COURIER_HEIGHT_M,
  HOME_HEIGHT_M,
  MeshBuilder,
  courierMesh,
  courierOutline,
  depotMesh,
  homeMesh,
  parcelMesh,
  planetMesh,
  surfaceFrame,
  type MeshData,
} from './geometry.js';
import { bearingDirection, tangentBasis, type CameraPose } from './cameras.js';
import { cloudSheet, emoteSheet, scrapSheet, tagSheet } from './textures.js';
import { gl3, palette, satchelRgb, type Rgb } from '../palette.js';

const SCENE_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColour;
uniform mat4 uViewProjection;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vColour;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  gl_Position = uViewProjection * world;
  vNormal = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;
  vColour = aColour;
}`;

const SCENE_FRAGMENT = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColour;
uniform vec3 uLight;
uniform float uFlat;
uniform float uAlpha;
void main() {
  if (uFlat > 0.5) {
    gl_FragColor = vec4(vColour, uAlpha);
    return;
  }
  float lambert = dot(normalize(vNormal), uLight);
  float band = lambert > 0.45 ? 1.0 : (lambert > 0.02 ? 0.88 : 0.74);
  gl_FragColor = vec4(vColour * band, uAlpha);
}`;

const SKY_VERTEX = `
attribute vec2 aCorner;
varying vec2 vScreen;
void main() {
  vScreen = aCorner;
  gl_Position = vec4(aCorner, 0.999, 1.0);
}`;

const SKY_FRAGMENT = `
precision mediump float;
varying vec2 vScreen;
uniform float uHorizon;
uniform vec3 uHigh;
uniform vec3 uWarm;
void main() {
  float warmth = 1.0 - smoothstep(uHorizon - 0.25, uHorizon + 0.55, vScreen.y);
  gl_FragColor = vec4(mix(uHigh, uWarm, clamp(warmth, 0.0, 1.0)), 1.0);
}`;

const SPRITE_VERTEX = `
attribute vec2 aCorner;
uniform mat4 uViewProjection;
uniform vec3 uCentre;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vec3 world = uCentre + uRight * (aCorner.x * uSize.x) + uUp * (aCorner.y * uSize.y);
  gl_Position = uViewProjection * vec4(world, 1.0);
  vUv = vec2(aCorner.x * 0.5 + 0.5, 0.5 - aCorner.y * 0.5);
}`;

const SPRITE_FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSheet;
uniform float uAlpha;
void main() {
  vec4 sampled = texture2D(uSheet, vUv);
  gl_FragColor = vec4(sampled.rgb, sampled.a * uAlpha);
}`;

function compile(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const build = (kind: number, source: string): WebGLShader => {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, build(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, build(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  return program;
}

interface Buffers {
  positions: WebGLBuffer;
  normals: WebGLBuffer;
  colours: WebGLBuffer;
  count: number;
}

export interface Figure {
  unit: Vec3;
  headingDeg: number;
  satchelColour: string;
  tag: string | null;
  emote: string | null;
  alpha: number;
  carrying: 'none' | 'standard' | 'rush';
}

export interface RibbonDraw {
  tail: Vec3;
  head: Vec3;
  from: number;
  to: number;
  alpha: number;
}

export interface SceneFrame {
  camera: CameraPose;
  self: Figure;
  others: Figure[];
  ribbon: RibbonDraw | null;
  cloudDeg: number;
  scrapSeconds: number;
}

export interface DrawnFrame {
  viewProjection: Mat4;
  width: number;
  height: number;
}

const RIBBON_SEGMENTS = 96;
const CLOUD_COUNT = 14;
const CLOUD_RING_RADIUS_M = 82;
const SCRAP_COUNT = 22;

export class Renderer {
  readonly available: boolean;
  private readonly gl: WebGLRenderingContext | null;
  private readonly canvas: HTMLCanvasElement;
  private sceneProgram!: WebGLProgram;
  private skyProgram!: WebGLProgram;
  private spriteProgram!: WebGLProgram;
  private planet!: Buffers;
  private planetRim!: Buffers;
  private structures!: Buffers;
  private structureRim!: Buffers;
  private parcels = new Map<string, Buffers>();
  private figureMeshes = new Map<string, { body: Buffers; outline: Buffers }>();
  private ribbonBuffers!: Buffers;
  private quad!: WebGLBuffer;
  private sheets = new Map<string, WebGLTexture>();
  private radiusM = 60;
  private obstacleUnits: Vec3[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context =
      canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true }) ??
      canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
    this.gl = (context as WebGLRenderingContext | null) ?? null;
    this.available = this.gl !== null;
  }

  /** Builds every shape from code: the planet, the homes, the depot and the figures. */
  start(radiusM: number, homes: Vec3[], depot: Vec3): void {
    const gl = this.gl;
    if (gl === null) return;
    this.radiusM = radiusM;
    this.obstacleUnits = homes;
    this.sceneProgram = compile(gl, SCENE_VERTEX, SCENE_FRAGMENT);
    this.skyProgram = compile(gl, SKY_VERTEX, SKY_FRAGMENT);
    this.spriteProgram = compile(gl, SPRITE_VERTEX, SPRITE_FRAGMENT);

    const { surface, rim } = planetMesh(radiusM);
    this.planet = this.upload(surface);
    this.planetRim = this.upload(rim);

    const builder = new MeshBuilder();
    for (const home of homes) {
      const centre = this.homeCentre(home);
      homeMesh(surfaceFrame(centre, radiusM), builder);
    }
    depotMesh(surfaceFrame(this.standOffset(depot, 3), radiusM), builder);
    this.structures = this.upload(builder.data());
    this.structureRim = this.upload(builder.outline(0.02, palette.ink));

    this.ribbonBuffers = this.upload({
      positions: new Float32Array((RIBBON_SEGMENTS + 1) * 6),
      normals: new Float32Array((RIBBON_SEGMENTS + 1) * 6),
      colours: new Float32Array((RIBBON_SEGMENTS + 1) * 6),
      count: (RIBBON_SEGMENTS + 1) * 2,
    });

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** A home stands just behind its door, so the route's end stays in the open. */
  homeCentre(doorUnit: Vec3): Vec3 {
    return this.standOffset(doorUnit, 1.3);
  }

  private standOffset(unit: Vec3, metres: number): Vec3 {
    const north = bearingDirection(unit, 0);
    const angle = metres / this.radiusM;
    return normalise(add(scale(normalise(unit), Math.cos(angle)), scale(north, Math.sin(angle))));
  }

  private upload(mesh: MeshData): Buffers {
    const gl = this.gl!;
    const make = (data: Float32Array): WebGLBuffer => {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      return buffer;
    };
    return {
      positions: make(mesh.positions),
      normals: make(mesh.normals),
      colours: make(mesh.colours),
      count: mesh.count,
    };
  }

  private sheet(key: string, draw: () => HTMLCanvasElement): WebGLTexture {
    const gl = this.gl!;
    const known = this.sheets.get(key);
    if (known) return known;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, draw());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.sheets.set(key, texture);
    return texture;
  }

  private figureFor(colour: string): { body: Buffers; outline: Buffers } {
    const known = this.figureMeshes.get(colour);
    if (known) return known;
    const made = {
      body: this.upload(courierMesh(satchelRgb(colour))),
      outline: this.upload(courierOutline(satchelRgb(colour))),
    };
    this.figureMeshes.set(colour, made);
    return made;
  }

  private parcelFor(kind: 'standard' | 'rush'): Buffers {
    const known = this.parcels.get(kind);
    if (known) return known;
    const made = this.upload(parcelMesh(kind === 'rush'));
    this.parcels.set(kind, made);
    return made;
  }

  private fixedSize: { width: number; height: number } | null = null;

  /** Fixes the drawing size while a postcard is captured. */
  setFixedSize(size: { width: number; height: number } | null): void {
    this.fixedSize = size;
  }

  resize(): { width: number; height: number } {
    if (this.fixedSize !== null) {
      this.canvas.width = this.fixedSize.width;
      this.canvas.height = this.fixedSize.height;
      return this.fixedSize;
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    return { width, height };
  }

  /** Only the attributes a program reads stay enabled, so no stale array is validated. */
  private onlyAttributes(count: number): void {
    const gl = this.gl!;
    for (let location = 0; location < 4; location += 1) {
      if (location < count) gl.enableVertexAttribArray(location);
      else gl.disableVertexAttribArray(location);
    }
  }

  private bind(program: WebGLProgram, buffers: Buffers): void {
    const gl = this.gl!;
    this.onlyAttributes(0);
    for (const [name, buffer] of [
      ['aPosition', buffers.positions],
      ['aNormal', buffers.normals],
      ['aColour', buffers.colours],
    ] as const) {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    }
  }

  private drawMesh(
    buffers: Buffers,
    model: Mat4,
    viewProjection: Mat4,
    light: Vec3,
    options: { flat?: boolean; alpha?: number; cull?: number } = {},
  ): void {
    const gl = this.gl!;
    gl.useProgram(this.sceneProgram);
    this.bind(this.sceneProgram, buffers);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sceneProgram, 'uViewProjection'), false, viewProjection);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.sceneProgram, 'uModel'), false, model);
    gl.uniform3f(gl.getUniformLocation(this.sceneProgram, 'uLight'), light[0], light[1], light[2]);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, 'uFlat'), options.flat ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, 'uAlpha'), options.alpha ?? 1);
    gl.cullFace(options.cull ?? gl.BACK);
    gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
    gl.cullFace(gl.BACK);
  }

  private drawSprite(
    texture: WebGLTexture,
    centre: Vec3,
    right: Vec3,
    up: Vec3,
    size: [number, number],
    viewProjection: Mat4,
    alpha: number,
  ): void {
    const gl = this.gl!;
    gl.useProgram(this.spriteProgram);
    const corner = gl.getAttribLocation(this.spriteProgram, 'aCorner');
    this.onlyAttributes(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.spriteProgram, 'uViewProjection'), false, viewProjection);
    gl.uniform3f(gl.getUniformLocation(this.spriteProgram, 'uCentre'), centre[0], centre[1], centre[2]);
    gl.uniform3f(gl.getUniformLocation(this.spriteProgram, 'uRight'), right[0], right[1], right[2]);
    gl.uniform3f(gl.getUniformLocation(this.spriteProgram, 'uUp'), up[0], up[1], up[2]);
    gl.uniform2f(gl.getUniformLocation(this.spriteProgram, 'uSize'), size[0], size[1]);
    gl.uniform1f(gl.getUniformLocation(this.spriteProgram, 'uAlpha'), alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(this.spriteProgram, 'uSheet'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private figureModel(figure: Figure): Mat4 {
    const up = normalise(figure.unit);
    const heading = bearingDirection(up, figure.headingDeg);
    const right = normalise(cross(up, heading));
    return frameMatrix(right, up, heading, scale(up, this.radiusM));
  }

  private writeRibbon(draw: RibbonDraw, camera: CameraPose, height: number): number {
    const gl = this.gl!;
    const tail = normalise(draw.tail);
    const head = normalise(draw.head);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(tail, head))));
    const positions = new Float32Array((RIBBON_SEGMENTS + 1) * 6);
    const normals = new Float32Array((RIBBON_SEGMENTS + 1) * 6);
    const colours = new Float32Array((RIBBON_SEGMENTS + 1) * 6);
    const [red, green, blue] = gl3(palette.routeTeal);
    const metresPerPixel = (depth: number): number =>
      (2 * depth * Math.tan(((camera.fovDeg * Math.PI) / 180) / 2)) / Math.max(1, height);
    const sinAngle = Math.sin(angle);
    for (let step = 0; step <= RIBBON_SEGMENTS; step += 1) {
      const along = draw.from + (draw.to - draw.from) * (step / RIBBON_SEGMENTS);
      const point =
        sinAngle < 1e-6
          ? tail
          : normalise(
              add(
                scale(tail, Math.sin((1 - along) * angle) / sinAngle),
                scale(head, Math.sin(along * angle) / sinAngle),
              ),
            );
      const forward =
        sinAngle < 1e-6 ? bearingDirection(point, 0) : normalise(sub(head, scale(point, dot(head, point))));
      const side = normalise(cross(point, forward));
      const surface = scale(point, this.radiusM + 0.18);
      const depth = Math.max(0.5, length(sub(surface, camera.eye)));
      const half = Math.max(0.09, 3 * metresPerPixel(depth));
      for (const [index, sign] of [[0, -1], [1, 1]] as const) {
        const vertex = add(surface, scale(side, sign * half));
        const base = step * 6 + index * 3;
        positions[base] = vertex[0];
        positions[base + 1] = vertex[1];
        positions[base + 2] = vertex[2];
        normals[base] = point[0];
        normals[base + 1] = point[1];
        normals[base + 2] = point[2];
        colours[base] = red;
        colours[base + 1] = green;
        colours[base + 2] = blue;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffers.positions);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffers.normals);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffers.colours);
    gl.bufferData(gl.ARRAY_BUFFER, colours, gl.DYNAMIC_DRAW);
    return (RIBBON_SEGMENTS + 1) * 2;
  }

  draw(frame: SceneFrame): DrawnFrame {
    const gl = this.gl;
    const { width, height } = this.resize();
    const projection = perspective(frame.camera.fovDeg, width / height, 0.3, 1200);
    const view = lookAt(frame.camera.eye, frame.camera.target, frame.camera.up);
    const viewProjection = multiply(projection, view);
    if (gl === null) return { viewProjection, width, height };

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const centre = project(viewProjection, [0, 0, 0], width, height);
    gl.useProgram(this.skyProgram);
    gl.disable(gl.DEPTH_TEST);
    const corner = gl.getAttribLocation(this.skyProgram, 'aCorner');
    this.onlyAttributes(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'uHorizon'), 0);
    const high = gl3(palette.skyHigh);
    const warm = gl3(palette.skyWarm);
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uHigh'), high[0], high[1], high[2]);
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uWarm'), warm[0], warm[1], warm[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST);

    const light = normalise([0.45, 0.8, 0.4]);
    const model = identity();
    this.drawMesh(this.planetRim, model, viewProjection, light, { flat: true, cull: gl.FRONT });
    this.drawMesh(this.planet, model, viewProjection, light);
    this.drawMesh(this.structureRim, model, viewProjection, light, { flat: true, cull: gl.FRONT });
    this.drawMesh(this.structures, model, viewProjection, light);

    if (frame.ribbon !== null && frame.ribbon.to > frame.ribbon.from && frame.ribbon.alpha > 0) {
      const count = this.writeRibbon(frame.ribbon, frame.camera, height);
      gl.useProgram(this.sceneProgram);
      this.bind(this.sceneProgram, this.ribbonBuffers);
      gl.uniformMatrix4fv(
        gl.getUniformLocation(this.sceneProgram, 'uViewProjection'),
        false,
        viewProjection,
      );
      gl.uniformMatrix4fv(gl.getUniformLocation(this.sceneProgram, 'uModel'), false, model);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, 'uFlat'), 1);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, 'uAlpha'), frame.ribbon.alpha);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
      gl.enable(gl.CULL_FACE);
    }

    for (const figure of [frame.self, ...frame.others]) {
      const meshes = this.figureFor(figure.satchelColour);
      const figureModel = this.figureModel(figure);
      this.drawMesh(meshes.outline, figureModel, viewProjection, light, {
        flat: true,
        alpha: figure.alpha,
        cull: gl.FRONT,
      });
      this.drawMesh(meshes.body, figureModel, viewProjection, light, { alpha: figure.alpha });
      if (figure.carrying !== 'none') {
        this.drawMesh(this.parcelFor(figure.carrying), figureModel, viewProjection, light, {
          alpha: figure.alpha,
        });
      }
    }

    const toEye = (point: Vec3): { right: Vec3; up: Vec3 } => {
      const forward = normalise(sub(frame.camera.eye, point));
      const right = normalise(cross(frame.camera.up, forward));
      return { right, up: normalise(cross(forward, right)) };
    };

    for (const figure of frame.others) {
      const head = scale(normalise(figure.unit), this.radiusM + COURIER_HEIGHT_M + 0.25);
      const axes = toEye(head);
      if (figure.tag !== null) {
        const canvas = tagSheet(figure.tag);
        const texture = this.sheet(`tag:${figure.tag}`, () => canvas);
        const halfHeight = 0.13;
        const halfWidth = (canvas.width / canvas.height) * halfHeight;
        this.drawSprite(
          texture,
          head,
          axes.right,
          axes.up,
          [halfWidth, halfHeight],
          viewProjection,
          figure.alpha,
        );
      }
      if (figure.emote !== null) {
        const bubble = scale(normalise(figure.unit), this.radiusM + COURIER_HEIGHT_M + 0.72);
        const bubbleAxes = toEye(bubble);
        this.drawSprite(
          this.sheet(`emote:${figure.emote}`, () => emoteSheet(figure.emote!)),
          bubble,
          bubbleAxes.right,
          bubbleAxes.up,
          [0.28, 0.33],
          viewProjection,
          figure.alpha,
        );
      }
    }
    if (frame.self.emote !== null) {
      const bubble = scale(normalise(frame.self.unit), this.radiusM + COURIER_HEIGHT_M + 0.72);
      const axes = toEye(bubble);
      this.drawSprite(
        this.sheet(`emote:${frame.self.emote}`, () => emoteSheet(frame.self.emote!)),
        bubble,
        axes.right,
        axes.up,
        [0.28, 0.33],
        viewProjection,
        1,
      );
    }

    const cloudTexture = this.sheet('cloud', cloudSheet);
    const tilt = tangentBasis([1, 0.25, 0]);
    for (let index = 0; index < CLOUD_COUNT; index += 1) {
      const angle = ((frame.cloudDeg + (index * 360) / CLOUD_COUNT) * Math.PI) / 180;
      const wobble = Math.sin(index * 2.3) * 14;
      const unit = normalise(
        add(
          add(scale(tilt.east, Math.cos(angle)), scale(tilt.north, Math.sin(angle))),
          [0, Math.sin(index * 1.7) * 0.35, 0],
        ),
      );
      const centrePoint = scale(unit, CLOUD_RING_RADIUS_M + wobble);
      const axes = toEye(centrePoint);
      this.drawSprite(cloudTexture, centrePoint, axes.right, axes.up, [7, 3.5], viewProjection, 0.95);
    }

    const scrapTexture = this.sheet('scrap', scrapSheet);
    for (let index = 0; index < SCRAP_COUNT; index += 1) {
      const drift = frame.scrapSeconds * (0.04 + (index % 5) * 0.012);
      const angle = index * 1.31 + drift;
      const lift = Math.sin(index * 0.9 + drift * 1.6) * 0.5;
      const unit = normalise([Math.cos(angle), lift, Math.sin(angle * 1.07 + 1.3)]);
      const centrePoint = scale(unit, 64 + ((index * 7) % 40));
      const axes = toEye(centrePoint);
      this.drawSprite(scrapTexture, centrePoint, axes.right, axes.up, [1.4, 1.4], viewProjection, 0.9);
    }

    return { viewProjection, width, height };
  }

  obstacles(): Array<{ unit: Vec3; footprintM: number; heightM: number }> {
    return this.obstacleUnits.map((unit) => ({
      unit: this.homeCentre(unit),
      footprintM: 1.3,
      heightM: HOME_HEIGHT_M,
    }));
  }
}
