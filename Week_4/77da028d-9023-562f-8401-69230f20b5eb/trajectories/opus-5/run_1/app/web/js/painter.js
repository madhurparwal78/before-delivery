/* The horizon painter: azimuth 0 to 360 left to right, altitude 0 to 90 bottom
   to top, with the 72 mask bins drawn as a filled treeline. */

const BIN_COUNT = 72;
const BIN_WIDTH_DEG = 5;

export function paintHorizon(canvas, mask, selectedBin) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 170;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(220,231,245,0.12)';
  ctx.fillStyle = '#9fb2cd';
  ctx.font = '11px Sora, sans-serif';
  ctx.textAlign = 'center';
  for (let azimuth = 0; azimuth <= 360; azimuth += 45) {
    const x = (azimuth / 360) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height - 14);
    ctx.stroke();
    ctx.fillText(String(azimuth), Math.min(width - 10, Math.max(10, x)), height - 3);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const altitude of [30, 60, 90]) {
    const y = height - 14 - (altitude / 90) * (height - 20);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(String(altitude), 3, y + 2);
  }
  ctx.textBaseline = 'alphabetic';

  const binWidth = width / BIN_COUNT;
  for (let bin = 0; bin < BIN_COUNT; bin += 1) {
    const top = height - 14 - (mask[bin] / 90) * (height - 20);
    ctx.fillStyle = bin === selectedBin ? '#16384a' : '#0b1422';
    ctx.fillRect(bin * binWidth, top, binWidth + 0.5, height - 14 - top);
    ctx.strokeStyle = bin === selectedBin ? '#4fe3f2' : 'rgba(79,227,242,0.22)';
    ctx.beginPath();
    ctx.moveTo(bin * binWidth, top);
    ctx.lineTo(bin * binWidth + binWidth, top);
    ctx.stroke();
  }
}

export function binAt(canvas, clientX) {
  const box = canvas.getBoundingClientRect();
  const fraction = Math.min(0.999, Math.max(0, (clientX - box.left) / box.width));
  return Math.floor(fraction * BIN_COUNT);
}

export function altitudeAt(canvas, clientY) {
  const box = canvas.getBoundingClientRect();
  const usable = box.height - 20;
  const fromBottom = box.height - 14 - (clientY - box.top);
  return Math.max(0, Math.min(90, Math.round((fromBottom / usable) * 90)));
}

export function painterName(mask, bin) {
  return (
    `Horizon painter: azimuth ${bin * BIN_WIDTH_DEG} degrees, ` +
    `mask altitude ${mask[bin]} degrees`
  );
}

export { BIN_COUNT };
