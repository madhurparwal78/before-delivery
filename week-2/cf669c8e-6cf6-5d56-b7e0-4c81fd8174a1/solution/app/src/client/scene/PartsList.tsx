import { useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useSceneSnapshot } from './hooks.js';
import type { SceneModel } from './model.js';

export interface PartsListHandle {
  /** Focus the row of the selected part, or the first row when nothing is selected (or the row with this id). */
  focusRow(id?: string): void;
}
interface PartsListProps {
  model: SceneModel;
  /** Called after the row was pressed (Enter, Space or click) and the part is selected in the scene. */
  onPick?: (id: string) => void;
}

export function PartsList({ model, onPick, ref }: PartsListProps & { ref?: Ref<PartsListHandle> }): ReactNode {
  const snap = useSceneSnapshot(model);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [roving, setRoving] = useState<string | null>(null);
  const ids = snap.parts.map((p) => p.id);
  const tabStop = roving && ids.includes(roving) ? roving : (snap.selectedPart || ids[0]);

  const focus = (id: string | undefined): void => {
    if (!id) return;
    setRoving(id);
    buttons.current.get(id)?.focus();
  };
  useImperativeHandle(ref, () => ({ focusRow: (id) => focus(id ?? (snap.selectedPart || ids[0])) }));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string): void => {
    const index = ids.indexOf(id);
    let next: string | undefined;
    if (event.key === 'ArrowDown') next = ids[Math.min(ids.length - 1, index + 1)];
    else if (event.key === 'ArrowUp') next = ids[Math.max(0, index - 1)];
    else if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids[ids.length - 1];
    else return;
    event.preventDefault();
    focus(next);
  };

  return (
    <ul className="parts-schedule" role="list" aria-label="Parts schedule">
      {snap.parts.map((part) => (
        <li
          key={part.id}
          className="parts-row"
          data-part-id={part.id}
          data-position-mm={part.position.join(',')}
          data-panel-fade={part.fade}
          data-screen-x={part.screen.x.toFixed(1)}
          data-screen-y={part.screen.y.toFixed(1)}
          data-selected={snap.selectedPart === part.id}
        >
          <button
            type="button"
            ref={(node) => { if (node) buttons.current.set(part.id, node); else buttons.current.delete(part.id); }}
            className="parts-pick"
            tabIndex={part.id === tabStop ? 0 : -1}
            aria-pressed={snap.selectedPart === part.id}
            onFocus={() => setRoving(part.id)}
            onKeyDown={(event) => onKeyDown(event, part.id)}
            onClick={() => { model.select(part.id); onPick?.(part.id); }}
          >
            {part.name}
          </button>
          <span className="parts-position num" aria-hidden="true">{part.position.join(', ')}</span>
          <span className="parts-dimension num" aria-hidden="true">{part.dimensionMm} mm</span>
        </li>
      ))}
    </ul>
  );
}
