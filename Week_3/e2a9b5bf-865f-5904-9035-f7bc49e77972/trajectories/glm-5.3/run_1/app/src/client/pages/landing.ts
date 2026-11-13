// Landing page: the hero and the white demonstration band (DP-56, DP-59).
import { app, navigate } from "../app.js";
import { el, prefersReducedMotion } from "../dom.js";

const HERO_OBJECTS = [
  { designation: "M13", kind: "globular" as const },
  { designation: "Albireo", kind: "double" as const },
  { designation: "M51", kind: "galaxy" as const },
];

const CROSSFADE_MS = 6000;

let heroTimer: number | null = null;

export function renderLanding(root: HTMLElement): void {
  if (heroTimer !== null) {
    window.clearTimeout(heroTimer);
    heroTimer = null;
  }
  const page = el("div", { class: "landing" });
  const header = el("header", { class: "landing-header" },
    el("p", { class: "wordmark", text: "Lowlamp" }),
    el("p", { class: "tagline", text: "A field log for people who still draw what they see." }),
  );

  const canvas = el("canvas", { class: "hero-canvas", width: "640", height: "440", role: "img", "aria-label": "Eyepiece view of M13" }) as HTMLCanvasElement;
  const plinth = el("div", { class: "plinth" }, canvas);

  const startButton = el("a", {
    class: "button primary wide",
    role: "link",
    text: "Start a log",
    href: app.account ? "/tonight" : "/signup",
    onclick: (event: MouseEvent) => {
      event.preventDefault();
      navigate(app.account ? "/tonight" : "/signup");
    },
  });

  page.append(header, plinth, startButton);

  // The white middle field with three small demonstrations.
  const demo = el("div", { class: "landing-demo" },
    el("div", { class: "demo-block" },
      el("h2", { text: "One optics line" }),
      el("p", { class: "demo-line", text: "120× · 34′ field · 2.1 mm exit pupil · North down, east right." }),
      el("p", { class: "demo-note", text: "10-inch Dobsonian · 10 mm wide · Straight through" }),
    ),
    el("div", { class: "demo-block" },
      el("h2", { text: "North and east, per train" }),
      el("div", { class: "demo-compasses" }, compassDemo("Straight through", "North down, east right."), compassDemo("Mirror diagonal", "North up, east right.")),
    ),
    el("div", { class: "demo-block" },
      el("h2", { text: "A packet page" }),
      packetDemo(),
    ),
  );
  page.append(demo);
  const footer = el("footer", { class: "landing-footer", text: "Lowlamp Instruments · a night-first observing log" });
  root.append(page, footer);
  drawHero(canvas, 0);
  if (!prefersReducedMotion()) {
    let index = 0;
    const advance = (): void => {
      index = (index + 1) % HERO_OBJECTS.length;
      const next = (index + 1) % HERO_OBJECTS.length;
      crossfade(canvas, index, next);
      heroTimer = window.setTimeout(advance, CROSSFADE_MS);
    };
    heroTimer = window.setTimeout(advance, CROSSFADE_MS);
  }
}

function compassDemo(name: string, sentence: string): HTMLElement {
  const wrap = el("div", { class: "demo-compass" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("class", "demo-compass-svg");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "60");
  circle.setAttribute("cy", "60");
  circle.setAttribute("r", "54");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "#101623");
  svg.append(circle);
  const label = (x: number, y: number, letter: string): void => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
    node.setAttribute("x", String(x));
    node.setAttribute("y", String(y));
    node.setAttribute("text-anchor", "middle");
    node.textContent = letter;
    svg.append(node);
  };
  const mirrored = sentence.includes("east right");
  const northUp = sentence.includes("North up");
  label(mirrored ? 78 : 42, northUp ? 30 : 96, "N");
  label(mirrored ? 96 : 24, 64, "E");
  wrap.append(el("p", { class: "demo-compass-name", text: name }), svg, el("p", { class: "demo-note", text: sentence }));
  return wrap;
}

function packetDemo(): HTMLElement {
  return el("div", { class: "demo-page" },
    el("p", { class: "demo-page-title", text: "Observing log packet 1" }),
    el("p", { class: "demo-page-line", text: "M13 — Great Globular Cluster in Hercules" }),
    el("p", { class: "demo-page-line", text: "UT: 2026-07-18 03:20 UT (21:20 local, UTC-06:00, America/Denver)" }),
    el("p", { class: "demo-page-line", text: "Site: Hollow Field · Seeing: 8/10 · NELM 6.5" }),
    el("p", { class: "demo-page-line", text: "Telescope: 10-inch Dobsonian, 254 mm aperture" }),
    el("p", { class: "demo-page-line", text: "Eyepiece: 10 mm wide at 120×" }),
    el("p", { class: "demo-page-line", text: "True field: 34′ · Exit pupil: 2.1 mm" }),
    el("p", { class: "demo-page-line", text: "Orientation: North down, east right." }),
    el("div", { class: "demo-sketch" }, graphiteSketch()),
  );
}

function graphiteSketch(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 140 140");
  svg.setAttribute("class", "demo-sketch-svg");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "70");
  circle.setAttribute("cy", "70");
  circle.setAttribute("r", "62");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "#101623");
  svg.append(circle);
  const blob = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  blob.setAttribute("cx", "70");
  blob.setAttribute("cy", "70");
  blob.setAttribute("rx", "18");
  blob.setAttribute("ry", "16");
  blob.setAttribute("fill", "#3a4152");
  svg.append(blob);
  for (const [x, y] of [[50, 52], [88, 60], [62, 96], [96, 94], [44, 82]] as const) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "1.8");
    dot.setAttribute("fill", "#101623");
    svg.append(dot);
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M40 100 C 56 88, 64 74, 76 62");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#101623");
  path.setAttribute("stroke-width", "1.1");
  svg.append(path);
  return svg;
}

function drawHero(canvas: HTMLCanvasElement, index: number, alphaNext = 0): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const radius = Math.min(width, height) * 0.44;
  const cx = width / 2;
  const cy = height / 2;
  const drawSet = (objectIndex: number, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    // field glow
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
    glow.addColorStop(0, "rgba(90, 96, 120, 0.28)");
    glow.addColorStop(1, "rgba(8, 10, 16, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    const object = HERO_OBJECTS[objectIndex]!;
    if (object.kind === "globular") {
      for (let i = 0; i < 220; i++) {
        const angle = pseudoRandom(i * 1.7) * Math.PI * 2;
        const distance = Math.pow(pseudoRandom(i * 2.3 + 1), 0.62) * radius * 0.52;
        const size = 0.6 + pseudoRandom(i * 3.1 + 2) * 1.5;
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, size, 0, Math.PI * 2);
        ctx.fill();
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.3);
      core.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      core.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (object.kind === "double") {
      const gold = ctx.createRadialGradient(cx - 14, cy - 6, 0, cx - 14, cy - 6, 26);
      gold.addColorStop(0, "rgba(255, 214, 140, 1)");
      gold.addColorStop(1, "rgba(255, 214, 140, 0)");
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(cx - 14, cy - 6, 26, 0, Math.PI * 2);
      ctx.fill();
      const blue = ctx.createRadialGradient(cx + 16, cy + 8, 0, cx + 16, cy + 8, 22);
      blue.addColorStop(0, "rgba(150, 200, 255, 1)");
      blue.addColorStop(1, "rgba(150, 200, 255, 0)");
      ctx.fillStyle = blue;
      ctx.beginPath();
      ctx.arc(cx + 16, cy + 8, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      for (let i = 0; i < 40; i++) {
        const angle = pseudoRandom(i * 5.7) * Math.PI * 2;
        const distance = radius * (0.62 + pseudoRandom(i) * 0.3);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const arm = (phase: number): void => {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let t = 0; t < 1; t += 0.05) {
          const angle = phase + t * 3.4;
          const distance = t * radius * 0.8;
          const x = cx + Math.cos(angle) * distance;
          const y = cy + Math.sin(angle) * distance * 0.55;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.34);
      core.addColorStop(0, "rgba(255, 255, 255, 0.9)");
      core.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.34, 0, Math.PI * 2);
      ctx.fill();
      arm(0.4);
      arm(0.4 + Math.PI);
      arm(0.4 + Math.PI * 1.15);
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      for (let i = 0; i < 30; i++) {
        const angle = pseudoRandom(i * 7.3) * Math.PI * 2;
        const distance = radius * (0.6 + pseudoRandom(i + 9) * 0.3);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };
  drawSet(index, 1 - alphaNext);
  if (alphaNext > 0) drawSet((index + 1) % HERO_OBJECTS.length, alphaNext);
}

function crossfade(canvas: HTMLCanvasElement, from: number, to: number): void {
  const total = 1000;
  const start = performance.now();
  const step = (): void => {
    const elapsed = performance.now() - start;
    const alpha = Math.min(1, elapsed / total);
    drawHero(canvas, from, alpha);
    canvas.setAttribute("aria-label", `Eyepiece view of ${HERO_OBJECTS[to]!.designation}`);
    if (alpha < 1) {
      requestAnimationFrame(step);
    } else {
      drawHero(canvas, to, 0);
      canvas.setAttribute("aria-label", `Eyepiece view of ${HERO_OBJECTS[to]!.designation}`);
    }
  };
  requestAnimationFrame(step);
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export function stopHero(): void {
  if (heroTimer !== null) {
    window.clearTimeout(heroTimer);
    heroTimer = null;
  }
}
