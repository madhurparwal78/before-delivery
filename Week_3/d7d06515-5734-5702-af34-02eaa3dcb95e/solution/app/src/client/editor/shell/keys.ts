// Editor shortcuts and the typing redirect. They work from any focused editor control, buttons included.
import { useEffect, type RefObject } from 'react';
import { snapsAtPointer } from '../canvas/snap.ts';
import { expects } from '../commandLine/machine.ts';
import type { EditorStore } from '../store.ts';

const FUNCTION_AIDS = { F3: 'osnap', F8: 'ortho', F9: 'grid', F10: 'polar', F11: 'otrack' } as const;
/** Where a printable key is typed into the command line instead of doing nothing. */
const REDIRECT_FROM = '.canvas-host, .ribbon, .status-bar, .layout-bar, .editor-header';

const inTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  || (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type))
  || (target instanceof HTMLElement && target.isContentEditable);

export function useEditorKeys(root: RefObject<HTMLElement | null>, store: EditorStore, panelOverlays: boolean): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      // With nothing focused the target is the body: keys still belong to the editor.
      if (!(target instanceof Element) || !(target === document.body || root.current?.contains(target)) || event.defaultPrevented) return;
      const control = event.ctrlKey || event.metaKey;
      const aid = event.key in FUNCTION_AIDS ? FUNCTION_AIDS[event.key as keyof typeof FUNCTION_AIDS] : null;

      if (event.key === 'F1') {
        event.preventDefault();
        store.setState({ dialog: 'reference' });
      } else if (aid) {
        event.preventDefault();
        store.toggleAid(aid);
      } else if (control && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        store.setState({ dialog: 'export' });
      } else if (control && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') && !inTextField(target)) {
        event.preventDefault();
        store.session.start(event.key.toLowerCase() === 'z' && !event.shiftKey ? 'UNDO' : 'REDO');
      } else if (event.key === 'Escape') {
        if (panelOverlays && store.current.activePanel && target.closest('.panel-host')) {
          store.setActivePanel(null);
          store.focusCommandLine();
        } else if (!inTextField(target) && !target.closest('[role="menu"], .panel-host')) {
          store.session.escape();
        }
      } else if (event.key === 'Tab' && !event.shiftKey && (target === store.commandInput || target.closest('.canvas-host'))
        && expects(store.current.machine) === 'point' && snapsAtPointer(store).length > 0) {
        // Tab cycles through the snap candidates around the pointer.
        event.preventDefault();
        store.hud.update({ cycle: store.hud.get().cycle + 1 });
      } else if (event.key.length === 1 && event.key !== ' ' && !control && !event.altKey && (target === document.body || target.closest(REDIRECT_FROM))) {
        // Focus moves before the key is inserted, so the character lands in the command line.
        store.focusCommandLine();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [root, store, panelOverlays]);
}
