// The striped worm tail at the hero's left edge, drawn on a canvas; its tip leans toward the pointer.
import { reducedMotion } from "./common.js";

const SEGMENTS = 26;
const SETTLE_MS = 70;

export function wireTail(canvas, hero) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let lean = 0;
  let target = 0;
  let last = 0;
  let frame = 0;

  function spine() {
    const points = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const curl = t * t * (2.6 + lean * 1.4);
      const x = -width * 0.08 + width * 0.92 * Math.sin(t * 1.25) * (1 - 0.35 * t) + Math.cos(curl) * width * 0.08 * t;
      const y = height * (0.92 - 0.62 * t) - Math.sin(curl) * height * 0.14 * t + lean * height * 0.12 * t * t;
      points.push([x, y, (1 - t * 0.82) * width * 0.16]);
    }
    return points;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const points = spine();
    ctx.lineCap = "round";
    for (const [stroke, extra] of [["#020409", 6], [null, 0]]) {
      for (let i = 0; i < SEGMENTS; i++) {
        const [x1, y1, r] = points[i];
        const [x2, y2] = points[i + 1];
        ctx.strokeStyle = stroke ?? (i % 2 === 0 ? "#eef2f8" : "#11161f");
        ctx.lineWidth = r + extra;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  }

  function step(now) {
    const dt = last ? now - last : 16;
    last = now;
    lean += (target - lean) * (1 - Math.exp(-dt / SETTLE_MS));
    draw();
    if (Math.abs(target - lean) > 0.002) frame = requestAnimationFrame(step);
    else frame = 0;
  }

  function aim(value) {
    target = Math.max(-1, Math.min(1, value));
    if (!frame) {
      last = 0;
      frame = requestAnimationFrame(step);
    }
  }

  new ResizeObserver(() => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }).observe(canvas);

  if (reducedMotion.matches) return;
  hero.addEventListener("pointermove", (event) => {
    const box = canvas.getBoundingClientRect();
    const dx = (event.clientX - box.left) / Math.max(1, hero.clientWidth);
    const dy = (event.clientY - (box.top + box.height * 0.3)) / Math.max(1, box.height);
    aim(dy * 1.6 + dx * 0.6);
  });
  hero.addEventListener("pointerleave", () => aim(0));
}
