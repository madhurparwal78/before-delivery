import { useRef } from 'react';
import { Lock } from 'lucide-react';
import { store } from '../store.js';
import { useStoreState } from './common.js';
import { children, findLayer, hasChildren } from '../document.js';
import type { LayerDoc } from '../../shared/types.js';

function depth(doc: Parameters<typeof findLayer>[0], layer: LayerDoc): number {
  let level = 1;
  let parentId = layer.parent_id;
  while (parentId !== null) {
    level += 1;
    parentId = findLayer(doc, parentId)?.parent_id ?? null;
  }
  return level;
}

export function LayerTree({ filter }: { filter: string }) {
  const state = useStoreState();
  const doc = state.doc;
  const rows = store.visibleRows().filter((row) => row.name.toLowerCase().includes(filter.toLowerCase()));
  const dragged = useRef<string | null>(null);
  if (doc === null) return null;
  const collapsed = new Set(state.collapsed);

  const reparent = (layer: LayerDoc, parentId: string | null, index: number): void => {
    store.commit({
      target: layer.id,
      type: 'layer.reparent',
      payload: { parent_id: parentId, index },
      baseVersion: layer.version,
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, layer: LayerDoc): void => {
    const index = rows.findIndex((row) => row.id === layer.id);
    const siblings = children(doc, layer.parent_id);
    const position = siblings.findIndex((row) => row.id === layer.id);
    const move = (next: LayerDoc | undefined): void => {
      if (next === undefined) return;
      event.preventDefault();
      store.select(next.id);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-layer-row="${next.id}"]`)?.focus();
      });
    };

    if (event.altKey) {
      if (event.key === 'ArrowUp' && position > 0) {
        event.preventDefault();
        reparent(layer, layer.parent_id, position - 1);
        return;
      }
      if (event.key === 'ArrowDown' && position < siblings.length - 1) {
        event.preventDefault();
        reparent(layer, layer.parent_id, position + 1);
        return;
      }
      if (event.key === 'ArrowRight' && position > 0) {
        event.preventDefault();
        const above = siblings[position - 1] as LayerDoc;
        reparent(layer, above.id, children(doc, above.id).length);
        return;
      }
      if (event.key === 'ArrowLeft' && layer.parent_id !== null) {
        event.preventDefault();
        const parent = findLayer(doc, layer.parent_id) as LayerDoc;
        reparent(layer, parent.parent_id, parent.index + 1);
        return;
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        move(rows[index + 1]);
        break;
      case 'ArrowUp':
        move(rows[index - 1]);
        break;
      case 'Home':
        move(rows[0]);
        break;
      case 'End':
        move(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (hasChildren(doc, layer.id) && collapsed.has(layer.id)) {
          event.preventDefault();
          store.toggleCollapsed(layer.id, false);
        } else if (hasChildren(doc, layer.id)) {
          move(children(doc, layer.id)[0]);
        }
        break;
      case 'ArrowLeft':
        if (hasChildren(doc, layer.id) && !collapsed.has(layer.id)) {
          event.preventDefault();
          store.toggleCollapsed(layer.id, true);
        } else if (layer.parent_id !== null) {
          move(findLayer(doc, layer.parent_id) ?? undefined);
        }
        break;
      case 'Delete':
        event.preventDefault();
        store.commit({
          target: layer.id,
          type: 'layer.remove',
          payload: {},
          baseVersion: layer.version,
        });
        break;
      default:
        break;
    }
  };

  return (
    <div className="tree" role="tree" aria-label="Layers">
      {rows.map((layer) => {
        const parent = hasChildren(doc, layer.id);
        const open = parent && !collapsed.has(layer.id);
        const lock = state.locks[layer.id];
        return (
          <div
            key={layer.id}
            className="tree-row"
            role="treeitem"
            data-layer-row={layer.id}
            aria-selected={state.selection === layer.id}
            aria-level={depth(doc, layer)}
            aria-expanded={parent ? open : undefined}
            tabIndex={state.selection === layer.id ? 0 : -1}
            draggable
            style={{ paddingLeft: `${4 + (depth(doc, layer) - 1) * 10}px` }}
            onClick={() => store.select(layer.id)}
            onKeyDown={(event) => onKeyDown(event, layer)}
            onDragStart={() => {
              dragged.current = layer.id;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const movingId = dragged.current;
              dragged.current = null;
              const moving = findLayer(doc, movingId);
              if (moving === null || moving.id === layer.id) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientY - bounds.top) / bounds.height;
              if (ratio < 0.25 || ratio > 0.75) {
                const offset = ratio > 0.75 ? 1 : 0;
                const index = Math.max(0, layer.index + offset - (moving.parent_id === layer.parent_id && moving.index < layer.index ? 1 : 0));
                reparent(moving, layer.parent_id, index);
              } else {
                reparent(moving, layer.id, children(doc, layer.id).length);
              }
            }}
          >
            <span className="twisty" aria-hidden="true">
              {parent ? (open ? '\u25be' : '\u25b8') : ''}
            </span>
            <span className="grow">{layer.name}</span>
            <span className="kind">{layer.kind}</span>
            {lock === undefined ? null : (
              <Lock
                className="lock-icon"
                size={12}
                role="img"
                aria-label={`Locked by ${lock.holder.display_name}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
