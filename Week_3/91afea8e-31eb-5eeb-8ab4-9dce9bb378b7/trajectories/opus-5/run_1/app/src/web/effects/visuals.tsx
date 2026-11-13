/** Image ripple and the procedural 3D product viewer, each with its still fallback. */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from '../state.tsx';

function webglContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  try {
    return (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as
      | WebGLRenderingContext
      | null;
  } catch {
    return null;
  }
}

function compile(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const build = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true ? shader : null;
  };
  const vertex = build(gl.VERTEX_SHADER, vertexSource);
  const fragment = build(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (vertex === null || fragment === null || program === null) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? program : null;
}

const RIPPLE_VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const RIPPLE_FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D art;
uniform vec2 pointer;
uniform float strength;
uniform float time;
void main() {
  vec2 point = vec2(uv.x, 1.0 - uv.y);
  float distance = length(point - pointer);
  float wave = sin(distance * 34.0 - time * 7.0) * exp(-distance * 5.0) * strength;
  vec2 shift = normalize(point - pointer + 0.0001) * wave * 0.05;
  float fringe = 0.006 * strength;
  float red = texture2D(art, point + shift + vec2(fringe, 0.0)).r;
  float green = texture2D(art, point + shift).g;
  float blue = texture2D(art, point + shift - vec2(fringe, 0.0)).b;
  gl_FragColor = vec4(red, green, blue, 1.0);
}`;

/** A product image that ripples under the pointer, or scales, or stands still. */
export function ProductImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}): ReactNode {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const element = canvas.current;
    const picture = image.current;
    if (element === null || picture === null) return;
    const gl = webglContext(element);
    if (gl === null) {
      setWebgl(false);
      return;
    }
    const program = compile(gl, RIPPLE_VERTEX, RIPPLE_FRAGMENT);
    if (program === null) {
      setWebgl(false);
      return;
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'position');
    const texture = gl.createTexture();
    let ready = false;
    const upload = (): void => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
        ready = true;
      } catch {
        ready = false;
      }
    };
    if (picture.complete) upload();
    else picture.addEventListener('load', upload, { once: true });

    let pointer: [number, number] = [0.5, 0.5];
    let strength = 0;
    let frame = 0;
    const start = performance.now();
    const onMove = (event: PointerEvent): void => {
      const box = element.getBoundingClientRect();
      pointer = [
        (event.clientX - box.left) / Math.max(box.width, 1),
        (event.clientY - box.top) / Math.max(box.height, 1),
      ];
      strength = 1;
    };
    const onLeave = (): void => {
      strength = 0;
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);

    const draw = (): void => {
      frame = requestAnimationFrame(draw);
      if (!ready) return;
      const size = Math.max(1, Math.floor(element.clientWidth));
      if (element.width !== size) {
        element.width = size;
        element.height = size;
      }
      strength *= 0.975;
      gl.viewport(0, 0, element.width, element.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, 'art'), 0);
      gl.uniform2f(gl.getUniformLocation(program, 'pointer'), pointer[0], pointer[1]);
      gl.uniform1f(gl.getUniformLocation(program, 'strength'), strength);
      gl.uniform1f(
        gl.getUniformLocation(program, 'time'),
        (performance.now() - start) / 1000,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, src]);

  const scale = !reduced && !webgl && hovering ? 'scale(1.03)' : 'none';

  return (
    <span
      style={{ position: 'relative', display: 'block' }}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <img
        ref={image}
        src={src}
        alt={alt}
        className={className ?? 'card-art'}
        style={{ transform: scale, transition: 'transform 0.3s ease-out' }}
      />
      {!reduced && webgl ? (
        <canvas
          ref={canvas}
          aria-hidden="true"
          className={className ?? 'card-art'}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        />
      ) : null}
    </span>
  );
}

const MODEL_VERTEX = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 model;
uniform mat4 projection;
varying vec3 shade;
void main() {
  vec4 world = model * vec4(position, 1.0);
  vec3 lit = normalize((model * vec4(normal, 0.0)).xyz);
  float lambert = max(dot(lit, normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  shade = vec3(0.1, 0.18, 0.95) + lambert * vec3(0.9, 0.78, 0.05);
  gl_Position = projection * world;
}`;

const MODEL_FRAGMENT = `
precision mediump float;
varying vec3 shade;
void main() {
  gl_FragColor = vec4(shade, 1.0);
}`;

type Mesh = { vertices: number[]; normals: number[] };

/** A stack of tiers, drawn from code so there is no model file to load. */
function buildModel(seed: number): Mesh {
  const vertices: number[] = [];
  const normals: number[] = [];
  const tiers = 3 + (seed % 3);
  const segments = 26;
  for (let tier = 0; tier < tiers; tier += 1) {
    const bottom = -0.75 + tier * (1.5 / tiers);
    const top = bottom + 1.5 / tiers - 0.03;
    const radius = 0.52 - tier * 0.04;
    for (let segment = 0; segment < segments; segment += 1) {
      const a = (segment / segments) * Math.PI * 2;
      const b = ((segment + 1) / segments) * Math.PI * 2;
      const points = [
        [Math.cos(a) * radius, bottom, Math.sin(a) * radius],
        [Math.cos(b) * radius, bottom, Math.sin(b) * radius],
        [Math.cos(a) * radius, top, Math.sin(a) * radius],
        [Math.cos(b) * radius, bottom, Math.sin(b) * radius],
        [Math.cos(b) * radius, top, Math.sin(b) * radius],
        [Math.cos(a) * radius, top, Math.sin(a) * radius],
      ];
      for (const point of points) {
        vertices.push(point[0], point[1], point[2]);
        const length = Math.hypot(point[0], point[2]) || 1;
        normals.push(point[0] / length, 0, point[2] / length);
      }
      const centreTop = [0, top, 0];
      const lidPoints = [
        centreTop,
        [Math.cos(a) * radius, top, Math.sin(a) * radius],
        [Math.cos(b) * radius, top, Math.sin(b) * radius],
      ];
      for (const point of lidPoints) {
        vertices.push(point[0], point[1], point[2]);
        normals.push(0, 1, 0);
      }
    }
  }
  return { vertices, normals };
}

function perspective(aspect: number): number[] {
  const near = 0.1;
  const far = 10;
  const f = 1 / Math.tan(Math.PI / 7);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
}

function modelMatrix(yaw: number, pitch: number): number[] {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return [
    cosYaw, sinYaw * sinPitch, -sinYaw * cosPitch, 0,
    0, cosPitch, sinPitch, 0,
    sinYaw, -cosYaw * sinPitch, cosYaw * cosPitch, 0,
    0, 0, -3.2, 1,
  ];
}

function stillRender(canvas: HTMLCanvasElement, seed: number): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const size = Math.max(1, canvas.clientWidth);
  canvas.width = size;
  canvas.height = size;
  context.fillStyle = '#08080c';
  context.fillRect(0, 0, size, size);
  const tiers = 3 + (seed % 3);
  const tierHeight = (size * 0.52) / tiers;
  for (let tier = 0; tier < tiers; tier += 1) {
    const width = size * (0.56 - tier * 0.04);
    context.fillStyle = tier % 2 === 0 ? '#1b2ee8' : '#ffd400';
    context.fillRect(
      (size - width) / 2,
      size * 0.72 - (tier + 1) * tierHeight,
      width,
      tierHeight - 3,
    );
  }
}

/** The product viewer: it orbits on drag, turns slowly when idle, and stands still without WebGL. */
export function ProductViewer({ title, seed }: { title: string; seed: string }): ReactNode {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const seedNumber = [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const gl = webglContext(element);
    if (gl === null) {
      stillRender(element, seedNumber);
      return;
    }
    const program = compile(gl, MODEL_VERTEX, MODEL_FRAGMENT);
    if (program === null) {
      stillRender(element, seedNumber);
      return;
    }
    const mesh = buildModel(seedNumber);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);
    const positionAttribute = gl.getAttribLocation(program, 'position');
    const normalAttribute = gl.getAttribLocation(program, 'normal');
    gl.enable(gl.DEPTH_TEST);

    let yaw = 0.6;
    let pitch = 0.1;
    let dragging = false;
    let last: [number, number] = [0, 0];
    let frame = 0;
    let previous = performance.now();

    const onDown = (event: PointerEvent): void => {
      dragging = true;
      last = [event.clientX, event.clientY];
      element.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return;
      yaw += (event.clientX - last[0]) * 0.01;
      pitch = Math.max(-1.2, Math.min(1.2, pitch + (event.clientY - last[1]) * 0.01));
      last = [event.clientX, event.clientY];
    };
    const onUp = (): void => {
      dragging = false;
    };
    const onOrientation = (event: DeviceOrientationEvent): void => {
      if (dragging) return;
      const gamma = event.gamma ?? 0;
      pitch = Math.max(-0.175, Math.min(0.175, (gamma / 90) * 0.175));
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    window.addEventListener('deviceorientation', onOrientation);

    const draw = (): void => {
      frame = requestAnimationFrame(draw);
      const now = performance.now();
      const elapsed = (now - previous) / 1000;
      previous = now;
      if (!dragging && !reduced) yaw += elapsed * ((Math.PI * 2) / 30);
      const size = Math.max(1, element.clientWidth);
      if (element.width !== size) {
        element.width = size;
        element.height = size;
      }
      gl.viewport(0, 0, element.width, element.height);
      gl.clearColor(0.03, 0.03, 0.05, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(positionAttribute);
      gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.enableVertexAttribArray(normalAttribute);
      gl.vertexAttribPointer(normalAttribute, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(
        gl.getUniformLocation(program, 'projection'),
        false,
        new Float32Array(perspective(1)),
      );
      gl.uniformMatrix4fv(
        gl.getUniformLocation(program, 'model'),
        false,
        new Float32Array(modelMatrix(yaw, pitch)),
      );
      gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices.length / 3);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [reduced, seedNumber]);

  return (
    <canvas
      ref={canvas}
      className="viewer"
      role="img"
      aria-label={`${title}, 3D view`}
      data-effect="viewer"
    />
  );
}
