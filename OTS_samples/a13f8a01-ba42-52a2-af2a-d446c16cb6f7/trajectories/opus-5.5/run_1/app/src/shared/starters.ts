import type { Files } from "./types";

export interface StarterPen {
  title: string;
  tags: string[];
  files: Files;
  libraries: string[];
}

const dressedCourses: StarterPen = {
  title: "Dressed courses",
  tags: ["starter", "canvas"],
  libraries: [],
  files: {
    html: `<canvas id="wall" aria-label="Stone courses settling into place"></canvas>
`,
    css: `html, body {
  margin: 0;
  height: 100%;
  background: #23201d;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}
`,
    js: `const canvas = document.getElementById("wall");
const ctx = canvas.getContext("2d");
const tones = ["#d9d4cb", "#c9c1b4", "#b9ae9c", "#a89a85", "#cfc8bd"];
let stones = [];

function build() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const course = Math.max(28, Math.round(height / 9));
  stones = [];
  let row = 0;
  for (let y = height - course; y > -course; y -= course) {
    let x = row % 2 === 0 ? 0 : -course * 0.8;
    while (x < width) {
      const length = course * (1.4 + Math.random() * 1.6);
      stones.push({
        x, y, w: length - 4, h: course - 4,
        drop: -height - Math.random() * height * 0.6 - row * course * 0.9,
        tone: tones[Math.floor(Math.random() * tones.length)],
      });
      x += length;
    }
    row += 1;
  }
}

function frame() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.fillStyle = "#23201d";
  ctx.fillRect(0, 0, width, height);
  for (const stone of stones) {
    stone.drop += (0 - stone.drop) * 0.06;
    ctx.fillStyle = stone.tone;
    ctx.fillRect(stone.x, stone.y + stone.drop, stone.w, stone.h);
  }
  requestAnimationFrame(frame);
}

build();
window.addEventListener("resize", build);
requestAnimationFrame(frame);
`,
  },
};

const gridStudy: StarterPen = {
  title: "Grid study",
  tags: ["starter", "css-grid"],
  libraries: [],
  files: {
    html: `<main class="study">
  <div class="a">A</div>
  <div class="b">B</div>
  <div class="c">C</div>
  <div class="d">D</div>
  <div class="e">E</div>
  <div class="f">F</div>
</main>
`,
    css: `html, body {
  margin: 0;
  height: 100%;
  background: #eceae6;
  font-family: system-ui, sans-serif;
}

.study {
  display: grid;
  height: 100%;
  box-sizing: border-box;
  padding: 16px;
  gap: 10px;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 1fr 2fr 1fr;
  grid-template-areas:
    "a a b"
    "c d b"
    "c e f";
}

.study > div {
  display: grid;
  place-items: end start;
  padding: 12px;
  font-size: 28px;
  font-weight: 300;
  color: #2b2724;
}

.a { grid-area: a; background: #c9c1b4; }
.b { grid-area: b; background: #6f8a6a; color: #fff; }
.c { grid-area: c; background: #b9ae9c; }
.d { grid-area: d; background: #d9d4cb; }
.e { grid-area: e; background: #a89a85; }
.f { grid-area: f; background: #2b2724; color: #eceae6 !important; }
`,
    js: `document.title = "Grid study";
`,
  },
};

const typeSpecimen: StarterPen = {
  title: "Type specimen",
  tags: ["starter", "type"],
  libraries: [],
  files: {
    html: `<article>
  <p class="label">Specimen</p>
  <h1>Ashlar</h1>
  <p class="lede">Squared stone, dressed and laid in even courses.</p>
  <ol id="scale"></ol>
</article>
`,
    css: `html, body {
  margin: 0;
  min-height: 100%;
  background: #f4efe6;
  color: #2b2724;
  font-family: Georgia, "Times New Roman", serif;
}

article {
  padding: 32px;
}

.label {
  margin: 0;
  font: 600 12px/1 system-ui, sans-serif;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #7a6e62;
}

h1 {
  margin: 8px 0;
  font-size: 96px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.03em;
}

.lede {
  max-width: 28ch;
  font-size: 22px;
  line-height: 1.4;
}

ol {
  list-style: none;
  padding: 0;
}

li {
  line-height: 1.2;
  white-space: nowrap;
}
`,
    js: `const sizes = [12, 15, 19, 24, 30, 37];
const scale = document.getElementById("scale");
for (const size of sizes) {
  const item = document.createElement("li");
  item.style.fontSize = size + "px";
  item.textContent = size + " Dressed stone";
  scale.appendChild(item);
}
`,
  },
};

const physicsToy: StarterPen = {
  title: "Small physics toy",
  tags: ["starter", "physics"],
  libraries: ["matter-js@0.20.0"],
  files: {
    html: `<div id="world"></div>
`,
    css: `html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #e6e2da;
}

#world {
  width: 100%;
  height: 100%;
}
`,
    js: `const { Engine, Render, Runner, Bodies, Composite } = Matter;
const host = document.getElementById("world");
const width = host.clientWidth;
const height = host.clientHeight;
const engine = Engine.create();
const render = Render.create({
  element: host,
  engine,
  options: { width, height, wireframes: false, background: "#e6e2da" },
});

const ground = Bodies.rectangle(width / 2, height + 20, width * 2, 60, { isStatic: true });
const tones = ["#c9c1b4", "#b9ae9c", "#a89a85", "#6f8a6a"];
const blocks = [];
for (let i = 0; i < 24; i += 1) {
  const w = 40 + Math.random() * 50;
  blocks.push(Bodies.rectangle(
    40 + Math.random() * (width - 80),
    -i * 60,
    w,
    w * 0.55,
    { render: { fillStyle: tones[i % tones.length] }, chamfer: { radius: 3 } },
  ));
}

Composite.add(engine.world, [ground, ...blocks]);
Render.run(render);
Runner.run(Runner.create(), engine);
`,
  },
};

export const starterPens: readonly StarterPen[] = [dressedCourses, gridStudy, typeSpecimen, physicsToy];
