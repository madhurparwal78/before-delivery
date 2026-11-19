/* The flat sky chart: altitude rings, the painted treeline, target arcs and
   dots, the Moon, the active-minute line, and the 160-pixel treeline lens. */

const INK = '#dce7f5';
const MUTED = '#9fb2cd';
const CYAN = '#4fe3f2';
const TREELINE = '#0b1324';
const LENS_DIAMETER = 160;
const DIM = 0.33;

function radiusOf(altitudeDeg, radius) {
  return Math.max(0, ((90 - altitudeDeg) / 90) * radius);
}

function point(centre, radius, altitudeDeg, azimuthDeg) {
  const r = radiusOf(altitudeDeg, radius);
  const a = (azimuthDeg * Math.PI) / 180;
  return [centre[0] + r * Math.sin(a), centre[1] - r * Math.cos(a)];
}

function chartGeometry(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const radius = Math.min(width, height) / 2 - 26;
  return { centre: [width / 2, height / 2], radius, width, height };
}

function drawFrame(ctx, geometry) {
  const { centre, radius } = geometry;
  ctx.lineWidth = 1;
  for (const altitude of [0, 30, 60]) {
    ctx.beginPath();
    ctx.arc(centre[0], centre[1], radiusOf(altitude, radius), 0, Math.PI * 2);
    ctx.strokeStyle = altitude === 0 ? 'rgba(220,231,245,0.34)' : 'rgba(220,231,245,0.13)';
    ctx.stroke();
  }
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px Sora, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, azimuth] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const [x, y] = point(centre, radius + 17, 0, azimuth);
    ctx.fillText(label, x, y);
  }
  ctx.font = '11px Sora, sans-serif';
  ctx.fillText('30', centre[0], centre[1] - radiusOf(30, radius));
  ctx.fillText('60', centre[0], centre[1] - radiusOf(60, radius));
}

/** The painted treeline as one dark silhouette with a lit top edge. */
function drawTreeline(ctx, geometry, mask) {
  const { centre, radius } = geometry;
  const angle = (bin) => ((bin * 5 - 90) * Math.PI) / 180;
  const seam = 0.004;

  ctx.fillStyle = TREELINE;
  for (let bin = 0; bin < mask.length; bin += 1) {
    const inner = radiusOf(mask[bin], radius);
    ctx.beginPath();
    ctx.arc(centre[0], centre[1], radius, angle(bin) - seam, angle(bin + 1) + seam);
    ctx.arc(
      centre[0],
      centre[1],
      inner,
      angle(bin + 1) + seam,
      angle(bin) - seam,
      true,
    );
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  for (let bin = 0; bin < mask.length; bin += 1) {
    const inner = radiusOf(mask[bin], radius);
    const a = angle(bin);
    ctx.lineTo(centre[0] + inner * Math.cos(a), centre[1] + inner * Math.sin(a));
    ctx.arc(centre[0], centre[1], inner, a, angle(bin + 1));
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(79,227,242,0.38)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}


function drawArc(ctx, geometry, samples) {
  const { centre, radius } = geometry;
  ctx.beginPath();
  let started = false;
  for (const sample of samples) {
    if (sample.altitude_deg < 0) {
      started = false;
      continue;
    }
    const [x, y] = point(centre, radius, sample.altitude_deg, sample.azimuth_deg);
    if (started) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    started = true;
  }
  ctx.strokeStyle = 'rgba(220,231,245,0.34)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawTargets(ctx, geometry, data) {
  const { centre, radius } = geometry;
  for (const target of data.targets) {
    drawArc(ctx, geometry, target.arc);
  }
  for (const target of data.targets) {
    if (target.altitude_deg < 0) continue;
    const [x, y] = point(centre, radius, target.altitude_deg, target.azimuth_deg);
    const clear = target.position_status === 'clear';
    ctx.save();
    ctx.globalAlpha = clear ? 1 : DIM;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#eaf6ff';
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = clear ? 16 : 0;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = clear ? 1 : DIM;
    ctx.fillStyle = INK;
    ctx.font = '600 11px Sora, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(target.target_name, x + 9, y - 8);
    ctx.restore();
  }
}

function drawMoon(ctx, geometry, moon) {
  if (moon.altitude_deg < 0) return;
  const { centre, radius } = geometry;
  const [x, y] = point(centre, radius, moon.altitude_deg, moon.azimuth_deg);
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220,231,245,${0.2 + 0.6 * moon.illumination})`;
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,231,245,0.4)';
  ctx.stroke();
}

function drawMinuteLine(ctx, geometry, minute, nightMinutes) {
  if (!nightMinutes) return;
  const { centre, radius } = geometry;
  const fraction = Math.min(1, Math.max(0, minute / nightMinutes));
  ctx.beginPath();
  ctx.arc(
    centre[0],
    centre[1],
    radius + 5,
    -Math.PI / 2,
    -Math.PI / 2 + fraction * Math.PI * 2,
  );
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function scene(ctx, geometry, data, { withTreeline }) {
  ctx.clearRect(0, 0, geometry.width, geometry.height);
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, geometry.width, geometry.height);
  const glow = ctx.createRadialGradient(
    geometry.centre[0],
    geometry.centre[1],
    0,
    geometry.centre[0],
    geometry.centre[1],
    geometry.radius,
  );
  glow.addColorStop(0, 'rgba(79,227,242,0.11)');
  glow.addColorStop(1, 'rgba(79,227,242,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, geometry.width, geometry.height);
  drawFrame(ctx, geometry);
  if (withTreeline) drawTreeline(ctx, geometry, data.mask);
  drawTargets(ctx, geometry, data);
  drawMoon(ctx, geometry, data.moon);
  drawMinuteLine(ctx, geometry, data.minute, data.nightMinutes);
}

let revealed = null;

/** Paints the chart, with the lens revealing the sky behind the treeline. */
export function paintChart(canvas, data, lens) {
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = Math.round(cssWidth * 0.82);
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const geometry = chartGeometry({ width: cssWidth, height: cssHeight });
  scene(ctx, geometry, data, { withTreeline: true });
  if (!lens) return;

  if (!revealed) revealed = document.createElement('canvas');
  revealed.width = canvas.width;
  revealed.height = canvas.height;
  const hidden = revealed.getContext('2d');
  hidden.setTransform(ratio, 0, 0, ratio, 0, 0);
  scene(hidden, geometry, data, { withTreeline: false });

  const half = LENS_DIAMETER / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(lens[0], lens[1], half, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(revealed, 0, 0, cssWidth, cssHeight);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(lens[0], lens[1], half, 0, Math.PI * 2);
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** The target whose dot is nearest the lens centre and inside the lens. */
export function targetUnderLens(canvas, data, lens) {
  if (!lens) return null;
  const cssWidth = canvas.clientWidth || 320;
  const geometry = chartGeometry({
    width: cssWidth,
    height: Math.round(cssWidth * 0.82),
  });
  let best = null;
  let bestDistance = LENS_DIAMETER / 2;
  for (const target of data.targets) {
    if (target.altitude_deg < 0) continue;
    const [x, y] = point(
      geometry.centre,
      geometry.radius,
      target.altitude_deg,
      target.azimuth_deg,
    );
    const distance = Math.hypot(x - lens[0], y - lens[1]);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

export function targetPoint(canvas, target) {
  const cssWidth = canvas.clientWidth || 320;
  const geometry = chartGeometry({
    width: cssWidth,
    height: Math.round(cssWidth * 0.82),
  });
  return point(
    geometry.centre,
    geometry.radius,
    Math.max(0, target.altitude_deg),
    target.azimuth_deg,
  );
}

/** The sky disc with no targets, used as the hero of empty screens. */
export function paintSkyDisc(canvas, mask) {
  paintChart(
    canvas,
    {
      mask: mask || new Array(72).fill(8),
      targets: [],
      moon: { altitude_deg: -10, azimuth_deg: 0, illumination: 0 },
      minute: 0,
      nightMinutes: 0,
    },
    null,
  );
}
