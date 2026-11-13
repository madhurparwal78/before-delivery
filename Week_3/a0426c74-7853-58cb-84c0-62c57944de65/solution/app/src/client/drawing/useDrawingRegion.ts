import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

/** The pane element and a lookup of its `region "Drawing"`, which gets focus back from dialogs and menus and is a stop of F6. */
export function useDrawingRegion(): { paneRef: RefObject<HTMLDivElement | null>; drawingRegion: () => HTMLElement | null } {
  const paneRef = useRef<HTMLDivElement>(null);
  const drawingRegion = useCallback(() => paneRef.current?.querySelector<HTMLElement>('[aria-label="Drawing"]') ?? null, []);
  return { paneRef, drawingRegion };
}
