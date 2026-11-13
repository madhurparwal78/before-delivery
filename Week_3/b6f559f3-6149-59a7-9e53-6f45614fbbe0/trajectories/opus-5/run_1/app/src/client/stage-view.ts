import { el } from './dom';
import {
  build3D,
  createGlRenderer,
  draw2D,
  draw3DOnCanvas,
  drawBackground,
} from './stage';
import type { GlRenderer, StageInput } from './stage';

export class StageView {
  readonly element: HTMLElement;
  readonly renderer: 'webgl2' | 'canvas2d';
  private readonly base: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement | null;
  private readonly gl: GlRenderer | null;
  private width = 1440;
  private height = 810;
  private pending: (() => void) | null = null;

  constructor() {
    this.base = el('canvas', { 'aria-hidden': 'true' });
    const glCanvas = el('canvas', { 'aria-hidden': 'true' });
    const renderer = createGlRenderer(glCanvas);
    this.gl = renderer;
    this.overlay = renderer ? glCanvas : null;
    this.renderer = renderer ? 'webgl2' : 'canvas2d';
    this.element = el('div', { class: 'stage-surface' }, [
      this.base,
      this.overlay,
    ]);
  }

  setArtboard(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const canvas of [this.base, this.overlay]) {
      if (!canvas) continue;
      canvas.width = width;
      canvas.height = height;
    }
  }

  draw(input: StageInput, light: { level: number; focus: { x: number; y: number } }): void {
    const context = this.base.getContext('2d');
    if (!context) return;
    const scene = input.document.scenes.find((candidate) => candidate.id === input.sceneId);
    if (!scene) return;
    this.setArtboard(this.width, this.height);
    drawBackground(context, scene, this.width, this.height, light.focus, light.level);
    draw2D(context, input, () => {
      if (this.pending) return;
      this.pending = () => {
        this.pending = null;
        this.draw(input, light);
      };
      window.requestAnimationFrame(() => this.pending?.());
    });
    const draws = build3D(input);
    if (this.gl && this.overlay) {
      this.gl.draw(draws, this.width, this.height);
    } else {
      draw3DOnCanvas(context, draws);
    }
  }
}
