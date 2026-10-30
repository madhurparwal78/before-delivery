import { el, label, aria, busy, openDialog } from "../dom";
import {
  api, errorText, localTimeOnly, reducedMotion, num, vecText,
  type Me, type Graph, type NodeT, type OpT, type AuthorT, type VersionT, type CommentT,
} from "../api";
import { Viewport } from "../viewport";
import { applyState, cloneGraph, graphHash } from "../../shared/graph";
import { applyOp } from "../../shared/ops";
import { buildSheet, type SheetContext } from "./editor-sheet";

interface EditorState {
  sceneId: string;
  sceneName: string;
  latestSeq: number;
  graph: Graph;
  ops: OpT[];
  playhead: number;
  selectedId: string | null;
  previewStateId: string;
  locks: Map<string, AuthorT>;
  presence: Map<string, { author: AuthorT; selection: string | null }>;
  comments: CommentT[];
  versions: VersionT[];
  canEdit: boolean;
  timeZone: string;
}

const FIELD_SPECS: { field: "position" | "rotation" | "scale"; step: number; bigStep: number; min: number; max: number }[] = [
  { field: "position", step: 0.1, bigStep: 1, min: -1000, max: 1000 },
  { field: "rotation", step: 1, bigStep: 15, min: -360, max: 360 },
  { field: "scale", step: 0.01, bigStep: 0.1, min: 0.001, max: 1000 },
];

export async function editorView(me: Me, page: HTMLElement, sceneId: string): Promise<void> {
  const canEdit = me.member?.role === "owner" || me.member?.role === "editor";
  const scene = (await api(`/api/scenes/${sceneId}`)) as { name: string; latestSeq: number; graph: Graph };
  const opsData = (await api(`/api/scenes/${sceneId}/ops?limit=1000`)) as { ops: OpT[]; latestSeq: number };
  const commentsData = (await api(`/api/scenes/${sceneId}/comments`)) as { comments: CommentT[] };
  const versionsData = (await api(`/api/scenes/${sceneId}/versions`)) as { versions: VersionT[] };

  const state: EditorState = {
    sceneId,
    sceneName: scene.name,
    latestSeq: opsData.latestSeq,
    graph: scene.graph,
    ops: opsData.ops,
    playhead: opsData.latestSeq,
    selectedId: null,
    previewStateId: "rest",
    locks: new Map(),
    presence: new Map(),
    comments: commentsData.comments,
    versions: versionsData.versions,
    canEdit,
    timeZone: me.workspace.timeZone,
  };

  page.textContent = "";
  const editor = el("div", { className: "editor" });

  // header
  const head = el("div", { className: "editor-head" });
  const presenceList = el("ul", { className: "presence-list" });
  presenceList.setAttribute("role", "list");
  label(presenceList, "People in this scene");
  const editorStatus = el("div", { className: "status", role: "status" });
  label(editorStatus, "Editor status");
  const undoBtn = el("button", { className: "btn", text: "Undo" }) as HTMLButtonElement;
  const redoBtn = el("button", { className: "btn", text: "Redo" }) as HTMLButtonElement;
  const versionsToggle = el("button", { className: "btn", text: "Versions" }) as HTMLButtonElement;
  head.append(el("h2", { text: scene.name, style: { margin: 0, fontSize: "16px" } }), presenceList, editorStatus);
  if (canEdit) head.append(undoBtn, redoBtn);
  head.append(versionsToggle);
  editor.append(head);

  const cols = el("div", { className: "editor-cols" });
  const hierarchyCol = el("div", { className: "col" }, el("h3", { text: "Hierarchy" }));
  const viewportWrap = el("div", { className: "col editor-viewport", style: { padding: "0", position: "relative", background: "#1d1c18", overflow: "hidden" } });
  const inspectorCol = el("div", { className: "col inspector" }, el("h3", { text: "Inspector" }));

  const canvas = el("canvas", {}) as HTMLCanvasElement;
  const viewportRegion = el("div", { style: { position: "absolute", inset: "0" } });
  viewportRegion.setAttribute("role", "region");
  viewportRegion.setAttribute("aria-label", "Viewport");
  viewportRegion.append(canvas);
  viewportWrap.append(viewportRegion);
  const viewport = new Viewport(canvas);
  if (!viewport.ok) {
    viewportRegion.append(el("div", { className: "viewport-fallback", text: "3D preview needs WebGL. The hierarchy, inspector and operation log still work." }));
  }

  const tree = el("div", { className: "tree" });
  tree.setAttribute("role", "tree");
  label(tree, "Scene hierarchy");
  hierarchyCol.append(tree);

  const inspectorBody = el("div", {});
  inspectorCol.append(inspectorBody);

  cols.append(hierarchyCol, viewportWrap, inspectorCol);
  editor.append(cols);

  // timeline
  const timeline = el("div", { className: "timeline" });
  const tlHead = el("div", { className: "tl-head" });
  const tlLabel = el("span", { className: "num", text: `Operation ${state.playhead} of ${state.latestSeq}` });
  tlHead.append(tlLabel);
  const tlSlider = el("div", { role: "slider", tabindex: "0" });
  aria(tlSlider, { valuemin: "0", valuemax: String(state.latestSeq), valuenow: String(state.playhead), label: "Operation log" });
  tlSlider.append(el("div", { className: "fill" }));
  const ticks = el("div", { className: "tl-ticks" });
  tlSlider.append(ticks);
  const playheadBar = el("div", { className: "tl-playhead" });
  tlSlider.append(playheadBar);
  const rewindStatus = el("div", { className: "status", role: "status" });
  label(rewindStatus, "Rewind announcement");
  const changesList = el("ul", {});
  changesList.setAttribute("role", "list");
  label(changesList, "Changes");
  changesList.style.display = "none";
  const restoreBtn = el("button", { className: "btn", text: "Restore as new operation" }) as HTMLButtonElement;
  const returnBtn = el("button", { className: "btn", text: "Return to latest" }) as HTMLButtonElement;
  timeline.append(tlHead, tlSlider, rewindStatus, changesList, el("div", { className: "tl-actions" }, restoreBtn, returnBtn));
  editor.append(timeline);
  page.append(editor);

  // =====================================================================
  // Replay helpers
  // =====================================================================

  const assetIds = new Set<string>();

  function graphAt(at: number): Graph {
    const g = cloneGraph(state.graph);
    if (at === 0) return g;
    for (const op of state.ops) {
      if (op.seq > at) break;
      applyOp(g, { type: op.type, payload: op.payload }, assetIds);
    }
    return g;
  }

  function displayedGraph(): Graph {
    const g = graphAt(state.playhead);
    if (state.previewStateId === "rest") return g;
    return applyState(g, state.previewStateId);
  }

  const pinsLayer = el("div", { style: { position: "absolute", inset: "0", pointerEvents: "none" } });
  viewportWrap.append(pinsLayer);

  function renderViewport(): void {
    const g = displayedGraph();
    const hash = graphHash(g);
    if (viewport.ok) viewport.render(g);
    viewportRegion.dataset.opSeq = String(state.playhead);
    viewportRegion.dataset.graphHash = hash;
    viewportRegion.dataset.highlighted = [...viewport.highlighted].join(",");
    renderPins(g);
  }

  function renderPins(g: Graph): void {
    pinsLayer.textContent = "";
    for (const comment of state.comments) {
      if (comment.resolved) continue;
      const node = g.nodes.find((n) => n.id === comment.nodeId);
      if (!node || !viewport.ok) continue;
      const at = viewport.projectPoint([node.position[0]!, node.position[1]!, node.position[2]!]);
      if (!at) continue;
      const pin = el("button", { className: "viewport-pin", text: "💬" });
      pin.setAttribute("aria-label", `Comment on ${node.name}`);
      pin.style.left = `${at.x}px`;
      pin.style.top = `${at.y}px`;
      pin.style.pointerEvents = "auto";
      pin.addEventListener("click", () => {
        void selectNode(node.id);
        versionsToggle.click();
      });
      pinsLayer.append(pin);
    }
  }

  function status(text: string, isError = false): void {
    editorStatus.textContent = text;
    editorStatus.classList.toggle("error", isError);
  }

  // =====================================================================
  // Timeline
  // =====================================================================

  function setPlayhead(value: number, announce = false): void {
    const clamped = Math.max(0, Math.min(state.latestSeq, value));
    const previous = state.playhead;
    state.playhead = clamped;
    aria(tlSlider, { valuemax: String(state.latestSeq), valuenow: String(clamped), label: "Operation log" });
    playheadBar.style.left = `${state.latestSeq === 0 ? 0 : (clamped / state.latestSeq) * 100}%`;
    tlLabel.textContent = `Operation ${clamped} of ${state.latestSeq}`;
    const beforeLatest = clamped < state.latestSeq;
    restoreBtn.style.display = beforeLatest && state.canEdit ? "" : "none";
    returnBtn.style.display = beforeLatest ? "" : "none";
    renderViewport();
    renderTicks();
    renderInspector();
    if (announce && previous !== clamped) {
      announceRewind(previous, clamped);
    } else if (clamped === state.latestSeq) {
      rewindStatus.textContent = "";
      changesList.style.display = "none";
    }
  }

  function renderTicks(): void {
    ticks.textContent = "";
    for (const op of state.ops) {
      const tick = el("div", { className: `tl-tick${op.author.kind === "agent" ? " agent" : ""}${op.seq > state.playhead ? " dim" : ""}` });
      tick.dataset.opSeq = String(op.seq);
      tick.dataset.authorKind = op.author.kind;
      tick.style.left = `${state.latestSeq === 0 ? 0 : (op.seq / state.latestSeq) * 100}%`;
      ticks.append(tick);
    }
  }

  function announceRewind(previous: number, current: number): void {
    if (reducedMotion()) {
      const items = diffChanges(graphAt(previous), graphAt(current));
      changesList.textContent = "";
      if (items.length > 0) {
        for (const item of items) changesList.append(el("li", { text: item }));
        changesList.style.display = "";
      } else {
        changesList.style.display = "none";
      }
    } else {
      const changed = changedNodeIds(graphAt(previous), graphAt(current));
      viewport.highlighted = new Set(changed);
      renderViewport();
      if (changed.length > 0) {
        window.setTimeout(() => {
          viewport.highlighted = new Set();
          renderViewport();
        }, 420);
      }
      changesList.style.display = "none";
    }
    if (current === 0) {
      rewindStatus.textContent = "Start of log";
      return;
    }
    const op = state.ops.find((o) => o.seq === current);
    if (!op) {
      rewindStatus.textContent = "Start of log";
      return;
    }
    const nodeName = opNodeName(op);
    const kind = op.author.kind === "agent" ? "agent" : "person";
    const time = localTimeOnly(new Date(op.createdAt), state.timeZone);
    rewindStatus.textContent = nodeName
      ? `Operation ${current} of ${state.latestSeq}: ${op.type} on ${nodeName} by ${op.author.name} (${kind}) at ${time}`
      : `Operation ${current} of ${state.latestSeq}: ${op.type} by ${op.author.name} (${kind}) at ${time}`;
  }

  function opNodeName(op: OpT): string | null {
    const p = op.payload as Record<string, unknown>;
    if (op.type === "node.add") {
      return (p.node as NodeT | undefined)?.name ?? null;
    }
    if (["state.add", "state.remove", "transition.set", "camera.view.set"].includes(op.type)) {
      return null;
    }
    const id = (p.id ?? p.nodeId) as string | undefined;
    if (!id) return null;
    return graphAt(state.playhead).nodes.find((n) => n.id === id)?.name ?? null;
  }

  function changedNodeIds(before: Graph, after: Graph): string[] {
    const changed: string[] = [];
    const ids = new Set([...before.nodes.map((n) => n.id), ...after.nodes.map((n) => n.id)]);
    for (const id of ids) {
      const a = before.nodes.find((n) => n.id === id);
      const b = after.nodes.find((n) => n.id === id);
      if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(id);
    }
    return changed;
  }

  function diffChanges(before: Graph, after: Graph): string[] {
    const items: string[] = [];
    const nodeIds = new Set([...before.nodes.map((n) => n.id), ...after.nodes.map((n) => n.id)]);
    for (const nodeId of [...nodeIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const b = before.nodes.find((n) => n.id === nodeId);
      const a = after.nodes.find((n) => n.id === nodeId);
      const name = (a ?? b)!.name;
      if (!b || !a) {
        items.push(`${name} node: ${b ? "present" : "none"} → ${a ? "present" : "none"} by ${authorForNode(nodeId, before, after)}`);
        continue;
      }
      for (const prop of ["name", "parent", "position", "rotation", "scale", "visible"] as const) {
        const bv = (b as unknown as Record<string, unknown>)[prop];
        const av = (a as unknown as Record<string, unknown>)[prop];
        if (JSON.stringify(bv) !== JSON.stringify(av)) {
          items.push(`${name} ${prop}: ${fmtVal(bv, before)} → ${fmtVal(av, after)} by ${authorForNode(nodeId, before, after)}`);
        }
      }
      const maxLayers = Math.max(b.materialLayers.length, a.materialLayers.length);
      for (let li = 0; li < maxLayers; li++) {
        const bl = b.materialLayers[li];
        const al = a.materialLayers[li];
        for (const lf of ["type", "color", "roughness", "metalness"] as const) {
          const bv = bl ? (bl as unknown as Record<string, unknown>)[lf] : undefined;
          const av = al ? (al as unknown as Record<string, unknown>)[lf] : undefined;
          if (JSON.stringify(bv) !== JSON.stringify(av)) {
            items.push(`${name} layer ${li + 1} ${lf}: ${bv === undefined ? "none" : valText(bv)} → ${av === undefined ? "none" : valText(av)} by ${authorForNode(nodeId, before, after)}`);
          }
        }
      }
    }
    // state overrides
    for (const st of after.states) {
      for (const o of st.overrides) {
        const bState = before.states.find((s) => s.id === st.id);
        const bo = bState?.overrides.find((x) => x.nodeId === o.nodeId && x.field === o.field);
        if (!bo || JSON.stringify(bo.value) !== JSON.stringify(o.value)) {
          const nodeName = after.nodes.find((n) => n.id === o.nodeId)?.name ?? o.nodeId;
          items.push(`${nodeName} ${o.field} in ${st.name}: ${bo ? valText(bo.value) : "none"} → ${valText(o.value)} by ${authorForNode(o.nodeId, before, after)}`);
        }
      }
    }
    for (const st of before.states) {
      for (const o of st.overrides) {
        const aState = after.states.find((s) => s.id === st.id);
        const ao = aState?.overrides.find((x) => x.nodeId === o.nodeId && x.field === o.field);
        if (!ao) {
          const nodeName = before.nodes.find((n) => n.id === o.nodeId)?.name ?? o.nodeId;
          items.push(`${nodeName} ${o.field} in ${st.name}: ${valText(o.value)} → none by ${authorForNode(o.nodeId, before, after)}`);
        }
      }
    }
    // scene-level: states
    const stateIds = new Set([...before.states.map((s) => s.id), ...after.states.map((s) => s.id)]);
    for (const sid of [...stateIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const bs = before.states.find((s) => s.id === sid);
      const as = after.states.find((s) => s.id === sid);
      if (!!bs !== !!as) {
        const name = (as ?? bs)!.name;
        items.push(`Scene graph state ${name}: ${bs ? "present" : "none"} → ${as ? "present" : "none"} by ${authorForScene()}`);
      }
    }
    // transitions
    const tKeys = new Set([...before.transitions.map((t) => `${t.from}|${t.trigger}`), ...after.transitions.map((t) => `${t.from}|${t.trigger}`)]);
    for (const key of [...tKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const [from, trigger] = key.split("|")!;
      const bt = before.transitions.find((t) => t.from === from && t.trigger === trigger);
      const at = after.transitions.find((t) => t.from === from && t.trigger === trigger);
      if (!bt || !at || bt.to !== at.to || bt.durationMs !== at.durationMs) {
        const fromName = (before.states.find((s) => s.id === from) ?? after.states.find((s) => s.id === from))?.name ?? from;
        items.push(`Scene graph transition ${fromName} ${trigger}: ${bt ? `${bt.durationMs} ms` : "none"} → ${at ? `${at.durationMs} ms` : "none"} by ${authorForScene()}`);
      }
    }
    // camera views
    const viewNames = new Set([...before.cameraViews.map((c) => c.name), ...after.cameraViews.map((c) => c.name)]);
    for (const name of [...viewNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const bv = before.cameraViews.find((c) => c.name === name);
      const av = after.cameraViews.find((c) => c.name === name);
      if (!!bv !== !!av) {
        items.push(`Scene graph camera view ${name}: ${bv ? "present" : "none"} → ${av ? "present" : "none"} by ${authorForScene()}`);
      }
    }
    return items;
  }

  function authorForNode(nodeId: string, before: Graph, after: Graph): string {
    void before;
    void after;
    const from = Math.min(announceFrom.value, state.playhead);
    const to = Math.max(announceFrom.value, state.playhead);
    let author = "";
    for (const op of state.ops) {
      if (op.seq <= to && op.seq > from) {
        const p = op.payload as Record<string, unknown>;
        if (p.id === nodeId || p.nodeId === nodeId || (p.node as NodeT | undefined)?.id === nodeId) {
          author = op.author.name;
        }
      }
    }
    return author || "the team";
  }

  function authorForScene(): string {
    const from = Math.min(announceFrom.value, state.playhead);
    const to = Math.max(announceFrom.value, state.playhead);
    let author = "";
    for (const op of state.ops) {
      if (op.seq <= to && op.seq > from) {
        author = op.author.name;
      }
    }
    return author || "the team";
  }

  function fmtVal(value: unknown, g: Graph): string {
    if (value === null || value === undefined) return "none";
    if (Array.isArray(value)) return vecText(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return num(value);
    const parent = g.nodes.find((n) => n.id === value);
    if (parent) return parent.name;
    return String(value);
  }

  function valText(value: unknown): string {
    if (value === null || value === undefined) return "none";
    if (Array.isArray(value)) return vecText(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return num(value);
    return String(value);
  }

  const announceFrom = { value: opsData.latestSeq };

  // =====================================================================
  // Hierarchy and inspector
  // =====================================================================

  function renderHierarchy(): void {
    tree.textContent = "";
    const g = graphAtPlayhead();
    const order: NodeT[] = [];
    const walk = (node: NodeT): void => {
      order.push(node);
      for (const child of g.nodes.filter((n) => n.parentId === node.id)) walk(child);
    };
    for (const root of g.nodes.filter((n) => n.parentId === null)) walk(root);
    for (const node of order) {
      const item = el("button", { role: "treeitem", text: node.name, className: node.id === state.selectedId ? "selected" : "" });
      item.dataset.nodeId = node.id;
      const holder = state.locks.get(node.id);
      if (holder) {
        item.classList.add("locked");
        item.setAttribute("aria-description", `Locked by ${holder.name}`);
      }
      item.addEventListener("click", () => void selectNode(node.id));
      tree.append(item);
    }
  }

  function graphAtPlayhead(): Graph {
    return graphAt(state.playhead);
  }

  async function selectNode(nodeId: string | null): Promise<void> {
    const previous = state.selectedId;
    state.selectedId = nodeId;
    if (canEdit && nodeId) {
      try {
        await api(`/api/scenes/${sceneId}/locks`, { method: "POST", body: { nodeId } });
      } catch {
        // The node may be held by someone else; selection still shows it.
      }
    }
    if (canEdit && previous && previous !== nodeId) {
      try {
        await api(`/api/scenes/${sceneId}/locks/${previous}`, { method: "DELETE" });
      } catch {
        // not the holder
      }
    }
    renderHierarchy();
    renderInspector();
    void sendPresence();
  }

  function renderInspector(): void {
    inspectorBody.textContent = "";
    const g = graphAtPlayhead();
    const node = g.nodes.find((n) => n.id === state.selectedId);
    const viewingPast = state.playhead < state.latestSeq;
    if (viewingPast) {
      inspectorBody.append(el("p", { className: "num", text: `Viewing operation ${state.playhead}. Return to latest to edit.` }));
    }
    if (!node) {
      if (!viewingPast) inspectorBody.append(el("p", { text: "Select an object to inspect it." }));
      return;
    }
    const holder = state.locks.get(node.id);
    if (holder && holder.id !== me.member?.id) {
      inspectorBody.append(el("p", { className: "status", text: `Locked by ${holder.name}` }));
    }

    for (const spec of FIELD_SPECS) {
      const row = el("div", { className: "field-row" });
      row.append(el("span", { className: "vec-label", text: spec.field[0]!.toUpperCase() + spec.field.slice(1) }));
      for (let i = 0; i < 3; i++) {
        const input = el("input", { type: "number", step: "any", className: "num", value: String(node[spec.field][i]), disabled: !canEdit || viewingPast }) as HTMLInputElement;
        input.setAttribute("role", "spinbutton");
        label(input, `${spec.field[0]!.toUpperCase() + spec.field.slice(1)} ${"XYZ"[i]}`);
        const wrap = el("div", { className: "spin-wrap" }, input);
        row.append(wrap);
        bindTransformInput(input, node, spec, i);
      }
      inspectorBody.append(row);
    }

    const layersTitle = el("h3", { text: "Material layers" });
    const layers = el("ul", { className: "layers" });
    layers.setAttribute("role", "list");
    label(layers, "Material layers");
    for (const layer of node.materialLayers) {
      const item = el("li", {});
      item.append(el("div", { className: "layer-title" }, el("span", { text: layer.type }), el("span", { className: "num", text: layer.id })));
      const colorRow = el("div", { className: "field-row" });
      colorRow.append(el("span", { className: "vec-label", text: "Color" }));
      for (let i = 0; i < 3; i++) {
        const input = el("input", { type: "number", step: "0.01", min: "0", max: "1", className: "num", value: String(layer.color[i]), disabled: !canEdit || viewingPast }) as HTMLInputElement;
        label(input, `${layer.type} color ${"RGB"[i]}`);
        bindLayerInput(input, node.id, layer.id, "color", i);
        colorRow.append(el("div", {}, input));
      }
      item.append(colorRow);
      const roughness = el("input", { type: "number", step: "0.01", min: "0", max: "1", className: "num", value: String(layer.roughness), disabled: !canEdit || viewingPast }) as HTMLInputElement;
      roughness.setAttribute("role", "spinbutton");
      label(roughness, `${layer.type} roughness`);
      bindLayerInput(roughness, node.id, layer.id, "roughness", 0);
      const metalness = el("input", { type: "number", step: "0.01", min: "0", max: "1", className: "num", value: String(layer.metalness), disabled: !canEdit || viewingPast }) as HTMLInputElement;
      metalness.setAttribute("role", "spinbutton");
      label(metalness, `${layer.type} metalness`);
      bindLayerInput(metalness, node.id, layer.id, "metalness", 0);
      item.append(el("div", { className: "field-row" }, el("div", {}, roughness), el("div", {}, metalness)));
      layers.append(item);
    }
    inspectorBody.append(layersTitle, layers);
    const addLayerBtn = el("button", { className: "btn", text: "Add material layer", disabled: !canEdit || viewingPast });
    label(addLayerBtn, "Add material layer");
    addLayerBtn.addEventListener("click", () => openLayerMenu(addLayerBtn, node.id));

    // States
    const statesSelect = el("select", { className: "compact" }) as HTMLSelectElement;
    statesSelect.setAttribute("role", "listbox");
    label(statesSelect, "States");
    const g2 = graphAtPlayhead();
    for (const st of g2.states) {
      const opt = el("option", { value: st.id, text: st.name }) as HTMLOptionElement;
      if (st.id === state.previewStateId) opt.selected = true;
      statesSelect.append(opt);
    }
    statesSelect.addEventListener("change", () => {
      state.previewStateId = statesSelect.value;
      renderViewport();
    });
    const addStateBtn = el("button", { className: "btn", text: "Add state", disabled: !canEdit || viewingPast });
    label(addStateBtn, "Add state");
    addStateBtn.addEventListener("click", () => {
      const nameInput = el("input", { type: "text", id: "as-name" }) as HTMLInputElement;
      const add = el("button", { className: "btn primary", type: "submit", text: "Add" }) as HTMLButtonElement;
      const form = el("form", {}, el("div", { className: "field" }, el("label", { for: nameInput.id, text: "State name" }), nameInput), add);
      form.setAttribute("aria-label", "Add state");
      const dialog = openDialog(form, { name: "Add state", onOpen: () => nameInput.focus() });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const b = busy(add);
        b.start();
        try {
          await applyOps([{ type: "state.add", payload: { state: { id: `st_${Date.now().toString(36)}`, name: nameInput.value } } }]);
          state.previewStateId = "rest";
          dialog.close();
          await reloadAll();
        } catch (err) {
          status(errorText(err), true);
        } finally {
          b.end();
        }
      });
    });

    const viewsSelect = el("select", { className: "compact" }) as HTMLSelectElement;
    label(viewsSelect, "Camera views");
    for (const view of g2.cameraViews) {
      viewsSelect.append(el("option", { value: view.name, text: view.name }));
    }
    viewsSelect.addEventListener("change", () => {
      const view = g2.cameraViews.find((v) => v.name === viewsSelect.value);
      if (view && viewport.ok) {
        viewport.camera.target = [...view.target] as [number, number, number];
        viewport.camera.fov = view.fov;
        renderViewport();
      }
    });

    inspectorBody.append(el("div", { className: "states-row" }, statesSelect, addStateBtn, addLayerBtn), el("h3", { text: "Camera views" }), viewsSelect);
  }

  function openLayerMenu(anchor: HTMLElement, nodeId: string): void {
    const menu = el("div", { className: "menu", role: "menu", style: { position: "fixed" } });
    label(menu, "Layer type");
    const types: { id: "base" | "clearcoat" | "sheen" | "emission"; name: string }[] = [
      { id: "base", name: "Base" },
      { id: "clearcoat", name: "Clearcoat" },
      { id: "sheen", name: "Sheen" },
      { id: "emission", name: "Emission" },
    ];
    let active = 0;
    const items = types.map((t, i) => {
      const item = el("button", { role: "menuitem", text: t.name });
      item.addEventListener("click", async () => {
        menu.remove();
        try {
          await applyOps([{
            type: "material.layer.add",
            payload: { id: nodeId, layer: { id: `l_${Date.now().toString(36)}`, type: t.id, color: [0.7, 0.7, 0.7], roughness: 0.6, metalness: 0.2 } },
          }]);
          await reloadAll();
        } catch (err) {
          status(errorText(err), true);
        }
      });
      if (i === 0) item.classList.add("active");
      menu.append(item);
      return item;
    });
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    menu.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = (active + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle("active", i === active));
        items[active]!.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = (active - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle("active", i === active));
        items[active]!.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[active]!.click();
      } else if (e.key === "Escape") {
        menu.remove();
        anchor.focus();
      }
    });
    items[0]!.focus();
  }

  function bindTransformInput(input: HTMLInputElement, node: NodeT, spec: (typeof FIELD_SPECS)[number], axis: number): void {
    const field = spec.field;
    const fieldLabel = `${field[0]!.toUpperCase()}${field.slice(1)} ${"XYZ"[axis]}`;
    let scrubStart: { x: number; value: number } | null = null;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit(Number(input.value));
      } else if (e.key === "Escape") {
        const current = graphAtPlayhead().nodes.find((n) => n.id === node.id);
        if (current) input.value = String(current[field][axis]);
        input.blur();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? spec.bigStep : spec.step);
        void commit(Number(input.value) + delta);
      }
    });
    input.addEventListener("change", () => {
      void commit(Number(input.value));
    });
    // Scrubbing on the field's label.
    const labelEl = (input.closest(".field-row")?.querySelector(".vec-label") ?? null) as HTMLElement | null;
    if (labelEl) {
      labelEl.addEventListener("pointerdown", (e) => {
        const pe = e as PointerEvent;
        scrubStart = { x: pe.clientX, value: Number(input.value) };
        labelEl.setPointerCapture(pe.pointerId);
        labelEl.style.cursor = "ew-resize";
      });
      labelEl.addEventListener("pointermove", (e) => {
        if (!scrubStart) return;
        const pe = e as PointerEvent;
        const delta = Math.round((pe.clientX - scrubStart.x) / 4) * spec.step;
        input.value = String(Number((scrubStart.value + delta).toFixed(6)));
      });
      labelEl.addEventListener("pointerup", () => {
        if (scrubStart) {
          scrubStart = null;
          labelEl.style.cursor = "";
          void commit(Number(input.value));
        }
      });
    }

    async function commit(value: number): Promise<void> {
      const holder = state.locks.get(node.id);
      if (holder && holder.id !== me.member?.id) {
        openTakeover(node.id, node.name, field, axis, value, input, spec);
        return;
      }
      const current = graphAtPlayhead().nodes.find((n) => n.id === node.id);
      if (!current) return;
      const before = current[field][axis];
      if (value === before) return;
      const next: [number, number, number] = [...current[field]] as [number, number, number];
      next[axis] = value;
      input.value = String(value);
      markPending(input, true);
      try {
        const op = state.previewStateId === "rest"
          ? { type: "transform.set", payload: { id: node.id, [field]: next } }
          : { type: "state.override.set", payload: { stateId: state.previewStateId, nodeId: node.id, field, value: next } };
        await applyOps([op]);
        await reloadAll(true);
        markPending(input, false);
        status("");
      } catch (err) {
        markPending(input, false);
        input.value = String(before);
        const e = err as { status: number; body: Record<string, unknown> };
        if (e.status === 409 && e.body.error === "locked") {
          state.locks.set(node.id, e.body.holder as AuthorT);
          renderHierarchy();
          status(`Change to ${node.name} rolled back: ${(e.body.holder as AuthorT).name} is editing it.`, true);
        } else {
          status(`${fieldLabel} must be between ${spec.min} and ${spec.max}.`, true);
        }
        rejectFlash(input);
      }
    }
  }

  function openTakeover(nodeId: string, nodeName: string, field: "position" | "rotation" | "scale", axis: number, value: number, input: HTMLInputElement, spec: (typeof FIELD_SPECS)[number]): void {
    const holder = state.locks.get(nodeId)!;
    const content = el("div", {}, el("p", { text: `${holder.name} is editing ${nodeName}.` }));
    content.setAttribute("role", "alertdialog");
    content.setAttribute("aria-label", "Object locked");
    const take = el("button", { className: "btn primary", text: "Take over" }) as HTMLButtonElement;
    const cancel = el("button", { className: "btn", text: "Cancel" }) as HTMLButtonElement;
    content.append(el("div", { className: "dialog-actions" }, cancel, take));
    const dialog = openDialog(content, { name: "Object locked", onOpen: () => cancel.focus() });
    cancel.addEventListener("click", () => {
      const current = graphAtPlayhead().nodes.find((n) => n.id === nodeId);
      if (current) input.value = String(current[field][axis]);
      dialog.close();
    });
    take.addEventListener("click", async () => {
      const b = busy(take);
      b.start();
      try {
        await api(`/api/scenes/${sceneId}/locks/${nodeId}/takeover`, { method: "POST" });
        state.locks.set(nodeId, { kind: "member", id: me.member!.id, name: me.member!.name });
        status(`You now hold ${nodeName}.`);
        dialog.close();
        const current = graphAtPlayhead().nodes.find((n) => n.id === nodeId);
        if (current) {
          const next: [number, number, number] = [...current[field]] as [number, number, number];
          next[axis] = value;
          markPending(input, true);
          try {
            const op = state.previewStateId === "rest"
              ? { type: "transform.set", payload: { id: nodeId, [field]: next } }
              : { type: "state.override.set", payload: { stateId: state.previewStateId, nodeId, field, value: next } };
            await applyOps([op]);
            await reloadAll(true);
            markPending(input, false);
          } catch (err) {
            markPending(input, false);
            status(errorText(err), true);
          }
        }
      } catch (err) {
        status(errorText(err), true);
        b.end();
      }
    });
    void spec;
  }

  function bindLayerInput(input: HTMLInputElement, nodeId: string, layerId: string, field: "color" | "roughness" | "metalness", axis: number): void {
    input.addEventListener("change", async () => {
      const value = Number(input.value);
      markPending(input, true);
      try {
        let payload: Record<string, unknown>;
        const g = graphAtPlayhead();
        const node = g.nodes.find((n) => n.id === nodeId);
        const layer = node?.materialLayers.find((l) => l.id === layerId);
        if (!layer) throw new Error("Layer is gone");
        if (field === "color") {
          const next = [...layer.color] as [number, number, number];
          next[axis] = value;
          payload = { id: nodeId, layerId, color: next };
        } else if (field === "roughness") {
          payload = { id: nodeId, layerId, roughness: value };
        } else {
          payload = { id: nodeId, layerId, metalness: value };
        }
        await applyOps([{ type: "material.layer.set", payload }]);
        await reloadAll(true);
        markPending(input, false);
      } catch (err) {
        markPending(input, false);
        status(errorText(err), true);
        rejectFlash(input);
      }
    });
  }

  function markPending(input: HTMLElement, pending: boolean): void {
    const wrap = input.parentElement ?? input;
    const existing = wrap.querySelector(".pending-tag");
    if (pending) {
      input.dataset.pending = "true";
      if (!existing) wrap.append(el("span", { className: "pending-tag", text: "Pending" }));
    } else {
      delete input.dataset.pending;
      existing?.remove();
    }
  }

  function rejectFlash(input: HTMLElement): void {
    const wrap = input.parentElement ?? input;
    wrap.classList.add("rejected");
    window.setTimeout(() => wrap.classList.remove("rejected"), 2000);
  }

  async function applyOps(ops: { type: string; payload: Record<string, unknown> }[]): Promise<void> {
    await api(`/api/scenes/${sceneId}/ops`, { method: "POST", body: { ops } });
  }

  async function reloadAll(soft = false): Promise<void> {
    const ops2 = (await api(`/api/scenes/${sceneId}/ops?limit=1000`)) as { ops: OpT[]; latestSeq: number };
    state.ops = ops2.ops;
    const wasAtLatest = state.playhead === state.latestSeq;
    state.latestSeq = ops2.latestSeq;
    if (!soft || wasAtLatest) state.playhead = ops2.latestSeq;
    setPlayhead(state.playhead);
    renderHierarchy();
    renderInspector();
    await refreshLocks();
    renderHierarchy();
    renderInspector();
  }

  async function refreshLocks(): Promise<void> {
    try {
      const data = (await api(`/api/scenes/${sceneId}/locks`)) as { locks: { nodeId: string; holder: AuthorT }[] };
      state.locks = new Map(data.locks.map((l) => [l.nodeId, l.holder]));
    } catch {
      // PocketBase may be briefly unreachable
    }
  }

  function renderPresence(): void {
    presenceList.textContent = "";
    if (state.presence.size === 0) {
      presenceList.append(el("li", { text: "Only you" }));
      return;
    }
    for (const [, entry] of state.presence) {
      const who = `${entry.author.name}${entry.author.kind === "agent" ? " (agent)" : ""}${entry.selection ? ` · ${entry.selection}` : ""}`;
      presenceList.append(el("li", {}, el("span", { className: "dot" }), document.createTextNode(who)));
    }
  }

  async function sendPresence(): Promise<void> {
    try {
      await api(`/api/scenes/${sceneId}/presence`, { method: "POST", body: { selection: state.selectedId, cursor: [0.5, 0.5] } });
    } catch {
      // best effort
    }
  }

  // realtime
  const events = new EventSource(`/api/scenes/${sceneId}/events`);
  events.addEventListener("op", () => {
    void reloadAll(true);
  });
  events.addEventListener("lock", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { nodeId: string; holder: AuthorT | null };
    if (data.holder) state.locks.set(data.nodeId, data.holder);
    else state.locks.delete(data.nodeId);
    renderHierarchy();
    renderInspector();
  });
  events.addEventListener("presence", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { authors: { author: AuthorT; selection: string | null }[] };
    for (const entry of data.authors) {
      const name = entry.selection ? (graphAt(state.latestSeq).nodes.find((n) => n.id === entry.selection)?.name ?? entry.selection) : null;
      state.presence.set(entry.author.id, { author: entry.author, selection: name });
    }
    renderPresence();
  });
  events.addEventListener("comment", () => {
    void reloadComments();
  });
  events.addEventListener("version", () => {
    void reloadVersions();
  });

  async function reloadComments(): Promise<void> {
    const comments = (await api(`/api/scenes/${sceneId}/comments`)) as { comments: CommentT[] };
    state.comments = comments.comments;
    if (sheet) renderSheet();
  }

  async function reloadVersions(): Promise<void> {
    const versions = (await api(`/api/scenes/${sceneId}/versions`)) as { versions: VersionT[] };
    state.versions = versions.versions;
    if (sheet) renderSheet();
  }

  window.setInterval(() => {
    void sendPresence();
    void refreshLocks().then(() => {
      renderHierarchy();
      renderInspector();
    });
  }, 6000);
  void sendPresence();
  void refreshLocks().then(() => {
    renderHierarchy();
    renderInspector();
  });

  // timeline interaction
  function playheadFromX(clientX: number): number {
    const rect = tlSlider.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(ratio * state.latestSeq);
  }
  tlSlider.addEventListener("pointerdown", (e) => {
    announceFrom.value = state.playhead;
    tlSlider.setPointerCapture(e.pointerId);
    setPlayhead(playheadFromX(e.clientX));
  });
  tlSlider.addEventListener("pointermove", (e) => {
    if (e.buttons !== 1) return;
    setPlayhead(playheadFromX(e.clientX));
  });
  tlSlider.addEventListener("pointerup", () => {
    setPlayhead(state.playhead, true);
  });
  tlSlider.addEventListener("keydown", (e) => {
    announceFrom.value = state.playhead;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPlayhead(state.playhead - (e.shiftKey ? 10 : 1), true);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPlayhead(state.playhead + (e.shiftKey ? 10 : 1), true);
    } else if (e.key === "Home") {
      e.preventDefault();
      setPlayhead(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      setPlayhead(state.latestSeq, true);
    }
  });

  restoreBtn.addEventListener("click", async () => {
    const b = busy(restoreBtn);
    b.start();
    try {
      const toSeq = state.playhead;
      await api(`/api/scenes/${sceneId}/restore`, { method: "POST", body: { toSeq } });
      await reloadAll();
      state.playhead = state.latestSeq;
      announceFrom.value = state.latestSeq;
      setPlayhead(state.latestSeq);
      status(`Restored to operation ${toSeq}.`);
    } catch (err) {
      const e = err as { body?: Record<string, unknown> };
      const holder = e.body?.holder as AuthorT | undefined;
      if (holder) {
        const nodeName = e.body?.nodeId ? graphAt(state.latestSeq).nodes.find((n) => n.id === e.body!.nodeId)?.name : undefined;
        status(`Cannot restore: ${holder.name} is editing ${nodeName ?? "a node"}.`, true);
      } else {
        status(errorText(err), true);
      }
    } finally {
      b.end();
    }
  });
  returnBtn.addEventListener("click", () => {
    announceFrom.value = state.playhead;
    setPlayhead(state.latestSeq, true);
  });

  async function undoRedo(kind: "undo" | "redo"): Promise<void> {
    const btn = kind === "undo" ? undoBtn : redoBtn;
    const b = busy(btn);
    b.start();
    try {
      await api(`/api/scenes/${sceneId}/${kind}`, { method: "POST" });
      await reloadAll();
      state.playhead = state.latestSeq;
      announceFrom.value = state.latestSeq;
      setPlayhead(state.latestSeq);
      status(kind === "undo" ? "Undone." : "Redone.");
    } catch (err) {
      const e = err as { body?: Record<string, unknown> };
      const holder = e.body?.holder as AuthorT | undefined;
      const nodeId = e.body?.nodeId as string | undefined;
      const nodeName = nodeId ? graphAt(state.latestSeq).nodes.find((n) => n.id === nodeId)?.name : undefined;
      if (e.body?.error === "nothing_to_undo") status("Nothing to undo.", true);
      else if (e.body?.error === "nothing_to_redo") status("Nothing to redo.", true);
      else if (holder && nodeName) status(`Cannot undo: ${holder.name} is editing ${nodeName}.`, true);
      else if (nodeName) status(`Cannot undo: a later change removed ${nodeName}.`, true);
      else if (nodeId === null) status("Cannot undo: a later change removed or uses a state.", true);
      else status(errorText(err), true);
    } finally {
      b.end();
    }
  }
  if (canEdit) {
    undoBtn.addEventListener("click", () => void undoRedo("undo"));
    redoBtn.addEventListener("click", () => void undoRedo("redo"));
    document.addEventListener("keydown", (e) => {
      const inField = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
      if (inField) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void undoRedo("undo");
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        void undoRedo("redo");
      }
    });
  }

  viewport.setClickHandler((nodeId) => {
    void selectNode(nodeId);
  });

  // =====================================================================
  // Side sheet
  // =====================================================================
  let sheet: HTMLElement | null = null;
  const ctx: SheetContext = {
    me,
    sceneId,
    timeZone: state.timeZone,
    canEdit,
    get versions() {
      return state.versions;
    },
    get comments() {
      return state.comments;
    },
    get selectedNodeId() {
      return state.selectedId;
    },
    get graphAtLatest() {
      return graphAt(state.latestSeq);
    },
    onStatus: status,
    refresh: async () => {
      await reloadVersions();
      await reloadComments();
      renderSheet();
    },
  };
  versionsToggle.addEventListener("click", () => {
    if (sheet) {
      sheet.remove();
      sheet = null;
      return;
    }
    sheet = buildSheet(ctx);
    document.body.append(sheet);
  });
  function renderSheet(): void {
    if (!sheet) return;
    const scrolled = sheet.scrollTop;
    sheet.remove();
    sheet = buildSheet(ctx);
    sheet.scrollTop = scrolled;
    document.body.append(sheet);
  }

  // initial render
  setPlayhead(state.playhead);
  renderHierarchy();
  renderInspector();
  renderTicks();
  renderPresence();
  void viewportRegion;
}
