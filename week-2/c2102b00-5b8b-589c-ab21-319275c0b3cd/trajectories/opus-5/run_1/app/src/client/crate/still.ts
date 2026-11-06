import { BOX, VIEW, slotCentre, slotSize, topExtent, unitBodyHeight } from './layout.ts';
import { crateTones, palette, topColours } from './palette.ts';
import { topColourOf, type CrateModel } from './model.ts';
import { DISPLAY_FONT } from './textures.ts';

const SIN_EL = Math.sin(VIEW.elevation);
const COS_EL = Math.cos(VIEW.elevation);

interface Projector {
  (x: number, y: number, z: number): [number, number];
}

function projectorFor(width: number, height: number): Projector {
  const scale = width / (VIEW.frustumHeight * VIEW.aspect);
  const centreX = width / 2;
  const centreY = height / 2;
  return (x, y, z) => [centreX + x * scale, centreY + (-y * COS_EL + z * SIN_EL) * scale];
}

function polygon(context: CanvasRenderingContext2D, points: [number, number][], fill: string): void {
  context.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = palette.ink;
  context.lineWidth = 1;
  context.stroke();
}

function flutes(context: CanvasRenderingContext2D, points: [number, number][]): void {
  context.save();
  context.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
  context.closePath();
  context.clip();
  context.strokeStyle = 'rgba(120, 90, 50, 0.3)';
  context.lineWidth = 1;
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  for (let x = minX; x <= maxX; x += 5) {
    context.beginPath();
    context.moveTo(x, minY);
    context.lineTo(x, maxY);
    context.stroke();
  }
  context.restore();
}

/** The still crate: the same box at the home view, following the line it is given. */
export function drawStillCrate(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: CrateModel,
  background: string,
): void {
  const project = projectorFor(width, height);
  context.clearRect(0, 0, width, height);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const halfWidth = BOX.width / 2;
  const halfDepth = BOX.depth / 2;
  const top = BOX.height;

  // back wall outer face
  polygon(
    context,
    [
      project(-halfWidth, top, -halfDepth),
      project(halfWidth, top, -halfDepth),
      project(halfWidth, 0, -halfDepth),
      project(-halfWidth, 0, -halfDepth),
    ],
    crateTones.boxSide,
  );

  // inside floor
  polygon(
    context,
    [
      project(-halfWidth, BOX.wall, -halfDepth),
      project(halfWidth, BOX.wall, -halfDepth),
      project(halfWidth, BOX.wall, halfDepth),
      project(-halfWidth, BOX.wall, halfDepth),
    ],
    crateTones.inside,
  );

  // slot marks
  const size = slotSize(model);
  const inner = BOX.width - 2 * BOX.wall;
  const innerDepth = BOX.depth - 2 * BOX.wall;
  context.strokeStyle = crateTones.slot;
  context.lineWidth = 1;
  for (let column = 1; column < model.columns; column += 1) {
    const x = -inner / 2 + column * size.width;
    const start = project(x, BOX.wall, -innerDepth / 2);
    const end = project(x, BOX.wall, innerDepth / 2);
    context.beginPath();
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
    context.stroke();
  }
  for (let row = 1; row < model.rows; row += 1) {
    const z = -innerDepth / 2 + row * size.depth;
    const start = project(-inner / 2, BOX.wall, z);
    const end = project(inner / 2, BOX.wall, z);
    context.beginPath();
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
    context.stroke();
  }

  // left and right walls
  const leftWall: [number, number][] = [
    project(-halfWidth, top, -halfDepth),
    project(-halfWidth, top, halfDepth),
    project(-halfWidth, 0, halfDepth),
    project(-halfWidth, 0, -halfDepth),
  ];
  polygon(context, leftWall, crateTones.boxSide);
  flutes(context, leftWall);
  const rightWall: [number, number][] = [
    project(halfWidth, top, -halfDepth),
    project(halfWidth, top, halfDepth),
    project(halfWidth, 0, halfDepth),
    project(halfWidth, 0, -halfDepth),
  ];
  polygon(context, rightWall, crateTones.boxSide);
  flutes(context, rightWall);

  if (!model.lidClosed) drawUnits(context, project, width, model);

  // front wall, drawn after the units it hides
  const frontWall: [number, number][] = [
    project(-halfWidth, top, halfDepth),
    project(halfWidth, top, halfDepth),
    project(halfWidth, 0, halfDepth),
    project(-halfWidth, 0, halfDepth),
  ];
  polygon(context, frontWall, crateTones.boxFront);
  flutes(context, frontWall);
  const tapeTop = project(-halfWidth, top * 0.62, halfDepth);
  const tapeBottom = project(halfWidth, top * 0.38, halfDepth);
  context.fillStyle = crateTones.tape;
  context.fillRect(tapeTop[0], tapeTop[1], tapeBottom[0] - tapeTop[0], tapeBottom[1] - tapeTop[1]);

  if (model.lidClosed) {
    const lid: [number, number][] = [
      project(-halfWidth, top + BOX.wall, -halfDepth),
      project(halfWidth, top + BOX.wall, -halfDepth),
      project(halfWidth, top + BOX.wall, halfDepth),
      project(-halfWidth, top + BOX.wall, halfDepth),
    ];
    polygon(context, lid, crateTones.box);
    flutes(context, lid);
    if (model.stamp) drawStamp(context, project, width, model.stamp, 'green');
  } else if (model.stamp === 'DROPPED') {
    drawStamp(context, project, width, 'DROPPED', 'ink');
  }
}

function drawUnits(
  context: CanvasRenderingContext2D,
  project: Projector,
  width: number,
  model: CrateModel,
): void {
  const scale = width / (VIEW.frustumHeight * VIEW.aspect);
  const size = slotSize(model);
  const bodyHeight = unitBodyHeight(model.unit);
  const extent = topExtent(model);
  const bodyTone = model.unit === 'lb' ? crateTones.sack : model.unit === 'jug' ? crateTones.paper : crateTones.glass;
  for (let index = 0; index < model.pack; index += 1) {
    const colour = topColourOf(model.cells[index] ?? 'empty', model.dropped);
    if (colour === null) continue;
    const centre = slotCentre(model, index);
    const base = project(centre.x, BOX.wall, centre.z);
    const apex = project(centre.x, BOX.wall + bodyHeight, centre.z);
    const halfBodyWidth = (model.unit === 'bottle' ? size.width * 0.22 : size.width * 0.33) * scale;
    context.fillStyle = bodyTone;
    context.strokeStyle = palette.ink;
    context.lineWidth = 1;
    context.beginPath();
    context.rect(base[0] - halfBodyWidth, apex[1], halfBodyWidth * 2, base[1] - apex[1]);
    context.fill();
    context.stroke();
    const topRadiusX = (extent / 2) * scale;
    const topRadiusY = topRadiusX * SIN_EL;
    context.beginPath();
    if (model.unit === 'lb') {
      context.rect(apex[0] - topRadiusX, apex[1] - topRadiusY, topRadiusX * 2, topRadiusY * 2);
    } else {
      context.ellipse(apex[0], apex[1], topRadiusX, topRadiusY, 0, 0, Math.PI * 2);
    }
    context.fillStyle = topColours[colour];
    context.fill();
  }
}

function drawStamp(
  context: CanvasRenderingContext2D,
  project: Projector,
  width: number,
  text: string,
  colour: 'green' | 'ink',
): void {
  const anchor = project(0, BOX.height + BOX.wall, 0);
  const size = Math.max(10, width * (text.length > 7 ? 0.09 : 0.12));
  context.save();
  context.translate(anchor[0], anchor[1]);
  context.rotate(-0.05);
  context.font = `800 ${size}px ${DISPLAY_FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = colour === 'green' ? palette.green : palette.ink;
  context.fillText(text, 0, 0);
  const metrics = context.measureText(text);
  context.strokeStyle = colour === 'green' ? palette.green : palette.ink;
  context.lineWidth = Math.max(1.5, size * 0.08);
  context.strokeRect(-metrics.width / 2 - size * 0.25, -size * 0.65, metrics.width + size * 0.5, size * 1.3);
  context.restore();
}
