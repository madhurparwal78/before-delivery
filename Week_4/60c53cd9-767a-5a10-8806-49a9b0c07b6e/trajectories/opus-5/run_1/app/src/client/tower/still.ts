/** The still two-colour tower, drawn when WebGL is not available. */

type Rgb = readonly [number, number, number];

function css(colour: Rgb): string {
  return `rgb(${Math.round(colour[0] * 255)}, ${Math.round(colour[1] * 255)}, ${Math.round(colour[2] * 255)})`;
}

export function drawStillTower(canvas: HTMLCanvasElement, light: Rgb, shade: Rgb): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);

  const bodyWidth = width * 0.44;
  const left = width / 2 - bodyWidth / 2;
  const top = height * 0.06;
  const bottom = height * 0.97;
  const litWidth = bodyWidth * 0.62;

  context.fillStyle = css(shade);
  context.fillRect(left, top, bodyWidth, bottom - top);
  context.fillStyle = css(light);
  context.fillRect(left, top, litWidth, bottom - top);

  // The podium reads two storeys wider than the shaft.
  const podiumTop = bottom - (bottom - top) / 19;
  context.fillStyle = css(shade);
  context.fillRect(left - bodyWidth * 0.12, podiumTop, bodyWidth * 1.24, bottom - podiumTop);
  context.fillStyle = css(light);
  context.fillRect(left - bodyWidth * 0.12, podiumTop, litWidth * 1.1, bottom - podiumTop);
}
