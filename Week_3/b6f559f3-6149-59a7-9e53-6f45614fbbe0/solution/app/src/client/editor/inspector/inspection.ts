import { useSyncExternalStore } from 'react';

/** What the person is inspecting: read-only selections that survive the Inspector unmounting (phone tabs). */
interface Inspection {
  vertex: string;
  node: string;
  clothPoint: string;
  particleNumber: number;
  sampleX: number;
  sampleY: number;
}

let current: Inspection = { vertex: '', node: '', clothPoint: '', particleNumber: 1, sampleX: 0, sampleY: 0 };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function inspect(patch: Partial<Inspection>): void {
  current = { ...current, ...patch };
  listeners.forEach((listener) => listener());
}

export const useInspection = (): Inspection => useSyncExternalStore(subscribe, () => current);
