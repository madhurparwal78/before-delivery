import { hasOpenLayer, topLayerName } from '../ui/layers';
import { closeDialog, editor, openDialog } from './state';
import { deleteSelected, nudgeSelected, selectPlacement, setMode, startDrop, stepSelection, undoOwnChange, type Arrow } from './placements';
import { stepNode } from './nodes';
import { pressPlay } from './play';
import { turnCamera } from './camera';

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'datetime-local', 'date', 'time', '']);

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const modifier = event.ctrlKey || event.metaKey;
  const typing = inTextField(event.target);
  const layer = topLayerName();

  if (layer === 'Trigger graph' && !typing && !modifier && !event.altKey) {
    if (key === 'n') stepNode(event.shiftKey ? -1 : 1);
    else if (key === 't') closeDialog('graph');
    else return;
    event.preventDefault();
    return;
  }
  if (typing || hasOpenLayer()) return;
  if (modifier && (key === 'k' || key === 'z')) {
    event.preventDefault();
    if (key === 'k') openDialog('palette');
    else void undoOwnChange();
    return;
  }
  if (modifier || (event.altKey && ARROWS.has(key))) return;
  if ((event.target as HTMLElement | null)?.closest('[role="tree"]')) return;

  const { selectedId } = editor.get();
  const handled = (run: () => void): void => {
    event.preventDefault();
    run();
  };
  if (ARROWS.has(key)) {
    if (selectedId) handled(() => nudgeSelected(key as Arrow, event.shiftKey));
    else if ((event.target as HTMLElement | null)?.closest('[data-stage]')) handled(() => turnCamera(key as Arrow));
    return;
  }
  switch (key) {
    case 'g': return handled(() => setMode('move'));
    case 'r': return handled(() => setMode('rotate'));
    case 's': return handled(() => setMode('scale'));
    case ']': return handled(() => stepSelection(1));
    case '[': return handled(() => stepSelection(-1));
    case 'Delete': return handled(deleteSelected);
    case 'n': return handled(() => stepNode(event.shiftKey ? -1 : 1));
    case 'p': return handled(pressPlay);
    case 't': return handled(() => openDialog('graph'));
    case 'l': return handled(() => openDialog('props'));
    case '?': return handled(() => openDialog('shortcuts'));
    case 'd': return handled(startDrop);
    case 'Escape': return selectedId ? handled(() => selectPlacement(null)) : undefined;
    default:
  }
}

/** The editor's published keys, from whichever editor control has focus outside a text field. */
export function installKeys(): () => void {
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
