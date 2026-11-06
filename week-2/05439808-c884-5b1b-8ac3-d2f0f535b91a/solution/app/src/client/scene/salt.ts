// The cracked salt crust, drawn procedurally once and shared by the 3D island and the flat plan.

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return s / 4294967296;
  };
}

/** Crack polylines over the build area, in cells (0–36 across). */
export function saltCracks(): { x: number; y: number }[][] {
  const random = seeded(0x5a17);
  const cracks: { x: number; y: number }[][] = [];
  for (let i = 0; i < 90; i += 1) {
    let x = random() * 36;
    let y = random() * 36;
    let angle = random() * Math.PI * 2;
    const line = [{ x, y }];
    const steps = 6 + Math.floor(random() * 14);
    for (let s = 0; s < steps; s += 1) {
      angle += (random() - 0.5) * 1.1;
      x += Math.cos(angle) * 0.55;
      y += Math.sin(angle) * 0.55;
      if (x < 0 || y < 0 || x > 36 || y > 36) break;
      line.push({ x, y });
    }
    cracks.push(line);
  }
  return cracks;
}

export function drawSaltCrust(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const cell = size / 36;
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, size, size);
  const random = seeded(0x1d3);
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 252, 244, 0.35)' : 'rgba(176, 168, 190, 0.16)';
    const r = (0.6 + random() * 2.4) * cell;
    ctx.beginPath();
    ctx.ellipse(random() * size, random() * size, r, r * (0.5 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of saltCracks()) {
    ctx.strokeStyle = 'rgba(96, 90, 132, 0.55)';
    ctx.lineWidth = Math.max(1, size / 700);
    ctx.beginPath();
    line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * cell, p.y * cell) : ctx.lineTo(p.x * cell, p.y * cell)));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(74, 70, 112, 0.14)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 36; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  return canvas;
}
