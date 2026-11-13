// Drives the pack: scroll to progress, progress to yaw / camera / sticker, the swaps, the published rectangles, and the
// choice between the WebGL canvas and the SVG panel. One animation-frame loop; nothing else moves.
import type { PackFacts } from "../../shared/types";
import { PANEL_GEOMETRY, panelText, rectStr, specFor, type Rect } from "./spec";
import { focalFor, frontRect, mrpRect, packRect, panelRect, stickerPose, stickerQuad, type View } from "./project";
import { svgMarkup } from "./svg";
import { WebglStage, type DrawItem } from "./webgl";

export type Still = "front" | "back" | "sticker";
const PACK_SWAP_MS = 320;
const MIRROR_SWAP_MS = 180;
const EASE_TAU = 70;

/** cubic-bezier(0.2, 0, 0, 1) */
function swapCurve(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const u = (lo + hi) / 2;
    const x = 3 * (1 - u) * (1 - u) * u * 0.2 + u * u * u;
    if (x < t) lo = u;
    else hi = u;
  }
  const u = (lo + hi) / 2;
  return 3 * (1 - u) * u * u + u * u * u;
}

const yawFor = (p: number): number => Math.min(p / 0.55, 1) * 180;
const cameraFor = (p: number): number => (p <= 0.75 ? 6 : 6 - ((p - 0.75) / 0.25) * 2.8);
const stillProgress: Record<Still, number> = { front: 0, back: 0.55, sticker: 1 };

const signature = (f: PackFacts): string => `${f.batchCode}|${panelText(f)}|${f.drinkName}|${f.skuName}|${f.format}`;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const fixed = (v: number, d: number): string => (Math.round(v * 10 ** d) / 10 ** d).toString();

interface StageElements {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  hero: HTMLElement;
  arch: HTMLElement;
  section: HTMLElement;
  mirror: HTMLElement;
}

export class StageController {
  private facts: PackFacts | null = null;
  private previous: PackFacts | null = null;
  private swapStart = -1;
  private mirrorStart = -1;
  private restartSwaps = false;
  private mode: "webgl" | "svg" = "svg";
  private webgl: WebglStage | null = null;
  private svg: SVGSVGElement | null = null;
  private frame = 0;
  private lastTime = 0;
  private shown = 0;
  private first = true;
  private snap = true;
  private lastKey = "";
  private forced = true;
  private reduced = false;
  private still: Still = "front";
  private readonly written = new Map<Element, Map<string, string>>();
  private readonly coarse = matchMedia("(pointer: coarse)");
  private contextLost = false;
  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.mode = "svg";
    this.forced = true;
  };
  private onRestored = () => {
    this.contextLost = false;
    if (this.webgl) this.mode = "webgl";
    this.forced = true;
  };

  constructor(private readonly els: StageElements, wantWebgl: boolean) {
    const { canvas } = els;
    if (wantWebgl) {
      try {
        this.webgl = new WebglStage(canvas);
        this.mode = "webgl";
      } catch {
        this.webgl = null;
      }
    }
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.resize();
  }

  start(): void {
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.step();
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.els.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.els.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.svg?.remove();
    this.webgl?.dispose();
  }

  setFacts(next: PackFacts, animate: boolean): void {
    const current = this.facts;
    this.facts = next;
    if (!current || !animate || signature(current) === signature(next)) {
      this.previous = null;
      if (!current) this.swapStart = -1;
      this.forced = true;
      return;
    }
    this.previous = current;
    const now = performance.now();
    this.swapStart = now;
    this.mirrorStart = now;
    this.restartSwaps = true;
    this.forced = true;
  }

  setMotion(reduced: boolean, still: Still): void {
    if (reduced !== this.reduced) this.snap = true;
    this.reduced = reduced;
    this.still = still;
    this.snap = true;
    this.forced = true;
    if (reduced) {
      this.swapStart = -1;
      this.mirrorStart = -1;
      this.previous = null;
    }
  }

  snapProgress(): void {
    this.snap = true;
  }

  resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    const c = this.els.canvas;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    this.webgl?.resize(w, h, devicePixelRatio || 1);
    this.snap = true;
    this.forced = true;
  }

  progress(): number {
    return this.shown;
  }

  private write(el: Element, attrs: Record<string, string>): void {
    let old = this.written.get(el);
    if (!old) this.written.set(el, (old = new Map()));
    for (const [k, v] of Object.entries(attrs)) {
      if (old.get(k) === v) continue;
      old.set(k, v);
      el.setAttribute(k, v);
    }
  }

  private ensureSvg(): SVGSVGElement {
    if (!this.svg) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Pack declaration panel");
      svg.setAttribute("aria-describedby", this.els.canvas.getAttribute("aria-describedby") ?? "");
      svg.classList.add("pack-svg");
      this.els.stage.appendChild(svg);
      this.svg = svg;
    }
    return this.svg;
  }

  private step(): void {
    const { stage, canvas, hero, arch, section, mirror } = this.els;
    const facts = this.facts;
    if (!facts) return;
    const now = performance.now();
    const dt = this.lastTime ? Math.min(now - this.lastTime, 100) : 16;
    this.lastTime = now;
    // The swaps run on frame time: the first frame after a re-read paints progress 0, so no frame is lost to the gap between the read and the paint.
    if (this.restartSwaps) {
      this.restartSwaps = false;
      if (this.swapStart >= 0) this.swapStart = now;
      if (this.mirrorStart >= 0) this.mirrorStart = now;
    }
    const vw = innerWidth;
    const vh = innerHeight;
    const spec = specFor(facts.format);

    // ---- progress from the scroll position ----
    const sectionTop = section.getBoundingClientRect().top + scrollY;
    const target = this.reduced ? stillProgress[this.still] : Math.min(1, Math.max(0, (scrollY - sectionTop) / (4 * vh)));
    if (this.first || this.snap || this.reduced || this.coarse.matches) {
      this.shown = target;
    } else {
      const gap = target - this.shown;
      this.shown = Math.abs(gap) < 0.0004 ? target : this.shown + gap * (1 - Math.exp(-dt / EASE_TAU));
    }
    this.snap = false;
    this.first = false;
    const progress = this.shown;
    const yaw = yawFor(progress);
    const camZ = cameraFor(progress);
    const applies = facts.revisedMrpPaise !== null;
    const seated = applies && progress >= 0.75;
    const flying = applies && (this.reduced ? progress >= 0.75 : progress >= 0.55);

    // ---- swaps ----
    let swap = 1;
    if (this.swapStart >= 0) {
      const t = (now - this.swapStart) / PACK_SWAP_MS;
      swap = swapCurve(t);
      if (t >= 1) {
        this.swapStart = -1;
        this.previous = null;
        this.forced = true;
      }
    }
    let mirrorSwap = 1;
    if (this.mirrorStart >= 0) {
      const t = (now - this.mirrorStart) / MIRROR_SWAP_MS;
      mirrorSwap = swapCurve(t);
      if (t >= 1) this.mirrorStart = -1;
    }
    this.write(mirror, { "data-mirror-swap": fixed(mirrorSwap, 6) });
    mirror.style.opacity = mirrorSwap >= 1 ? "" : String(0.15 + 0.85 * mirrorSwap);

    // ---- layout: where the pack sits ----
    const box = stage.getBoundingClientRect();
    const archBox = arch.getBoundingClientRect();
    const pinStart = sectionTop;
    const open = this.reduced ? 1 : Math.min(1, Math.max(0, pinStart > 0 ? scrollY / pinStart : 1));
    const stageHeightPx = Math.min(box.height * 0.5, box.width * 0.5 * (spec.height / spec.width));
    const heroHeightPx = Math.min(archBox.height * 0.6, archBox.width * 0.6 * (spec.height / spec.width));
    const heroCx = archBox.left + archBox.width / 2;
    const heroCy = archBox.top + archBox.height * 0.55;
    const stageCx = box.left + box.width / 2;
    const stageCy = box.top + box.height / 2;
    const travelCx = lerp(heroCx, stageCx, open);
    const travelCy = lerp(heroCy, stageCy, open);
    const travelH = lerp(heroHeightPx, stageHeightPx, open);
    const mainView: View = this.reduced
      ? { cx: stageCx, cy: stageCy, focal: focalFor(spec, stageHeightPx), camZ, yawDeg: yaw }
      : { cx: travelCx, cy: travelCy, focal: focalFor(spec, travelH), camZ, yawDeg: yaw };
    const heroView: View = { cx: heroCx, cy: heroCy, focal: focalFor(spec, heroHeightPx), camZ: 6, yawDeg: 0 };

    // ---- published rectangles (viewport CSS pixels, from the same maths as the drawing) ----
    const mrp = mrpRect(mainView, spec);
    const panel = panelRect(mainView, spec);
    const front = frontRect(mainView, spec);
    const pose = stickerPose(spec, facts.format, progress);
    const quad = flying && yaw > 90 ? stickerQuad(mainView, spec, pose) : null;
    const quadAttr = quad ? quad.map(([x, y]) => `${fixed(x, 2)},${fixed(y, 2)}`).join(" ") : "";
    const mainPack = packRect(mainView, spec);
    const heroPack = packRect(this.reduced ? heroView : mainView, spec);
    const g = PANEL_GEOMETRY[facts.format];
    const variant = facts.skuName.startsWith(facts.drinkName) ? facts.skuName.slice(facts.drinkName.length).trim() : facts.skuName;

    this.write(stage, {
      "data-pack-progress": fixed(progress, 4),
      "data-pack-yaw": fixed(yaw, 2),
      "data-camera-z": fixed(camZ, 3),
      "data-sticker": seated ? "seated" : "none",
      "data-renderer": this.mode,
      "data-format": facts.format,
      "data-sku": facts.skuCode,
      "data-batch": facts.batchCode,
      "data-swap-progress": fixed(swap, 6),
      "data-mrp-rect": rectStr(g.mrp),
      "data-sticker-rect": rectStr(g.sticker),
      "data-panel-text": panelText(facts),
      "data-front-text": `${facts.drinkName} | ${variant}`,
      "data-mrp-screen-rect": mrp ? rectStr(round2(mrp)) : "",
      "data-sticker-screen-quad": quadAttr,
      "data-panel-screen-rect": panel ? rectStr(round2(panel)) : "",
      "data-front-screen-rect": front ? rectStr(round2(front)) : "",
      "data-pack-screen-rect": rectStr(round2(mainPack)),
    });
    this.write(hero, {
      "data-arch-open": fixed(open, 4),
      "data-arch-screen-rect": rectStr(round2([archBox.left, archBox.top, archBox.width, archBox.height])),
      "data-pack-screen-rect": rectStr(round2(heroPack)),
    });
    arch.style.setProperty("--open", fixed(open, 4));

    // ---- draw ----
    const items: DrawItem[] = [];
    const layersOf = (f: PackFacts) => {
      if (this.previous && this.swapStart >= 0) {
        return [
          { facts: this.previous, key: signature(this.previous), opacity: Math.min(1, 2 * (1 - swap)) },
          { facts: f, key: signature(f), opacity: swap },
        ];
      }
      return [{ facts: f, key: signature(f), opacity: 1 }];
    };
    if (this.reduced) items.push({ id: "hero", layers: [{ facts, key: signature(facts), opacity: 1 }], view: heroView, yawDeg: 0, progress: 0, sticker: false });
    items.push({ id: "main", layers: layersOf(facts), view: mainView, yawDeg: yaw, progress, sticker: flying });
    const onScreen = items.some((item) => {
      const r = packRect(item.view, specFor(facts.format));
      return r[1] < vh && r[1] + r[3] > 0 && r[0] < vw && r[0] + r[2] > 0;
    });
    const key = `${this.mode}|${vw}|${vh}|${items.map((i) => `${i.id}:${fixed(i.view.cx, 1)},${fixed(i.view.cy, 1)},${fixed(i.view.focal, 1)},${fixed(i.view.camZ, 3)},${fixed(i.yawDeg, 2)},${fixed(i.progress, 4)},${i.sticker},${i.layers.map((l) => `${l.key}@${fixed(l.opacity, 3)}`).join("+")}`).join(";")}|${onScreen}`;
    if (!this.forced && key === this.lastKey) return;
    this.forced = false;
    this.lastKey = key;

    if (this.mode === "webgl" && this.webgl) {
      this.svg?.remove();
      this.svg = null;
      canvas.setAttribute("role", "img");
      canvas.removeAttribute("aria-hidden");
      if (!this.contextLost) this.webgl.draw(onScreen ? items : []);
    } else {
      canvas.removeAttribute("role");
      canvas.setAttribute("aria-hidden", "true");
      const svg = this.ensureSvg();
      svg.setAttribute("width", String(vw));
      svg.setAttribute("height", String(vh));
      svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
      svg.innerHTML = onScreen ? svgMarkup(items) : "";
    }
  }
}

function round2(r: Rect): Rect {
  return [Math.round(r[0] * 100) / 100, Math.round(r[1] * 100) / 100, Math.round(r[2] * 100) / 100, Math.round(r[3] * 100) / 100];
}

