import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { DraftingAid, SceneStore } from '../../store/index.ts';
import type { Panels } from '../workspace/usePanels.ts';

/** The function keys that toggle a drafting aid. */
const AID_KEYS: Readonly<Record<string, DraftingAid>> = { F3: 'snap', F8: 'ortho', F9: 'grid', F10: 'polar' };
const TEXT_FIELD = 'input, textarea, select, [contenteditable="true"]';
/** Dialogs and menus handle their own Tab, Escape and arrows. */
const OWN_KEYS = 'dialog, [role="menu"]';

function isTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(TEXT_FIELD);
}

interface KeyboardMapParts {
  /** the live drawing's store; null on the read-only screens (no undo, redo or erase) */
  edit: { undo: () => void; redo: () => void; erase: () => void; hasSelection: () => boolean } | null;
  store: SceneStore;
  panels: Panels;
  command: RefObject<HTMLInputElement | null>;
  /** the element of `region "Drawing"` */
  drawingRegion: () => HTMLElement | null;
}

/**
 * The document-level keyboard map of the Drawing and Review screens: printable keys go to Command, F6 cycles the regions, Escape leaves a
 * panel or Find, F3 F8 F9 F10 toggle the drafting aids, Ctrl+Z and Ctrl+Shift+Z undo and redo, Delete erases the selection.
 */
export function useKeyboardMap(parts: KeyboardMapParts): void {
  const { edit, store, panels, command, drawingRegion } = parts;
  useEffect(() => {
    function cycle(backwards: boolean): void {
      const stops = panels.layout === 'phone'
        ? panels.openStops()
        : [command.current, drawingRegion(), ...panels.openStops()].filter((stop): stop is HTMLElement => stop !== null);
      if (stops.length === 0) return;
      const at = stops.findIndex((stop) => stop.contains(document.activeElement));
      const next = at < 0 ? (backwards ? stops.length - 1 : 0) : (at + (backwards ? -1 : 1) + stops.length) % stops.length;
      stops[next].focus();
    }

    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof Element && target.closest(OWN_KEYS) && event.key !== 'F6') return;
      if (event.key === 'F6') {
        event.preventDefault();
        cycle(event.shiftKey);
      } else if (Object.hasOwn(AID_KEYS, event.key)) {
        event.preventDefault();
        store.toggleAid(AID_KEYS[event.key]);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        const emptyCommand = target === command.current && command.current?.value === '';
        if (!edit || (isTextField(target) && !emptyCommand)) return;
        event.preventDefault();
        if (event.shiftKey) edit.redo();
        else edit.undo();
      } else if (event.key === 'Delete') {
        if (!edit || isTextField(target) || !edit.hasSelection()) return;
        event.preventDefault();
        edit.erase();
      } else if (event.key === 'Escape') {
        if (target === command.current) return;
        if (target instanceof Element && target.closest('[role="search"]')) {
          event.preventDefault();
          store.closeFind();
        } else if (panels.openStops().some((stop) => stop.contains(document.activeElement))) {
          event.preventDefault();
          command.current?.focus();
        }
      } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTextField(target)) return;
        command.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [edit, store, panels, command, drawingRegion]);
}
