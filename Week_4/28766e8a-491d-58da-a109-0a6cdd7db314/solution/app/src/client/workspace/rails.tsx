// The Pages and Layers lists (brief: Public screens, Keyboard F2 / Alt+Arrow / Delete).
import { useState } from "preact/hooks";
import type { Layer } from "../../shared/types";
import { Icon } from "../icons";
import { addLayer, addPage, moveLayer, movePage, renameLayer, renamePage, toggleLayer } from "./commands";
import type { WorkspaceStore } from "./store";

function Rename({ value, label, onDone }: { value: string; label: string; onDone: (name: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <input class="rename" aria-label={label} value={text} ref={(el) => {
      if (el && document.activeElement !== el) el.focus();
    }}
      onInput={(e) => setText(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onDone(text);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDone(null);
        }
      }}
      onBlur={() => onDone(null)} />
  );
}

export function PagesList({ store, onDelete }: { store: WorkspaceStore; onDelete: (pageId: string, opener: HTMLElement) => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const doc = store.doc;
  if (!doc) return null;
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  return (
    <section class="rail-section" role="region" aria-label="Pages">
      <h2>Pages</h2>
      <ul class="rail-list">
        {pages.map((p) => (
          <li key={store.keyFor(p.id)}>
            {renaming === p.id ? (
              <Rename value={p.name} label={`Rename page ${p.name}`} onDone={(name) => {
                setRenaming(null);
                if (name !== null && name !== p.name) renamePage(store, p.id, name);
                store.focusKey = `page:${p.id}`;
                store.emit();
              }} />
            ) : (
              <button type="button" class="rail-item" aria-current={p.id === store.page?.id ? "page" : undefined}
                data-focus-key={`page:${store.keyFor(p.id)}`} onClick={() => store.setPage(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "F2" && store.editable) {
                    e.preventDefault();
                    setRenaming(p.id);
                  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    movePage(store, p.id, e.key === "ArrowUp" ? -1 : 1);
                  } else if (e.key === "Delete" && store.editable && pages.length > 1) {
                    e.preventDefault();
                    onDelete(p.id, e.currentTarget);
                  }
                }}>
                {p.name}
              </button>
            )}
          </li>
        ))}
      </ul>
      {store.editable && <button type="button" class="add-button" onClick={() => addPage(store)}><Icon name="plus" size={16} /> Add page</button>}
    </section>
  );
}

export function LayersList({ store }: { store: WorkspaceStore }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const page = store.page;
  if (!page) return null;
  const layers = [...page.layers].sort((a, b) => b.order - a.order);
  const count = (l: Layer) => page.shapes.filter((s) => s.layer === l.id).length;
  return (
    <section class="rail-section" role="region" aria-label="Layers">
      <h2>Layers</h2>
      <ul class="rail-list">
        {layers.map((l) => (
          <li key={store.keyFor(l.id)} class={`layer-row${l.visible ? "" : " is-hidden"}`}>
            {renaming === l.id ? (
              <Rename value={l.name} label={`Rename layer ${l.name}`} onDone={(name) => {
                setRenaming(null);
                if (name !== null && name !== l.name) renameLayer(store, l.id, name);
                store.focusKey = `layer:${l.id}`;
                store.emit();
              }} />
            ) : (
              <button type="button" class="rail-item layer-name" data-focus-key={`layer:${store.keyFor(l.id)}`}
                onKeyDown={(e) => {
                  if (e.key === "F2" && store.editable) {
                    e.preventDefault();
                    setRenaming(l.id);
                  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    moveLayer(store, l.id, e.key === "ArrowUp" ? -1 : 1);
                  }
                }}>
                <span>{l.name}</span>
                <span class="count mono" aria-hidden="true">{count(l)}</span>
              </button>
            )}
            {store.editable && (
              <span class="layer-toggles">
                <button type="button" class="icon-button" aria-pressed={!l.visible} aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`}
                  onClick={() => toggleLayer(store, l, "visible")}>
                  <Icon name={l.visible ? "eye" : "eyeOff"} size={16} />
                </button>
                <button type="button" class="icon-button" aria-pressed={l.locked} aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.name}`}
                  onClick={() => toggleLayer(store, l, "locked")}>
                  <Icon name={l.locked ? "lock" : "unlock"} size={16} />
                </button>
              </span>
            )}
            {!store.editable && (!l.visible || l.locked) && (
              <span class="layer-state">{!l.visible ? "Hidden" : "Locked"}</span>
            )}
          </li>
        ))}
      </ul>
      {store.editable && <button type="button" class="add-button" onClick={() => addLayer(store)}><Icon name="plus" size={16} /> Add layer</button>}
    </section>
  );
}
