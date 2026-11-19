import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { INK, PAPER, SLATE } from './geometry';

type LabelStyle = 'name' | 'table';

const FONT_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const CANVAS_HEIGHT = 44;

/** A floating text pill (a display name, or a table id with its stepped countdown). */
export class Label {
  readonly sprite: Sprite;
  private text = '';
  private aspect = 1;

  constructor(private readonly style: LabelStyle) {
    this.sprite = new Sprite(new SpriteMaterial({ depthTest: false, transparent: true }));
    this.sprite.renderOrder = 1;
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    const font = `600 28px ${this.style === 'table' ? FONT_MONO : FONT_SANS}`;
    context.font = font;
    const width = Math.ceil(context.measureText(text).width) + 28;
    canvas.width = width;
    canvas.height = CANVAS_HEIGHT;
    context.font = font;
    context.fillStyle = this.style === 'table' ? SLATE : PAPER;
    context.globalAlpha = this.style === 'table' ? 0.96 : 0.94;
    context.beginPath();
    context.roundRect(1, 1, width - 2, CANVAS_HEIGHT - 2, CANVAS_HEIGHT / 2);
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 2;
    context.strokeStyle = this.style === 'table' ? SLATE : '#857D6C';
    context.stroke();
    context.fillStyle = this.style === 'table' ? PAPER : INK;
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    context.fillText(text, width / 2, CANVAS_HEIGHT / 2 + 1);
    const material = this.sprite.material;
    material.map?.dispose();
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    material.map = texture;
    material.needsUpdate = true;
    this.aspect = width / CANVAS_HEIGHT;
  }

  /** Keeps the pill the same size on screen whatever the camera distance: `cssPixels` tall. */
  fit(distance: number, worldPerPixel: number, cssPixels: number): void {
    const height = distance * worldPerPixel * cssPixels;
    this.sprite.scale.set(height * this.aspect, height, 1);
  }
}
