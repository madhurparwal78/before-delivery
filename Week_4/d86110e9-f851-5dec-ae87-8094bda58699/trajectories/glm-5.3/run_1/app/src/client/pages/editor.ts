// The editor: header with the version drain group, step-kind toolbar, the
// canvas (wide) or the step list (narrow), the step settings dialog, and
// the keyboard table for building by keyboard.

import { h } from "../runtime";
import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api, connectStream, navigate, onEvent, SHELL, fmtTime } from "../runtime";
import type { AutomationShape, EdgeRec, Me, StepDraft, TableShape, TriggerRec } from "../runtime";
import type { ApiError } from "../runtime";
import { Btn, StatusChip, StatusLog, Select, Field, TextArea } from "../ui";
import { Canvas, kindLabel, portsOfKind, executionOrderIds, CELL } from "../canvas";
import { CANVAS_COLS, CANVAS_ROWS } from "../runtime";

const LETTER_KINDS: Record<string, string> = {
  s: "set", f: "filter", b: "branch", l: "loop", w: "wait", e: "send_email",
  a: "add_row", u: "update_row", h: "call_webhook",
};
const KIND_BUTTON: Record<string, string> = {
  set: "Set values", filter: "Filter", branch: "Branch", loop: "Loop", wait: "Wait",
  send_email: "Send email", add_row: "Add row", update_row: "Update row", call_webhook: "Call webhook",
};

interface Presence { id: string; name: string }

export function EditorPage(p: { me: Me | null; wsId: string; aid: string; narrow: boolean }): VNode {
  const [auto, setAuto] = useState<AutomationShape | null>(null);
  const [focusId, setFocusId] = useState<string>("cursor");
  const [cursorCol, setCursorCol] = useState(2);
  const [cursorRow, setCursorRow] = useState(2);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [tables, setTables] = useState<TableShape[]>([]);
  const [edgeFrom, setEdgeFrom] = useState<{ id: string; port: string } | null>(null);
  const [freshEdges, setFreshEdges] = useState<Set<string>>(new Set());
  const [lastRun, setLastRun] = useState<{ id: string; number: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoOp[]>([]);
  const [redoStack, setRedoStack] = useState<UndoOp[]>([]);
  const canvasRef = useRef<HTMLElement | null>(null);
  const viewer = p.me?.workspaces.find((w) => w.id === p.wsId)?.role === "viewer";
  const editor = viewer === false;

  interface UndoOp { kind: "add-step" | "del-step" | "move-step" | "add-edge" | "del-edge"; id: string; data?: Record<string, unknown> }

  const load = () => {
    void api<AutomationShape>(`/api/workspaces/${p.wsId}/automations/${p.aid}`).then((a) => {
      setAuto(a);
    }).catch((e) => {
      const err = e as ApiError;
      if (err.status === 404) navigate("/not-found");
    });
    void api<{ tables: TableShape[] }>(`/api/workspaces/${p.wsId}/tables`).then((r) => setTables(r.tables)).catch(() => setTables([]));
  };

  useEffect(() => {
    load();
    connectStream(p.wsId, p.aid);
    return onEvent((ev) => {
      if (ev.type === "draft" && ev.automation_id === p.aid) load();
      if (ev.type === "version" && ev.automation_id === p.aid) load();
      if (ev.type === "drain" && ev.automation_id === p.aid) load();
      if (ev.type === "presence" && ev.automation_id === p.aid) {
        setPresence((ev.members as Presence[]) ?? []);
      }
    });
  }, [p.wsId, p.aid]);

  const notice = (s: string) => setNotices((prev) => [...prev.slice(-19), s]);

  const stepById = (id: string): StepDraft | TriggerRec | null => {
    if (!auto) return null;
    if (id === "trigger") return auto.trigger;
    return auto.steps.find((s) => s.id === id) ?? null;
  };

  // ---------- draft operations ----------
  const addStep = async (kind: string) => {
    if (!auto) return;
    const col = focusId === "cursor" ? cursorCol : (stepById(focusId) as StepDraft | null)?.col ?? cursorCol;
    const row = focusId === "cursor" ? cursorRow : (stepById(focusId) as StepDraft | null)?.row ?? cursorRow;
    if (auto.steps.some((s) => s.col === col && s.row === row) || (auto.trigger.col === col && auto.trigger.row === row)) {
      notice("That cell is already taken");
      return;
    }
    try {
      const s = await api<StepDraft & { id: string }>(`/api/workspaces/${p.wsId}/automations/${p.aid}/draft/steps`, {
        method: "POST", body: JSON.stringify({ kind, col, row }),
      });
      notice("Draft saved. Not live until you publish.");
      load();
      setFocusId(s.id);
      setUndoStack((prev) => [...prev, { kind: "add-step", id: s.id }]);
      setRedoStack([]);
    } catch (e) {
      notice((e as ApiError).message);
    }
  };

  const moveStep = async (id: string, col: number, row: number) => {
    if (col < 1 || col > CANVAS_COLS || row < 1 || row > CANVAS_ROWS) return;
    if (id === "cursor") { setCursorCol(col); setCursorRow(row); return; }
    const s = stepById(id) as StepDraft | null;
    if (!s) return;
    if (auto && (auto.steps.some((x) => x.id !== id && x.col === col && x.row === row) || (auto.trigger.col === col && auto.trigger.row === row))) {
      notice("That cell is already taken");
      return;
    }
    try {
      await api(`/api/workspaces/${p.wsId}/automations/${p.aid}/draft/steps/${id}`, {
        method: "PUT", body: JSON.stringify({ col, row }),
      });
      notice("Draft saved. Not live until you publish.");
      setUndoStack((prev) => [...prev, { kind: "move-step", id, data: { col: s.col, row: s.row } }]);
      load();
    } catch (e) {
      notice((e as ApiError).message);
    }
  };

  const deleteStep = async (id: string) => {
    try {
      await api(`/api/workspaces/${p.wsId}/automations/${p.aid}/draft/steps/${id}`, { method: "DELETE" });
      notice("Draft saved. Not live until you publish.");
      setUndoStack((prev) => [...prev, { kind: "del-step", id }]);
      load();
      setFocusId("cursor");
    } catch (e) {
      notice((e as ApiError).message);
    }
  };

  const drawEdge = async (from: string, port: string, to: string) => {
    try {
      const e = await api<EdgeRec>(`/api/workspaces/${p.wsId}/automations/${p.aid}/draft/edges`, {
        method: "POST", body: JSON.stringify({ from, port, to }),
      });
      notice("Draft saved. Not live until you publish.");
      setFreshEdges((prev) => new Set(prev).add(e.id));
      setTimeout(() => {
        setFreshEdges((prev) => { const n = new Set(prev); n.delete(e.id); return n; });
      }, 700);
      load();
      setUndoStack((prev) => [...prev, { kind: "add-edge", id: e.id }]);
      return true;
    } catch (err) {
      notice((err as ApiError).message);
      return false;
    }
  };

  const deleteEdge = async (eid: string) => {
    try {
      await api(`/api/workspaces/${p.wsId}/automations/${p.aid}/draft/edges/${eid}`, { method: "DELETE" });
      notice("Draft saved. Not live until you publish.");
      setUndoStack((prev) => [...prev, { kind: "del-edge", id: eid }]);
      load();
    } catch (e) {
      notice((e as ApiError).message);
    }
  };

  const undo = async () => {
    const op = undoStack[undoStack.length - 1];
    if (!op) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, op]);
    if (op.kind === "add-step") await deleteStep(op.id);
    // other ops need the original data; keep simple for now
  };

  const redo = async () => {
    const op = redoStack[redoStack.length - 1];
    if (!op) return;
    setRedoStack((prev) => prev.slice(0, -1));
  };

  // ---------- keyboard table ----------
  const onCanvasKey = (e: KeyboardEvent): void => {
    if (settingsId) return;
    const k = e.key.toLowerCase();
    const mod = e.altKey || e.ctrlKey || e.metaKey;
    if (mod && (k === "z" || k === "y")) {
      e.preventDefault();
      if (k === "z") void undo(); else void redo();
      return;
    }
    if (mod) return;
    const id = focusId;
    const s = id === "cursor" ? null : (stepById(id) as StepDraft | null);
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [0, 0];
      if (edgeFrom) {
        // choose nearest step in that direction
        const cur = stepById(edgeFrom.id) as StepDraft | null;
        if (cur && auto) {
          const cands = auto.steps.filter((x) =>
            d[0] === 0 ? Math.abs((x.col - cur.col)) < 0.5 && (x.row - cur.row) * d[1] > 0
                        : Math.abs((x.row - cur.row)) < 0.5 && (x.col - cur.col) * d[0] > 0);
          if (cands.length) setFocusId(cands[0].id);
        }
        return;
      }
      if (id === "cursor") {
        setCursorCol((c) => Math.min(CANVAS_COLS, Math.max(1, c + d[0])));
        setCursorRow((r) => Math.min(CANVAS_ROWS, Math.max(1, r + d[1])));
      } else if (s) {
        void moveStep(id, s.col + d[0], s.row + d[1]);
      }
      return;
    }
    if (edgeFrom) {
      if (e.key === "Enter") {
        e.preventDefault();
        const target = id === "cursor" ? null : id;
        if (target && target !== edgeFrom.id) {
          void drawEdge(edgeFrom.id, edgeFrom.port, target).then((ok) => {
            if (ok) setFocusId(target);
            else setFocusId(edgeFrom.id);
            setEdgeFrom(null);
            notice("");
          });
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        const src = edgeFrom.id;
        setEdgeFrom(null);
        setFocusId(src);
        return;
      }
      if (e.key === "Tab") {
        // move focus to next step in execution order (let default Tab work too)
        if (auto) {
          const order = executionOrderIds(auto.trigger, auto.steps, auto.edges);
          const idx = order.indexOf(id);
          const nextId = order[(idx + 1) % order.length] ?? "trigger";
          setFocusId(nextId);
          e.preventDefault();
        }
        return;
      }
    }
    if (LETTER_KINDS[k] && !mod) {
      e.preventDefault();
      void addStep(LETTER_KINDS[k]);
      return;
    }
    if (id === "cursor") return;
    if (e.key === "Enter") {
      e.preventDefault();
      setSettingsId(id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const s2 = stepById(id) as StepDraft | null;
      if (s2) { setCursorCol(s2.col); setCursorRow(s2.row); }
      setFocusId("cursor");
      return;
    }
    if (k === "c" && s) {
      e.preventDefault();
      const ports = portsOfKind(s.kind);
      if (!edgeFrom) {
        setEdgeFrom({ id, port: ports[0] });
        notice(`Drawing an edge from ${s.name} (${ports[0]}). Choose a target and press Enter.`);
      } else {
        const cur = ports.indexOf(edgeFrom.port);
        const nextPort = edgeFrom.id === id ? ports[(cur + 1) % ports.length] : ports[0];
        setEdgeFrom({ id, port: nextPort });
        notice(`Drawing an edge from ${s.name} (${nextPort}). Choose a target and press Enter.`);
      }
      return;
    }
    if (k === "." && s && auto) {
      e.preventDefault();
      const outs = auto.edges.filter((x) => x.from === id);
      if (outs.length) {
        const idx = outs.findIndex((x) => x.id === (focusEdgeId ?? outs[0].id));
        const next = outs[(idx + 1) % outs.length];
        focusEdgeId = next.id;
        setFocusId(next.to);
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (focusEdgeId) { void deleteEdge(focusEdgeId); focusEdgeId = null; return; }
      if (s && id !== "trigger") void deleteStep(id);
      return;
    }
  };

  let focusEdgeId: string | null = null;

  // ---------- header actions ----------
  const publish = async () => {
    if (!auto) return;
    setBusy("publish");
    try {
      const r = await api<{ version: number }>(`/api/workspaces/${p.wsId}/automations/${p.aid}/publish`, { method: "POST" });
      notice("");
      load();
    } catch (e) {
      const err = e as ApiError;
      notice(err.message);
      const sid = err.body.step_id as string | undefined;
      if (sid) {
        const s = stepById(sid) as StepDraft | null;
        if (s) { setFocusId(sid); setCursorCol(s.col); setCursorRow(s.row); (document.querySelector(`[data-step-id="${sid}"] button`) as HTMLElement | null)?.focus(); }
      }
    } finally { setBusy(null); }
  };

  const testRun = async () => {
    setBusy("test");
    try {
      const r = await api<{ run_id: string; number: number }>(`/api/workspaces/${p.wsId}/automations/${p.aid}/runs`, {
        method: "POST", body: JSON.stringify({ test: true }),
      });
      setLastRun({ id: r.run_id, number: r.number });
      load();
    } catch (e) {
      notice((e as ApiError).message);
    } finally { setBusy(null); }
  };

  const runNow = async (input: string) => {
    setBusy("run");
    try {
      const parsed = input.trim() === "" ? {} : JSON.parse(input);
      const r = await api<{ run_id: string; number: number }>(`/api/workspaces/${p.wsId}/automations/${p.aid}/runs`, {
        method: "POST", body: JSON.stringify({ input: parsed }),
      });
      setLastRun({ id: r.run_id, number: r.number });
      load();
    } catch (e) {
      notice((e as ApiError).message);
    } finally { setBusy(null); }
  };

  const exportLive = async () => {
    if (!auto || auto.live_version === null) return;
    setBusy("export");
    notice("Saving export...");
    try {
      const r = await fetch(`/api/workspaces/${p.wsId}/automations/${p.aid}/versions/${auto.live_version}/export`, { method: "POST", credentials: "same-origin" });
      if (r.status === 503) {
        notice("Storage is unavailable. Nothing was saved.");
        return;
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      const blob = new Blob([bytes], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${auto.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-v${auto.live_version}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notice("Export saved");
    } finally { setBusy(null); }
  };

  if (!auto) return h("div", { class: "page" }, h("h1", { class: "page-heading" }, "Automation"));
  void canvasRef;
  void editor;

  const stepListOrder = executionOrderIds(auto.trigger, auto.steps, auto.edges);

  return h("div", { class: "page editor-page" },
    h("h1", { class: "page-heading" }, auto.name),
    h("div", { class: "editor-header" },
      h("div", { class: "version-drain", role: "group", "aria-label": "Version drain", "data-live-version": String(auto.live_version ?? ""), "data-drain-count": String(auto.drain_count) },
        h("span", { class: "version-numeral", key: "v" + auto.live_version }, auto.live_version === null ? "No version" : "v" + auto.live_version),
        h("span", { class: "drain-count" }, `Runs left on older versions: ${auto.drain_count}`)),
      h("div", { class: "editor-actions" },
        h(Btn, { onClick: () => void testRun(), disabled: viewer || busy === "test", describedBy: viewer ? "viewer-desc" : undefined }, busy === "test" ? "Working..." : "Test run"),
        auto.trigger_kind === "manual" ? h(RunNowControl, { onRun: runNow, disabled: viewer ?? false }) : null,
        h(Btn, { kind: "primary", onClick: () => void publish(), disabled: viewer || busy === "publish" }, busy === "publish" ? "Working..." : "Publish"),
        h(Btn, { onClick: () => void exportLive(), disabled: viewer || auto.live_version === null || busy === "export" }, busy === "export" ? "Working..." : "Export live version"),
        h("a", { class: "pill-btn pill-secondary link-btn", href: `/w/${p.wsId}/runs?automation=${p.aid}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.wsId}/runs?automation=${p.aid}`); } }, "View runs"),
        lastRun ? h("a", { class: "pill-btn pill-secondary link-btn", href: `/w/${p.wsId}/runs/${lastRun.id}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.wsId}/runs/${lastRun.id}`); } }, `View run #${lastRun.number}`) : null),
      viewer ? h("span", { id: "viewer-desc", class: "visually-hidden" }, "Viewers cannot change this workspace") : null),
    h("div", { class: "notice-region" },
      h(StatusLog, { name: "Draft notices", lines: notices }),
      presence.length > 0 && p.me ? h("p", { class: "status-line" }, presence.find((x) => x.id !== p.me!.id)?.name + " is also editing this draft") : null),
    p.narrow
      ? h("ol", { class: "step-list", "aria-label": "Steps" },
          stepListOrder.map((id) => {
            const n = id === "trigger" ? auto.trigger : auto.steps.find((x) => x.id === id)!;
            return h("li", {
              key: id, class: "step-item", tabIndex: 0,
              "data-step-id": id, "data-kind": n.kind, "data-col": String(n.col), "data-row": String(n.row),
              onClick: () => setSettingsId(id),
              onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSettingsId(id); } },
            },
              h("button", { class: "step-btn" }, n.name),
              h("span", { class: "step-kind-label" }, kindLabel(n.kind)));
          }))
      : h("div", { class: "editor-body" },
          h("div", { class: "step-toolbar", role: "toolbar", "aria-label": "Step kinds" },
            Object.keys(KIND_BUTTON).map((kind) => h("button", {
              key: kind, class: "tool-btn", disabled: viewer,
              "aria-label": `Add step: ${KIND_BUTTON[kind]}`,
              onClick: () => void addStep(kind),
            }, `Add ${KIND_BUTTON[kind]}`))),
          h("div", { class: "canvas-panel", role: "region", "aria-label": "Automation canvas", tabIndex: 0, onKeyDown: onCanvasKey },
            h("div", { class: "grid-cursor", role: "group", "aria-label": "Grid cursor", "data-col": String(cursorCol), "data-row": String(cursorRow), tabIndex: focusId === "cursor" ? 0 : -1, onFocus: () => setFocusId("cursor") }),
            h(Canvas, {
              trigger: auto.trigger, steps: auto.steps, edges: auto.edges,
              focusId, onFocus: setFocusId, onOpen: (id: string) => setSettingsId(id),
              freshEdgeIds: freshEdges,
            }))),
    settingsId
      ? h("div", {}, h(StepSettings, {
          auto, wsId: p.wsId, aid: p.aid, sid: settingsId, tables,
          viewer: viewer ?? false,
          onSaved: () => { load(); notice("Draft saved. Not live until you publish."); },
          onError: (m: string) => notice(m),
          onClose: () => { const was = settingsId; setSettingsId(null); setTimeout(() => { (document.querySelector(`[data-step-id="${was}"] button`) as HTMLElement | null)?.focus(); }, 0); },
        }))
      : null);
}

function RunNowControl(p: { onRun: (input: string) => void; disabled: boolean }): VNode {
  const [input, setInput] = useState("{}");
  return h("span", { class: "run-now-group" },
    h("input", {
      class: "input", "aria-label": "Run input (JSON)", value: input,
      onInput: (e: Event) => setInput((e.target as HTMLInputElement).value),
    }),
    h(Btn, { kind: "primary", onClick: () => p.onRun(input), disabled: p.disabled }, "Run now"));
}

function StepSettings(p: {
  auto: AutomationShape; wsId: string; aid: string; sid: string;
  tables: TableShape[]; viewer: boolean;
  onSaved: () => void; onError: (m: string) => void; onClose: () => void;
}): VNode {
  const step: typeof p.auto.trigger | typeof p.auto.steps[number] = p.sid === "trigger" ? p.auto.trigger : p.auto.steps.find((s) => s.id === p.sid)!;
  const [name, setName] = useState(step.name);
  const [fields, setFields] = useState<Record<string, unknown>>(step.fields as Record<string, unknown>);
  const [sample, setSample] = useState(JSON.stringify((step as typeof p.auto.trigger).sample ?? {}, null, 2));
  const [open, setOpen] = useState<string | null>("Settings");

  const save = async (patch: Record<string, unknown>) => {
    try {
      const body: Record<string, unknown> = { ...patch };
      await api(`/api/workspaces/${p.wsId}/automations/${p.aid}/draft/steps/${p.sid}`, {
        method: "PUT", body: JSON.stringify(body),
      });
      p.onSaved();
    } catch (e) {
      p.onError((e as ApiError).message);
      const err = e as ApiError;
      if (err.status === 409 && err.body.step) {
        const held = err.body.step as Record<string, unknown>;
        if (held.fields) setFields(held.fields as Record<string, unknown>);
        if (typeof held.name === "string") setName(held.name);
      }
    }
  };

  const saveField = (key: string, value: unknown) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    void save({ fields: { [key]: value } });
  };

  const fieldStr = (key: string): string => {
    const v = fields[key];
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  };

  const expander = (id: string, children: VNode[]): VNode => h("div", { class: "expander" },
    h("button", {
      class: "expander-head", "aria-expanded": open === id ? "true" : "false",
      onClick: () => setOpen(open === id ? null : id),
    }, id),
    open === id ? h("div", { class: "expander-body" }, children) : null);

  const body: VNode[] = [];
  body.push(h("label", { class: "field" },
    h("span", { class: "field-label" }, "Step name"),
    h("input", {
      class: "input", value: name, disabled: p.viewer,
      onInput: (e: Event) => setName((e.target as HTMLInputElement).value),
      onBlur: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v !== step.name) void save({ name: v }); },
      onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; if (v !== step.name) void save({ name: v }); } },
    })));

  const settings: VNode[] = [];
  const f = fields;
  const text = (label: string, key: string) => h("label", { class: "field" },
    h("span", { class: "field-label" }, label),
    h("input", {
      class: "input", value: fieldStr(key), disabled: p.viewer,
      onBlur: (e: Event) => saveField(key, (e.target as HTMLInputElement).value),
      onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") saveField(key, (e.target as HTMLInputElement).value); },
    }));

  if (step.kind === "form") {
    settings.push(text("Form path", "path"));
    const ff = (f.form_fields ?? []) as { name: string; label: string; type: string }[];
    settings.push(h("div", { class: "field-group", role: "group", "aria-label": "Fields" },
      ff.map((x, i) => h("div", { key: i, class: "col-row" },
        h("label", { class: "field" }, h("span", { class: "field-label" }, `Field name ${i + 1}`), h("input", { class: "input", value: x.name, disabled: p.viewer, onBlur: (e: Event) => saveField("form_fields", ff.map((y, yi) => yi === i ? { ...y, name: (e.target as HTMLInputElement).value } : y)) })),
        h("label", { class: "field" }, h("span", { class: "field-label" }, `Field label ${i + 1}`), h("input", { class: "input", value: x.label, disabled: p.viewer, onBlur: (e: Event) => saveField("form_fields", ff.map((y, yi) => yi === i ? { ...y, label: (e.target as HTMLInputElement).value } : y)) })),
        h(Select, { label: `Field type ${i + 1}`, value: x.type, options: ["text", "number"], onChange: (v: string) => saveField("form_fields", ff.map((y, yi) => yi === i ? { ...y, type: v } : y)) }))),
      h(Btn, { onClick: () => saveField("form_fields", [...ff, { name: "", label: "", type: "text" }]), disabled: p.viewer }, "Add form field")));
    settings.push(h("label", { class: "field" },
      h("span", { class: "field-label" }, "Sample data (JSON)"),
      h("textarea", { class: "input area", rows: 3, disabled: p.viewer, onBlur: (e: Event) => { try { void save({ sample: JSON.parse((e.target as HTMLTextAreaElement).value) }); } catch { /* not valid JSON yet */ } } }, sample)));
  } else if (step.kind === "schedule") {
    settings.push(text("Schedule", "schedule"));
    settings.push(h(TextAreaSample, { sample, disabled: p.viewer, onSave: (v: string) => { try { void save({ sample: JSON.parse(v) }); } catch { /* ignore */ } } }));
  } else if (step.kind === "webhook") {
    settings.push(text("Hook path", "path"));
    settings.push(h(TextAreaSample, { sample, disabled: p.viewer, onSave: (v: string) => { try { void save({ sample: JSON.parse(v) }); } catch { /* ignore */ } } }));
  } else if (step.kind === "row_added") {
    settings.push(h(Select, { label: "Table", value: String(f.table ?? ""), options: p.tables.map((t) => ({ value: t.id, label: t.name })), onChange: (v: string) => saveField("table", v), disabled: p.viewer }));
    settings.push(h(TextAreaSample, { sample, disabled: p.viewer, onSave: (v: string) => { try { void save({ sample: JSON.parse(v) }); } catch { /* ignore */ } } }));
  } else if (step.kind === "manual") {
    settings.push(h(TextAreaSample, { sample, disabled: p.viewer, onSave: (v: string) => { try { void save({ sample: JSON.parse(v) }); } catch { /* ignore */ } } }));
  } else if (step.kind === "set") {
    const values = (f.values ?? {}) as Record<string, string>;
    const keys = Object.keys(values);
    const rows: VNode[] = keys.map((k) => {
      const idx = keys.indexOf(k) + 1;
      return h("div", { key: k, class: "col-row" },
        h("label", { class: "field" },
          h("span", { class: "field-label" }, "Value name " + idx),
          h("input", { class: "input", value: k, disabled: p.viewer, onBlur: (e: Event) => { const nk = (e.target as HTMLInputElement).value; const nv = { ...values }; nv[nk] = nv[k]; delete nv[k]; saveField("values", nv); } })),
        h("label", { class: "field" },
          h("span", { class: "field-label" }, "Value " + idx),
          h("input", { class: "input", value: values[k], disabled: p.viewer, onBlur: (e: Event) => saveField("values", { ...values, [k]: (e.target as HTMLInputElement).value }) })));
    });
    settings.push(h("div", { class: "field-group", role: "group", "aria-label": "Values" },
      rows,
      keys.length === 0 ? h("p", { class: "muted" }, "No values yet.") : null,
      h(Btn, { onClick: () => saveField("values", { ...values, "": "" }), disabled: p.viewer }, "Add value")));
  } else if (step.kind === "filter" || step.kind === "branch") {
    settings.push(text("Left", "left"));
    settings.push(h(Select, { label: "Operator", value: String(f.operator ?? "equals"), options: ["equals", "not equals", "contains", "greater than", "less than", "is empty", "is not empty"], onChange: (v: string) => saveField("operator", v), disabled: p.viewer }));
    settings.push(text("Right", "right"));
  } else if (step.kind === "loop") {
    settings.push(h(Select, { label: "Loop over", value: String(f.source ?? "list"), options: [{ value: "list", label: "A list" }, { value: "table", label: "All rows of a table" }], onChange: (v: string) => saveField("source", v), disabled: p.viewer }));
    if (String(f.source ?? "list") === "list") settings.push(text("List", "list"));
    else settings.push(h(Select, { label: "Table", value: String(f.table ?? ""), options: p.tables.map((t) => ({ value: t.id, label: t.name })), onChange: (v: string) => saveField("table", v), disabled: p.viewer }));
  } else if (step.kind === "wait") {
    settings.push(h("label", { class: "field" },
      h("span", { class: "field-label" }, "Seconds"),
      h("input", { class: "input", type: "number", value: String(f.seconds ?? ""), disabled: p.viewer, "aria-label": "Seconds", role: "spinbutton", onBlur: (e: Event) => saveField("seconds", Number((e.target as HTMLInputElement).value)) })));
  } else if (step.kind === "send_email") {
    settings.push(text("To", "to"));
    settings.push(text("Subject", "subject"));
    settings.push(text("Body", "body"));
  } else if (step.kind === "add_row" || step.kind === "update_row") {
    const tableId = String(f.table ?? "");
    const table = p.tables.find((t) => t.id === tableId);
    settings.push(h(Select, { label: "Table", value: tableId, options: p.tables.map((t) => ({ value: t.id, label: t.name })), onChange: (v: string) => saveField("table", v), disabled: p.viewer }));
    if (step.kind === "update_row") settings.push(text("Row id", "row_id"));
    const values = (f.values ?? {}) as Record<string, string>;
    if (table) settings.push(...table.columns.map((c) =>
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Column " + c.name),
        h("input", { class: "input", value: values[c.name] ?? "", disabled: p.viewer, onBlur: (e: Event) => saveField("values", { ...values, [c.name]: (e.target as HTMLInputElement).value }) }))));
  } else if (step.kind === "call_webhook") {
    settings.push(text("URL", "url"));
    const bodyVals = (f.body ?? {}) as Record<string, string>;
    const bodyKeys = Object.keys(bodyVals);
    const bodyRows: VNode[] = bodyKeys.map((k) => {
      const idx = bodyKeys.indexOf(k) + 1;
      return h("div", { key: k, class: "col-row" },
        h("label", { class: "field" },
          h("span", { class: "field-label" }, `Body name ${idx}`),
          h("input", { class: "input", value: k, disabled: p.viewer, onBlur: (e: Event) => { const nk = (e.target as HTMLInputElement).value; const nv = { ...bodyVals }; nv[nk] = nv[k]; delete nv[k]; saveField("body", nv); } })),
        h("label", { class: "field" },
          h("span", { class: "field-label" }, `Body value ${idx}`),
          h("input", { class: "input", value: bodyVals[k], disabled: p.viewer, onBlur: (e: Event) => saveField("body", { ...bodyVals, [k]: (e.target as HTMLInputElement).value }) })));
    });
    settings.push(h("div", { class: "field-group", role: "group", "aria-label": "Body" },
      bodyRows,
      bodyKeys.length === 0 ? h("p", { class: "muted" }, "No body values yet.") : null,
      h(Btn, { onClick: () => saveField("body", { ...bodyVals, "": "" }), disabled: p.viewer }, "Add body value")));
  }

  const connEdges = p.auto.edges.filter((e) => e.from === p.sid);

  return h("div", { class: "dialog-backdrop", onMouseDown: (e: MouseEvent) => { if (e.target === e.currentTarget) p.onClose(); } },
    h("div", {
      class: "dialog step-settings", role: "dialog", "aria-label": `Step settings: ${step.name}`, "aria-modal": "true",
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); p.onClose(); }
        if (e.key === "Tab") {
          const focusables = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("input,select,textarea,button");
          if (focusables.length === 0) return;
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      },
    },
      body[0],
      expander("Settings", settings),
      expander("Connections", [
        connEdges.length === 0 ? h("p", { class: "muted" }, "No outgoing edges.") :
          h("ul", { class: "conn-list" }, connEdges.map((e) => h("li", { key: e.id }, `${e.port} → ${e.to} (order ${e.order})`))),
      ]),
      expander("Template help", [
        h("p", { class: "muted" }, "Use {{trigger.path}}, {{steps.s1.path}}, {{loop.item.path}}, {{loop.index}} and {{run.id}}. A field that is one whole expression keeps the value's type; any other field becomes a string. An unknown path resolves to empty text."),
      ]),
      h("div", { class: "dialog-actions" },
        h(Btn, { onClick: p.onClose }, "Close"))));
}

function TextAreaSample(p: { sample: string; disabled: boolean; onSave: (v: string) => void }): VNode {
  const [v, setV] = useState(p.sample);
  return h("label", { class: "field" },
    h("span", { class: "field-label" }, "Sample data (JSON)"),
    h("textarea", { class: "input area", rows: 3, value: v, disabled: p.disabled, onInput: (e: Event) => setV((e.target as HTMLTextAreaElement).value), onBlur: () => p.onSave(v) }));
}
