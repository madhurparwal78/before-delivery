/* The flat sky chart and the 160px treeline lens. */

export class SkyChart {
  constructor(canvas, size = 520) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.size = size;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * this.dpr;
    canvas.height = size * this.dpr;
    this.mask = [];
    this.targets = [];
    this.moon = null;
    this.minute = 0;
  }

  paint(plan) {
    const ctx = this.ctx;
    const s = this.size * this.dpr;
    const c = s / 2;
    const r = s * 0.44;
    ctx.clearRect(0, 0, s, s);
    // The sky disc.
    const grad = ctx.createRadialGradient(c, c * 0.9, r * 0.1, c, c, r);
    grad.addColorStop(0, "#101b33");
    grad.addColorStop(1, "#070a13");
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // Altitude rings 0, 30, 60.
    ctx.strokeStyle = "rgba(143,162,196,0.25)";
    ctx.lineWidth = this.dpr;
    [30, 60].forEach((alt) => {
      ctx.beginPath();
      ctx.arc(c, c, r * (1 - alt / 90), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.strokeStyle = "rgba(143,162,196,0.45)";
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    // Azimuth spokes with N, E, S, W labels.
    ctx.fillStyle = "rgba(143,162,196,0.75)";
    ctx.font = `${12 * this.dpr}px Sora, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labels = { 0: "N", 90: "E", 180: "S", 270: "W" };
    Object.entries(labels).forEach(([az, text]) => {
      const rad = ((Number(az) - 90) * Math.PI) / 180;
      ctx.fillText(text, c + Math.cos(rad) * (r + 14 * this.dpr), c + Math.sin(rad) * (r + 14 * this.dpr));
    });
    // The painted treeline silhouette rising from the rim.
    const mask = plan._mask || [];
    ctx.beginPath();
    ctx.moveTo(c - r, c);
    mask.forEach((alt, i) => {
      const az0 = (i * 5 - 90) * (Math.PI / 180);
      const az1 = ((i + 1) * 5 - 90) * (Math.PI / 180);
      const h0 = r * (alt / 90);
      const h1 = r * (mask[(i + 1) % 72] / 90);
      ctx.lineTo(c + Math.cos(az0) * (r - h0), c + Math.sin(az0) * (r - h0));
      ctx.lineTo(c + Math.cos(az1) * (r - h1), c + Math.sin(az1) * (r - h1));
    });
    ctx.closePath();
    ctx.fillStyle = "#04060c";
    ctx.fill();
    // Target arcs and dots.
    (plan.targets || []).forEach((t) => {
      const dim = t.position_status !== "clear";
      const pts = (t.arc || []).map((p) => this.project(p.altitude_deg, p.azimuth_deg, c, r));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = dim ? "rgba(223,233,255,0.18)" : "rgba(223,233,255,0.45)";
      ctx.lineWidth = this.dpr;
      ctx.stroke();
      const dot = this.project(t.altitude_deg, t.azimuth_deg, c, r);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 4.5 * this.dpr, 0, Math.PI * 2);
      ctx.fillStyle = dim ? "rgba(34,211,238,0.35)" : "#22d3ee";
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur = dim ? 0 : 10 * this.dpr;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    // The Moon as a small disc.
    if (plan.moon) {
      const m = this.project(plan.moon.altitude_deg, plan.moon.azimuth_deg, c, r);
      if (m.inside) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, 7 * this.dpr, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(223,233,255,0.9)";
        ctx.fill();
      }
    }
  }

  project(alt, az, c, r) {
    const rad = ((az - 90) * Math.PI) / 180;
    const rr = r * (1 - Math.max(-10, alt) / 90);
    return { x: c + Math.cos(rad) * rr, y: c + Math.sin(rad) * rr, inside: alt >= -5 };
  }

  /* Lens: draws the chart without the treeline, magnified around a centre. */
  paintLens(lensCanvas, centre, plan) {
    const ctx = lensCanvas.getContext("2d");
    const s = 320;
    ctx.clearRect(0, 0, s, s);
    const c = s / 2;
    const r = s * 0.44;
    const grad = ctx.createRadialGradient(c, c * 0.9, r * 0.1, c, c, r);
    grad.addColorStop(0, "#101b33");
    grad.addColorStop(1, "#070a13");
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(143,162,196,0.2)";
    [30, 60].forEach((alt) => {
      ctx.beginPath();
      ctx.arc(c, c, r * (1 - alt / 90), 0, Math.PI * 2);
      ctx.stroke();
    });
    const scale = 2;
    const off = { x: centre.x * 2 - s / 2, y: centre.y * 2 - s / 2 };
    (plan.targets || []).forEach((t) => {
      const pts = (t.arc || []).map((p) => this.project(p.altitude_deg, p.azimuth_deg, c, r));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = "rgba(223,233,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const dot = this.project(t.altitude_deg, t.azimuth_deg, c, r);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#22d3ee";
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    if (plan.moon) {
      const m = this.project(plan.moon.altitude_deg, plan.moon.azimuth_deg, c, r);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(223,233,255,0.9)";
      ctx.fill();
    }
    return { off, scale };
  }
}
