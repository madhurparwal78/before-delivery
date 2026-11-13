import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Scene } from '../../shared/geometry/index.ts';
import { MINIMUM_ROLE, atLeast } from '../../shared/rules.ts';
import type { DrawingStore } from './drawingStore.ts';
import type { SceneStore } from './sceneStore.ts';
import type { DrawingSnapshot, SceneSnapshot } from './types.ts';

const SceneStoreContext = createContext<SceneStore | null>(null);
const DrawingStoreContext = createContext<DrawingStore | null>(null);

/** Provides the live drawing store to the Drawing screen (it is also the scene store of the shared panels and the pane). */
export function DrawingStoreProvider({ store, children }: { store: DrawingStore; children: ReactNode }) {
  return (
    <DrawingStoreContext.Provider value={store}>
      <SceneStoreContext.Provider value={store}>{children}</SceneStoreContext.Provider>
    </DrawingStoreContext.Provider>
  );
}

/** Provides a read-only store (Review screen, view link) as the scene store. */
export function SceneStoreProvider({ store, children }: { store: SceneStore; children: ReactNode }) {
  return <SceneStoreContext.Provider value={store}>{children}</SceneStoreContext.Provider>;
}

function required<T>(store: T | null, name: string): T {
  if (store === null) throw new Error(`${name} used outside its provider`);
  return store;
}

/** The scene store of the screen: the live drawing store on Drawing, a review store on Review and View link. */
export function useSceneStore(): SceneStore {
  return required(useContext(SceneStoreContext), 'useSceneStore');
}

/** The live drawing store; only the Drawing screen provides it. */
export function useDrawingStore(): DrawingStore {
  return required(useContext(DrawingStoreContext), 'useDrawingStore');
}

/**
 * Subscribes to one slice of a store's snapshot. `select` must return a value that keeps its identity until that slice
 * changes (every field of the snapshots does), so the component re-renders only for its own slice.
 */
export function useStoreSlice<S, T>(store: { subscribe(listener: () => void): () => void; getSnapshot(): S }, select: (snapshot: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

/** A slice of the scene snapshot of the screen's store (selection, view, find, prompt...). */
export function useSceneSlice<T>(select: (snapshot: SceneSnapshot) => T): T {
  return useStoreSlice(useSceneStore(), select);
}

/** A slice of the live drawing's snapshot (connection, people, layers...). */
export function useDrawingSlice<T>(select: (snapshot: DrawingSnapshot) => T): T {
  return useStoreSlice(useDrawingStore(), select);
}

/** Whether the signed-in person's role on the drawing may take the action; a control for an action it may not take is not rendered. */
export function useMay(action: keyof typeof MINIMUM_ROLE): boolean {
  return useDrawingSlice((snapshot) => snapshot.info !== null && atLeast(snapshot.info.role, MINIMUM_ROLE[action]));
}

/** The scene, re-rendering the component whenever it changes (its objects are updated in place). */
export function useScene(): Scene {
  const store = useSceneStore();
  useStoreSlice(store, (snapshot) => snapshot.scene.version);
  return store.getSnapshot().scene;
}
