import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SceneModel, SceneSnapshot } from './model.js';

export function useSceneSnapshot(model: SceneModel): SceneSnapshot {
  return useSyncExternalStore(model.subscribe, model.getSnapshot);
}

/** Follows the reduced-motion setting live, so an open page changes within the same frame. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
