import type * as ThreeNS from "three";
import { Line } from "../api.js";
import { CrateCause, gridColumns } from "./crate.js";
import { drawStill } from "./still.js";
import type { SceneSpec } from "./scene.js";

interface CrateTarget {
  caseKey: string;
  canvas: HTMLCanvasElement;
  line: Line;
  turn: number;
  blockBg: () => "kraft" | "green";
}

interface Setup {
  renderer: ThreeNS.WebGLRenderer;
  canvas: HTMLCanvasElement;
  scene: typeof import("./scene.js");
}

/**
 * One WebGL context per document, shared by every crate: the single place that
 * decides whether a crate frame is drawn and what picture it holds.
 */
class CrateManager {
  private setupPromise: Promise<Setup | null> | null = null;
  private setup: Setup | null = null;
  private contextLost = false;
  private webglFailed = false;
  private targets = new Map<string, CrateTarget>();
  private queues = new Map<string, Promise<void>>();
  private lastDrawn = new Map<string, { version: number; turn: number; w: number; h: number }>();
  private listeners: ((lost: boolean) => void)[] = [];

  subscribe(cb: (lost: boolean) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  hasWebgl(): boolean {
    return this.setup !== null && !this.contextLost && !this.webglFailed;
  }

  register(target: CrateTarget): void {
    this.targets.set(target.caseKey, target);
  }

  unregister(caseKey: string): void {
    this.targets.delete(caseKey);
    this.lastDrawn.delete(caseKey);
    this.queues.delete(caseKey);
  }

  private getSetup(): Promise<Setup | null> {
    if (!this.setupPromise) {
      this.setupPromise = (async () => {
        try {
          const THREE = await import("three");
          const scene = await import("./scene.js");
          const canvas = document.createElement("canvas");
          const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: false,
          });
          canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            this.contextLost = true;
            for (const cb of this.listeners) cb(true);
            this.redrawAllStill();
          });
          canvas.addEventListener("webglcontextrestored", () => {
            this.contextLost = false;
            for (const cb of this.listeners) cb(false);
            void this.redrawAll("context-restored");
          });
          return { renderer, canvas, scene };
        } catch {
          this.webglFailed = true;
          return null;
        }
      })();
    }
    return this.setupPromise;
  }

  /** Draws one crate picture for one cause, one at a time per crate. */
  draw(
    caseKey: string,
    cause: CrateCause,
    spec?: { raised?: Map<number, { frac: number; cell: Line["cells"][number] }>; lidAngle?: number; stampScale?: number }
  ): Promise<void> {
    const prior = this.queues.get(caseKey) ?? Promise.resolve();
    const next = prior.then(() => this.drawNow(caseKey, cause, spec));
    this.queues.set(caseKey, next.catch(() => undefined));
    return next;
  }

  private async drawNow(
    caseKey: string,
    cause: CrateCause,
    spec?: { raised?: Map<number, { frac: number; cell: Line["cells"][number] }>; lidAngle?: number; stampScale?: number }
  ): Promise<void> {
    const target = this.targets.get(caseKey);
    if (!target) return;
    const bitmap = { w: target.canvas.width, h: target.canvas.height };
    if (bitmap.w === 0 || bitmap.h === 0) return;
    const last = this.lastDrawn.get(caseKey);
    const samePicture =
      last !== undefined &&
      last.version === target.line.version &&
      last.turn === target.turn &&
      last.w === bitmap.w &&
      last.h === bitmap.h;
    if (cause !== "sequence" && samePicture) return;

    const setup = this.setup ?? (await this.getSetup());
    if (!setup || this.contextLost || this.webglFailed) {
      this.drawStillPicture(target, bitmap);
      return;
    }
    const line = target.line;
    const sceneSpec: SceneSpec = {
      line,
      turn: target.turn,
      blockBg: target.blockBg(),
      columns: gridColumns(line.pack),
      raised: spec?.raised ?? new Map(),
      lidAngle: spec?.lidAngle ?? lidAngleFor(line.status),
      stampScale: spec?.stampScale ?? stampScaleFor(line.status),
    };
    const built = setup.scene.buildScene(sceneSpec);
    setup.renderer.setSize(bitmap.w, bitmap.h, false);
    setup.renderer.render(built.scene, built.camera);
    const ctx = target.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, bitmap.w, bitmap.h);
    ctx.drawImage(setup.canvas, 0, 0, bitmap.w, bitmap.h);
    this.lastDrawn.set(caseKey, { version: line.version, turn: target.turn, w: bitmap.w, h: bitmap.h });
  }

  private drawStillPicture(target: CrateTarget, bitmap: { w: number; h: number }): void {
    const ctx = target.canvas.getContext("2d")!;
    drawStill(ctx, target.line, gridColumns(target.line.pack), target.blockBg());
    this.lastDrawn.set(target.caseKey, {
      version: target.line.version,
      turn: target.turn,
      w: bitmap.w,
      h: bitmap.h,
    });
  }

  /** Sizes one crate canvas to its on-screen size times the capped ratio. */
  fitCanvas(canvas: HTMLCanvasElement): boolean {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.round(rect.width * ratio);
    const targetH = Math.round(rect.height * ratio);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      return true;
    }
    return false;
  }

  redrawAllStill(): void {
    for (const target of this.targets.values()) {
      this.drawStillPicture(target, { w: target.canvas.width, h: target.canvas.height });
    }
  }

  async redrawAll(cause: CrateCause): Promise<void> {
    await Promise.all([...this.targets.keys()].map((k) => this.draw(k, cause)));
  }

  async afterResize(): Promise<void> {
    for (const target of this.targets.values()) {
      this.fitCanvas(target.canvas);
    }
    await this.redrawAll("size");
  }
}

function lidAngleFor(status: string): number {
  return status === "sealed" || status === "taken_up" ? 0 : 100;
}

function stampScaleFor(status: string): number {
  return status === "sealed" || status === "taken_up" || status === "dropped" ? 1 : 0;
}

export const crateManager = new CrateManager();
