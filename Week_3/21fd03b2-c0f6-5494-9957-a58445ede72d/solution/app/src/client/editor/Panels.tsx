import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { EMPTY, UPLOAD } from "../../shared/copy";
import { Glyph, type GlyphName } from "../ui";
import { ApiFailure, request } from "../api";
import { notify } from "../notices";
import { InspectorBody } from "./Inspector";
import type { AssetInfo, EditorState, EditorStore, PanelName } from "./store";
import { UPLOAD_UNITS } from "../../shared/gltf";
import type { RigKind } from "../../shared/params";

export type Layout = "floating" | "docked" | "phone";

interface PanelFrameProps {
  store: EditorStore;
  state: EditorState;
  name: PanelName;
  title: string;
  layout: Layout;
  area: React.RefObject<HTMLDivElement>;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}

/** A dock panel: a floating one drags by its header, maximises and closes; a docked one collapses. */
export function PanelFrame({ store, state, name, title, layout, area, children, collapsed, onToggle }: PanelFrameProps): JSX.Element | null {
  const panel = state.panels[name];
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  if (layout === "floating" && !panel.open) return null;
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (layout !== "floating" || panel.maximised || (event.target as HTMLElement).closest("button")) return;
    const rect = (ref.current as HTMLElement).getBoundingClientRect();
    const bounds = (area.current as HTMLElement).getBoundingClientRect();
    drag.current = { dx: event.clientX - rect.left + bounds.left, dy: event.clientY - rect.top + bounds.top };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const bounds = (area.current as HTMLElement).getBoundingClientRect();
    const width = (ref.current as HTMLElement).offsetWidth;
    const x = Math.min(Math.max(event.clientX - drag.current.dx, 0), bounds.width - width);
    const y = Math.min(Math.max(event.clientY - drag.current.dy, 0), bounds.height - 40);
    store.setPanel(name, { x, y });
  };
  const style = layout === "floating" && panel.x !== null && panel.y !== null && !panel.maximised ? { left: panel.x, top: panel.y, right: "auto", bottom: "auto" } : undefined;
  const hidden = state.mode === "run";
  return (
    <section
      ref={ref}
      role="region"
      aria-label={title}
      className={`dock panel panel-${name} ${layout}${panel.maximised ? " maximised" : ""}${collapsed ? " collapsed" : ""}`}
      style={style}
      hidden={hidden}
    >
      <div className="dock-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
        <h2 className="dock-title">{title}</h2>
        {layout === "floating" ? (
          <div className="dock-actions">
            <button type="button" className="glyph-btn" aria-label={`Maximise ${title}`} aria-pressed={panel.maximised} onClick={() => store.setPanel(name, { maximised: !panel.maximised })}>
              <Glyph name="maximise" size={12} />
            </button>
            <button type="button" className="glyph-btn" aria-label={`Close ${title}`} onClick={() => store.setPanel(name, { open: false, maximised: false })}>
              <Glyph name="close" size={12} />
            </button>
          </div>
        ) : layout === "docked" ? (
          <button type="button" className="glyph-btn" aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`} aria-expanded={!collapsed} onClick={onToggle}>
            <Glyph name="caret" size={12} />
          </button>
        ) : null}
      </div>
      {collapsed ? null : <div className="dock-body">{children}</div>}
    </section>
  );
}

const KIND_GLYPH: Record<string, GlyphName> = { ramp: "ramp", pendulum: "pendulum", launcher: "launcher", crate: "crate", model: "model" };

export function OutlineBody({ store, state, onAdd }: { store: EditorStore; state: EditorState; onAdd: () => void }): JSX.Element {
  const [query, setQuery] = useState("");
  const objects = state.doc.objects.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  const [cursor, setCursor] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const previousRenaming = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (previousRenaming.current && !state.renaming) rows.current.get(previousRenaming.current)?.focus();
    previousRenaming.current = state.renaming;
  }, [state.renaming]);
  const active = objects.find((o) => o.id === (cursor ?? state.selection))?.id ?? objects[0]?.id;
  const move = (id: string, delta: number): void => {
    const index = objects.findIndex((o) => o.id === id);
    const next = objects[Math.min(objects.length - 1, Math.max(0, index + delta))];
    if (next) {
      setCursor(next.id);
      rows.current.get(next.id)?.focus();
    }
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: string): void => {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(id, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(id, -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      move(id, event.key === "Home" ? -objects.length : objects.length);
    } else if (event.key === "Enter" || event.key === " ") {
      if ((event.target as HTMLElement) !== event.currentTarget) return;
      event.preventDefault();
      store.select(id);
    }
  };
  return (
    <>
      <div className="subbar">
        <span className="muted count">{state.doc.objects.length} objects</span>
        <button type="button" className="mini-chip" aria-label="Add object" onClick={onAdd}>
          <Glyph name="plus" size={12} />
        </button>
        <input type="search" className="mini-input" aria-label="Find objects" placeholder="Find" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {state.doc.objects.length === 0 ? <p className="empty-line">{EMPTY.outline}</p> : null}
      <div role="tree" aria-label="Scene outline" className="tree">
        {objects.map((o) => {
          const lock = state.locks.find((l) => l.objectId === o.id);
          const hidden = state.hidden.includes(o.id);
          const pickLocked = state.pickLocked.includes(o.id);
          const renaming = state.renaming === o.id;
          return (
            <div
              key={o.id}
              ref={(el) => {
                if (el) rows.current.set(o.id, el);
                else rows.current.delete(o.id);
              }}
              role="treeitem"
              aria-label={o.name}
              aria-selected={state.selection === o.id}
              tabIndex={active === o.id ? 0 : -1}
              className={`tree-row${state.selection === o.id ? " selected" : ""}${hidden ? " dim" : ""}`}
              onClick={() => store.select(o.id)}
              onDoubleClick={() => {
                store.select(o.id);
                store.startRename(o.id);
              }}
              onKeyDown={(event) => (event.key === "F2" ? (event.preventDefault(), store.select(o.id), store.startRename(o.id)) : onKeyDown(event, o.id))}
            >
              <Glyph name={KIND_GLYPH[o.kind]} size={13} />
              {renaming ? (
                <input
                  className="rename"
                  aria-label={`Rename ${o.name}`}
                  defaultValue={o.name}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") store.rename(o.id, e.currentTarget.value);
                    else if (e.key === "Escape") store.cancelRename();
                  }}
                  onBlur={(e) => {
                    if (store.state.renaming === o.id) store.rename(o.id, e.currentTarget.value);
                  }}
                />
              ) : (
                <span className="row-name">{o.name}</span>
              )}
              {lock ? (
                <span className="holder-badge" title={lock.holder.displayName} aria-hidden="true">
                  {lock.holder.displayName.slice(0, 1).toUpperCase()}
                </span>
              ) : null}
              <button
                type="button"
                className="glyph-btn"
                aria-label={`${hidden ? "Show" : "Hide"} ${o.name}`}
                aria-pressed={hidden}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  store.toggleHidden(o.id);
                }}
              >
                <Glyph name={hidden ? "eye-off" : "eye"} size={13} />
              </button>
              <button
                type="button"
                className="glyph-btn"
                aria-label={`${pickLocked ? "Unlock" : "Lock"} ${o.name}`}
                aria-pressed={pickLocked}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  store.togglePickLock(o.id);
                }}
              >
                <Glyph name={pickLocked ? "lock" : "unlock"} size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

const RIG_TILES: Array<{ kind: RigKind; glyph: string }> = [
  { kind: "ramp", glyph: "◢" },
  { kind: "pendulum", glyph: "┬●" },
  { kind: "launcher", glyph: "◢•" },
  { kind: "crate", glyph: "▣" },
];

interface DragState {
  label: string;
  x: number;
  y: number;
}

export function PropsBody({ store, state }: { store: EditorStore; state: EditorState }): JSX.Element {
  const [tab, setTab] = useState<"rigs" | "models">("rigs");
  const [ghost, setGhost] = useState<DragState | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const models = state.assets.filter((a) => a.kind === "glb" || a.kind === "gltf");
  const editable = store.editing;
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, label: string, drop: (point: [number, number, number]) => void): void => {
    suppressClick.current = false;
    if (!editable || event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    const onMove = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 5) return;
      moved = true;
      setGhost({ label, x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGhost(null);
      if (!moved) return;
      suppressClick.current = true;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || !target.closest(".stage-host")) return;
      const point = store.stage?.groundPoint(e);
      if (!point) return;
      const snap = store.state.snap;
      drop(snap ? [Math.round(point[0] / 0.25) * 0.25, 0, Math.round(point[2] / 0.25) * 0.25] : point);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const suppressClick = useRef(false);
  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const tiles = [...(grid.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const columns = 2;
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (at >= 0 && event.key in deltas) {
      event.preventDefault();
      tiles[Math.min(tiles.length - 1, Math.max(0, at + deltas[event.key]))]?.focus();
    }
  };
  useEffect(() => {
    const tiles = grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    tiles.forEach((tile, i) => (tile.tabIndex = i === 0 ? 0 : -1));
  }, [tab, models.length, editable]);
  const tabs = (
    <div role="tablist" aria-label="Prop types" className="tabs">
      {(["rigs", "models"] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
          {t === "rigs" ? "Rigs" : "Models"}
        </button>
      ))}
    </div>
  );
  return (
    <>
      {tabs}
      <div
        ref={grid}
        className="tiles"
        onKeyDown={(event) => {
          suppressClick.current = false;
          onGridKey(event);
        }}
      >
        {tab === "rigs"
          ? RIG_TILES.map(({ kind, glyph }) => (
              <button
                key={kind}
                type="button"
                className="tile"
                disabled={!editable}
                aria-label={`Add ${kind}`}
                onPointerDown={(e) => startDrag(e, kind, (point) => store.place({ kind }, point))}
                onClick={() => !suppressClick.current && store.place({ kind })}
              >
                <span className="tile-glyph" aria-hidden="true">
                  {glyph}
                </span>
                <span className="tile-label" aria-hidden="true">
                  {kind}
                </span>
              </button>
            ))
          : models.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className="tile"
                disabled={!editable}
                aria-label={`Add ${asset.name}`}
                onPointerDown={(e) => startDrag(e, asset.name, (point) => store.place({ asset }, point))}
                onClick={() => !suppressClick.current && store.place({ asset })}
              >
                <span className="tile-glyph" aria-hidden="true">
                  ◈
                </span>
                <span className="tile-label" aria-hidden="true">
                  {asset.name}
                </span>
              </button>
            ))}
      </div>
      {tab === "models" && models.length === 0 ? <p className="empty-line">{EMPTY.models}</p> : null}
      {ghost ? (
        <div className="drag-ghost" style={{ left: ghost.x + 10, top: ghost.y + 10 }} aria-hidden="true">
          {ghost.label}
        </div>
      ) : null}
    </>
  );
}

export { InspectorBody };

type Folder = "Models" | "Images";

export function AssetsBody({ store, state }: { store: EditorStore; state: EditorState }): JSX.Element {
  const [view, setView] = useState<"files" | "checkpoints">("files");
  return (
    <>
      <div role="tablist" aria-label="Asset views" className="tabs">
        {(["files", "checkpoints"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={view === t} className={`tab${view === t ? " on" : ""}`} onClick={() => setView(t)}>
            {t === "files" ? "Files" : "Checkpoints"}
          </button>
        ))}
      </div>
      {view === "files" ? <FilesTab store={store} state={state} /> : <CheckpointsTab store={store} state={state} />}
    </>
  );
}

function FilesTab({ store, state }: { store: EditorStore; state: EditorState }): JSX.Element {
  const [folder, setFolder] = useState<Folder>("Models");
  const [unit, setUnit] = useState("m");
  const [filter, setFilter] = useState("");
  const [list, setList] = useState(false);
  const [size, setSize] = useState(64);
  const [uploadStatus, setUploadStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const items = state.assets.filter((a) => (folder === "Models" ? a.kind === "glb" || a.kind === "gltf" : a.kind === "png" || a.kind === "jpeg")).filter((a) => a.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const upload = async (file: File): Promise<void> => {
    setUploadStatus(UPLOAD.pending(file.name));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { data, response } = await request<{ asset: AssetInfo }>(`/api/projects/${state.projectId}/assets?name=${encodeURIComponent(file.name)}&unit=${unit}`, { method: "POST", raw: bytes });
      const target: Folder = data.asset.kind === "glb" || data.asset.kind === "gltf" ? "Models" : "Images";
      setFolder(target);
      setUploadStatus(response.status === 200 ? UPLOAD.replay(file.name) : UPLOAD.added(file.name, target));
      await store.refreshAssets();
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === "storage_unavailable") setUploadStatus(UPLOAD.storageDown);
        else setUploadStatus(Object.values(error.fields)[0] ?? error.message);
      } else setUploadStatus(UPLOAD.storageDown);
    }
  };
  const choose = (files: FileList | null): void => {
    if (!files) return;
    for (const file of Array.from(files)) void upload(file);
    if (input.current) input.current.value = "";
  };
  const editable = store.editing;
  return (
    <div
      className="files"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (editable) choose(e.dataTransfer.files);
      }}
    >
      <div className="subbar">
        <button type="button" className="mini-chip" disabled={!editable} onClick={() => input.current?.click()}>
          Upload
        </button>
        <select className="mini-input" aria-label="Model units" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UPLOAD_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input type="search" className="mini-input" aria-label="Filter assets" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <input ref={input} type="file" hidden multiple onChange={(e) => choose(e.target.files)} tabIndex={-1} aria-hidden="true" />
      </div>
      <div className="split">
        <div role="tree" aria-label="Folders" className="folders">
          {(["Models", "Images"] as const).map((f) => (
            <div key={f} role="treeitem" aria-selected={folder === f} tabIndex={folder === f ? 0 : -1} className={`folder${folder === f ? " selected" : ""}`} onClick={() => setFolder(f)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setFolder(f))}>
              <Glyph name={f === "Models" ? "folder" : "image"} size={12} /> {f}
            </div>
          ))}
        </div>
        <div className="contents">
          {items.length === 0 ? <p className="empty-line">{EMPTY.folder}</p> : null}
          <ul aria-label="Folder contents" className={`file-list${list ? " list" : " grid"}`} style={{ ["--tile" as string]: `${size}px` }}>
            {items.map((a) => (
              <li key={a.id} className="file">
                <span className="file-name">{a.name}</span>
                {a.extentMetres !== null ? <span className="muted num">{a.extentMetres.toFixed(2)} m</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="footer">
        <span className="muted crumbs">Assets / {folder}</span>
        <input type="range" aria-label="Thumbnail size" min={40} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        <button type="button" className={`mini-chip${list ? " on" : ""}`} aria-pressed={list} onClick={() => setList((l) => !l)}>
          List view
        </button>
      </div>
      <div role="status" aria-label="Upload status" className="upload-status">
        {uploadStatus}
      </div>
    </div>
  );
}

function CheckpointsTab({ store, state }: { store: EditorStore; state: EditorState }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setError(null);
    notify("Saving checkpoint...");
    try {
      const { data } = await request<{ checkpoint: { label: string } }>(`/api/scenes/${state.scene.id}/checkpoints`, { method: "POST", body: { label } });
      notify(`Checkpoint ${data.checkpoint.label} saved`);
      setLabel("");
      setAdding(false);
      await store.refreshCheckpoints();
      await store.refreshScene();
    } catch (e) {
      notify("");
      setError(e instanceof ApiFailure ? (e.fields.label ?? (e.code === "storage_unavailable" ? "File storage is unreachable. Uploads, checkpoints and publishing are paused." : e.message)) : "Something went wrong.");
    }
  };
  return (
    <div className="checkpoints">
      <div className="subbar">
        <button type="button" className="mini-chip" disabled={!store.editing} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          New checkpoint
        </button>
      </div>
      {adding ? (
        <form
          className="inline-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="checkpoint-name" className="sr-only">
            Checkpoint name
          </label>
          <input id="checkpoint-name" className="mini-input" placeholder="Checkpoint name" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "checkpoint-error" : undefined} />
          <button type="submit" className="mini-chip">
            Save checkpoint
          </button>
          {error ? (
            <p id="checkpoint-error" className="field-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {state.checkpoints.length === 0 ? <p className="empty-line">{EMPTY.checkpoints}</p> : null}
      <ul className="rows compact-rows">
        {state.checkpoints.map((c) => (
          <li key={c.id} className="file">
            <span className="file-name">{c.label}</span>
            <button type="button" className="mini-chip" disabled={!store.editing} aria-label={`Restore ${c.label}`} onClick={() => store.askRestore(c)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
