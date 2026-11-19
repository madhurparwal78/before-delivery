import { useCallback, useMemo, useRef, useState } from 'react';
import { writeView } from '../lib/viewState.js';
import { useStore } from '../store.js';

interface Item {
  id: string;
  label: string;
  kind: 'piece' | 'block' | 'train' | 'end';
}

/** The roving item list: every piece, block, train and open end reachable by keyboard. */
export function StageItems(): JSX.Element {
  const { layout, session, view } = useStore();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo<Item[]>(() => {
    const rows: Item[] = [];
    for (const module of layout?.content.modules ?? []) {
      for (const end of module.open_ends) {
        rows.push({ id: end.id, label: `Open end ${end.label}`, kind: 'end' });
      }
      for (const piece of module.pieces) {
        rows.push({ id: piece.id, label: `Piece ${piece.id}`, kind: 'piece' });
      }
    }
    for (const block of session?.blocks ?? layout?.content.blocks ?? []) {
      rows.push({ id: block.id, label: `Block ${block.number} ${block.name}`, kind: 'block' });
    }
    for (const train of session?.trains ?? []) {
      rows.push({ id: train.id, label: `Train ${train.number}`, kind: 'train' });
    }
    return rows;
  }, [layout, session]);

  const choose = useCallback((item: Item) => {
    if (item.kind === 'piece') writeView({ piece: item.id, sheet: 'piece-inspector' });
    if (item.kind === 'end') writeView({ end: item.id, piece: null });
    if (item.kind === 'block') writeView({ block: item.id });
    if (item.kind === 'train') writeView({ train: item.id });
  }, []);

  const selectedId = view.piece ?? view.end ?? view.train ?? view.block ?? null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Stage items"
      data-testid="stage-items"
      className="stage-items"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          setActive((index) => Math.min(items.length - 1, index + 1));
          event.preventDefault();
        } else if (event.key === 'ArrowUp') {
          setActive((index) => Math.max(0, index - 1));
          event.preventDefault();
        } else if (event.key === 'Enter' || event.key === ' ') {
          const item = items[active];
          if (item) choose(item);
          event.preventDefault();
        }
      }}
      aria-activedescendant={items[active] ? `stage-item-${items[active].id}` : undefined}
    >
      {items.map((item, index) => (
        <div
          key={`${item.kind}-${item.id}`}
          id={`stage-item-${item.id}`}
          role="option"
          aria-label={item.label}
          aria-selected={item.id === selectedId || index === active}
          className="stage-item"
          onClick={() => {
            setActive(index);
            choose(item);
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
