import { lengthText, normaliseUnits } from '../shared/units.js';
import type { Units } from '../shared/units.js';

const storageKey = 'kb-editor-units';
const listeners = new Set<(units: Units) => void>();

export function editorUnits(): Units {
  return normaliseUnits(window.localStorage.getItem(storageKey));
}

export function setEditorUnits(units: Units): void {
  window.localStorage.setItem(storageKey, units);
  for (const listener of listeners) listener(units);
}

export function onEditorUnits(listener: (units: Units) => void): void {
  listeners.add(listener);
}

export function editorLength(mm: number): string {
  return lengthText(mm, editorUnits());
}
