import { NO_ENTITIES } from '../../../shared/copy.ts';
import { useScene, useSceneSlice, useSceneStore } from '../../store/index.ts';
import { EntityGrid } from './EntityGrid.tsx';

/** `grid "Entities"` for the screen's scene store (the live drawing or a published version). */
export function EntitiesPanel({ stopRef }: { stopRef: (element: HTMLElement | null) => void }) {
  const store = useSceneStore();
  const scene = useScene();
  const selected = useSceneSlice((snapshot) => snapshot.selection);
  return (
    <div className="entities">
      {scene.entities.length === 0 ? <p className="empty">{NO_ENTITIES}</p> : null}
      <EntityGrid
        scene={scene}
        selected={selected}
        onSelectOnly={(id) => store.selectOnly(id)}
        onToggle={(id) => store.toggleSelected(id)}
        onReveal={(id) => store.panToEntity(id)}
        stopRef={stopRef}
      />
    </div>
  );
}
