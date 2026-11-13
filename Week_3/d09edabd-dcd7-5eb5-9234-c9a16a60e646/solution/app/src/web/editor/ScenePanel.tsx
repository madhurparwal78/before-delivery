import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { heldByOther } from './locks';
import { drawPlacements, drawSceneOrder } from './model';
import { moveInScene, selectPlacement } from './placements';
import { useEditor } from './state';

const ROOM_ITEM = 'room';

/** The Scene tree: the room, and its placements in scene order, each carrying its drawn position. One Tab stop. */
export default function ScenePanel({ inSheet = false }: { inSheet?: boolean }) {
  const room = useEditor((s) => s.room);
  const placements = useEditor((s) => s.placements);
  const queue = useEditor((s) => s.queue);
  const preview = useEditor((s) => s.preview);
  const sceneOrder = useEditor((s) => s.sceneOrder);
  const selectedId = useEditor((s) => s.selectedId);
  useEditor((s) => s.locks);
  const dropSteps = useEditor((s) => s.dropSteps);
  const drop = useEditor((s) => s.drop);
  const [stop, setStop] = useState<string>(ROOM_ITEM);
  const items = useRef(new Map<string, HTMLElement>());
  const refocus = useRef<string | null>(null);

  const drawn = useMemo(() => drawPlacements(placements, queue, preview), [placements, queue, preview]);
  const order = useMemo(() => drawSceneOrder(sceneOrder, queue), [sceneOrder, queue]);
  const byId = useMemo(() => new Map(drawn.map((p) => [p.id, p])), [drawn]);
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const known = new Set(order);
  const sequence = [...ordered, ...drawn.filter((p) => !known.has(p.id))];
  const focusables = [ROOM_ITEM, ...sequence.map((p) => p.id)];

  useLayoutEffect(() => {
    if (refocus.current) items.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  if (!room) return null;

  const focusAt = (index: number): void => {
    const id = focusables[Math.max(0, Math.min(focusables.length - 1, index))]!;
    setStop(id);
    items.current.get(id)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, id: string): void => {
    const index = focusables.indexOf(id);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && id !== ROOM_ITEM) {
      event.preventDefault();
      refocus.current = id;
      moveInScene(id, event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (event.key === 'ArrowDown') focusAt(index + 1);
    else if (event.key === 'ArrowUp') focusAt(index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(focusables.length - 1);
    else if ((event.key === 'Enter' || event.key === ' ') && id !== ROOM_ITEM) selectPlacement(id);
    else return;
    event.preventDefault();
  };

  const register = (id: string) => (element: HTMLElement | null): void => {
    if (element) items.current.set(id, element);
    else items.current.delete(id);
  };

  return (
    <section className={`scene-panel ${inSheet ? 'in-sheet' : 'cluster column'}`} role="region" aria-label="Scene">
      <ul role="tree" aria-label="Scene" className="tree">
        <li
          role="treeitem"
          aria-level={1}
          aria-expanded="true"
          aria-selected={false}
          aria-label={room.name}
          tabIndex={stop === ROOM_ITEM ? 0 : -1}
          ref={register(ROOM_ITEM)}
          className="tree-room"
          onFocus={() => setStop(ROOM_ITEM)}
          onKeyDown={(event) => onKeyDown(event, ROOM_ITEM)}
        >
          <span className="tree-label">{room.name}</span>
        </li>
        <li role="none">
          <ul role="group" className="tree-children">
            {sequence.map((p, index) => {
              const holder = heldByOther('placement', p.id);
              const falling = drop?.id === p.id;
              const steps = dropSteps[p.id];
              return (
                <li
                  key={p.id}
                  role="treeitem"
                  aria-level={2}
                  aria-posinset={index + 1}
                  aria-setsize={sequence.length}
                  aria-selected={p.id === selectedId}
                  aria-label={p.label}
                  aria-describedby={holder ? `lock-${p.id}` : undefined}
                  tabIndex={stop === p.id ? 0 : -1}
                  ref={register(p.id)}
                  className="tree-item"
                  data-x-mm={Math.round(p.xMm)}
                  data-y-mm={Math.round(falling ? drop.yMm : p.yMm)}
                  data-z-mm={Math.round(p.zMm)}
                  data-rotation-deg={Math.round(p.rotationDeg)}
                  data-sim-steps={steps}
                  onFocus={() => setStop(p.id)}
                  onClick={() => selectPlacement(p.id)}
                  onKeyDown={(event) => onKeyDown(event, p.id)}
                >
                  <span className="tree-label">{p.label}</span>
                  {holder ? (
                    <span id={`lock-${p.id}`} className="visually-hidden">
                      Locked by {holder.displayName}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </li>
      </ul>
    </section>
  );
}
