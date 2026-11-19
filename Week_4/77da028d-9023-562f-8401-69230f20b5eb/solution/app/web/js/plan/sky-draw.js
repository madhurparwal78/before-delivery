// The flat sky chart, drawn from a plan body. Used by the chart (with the lens) and by the still
// picture that replaces the dome when WebGL is unavailable.
export const LENS_DIAMETER = 160;
const TAU = Math.PI * 2;
const BIN_WIDTH = 5;
const LABEL_FONT = '600 12px Sora, system-ui, sans-serif';
const NUMBER_FONT = '400 12px Sora, system-ui, sans-serif';
const DOT_RADIUS = 5;
const DIM_ALPHA = 1 / 3;
// Compass letters sit this far outside the disc: clear of the minute ring drawn 8 px out
const COMPASS_GAP = 20;
const TREELINE_FILL = '#02050b';

let palette = null;
function colours() {
  if (!palette) {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    palette = { disc: read('--surface'), ink: read('--ink'), muted: read('--muted'), cyan: read('--cyan') };
  }
  return palette;
}

export function dimAlpha(positionStatus) {
  return positionStatus === 'clear' ? 1 : DIM_ALPHA;
}

export function layoutOf(size) {
  return { size, centre: { x: size / 2, y: size / 2 }, radius: size / 2 - 30 };
}

// North at the top, east on the left (the sky seen looking up); the zenith is the centre.
export function chartPoint(layout, altitude, azimuth) {
  const reach = layout.radius * (90 - Math.min(90, Math.max(-4, altitude))) / 90;
  const angle = (azimuth * Math.PI) / 180;
  return { x: layout.centre.x - reach * Math.sin(angle), y: layout.centre.y - reach * Math.cos(angle) };
}

// Everything drawSky needs, from one plan body. `positions` (pid -> {altitude, azimuth, alpha}) overrides the plan's
// figures while the dots are sliding.
export function skyScene(plan, { size, mask, minute, timeLabel, lens = null, positions = null }) {
  const minutes = plan.night.minutes;
  return {
    size,
    mask,
    lens,
    timeLabel,
    minuteFraction: minutes > 0 ? minute / minutes : 0,
    moon: plan.moon.altitude_deg >= 0 ? { altitude: plan.moon.altitude_deg, azimuth: plan.moon.azimuth_deg } : null,
    targets: plan.targets.map((target) => {
      const shown = positions && positions.get(target.project_id);
      return {
        projectId: target.project_id,
        altitude: shown ? shown.altitude : target.altitude_deg,
        azimuth: shown ? shown.azimuth : target.azimuth_deg,
        alpha: shown ? shown.alpha : dimAlpha(target.position_status),
        arc: target.arc,
      };
    }),
  };
}

function polyline(context, layout, points) {
  let drawing = false;
  context.beginPath();
  for (const point of points) {
    if (point.altitude_deg < 0) { drawing = false; continue; }
    const at = chartPoint(layout, point.altitude_deg, point.azimuth_deg);
    if (drawing) context.lineTo(at.x, at.y);
    else context.moveTo(at.x, at.y);
    drawing = true;
  }
  context.stroke();
}

function paintTreeline(context, layout, mask) {
  context.beginPath();
  context.arc(layout.centre.x, layout.centre.y, layout.radius, 0, TAU);
  mask.forEach((altitude, bin) => {
    const west = chartPoint(layout, altitude, bin * BIN_WIDTH);
    const east = chartPoint(layout, altitude, (bin + 1) * BIN_WIDTH);
    if (bin === 0) context.moveTo(west.x, west.y);
    else context.lineTo(west.x, west.y);
    context.lineTo(east.x, east.y);
  });
  context.closePath();
  context.fillStyle = TREELINE_FILL;
  context.fill('evenodd');
  context.strokeStyle = colours().muted;
  context.globalAlpha = 0.4;
  context.lineWidth = 1;
  context.stroke();
  context.globalAlpha = 1;
}

function paintSky(context, scene, layout, { treeline, bright }) {
  const { disc, ink, muted, cyan } = colours();
  context.beginPath();
  context.arc(layout.centre.x, layout.centre.y, layout.radius, 0, TAU);
  context.fillStyle = disc;
  context.fill();

  context.lineWidth = 1;
  context.strokeStyle = muted;
  for (const altitude of [0, 30, 60]) {
    context.globalAlpha = altitude === 0 ? 0.8 : 0.35;
    context.beginPath();
    context.arc(layout.centre.x, layout.centre.y, layout.radius * (90 - altitude) / 90, 0, TAU);
    context.stroke();
  }
  context.globalAlpha = 0.25;
  for (let azimuth = 0; azimuth < 360; azimuth += 30) {
    const edge = chartPoint(layout, 0, azimuth);
    context.beginPath();
    context.moveTo(layout.centre.x, layout.centre.y);
    context.lineTo(edge.x, edge.y);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.fillStyle = muted;
  context.font = NUMBER_FONT;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (const altitude of [30, 60]) {
    const at = chartPoint(layout, altitude, 45);
    context.fillText(`${altitude}°`, at.x + 4, at.y - 8);
  }
  context.font = LABEL_FONT;
  context.textAlign = 'center';
  for (const [label, azimuth] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const angle = (azimuth * Math.PI) / 180;
    const reach = layout.radius + COMPASS_GAP;
    context.fillText(label, layout.centre.x - reach * Math.sin(angle), layout.centre.y - reach * Math.cos(angle));
  }

  context.strokeStyle = ink;
  context.lineWidth = 1;
  context.globalAlpha = 0.3;
  for (const target of scene.targets) polyline(context, layout, target.arc);
  context.globalAlpha = 1;

  if (treeline && scene.mask) paintTreeline(context, layout, scene.mask);

  if (scene.moon) {
    const at = chartPoint(layout, scene.moon.altitude, scene.moon.azimuth);
    context.beginPath();
    context.arc(at.x, at.y, 7, 0, TAU);
    context.fillStyle = ink;
    context.globalAlpha = 0.85;
    context.fill();
    context.globalAlpha = 1;
  }

  for (const target of scene.targets) {
    const at = chartPoint(layout, target.altitude, target.azimuth);
    context.globalAlpha = bright ? 1 : target.alpha;
    context.beginPath();
    context.arc(at.x, at.y, DOT_RADIUS, 0, TAU);
    context.fillStyle = ink;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = cyan;
    context.stroke();
  }
  context.globalAlpha = 1;
}

function paintMinuteLine(context, scene, layout) {
  const { cyan } = colours();
  context.fillStyle = cyan;
  context.font = LABEL_FONT;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(scene.timeLabel, 8, 8);
  if (scene.minuteFraction <= 0) return;
  context.beginPath();
  context.arc(layout.centre.x, layout.centre.y, layout.radius + 8, -Math.PI / 2, -Math.PI / 2 + scene.minuteFraction * TAU);
  context.strokeStyle = cyan;
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.stroke();
  context.lineCap = 'butt';
}

export function drawSky(context, scene) {
  const layout = layoutOf(scene.size);
  context.clearRect(0, 0, scene.size, scene.size);
  paintSky(context, scene, layout, { treeline: true, bright: false });
  paintMinuteLine(context, scene, layout);
  if (!scene.lens) return;
  context.save();
  context.beginPath();
  context.arc(scene.lens.x, scene.lens.y, LENS_DIAMETER / 2, 0, TAU);
  context.clip();
  context.clearRect(0, 0, scene.size, scene.size);
  paintSky(context, scene, layout, { treeline: false, bright: true });
  context.restore();
  context.beginPath();
  context.arc(scene.lens.x, scene.lens.y, LENS_DIAMETER / 2, 0, TAU);
  context.strokeStyle = colours().cyan;
  context.lineWidth = 2;
  context.stroke();
}

// Sizes a canvas to its CSS box at a device pixel ratio capped at 2 and returns the 2D context and CSS size.
export function fitCanvas(canvas) {
  const size = Math.round(canvas.clientWidth);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== size * ratio) {
    canvas.width = size * ratio;
    canvas.height = size * ratio;
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, size };
}
