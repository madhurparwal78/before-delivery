import { useEffect, useRef } from 'react';
import type { Lane, LayoutId } from '../../shared/catalogue.js';
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
  translation,
  type Mesh,
  type SolidProgram,
} from '../gl.js';
import { laneOffset, offsetPoint, trackGeometry } from '../track-geometry.js';
import { supportsWebgl2 } from './CarView.js';

export interface RaceCar {
  kind: 'player' | 'ai' | 'ghost';
  distance: number;
  lane: Lane;
}

export interface RaceSceneRef {
  cars: RaceCar[];
}

function ribbonMesh(gl: WebGL2RenderingContext, program: SolidProgram, layoutId: LayoutId): Mesh {
  const geometry = trackGeometry(layoutId);
  const vertices: number[] = [];
  const step = 4;
  for (let distance = 0; distance < geometry.lengthM; distance += step) {
    const here = geometry.pointAt(distance);
    const next = geometry.pointAt(distance + step);
    const a = offsetPoint(here, -geometry.halfWidth);
    const b = offsetPoint(here, geometry.halfWidth);
    const c = offsetPoint(next, geometry.halfWidth);
    const d = offsetPoint(next, -geometry.halfWidth);
    for (const corner of [a, b, c, a, c, d]) {
      vertices.push(corner.x, 0, corner.z, 0, 1, 0);
    }
  }
  return createMesh(gl, program, vertices, gl.TRIANGLES);
}

function kerbMesh(gl: WebGL2RenderingContext, program: SolidProgram, layoutId: LayoutId): Mesh {
  const geometry = trackGeometry(layoutId);
  const vertices: number[] = [];
  const step = 8;
  for (const side of [-geometry.halfWidth, -2, 2, geometry.halfWidth]) {
    for (let distance = 0; distance < geometry.lengthM; distance += step) {
      const a = offsetPoint(geometry.pointAt(distance), side);
      const b = offsetPoint(geometry.pointAt(distance + step / 2), side);
      vertices.push(a.x, 0.05, a.z, 0, 1, 0, b.x, 0.05, b.z, 0, 1, 0);
    }
  }
  return createMesh(gl, program, vertices, gl.LINES);
}

/** The race view: one track ribbon, the player, the AI cars and the ghost. */
export function RaceView({
  layoutId,
  scene,
  cars,
}: {
  layoutId: LayoutId;
  scene: { current: RaceSceneRef };
  cars: RaceCar[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const supported = supportsWebgl2();

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const gl = node.getContext('webgl2');
    if (!gl) return;
    const program = createSolidProgram(gl);
    const cube = createMesh(gl, program, cubeVertices(), gl.TRIANGLES);
    const ribbon = ribbonMesh(gl, program, layoutId);
    const kerbs = kerbMesh(gl, program, layoutId);
    const geometry = trackGeometry(layoutId);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let frame = 0;
    const draw = () => {
      const width = node.clientWidth || 640;
      const height = Math.round(width * 0.56);
      node.width = width;
      node.height = height;
      gl.viewport(0, 0, width, height);
      gl.clearColor(PALETTE.paper[0], PALETTE.paper[1], PALETTE.paper[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program.program);
      gl.uniformMatrix4fv(
        program.projection,
        false,
        perspective(Math.PI / 3, width / height, 0.3, 400),
      );

      const player = scene.current.cars.find((car) => car.kind === 'player');
      const playerPoint = geometry.pointAt(player?.distance ?? 0);
      const playerPosition = offsetPoint(playerPoint, laneOffset(player?.lane ?? 'middle'));
      const forwardX = Math.cos(playerPoint.heading);
      const forwardZ = Math.sin(playerPoint.heading);
      gl.uniformMatrix4fv(
        program.view,
        false,
        lookAt(
          [playerPosition.x - forwardX * 14, 6.5, playerPosition.z - forwardZ * 14],
          [playerPosition.x + forwardX * 10, 1, playerPosition.z + forwardZ * 10],
          [0, 1, 0],
        ),
      );

      gl.uniform4fv(program.colour, new Float32Array([0.88, 0.85, 0.77, 1]));
      gl.uniformMatrix4fv(program.model, false, identity());
      gl.bindVertexArray(ribbon.vao);
      gl.drawArrays(ribbon.mode, 0, ribbon.count);
      gl.uniform4fv(program.colour, new Float32Array(PALETTE.ink));
      gl.bindVertexArray(kerbs.vao);
      gl.drawArrays(kerbs.mode, 0, kerbs.count);

      gl.bindVertexArray(cube.vao);
      for (const car of scene.current.cars) {
        const point = geometry.pointAt(car.distance);
        const position = offsetPoint(point, laneOffset(car.lane));
        const base = multiply(
          translation(position.x, 0, position.z),
          rotationY(-point.heading + Math.PI / 2),
        );
        const colour =
          car.kind === 'player'
            ? PALETTE.accent
            : car.kind === 'ghost'
              ? PALETTE.ghost
              : PALETTE.ink;
        for (const part of carParts(colour)) {
          gl.uniform4fv(program.colour, new Float32Array(part.colour));
          gl.uniformMatrix4fv(program.model, false, multiply(base, part.model));
          gl.drawArrays(cube.mode, 0, cube.count);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [layoutId, scene]);

  if (!supported) {
    const geometry = trackGeometry(layoutId);
    const scale = 2.6;
    return (
      <svg
        className="race-canvas"
        viewBox="-200 -120 400 240"
        role="img"
        aria-label="Race view"
        height={280}
      >
        <path
          d={Array.from({ length: 121 }, (_, index) => {
            const point = geometry.pointAt((index / 120) * geometry.lengthM);
            return `${index === 0 ? 'M' : 'L'}${(point.x / scale).toFixed(1)},${(point.z / scale).toFixed(1)}`;
          }).join(' ')}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2"
        />
        {cars.map((car, index) => {
          const point = offsetPoint(geometry.pointAt(car.distance), laneOffset(car.lane));
          return (
            <circle
              key={index}
              cx={point.x / scale}
              cy={point.z / scale}
              r={5}
              fill={car.kind === 'player' ? 'var(--accent)' : 'var(--ink)'}
              opacity={car.kind === 'ghost' ? 0.4 : 1}
            />
          );
        })}
      </svg>
    );
  }

  return <canvas ref={canvas} className="race-canvas" role="img" aria-label="Race view" />;
}
