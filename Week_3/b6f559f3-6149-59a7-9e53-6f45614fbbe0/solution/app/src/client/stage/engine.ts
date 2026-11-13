/** One scene renderer for every surface: a 2D canvas for the flat layers and light, WebGL2 or Canvas2D for the solids. */
import { drawUnder } from './under2d';
import { CanvasStage } from './canvasRenderer';
import { drawItems, partsOf, prepare, type Prepared, type Rect, type SceneState } from './display';
import { ThreeStage } from './threeRenderer';
import type { AssetLoader } from './assets';
import { bool, str } from '../../shared/evaluator/resolve';
import { projectPoint } from '../../shared/projection';
import { vec } from '../../shared/projection';
import { transformOf } from '../../shared/evaluator/solids';
import { num } from '../../shared/evaluator/resolve';

export type RendererKind = 'webgl2' | 'canvas2d';

const MAX_UNDER_WIDTH = 1440;

export class SceneEngine {
  readonly kind: RendererKind;
  prepared: Prepared | null = null;
  private readonly under: HTMLCanvasElement;
  private readonly over: HTMLCanvasElement | null;
  private readonly three: ThreeStage | null;
  private readonly flat = new CanvasStage();
  private sized = '';

  constructor(
    host: HTMLElement,
    wantWebgl: boolean,
    private readonly loader: AssetLoader,
  ) {
    this.under = document.createElement('canvas');
    this.under.className = 'scene-canvas scene-under';
    host.appendChild(this.under);
    let three: ThreeStage | null = null;
    let over: HTMLCanvasElement | null = null;
    if (wantWebgl) {
      over = document.createElement('canvas');
      over.className = 'scene-canvas scene-over';
      three = ThreeStage.create(over);
      if (three) host.appendChild(over);
      else over = null;
    }
    this.three = three;
    this.over = over;
    this.kind = three ? 'webgl2' : 'canvas2d';
  }

  /** The canvases, so a host can capture or style them. */
  get canvases(): HTMLCanvasElement[] {
    return this.over ? [this.under, this.over] : [this.under];
  }

  render(state: SceneState, cssWidth: number, cssHeight: number, dpr: number): void {
    for (const info of state.assets.values()) if (info.kind !== 'svg') this.loader.request(info);
    const prepared = prepare(state);
    this.prepared = prepared;
    const board = prepared.scenery.artboard;
    const width = Math.max(1, Math.round(Math.min(cssWidth * Math.min(dpr, 2), MAX_UNDER_WIDTH)));
    const height = Math.max(1, Math.round((width * board.height) / board.width));
    const size = `${width}x${height}:${cssWidth}x${cssHeight}:${dpr}`;
    if (size !== this.sized) {
      this.sized = size;
      this.under.width = width;
      this.under.height = height;
      this.three?.resize(cssWidth, cssHeight, dpr);
    }
    const ctx = this.under.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const scene = prepared.scenery.scene;
    drawUnder({
      ctx,
      width,
      height,
      artboardWidth: board.width,
      scenery: prepared.scenery,
      background: state.scene.background,
      environment: str(scene.values, 'environment', state.scene.environment),
      lightOn: state.scene.light.enabled,
      lightFocus: state.lightFocus,
      loader: this.loader,
      assets: state.assets,
    });
    const items = drawItems(prepared.solids);
    const parts = (item: (typeof items)[number]) => partsOf(item.solid, state, prepared, this.loader);
    if (this.three) this.three.render(items, parts, scene.camera, board, state.scene.environment);
    else this.flat.render(ctx, items, parts, scene.camera, board, width / board.width);
  }

  destroy(): void {
    this.three?.destroy();
    this.under.remove();
    this.over?.remove();
  }
}

export interface Placeholder {
  name: string;
  rect: Rect;
}

/** Boxes for layers whose stored asset cannot be loaded, in artboard pixels. */
export function placeholders(prepared: Prepared, loader: AssetLoader): Placeholder[] {
  const out: Placeholder[] = [];
  const board = prepared.scenery.artboard;
  const camera = prepared.scenery.scene.camera;
  const walk = (parent: string | null): void => {
    for (const rl of prepared.scenery.layers.filter((l) => l.layer.parentId === parent)) {
      if (!bool(rl.values, 'visible', true)) continue;
      const kind = rl.layer.kind;
      if (kind === 'Group') {
        walk(rl.layer.id);
        continue;
      }
      const assetId = kind === 'Image' ? rl.values['assetId'] : kind === 'Model' ? rl.values['modelAssetId'] : kind === 'Extrusion' ? rl.values['svgAssetId'] : null;
      if (typeof assetId !== 'string' || loader.state(assetId) !== 'unavailable') continue;
      if (kind === 'Image') {
        const x = num(rl.values, 'x');
        const y = num(rl.values, 'y');
        out.push({ name: rl.layer.name, rect: { left: x, top: y, right: x + num(rl.values, 'width', 200), bottom: y + num(rl.values, 'height', 200) } });
        continue;
      }
      const transform = transformOf(rl.values);
      const corners = [vec(-0.5, -0.5, 0), vec(0.5, 0.5, 0)].map((c) =>
        projectPoint(vec(transform.position.x + c.x * transform.scale.x, transform.position.y + c.y * transform.scale.y, transform.position.z), camera, board),
      );
      const [a, b] = corners;
      if (a && b) out.push({ name: rl.layer.name, rect: { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) } });
    }
  };
  walk(null);
  return out;
}
