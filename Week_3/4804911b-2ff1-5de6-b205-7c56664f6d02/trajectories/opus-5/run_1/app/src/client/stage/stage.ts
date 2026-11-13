import { rupees, dayMonthYear } from '../format.js';
import { reducedMotion } from '../dom.js';
import type { PackFacts } from '../types.js';
import {
  boundingRect,
  cameraFor,
  clamp01,
  FRONT_BOX,
  PANEL_GEOMETRY,
  frontPoint,
  panelPoint,
  project,
  rectCorners,
  scaleFor,
  formatQuad,
  formatRect,
  sliderValueText,
  stickerIsSeated,
  stickerPanelQuad,
  yawFor,
  type Camera,
  type PackFormat,
  type Point,
} from './geometry.js';
import {
  createSvgRenderer,
  createWebglRenderer,
  packScreenRect,
  type PackLayer,
  type Renderer,
} from './render.js';
import { buildFrontTexture, buildPanelTexture, buildStickerTexture, sideTexture } from './textures.js';

export const SWAP_EASING = [0.2, 0, 0, 1] as const;
const PACK_SWAP_MS = 320;
export const MIRROR_SWAP_MS = 180;

/** The published swap curve: two control points at 0.2, 0 and 0, 1. */
export function swapEase(t: number): number {
  const clamped = clamp01(t);
  const [x1, y1, x2, y2] = SWAP_EASING;
  const bezier = (a: number, b: number, time: number): number =>
    3 * a * time * (1 - time) * (1 - time) + 3 * b * time * time * (1 - time) + time * time * time;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (bezier(x1, x2, middle) < clamped) low = middle;
    else high = middle;
  }
  return bezier(y1, y2, (low + high) / 2);
}

function panelLinesFor(facts: PackFacts): string[] {
  const lines = [
    `MRP Rs ${rupees(facts.printedMrpPaise)}`,
    `Packed ${dayMonthYear(facts.packedDate)}`,
    `Best before ${dayMonthYear(facts.bestBeforeDate)}`,
  ];
  if (facts.unitSalePrice !== null) {
    lines.push(`Rs ${facts.unitSalePrice.rupees} per ${facts.unitSalePrice.per}`);
  }
  if (facts.revisedMrpPaise !== null) lines.push(`Revised MRP Rs ${rupees(facts.revisedMrpPaise)}`);
  if (facts.oldWrapper) lines.push('Old wrapper');
  return lines;
}

function variantOf(facts: PackFacts): string {
  return facts.skuName.startsWith(`${facts.drinkName} `)
    ? facts.skuName.slice(facts.drinkName.length + 1)
    : facts.skuName;
}

function layerFor(facts: PackFacts, alpha: number): PackLayer {
  const lines = panelLinesFor(facts);
  const mrpLine = lines[0];
  const variant = variantOf(facts);
  const stickerLine =
    facts.revisedMrpPaise === null ? '' : `Revised MRP Rs ${rupees(facts.revisedMrpPaise)}`;
  return {
    format: facts.format,
    frontTexture: buildFrontTexture(facts.format, facts.drinkName, variant),
    panelTexture: buildPanelTexture(facts.format, { mrpLine, lines: lines.slice(1), revisedLine: stickerLine }),
    stickerTexture: facts.stickerApplies ? buildStickerTexture(stickerLine) : null,
    stickerQuad: null,
    panelLines: lines.slice(1),
    mrpLine,
    frontLines: { name: facts.drinkName, variant },
    stickerLine,
    alpha,
  };
}

function orderClockwiseFromTopLeft(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => b.x - a.x);
  return [...top, ...bottom];
}

export interface StageElements {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  svg: SVGElement;
  scrollContainer: HTMLElement;
  slider: HTMLInputElement | null;
  hero: HTMLElement | null;
  heroCanvas: HTMLCanvasElement | null;
}

export class PackStage {
  private facts: PackFacts | null = null;
  private layers: { facts: PackFacts; layer: PackLayer }[] = [];
  private swapStartedAt = 0;
  private swapping = false;
  private webgl: Renderer | null = null;
  private svgRenderer: Renderer;
  private readonly side = sideTexture();
  private renderer: 'webgl' | 'svg' = 'svg';
  private contextLost = false;
  private stillView: 'front' | 'back' | 'sticker' = 'front';
  private lastProgress = 0;

  constructor(private readonly elements: StageElements) {
    this.svgRenderer = createSvgRenderer(elements.svg);
    this.webgl = createWebglRenderer(elements.canvas, this.side);
    this.renderer = this.webgl === null ? 'svg' : 'webgl';
    elements.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.renderer = 'svg';
      this.frame();
    });
    elements.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.webgl = createWebglRenderer(elements.canvas, this.side);
      this.renderer = this.webgl === null ? 'svg' : 'webgl';
      this.frame();
    });
    const loop = (): void => {
      this.frame();
      window.requestAnimationFrame(loop);
    };
    window.requestAnimationFrame(loop);
  }

  setFacts(facts: PackFacts): void {
    const previous = this.layers.length > 0 ? this.layers[this.layers.length - 1] : null;
    this.facts = facts;
    const fresh = { facts, layer: layerFor(facts, 1) };
    if (previous === null || reducedMotion()) {
      this.layers = [fresh];
      this.swapping = false;
    } else {
      this.layers = [previous, fresh];
      this.swapStartedAt = performance.now();
      this.swapping = true;
    }
    this.frame();
  }

  currentFacts(): PackFacts | null {
    return this.facts;
  }

  setStillView(view: 'front' | 'back' | 'sticker'): void {
    this.stillView = view;
    this.frame();
  }

  stillViewNow(): 'front' | 'back' | 'sticker' {
    return this.stillView;
  }

  progress(): number {
    if (reducedMotion()) {
      return this.stillView === 'front' ? 0 : this.stillView === 'back' ? 0.55 : 1;
    }
    const container = this.elements.scrollContainer;
    const top = container.offsetTop;
    const run = Math.max(1, window.innerHeight * 4);
    return clamp01((window.scrollY - top) / run);
  }

  /** The page offset at which the scrub reads this progress. */
  offsetFor(progress: number): number {
    return this.elements.scrollContainer.offsetTop + clamp01(progress) * window.innerHeight * 4;
  }

  private safeBox(): { width: number; height: number } {
    const box = this.elements.stage.getBoundingClientRect();
    return { width: Math.max(120, box.width - 24), height: Math.max(160, box.height - 96) };
  }

  private cameraNow(progress: number, format: PackFormat): Camera {
    const box = this.elements.stage.getBoundingClientRect();
    const safe = this.safeBox();
    return {
      yawDegrees: yawFor(progress),
      cameraZ: cameraFor(progress),
      scale: scaleFor(format, safe.width, safe.height),
      centreX: box.width / 2,
      centreY: box.height / 2,
    };
  }

  private frame(): void {
    const facts = this.facts;
    const stage = this.elements.stage;
    if (facts === null) return;
    const progress = this.progress();
    this.lastProgress = progress;
    const camera = this.cameraNow(progress, facts.format);
    const quad = facts.stickerApplies ? stickerPanelQuad(facts.format, progress) : null;

    let swapProgress = 1;
    if (this.swapping) {
      const elapsed = performance.now() - this.swapStartedAt;
      swapProgress = clamp01(elapsed / PACK_SWAP_MS);
      const eased = swapEase(swapProgress);
      this.layers[0].layer.alpha = 1 - eased;
      this.layers[1].layer.alpha = eased;
      if (swapProgress >= 1) {
        this.layers = [this.layers[this.layers.length - 1]];
        this.layers[0].layer.alpha = 1;
        this.swapping = false;
      }
    }

    const layers = this.layers.map((entry, index) => ({
      ...entry.layer,
      stickerQuad: index === this.layers.length - 1 ? quad : null,
    }));

    const box = stage.getBoundingClientRect();
    const scene = {
      camera,
      layers,
      width: box.width,
      height: box.height,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    };

    const useWebgl = this.renderer === 'webgl' && this.webgl !== null && !this.contextLost;
    if (useWebgl) {
      (this.webgl as Renderer).draw(scene);
      this.elements.svg.setAttribute('hidden', '');
      this.elements.svg.setAttribute('aria-hidden', 'true');
      this.elements.canvas.removeAttribute('aria-hidden');
      this.elements.canvas.style.visibility = 'visible';
    } else {
      this.svgRenderer.draw(scene);
      this.elements.svg.removeAttribute('hidden');
      this.elements.svg.removeAttribute('aria-hidden');
      this.elements.canvas.setAttribute('aria-hidden', 'true');
      this.elements.canvas.style.visibility = 'hidden';
    }

    const panelCorners = rectCorners({ x: 0, y: 0, w: 1, h: 1 }).map((corner) => {
      const point = panelPoint(facts.format, corner.x, corner.y);
      return project(camera, point.x, point.y, point.z);
    });
    const mrpCorners = rectCorners(PANEL_GEOMETRY[facts.format].mrp).map((corner) => {
      const point = panelPoint(facts.format, corner.x, corner.y);
      return project(camera, point.x, point.y, point.z);
    });
    const frontCorners = rectCorners(FRONT_BOX).map((corner) => {
      const point = frontPoint(facts.format, corner.x, corner.y);
      return project(camera, point.x, point.y, point.z);
    });
    const screenQuad =
      quad === null
        ? []
        : orderClockwiseFromTopLeft(
            quad.map((corner) => {
              const point = panelPoint(facts.format, corner.x, corner.y);
              return project(camera, point.x, point.y, point.z);
            }),
          );

    const offsetX = box.left + window.scrollX - window.scrollX;
    const offsetY = box.top;
    const shift = (rect: { x: number; y: number; w: number; h: number }) => ({
      x: rect.x + box.left,
      y: rect.y + offsetY,
      w: rect.w,
      h: rect.h,
    });
    void offsetX;

    const yaw = camera.yawDegrees;
    stage.dataset.packProgress = progress.toFixed(4);
    stage.dataset.packYaw = yaw.toFixed(2);
    stage.dataset.cameraZ = camera.cameraZ.toFixed(3);
    stage.dataset.sticker = facts.stickerApplies && stickerIsSeated(progress) ? 'seated' : 'none';
    stage.dataset.renderer = useWebgl ? 'webgl' : 'svg';
    stage.dataset.format = facts.format;
    stage.dataset.sku = facts.skuCode;
    stage.dataset.batch = facts.batchCode;
    stage.dataset.swapProgress = swapProgress.toFixed(3);
    stage.dataset.mrpRect = formatRect(PANEL_GEOMETRY[facts.format].mrp);
    stage.dataset.stickerRect = formatRect(PANEL_GEOMETRY[facts.format].sticker);
    const layer = layers[layers.length - 1];
    stage.dataset.panelText = [layer.mrpLine, ...layer.panelLines].join(' | ');
    stage.dataset.frontText = `${facts.drinkName} | ${layer.frontLines.variant}`;
    stage.dataset.mrpScreenRect = formatRect(shift(boundingRect(mrpCorners)));
    stage.dataset.stickerScreenQuad =
      screenQuad.length === 0
        ? ''
        : formatQuad(screenQuad.map((corner) => ({ x: corner.x + box.left, y: corner.y + offsetY })));
    stage.dataset.panelScreenRect = yaw < 90 ? '' : formatRect(shift(boundingRect(panelCorners)));
    stage.dataset.frontScreenRect = yaw >= 90 ? '' : formatRect(shift(boundingRect(frontCorners)));
    stage.dataset.packScreenRect = formatRect(shift(packScreenRect(camera, facts.format)));

    this.updateSlider(progress);
    this.updateHero();
  }

  private updateSlider(progress: number): void {
    const slider = this.elements.slider;
    if (slider === null) return;
    const value = Math.round(progress * 100);
    if (document.activeElement !== slider) slider.value = String(value);
    slider.setAttribute('aria-valuenow', String(value));
    slider.setAttribute('aria-valuetext', sliderValueText(progress));
  }

  private updateHero(): void {
    const hero = this.elements.hero;
    const heroCanvas = this.elements.heroCanvas;
    const facts = this.facts;
    if (hero === null || heroCanvas === null || facts === null) return;
    const container = this.elements.scrollContainer;
    const pinAt = Math.max(1, container.offsetTop);
    const archOpen = reducedMotion() ? 1 : clamp01(window.scrollY / pinAt);
    hero.dataset.archOpen = archOpen.toFixed(4);

    const arch = hero.querySelector('[data-arch]') as HTMLElement | null;
    if (arch !== null) {
      const archBox = arch.getBoundingClientRect();
      hero.dataset.archScreenRect = `${round(archBox.left)},${round(archBox.top)},${round(archBox.width)},${round(
        archBox.height,
      )}`;
      const stageBox = this.elements.stage.getBoundingClientRect();
      const target = packScreenRect(this.cameraNow(0, facts.format), facts.format);
      const targetRect = {
        x: target.x + stageBox.left,
        y: target.y + stageBox.top,
        w: target.w,
        h: target.h,
      };
      const startRect = {
        x: archBox.left + archBox.width * 0.18,
        y: archBox.top + archBox.height * 0.2,
        w: archBox.width * 0.46,
        h: archBox.height * 0.62,
      };
      const mix = (from: number, to: number): number => from + (to - from) * archOpen;
      const now = {
        x: mix(startRect.x, targetRect.x),
        y: mix(startRect.y, targetRect.y),
        w: mix(startRect.w, targetRect.w),
        h: mix(startRect.h, targetRect.h),
      };
      hero.dataset.packScreenRect = `${round(now.x)},${round(now.y)},${round(now.w)},${round(now.h)}`;
      heroCanvas.style.left = `${now.x}px`;
      heroCanvas.style.top = `${now.y}px`;
      heroCanvas.style.width = `${now.w}px`;
      heroCanvas.style.height = `${now.h}px`;
      heroCanvas.style.opacity = archOpen >= 0.999 ? '0' : '1';
      this.elements.canvas.style.opacity = archOpen >= 0.999 || reducedMotion() ? '1' : '0';
      this.elements.svg.style.opacity = archOpen >= 0.999 || reducedMotion() ? '1' : '0';
      this.drawHero(heroCanvas, facts, now);
    }
  }

  private drawHero(canvas: HTMLCanvasElement, facts: PackFacts, rect: { w: number; h: number }): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.w * ratio));
    const height = Math.max(1, Math.round(rect.h * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.w, rect.h);
    const front = this.layers[this.layers.length - 1]?.layer.frontTexture;
    if (front === undefined) return;
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.5)';
    context.shadowBlur = rect.w * 0.08;
    context.drawImage(front, 0, 0, rect.w, rect.h);
    context.restore();
    void facts;
  }
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
