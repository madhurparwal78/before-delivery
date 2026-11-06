// The characteristic curve panel: the plot, its dot and its figures.
import { COPY, fill } from '../boot.js';
import { el } from '../dom.js';
import * as format from '../format.js';
import { groundColour, inkColour } from '../negative.js';

const PLOT = { width: 420, height: 300, pad: 34 };

export function curveCanvas(label) {
  return el('canvas', {
    width: PLOT.width,
    height: PLOT.height,
    role: 'img',
    'aria-label': label,
    class: 'curve-plot',
  });
}

export function drawCurve(canvas, curve, dot = null) {
  const context = canvas.getContext('2d');
  context.fillStyle = groundColour();
  context.fillRect(0, 0, canvas.width, canvas.height);
  const points = curve.points || [];
  const logs = points.map((point) => point.log_h);
  const nets = points.map((point) => point.net);
  if (dot && dot.log_h !== null && dot.log_h !== undefined) logs.push(dot.log_h);
  if (dot && dot.net !== null && dot.net !== undefined) nets.push(dot.net);
  const minLog = logs.length ? Math.min(...logs) : -1.5;
  const maxLog = logs.length ? Math.max(...logs) : 1.5;
  const maxNet = nets.length ? Math.max(1, Math.max(...nets)) : 1;
  const spanLog = maxLog - minLog || 1;

  const toX = (log) => PLOT.pad + ((log - minLog) / spanLog) * (canvas.width - PLOT.pad * 2);
  const toY = (net) => canvas.height - PLOT.pad - (net / maxNet) * (canvas.height - PLOT.pad * 2);

  context.strokeStyle = inkColour();
  context.globalAlpha = 0.4;
  context.beginPath();
  context.moveTo(PLOT.pad, PLOT.pad / 2);
  context.lineTo(PLOT.pad, canvas.height - PLOT.pad);
  context.lineTo(canvas.width - PLOT.pad / 2, canvas.height - PLOT.pad);
  context.stroke();
  context.globalAlpha = 1;

  if (points.length > 0) {
    context.lineWidth = 2;
    context.beginPath();
    points.forEach((point, index) => {
      const x = toX(point.log_h);
      const y = toY(point.net);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }
  if (dot && dot.log_h !== null && dot.log_h !== undefined && dot.net !== null) {
    context.fillStyle = inkColour();
    const size = 9;
    context.fillRect(toX(dot.log_h) - size / 2, toY(dot.net) - size / 2, size, size);
  }
}

export function figureTexts(curve) {
  return [
    `Base + fog ${format.density(curve.base_fog)}`,
    `Speed point log H ${format.logH(curve.speed_point_log_h)}`,
    `Contrast index ${format.unsigned(curve.contrast_index, 2)}`,
    `Frames used ${curve.frames_used}`,
    `Span ${format.span(curve.stops_span)} stops`,
  ];
}

export function figureList(curve) {
  return el(
    'div',
    { class: 'figures curve-figures' },
    figureTexts(curve).map((text) => el('span', { text })),
  );
}

export function notReadySentence(curve) {
  return fill(COPY.empty.not_ready, {
    frames: curve.frames_used,
    span: format.span(curve.stops_span),
  });
}
