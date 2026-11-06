// The editor: a drafting table of hierarchy, viewport and inspector over a full-width operation-log ruler.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LAYER_TYPES, REST_STATE, type Graph, type Layer, type LayerType, type SceneNode, type TransformField, type Vec3 } from "../../shared/graph.js";
import { post, randomHex } from "../api.js";
import { Button, Dialog, Field, Icon, Status, leaveMotion, stillImage, useBusy, useReducedMotion } from "../ui.js";
import { allowed, useSession } from "../pages/shell.js";
import { SceneView } from "../three/view.js";
import { AXES, EditorModel, FIELD_LABEL, NUDGE, type Tab } from "./model.js";
import { Sheet, type Permissions } from "./sheet.js";

const formatValue = (n: number) => String(Number(n.toFixed(4)));

function useModel(model: EditorModel): number {
  const [version, setVersion] = useState(0);
  // Subscribed at commit, not after paint, so a change made right after mount still re-renders.
  useLayoutEffect(() => model.subscribe(() => setVersion((v) => v + 1)), [model]);
  return version;
}

const isTextField = (el: Element | null) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range"].includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

export function Editor({ sceneId }: { sceneId: string }) {
  const { session } = useSession();
  const [model, setModel] = useState<EditorModel | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current: EditorModel | null = null;
    const me = { kind: "member" as const, id: session.member.id, name: session.member.name };
    EditorModel.load(sceneId, me, session.workspace.timeZone, allowed(session, "scene.edit")).then((m) => {
      current = m;
      m.connect();
      setModel(m);
    }, () => setFailed(true));
    return () => current?.dispose();
  }, [sceneId]);
  if (failed) return <div class="page"><h1>Scene not found</h1><p>This scene does not exist in this workspace.</p></div>;
  if (!model) return <div class="page"><p class="muted">Opening the drafting table…</p></div>;
  return <Workbench model={model} />;
}

function Workbench({ model }: { model: EditorModel }) {
  useModel(model);
  const { session } = useSession();
  const can: Permissions = {
    manageVersions: allowed(session, "version.manage"), approve: allowed(session, "version.approve"),
    comment: allowed(session, "comment"), upload: allowed(session, "asset.upload"),
  };
  const [addingState, setAddingState] = useState<HTMLElement | null>(null);
  const sheetVisible = model.sheetOpen || model.tab === "comments" || model.tab === "versions";

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || isTextField(document.activeElement)) return;
      e.preventDefault();
      void model.undoRedo(e.shiftKey ? "redo" : "undo");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [model]);

  const addAsset = (assetId: string, name: string) => {
    const parent = model.selection ?? model.graph.nodes.find((n) => n.parentId === null)?.id ?? "n_root";
    const id = `n_${randomHex(10)}`;
    const node: SceneNode = {
      id, name: name.replace(/\.glb$/i, "").slice(0, 80) || "Model", kind: "mesh", parentId: parent, primitive: null, assetId,
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], materialLayers: [], visible: true,
    };
    post(`/api/scenes/${model.sceneId}/ops`, { ops: [{ type: "node.add", payload: { node } }] })
      .then(() => model.refreshOps().then(() => model.setStatus(`${node.name} added to the scene.`)), () => model.setStatus("The model could not be added."));
  };

  const toggleSheet = () => {
    const sheet = document.getElementById("editor-sheet");
    const close = () => { model.sheetOpen = false; model.emit(); };
    if (!model.sheetOpen) { model.sheetOpen = true; model.emit(); }
    else if (sheet) leaveMotion(sheet, close, "x");
    else close();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "hierarchy", label: "Hierarchy" }, { id: "inspector", label: "Inspector" }, { id: "comments", label: "Comments" }, { id: "versions", label: "Versions" },
  ];
  return (
    <div class="editor" data-tab={model.tab}>
      <header class="editor-head">
        <h1 class="truncate" title={model.name}>{model.name}</h1>
        <ul class="people" aria-label="People in this scene">
          {model.presence.map((p) => (
            <li key={`${p.author.kind}:${p.author.id}`}>
              <span class={`dot${p.author.kind === "agent" ? " agent" : ""}`} aria-hidden="true" />
              {`${p.author.name}${p.author.kind === "agent" ? " (agent)" : ""}${p.selection ? ` · ${model.nodeName(p.selection)}` : ""}`}
            </li>
          ))}
        </ul>
        <div class="head-actions">
          <Button small busy={model.isBusy("undo")} disabled={!model.canEdit} onClick={() => { void model.undoRedo("undo"); }}><Icon name="undo" />Undo</Button>
          <Button small busy={model.isBusy("redo")} disabled={!model.canEdit} onClick={() => { void model.undoRedo("redo"); }}><Icon name="redo" />Redo</Button>
          <Button small class="versions-toggle" aria-expanded={model.sheetOpen ? "true" : "false"} aria-controls="editor-sheet"
            onClick={toggleSheet}><Icon name="sheet" />Versions</Button>
        </div>
      </header>
      <section class="panel hierarchy-panel" aria-labelledby="hierarchy-title" id="panel-hierarchy">
        <div class="panel-title"><h2 id="hierarchy-title">Hierarchy</h2></div>
        <Hierarchy model={model} />
      </section>
      <Viewport model={model} />
      <section class="panel inspector-panel" role="region" aria-label="Inspector" id="panel-inspector">
        <Inspector model={model} onAddState={(opener) => setAddingState(opener)} />
      </section>
      <Timeline model={model} />
      <div class="tabs" role="tablist" aria-label="Editor panels">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={model.tab === t.id ? "true" : "false"}
            onClick={() => { model.tab = t.id; model.emit(); }}>{t.label}</button>
        ))}
      </div>
      {sheetVisible ? <Sheet model={model} can={can} onAddAsset={addAsset} /> : null}
      <div class="visually-hidden"><Status label="Editor status" text={model.status} /></div>
      {model.status ? <p class="notice" style={{ position: "fixed", right: "16px", bottom: "16px", zIndex: 45, maxWidth: "min(420px, calc(100vw - 32px))" }} aria-hidden="true">{model.status}</p> : null}
      {model.lockPrompt ? <LockDialog model={model} /> : null}
      {addingState ? <AddStateDialog model={model} opener={addingState} onClose={() => setAddingState(null)} /> : null}
    </div>
  );
}

// --- Hierarchy -------------------------------------------------------------------------------------------------

interface Row { node: SceneNode; level: number; hasChildren: boolean }

function rows(graph: Graph, collapsed: Set<string>): Row[] {
  const out: Row[] = [];
  const walk = (parent: string | null, level: number) => {
    for (const node of graph.nodes.filter((n) => n.parentId === parent)) {
      const hasChildren = graph.nodes.some((n) => n.parentId === node.id);
      out.push({ node, level, hasChildren });
      if (hasChildren && !collapsed.has(node.id)) walk(node.id, level + 1);
    }
  };
  walk(null, 1);
  return out;
}

function Hierarchy({ model }: { model: EditorModel }) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [focused, setFocused] = useState<string | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const tree = useRef<HTMLUListElement>(null);
  const list = rows(model.shown.graph, collapsed);
  const active = focused && list.some((r) => r.node.id === focused) ? focused : model.selection ?? list[0]?.node.id ?? null;
  const focusItem = (id: string) => {
    setFocused(id);
    tree.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, row: Row, index: number) => {
    const move = (i: number) => { const target = list[Math.max(0, Math.min(list.length - 1, i))]; if (target) focusItem(target.node.id); };
    switch (e.key) {
      case "ArrowDown": move(index + 1); break;
      case "ArrowUp": move(index - 1); break;
      case "Home": move(0); break;
      case "End": move(list.length - 1); break;
      case "ArrowRight":
        if (row.hasChildren && collapsed.has(row.node.id)) setCollapsed(new Set([...collapsed].filter((id) => id !== row.node.id)));
        else if (row.hasChildren) move(index + 1);
        break;
      case "ArrowLeft":
        if (row.hasChildren && !collapsed.has(row.node.id)) setCollapsed(new Set([...collapsed, row.node.id]));
        else if (row.node.parentId) focusItem(row.node.parentId);
        break;
      case "Enter": case " ": void model.select(row.node.id); break;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const now = Date.now();
        typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
        const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)];
        const match = ordered.find((r) => r.node.name.toLowerCase().startsWith(typed.current.text))
          ?? ordered.find((r) => r.node.name.toLowerCase().startsWith(e.key.toLowerCase()));
        if (match) focusItem(match.node.id);
        break;
      }
    }
    e.preventDefault();
  };
  return (
    <ul role="tree" aria-label="Scene hierarchy" ref={tree}>
      {list.map((row, index) => {
        const holder = model.locks.get(row.node.id);
        const descId = `lock-${row.node.id}`;
        return (
          <li key={row.node.id} role="treeitem" data-node={row.node.id} aria-level={row.level} tabIndex={active === row.node.id ? 0 : -1}
            aria-selected={model.selection === row.node.id ? "true" : "false"} aria-expanded={row.hasChildren ? (collapsed.has(row.node.id) ? "false" : "true") : undefined}
            aria-describedby={holder ? descId : undefined} onKeyDown={(e) => onKeyDown(e, row, index)}
            onFocus={() => setFocused(row.node.id)} onClick={() => { focusItem(row.node.id); void model.select(row.node.id); }}>
            <div class="tree-row" style={{ paddingLeft: `${(row.level - 1) * 16 + 6}px` }}>
              <span class="kind" aria-hidden="true">{row.node.kind}</span>
              <span class="truncate" title={row.node.name}>{row.node.name}</span>
              {holder ? <span class={`badge lock-badge${model.isMe(holder) ? " pending" : " alert"}`} aria-hidden="true"><Icon name="lock" />{model.isMe(holder) ? "You" : holder.name.split(" ")[0]}</span> : null}
            </div>
            {holder ? <span id={descId} hidden>{`Locked by ${holder.name}`}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// --- Viewport --------------------------------------------------------------------------------------------------

function Viewport({ model }: { model: EditorModel }) {
  const region = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [webgl, setWebgl] = useState(true);
  const [pins, setPins] = useState<{ nodeId: string; x: number; y: number }[]>([]);
  const still = useRef(stillImage()).current;

  useLayoutEffect(() => {
    if (!canvas.current || !region.current) return;
    const view = SceneView.create(canvas.current, { drafting: true, assetUrl: (id) => `/api/assets/${encodeURIComponent(id)}/file` });
    setWebgl(view !== null);
    model.attachView(view, region.current);
    if (!view) return;
    const detach = view.attachPointer((id) => { if (id) void model.select(id); });
    const observer = new ResizeObserver(() => view.requestRender());
    observer.observe(canvas.current);
    return () => { detach(); observer.disconnect(); };
  }, [model]);

  const openThreads = [...new Set(model.comments.filter((c) => !c.resolved).map((c) => c.nodeId))];
  useEffect(() => {
    const view = model.view;
    if (!view) return;
    const place = () => setPins(openThreads.flatMap((nodeId) => {
      const at = view.project(nodeId);
      return at ? [{ nodeId, ...at }] : [];
    }));
    view.onRender = place;
    place();
  }, [model, openThreads.join("|")]);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = (5 * Math.PI) / 180;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[e.key];
    if (!move || !model.view) return;
    e.preventDefault();
    model.view.orbitBy(move[0], move[1]);
    model.view.renderNow();
  };
  const openPin = (nodeId: string) => {
    const thread = model.comments.find((c) => c.nodeId === nodeId && !c.resolved);
    model.focusThread = thread?.id ?? null;
    if (window.matchMedia("(max-width: 640px)").matches) model.tab = "comments"; else model.sheetOpen = true;
    void model.select(nodeId);
  };
  return (
    <section class="panel viewport-panel" role="region" aria-label="Viewport" ref={region}>
      <canvas ref={canvas} class="viewport-canvas" tabIndex={0} aria-label={`3D view of ${model.name}. Drag or use the arrow keys to orbit.`} onKeyDown={onKeyDown} hidden={!webgl} />
      {!webgl ? (
        <div class="viewport-fallback">
          {still ? <img src={still} alt={model.name} /> : null}
          <p>3D preview needs WebGL. The hierarchy, inspector and operation log still work.</p>
        </div>
      ) : null}
      {pins.map((pin) => (
        <button key={pin.nodeId} type="button" class="pin" style={{ left: `${pin.x}px`, top: `${pin.y}px` }}
          aria-label={`Comment on ${model.nodeName(pin.nodeId)}`} onClick={() => openPin(pin.nodeId)}>
          <span><Icon name="comment" /></span>
        </button>
      ))}
      <span class="view-caption" aria-hidden="true">{model.atLatest ? `op ${model.playhead}` : `viewing op ${model.playhead} of ${model.latestSeq}`}{model.stateId !== REST_STATE ? ` · ${model.shown.graph.states.find((s) => s.id === model.stateId)?.name ?? ""}` : ""}</span>
    </section>
  );
}

// --- Inspector -------------------------------------------------------------------------------------------------

function AxisInput({ model, node, field, axis }: { model: EditorModel; node: SceneNode; field: TransformField; axis: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const key = `${node.id}:${field}:${axis}`;
  const value = model.fieldValue(node, field, axis);
  const readOnly = !model.atLatest || !model.canEdit;
  const commit = (next: number) => {
    setDraft(null);
    if (!Number.isFinite(next) || readOnly) return;
    model.commitTransform(node, field, axis, next, input.current);
  };
  const [plain, shifted] = NUDGE[field];
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit(Number(draft ?? value)); }
    else if (e.key === "Escape") { e.preventDefault(); setDraft(null); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (readOnly) return;
      const step = (e.shiftKey ? shifted : plain) * (e.key === "ArrowUp" ? 1 : -1);
      commit(Number((value + step).toFixed(4)));
    }
  };
  const scrub = (e: PointerEvent) => {
    if (readOnly) return;
    const label = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, value };
    label.setPointerCapture(e.pointerId);
    let latest = value;
    const move = (ev: PointerEvent) => { latest = Number((start.value + Math.round((ev.clientX - start.x) / 4) * plain).toFixed(4)); setDraft(formatValue(latest)); };
    const up = () => { label.removeEventListener("pointermove", move); label.removeEventListener("pointerup", up); if (latest !== value) commit(latest); else setDraft(null); };
    label.addEventListener("pointermove", move);
    label.addEventListener("pointerup", up);
  };
  const pending = model.pending.has(key);
  return (
    <div class="axis-field">
      <span class="scrub" aria-hidden="true" onPointerDown={scrub} title={`Drag to scrub ${FIELD_LABEL[field]} ${AXES[axis]}`}>{AXES[axis]}</span>
      <input ref={input} type="number" step="any" aria-label={`${FIELD_LABEL[field]} ${AXES[axis]}`} value={draft ?? formatValue(value)} readOnly={readOnly}
        data-pending={pending ? "true" : undefined} class={model.rejected.has(key) ? "rejected" : undefined}
        onInput={(e) => setDraft(e.currentTarget.value)} onKeyDown={onKeyDown}
        onBlur={() => { if (draft !== null) commit(Number(draft)); }} onWheel={(e) => e.currentTarget.blur()} />
      {pending ? <span class="badge pending">Pending</span> : null}
    </div>
  );
}

function LayerItem({ model, node, layer, index }: { model: EditorModel; node: SceneNode; layer: Layer; index: number }) {
  const first = useRef<HTMLInputElement>(null);
  const type = layer.type[0].toUpperCase() + layer.type.slice(1);
  useEffect(() => {
    if (model.focusLayer === layer.id) { first.current?.focus(); model.focusLayer = null; }
  }, [model.focusLayer]);
  const hex = `#${layer.color.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
  const readOnly = !model.atLatest || !model.canEdit;
  const number = (field: "roughness" | "metalness") => (
    <div class="field">
      <label for={`${layer.id}-${field}`}>{field === "roughness" ? "Roughness" : "Metalness"}</label>
      <input id={`${layer.id}-${field}`} type="number" min={0} max={1} step="0.05" aria-label={`${type} ${field}`} value={formatValue(layer[field])} readOnly={readOnly}
        onChange={(e) => { const v = Number(e.currentTarget.value); if (v >= 0 && v <= 1) model.commitLayer(node.id, layer.id, { [field]: v }, e.currentTarget); }} />
    </div>
  );
  return (
    <li class="layer">
      <div class="layer-head"><span>{`${index + 1}. ${layer.type}`}</span>
        {model.canEdit ? <Button small class="quiet" disabled={readOnly} onClick={() => model.removeLayer(node.id, layer.id)}>{`Remove ${layer.type} layer`}</Button> : null}
      </div>
      <div class="layer-fields">
        <div class="field">
          <label for={`${layer.id}-color`}>Colour</label>
          <input ref={first} id={`${layer.id}-color`} type="color" aria-label={`${type} colour`} value={hex} disabled={readOnly}
            onChange={(e) => {
              const v = e.currentTarget.value;
              const channel = (i: number) => Number((parseInt(v.slice(i, i + 2), 16) / 255).toFixed(4));
              const color: Vec3 = [channel(1), channel(3), channel(5)];
              model.commitLayer(node.id, layer.id, { color }, e.currentTarget);
            }} />
        </div>
        {number("roughness")}
        {number("metalness")}
      </div>
    </li>
  );
}

function LayerMenu({ model, node }: { model: EditorModel; node: SceneNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (open) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(); }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") setOpen(false);
  };
  const choose = (type: LayerType) => { setOpen(false); model.addLayer(node.id, type); };
  return (
    <div style={{ position: "relative" }} onKeyDown={onKeyDown}>
      <button ref={button} type="button" class="button small" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} disabled={!model.atLatest || !model.canEdit}
        onClick={() => setOpen(!open)}><Icon name="plus" />Add material layer</button>
      {open ? (
        <div ref={menu} role="menu" aria-label="Layer type" class="menu">
          {LAYER_TYPES.map((type) => (
            <button key={type} type="button" role="menuitem" tabIndex={-1} onClick={() => choose(type)}>{type[0].toUpperCase() + type.slice(1)}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ListBox({ label, options, selected, onChoose }: { label: string; options: { id: string; name: string }[]; selected: string | null; onChoose: (id: string) => void }) {
  const index = options.findIndex((o) => o.id === selected);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = options[Math.max(0, Math.min(options.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) onChoose(next.id);
  };
  const prefix = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <ul role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} aria-activedescendant={selected ? `${prefix}-${selected}` : undefined}>
      {options.map((o) => (
        <li key={o.id} id={`${prefix}-${o.id}`} role="option" aria-selected={o.id === selected ? "true" : "false"} onClick={() => onChoose(o.id)}>
          <span class="truncate" title={o.name}>{o.name}</span>
        </li>
      ))}
    </ul>
  );
}

function Inspector({ model, onAddState }: { model: EditorModel; onAddState: (opener: HTMLElement) => void }) {
  const graph = model.shown.graph;
  const node = model.selection ? graph.nodes.find((n) => n.id === model.selection) ?? null : null;
  const [view, setView] = useState<string | null>(null);
  return (
    <>
      <div class="panel-title"><h2>Inspector</h2>{node ? <span class="muted small truncate" title={node.name}>{node.name}</span> : null}</div>
      {!model.atLatest ? <p class="read-only-note">{`Viewing operation ${model.playhead}. Return to latest to edit.`}</p> : null}
      {node ? (
        <>
          <div class="inspector-section">
            <h3>Transform{model.stateId !== REST_STATE ? ` in ${graph.states.find((s) => s.id === model.stateId)?.name ?? ""}` : ""}</h3>
            {(["position", "rotation", "scale"] as const).map((field) => (
              <div class="axis-row" key={field}>
                <span class="label">{FIELD_LABEL[field]}{field === "rotation" ? " (degrees)" : ""}</span>
                <div class="axis-fields">{[0, 1, 2].map((axis) => <AxisInput key={axis} model={model} node={node} field={field} axis={axis} />)}</div>
              </div>
            ))}
          </div>
          <div class="inspector-section">
            <h3>Material layers</h3>
            <ul class="layer-list" aria-label="Material layers">
              {node.materialLayers.map((layer, i) => <LayerItem key={layer.id} model={model} node={node} layer={layer} index={i} />)}
            </ul>
            {node.materialLayers.length === 0 ? <p class="muted small">No layers yet.</p> : null}
            <LayerMenu model={model} node={node} />
          </div>
        </>
      ) : <div class="inspector-section"><p class="muted">Select an object in the hierarchy or the viewport to edit its transform and material layers.</p></div>}
      <div class="inspector-section">
        <h3>States</h3>
        <ListBox label="States" options={graph.states.map((s) => ({ id: s.id, name: s.name }))} selected={model.stateId} onChoose={(id) => model.chooseState(id)} />
        {model.canEdit ? <div><Button small disabled={!model.atLatest} onClick={(e) => onAddState(e.currentTarget)}><Icon name="plus" />Add state</Button></div> : null}
      </div>
      <div class="inspector-section">
        <h3>Camera views</h3>
        <ListBox label="Camera views" options={graph.cameraViews.map((c) => ({ id: c.name, name: c.name }))} selected={view}
          onChoose={(name) => { setView(name); const v = graph.cameraViews.find((c) => c.name === name); if (v) model.view?.setCameraView(v); }} />
        {graph.cameraViews.length === 0 ? <p class="muted small">No camera views yet.</p> : null}
      </div>
    </>
  );
}

// --- Timeline --------------------------------------------------------------------------------------------------

function Timeline({ model }: { model: EditorModel }) {
  const reduced = useReducedMotion();
  const ruler = useRef<HTMLDivElement>(null);
  const latest = model.latestSeq;
  const seqAt = (clientX: number) => {
    const rect = ruler.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return model.playhead;
    return Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * latest);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const targets: Record<string, number> = { ArrowLeft: model.playhead - step, ArrowRight: model.playhead + step, ArrowDown: model.playhead - step, ArrowUp: model.playhead + step, Home: 0, End: latest };
    if (!(e.key in targets)) return;
    e.preventDefault();
    model.moveTo(targets[e.key], true);
  };
  const onPointerDown = (e: PointerEvent) => {
    const el = ruler.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    el.focus();
    model.moveTo(seqAt(e.clientX), false);
    const move = (ev: PointerEvent) => model.moveTo(seqAt(ev.clientX), false);
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      model.moveTo(seqAt(ev.clientX), true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const pct = (seq: number) => `${latest === 0 ? 0 : (seq / latest) * 100}%`;
  return (
    <section class="panel timeline-panel" aria-labelledby="timeline-title">
      <div class="timeline-top">
        <h2 id="timeline-title" class="visually-hidden">Operation log</h2>
        <p class="announce" role="status" aria-label="Rewind announcement" aria-live="polite">{model.rewindText}</p>
        {!model.atLatest ? (
          <div class="row-actions">
            {model.canEdit ? <Button small variant="primary" busy={model.isBusy("restore")} onClick={() => { void model.restore(); }}>Restore as new operation</Button> : null}
            <Button small onClick={() => model.returnToLatest()}>Return to latest</Button>
          </div>
        ) : null}
      </div>
      <div ref={ruler} class="ruler" role="slider" tabIndex={0} aria-label="Operation log" aria-valuemin={0} aria-valuemax={latest} aria-valuenow={model.playhead}
        aria-valuetext={model.playhead === 0 ? "Start of log" : `Operation ${model.playhead} of ${latest}`} onKeyDown={onKeyDown} onPointerDown={onPointerDown}>
        {model.log.all().map((op) => (
          <span key={op.seq} class={`tick${op.seq > model.playhead ? " later" : ""}`} data-op-seq={op.seq} data-author-kind={op.author.kind === "agent" ? "agent" : "member"}
            style={{ left: pct(op.seq) }} />
        ))}
        <span class="playhead" style={{ left: pct(model.playhead) }} />
      </div>
      {reduced && model.changes.length > 0 ? (
        <ul class="changes" aria-label="Changes">{model.changes.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}</ul>
      ) : null}
    </section>
  );
}

// --- Dialogs ---------------------------------------------------------------------------------------------------

function LockDialog({ model }: { model: EditorModel }) {
  const prompt = model.lockPrompt;
  if (!prompt) return null;
  return (
    <Dialog title="Object locked" initialFocus="[data-cancel]" returnFocus={prompt.field} onClose={() => model.cancelTakeover()}>
      {(close) => (
        <>
          <div class="dialog-body"><p>{`${prompt.holder.name} is editing ${model.nodeName(prompt.nodeId)}.`}</p><p class="muted small">Taking over moves the lock to you and tells them.</p></div>
          <footer>
            <Button data-cancel onClick={close}>Cancel</Button>
            <Button variant="primary" busy={model.isBusy("takeover")} onClick={() => { void model.takeOver(); }}>Take over</Button>
          </footer>
        </>
      )}
    </Dialog>
  );
}

function AddStateDialog({ model, opener, onClose }: { model: EditorModel; opener: HTMLElement; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <Dialog title="Add state" returnFocus={opener} onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const problem = await model.addState(name);
            if (problem) setError(problem); else close();
          });
        }}>
          <div class="dialog-body">
            <Field label="State name" value={name} onInput={(e) => setName(e.currentTarget.value)} error={error} />
            <p class="muted small">Changes made while a state is chosen are stored as that state's overrides.</p>
          </div>
          <footer><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Add</Button></footer>
        </form>
      )}
    </Dialog>
  );
}
