import { useId, type ReactElement } from "react";
import { TOY_COLOURS } from "../starters";
import type { Framing } from "./camera";
import { tint } from "./colour";
import { PART_SIZES } from "./partScene";
import { TOY_SIZES, type ToyLayout } from "./toyRig";
import { hexagonPoints, type Point } from "./toys";

/**
 * Still SVG renders of the landing scenes, drawn when the browser has no WebGL. They use the scenes' own sizes, layouts
 * and camera angles with an orthographic projection, so they show the same pictures as the WebGL versions.
 */

type Vec3 = readonly [number, number, number];
type Projector = (x: number, y: number, z: number) => Point;

interface Face {
  points: Vec3[];
  normal: Vec3;
}

interface Drawing {
  depth: number;
  node: ReactElement;
}

const LIGHT: Vec3 = [-0.35, -0.55, 0.76];
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

function projector(framing: Framing, width: number, height: number): { project: Projector; scale: number; toward: Vec3; away: (x: number, y: number) => number } {
  const az = rad(framing.azimuth);
  const el = rad(framing.elevation);
  const scale = Math.min(width / 2 / framing.halfWidth, height / 2 / framing.halfHeight);
  const [tx, ty, tz] = framing.target;
  return {
    scale,
    toward: [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)],
    away: (x, y) => -(x - tx) * Math.sin(az) + (y - ty) * Math.cos(az),
    project: (x, y, z) => {
      const dx = x - tx;
      const dy = y - ty;
      const right = dx * Math.cos(az) + dy * Math.sin(az);
      const away = -dx * Math.sin(az) + dy * Math.cos(az);
      return [width / 2 + right * scale, height / 2 - ((z - tz) * Math.cos(el) + away * Math.sin(el)) * scale];
    },
  };
}

function turnPoint([x, y, z]: Vec3, turn: number, at: Point): Vec3 {
  return [at[0] + x * Math.cos(turn) - y * Math.sin(turn), at[1] + x * Math.sin(turn) + y * Math.cos(turn), z];
}

function turnNormal([x, y, z]: Vec3, turn: number): Vec3 {
  return [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn), z];
}

/** The lit and shaded colour of a face from how squarely it meets the light. */
function faceColour(base: string, normal: Vec3): string {
  const lit = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
  return tint(base, Math.max(-0.4, Math.min(0.28, (lit - 0.5) * 0.55)));
}

function prismFaces(outline: readonly Point[], height: number, turn: number, at: Point): Face[] {
  const faces: Face[] = [{ points: outline.map(([x, y]) => turnPoint([x, y, height], turn, at)), normal: [0, 0, 1] }];
  outline.forEach(([x1, y1], index) => {
    const [x2, y2] = outline[(index + 1) % outline.length] as Point;
    const length = Math.hypot(x2 - x1, y2 - y1);
    faces.push({
      points: [turnPoint([x1, y1, 0], turn, at), turnPoint([x2, y2, 0], turn, at), turnPoint([x2, y2, height], turn, at), turnPoint([x1, y1, height], turn, at)],
      normal: turnNormal([(y2 - y1) / length, -(x2 - x1) / length, 0], turn),
    });
  });
  return faces;
}

function wedgeFaces(turn: number, at: Point): Face[] {
  const { run, rise, width } = TOY_SIZES.wedge;
  const x = run / 2;
  const y = width / 2;
  const slope = Math.hypot(rise, run);
  const make = (points: Vec3[], normal: Vec3): Face => ({ points: points.map((p) => turnPoint(p, turn, at)), normal: turnNormal(normal, turn) });
  return [
    make([[-x, -y, 0], [x, -y, 0], [-x, -y, rise]], [0, -1, 0]),
    make([[-x, y, 0], [-x, y, rise], [x, y, 0]], [0, 1, 0]),
    make([[-x, -y, 0], [-x, -y, rise], [-x, y, rise], [-x, y, 0]], [-1, 0, 0]),
    make([[x, -y, 0], [x, y, 0], [-x, y, rise], [-x, -y, rise]], [rise / slope, 0, run / slope]),
  ];
}

function facesOf(faces: Face[], colour: string, view: ReturnType<typeof projector>, centre: Point): Drawing {
  const shown = faces.filter((face) => face.normal[0] * view.toward[0] + face.normal[1] * view.toward[1] + face.normal[2] * view.toward[2] > 0.001);
  return {
    depth: view.away(centre[0], centre[1]),
    node: (
      <g key={`${colour}-${centre[0]}-${centre[1]}-${faces.length}`}>
        {shown.map((face, index) => {
          const fill = faceColour(colour, face.normal);
          return <polygon key={index} points={face.points.map(([x, y, z]) => view.project(x, y, z).join(",")).join(" ")} fill={fill} stroke={fill} strokeWidth="0.8" strokeLinejoin="round" />;
        })}
      </g>
    ),
  };
}

interface CylinderDrawing {
  x: number;
  y: number;
  radius: number;
  height: number;
  colour: string;
  gradient: string;
}

function cylinderOf(spec: CylinderDrawing, view: ReturnType<typeof projector>, framing: Framing): Drawing {
  const [tx, ty] = view.project(spec.x, spec.y, spec.height);
  const [bx, by] = view.project(spec.x, spec.y, 0);
  const rx = spec.radius * view.scale;
  const ry = rx * Math.sin(rad(framing.elevation));
  return {
    depth: view.away(spec.x, spec.y),
    node: (
      <g key={`cylinder-${spec.x}-${spec.y}`}>
        <path d={`M${tx - rx} ${ty}L${bx - rx} ${by}A${rx} ${ry} 0 0 0 ${bx + rx} ${by}L${tx + rx} ${ty}Z`} fill={`url(#${spec.gradient})`} />
        <ellipse cx={tx} cy={ty} rx={rx} ry={ry} fill={tint(spec.colour, 0.22)} />
      </g>
    ),
  };
}

/** A round hole seen from above: a dark opening, with the ground showing through its lower part. */
function holeOf(x: number, y: number, radius: number, height: number, ground: string, view: ReturnType<typeof projector>, framing: Framing): ReactElement {
  const [cx, cy] = view.project(x, y, height);
  const [fx, fy] = view.project(x, y, 0);
  const rx = radius * view.scale;
  const ry = rx * Math.sin(rad(framing.elevation));
  const clip = `hole-${Math.round(cx)}-${Math.round(cy)}`;
  return (
    <g key={clip}>
      <clipPath id={clip}><ellipse cx={cx} cy={cy} rx={rx} ry={ry} /></clipPath>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={tint(TOY_COLOURS.orange, -0.5)} />
      <ellipse cx={fx} cy={fy} rx={rx} ry={ry} style={{ fill: ground }} clipPath={`url(#${clip})`} />
    </g>
  );
}

function roundedRectPoints(width: number, depth: number): Point[] {
  const x = width / 2;
  const y = depth / 2;
  return [[-x, -y], [x, -y], [x, y], [-x, y]];
}

function Gradient({ id, colour }: { id: string; colour: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stopColor={tint(colour, 0.12)} />
      <stop offset="0.55" stopColor={tint(colour, -0.12)} />
      <stop offset="1" stopColor={tint(colour, -0.38)} />
    </linearGradient>
  );
}

interface ToyStillProps {
  layout: ToyLayout;
  framing: Framing;
  width: number;
  height: number;
  /** The colour behind the picture, seen through the box's hole. */
  ground: string;
  className?: string;
  preserveAspectRatio?: string;
}

/** The hero's three toys as a still SVG: a green wedge, a purple cylinder and an orange box with a hole through it. */
export function ToyStill({ layout, framing, width, height, ground, className, preserveAspectRatio = "xMidYMid slice" }: ToyStillProps) {
  const gradient = useId();
  const view = projector(framing, width, height);
  const { cylinder, box } = TOY_SIZES;
  const boxFaces = facesOf(prismFaces(roundedRectPoints(box.width, box.depth), box.height, layout.box.turn, [layout.box.x, layout.box.y]), TOY_COLOURS.orange, view, [layout.box.x, layout.box.y]);
  const drawings: Drawing[] = [
    facesOf(wedgeFaces(layout.wedge.turn, [layout.wedge.x, layout.wedge.y]), TOY_COLOURS.green, view, [layout.wedge.x, layout.wedge.y]),
    cylinderOf({ x: layout.cylinder.x, y: layout.cylinder.y, radius: cylinder.radius, height: cylinder.height, colour: TOY_COLOURS.purple, gradient }, view, framing),
    { depth: boxFaces.depth, node: <g key="box">{boxFaces.node}{holeOf(layout.box.x, layout.box.y, box.holeRadius, box.height, ground, view, framing)}</g> },
  ];
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={preserveAspectRatio} aria-hidden="true" focusable="false">
      <defs><Gradient id={gradient} colour={TOY_COLOURS.purple} /></defs>
      {drawings.sort((a, b) => b.depth - a.depth).map((drawing) => drawing.node)}
    </svg>
  );
}

interface PartStillProps {
  framing: Framing;
  turn: number;
  width: number;
  height: number;
}

/** The 3D Workshop preview's hex nut with its selection box and corner handles, as a still SVG. */
export function PartStill({ framing, turn, width, height }: PartStillProps) {
  const view = projector(framing, width, height);
  const { circumradius, hole, height: depth } = PART_SIZES;
  const faces = prismFaces(hexagonPoints(circumradius), depth, turn, [0, 0]);
  const nut = facesOf(faces, TOY_COLOURS.green, view, [0, 0]);
  const half = (circumradius * Math.sqrt(3)) / 2;
  const corners: Vec3[] = [];
  for (const z of [0, depth]) for (const [x, y] of [[-circumradius, -half], [circumradius, -half], [circumradius, half], [-circumradius, half]] as const) corners.push(turnPoint([x, y, z], turn, [0, 0]));
  const screen = corners.map(([x, y, z]) => view.project(x, y, z));
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const [hx, hy] = view.project(0, 0, depth);
  const rx = hole * view.scale;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {nut.node}
      <ellipse cx={hx} cy={hy} rx={rx} ry={rx * Math.sin(rad(framing.elevation))} fill={tint(TOY_COLOURS.green, -0.55)} />
      <g style={{ stroke: "var(--cobalt)" }} strokeWidth="1.5" fill="none">
        {edges.map(([from, to]) => {
          const a = screen[from] as Point;
          const b = screen[to] as Point;
          return <line key={`${from}-${to}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
      </g>
      {screen.map(([x, y], index) => <rect key={index} x={x - 4.5} y={y - 4.5} width="9" height="9" fill="#fff" style={{ stroke: "var(--cobalt)" }} strokeWidth="1.5" />)}
    </svg>
  );
}
