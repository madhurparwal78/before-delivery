import type { OutputBus, SetDocument } from "../../shared/types.ts";
import type { Transport } from "./clock.ts";
import type { EffectiveLayer } from "./evaluate.ts";
import type { GizmoMode } from "./renderer.ts";
import type { ScriptHost } from "./scripts.ts";

/** Everything the stage needs from whoever owns the set: the editor store or the show page. */
export interface StageSource {
  readonly doc: SetDocument;
  readonly transport: Transport;
  readonly scripts: ScriptHost;
  readonly selection: string | null;
  readonly gizmoMode: GizmoMode;
  readonly gridSnap: boolean;
  readonly angleSnap: boolean;
  readonly scrubbing: { layerId: string; path: string } | null;
  readonly editorChrome: boolean;
  readonly bus: OutputBus | null;
  readonly animate: ((beat: number, effective: Map<string, EffectiveLayer>) => void) | null;
  shaderText(layerId: string, version: number): string | undefined;
  onDraw(listener: () => void): () => void;
  requestDraw(): void;
  preview(layerId: string, path: string, value: number): void;
  setLayerValue(layerId: string, path: string, value: unknown): unknown;
  frameDone(): void;
}
