import { ChevronDown, ChevronRight, Eye, EyeOff, Lock } from "lucide-react";
import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { childrenOf, descendantsOf } from "../../shared/layers.ts";
import type { LayerDoc } from "../../shared/types.ts";
import type { EditorStore } from "../store/editor.ts";
import { KindIcon } from "./icons.tsx";

interface Row {
  layer: LayerDoc;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

type Zone = "before" | "inside" | "after";

export function LayerTree({ store, filter }: { store: EditorStore; filter: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(store.mode === "demo" ? ["demo-cube-field"] : []));
  const [hint, setHint] = useState<{ id: string; zone: Zone } | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const layers = store.doc.layers;
  const query = filter.trim().toLowerCase();

  const rows: Row[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const layer of childrenOf(layers, parent)) {
      const kids = childrenOf(layers, layer.id);
      const open = !collapsed.has(layer.id);
      rows.push({ layer, depth, hasChildren: kids.length > 0, open });
      if (open || query) walk(layer.id, depth + 1);
    }
  };
  walk(null, 0);
  const shown = query
    ? rows.filter((row) => row.layer.name.toLowerCase().includes(query) || descendantsOf(layers, row.layer.id).some((child) => child.name.toLowerCase().includes(query)))
    : rows;

  const focusRow = (id: string): void => {
    store.select(id);
    refs.current.get(id)?.focus();
  };

  const toggle = (id: string, open: boolean): void => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-layer]")?.dataset["layer"];
    const index = shown.findIndex((row) => row.layer.id === id);
    const row = shown[index];
    if (!row) return;
    const { layer } = row;
    if (event.altKey) {
      const siblings = childrenOf(layers, layer.parent_id);
      const position = siblings.findIndex((sibling) => sibling.id === layer.id);
      if (event.key === "ArrowUp" && position > 0) store.moveLayer(layer.id, layer.parent_id, position - 1);
      else if (event.key === "ArrowDown" && position < siblings.length - 1) store.moveLayer(layer.id, layer.parent_id, position + 1);
      else if (event.key === "ArrowRight" && position > 0) {
        const above = siblings[position - 1];
        if (above) store.moveLayer(layer.id, above.id, childrenOf(layers, above.id).length);
      } else if (event.key === "ArrowLeft" && layer.parent_id) {
        const parent = layers.find((candidate) => candidate.id === layer.parent_id);
        if (parent) store.moveLayer(layer.id, parent.parent_id, parent.index + 1);
      } else {
        return;
      }
      event.preventDefault();
      requestAnimationFrame(() => refs.current.get(layer.id)?.focus());
      return;
    }
    const go = (target: Row | undefined): void => {
      if (target) focusRow(target.layer.id);
    };
    switch (event.key) {
      case "ArrowDown": go(shown[index + 1]); break;
      case "ArrowUp": go(shown[index - 1]); break;
      case "Home": go(shown[0]); break;
      case "End": go(shown[shown.length - 1]); break;
      case "ArrowRight":
        if (row.hasChildren && !row.open) toggle(layer.id, true);
        else if (row.hasChildren) go(shown[index + 1]);
        break;
      case "ArrowLeft":
        if (row.hasChildren && row.open) toggle(layer.id, false);
        else go(shown.find((candidate) => candidate.layer.id === layer.parent_id));
        break;
      default: return;
    }
    event.preventDefault();
  };

  const zoneOf = (event: DragEvent<HTMLDivElement>): Zone => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - box.top) / box.height;
    return ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>, target: LayerDoc): void => {
    event.preventDefault();
    const movingId = event.dataTransfer.getData("text/plain");
    const zone = zoneOf(event);
    setHint(null);
    const moving = layers.find((layer) => layer.id === movingId);
    if (!moving || moving.id === target.id) return;
    if (zone === "inside") {
      store.moveLayer(moving.id, target.id, childrenOf(layers, target.id).filter((child) => child.id !== moving.id).length);
      return;
    }
    const siblings = childrenOf(layers, target.parent_id).filter((sibling) => sibling.id !== moving.id);
    const at = siblings.findIndex((sibling) => sibling.id === target.id);
    store.moveLayer(moving.id, target.parent_id, zone === "before" ? at : at + 1);
  };

  const active = store.selection ?? shown[0]?.layer.id;
  return (
    <div role="tree" aria-label="Layers" className="tree" onKeyDown={onKeyDown}>
      {shown.map(({ layer, depth, hasChildren, open }) => {
        const lock = store.locks.get(layer.id);
        const selected = layer.id === store.selection;
        return (
          <div
            key={layer.id}
            ref={(element) => {
              if (element) refs.current.set(layer.id, element);
              else refs.current.delete(layer.id);
            }}
            role="treeitem"
            aria-label={layer.name}
            aria-level={depth + 1}
            aria-selected={selected}
            aria-expanded={hasChildren ? open : undefined}
            tabIndex={layer.id === active ? 0 : -1}
            data-layer={layer.id}
            data-drop={hint?.id === layer.id ? hint.zone : undefined}
            className="tree-row"
            style={{ paddingLeft: 4 + depth * 16 }}
            draggable={store.canEdit}
            onClick={() => focusRow(layer.id)}
            onFocus={() => store.select(layer.id)}
            onDragStart={(event) => event.dataTransfer.setData("text/plain", layer.id)}
            onDragOver={(event) => {
              event.preventDefault();
              setHint({ id: layer.id, zone: zoneOf(event) });
            }}
            onDragLeave={() => setHint(null)}
            onDrop={(event) => onDrop(event, layer)}
          >
            <span className="bullet" aria-hidden="true" />
            <button
              type="button"
              tabIndex={-1}
              className="chevron"
              aria-hidden="true"
              style={{ visibility: hasChildren ? "visible" : "hidden" }}
              onClick={(event) => {
                event.stopPropagation();
                toggle(layer.id, !open);
              }}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <KindIcon kind={layer.kind} size={13} />
            <span className="tree-name">{layer.name}</span>
            {!layer.visible ? <EyeOff size={12} aria-hidden="true" className="state-icon" /> : <Eye size={12} aria-hidden="true" className="state-icon dim" />}
            {lock ? (
              <Lock size={12} role="img" aria-label={`Locked by ${lock.holder.display_name}`} className="state-icon lock" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
