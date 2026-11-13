import { cameraPosition, type Shard } from './geometry.js';

const VERTEX_SHADER = `
attribute vec3 aCentre;
attribute vec3 aSettled;
attribute vec2 aCorner;
attribute float aTilt;
uniform mat4 uProjection;
uniform mat4 uView;
uniform float uSettle;
uniform float uSway;
varying float vShade;

mat2 rotate2(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

void main() {
  vec3 centre = mix(aCentre, aSettled, uSettle);
  float s = sin(uSway);
  float c = cos(uSway);
  vec3 swayed = vec3(centre.x * c + centre.z * s, centre.y, -centre.x * s + centre.z * c);
  vec4 eye = uView * vec4(swayed, 1.0);
  vec2 corner = rotate2(aTilt) * aCorner;
  eye.xy += corner;
  vShade = clamp(0.45 + 0.55 * (1.0 - abs(centre.z) / 2.4), 0.2, 1.0);
  gl_Position = uProjection * eye;
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColour;
varying float vShade;
void main() {
  gl_FragColor = vec4(uColour * vShade, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function perspective(fovRadians: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovRadians / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * range * 2, 0,
  ]);
}

function lookAt(eye: [number, number, number], target: [number, number, number]): Float32Array {
  const forward: [number, number, number] = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  const flen = Math.hypot(...forward);
  const z: [number, number, number] = [forward[0] / flen, forward[1] / flen, forward[2] / flen];
  const upHint: [number, number, number] = [0, 1, 0];
  const xRaw: [number, number, number] = [
    upHint[1] * z[2] - upHint[2] * z[1],
    upHint[2] * z[0] - upHint[0] * z[2],
    upHint[0] * z[1] - upHint[1] * z[0],
  ];
  const xlen = Math.hypot(...xRaw) || 1;
  const x: [number, number, number] = [xRaw[0] / xlen, xRaw[1] / xlen, xRaw[2] / xlen];
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

export interface SceneHandle {
  draw: (state: { yaw: number; settle: number; sway: number }) => void;
  dispose: () => void;
}

const SHARD_COLOUR: [number, number, number] = [0.95, 0.925, 0.878];

export function createScene(canvas: HTMLCanvasElement, shards: Shard[]): SceneHandle | null {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const triangles = shards.length * 3;
  const centres = new Float32Array(triangles * 3);
  const settled = new Float32Array(triangles * 3);
  const corners = new Float32Array(triangles * 2);
  const tilts = new Float32Array(triangles);
  shards.forEach((shard, index) => {
    const outline: [number, number][] = [
      [0, shard.size],
      [-shard.size * 0.9, -shard.size * 0.7],
      [shard.size * 0.95, -shard.size * 0.6],
    ];
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = index * 3 + corner;
      centres.set(shard.position, slot * 3);
      settled.set(shard.target, slot * 3);
      corners.set(outline[corner] as [number, number], slot * 2);
      tilts[slot] = shard.tilt;
    }
  });

  const attribute = (name: string, data: Float32Array, size: number): void => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  attribute('aCentre', centres, 3);
  attribute('aSettled', settled, 3);
  attribute('aCorner', corners, 2);
  attribute('aTilt', tilts, 1);

  const uProjection = gl.getUniformLocation(program, 'uProjection');
  const uView = gl.getUniformLocation(program, 'uView');
  const uSettle = gl.getUniformLocation(program, 'uSettle');
  const uSway = gl.getUniformLocation(program, 'uSway');
  gl.uniform3fv(gl.getUniformLocation(program, 'uColour'), SHARD_COLOUR);
  gl.clearColor(0.039, 0.043, 0.031, 1);
  gl.enable(gl.DEPTH_TEST);

  return {
    draw: ({ yaw, settle, sway }) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uProjection, false, perspective(0.72, canvas.width / canvas.height, 0.1, 60));
      gl.uniformMatrix4fv(uView, false, lookAt(cameraPosition(yaw), [0, 0, 0]));
      gl.uniform1f(uSettle, settle);
      gl.uniform1f(uSway, sway);
      gl.drawArrays(gl.TRIANGLES, 0, triangles);
    },
    dispose: () => {
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

/** Draws one still viewpoint into a 2D canvas, for the no-motion radio group. */
export function renderViewpointStill(shards: Shard[], angle: number, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#0a0b08';
  context.fillRect(0, 0, width, height);
  const eye = cameraPosition(angle);
  const view = lookAt(eye, [0, 0, 0]);
  const projection = perspective(0.72, width / height, 0.1, 60);
  context.fillStyle = '#f2ece0';
  const at = (matrix: Float32Array, index: number): number => matrix[index] as number;
  for (const shard of shards) {
    const [x, y, z] = shard.position;
    const ex = at(view, 0) * x + at(view, 4) * y + at(view, 8) * z + at(view, 12);
    const ey = at(view, 1) * x + at(view, 5) * y + at(view, 9) * z + at(view, 13);
    const ez = at(view, 2) * x + at(view, 6) * y + at(view, 10) * z + at(view, 14);
    if (ez > -0.2) continue;
    const clipX = at(projection, 0) * ex;
    const clipY = at(projection, 5) * ey;
    const w = -ez;
    const screenX = ((clipX / w) * 0.5 + 0.5) * width;
    const screenY = (0.5 - (clipY / w) * 0.5) * height;
    const size = Math.max(1, (shard.size / w) * at(projection, 0) * width * 0.5);
    context.fillRect(screenX - size / 2, screenY - size / 2, size, size);
  }
  return canvas.toDataURL('image/png');
}
