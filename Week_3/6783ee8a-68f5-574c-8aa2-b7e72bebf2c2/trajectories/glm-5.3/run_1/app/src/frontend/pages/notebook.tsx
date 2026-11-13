import { useCallback, useEffect, useRef, useState } from "react";
import type { Cell, Checkpoint, CompareResult, LimitsConfig, Notebook, Output, PresenceEntry, User } from "../../shared/types.ts";
import { api, redirectTo } from "../api.ts";
import { renderMarkdown, type RenderedMarkdown } from "../markdown.ts";
import { Dialog, HeaderMenu, WorkspaceHeader } from "../ui.tsx";
import { CellArticle, NotebookDialogs } from "./cell.tsx";
import type { KernelOutput, RunOutcome } from "../../kernel/protocol.ts";

type Mode = "command" | "edit";
type StatusMessage = string | null;
type SaveStatus = string;
type Toast = { id: number; text: string } | null;

const COMMAND_PALETTE_OPTIONS = [
  "Run all cells",
  "Run selected cell",
  "Interrupt kernel",
  "Restart kernel",
  "Save checkpoint",
  "Insert code cell below",
  "Insert markdown cell below",
  "Export notebook",
  "Show table of contents",
];

const VIEWER_PALETTE_OPTIONS = ["Export notebook", "Show table of contents"];

function uuid(): string {
  return crypto.randomUUID();
}

function tabIdFor(): string {
  return `tab-${uuid()}`;
}

function formatThousands(n: number): string {
  return n.toLocaleString("en-US");
}

function formatSeconds(ms: number): string {
  const text = String(ms / 1000);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** The one kernel harness per notebook tab. The worker runs the cells; a busy loop is
 *  stopped by terminating the worker, and the kernel's variables are rebuilt by
 *  replaying every earlier successful cell's declarations in a fresh worker. */
class KernelHarness {
  private worker: Worker | null = null;
  private pending: { resolve: (outcome: RunOutcome) => void } | null = null;
  replaySources: string[] = [];

  private async ensure(): Promise<Worker> {
    if (this.worker !== null) return this.worker;
    // The worker script is fetched and started from a blob URL, which loads the same
    // code without depending on cross-origin policies for remote worker scripts.
    const source = await fetch("/worker.js").then((response) => response.text());
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (event: MessageEvent<{ type: string; outcome?: RunOutcome }>) => {
      if (event.data.type === "run_done" && this.pending !== null && event.data.outcome !== undefined) {
        const resolve = this.pending.resolve;
        this.pending = null;
        resolve(event.data.outcome);
      }
    };
    this.worker = worker;
    return worker;
  }

  async run(code: string, execLimitMs: number): Promise<RunOutcome> {
    const worker = await this.ensure();
    return new Promise((resolve) => {
      this.pending = { resolve };
      worker.postMessage({ type: "run", code, execLimitMs });
    });
  }

  /** An interrupt stops a busy loop by ending the worker; the waiting run resolves as
   *  interrupted and a fresh worker rebuilds every earlier variable by replaying the
   *  declarations of earlier successful cells. */
  async interrupt(rebuild: () => Promise<void>): Promise<void> {
    const pending = this.pending;
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
    pending?.resolve({ status: "interrupted", reason: "interrupt", outputs: [] });
    await rebuild();
  }

  /** Replays an earlier successful cell's code quietly in the current worker. */
  async replay(code: string): Promise<void> {
    const worker = await this.ensure();
    await new Promise<void>((resolve) => {
      this.pending = { resolve: () => resolve() };
      worker.postMessage({ type: "run", code, execLimitMs: 1000, quiet: true });
    });
  }

  restart(): void {
    this.replaySources = [];
    this.worker?.postMessage({ type: "restart" });
  }

  rememberCell(code: string): void {
    this.replaySources.push(code);
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export function NotebookPage({ notebookId, user, config }: { notebookId: string; user: User; config: LimitsConfig | null }) {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<Mode>("command");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [kernelStatus, setKernelStatus] = useState<string>("Kernel idle");
  const [modeAnnouncement, setModeAnnouncement] = useState<StatusMessage>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("All changes saved");
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [outage, setOutage] = useState(false);
  const [conflictCellId, setConflictCellId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointPanelOpen, setCheckpointPanelOpen] = useState(false);
  const [compareResult, setCompareResult] = useState<{ checkpoint: Checkpoint; result: CompareResult } | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<{ checkpoint: Checkpoint; cellId: string | null } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [contentsDrawerOpen, setContentsDrawerOpen] = useState(false);
  const [cellSheetId, setCellSheetId] = useState<string | null>(null);
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = useState<StatusMessage>(null);
  const [tablePages, setTablePages] = useState<Record<string, { index: number; offset: number }>>({});
  const [cellMotion, setCellMotion] = useState<{ kind: "enter" | "exit" | "move"; at: number } | null>(null);
  const [droppedSource, setDroppedSource] = useState<{ ids: string[]; cells: Cell[] } | null>(null);
  const [clipboard, setClipboard] = useState<{ cell_type: string; source: string }[] | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const tabIdRef = useRef<string>(tabIdFor());
  const kernelRef = useRef<KernelHarness | null>(null);
  const kernelStartedRef = useRef(false);
  const editsRef = useRef<Map<string, string>>(new Map());
  const baseRevisionRef = useRef<Map<string, number>>(new Map());
  const runsRef = useRef<Map<string, { cellId: string }>>(new Map());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnnouncedRef = useRef<string>("");
  const execLimit = config?.exec_limit_ms ?? 10000;
  const autosaveMs = config?.autosave_ms ?? 2000;
  const doublePressMs = config?.double_press_ms ?? 500;
  const lastKeyRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  const isViewer = notebook?.role === "viewer";
  const canEdit = notebook?.role === "owner" || notebook?.role === "editor";

  const announce = useCallback((message: string, shared = false) => {
    if (shared) {
      setStatusAnnouncement(message);
      return;
    }
    if (lastAnnouncedRef.current !== message) {
      lastAnnouncedRef.current = message;
      setStatusAnnouncement(message);
    }
  }, []);

  const setModeAndAnnounce = useCallback((next: Mode) => {
    setMode((current) => {
      if (current !== next && !isViewer) {
        announce(next === "command" ? "Command mode" : "Edit mode");
      }
      return next;
    });
  }, [announce, isViewer]);

  // --------------------------------------------------------------- data and live
  useEffect(() => {
    void api.notebook(notebookId).then((result) => {
      if (!result.ok) {
        setNotFound(true);
        return;
      }
      setNotebook(result.value.notebook);
      setKernelStatus(`Kernel ${result.value.notebook.kernel_status}`);
      const firstCell = result.value.notebook.cells[0];
      if (firstCell !== undefined) setSelected(new Set([firstCell.id]));
      for (const cell of result.value.notebook.cells) {
        baseRevisionRef.current.set(cell.id, cell.revision);
      }
    });
    void api.checkpoints(notebookId).then((result) => {
      if (result.ok) setCheckpoints(result.value.checkpoints);
    });
  }, [notebookId]);

  // --------------------------------------------------------------- saving

  /** Applies a server cell list, keeping any unsaved local edits and their base revisions. */
  const applyServerCells = useCallback((cells: Cell[]) => {
    setNotebook((current): Notebook | null => {
      if (current === null) return current;
      const merged = cells.map((cell): Cell => {
        if (editsRef.current.has(cell.id)) {
          return { ...cell, source: editsRef.current.get(cell.id) as string, revision: baseRevisionRef.current.get(cell.id) ?? cell.revision };
        }
        baseRevisionRef.current.set(cell.id, cell.revision);
        return cell;
      });
      return { ...current, cells: merged };
    });
  }, []);


  const performSave = useCallback(async (): Promise<boolean> => {
    const edited = [...editsRef.current.keys()];
    if (edited.length === 0) return true;
    const cells = edited.map((id) => ({
      id,
      base_revision: baseRevisionRef.current.get(id) ?? 1,
      source: editsRef.current.get(id) ?? "",
      cell_type: notebook?.cells.find((c) => c.id === id)?.cell_type ?? "code",
    }));
    setSaveStatus("Saving…");
    const result = await api.save(notebookId, { tab_id: tabIdRef.current, cells });
    if (result.ok) {
      for (const cell of result.value.cells) {
        baseRevisionRef.current.set(cell.id, cell.revision);
        editsRef.current.delete(cell.id);
      }
      setSaveStatus("All changes saved");
      setOutage(false);
      // The retry loop ends with the first successful save after an outage.
      if (retryTimerRef.current !== null) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return true;
    }
    if (result.error.error === "stale_revision") {
      const staleCells = (result.error as unknown as { cells: Cell[] }).cells ?? [];
      setConflictCellId(staleCells[0]?.id ?? edited[0]);
      // The conflict dialog decides; the retry loop stops until it does.
      if (retryTimerRef.current !== null) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return false;
    }
    if (result.error.error === "cell_locked") {
      const holder = (result.error as unknown as { holder?: string }).holder;
      const lockedId = (result.error as unknown as { cell_id?: string }).cell_id ?? edited[0];
      announce(`Cell ${(notebook?.cells.findIndex((c) => c.id === lockedId) ?? 0) + 1} is being edited by ${holder}`);
      return false;
    }
    if (result.error.error === "storage_unavailable") {
      setOutage(true);
      setSaveStatus("Saving paused: storage unavailable");
      if (retryTimerRef.current === null) {
        retryTimerRef.current = setInterval(() => {
          void performSave();
        }, 5000);
      }
      return false;
    }
    setSaveStatus("All changes saved");
    return true;
  }, [announce, notebook, notebookId]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void performSave();
    }, autosaveMs);
  }, [autosaveMs, performSave]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
      if (retryTimerRef.current !== null) clearInterval(retryTimerRef.current);
      kernelRef.current?.close();
    };
  }, []);

  const onCellSourceChange = useCallback((cellId: string, source: string) => {
    editsRef.current.set(cellId, source);
    setNotebook((current) => {
      if (current === null) return current;
      const cells = current.cells.map((cell) => (cell.id === cellId ? { ...cell, source } : cell));
      return { ...current, cells };
    });
    setSaveStatus("Unsaved changes");
    scheduleAutosave();
  }, [scheduleAutosave]);

  // --------------------------------------------------------------- running

  const reportKernel = useCallback(async (status: string) => {
    const result = await api.kernel(notebookId, { tab_id: tabIdRef.current, status });
    if (result.ok) {
      setKernelStatus(`Kernel ${result.value.kernel_status}`);
      return true;
    }
    return false;
  }, [notebookId]);

  /** Brings a new tab's kernel through Starting -> Idle exactly once. */
  const ensureKernelStarted = useCallback(async (): Promise<void> => {
    if (kernelStartedRef.current) return;
    await reportKernel("idle");
    kernelStartedRef.current = true;
  }, [reportKernel]);

  const runCell = useCallback(async (cell: Cell) => {
    if (cell.cell_type === "markdown") {
      setNotebook((current) => {
        if (current === null) return current;
        const cells = current.cells.map((c) => (c.id === cell.id ? { ...c, run_state: "finished" as const } : c));
        return { ...current, cells };
      });
      return;
    }
    await performSave();
    const runId = uuid();
    runsRef.current.set(runId, { cellId: cell.id });
    const queued = await api.queueRun(notebookId, { run_id: runId, cell_id: cell.id, tab_id: tabIdRef.current });
    if (!queued.ok) {
      if (queued.error.error === "illegal_transition") {
        // The cell is already queued or running; nothing to do.
      }
      return;
    }
    await ensureKernelStarted();
    await reportKernel("busy");
    const started = await api.startRun(notebookId, runId);
    if (!started.ok) {
      await reportKernel("idle");
      return;
    }
    if (kernelRef.current === null) {
      kernelRef.current = new KernelHarness();
    }
    const outcome = await kernelRef.current.run(cell.source, execLimit);
    if (outcome.status === "finished") {
      kernelRef.current.rememberCell(cell.source);
    }
    let outputs = outcome.outputs as Output[];
    const status = outcome.status;
    if (status === "interrupted" && outcome.outputs.length === 0) {
      outputs = [{ output_type: "error", ename: "Interrupted", evalue: "Run interrupted", traceback: ["Interrupted: Run interrupted", "line 1"] }];
    }
    if (status === "interrupted") {
      await reportKernel("interrupted");
      await reportKernel("idle");
    } else {
      await reportKernel("idle");
    }
    const result = await api.runResult(notebookId, runId, { status, outputs });
    if (result.ok) {
      const cellPosition = (notebook?.cells.findIndex((c) => c.id === cell.id) ?? -1) + 1;
      if (status === "finished") {
        announce(`Cell ${cellPosition} ran as [${result.value.run.execution_count}]`, true);
      } else if (status === "failed") {
        const errorOutput = outputs.find((o) => o.output_type === "error");
        announce(`Cell ${cellPosition} failed with ${errorOutput !== undefined && errorOutput.output_type === "error" ? errorOutput.ename : "Error"}`, true);
      } else if (status === "interrupted") {
        announce(`Cell ${cellPosition} interrupted`, true);
      }
    }
  }, [announce, execLimit, notebook, notebookId, performSave, reportKernel]);

  const interruptKernel = useCallback(async () => {
    const harness = kernelRef.current;
    if (harness === null) {
      // I,I when nothing is running does nothing.
      return;
    }
    const sources = [...harness.replaySources];
    await harness.interrupt(async () => {
      for (const code of sources) {
        await harness.replay(code);
      }
    });
    // The interrupted run's own continuation reports the kernel status; when nothing
    // was running, the kernel simply stays where it was.
  }, []);

  const restartKernelFlow = useCallback(async () => {
    setRestartConfirm(false);
    if (kernelRef.current === null) {
      kernelRef.current = new KernelHarness();
    }
    kernelRef.current.restart();
    await reportKernel("restarting");
    kernelStartedRef.current = true;
    await api.kernel(notebookId, { tab_id: tabIdRef.current, status: "idle" });
    announce("Kernel restarting", true);
    setTimeout(() => {
      setKernelStatus("Kernel idle");
    }, 100);
  }, [announce, notebookId, reportKernel]);

  const runAll = useCallback(async () => {
    if (notebook === null) return;
    const ordered = [...notebook.cells].sort((a, b) => a.position - b.position);
    const queuedIds: string[] = [];
    for (const cell of ordered) {
      if (cell.cell_type === "code") {
        const runId = uuid();
        runsRef.current.set(runId, { cellId: cell.id });
        const queued = await api.queueRun(notebookId, { run_id: runId, cell_id: cell.id, tab_id: tabIdRef.current });
        if (queued.ok) queuedIds.push(runId);
      }
    }
    await ensureKernelStarted();
    await reportKernel("busy");
    let failed = false;
    let lastRunAnnouncement: string | null = null;
    for (let index = 0; index < ordered.length; index++) {
      const cell = ordered[index];
      if (cell.cell_type === "markdown") {
        setNotebook((current) => {
          if (current === null) return current;
          const cells = current.cells.map((c) => (c.id === cell.id ? { ...c, run_state: "finished" as const } : c));
          return { ...current, cells };
        });
        continue;
      }
      if (failed) {
        const runId = queuedIds.shift();
        if (runId === undefined) continue;
        await api.runResult(notebookId, runId, { status: "not_run", outputs: [] });
        continue;
      }
      await performSave();
      const runId = queuedIds.shift();
      if (runId === undefined) continue;
      const started = await api.startRun(notebookId, runId);
      if (!started.ok) continue;
      if (kernelRef.current === null) kernelRef.current = new KernelHarness();
      const outcome = await kernelRef.current.run(cell.source, execLimit);
      if (outcome.status === "finished") {
        kernelRef.current.rememberCell(cell.source);
      }
      if (outcome.status === "failed") failed = true;
      const result = await api.runResult(notebookId, runId, { status: outcome.status, outputs: outcome.outputs as Output[] });
      if (result.ok && outcome.status === "finished") {
        lastRunAnnouncement = `Cell ${index + 1} ran as [${result.value.run.execution_count}]`;
        announce(lastRunAnnouncement, true);
      }
      if (outcome.status === "interrupted") {
        // Post cancelled for every remaining queued run in this tab.
        for (const remaining of queuedIds.splice(0)) {
          await api.runResult(notebookId, remaining, { status: "cancelled", outputs: [] });
        }
        await reportKernel("interrupted");
        break;
      }
    }
    await reportKernel("idle");
    // The run result is the last thing the polite region says.
    if (lastRunAnnouncement !== null) {
      announce(lastRunAnnouncement, true);
    }
  }, [announce, execLimit, notebook, notebookId, performSave, reportKernel]);

  // --------------------------------------------------------------- structure

  const orderedCells = notebook === null ? [] : [...notebook.cells].sort((a, b) => a.position - b.position);

  const insertCell = useCallback(async (position: number, cellType: "code" | "markdown", select = true) => {
    setCellMotion({ kind: "enter", at: Date.now() });
    const result = await api.insertCell(notebookId, { position, cell_type: cellType });
    if (result.ok) {
      applyServerCells(result.value.cells);
      const newId = result.value.new_ids[0];
      if (newId !== undefined) {
        baseRevisionRef.current.set(newId, 1);
        if (select) setSelected(new Set([newId]));
      }
    }
  }, [applyServerCells, notebookId]);

  const pasteCells = useCallback(async (position: number, cellsToPaste: { cell_type: string; source: string }[]) => {
    if (cellsToPaste.length === 0) return;
    setCellMotion({ kind: "enter", at: Date.now() });
    const result = await api.pasteCells(notebookId, { position, cells: cellsToPaste });
    if (result.ok) {
      applyServerCells(result.value.cells);
      for (const id of result.value.new_ids) baseRevisionRef.current.set(id, 1);
      const lastId = result.value.new_ids[result.value.new_ids.length - 1];
      if (lastId !== undefined) setSelected(new Set([lastId]));
    }
  }, [applyServerCells, notebookId]);

  const deleteCells = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const snapshot = orderedCells.filter((cell) => ids.includes(cell.id));
    const result = await api.deleteCells(notebookId, { tab_id: tabIdRef.current, ids });
    if (result.ok) {
      setDroppedSource({ ids, cells: snapshot });
      setCellMotion({ kind: "exit", at: Date.now() });
      applyServerCells(result.value.cells);
      const removed = new Set(ids);
      setSelected(new Set([...selected].filter((id) => !removed.has(id))));
    }
  }, [notebookId, orderedCells, selected]);

  const restoreCells = useCallback(async () => {
    if (droppedSource === null) return;
    const result = await api.restoreCells(notebookId, { ids: droppedSource.ids });
    if (result.ok) {
      setCellMotion({ kind: "enter", at: Date.now() });
      applyServerCells(result.value.cells);
      setSelected(new Set(droppedSource.ids));
      setDroppedSource(null);
    }
  }, [applyServerCells, droppedSource, notebookId]);

  const moveCell = useCallback(async (cellId: string, position: number) => {
    setCellMotion({ kind: "move", at: Date.now() });
    const result = await api.moveCell(notebookId, cellId, { tab_id: tabIdRef.current, position });
    if (result.ok) {
      applyServerCells(result.value.cells);
    }
  }, [applyServerCells, notebookId]);

  const splitCell = useCallback(async (cell: Cell, line: number) => {
    // The split works on the saved source, so any pending edit is saved first.
    await performSave();
    const result = await api.splitCell(notebookId, cell.id, {
      tab_id: tabIdRef.current,
      base_revision: baseRevisionRef.current.get(cell.id) ?? cell.revision,
      line,
    });
    if (result.ok) {
      setCellMotion({ kind: "enter", at: Date.now() });
      applyServerCells(result.value.cells);
      const newId = result.value.new_ids[0];
      if (newId !== undefined) {
        baseRevisionRef.current.set(newId, 1);
        baseRevisionRef.current.set(cell.id, (result.value.cells.find((c) => c.id === cell.id)?.revision ?? 1));
        editsRef.current.delete(cell.id);
        setSelected(new Set([newId]));
        setModeAndAnnounce("edit");
      }
    } else if (result.error.error === "stale_revision") {
      setConflictCellId(cell.id);
    }
  }, [applyServerCells, notebookId, performSave, setModeAndAnnounce]);

  const mergeSelected = useCallback(async () => {
    const chosen = orderedCells.filter((cell) => selected.has(cell.id));
    if (chosen.length === 1) {
      const index = orderedCells.findIndex((cell) => selected.has(cell.id));
      const below = orderedCells[index + 1];
      if (below === undefined) return;
      chosen.push(below);
    }
    if (chosen.length < 2) return;
    // The merge joins the saved sources, so any pending edits are saved first.
    await performSave();
    if (new Set(chosen.map((cell) => cell.cell_type)).size > 1) {
      announce("Cannot merge code and markdown cells");
      return;
    }
    const baseRevisions: Record<string, number> = {};
    for (const cell of chosen) {
      baseRevisions[cell.id] = baseRevisionRef.current.get(cell.id) ?? cell.revision;
    }
    const result = await api.mergeCells(notebookId, { tab_id: tabIdRef.current, ids: chosen.map((cell) => cell.id), base_revisions: baseRevisions });
    if (result.ok) {
      applyServerCells(result.value.cells);
      baseRevisionRef.current.set(chosen[0].id, result.value.cells.find((c) => c.id === chosen[0].id)?.revision ?? 1);
      setSelected(new Set([chosen[0].id]));
    }
  }, [announce, applyServerCells, notebookId, orderedCells, selected]);

  const changeType = useCallback(async (cellType: "code" | "markdown") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const cellsToSave = ids.map((id) => {
      const cell = notebook?.cells.find((c) => c.id === id);
      const source = editsRef.current.get(id) ?? cell?.source ?? "";
      return { id, base_revision: baseRevisionRef.current.get(id) ?? 1, source, cell_type: cellType };
    });
    const saved = await api.save(notebookId, { tab_id: tabIdRef.current, cells: cellsToSave });
    if (saved.ok) {
      // Changing a cell to markdown clears its outputs and count.
      setNotebook((current): Notebook | null => {
        if (current === null) return current;
        const byId = new Map(saved.value.cells.map((c) => [c.id, c]));
        const cells = current.cells.map((c): Cell => {
          const updated = byId.get(c.id);
          if (updated === undefined) return c;
          if (cellType === "markdown") {
            return { ...updated, cell_type: "markdown", outputs: [], execution_count: null, run_state: "idle" };
          }
          return { ...updated, cell_type: "code" };
        });
        return { ...current, cells };
      });
      for (const cell of saved.value.cells) {
        baseRevisionRef.current.set(cell.id, cell.revision);
        editsRef.current.delete(cell.id);
      }
    }
  }, [notebook, notebookId, selected]);

  // --------------------------------------------------------------- checkpoints

  const saveCheckpoint = useCallback(async () => {
    await performSave();
    setSaveStatus("Saving checkpoint…");
    const result = await api.createCheckpoint(notebookId);
    if (result.ok) {
      setSaveStatus("Checkpoint saved");
      setCheckpoints((current) => [result.value.checkpoint, ...current.filter((c) => c.id !== result.value.checkpoint.id)].sort((a, b) => b.number - a.number));
    } else if (result.error.error === "storage_unavailable") {
      setSaveStatus("Checkpoint not saved: storage unavailable");
      setOutage(true);
    }
  }, [notebookId, performSave]);

  const openCompare = useCallback(async (checkpoint: Checkpoint) => {
    const result = await api.compare(notebookId, checkpoint.id);
    if (result.ok) {
      setCompareResult({ checkpoint, result: result.value });
    }
  }, [notebookId]);

  const revert = useCallback(async (checkpoint: Checkpoint, cellId: string | null) => {
    const result = await api.revert(notebookId, checkpoint.id, cellId === null ? undefined : cellId);
    if (result.ok) {
      applyServerCells(result.value.cells);
      for (const cell of result.value.cells) {
        baseRevisionRef.current.set(cell.id, cell.revision);
        editsRef.current.delete(cell.id);
      }
      setSaveStatus(`Reverted to ${checkpoint.label}`);
      setCompareResult(null);
      setRevertConfirm(null);
      setCheckpoints((current) => [result.value.before_revert, ...current].sort((a, b) => b.number - a.number).slice(0, config?.checkpoints_kept ?? 10));
    } else if (result.error.error === "storage_unavailable") {
      setOutage(true);
      setSaveStatus("Checkpoint not saved: storage unavailable");
    }
  }, [config, notebookId]);

  const exportNotebook = useCallback(() => {
    setSaveStatus(`Exported ${notebook?.title ?? "notebook"}.ipynb`);
    window.location.assign(`/api/notebooks/${notebookId}/export`);
  }, [notebook, notebookId]);

  // --------------------------------------------------------------- keyboard

  const selectedIndex = orderedCells.findIndex((cell) => selected.has(cell.id));
  const selectedCell = selectedIndex >= 0 ? orderedCells[selectedIndex] : undefined;

  const runSelected = useCallback(async (after: "next" | "inPlace" | "insertBelow") => {
    if (selectedCell === undefined) return;
    const cell = selectedCell;
    // Running always leaves edit mode first, so command keys answer while the run is in flight.
    if (mode === "edit") {
      const cellId = [...selected][0];
      if (cellId !== undefined) {
        await api.unlockCell(notebookId, cellId, tabIdRef.current);
        (document.getElementById(`source-${cellId}`) as HTMLTextAreaElement | null)?.blur();
      }
      document.getElementById("cells-region")?.focus();
      setMode("command");
      announce("Command mode");
    }
    await runCell(cell);
    if (after === "next") {
      const next = orderedCells[selectedIndex + 1];
      if (next === undefined) {
        const insertAt = orderedCells.length;
        await insertCell(insertAt, "code");
      } else {
        setSelected(new Set([next.id]));
        next instanceof Object && document.getElementById(`cell-${next.id}`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (after === "insertBelow") {
      const insertAt = cell.position + 1;
      await insertCell(insertAt, "code");
      setModeAndAnnounce("edit");
    }
  }, [announce, insertCell, mode, notebookId, orderedCells, runCell, selectedCell, selectedIndex, setModeAndAnnounce]);

  const enterEditMode = useCallback(async (cell: Cell) => {
    if (isViewer) return;
    if (cell.locked_by !== null && cell.locked_by !== user.display_name) {
      announce(`Cell ${orderedCells.findIndex((c) => c.id === cell.id) + 1} is being edited by ${cell.locked_by}`);
      return;
    }
    const lock = await api.lockCell(notebookId, cell.id, tabIdRef.current);
    if (!lock.ok) {
      const holder = (lock.error as unknown as { holder?: string }).holder;
      if (holder !== undefined) {
        announce(`Cell ${orderedCells.findIndex((c) => c.id === cell.id) + 1} is being edited by ${holder}`);
      }
      return;
    }
    setModeAndAnnounce("edit");
    setTimeout(() => {
      document.getElementById(`source-${cell.id}`)?.focus();
    }, 0);
  }, [announce, isViewer, notebookId, orderedCells, setModeAndAnnounce, user.display_name]);

  const leaveEditMode = useCallback(async () => {
    const cellId = [...selected][0];
    if (cellId !== undefined) {
      await api.unlockCell(notebookId, cellId, tabIdRef.current);
      const textarea = document.getElementById(`source-${cellId}`);
      (textarea as HTMLTextAreaElement | null)?.blur();
    }
    setModeAndAnnounce("command");
    // Command-mode keys must work right after leaving edit mode.
    document.getElementById("cells-region")?.focus();
  }, [notebookId, selected, setModeAndAnnounce]);

  const commandKeys = useCallback(async (key: string, event: KeyboardEvent) => {
    if (isViewer) return;
    const cell = selectedCell;
    if (key === "ArrowUp" || key === "k") {
      event.preventDefault();
      const above = orderedCells[selectedIndex - 1];
      if (above !== undefined) setSelected(new Set([above.id]));
      return;
    }
    if (key === "ArrowDown" || key === "j") {
      event.preventDefault();
      const below = orderedCells[selectedIndex + 1];
      if (below !== undefined) setSelected(new Set([below.id]));
      return;
    }
    if (key === "a" && cell !== undefined) {
      event.preventDefault();
      await insertCell(cell.position, "code");
      return;
    }
    if (key === "b" && cell !== undefined) {
      event.preventDefault();
      await insertCell(cell.position + 1, "code");
      return;
    }
    if (key === "m" && event.shiftKey) {
      event.preventDefault();
      await mergeSelected();
      return;
    }
    if (key === "m") {
      event.preventDefault();
      await changeType("markdown");
      return;
    }
    if (key === "y") {
      event.preventDefault();
      await changeType("code");
      return;
    }
    if (key === "c") {
      event.preventDefault();
      setClipboard(orderedCells.filter((c) => selected.has(c.id)).map((c) => ({ cell_type: c.cell_type, source: c.source })));
      return;
    }
    if (key === "x") {
      event.preventDefault();
      setClipboard(orderedCells.filter((c) => selected.has(c.id)).map((c) => ({ cell_type: c.cell_type, source: c.source })));
      await deleteCells([...selected]);
      return;
    }
    if (key === "v" && clipboard !== null) {
      event.preventDefault();
      const position = cell === undefined ? orderedCells.length : cell.position + 1;
      await pasteCells(position, clipboard);
      return;
    }
    if (key === "d") {
      const last = lastKeyRef.current;
      if (last.key === "d" && Date.now() - last.at <= doublePressMs) {
        event.preventDefault();
        lastKeyRef.current = { key: "", at: 0 };
        await deleteCells([...selected]);
        return;
      }
      lastKeyRef.current = { key: "d", at: Date.now() };
      return;
    }
    if (key === "z") {
      event.preventDefault();
      await restoreCells();
      return;
    }
    if (key === "i") {
      const last = lastKeyRef.current;
      if (last.key === "i" && Date.now() - last.at <= doublePressMs) {
        event.preventDefault();
        lastKeyRef.current = { key: "", at: 0 };
        await interruptKernel();
        return;
      }
      lastKeyRef.current = { key: "i", at: Date.now() };
      return;
    }
    if (key === "0") {
      const last = lastKeyRef.current;
      if (last.key === "0" && Date.now() - last.at <= doublePressMs) {
        event.preventDefault();
        lastKeyRef.current = { key: "", at: 0 };
        setRestartConfirm(true);
        return;
      }
      lastKeyRef.current = { key: "0", at: Date.now() };
      return;
    }
  }, [changeType, clipboard, deleteCells, doublePressMs, insertCell, interruptKernel, isViewer, mergeSelected, orderedCells, pasteCells, restoreCells, selected, selectedCell, selectedIndex]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const inTextField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      const inDialog = target.closest('[role="dialog"]') !== null;
      const inMenu = target.closest('[role="menu"]') !== null;
      if (inDialog || inMenu) return;

      // Ctrl+Shift+C opens the command palette from anywhere.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "C" || event.key === "c")) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // Ctrl+S saves a checkpoint.
      if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        if (canEdit) void saveCheckpoint();
        return;
      }
      if (inTextField) {
        if (mode === "edit") {
          // Run keys work in edit mode too.
          if (event.key === "Enter" && (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) {
            event.preventDefault();
            if (!isViewer) {
              if (event.shiftKey) void runSelected("next");
              else if (event.altKey) void runSelected("insertBelow");
              else void runSelected("inPlace");
            }
            return;
          }
          // Ctrl+Shift+Minus splits the cell at the cursor's line.
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "-" || event.key === "_")) {
            event.preventDefault();
            if (selectedCell !== undefined) {
              const textarea = target as HTMLTextAreaElement;
              const upToCursor = textarea.value.slice(0, textarea.selectionStart);
              const line = upToCursor.split("\n").length;
              void splitCell(selectedCell, line);
            }
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            void leaveEditMode();
            return;
          }
        }
        return;
      }
      if (mode === "edit") return;

      // Run keys work in both modes.
      if (event.key === "Enter" && (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) {
        event.preventDefault();
        if (!isViewer) {
          if (event.shiftKey) void runSelected("next");
          else if (event.altKey) void runSelected("insertBelow");
          else void runSelected("inPlace");
        }
        return;
      }

      // Command-mode keys work on the cells region, cells, toolbar and header buttons.
      if (event.key === "Enter" || event.key === " ") {
        const onControl = target.tagName === "BUTTON" || target.tagName === "A";
        if (!onControl && selectedCell !== undefined) {
          event.preventDefault();
          void enterEditMode(selectedCell);
          return;
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setModeAndAnnounce("command");
        return;
      }
      if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const neighbour = event.key === "ArrowUp" ? orderedCells[selectedIndex - 1] : orderedCells[selectedIndex + 1];
        if (neighbour !== undefined) setSelected(new Set([...selected, neighbour.id]));
        return;
      }
      void commandKeys(event.key, event);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [canEdit, commandKeys, enterEditMode, isViewer, leaveEditMode, mode, orderedCells, runSelected, saveCheckpoint, selectedCell, selectedIndex, setModeAndAnnounce, splitCell]);

  // The heartbeat's selected cell lives in a ref so the stream opens once.
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = [...selected][0] ?? null;
  }, [selected]);

  useEffect(() => {
    const tabId = tabIdRef.current;
    const source = new EventSource(`/api/notebooks/${notebookId}/events?tab_id=${encodeURIComponent(tabId)}`);
    let liveDown = false;
    source.onopen = () => {
      if (liveDown) {
        liveDown = false;
        announce("Live again");
        void api.notebook(notebookId).then((result) => {
          if (result.ok) {
            setNotebook(result.value.notebook);
            setKernelStatus(`Kernel ${result.value.notebook.kernel_status}`);
          }
        });
      }
    };
    source.onerror = () => {
      if (!liveDown) {
        liveDown = true;
        announce("Reconnecting…");
      }
    };
    source.addEventListener("cells", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { cells: Cell[] };
      setNotebook((current) => {
        if (current === null) return current;
        const incoming = new Map(data.cells.map((cell) => [cell.id, cell]));
        // A cell this page holds unsaved edits on keeps its own text and old base revision.
        const merged = data.cells.map((cell) => {
          if (editsRef.current.has(cell.id)) return { ...cell, source: editsRef.current.get(cell.id) as string, revision: baseRevisionRef.current.get(cell.id) ?? cell.revision };
          baseRevisionRef.current.set(cell.id, cell.revision);
          return cell;
        });
        void incoming;
        return { ...current, cells: merged };
      });
    });
    source.addEventListener("cell_saved", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { cells: Cell[] };
      setNotebook((current) => {
        if (current === null) return current;
        const byId = new Map(current.cells.map((cell) => [cell.id, cell]));
        for (const cell of data.cells) {
          if (editsRef.current.has(cell.id) && editsRef.current.get(cell.id) !== cell.source) {
            continue;
          }
          byId.set(cell.id, cell);
          baseRevisionRef.current.set(cell.id, cell.revision);
          editsRef.current.delete(cell.id);
        }
        const order = current.cells.map((c) => c.id);
        const kept: Cell[] = [];
        for (const id of order) {
          const cell = byId.get(id);
          if (cell !== undefined) kept.push(cell);
        }
        for (const cell of byId.values()) {
          if (!order.includes(cell.id)) kept.push(cell);
        }
        return { ...current, cells: kept.sort((a, b) => a.position - b.position) };
      });
    });
    source.addEventListener("run_state", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { cell_id: string; run_state: string; execution_count: number | null; outputs: Output[]; outputs_version: number };
      setNotebook((current) => {
        if (current === null) return current;
        const cells = current.cells.map((cell) =>
          cell.id === data.cell_id
            ? { ...cell, run_state: data.run_state as Cell["run_state"], execution_count: data.execution_count, outputs: data.outputs, outputs_version: data.outputs_version }
            : cell,
        );
        return { ...current, cells };
      });
      const position = (notebook?.cells.findIndex((c) => c.id === data.cell_id) ?? -1) + 1;
      if (data.run_state === "finished") {
        announce(`Cell ${position} ran as [${data.execution_count}]`, true);
      } else if (data.run_state === "failed") {
        const errorOutput = data.outputs.find((o) => o.output_type === "error");
        announce(`Cell ${position} failed with ${errorOutput !== undefined && errorOutput.output_type === "error" ? errorOutput.ename : "Error"}`, true);
      } else if (data.run_state === "interrupted") {
        announce(`Cell ${position} interrupted`, true);
      } else if (data.run_state === "not_run") {
        announce(`Cell ${position} not run`, true);
      }
      setTablePages((current) => {
        const next = { ...current };
        delete next[data.cell_id];
        return next;
      });
    });
    source.addEventListener("kernel_status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { kernel_status: string };
      setKernelStatus(`Kernel ${data.kernel_status}`);
      announce(`Kernel ${data.kernel_status}`, true);
    });
    source.addEventListener("presence", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { present: PresenceEntry[] };
      setPresence(data.present);
    });
    source.addEventListener("lock", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { cell_id: string; holder: string | null };
      setNotebook((current) => {
        if (current === null) return current;
        const cells = current.cells.map((cell) => (cell.id === data.cell_id ? { ...cell, locked_by: data.holder } : cell));
        return { ...current, cells };
      });
    });
    source.addEventListener("checkpoints", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { checkpoints: Checkpoint[] };
      setCheckpoints(data.checkpoints);
    });
    source.addEventListener("notebook", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { notebook: Notebook };
      setNotebook((current) => (current === null ? current : { ...current, cells: data.notebook.cells, title: data.notebook.title, kernel_status: data.notebook.kernel_status }));
      setKernelStatus(`Kernel ${data.notebook.kernel_status}`);
    });
    source.addEventListener("access_lost", () => {
      setNotFound(true);
    });
    const heartbeat = Math.max(1, Math.floor((config?.presence_timeout_ms ?? 20000) / 3));
    const presenceTimer = setInterval(() => {
      const cellId = selectedRef.current;
      void api.presence(notebookId, { tab_id: tabId, cell_id: cellId });
    }, heartbeat);
    return () => {
      source.close();
      clearInterval(presenceTimer);
    };
  }, [notebookId, announce, config]);

  // --------------------------------------------------------------- render

  const resolveAttachment = useCallback((cellId: string, name: string) => {
    return `/api/notebooks/${notebookId}/attachments/${cellId}/${encodeURIComponent(name)}`;
  }, [notebookId]);

  const tocEntries = orderedCells.flatMap((cell) => {
    if (cell.cell_type !== "markdown") return [];
    const rendered = renderMarkdown(cell.source);
    return rendered.headings.map((heading) => ({ ...heading, cellId: cell.id }));
  });

  const paletteOptions = isViewer ? VIEWER_PALETTE_OPTIONS : COMMAND_PALETTE_OPTIONS;

  if (notFound) {
    return (
      <>
        <WorkspaceHeader user={user} />
        <main className="band">
          <div className="container empty-state">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <circle cx="24" cy="24" r="16" />
              <path d="M17 17l14 14M31 17L17 31" />
            </svg>
            <h1 className="section-heading" style={{ fontSize: "1.3rem" }}>Notebook not found</h1>
            <p><a href="/notebooks">Back to your notebooks</a></p>
          </div>
        </main>
      </>
    );
  }

  if (notebook === null) {
    return (
      <>
        <WorkspaceHeader user={user} />
        <main className="band"><div className="container"><p>Loading…</p></div></main>
      </>
    );
  }

  const fileMenu = [
    { label: "New notebook", onSelect: () => redirectTo("/notebooks") },
    { label: "Import notebook", onSelect: () => redirectTo("/notebooks") },
    { label: "Export", onSelect: exportNotebook, disabled: false },
    ...(notebook.imported ? [{ label: "Download original", onSelect: () => window.location.assign(`/api/notebooks/${notebookId}/original`) }] : []),
    { label: "Save checkpoint", onSelect: () => void saveCheckpoint(), disabled: !canEdit },
  ];
  const editMenu = [
    { label: "Cut cells", onSelect: () => { setClipboard(orderedCells.filter((c) => selected.has(c.id)).map((c) => ({ cell_type: c.cell_type, source: c.source }))); void deleteCells([...selected]); }, disabled: !canEdit },
    { label: "Copy cells", onSelect: () => setClipboard(orderedCells.filter((c) => selected.has(c.id)).map((c) => ({ cell_type: c.cell_type, source: c.source }))), disabled: !canEdit },
    { label: "Paste cells below", onSelect: () => { if (clipboard !== null) void pasteCells((selectedCell?.position ?? orderedCells.length - 1) + 1, clipboard); }, disabled: !canEdit || clipboard === null },
    { label: "Delete cells", onSelect: () => void deleteCells([...selected]), disabled: !canEdit },
    { label: "Undo delete", onSelect: () => void restoreCells(), disabled: !canEdit || droppedSource === null },
    { label: "Merge selected cells", onSelect: () => void mergeSelected(), disabled: !canEdit },
    { label: "Split cell", onSelect: () => { if (selectedCell !== undefined) { const lines = selectedCell.source.split("\n").length; void splitCell(selectedCell, Math.min(2, Math.max(2, lines))); } }, disabled: !canEdit },
  ];
  const cellMenu = [
    { label: "Run", onSelect: () => void runSelected("inPlace"), disabled: !canEdit },
    { label: "Run all", onSelect: () => void runAll(), disabled: !canEdit },
    { label: "Change to code", onSelect: () => void changeType("code"), disabled: !canEdit },
    { label: "Change to markdown", onSelect: () => void changeType("markdown"), disabled: !canEdit },
    { label: "Move cell up", onSelect: () => { if (selectedCell !== undefined && selectedCell.position > 0) void moveCell(selectedCell.id, selectedCell.position - 1); }, disabled: !canEdit },
    { label: "Move cell down", onSelect: () => { if (selectedCell !== undefined && selectedCell.position < orderedCells.length - 1) void moveCell(selectedCell.id, selectedCell.position + 1); }, disabled: !canEdit },
    { label: "Insert code cell below", onSelect: () => void insertCell((selectedCell?.position ?? orderedCells.length - 1) + 1, "code"), disabled: !canEdit },
  ];
  const kernelMenu = [
    { label: "Interrupt kernel", onSelect: () => void interruptKernel(), disabled: !canEdit },
    { label: "Restart kernel", onSelect: () => setRestartConfirm(true), disabled: !canEdit },
  ];

  return (
    <>
      <header className="workspace-header" role="banner">
        <div className="workspace-header__inner" style={{ position: "relative" }}>
          <a className="brand-mark" href="/" aria-label="Brackenpad home">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <rect x="2" y="5" width="4" height="16" rx="1" fill="#d9700a" />
              <rect x="20" y="5" width="4" height="16" rx="1" fill="#d9700a" />
              <circle cx="9" cy="8" r="1.6" fill="#8a8a84" />
              <circle cx="13" cy="13" r="2.2" fill="#8a8a84" />
              <circle cx="9" cy="18" r="1.3" fill="#8a8a84" />
            </svg>
            <span className="brand-wordmark">Brackenpad</span>
          </a>
          <nav aria-label="Notebook menus" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <HeaderMenu id="file-menu" label="File" items={fileMenu} />
            <HeaderMenu id="edit-menu" label="Edit" items={editMenu} />
            <HeaderMenu id="cell-menu" label="Cell" items={cellMenu} />
            <HeaderMenu id="kernel-menu" label="Kernel" items={kernelMenu} caret />
            {notebook.role === "owner" ? (
              <button className="menu-button" onClick={() => setShareOpen(true)}>Share</button>
            ) : null}
          </nav>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem", margin: 0 }}>{notebook.title}</h1>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <ul aria-label="People here" style={{ display: "flex", gap: 8, listStyle: "none", margin: 0, padding: 0, fontSize: "0.85rem" }}>
              {[...new Map(presence.map((p) => [p.display_name, p])).values()].map((person) => (
                <li key={person.tab_id} title={person.display_name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
                  {person.display_name}
                </li>
              ))}
            </ul>
            <span aria-hidden="true" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {isViewer ? "View only" : mode === "command" ? "Command mode" : "Edit mode"}
            </span>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{kernelStatus}</span>
          </div>
        </div>
      </header>

      <div role="status" aria-live="polite" className="status" id="notebook-status">
        {statusAnnouncement ?? ""}
      </div>
      <div role="status" aria-live="polite" className="status" id="save-status">
        {saveStatus}
      </div>

      {outage ? (
        <div className="outage-banner" role="alert">
          Storage is unavailable. Your edits are kept in this page and will be saved when storage returns.
        </div>
      ) : null}

      <div className="toolbar" style={{ display: "flex", gap: 8, padding: "10px 24px", borderBottom: "1px solid var(--band-edge)", maxWidth: 1100, margin: "0 auto", flexWrap: "wrap" }} role="toolbar" aria-label="Notebook actions">
        <button className="button--accent" disabled={!canEdit} onClick={() => void runSelected("inPlace")}>Run</button>
        <button className="button--plain" disabled={!canEdit} onClick={() => void runAll()}>Run all</button>
        <button className="button--plain" disabled={!canEdit} onClick={() => void interruptKernel()}>Interrupt kernel</button>
        <button className="button--plain" disabled={!canEdit} onClick={() => setRestartConfirm(true)}>Restart kernel</button>
        <button className="button--accent" disabled={!canEdit} onClick={() => void saveCheckpoint()}>Save checkpoint</button>
        <button className="button--plain" onClick={() => setCheckpointPanelOpen(true)}>Checkpoints</button>
        <button className="button--plain" onClick={exportNotebook}>Export</button>
        {notebook.imported ? (
          <button className="button--plain" onClick={() => window.location.assign(`/api/notebooks/${notebookId}/original`)}>Download original</button>
        ) : null}
        <button className="button--plain show-toc-button" onClick={() => setContentsDrawerOpen(true)}>Show table of contents</button>
      </div>

      <div className="notebook-layout">
        <nav className="toc" aria-label="Table of contents">
          <ul className="toc__list">
            {tocEntries.map((entry) => (
              <li key={`${entry.cellId}-${entry.anchor}`}>
                <a
                  className="toc__link"
                  href={`#${entry.anchor}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelected(new Set([entry.cellId]));
                    setModeAndAnnounce("command");
                    const element = document.getElementById(`cell-${entry.cellId}`);
                    element?.scrollIntoView({ block: "start" });
                    document.getElementById(`cell-${entry.cellId}`)?.focus();
                  }}
                >
                  {entry.number} {entry.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="cells-band">
          <div id="cells-region" className="cells" role="region" aria-label="Cells" tabIndex={-1}>
            {orderedCells.map((cell, index) => (
              <CellArticle
                key={cell.id}
                cell={cell}
                index={index}
                selected={selected.has(cell.id)}
                editing={mode === "edit" && selected.has(cell.id)}
                canEdit={canEdit}
                isViewer={isViewer === true}
                config={config}
                tablePages={tablePages[cell.id]}
                onTablePage={(entry) => setTablePages((current) => ({ ...current, [cell.id]: entry }))}
                resolveAttachment={(name) => resolveAttachment(cell.id, name)}
                onSelect={() => setSelected(new Set([cell.id]))}
                onSourceChange={(source) => onCellSourceChange(cell.id, source)}
                onRun={() => void runCell(cell)}
                onCellActions={() => setCellSheetId(cell.id)}
                onMove={(position) => void moveCell(cell.id, position)}
                positionCount={orderedCells.length}
                announce={announce}
                announceShared={(message) => announce(message, true)}
                notebookId={notebookId}
                onOutputReplaced={(message) => announce(message, true)}
              />
            ))}
          </div>
        </main>
      </div>

      {/* Dialogs and sheets follow */}
      <NotebookDialogs
        notebookId={notebookId}
        notebook={notebook}
        checkpoints={checkpoints}
        checkpointPanelOpen={checkpointPanelOpen}
        compareResult={compareResult}
        revertConfirm={revertConfirm}
        paletteOpen={paletteOpen}
        restartConfirm={restartConfirm}
        shareOpen={shareOpen}
        contentsDrawerOpen={contentsDrawerOpen}
        cellSheetId={cellSheetId}
        tocEntries={tocEntries}
        paletteOptions={paletteOptions}
        canEdit={canEdit}
        onCloseCheckpoints={() => setCheckpointPanelOpen(false)}
        onOpenCompare={(checkpoint) => void openCompare(checkpoint)}
        onCloseCompare={() => setCompareResult(null)}
        onRevert={(checkpoint, cellId) => setRevertConfirm({ checkpoint, cellId })}
        onConfirmRevert={() => { if (revertConfirm !== null) void revert(revertConfirm.checkpoint, revertConfirm.cellId); }}
        onCancelRevert={() => setRevertConfirm(null)}
        onClosePalette={() => setPaletteOpen(false)}
        onPaletteCommand={(command) => {
          setPaletteOpen(false);
          if (command === "Run all cells") void runAll();
          else if (command === "Run selected cell") void runSelected("inPlace");
          else if (command === "Interrupt kernel") void interruptKernel();
          else if (command === "Restart kernel") setRestartConfirm(true);
          else if (command === "Save checkpoint") void saveCheckpoint();
          else if (command === "Insert code cell below") void insertCell((selectedCell?.position ?? orderedCells.length - 1) + 1, "code");
          else if (command === "Insert markdown cell below") void insertCell((selectedCell?.position ?? orderedCells.length - 1) + 1, "markdown");
          else if (command === "Export notebook") exportNotebook();
          else if (command === "Show table of contents") setContentsDrawerOpen(true);
        }}
        onConfirmRestart={() => void restartKernelFlow()}
        onCancelRestart={() => setRestartConfirm(false)}
        onCloseShare={() => setShareOpen(false)}
        onCloseContents={() => setContentsDrawerOpen(false)}
        onTocEntry={(entry) => {
          setContentsDrawerOpen(false);
          setSelected(new Set([entry.cellId]));
          setModeAndAnnounce("command");
          document.getElementById(`cell-${entry.cellId}`)?.scrollIntoView({ block: "start" });
          // The drawer's own close returns focus to its opener; the cell wins the moment after.
          setTimeout(() => {
            document.getElementById(`cell-${entry.cellId}`)?.focus();
          }, 0);
        }}
        onCloseCellSheet={() => setCellSheetId(null)}
        onCellSheetAction={(action) => {
          const cell = orderedCells.find((c) => c.id === cellSheetId);
          setCellSheetId(null);
          if (cell === undefined) return;
          if (action === "run") void runCell(cell);
          else if (action === "insert") void insertCell(cell.position + 1, "code");
          else if (action === "type") void changeType(cell.cell_type === "code" ? "markdown" : "code");
          else if (action === "up" && cell.position > 0) void moveCell(cell.id, cell.position - 1);
          else if (action === "down" && cell.position < orderedCells.length - 1) void moveCell(cell.id, cell.position + 1);
          else if (action === "delete") void deleteCells([cell.id]);
        }}
        onRemoveShare={async (shareId) => {
          await api.removeShare(notebookId, shareId);
        }}
      />

      {conflictCellId !== null ? (
        <Dialog
          labelledBy="conflict-title"
          onClose={() => undefined}
          restoreFocusTo={document.getElementById(`cell-${conflictCellId}`)}
        >
          <h2 className="dialog__title" id="conflict-title">Notebook changed elsewhere</h2>
          <p>Someone saved this notebook after you started editing. Choose which version to keep.</p>
          <div className="dialog__actions">
            <button
              className="button--accent"
              onClick={() => {
                const cellId = conflictCellId;
                setConflictCellId(null);
                void api.notebook(notebookId).then((result) => {
                  if (result.ok) {
                    const server = result.value.notebook.cells.find((c) => c.id === cellId);
                    setNotebook((current) => {
                      if (current === null) return current;
                      const cells = current.cells.map((c) => (c.id === cellId && server !== undefined ? server : c));
                      return { ...current, cells };
                    });
                    if (server !== undefined) {
                      editsRef.current.delete(cellId);
                      baseRevisionRef.current.set(cellId, server.revision);
                    }
                  }
                });
              }}
            >
              Reload latest
            </button>
            <button
              className="button--plain"
              onClick={() => {
                const cellId = conflictCellId;
                setConflictCellId(null);
                void api.notebook(notebookId).then((result) => {
                  if (result.ok) {
                    const server = result.value.notebook.cells.find((c) => c.id === cellId);
                    if (server !== undefined) {
                      baseRevisionRef.current.set(cellId, server.revision);
                    }
                    void performSave();
                  }
                });
              }}
            >
              Keep my version
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
