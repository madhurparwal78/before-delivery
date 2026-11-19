import { useSyncExternalStore } from "react";
import type { EditorStore } from "../store/editor.ts";

const never = (): (() => void) => () => undefined;

export function useEditor(store: EditorStore | null): void {
  useSyncExternalStore(store ? store.subscribe : never, store ? store.getChangeCount : () => 0);
}

export function useFrames(store: EditorStore): number {
  return useSyncExternalStore(store.subscribeFrames, store.getFrameVersion);
}
