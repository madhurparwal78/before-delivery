import type { Mesh } from './glb.js';
import { palette, hexToRgb } from '../shared/palette.js';

const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 viewProjection;
varying vec3 vNormal;
void main() {
  vNormal = normal;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 material;
uniform vec3 light;
varying vec3 vNormal;
void main() {
  float lambert = abs(dot(normalize(vNormal), light));
  gl_FragColor = vec4(material * (0.5 + 0.5 * lambert), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('Shader could not be created');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

export function perspective(fovDegrees: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  up: readonly [number, number, number],
): Float32Array {
  const fx = target[0] - eye[0];
  const fy = target[1] - eye[1];
  const fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = [fx / fl, fy / fl, fz / fl] as const;
  let sx = f[1] * up[2] - f[2] * up[1];
  let sy = f[2] * up[0] - f[0] * up[2];
  let sz = f[0] * up[1] - f[1] * up[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl;
  sy /= sl;
  sz /= sl;
  const ux = sy * f[2] - sz * f[1];
  const uy = sz * f[0] - sx * f[2];
  const uz = sx * f[1] - sy * f[0];
  return new Float32Array([
    sx, ux, -f[0], 0,
    sy, uy, -f[1], 0,
    sz, uz, -f[2], 0,
    -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
    -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
    f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
    1,
  ]);
}

export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export interface Renderer {
  draw(
    eye: readonly [number, number, number],
    target: readonly [number, number, number],
    fovDegrees: number,
  ): void;
  resize(): void;
}

/** Returns null when the browser refuses a hardware-accelerated 3D context. */
export function createRenderer(canvas: HTMLCanvasElement, mesh: Mesh): Renderer | null {
  const gl =
    canvas.getContext('webgl', { antialias: true, failIfMajorPerformanceCaveat: true }) ??
    canvas.getContext('experimental-webgl', { antialias: true });
  if (gl === null || !(gl instanceof WebGLRenderingContext)) return null;

  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  gl.useProgram(program);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
  const normalLocation = gl.getAttribLocation(program, 'normal');
  gl.enableVertexAttribArray(normalLocation);
  gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

  const viewProjection = gl.getUniformLocation(program, 'viewProjection');
  const [mr, mg, mb] = hexToRgb(palette.material);
  gl.uniform3f(gl.getUniformLocation(program, 'material'), mr / 255, mg / 255, mb / 255);
  const lightLength = Math.hypot(-0.4, 0.78, 0.48);
  gl.uniform3f(
    gl.getUniformLocation(program, 'light'),
    -0.4 / lightLength,
    0.78 / lightLength,
    0.48 / lightLength,
  );

  const [br, bg, bb] = hexToRgb(palette.bone);
  gl.clearColor(br / 255, bg / 255, bb / 255, 1);
  gl.enable(gl.DEPTH_TEST);

  const vertexCount = mesh.positions.length / 3;

  const resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  return {
    resize,
    draw(eye, target, fovDegrees): void {
      resize();
      const aspect = canvas.width / Math.max(1, canvas.height);
      const span = Math.hypot(
        mesh.max[0] - mesh.min[0],
        mesh.max[1] - mesh.min[1],
        mesh.max[2] - mesh.min[2],
      );
      const distance = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
      const projection = perspective(
        fovDegrees,
        aspect,
        Math.max(1e-4, (distance + span) / 1000),
        (distance + span) * 4,
      );
      gl.uniformMatrix4fv(
        viewProjection,
        false,
        multiplyMatrices(projection, lookAt(eye, target, [0, 1, 0])),
      );
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    },
  };
}
