import { Color, WebGLRenderer, SRGBColorSpace, ACESFilmicToneMapping } from "three";

import type { Disposables } from "../Disposables";
import type { SceneId, Stage } from "../stage";
import type { Quality } from "./quality";
import type { SceneFactory, WorldScene } from "./types";

/**
 * One fixed canvas under the page. Text chapters are opaque and cover it; scene windows
 * (`[data-scene]`) are transparent, so whichever scene covers the most of the viewport is drawn.
 * Nothing is rendered while only text chapters are on screen.
 */
export class Experience {
  private readonly renderer: WebGLRenderer;
  private readonly scenes = new Map<SceneId, WorldScene>();
  private width = window.innerWidth;
  private height = window.innerHeight;
  private lost = false;
  /** The inputs of the last drawn frame, and whether that scene was still moving. */
  private drawn = "";
  private moving = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly quality: Quality,
    disposables: Disposables,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !quality.software,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(new Color(0x0d0a1e), 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.resize();
    disposables.listen(window, "resize", () => this.resize());
    disposables.listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
      document.documentElement.classList.add("no-webgl");
    });
  }

  /** Builds each scene and compiles its shaders, reporting progress for the preloader. */
  async build(factories: Record<SceneId, SceneFactory>, onStep: () => void) {
    for (const [id, factory] of Object.entries(factories) as Array<[SceneId, SceneFactory]>) {
      const world = factory(this.quality);
      world.resize(this.width, this.height);
      this.scenes.set(id, world);
      if (this.renderer.extensions.has("KHR_parallel_shader_compile")) {
        await this.renderer.compileAsync(world.scene, world.camera);
      } else {
        this.renderer.compile(world.scene, world.camera);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      onStep();
    }
  }

  private resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const scale = this.quality.renderScale;
    this.renderer.setPixelRatio(this.quality.pixelRatio * scale);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.scenes.forEach((world) => world.resize(this.width, this.height));
  }

  /**
   * Draws the current scene, but only when something it depends on changed (which scene, its scroll
   * progress, the pointer, the size) or the scene said it is still moving. A still page costs nothing.
   */
  render(stage: Stage, elapsed: number, delta: number) {
    if (this.lost || !stage.current) return;
    const world = this.scenes.get(stage.current);
    if (!world) return;
    const id = stage.current;
    const inputs = `${id} ${stage.progress[id]} ${stage.window[id]} ${stage.pointer.x} ${stage.pointer.y} ${this.width}x${this.height}`;
    if (!this.moving && inputs === this.drawn) return;
    this.moving = world.update({ elapsed, delta, progress: stage.progress[id], window: stage.window[id], stage, quality: this.quality });
    this.renderer.render(world.scene, world.camera);
    this.drawn = inputs;
  }

  dispose() {
    this.scenes.forEach((world) => world.dispose());
    this.scenes.clear();
    this.renderer.dispose();
  }
}
