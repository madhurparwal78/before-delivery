import type { Files } from './api';

export interface Starter {
  title: string;
  tags: string[];
  libraries: string[];
  files: Files;
}

/** The four starter pens ship with the app, so the landing inset runs them during an outage. */
export const starters: readonly Starter[] = [
  {
    title: 'Dressed courses',
    tags: ['starter', 'canvas'],
    libraries: [],
    files: {
      html: '<canvas id="stage" width="640" height="900"></canvas>\n',
      css: `html, body { margin: 0; height: 100%; background: #22201d; }
canvas { display: block; width: 100%; height: 100%; }
`,
      js: `const canvas = document.getElementById('stage');
const ink = canvas.getContext('2d');
const tones = ['#d8d3cb', '#c7c1b7', '#b4ada2', '#a2998c'];
const courses = [];
const courseHeight = 56;

for (let row = 0; row < 16; row += 1) {
  const blocks = [];
  let x = row % 2 === 0 ? 0 : -46;
  while (x < 640) {
    const width = 76 + ((row * 37 + x) % 5) * 22;
    blocks.push({ x, width, drop: 240 + row * 26 + (x % 7) * 18 });
    x += width + 6;
  }
  courses.push(blocks);
}

let frame = 0;
const ease = (t) => 1 - Math.pow(1 - t, 3);

const draw = () => {
  frame += 1;
  ink.fillStyle = '#22201d';
  ink.fillRect(0, 0, 640, 900);
  courses.forEach((blocks, row) => {
    const settle = Math.min(1, Math.max(0, (frame - row * 9) / 54));
    blocks.forEach((block, index) => {
      const y = 900 - (row + 1) * courseHeight;
      const offset = (1 - ease(settle)) * block.drop;
      ink.fillStyle = tones[(row + index) % tones.length];
      ink.fillRect(block.x, y - offset, block.width, courseHeight - 6);
    });
  });
  if (frame < 260) requestAnimationFrame(draw);
};

draw();
`,
    },
  },
  {
    title: 'Grid study',
    tags: ['starter', 'css-grid'],
    libraries: [],
    files: {
      html: `<div class="study">
  <div class="cell wide">ashlar</div>
  <div class="cell">course</div>
  <div class="cell tall">quoin</div>
  <div class="cell">bed</div>
  <div class="cell">joint</div>
  <div class="cell wide">header</div>
  <div class="cell">stretcher</div>
</div>
`,
      css: `html, body { margin: 0; min-height: 100%; background: #e7e4df; }
.study {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 96px;
  gap: 10px;
  padding: 10px;
  font: 300 20px/1.2 system-ui, sans-serif;
  letter-spacing: 0.02em;
}
.cell {
  display: grid;
  place-items: end start;
  padding: 12px;
  background: #cfcabf;
  color: #26231f;
}
.cell:nth-child(odd) { background: #bdb6a9; }
.wide { grid-column: span 2; }
.tall { grid-row: span 2; }
`,
      js: `document.querySelectorAll('.cell').forEach((cell, index) => {
  cell.style.outline = index % 3 === 0 ? '2px solid #6d7a52' : 'none';
});
`,
    },
  },
  {
    title: 'Type specimen',
    tags: ['starter', 'type'],
    libraries: [],
    files: {
      html: `<section class="specimen">
  <h1>ashlar</h1>
  <p class="line">Dressed stone, laid in courses.</p>
  <p class="scale">12 16 20 25 31 39 49</p>
</section>
`,
      css: `html, body { margin: 0; min-height: 100%; background: #26231f; color: #e9e5de; }
.specimen { padding: 6vw; font-family: system-ui, sans-serif; }
h1 {
  margin: 0;
  font-size: 18vw;
  font-weight: 200;
  letter-spacing: -0.04em;
  line-height: 0.9;
}
.line { font-size: 3vw; font-weight: 300; color: #b9b1a4; }
.scale { font-size: 2vw; letter-spacing: 0.3em; color: #8d9a6e; font-variant-numeric: tabular-nums; }
`,
      js: `const heading = document.querySelector('h1');
let weight = 200;
let rising = true;
setInterval(() => {
  weight += rising ? 20 : -20;
  if (weight >= 600) rising = false;
  if (weight <= 200) rising = true;
  heading.style.fontWeight = String(weight);
}, 120);
`,
    },
  },
  {
    title: 'Small physics toy',
    tags: ['starter', 'physics'],
    libraries: ['matter-js@0.20.0'],
    files: {
      html: '<div id="toy"></div>\n',
      css: `html, body { margin: 0; height: 100%; background: #1f1d1a; overflow: hidden; }
#toy canvas { display: block; }
`,
      js: `const { Engine, Render, Runner, Bodies, Composite } = Matter;

const engine = Engine.create();
const render = Render.create({
  element: document.getElementById('toy'),
  engine,
  options: { width: 640, height: 900, wireframes: false, background: '#1f1d1a' },
});

const stones = [];
for (let index = 0; index < 18; index += 1) {
  stones.push(
    Bodies.rectangle(120 + (index % 5) * 90, 80 + index * 26, 90, 36, {
      render: { fillStyle: index % 2 ? '#c7c1b7' : '#a2998c' },
    }),
  );
}

const ground = Bodies.rectangle(320, 880, 640, 40, { isStatic: true, render: { fillStyle: '#6d7a52' } });
const left = Bodies.rectangle(10, 450, 20, 900, { isStatic: true, render: { fillStyle: '#3a3732' } });
const right = Bodies.rectangle(630, 450, 20, 900, { isStatic: true, render: { fillStyle: '#3a3732' } });

Composite.add(engine.world, [...stones, ground, left, right]);
Render.run(render);
Runner.run(Runner.create(), engine);
`,
    },
  },
];
