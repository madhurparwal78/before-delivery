import { useEffect } from 'react';

interface Layer {
  id: number;
  priority: number;
  onEscape: () => void;
}

/** Menus and lists sit above confirmations, which sit above plain dialogs. */
export const LAYER_DIALOG = 1;
export const LAYER_CONFIRMATION = 2;
export const LAYER_POPUP = 3;

let layers: Layer[] = [];
let nextId = 1;
let installed = false;

function topmost(): Layer | null {
  let found: Layer | null = null;
  for (const layer of layers) {
    if (found === null || layer.priority >= found.priority) found = layer;
  }
  return found;
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      const layer = topmost();
      if (layer === null) return;
      event.stopPropagation();
      event.preventDefault();
      layer.onEscape();
    },
    true,
  );
}

/** Escape closes only the topmost dialog, menu or list. */
export function useEscapeLayer(onEscape: (() => void) | null, priority = LAYER_DIALOG): void {
  useEffect(() => {
    if (onEscape === null) return undefined;
    install();
    const layer: Layer = { id: nextId, priority, onEscape };
    nextId += 1;
    layers = [...layers, layer];
    return () => {
      layers = layers.filter((candidate) => candidate.id !== layer.id);
    };
  }, [onEscape, priority]);
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}
