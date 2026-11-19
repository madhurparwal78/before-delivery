import { useEffect, useRef } from 'react';
import { copy } from '../copy.js';
import { useReducedMotion } from '../hooks.js';
import {
  PALETTE,
  carParts,
  createMesh,
  createSolidProgram,
  cubeVertices,
  identity,
  lookAt,
  multiply,
  perspective,
  rotationY,
} from '../gl.js';

const IDLE_TURN_SECONDS = 28;
const RESUME_IDLE_MS = 2000;

let webgl2Probe: boolean | null = null;

export function supportsWebgl2(): boolean {
  if (webgl2Probe === null) {
    webgl2Probe = document.createElement('canvas').getContext('webgl2') !== null;
  }
  return webgl2Probe;
}

/** The live 3D car view, or a drawing of the car's side profile without WebGL 2. */
export function CarView({ carName }: { carName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const supported = supportsWebgl2();
  const reduced = useReducedMotion();
  const spin = useRef(0.6);
  const dragging = useRef(false);
  const lastDragEnd = useRef(0);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const gl = node.getContext('webgl2');
    if (!gl) return;
    const program = createSolidProgram(gl);
    const cube = createMesh(gl, program, cubeVertices(), gl.TRIANGLES);
    const floorLines: number[] = [];
    for (let line = -6; line <= 6; line += 1) {
      floorLines.push(line, 0, -6, 0, 1, 0, line, 0, 6, 0, 1, 0);
      floorLines.push(-6, 0, line, 0, 1, 0, 6, 0, line, 0, 1, 0);
    }
    const floor = createMesh(gl, program, floorLines, gl.LINES);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let frame = 0;
    let previous = performance.now();
    const draw = (now: number) => {
      const elapsed = Math.min(now - previous, 100);
      previous = now;
      const idle = !dragging.current && !reduced && now - lastDragEnd.current > RESUME_IDLE_MS;
      if (idle) spin.current += (elapsed / 1000) * ((Math.PI * 2) / IDLE_TURN_SECONDS);

      const width = node.clientWidth || 320;
      const height = node.clientHeight || 240;
      node.width = width;
      node.height = height;
      gl.viewport(0, 0, width, height);
      gl.clearColor(PALETTE.paper[0], PALETTE.paper[1], PALETTE.paper[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program.program);
      gl.uniformMatrix4fv(
        program.projection,
        false,
        perspective(Math.PI / 4, width / height, 0.1, 100),
      );
      gl.uniformMatrix4fv(program.view, false, lookAt([0, 3.4, 8.2], [0, 0.7, 0], [0, 1, 0]));

      gl.uniform4fv(program.colour, new Float32Array([0.55, 0.52, 0.45, 1]));
      gl.uniformMatrix4fv(program.model, false, identity());
      gl.bindVertexArray(floor.vao);
      gl.drawArrays(floor.mode, 0, floor.count);

      const turn = rotationY(spin.current);
      gl.bindVertexArray(cube.vao);
      for (const part of carParts(PALETTE.accent)) {
        gl.uniform4fv(program.colour, new Float32Array(part.colour));
        gl.uniformMatrix4fv(program.model, false, multiply(turn, part.model));
        gl.drawArrays(cube.mode, 0, cube.count);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let lastX = 0;
    const down = (event: PointerEvent) => {
      dragging.current = true;
      lastX = event.clientX;
      node.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      spin.current += (event.clientX - lastX) / 120;
      lastX = event.clientX;
      event.preventDefault();
    };
    const up = () => {
      dragging.current = false;
      lastDragEnd.current = performance.now();
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
  }, []);

  if (!supported) {
    return (
      <>
        <svg
          className="car-view"
          viewBox="0 0 220 110"
          role="img"
          aria-label={`${carName}, drawing`}
          style={{ touchAction: 'none' }}
        >
          <path
            d="M20 80 L40 55 L95 48 L135 52 L185 72 L195 80 Z"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
          />
          <path d="M55 55 L80 38 L120 40 L132 52" fill="none" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="60" cy="82" r="14" fill="none" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="160" cy="82" r="14" fill="none" stroke="var(--ink)" strokeWidth="2" />
          <line x1="10" y1="96" x2="210" y2="96" stroke="var(--ink)" strokeWidth="1" />
        </svg>
        <p>{copy.webglNotice}</p>
      </>
    );
  }

  return (
    <canvas
      ref={canvas}
      className="car-view"
      role="img"
      aria-label={`${carName}, 3D view`}
      style={{ touchAction: 'none' }}
    />
  );
}
