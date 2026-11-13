import { useEffect } from 'react';
import { useEditorStore } from './EditorProvider';

const TEXT_TYPES = new Set(['text', 'email', 'password', 'search', 'url', 'tel']);

/** True where keys must type as usual: text boxes, text areas and editable regions. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_TYPES.has(target.type);
}

/** Editor-wide shortcuts. They work anywhere in the editor except inside a text entry. */
export function useEditorShortcuts(): void {
  const store = useEditorStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTextEntry(event.target) || document.querySelector('dialog[open]')) return;
      const { selection, scene } = store.getSnapshot();
      const actions = store.actions;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const layerId = selection.length === 1 ? selection[0] : undefined;
      const layer = scene.layers.find((l) => l.id === layerId);
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && key === 'd' && layer) {
        event.preventDefault();
        void actions.applyWithIds([{ type: 'duplicateLayer', layerId: layer.id }], 'layers').then((ids) => {
          const copy = ids?.[`duplicate:${layer.id}`];
          if (copy) actions.select([copy]);
        });
      } else if (mod && key === 'g') {
        event.preventDefault();
        const ids = selection.filter((id) => scene.layers.some((l) => l.id === id));
        if (event.shiftKey) {
          const group = scene.layers.find((l) => l.id === layerId && l.kind === 'Group');
          if (group) actions.apply([{ type: 'ungroup', groupId: group.id }], undefined, 'layers');
        } else if (ids.length > 0) {
          void actions.applyWithIds([{ type: 'group', layerIds: ids }], 'layers').then((made) => {
            const id = Object.values(made ?? {})[0];
            if (id) actions.select([id]);
          });
        }
      } else if (event.key === 'Delete' && !mod && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) {
        const ids = selection.filter((id) => scene.layers.some((l) => l.id === id));
        if (ids.length === 0) return;
        event.preventDefault();
        actions.apply(ids.map((id) => ({ type: 'deleteLayer' as const, layerId: id })), undefined, 'layers');
        actions.select([]);
      } else if (key === 'k' && !mod && !event.altKey) {
        event.preventDefault();
        actions.addKeyframeAtPlayhead();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store]);
}
