import type { Files } from "../shared/types.js";

interface Starter {
  title: string;
  tags: string[];
  libraries: string[];
  files: Files;
}

const DRESSED_COURSES: Files = {
  html: String.raw`<canvas id="wall" aria-label="Courses of dressed stone settling into place"></canvas>`,
  css: String.raw`html, body { margin: 0; height: 100%; background: #d9dde1; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; }`,
  js: String.raw`const canvas = document.getElementById("wall");
const ctx = canvas.getContext("2d");
const tones = ["#8f9aa3", "#a7b0b8", "#7b8791", "#b9c0c7", "#98a3ac"];
let width = 0, height = 0, courses = [], clock = 0;

function build() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = canvas.clientWidth; height = canvas.clientHeight;
  canvas.width = width * ratio; canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const rows = 8, rowHeight = Math.min(height / (rows + 2), 64);
  courses = [];
  for (let row = 0; row < rows; row++) {
    const blocks = [];
    let x = row % 2 ? -rowHeight : 0;
    while (x < width) {
      const w = rowHeight * (1.6 + ((row * 7 + blocks.length * 3) % 5) * 0.28);
      blocks.push({ x, w: w - 4, tone: tones[(row * 3 + blocks.length) % tones.length] });
      x += w;
    }
    courses.push({ y: height - (row + 1) * rowHeight, h: rowHeight - 4, blocks, delay: row * 0.35 });
  }
}

function ease(t) { return 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3); }

function frame(now) {
  clock = now / 1000;
  const cycle = clock % 7;
  ctx.clearRect(0, 0, width, height);
  for (const course of courses) {
    const t = ease((cycle - course.delay) / 1.2);
    const fade = cycle > 6 ? 1 - (cycle - 6) : 1;
    for (const block of course.blocks) {
      const drop = (1 - t) * -(height * 0.9) * (0.6 + (block.x % 3) * 0.2);
      ctx.globalAlpha = Math.max(0, Math.min(1, fade));
      ctx.fillStyle = block.tone;
      ctx.fillRect(block.x, course.y + drop, block.w, course.h);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillRect(block.x, course.y + drop, block.w, 3);
    }
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(frame);
}

window.addEventListener("resize", build);
build();
requestAnimationFrame(frame);`,
};

const GRID_STUDY: Files = {
  html: String.raw`<main class="study">
  <div class="tile a"></div><div class="tile b"></div><div class="tile c"></div>
  <div class="tile d"></div><div class="tile e"></div><div class="tile f"></div>
</main>`,
  css: String.raw`html, body { margin: 0; height: 100%; background: #e7e0d2; }
.study {
  box-sizing: border-box; height: 100%; padding: 6%;
  display: grid; gap: 14px;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 1.3fr 1fr 1fr;
  grid-template-areas: "a a b" "c d b" "c e f";
}
.tile { border-radius: 2px; animation: breathe 6s ease-in-out infinite; }
.a { grid-area: a; background: #4c6a3c; }
.b { grid-area: b; background: #2b2622; animation-delay: -1s; }
.c { grid-area: c; background: #c7b48f; animation-delay: -2s; }
.d { grid-area: d; background: #8f9aa3; animation-delay: -3s; }
.e { grid-area: e; background: #d2d7dc; animation-delay: -4s; }
.f { grid-area: f; background: #a3abb3; animation-delay: -5s; }
@keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.965); } }
@media (prefers-reduced-motion: reduce) { .tile { animation: none; } }`,
  js: String.raw`document.title = 'Grid study';`,
};

const TYPE_SPECIMEN: Files = {
  html: String.raw`<article class="specimen">
  <p class="label">Specimen</p>
  <h1>Aa</h1>
  <p class="line">Hamburgefonstiv 0123456789</p>
  <p class="small">The quick brown fox jumps over the lazy dog. Sphinx of black quartz, judge my vow.</p>
</article>`,
  css: String.raw`html, body { margin: 0; height: 100%; background: #f1ede4; color: #2b2622; font-family: Georgia, "Times New Roman", serif; }
.specimen { box-sizing: border-box; height: 100%; padding: 8% 9%; display: flex; flex-direction: column; justify-content: center; }
.label { font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #6b5f55; margin: 0 0 12px; }
h1 { font-size: clamp(96px, 30vw, 260px); line-height: 0.85; font-weight: 400; margin: 0; letter-spacing: -0.04em; }
.line { font-size: clamp(22px, 5vw, 40px); margin: 18px 0 8px; font-style: italic; }
.small { font-size: 15px; line-height: 1.6; max-width: 34ch; margin: 0; color: #4a4038; }`,
  js: String.raw`document.title = 'Type specimen';`,
};

const PHYSICS_TOY: Files = {
  html: String.raw`<div id="world"></div>`,
  css: String.raw`html, body { margin: 0; height: 100%; background: #22201e; overflow: hidden; }
#world { position: absolute; inset: 0; }
canvas { display: block; }`,
  js: String.raw`const { Engine, Render, Runner, Bodies, Composite } = Matter;
const host = document.getElementById("world");
const width = host.clientWidth, height = host.clientHeight;
const engine = Engine.create();
const render = Render.create({ element: host, engine, options: { width, height, wireframes: false, background: "#22201e" } });
const palette = ["#bfd4ae", "#d8c6a5", "#a3abb3", "#4c6a3c", "#e6e9ec"];
const walls = [
  Bodies.rectangle(width / 2, height + 25, width, 50, { isStatic: true }),
  Bodies.rectangle(-25, height / 2, 50, height * 2, { isStatic: true }),
  Bodies.rectangle(width + 25, height / 2, 50, height * 2, { isStatic: true }),
];
Composite.add(engine.world, walls);
function drop(n) {
  const x = 40 + ((n * 97) % Math.max(width - 80, 1));
  const size = 22 + (n % 4) * 9;
  const body = n % 3 === 0
    ? Bodies.circle(x, -size, size / 2, { restitution: 0.55, render: { fillStyle: palette[n % palette.length] } })
    : Bodies.rectangle(x, -size, size * 1.4, size, { restitution: 0.3, angle: n, render: { fillStyle: palette[n % palette.length] } });
  Composite.add(engine.world, body);
}
let count = 0;
const timer = setInterval(() => { drop(count++); if (count > 40) clearInterval(timer); }, 260);
Render.run(render);
Runner.run(Runner.create(), engine);
document.title = 'Small physics toy';`,
};

export const STARTERS: readonly Starter[] = [
  { title: "Dressed courses", tags: ["starter", "canvas"], libraries: [], files: DRESSED_COURSES },
  { title: "Grid study", tags: ["starter", "css-grid"], libraries: [], files: GRID_STUDY },
  { title: "Type specimen", tags: ["starter", "type"], libraries: [], files: TYPE_SPECIMEN },
  { title: "Small physics toy", tags: ["starter", "physics"], libraries: ["matter-js@0.20.0"], files: PHYSICS_TOY },
];

export function starterOf(number: number): Starter {
  const starter = STARTERS[number - 1];
  if (starter === undefined) throw new Error(`there is no starter pen ${number}`);
  return starter;
}
