// Raw WebGL for the link graph: one program, a procedural unit icosphere and a dynamic line buffer.
// Every draw sets all eight published uniforms; nothing here draws unless asked.

import type { Mat4 } from '../../shared/camera.ts';

type GL = WebGL2RenderingContext | WebGLRenderingContext;
export type Rgb3 = readonly [number, number, number];

/** Inputs shared by every draw of one frame. */
export interface FrameUniforms {
  view: Float32Array;
  projection: Float32Array;
  fogNear: number;
  fogFar: number;
  fogColor: Rgb3;
}

const VERTEX = `
attribute vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
varying float v_depth;
void main() {
  vec4 eye = u_view * u_model * vec4(a_position, 1.0);
  v_depth = -eye.z;
  gl_Position = u_projection * eye;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_color;
uniform float u_opacity;
uniform float u_fog_near;
uniform float u_fog_far;
uniform vec3 u_fog_color;
varying float v_depth;
void main() {
  float f = clamp((v_depth - u_fog_near) / (u_fog_far - u_fog_near), 0.0, 1.0);
  gl_FragColor = vec4(mix(u_color, u_fog_color, f), u_opacity);
}`;

const ICOSPHERE_SUBDIVISIONS = 2;

/** A unit icosphere: the icosahedron with each triangle split in four, `levels` times. */
export function icosphere(levels: number): { vertices: Float32Array; indices: Uint16Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const points: Array<[number, number, number]> = [];
  const add = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    points.push([x / l, y / l, z / l]);
    return points.length - 1;
  };
  for (const [x, y, z] of [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ] as const) add(x, y, z);
  let faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let level = 0; level < levels; level++) {
    const cache = new Map<string, number>();
    const middle = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const pa = points[a];
      const pb = points[b];
      const i = add((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2);
      cache.set(key, i);
      return i;
    };
    const next: Array<[number, number, number]> = [];
    for (const [a, b, c] of faces) {
      const ab = middle(a, b);
      const bc = middle(b, c);
      const ca = middle(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { vertices: new Float32Array(points.flat()), indices: new Uint16Array(faces.flat()) };
}

function compile(gl: GL, kind: number, source: string): WebGLShader | null {
  const shader = gl.createShader(kind);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

interface Locations {
  model: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  projection: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  fogNear: WebGLUniformLocation | null;
  fogFar: WebGLUniformLocation | null;
  fogColor: WebGLUniformLocation | null;
}

export class GraphScene {
  private readonly gl: GL;
  private readonly position: number;
  private readonly u: Locations;
  private readonly sphereVertices: WebGLBuffer | null;
  private readonly sphereIndices: WebGLBuffer | null;
  private readonly sphereCount: number;
  private readonly lineBuffer: WebGLBuffer | null;

  /** WebGL 2, else WebGL 1; null when neither context (or the program) can be made. */
  static create(canvas: HTMLCanvasElement): GraphScene | null {
    const options: WebGLContextAttributes = { antialias: true, depth: true, alpha: false, premultipliedAlpha: false };
    const gl = (canvas.getContext('webgl2', options) as WebGL2RenderingContext | null) ?? (canvas.getContext('webgl', options) as WebGLRenderingContext | null);
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new GraphScene(gl, program);
  }

  private constructor(gl: GL, program: WebGLProgram) {
    this.gl = gl;
    gl.useProgram(program);
    this.position = gl.getAttribLocation(program, 'a_position');
    const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    this.u = {
      model: at('u_model'), view: at('u_view'), projection: at('u_projection'), opacity: at('u_opacity'), color: at('u_color'),
      fogNear: at('u_fog_near'), fogFar: at('u_fog_far'), fogColor: at('u_fog_color'),
    };
    const sphere = icosphere(ICOSPHERE_SUBDIVISIONS);
    this.sphereVertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereVertices);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.vertices, gl.STATIC_DRAW);
    this.sphereIndices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIndices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
    this.sphereCount = sphere.indices.length;
    this.lineBuffer = gl.createBuffer();
    gl.enableVertexAttribArray(this.position);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  /** Sizes the drawing buffer, sets the viewport and clears to the paper colour. */
  begin(width: number, height: number, paper: Rgb3): void {
    const gl = this.gl;
    const canvas = gl.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(paper[0], paper[1], paper[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  private uniforms(frame: FrameUniforms, model: Mat4, color: Rgb3, opacity: number): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.model, false, new Float32Array(model));
    gl.uniformMatrix4fv(this.u.view, false, frame.view);
    gl.uniformMatrix4fv(this.u.projection, false, frame.projection);
    gl.uniform1f(this.u.opacity, opacity);
    gl.uniform3f(this.u.color, color[0], color[1], color[2]);
    gl.uniform1f(this.u.fogNear, frame.fogNear);
    gl.uniform1f(this.u.fogFar, frame.fogFar);
    gl.uniform3f(this.u.fogColor, frame.fogColor[0], frame.fogColor[1], frame.fogColor[2]);
  }

  /** One indexed triangle draw of the unit icosphere. */
  sphere(frame: FrameUniforms, model: Mat4, color: Rgb3, opacity: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereVertices);
    gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIndices);
    this.uniforms(frame, model, color, opacity);
    gl.drawElements(gl.TRIANGLES, this.sphereCount, gl.UNSIGNED_SHORT, 0);
  }

  /** One line draw of `vertices.length / 3` vertices. */
  lines(frame: FrameUniforms, vertices: Float32Array, model: Mat4, color: Rgb3, opacity: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 0, 0);
    this.uniforms(frame, model, color, opacity);
    gl.drawArrays(gl.LINES, 0, vertices.length / 3);
  }
}
