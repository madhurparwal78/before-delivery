import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewUrlState } from './store/types';
import type { StoreState } from './store/store';

type StageItem =
  | { kind: 'piece'; id: string; label: string }
  | { kind: 'block'; id: string; label: string }
  | { kind: 'train'; id: string; label: string }
  | { kind: 'open-end'; id: string; label: string };

/** The roving Stage items list: Tab reaches it from the stage; arrows move, Enter selects. */
export function StageItemsList({ url, setUrl, state }: {
  url: ViewUrlState;
  setUrl: (patch: Partial<ViewUrlState>) => void;
  state: StoreState;
}): React.ReactElement | null {
  const items = useMemo<StageItem[]>(() => {
    const list: StageItem[] = [];
    const layout = state.layout;
    if (layout) {
      for (const m of layout.content.modules) {
        if (m.trashed) continue;
        for (const p of m.pieces) {
          list.push({ kind: 'piece', id: p.id, label: `Piece ${p.id}` });
        }
        for (const o of m.open_ends) {
          list.push({ kind: 'open-end', id: o.id, label: `Open end ${o.label}` });
        }
      }
      for (const b of layout.content.blocks) {
        list.push({ kind: 'block', id: b.id, label: `Block ${b.number} ${b.name}` });
      }
    }
    const session = url.mode === 'operate' ? state.session : null;
    if (session) {
      for (const t of session.trains) {
        list.push({ kind: 'train', id: t.id, label: `Train ${t.number}` });
      }
    }
    return list;
  }, [state.layout?.working_hash, state.session?.revision, url.mode]);

  const listRef = useRef<HTMLUListElement | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const activeIndex = useMemo(() => {
    const activeId = url.piece ?? url.block ?? url.train ?? url.end;
    if (!activeId) return -1;
    return items.findIndex((i) => i.id === activeId);
  }, [items, url.piece, url.block, url.train, url.end]);

  useEffect(() => {
    if (activeIndex >= 0) setFocusIndex(activeIndex);
  }, [activeIndex]);

  // Focus moves inside the list only when the list itself holds focus.
  const moveFocus = (delta: number) => {
    const next = Math.max(0, Math.min(items.length - 1, focusIndex + delta));
    setFocusIndex(next);
    const child = listRef.current?.children[next] as HTMLElement | undefined;
    child?.focus();
  };

  if (items.length === 0) return null;

  const select = (item: StageItem) => {
    switch (item.kind) {
      case 'piece':
        setUrl({ piece: item.id, dialog: 'piece-inspector', end: null, train: null, block: null });
        break;
      case 'block':
        setUrl({ block: item.id, piece: null, train: null, end: null, dialog: null });
        break;
      case 'train':
        setUrl({ train: item.id, piece: null, block: null, end: null, dialog: null });
        break;
      case 'open-end':
        setUrl({ end: item.id, piece: null, block: null, train: null, dialog: null });
        break;
    }
  };

  return (
    <ul
      ref={listRef}
      className="stage-items"
      role="listbox"
      aria-label="Stage items"
      data-testid="stage-items"
      style={{
        position: 'fixed',
        top: 64,
        left: 12,
        maxHeight: '45vh',
        overflowY: 'auto',
        zIndex: 38,
        listStyle: 'none',
        margin: 0,
        padding: '6px 10px',
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 10,
        border: '3px solid #1848c2',
        minWidth: 210,
        maxWidth: 280,
      }}
    >
      {items.map((item, i) => (
        <li
          key={`${item.kind}-${item.id}`}
          role="option"
          aria-selected={i === activeIndex}
          tabIndex={i === focusIndex ? 0 : -1}
          style={{
            padding: '4px 6px',
            cursor: 'pointer',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            fontWeight: i === activeIndex ? 700 : 400,
            borderTop: i === 0 ? 'none' : '1px solid #d5dbf0',
          }}
          onClick={() => select(item)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              select(item);
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              moveFocus(1);
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
