import { Mat4, icosphere } from '../../shared/graph';

const VERTEX_SHADER = `
attribute vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
varying float v_depth;
void main() {
  vec4 eye = u_view * u_model * vec4(a_position, 1.0);
  v_depth = -eye.z;
  gl_Position = u_projection * eye;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 u_color;
uniform float u_opacity;
uniform float u_fog_near;
uniform float u_fog_far;
uniform vec3 u_fog_color;
varying float v_depth;
void main() {
  float fog = clamp((v_depth - u_fog_near) / (u_fog_far - u_fog_near), 0.0, 1.0);
  vec3 colour = mix(u_color, u_fog_color, fog);
  gl_FragColor = vec4(colour, u_opacity);
}
`;

export type DrawNode = { model: Mat4; colour: [number, number, number]; opacity: number };

export type DrawLines = {
  vertices: Float32Array;
  model: Mat4;
  colour: [number, number, number];
  opacity: number;
};

export type Scene = {
  view: Mat4;
  projection: Mat4;
  fogNear: number;
  fogFar: number;
  fogColour: [number, number, number];
  paper: [number, number, number];
  nodes: DrawNode[];
  lineBatches: DrawLines[];
};

/** One indexed triangle draw per visible node and one line draw per batch. */
export class GraphRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly sphereBuffer: WebGLBuffer;
  private readonly sphereIndices: WebGLBuffer;
  private readonly sphereIndexCount: number;
  private readonly lineBuffer: WebGLBuffer;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly positionLocation: number;
  drawCalls = 0;

  constructor(canvas: HTMLCanvasElement) {
    const context =
      (canvas.getContext('webgl2') as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (context === null) throw new Error('no webgl context');
    this.gl = context;
    const gl = this.gl;
    const vertex = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (program === null) throw new Error('no program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    this.program = program;
    gl.useProgram(program);
    this.positionLocation = gl.getAttribLocation(program, 'a_position');
    this.uniforms = {
      u_model: gl.getUniformLocation(program, 'u_model'),
      u_view: gl.getUniformLocation(program, 'u_view'),
      u_projection: gl.getUniformLocation(program, 'u_projection'),
      u_opacity: gl.getUniformLocation(program, 'u_opacity'),
      u_color: gl.getUniformLocation(program, 'u_color'),
      u_fog_near: gl.getUniformLocation(program, 'u_fog_near'),
      u_fog_far: gl.getUniformLocation(program, 'u_fog_far'),
      u_fog_color: gl.getUniformLocation(program, 'u_fog_color'),
    };
    const sphere = icosphere(2);
    const positions = gl.createBuffer();
    const indices = gl.createBuffer();
    if (positions === null || indices === null) throw new Error('no buffers');
    this.sphereBuffer = positions;
    this.sphereIndices = indices;
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
    this.sphereIndexCount = sphere.indices.length;
    const lines = gl.createBuffer();
    if (lines === null) throw new Error('no line buffer');
    this.lineBuffer = lines;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (shader === null) throw new Error('no shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
    }
    return shader;
  }

  resize(width: number, height: number, ratio: number): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  draw(scene: Scene): void {
    const gl = this.gl;
    this.drawCalls = 0;
    gl.useProgram(this.program);
    gl.clearColor(scene.paper[0], scene.paper[1], scene.paper[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.uniforms['u_view'], false, scene.view);
    gl.uniformMatrix4fv(this.uniforms['u_projection'], false, scene.projection);
    gl.uniform1f(this.uniforms['u_fog_near'], scene.fogNear);
    gl.uniform1f(this.uniforms['u_fog_far'], scene.fogFar);
    gl.uniform3fv(this.uniforms['u_fog_color'], scene.fogColour);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIndices);
    for (const node of scene.nodes) {
      gl.uniformMatrix4fv(this.uniforms['u_model'], false, node.model);
      gl.uniform3fv(this.uniforms['u_color'], node.colour);
      gl.uniform1f(this.uniforms['u_opacity'], node.opacity);
      gl.drawElements(gl.TRIANGLES, this.sphereIndexCount, gl.UNSIGNED_SHORT, 0);
      this.drawCalls += 1;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);
    for (const batch of scene.lineBatches) {
      if (batch.vertices.length === 0) continue;
      gl.bufferData(gl.ARRAY_BUFFER, batch.vertices, gl.DYNAMIC_DRAW);
      gl.uniformMatrix4fv(this.uniforms['u_model'], false, batch.model);
      gl.uniform3fv(this.uniforms['u_color'], batch.colour);
      gl.uniform1f(this.uniforms['u_opacity'], batch.opacity);
      gl.drawArrays(gl.LINES, 0, batch.vertices.length / 3);
      this.drawCalls += 1;
    }
  }
}

/** The projected point of a position, for labels and picking. */
export function project(
  position: [number, number, number],
  view: Mat4,
  projection: Mat4,
  width: number,
  height: number,
): { x: number; y: number; depth: number; visible: boolean } {
  const eye = multiply(view, [position[0], position[1], position[2], 1]);
  const clip = multiply(projection, eye);
  const depth = -eye[2];
  if (clip[3] === 0) return { x: 0, y: 0, depth, visible: false };
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  return {
    x: ((ndcX + 1) / 2) * width,
    y: ((1 - ndcY) / 2) * height,
    depth,
    visible: depth > 0 && ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1,
  };
}

function multiply(matrix: Mat4, vector: [number, number, number, number]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    out[row] =
      matrix[row] * vector[0] +
      matrix[4 + row] * vector[1] +
      matrix[8 + row] * vector[2] +
      matrix[12 + row] * vector[3];
  }
  return out;
}
