export interface StillPen {
  circumference_m: number;
  net_depth_m: number;
  columns: number;
  rows: number;
}

export interface StillDefect {
  bearing_deg: number;
  depth_m: number;
  chart_x_m: number;
  chart_y_m: number;
}

const WATER = "#2e6f78";

function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 320));
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || 200));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

/// The procedural still on each pen condition card: net rings and that pen's
/// white pins on black water.
export function drawCardStill(
  canvas: HTMLCanvasElement,
  pen: StillPen,
  defects: StillDefect[],
): void {
  const context = prepare(canvas);
  if (!context) return;
  const width = canvas.width / (window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0a2125");
  gradient.addColorStop(0.35, "#040c0e");
  gradient.addColorStop(1, "#000000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const centreX = width / 2;
  const top = height * 0.2;
  const bottom = height * 0.88;
  const radiusX = Math.min(width * 0.36, height * 0.5);

  context.strokeStyle = "rgba(190, 226, 230, 0.16)";
  context.lineWidth = 1;
  const rings = pen.rows + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / (rings - 1 || 1);
    const y = top + (bottom - top) * t;
    const rx = radiusX * (1 - t * 0.25);
    context.beginPath();
    context.ellipse(centreX, y, rx, rx * 0.26, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.strokeStyle = "rgba(190, 226, 230, 0.1)";
  for (let spoke = 0; spoke < 16; spoke += 1) {
    const angle = (spoke / 16) * Math.PI * 2;
    context.beginPath();
    context.moveTo(centreX + radiusX * Math.sin(angle), top + radiusX * 0.26 * Math.cos(angle));
    context.lineTo(
      centreX + radiusX * 0.75 * Math.sin(angle),
      bottom + radiusX * 0.75 * 0.26 * Math.cos(angle),
    );
    context.stroke();
  }
  context.strokeStyle = WATER;
  context.globalAlpha = 0.5;
  context.beginPath();
  context.ellipse(centreX, top, radiusX, radiusX * 0.26, 0, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;

  context.fillStyle = "#ffffff";
  for (const defect of defects) {
    const angle = (defect.bearing_deg / 180) * Math.PI;
    const t = pen.net_depth_m === 0 ? 0 : defect.depth_m / pen.net_depth_m;
    const y = top + (bottom - top) * t;
    const rx = radiusX * (1 - t * 0.25);
    const x = centreX + rx * Math.sin(angle);
    const yy = y + rx * 0.26 * Math.cos(angle) * 0.35;
    context.beginPath();
    context.arc(x, yy, 2.6, 0, Math.PI * 2);
    context.fill();
  }
}

/// The flat net chart used in the report media frames.
export function drawFlatChart(
  canvas: HTMLCanvasElement,
  pen: StillPen,
  defects: StillDefect[],
  theme: "dark" | "light",
): void {
  const context = prepare(canvas);
  if (!context) return;
  const ratio = window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  context.fillStyle = theme === "dark" ? "#060708" : "#0b0d0f";
  context.fillRect(0, 0, width, height);
  const inset = 14;
  const chartWidth = width - inset * 2;
  const chartHeight = height - inset * 2;
  context.strokeStyle = "rgba(255,255,255,0.2)";
  context.lineWidth = 1;
  for (let column = 0; column <= pen.columns; column += 1) {
    const x = inset + (column / pen.columns) * chartWidth;
    context.beginPath();
    context.moveTo(x, inset);
    context.lineTo(x, inset + chartHeight);
    context.stroke();
  }
  for (let row = 0; row <= pen.rows; row += 1) {
    const y = inset + (row / pen.rows) * chartHeight;
    context.beginPath();
    context.moveTo(inset, y);
    context.lineTo(inset + chartWidth, y);
    context.stroke();
  }
  context.fillStyle = "#ffffff";
  for (const defect of defects) {
    const x = inset + (defect.chart_x_m / pen.circumference_m) * chartWidth;
    const y =
      inset + (pen.net_depth_m === 0 ? 0 : defect.chart_y_m / pen.net_depth_m) * chartHeight;
    context.beginPath();
    context.arc(x, y, 2.8, 0, Math.PI * 2);
    context.fill();
  }
}
