import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Cell,
  CellType,
  Checkpoint,
  KernelStatus,
  Notebook,
  PresenceEntry,
  PublishedLimits,
  Role,
} from '../../shared/types.js';
import { ApiFailure, apiDownload, apiGet, apiSend } from '../api.js';
import { RunManager } from './kernel.js';

export type Mode = 'command' | 'edit' | 'view';

interface Draft {
  text: string;
  base: number;
  cellType: CellType;
}

interface NotebookEventData {
  type: string;
  cells?: Cell[];
  cell?: Cell;
  tab_id?: string;
  kernel_status?: KernelStatus;
  present?: PresenceEntry[];
  position?: number;
  status?: string;
  execution_count?: number | null;
  error_name?: string | null;
  title?: string;
}

const KERNEL_WORDS: Record<KernelStatus, string> = {
  starting: 'Kernel starting',
  idle: 'Kernel idle',
  busy: 'Kernel busy',
  interrupted: 'Kernel interrupted',
  restarting: 'Kernel restarting',
};

export interface Selection {
  anchor: number;
  index: number;
}

export interface NotebookController {
  notebook: Notebook | null;
  notFound: boolean;
  cells: Cell[];
  role: Role;
  canEdit: boolean;
  mode: Mode;
  selection: Selection;
  selectedIndices: number[];
  drafts: Record<string, Draft>;
  kernelStatus: KernelStatus;
  connected: boolean;
  present: PresenceEntry[];
  status: string;
  saveStatus: string;
  outage: boolean;
  checkpoints: Checkpoint[];
  conflictCellId: string | null;
  limits: PublishedLimits;
  lockedBy: (cell: Cell) => string | null;
  announce: (message: string) => void;
  select: (index: number, extend?: boolean) => void;
  enterEdit: (at?: number) => void;
  enterCommand: () => void;
  setDraft: (cell: Cell, text: string) => void;
  insertCell: (where: 'above' | 'below', cellType: CellType, at?: number) => Promise<void>;
  changeType: (cellType: CellType, ids?: string[]) => Promise<void>;
  deleteCells: (ids?: string[]) => Promise<void>;
  undoDelete: () => Promise<void>;
  copyCells: () => void;
  cutCells: () => Promise<void>;
  pasteCells: () => Promise<void>;
  mergeCells: () => Promise<void>;
  splitCell: (line: number) => Promise<void>;
  moveCell: (cellId: string, position: number) => Promise<void>;
  runCells: (kind: 'advance' | 'in-place' | 'insert-below') => Promise<void>;
  runAll: () => Promise<void>;
  interrupt: () => void;
  restart: () => Promise<void>;
  saveCheckpoint: () => Promise<void>;
  exportNotebook: () => Promise<void>;
  downloadOriginal: () => Promise<void>;
  reloadLatest: () => Promise<void>;
  keepMyVersion: () => Promise<void>;
  flush: () => Promise<void>;
  reloadCheckpoints: () => Promise<void>;
  afterRevert: (label: string) => void;
}

export function useNotebook(notebookId: string, limits: PublishedLimits): NotebookController {
  const tabId = useMemo(() => crypto.randomUUID(), []);
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cells, setCells] = useState<Cell[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selection, setSelection] = useState<Selection>({ anchor: 0, index: 0 });
  const [mode, setMode] = useState<Mode>('command');
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>('idle');
  const [connected, setConnected] = useState(true);
  const [present, setPresent] = useState<PresenceEntry[]>([]);
  const [status, setStatus] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [outage, setOutage] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [conflictCellId, setConflictCellId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ cell_type: CellType; source: string }[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[] | null>(null);

  const role: Role = notebook ? notebook.role : 'viewer';
  const canEdit = role === 'owner' || role === 'editor';

  const state = useRef({ cells, drafts, selection, mode, canEdit });
  state.current = { cells, drafts, selection, mode, canEdit };
  const saveTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const runner = useRef<RunManager | null>(null);
  const lockedCell = useRef<string | null>(null);
  /** The cell edit mode is being claimed for, so a later Escape wins the race. */
  const editIntent = useRef<string | null>(null);

  const announce = useCallback((message: string) => setStatus(message), []);

  const sourceOf = useCallback(
    (cell: Cell): string => {
      const draft = state.current.drafts[cell.id];
      return draft === undefined ? cell.source : draft.text;
    },
    [],
  );

  const lockedBy = useCallback(
    (cell: Cell): string | null => {
      if (cell.locked_by === null) return null;
      return lockedCell.current === cell.id ? null : cell.locked_by;
    },
    [],
  );

  const load = useCallback(async (): Promise<Notebook | null> => {
    try {
      const answer = await apiGet<{ notebook: Notebook }>(`/api/notebooks/${notebookId}`);
      setNotebook(answer.notebook);
      setCells(answer.notebook.cells);
      setKernelStatus(answer.notebook.kernel_status);
      if (answer.notebook.role === 'viewer') setMode('view');
      return answer.notebook;
    } catch (error) {
      if (error instanceof ApiFailure && (error.status === 404 || error.status === 401)) {
        setNotFound(true);
        return null;
      }
      throw error;
    }
  }, [notebookId]);

  const reloadCheckpoints = useCallback(async (): Promise<void> => {
    try {
      const answer = await apiGet<{ checkpoints: Checkpoint[] }>(
        `/api/notebooks/${notebookId}/checkpoints`,
      );
      setCheckpoints(answer.checkpoints);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setCheckpoints([]);
    }
  }, [notebookId]);

  useEffect(() => {
    void load().then((found) => {
      if (found) void reloadCheckpoints();
    });
  }, [load, reloadCheckpoints]);

  /** The one save: every unsaved edit goes in one request with its base revision. */
  const save = useCallback(async (): Promise<void> => {
    const pending = Object.entries(state.current.drafts);
    if (pending.length === 0 || !state.current.canEdit) return;
    setSaveStatus('Saving…');
    try {
      const answer = await apiSend<{ cells: Cell[] }>('POST', `/api/notebooks/${notebookId}/save`, {
        tab_id: tabId,
        cells: pending.map(([id, draft]) => ({
          id,
          base_revision: draft.base,
          source: draft.text,
          cell_type: draft.cellType,
        })),
      });
      setCells((current) =>
        current.map((cell) => answer.cells.find((saved) => saved.id === cell.id) ?? cell),
      );
      setDrafts((current) => {
        const next = { ...current };
        for (const [id, draft] of pending) {
          if (next[id] !== undefined && next[id].text === draft.text) delete next[id];
        }
        return next;
      });
      setOutage(false);
      setSaveStatus('All changes saved');
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'storage_unavailable') {
        setOutage(true);
        setSaveStatus('Saving paused: storage unavailable');
        if (retryTimer.current === null) {
          retryTimer.current = window.setInterval(() => {
            void save();
          }, 5000);
        }
        return;
      }
      if (error.code === 'stale_revision') {
        setConflictCellId(pending[0][0]);
        setSaveStatus('Unsaved changes');
        return;
      }
      setSaveStatus('Unsaved changes');
    }
  }, [notebookId, tabId]);

  useEffect(() => {
    if (!outage && retryTimer.current !== null) {
      window.clearInterval(retryTimer.current);
      retryTimer.current = null;
    }
  }, [outage]);

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await save();
  }, [save]);

  const setDraft = useCallback(
    (cell: Cell, text: string) => {
      setDrafts((current) => {
        const existing = current[cell.id];
        return {
          ...current,
          [cell.id]: {
            text,
            base: existing === undefined ? cell.revision : existing.base,
            cellType: cell.cell_type,
          },
        };
      });
      setSaveStatus('Unsaved changes');
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void save();
      }, limits.autosave_ms);
    },
    [limits.autosave_ms, save],
  );

  /* The live connection. */
  useEffect(() => {
    if (notFound) return;
    let stream: EventSource | null = new EventSource(
      `/api/notebooks/${notebookId}/events?tab_id=${encodeURIComponent(tabId)}`,
    );
    let wasDown = false;
    stream.addEventListener('notebook', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as NotebookEventData;
      if (data.type === 'cells' && data.cells) setCells(data.cells);
      else if (data.type === 'saved_cells' && data.cells) {
        const incoming = data.cells;
        setCells((current) => current.map((cell) => incoming.find((saved) => saved.id === cell.id) ?? cell));
      } else if (data.type === 'cell' && data.cell) {
        const incoming = data.cell;
        setCells((current) => current.map((cell) => (cell.id === incoming.id ? incoming : cell)));
      } else if (data.type === 'kernel' && data.kernel_status) {
        setKernelStatus(data.kernel_status);
        setStatus(KERNEL_WORDS[data.kernel_status]);
      } else if (data.type === 'run') {
        const position = (data.position ?? 0) + 1;
        if (data.status === 'finished') setStatus(`Cell ${position} ran as [${data.execution_count}]`);
        else if (data.status === 'failed') setStatus(`Cell ${position} failed with ${data.error_name}`);
        else if (data.status === 'interrupted') setStatus(`Cell ${position} interrupted`);
        else if (data.status === 'not_run') setStatus(`Cell ${position} not run`);
      } else if (data.type === 'presence' && data.present) setPresent(data.present);
      else if (data.type === 'checkpoints') void reloadCheckpoints();
      else if (data.type === 'title' && data.title !== undefined) {
        setNotebook((current) => (current ? { ...current, title: data.title as string } : current));
      } else if (data.type === 'revoked') setNotFound(true);
    });
    stream.onopen = () => {
      setConnected(true);
      if (wasDown) {
        wasDown = false;
        setStatus('Live again');
        void load();
      }
    };
    stream.onerror = () => {
      wasDown = true;
      setConnected(false);
      setStatus('Reconnecting…');
    };
    return () => {
      stream?.close();
      stream = null;
    };
  }, [notebookId, tabId, notFound, load, reloadCheckpoints]);

  /* The presence heartbeat, every third of the presence timeout. */
  useEffect(() => {
    if (notFound) return;
    const period = Math.floor(limits.presence_timeout_ms / 3);
    const beat = (): void => {
      const current = state.current.cells[state.current.selection.index];
      void apiSend('POST', `/api/notebooks/${notebookId}/presence`, {
        tab_id: tabId,
        cell_id: current ? current.id : null,
      }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, period);
    return () => window.clearInterval(timer);
  }, [notebookId, tabId, limits.presence_timeout_ms, notFound]);

  /* This tab's kernel. A viewer's tab runs no kernel. */
  useEffect(() => {
    if (!canEdit || notFound) return;
    const manager = new RunManager(notebookId, tabId, limits, {
      onCell: (cell) => setCells((current) => current.map((item) => (item.id === cell.id ? cell : item))),
      onKernelStatus: (next) => setKernelStatus(next),
      flushEdits: flush,
    });
    runner.current = manager;
    return () => {
      manager.dispose();
      runner.current = null;
    };
  }, [canEdit, notFound, notebookId, tabId, limits, flush]);

  const selectedIndices = useMemo(() => {
    const from = Math.min(selection.anchor, selection.index);
    const to = Math.max(selection.anchor, selection.index);
    const indices: number[] = [];
    for (let index = from; index <= to; index += 1) indices.push(index);
    return indices;
  }, [selection]);

  const select = useCallback((index: number, extend = false) => {
    const next = { anchor: extend ? state.current.selection.anchor : index, index };
    state.current.selection = next;
    setSelection(next);
  }, []);

  const releaseLock = useCallback(async (): Promise<void> => {
    const held = lockedCell.current;
    if (held === null) return;
    lockedCell.current = null;
    await apiSend('DELETE', `/api/notebooks/${notebookId}/cells/${held}/lock`, { tab_id: tabId }).catch(
      () => undefined,
    );
  }, [notebookId, tabId]);

  const enterCommand = useCallback(() => {
    if (!state.current.canEdit) return;
    editIntent.current = null;
    void releaseLock();
    state.current.mode = 'command';
    setMode('command');
    setStatus('Command mode');
  }, [releaseLock]);

  const enterEdit = useCallback(
    (at?: number) => {
      const { cells: known, selection: chosen, canEdit: allowed, mode: current } = state.current;
      const index = at ?? chosen.index;
      const cell = known[index];
      if (!allowed || !cell) return;
      if (current === 'edit' && lockedCell.current === cell.id) return;
      if (cell.locked_by !== null && lockedCell.current !== cell.id) {
        setStatus(`Cell ${index + 1} is being edited by ${cell.locked_by}`);
        return;
      }
      editIntent.current = cell.id;
      void (async () => {
        try {
          await apiSend('POST', `/api/notebooks/${notebookId}/cells/${cell.id}/lock`, { tab_id: tabId });
          if (editIntent.current !== cell.id) {
            await apiSend('DELETE', `/api/notebooks/${notebookId}/cells/${cell.id}/lock`, { tab_id: tabId });
            return;
          }
          lockedCell.current = cell.id;
          state.current.mode = 'edit';
          setMode('edit');
          setStatus('Edit mode');
        } catch (error) {
          if (!(error instanceof ApiFailure)) throw error;
          const holder = typeof error.body.holder === 'string' ? error.body.holder : 'someone else';
          setStatus(`Cell ${index + 1} is being edited by ${holder}`);
        }
      })();
    },
    [notebookId, tabId],
  );

  const applyCells = useCallback((incoming: Cell[]) => setCells(incoming), []);

  const insertCell = useCallback(
    async (where: 'above' | 'below', cellType: CellType, at?: number): Promise<void> => {
      const index = at ?? state.current.selection.index;
      const position = where === 'above' ? index : index + 1;
      const answer = await apiSend<{ cells: Cell[]; new_ids: string[] }>(
        'POST',
        `/api/notebooks/${notebookId}/cells`,
        { position, cell_type: cellType, source: '' },
      );
      applyCells(answer.cells);
      const newIndex = answer.cells.findIndex((cell) => cell.id === answer.new_ids[0]);
      if (newIndex >= 0) setSelection({ anchor: newIndex, index: newIndex });
    },
    [applyCells, notebookId],
  );

  const changeType = useCallback(
    async (cellType: CellType, ids?: string[]): Promise<void> => {
      const chosen = ids ?? selectedIndices.map((index) => state.current.cells[index]?.id).filter(Boolean);
      const wanted = chosen
        .map((id) => state.current.cells.find((cell) => cell.id === id))
        .filter((cell): cell is Cell => cell !== undefined);
      if (wanted.length === 0) return;
      try {
        const answer = await apiSend<{ cells: Cell[] }>('POST', `/api/notebooks/${notebookId}/save`, {
          tab_id: tabId,
          cells: wanted.map((cell) => ({
            id: cell.id,
            base_revision: state.current.drafts[cell.id]?.base ?? cell.revision,
            source: state.current.drafts[cell.id]?.text ?? cell.source,
            cell_type: cellType,
          })),
        });
        setCells((current) =>
          current.map((cell) => answer.cells.find((saved) => saved.id === cell.id) ?? cell),
        );
        setDrafts((current) => {
          const next = { ...current };
          for (const cell of wanted) delete next[cell.id];
          return next;
        });
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.code === 'stale_revision') setConflictCellId(wanted[0].id);
      }
    },
    [notebookId, selectedIndices, tabId],
  );

  const deleteCells = useCallback(
    async (ids?: string[]): Promise<void> => {
      const chosen =
        ids ??
        selectedIndices
          .map((index) => state.current.cells[index]?.id)
          .filter((id): id is string => id !== undefined);
      if (chosen.length === 0) return;
      try {
        const answer = await apiSend<{ cells: Cell[] }>(
          'POST',
          `/api/notebooks/${notebookId}/cells/delete`,
          { tab_id: tabId, ids: chosen },
        );
        applyCells(answer.cells);
        setDeletedIds(chosen);
        const next = Math.min(Math.min(...selectedIndices), answer.cells.length - 1);
        setSelection({ anchor: Math.max(0, next), index: Math.max(0, next) });
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
      }
    },
    [applyCells, notebookId, selectedIndices, tabId],
  );

  const undoDelete = useCallback(async (): Promise<void> => {
    if (deletedIds === null) return;
    try {
      const answer = await apiSend<{ cells: Cell[] }>(
        'POST',
        `/api/notebooks/${notebookId}/cells/restore`,
        { ids: deletedIds },
      );
      applyCells(answer.cells);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
    setDeletedIds(null);
  }, [applyCells, deletedIds, notebookId]);

  const copyCells = useCallback(() => {
    setClipboard(
      selectedIndices
        .map((index) => state.current.cells[index])
        .filter((cell): cell is Cell => cell !== undefined)
        .map((cell) => ({ cell_type: cell.cell_type, source: sourceOf(cell) })),
    );
  }, [selectedIndices, sourceOf]);

  const cutCells = useCallback(async (): Promise<void> => {
    copyCells();
    await deleteCells();
  }, [copyCells, deleteCells]);

  const pasteCells = useCallback(async (): Promise<void> => {
    if (clipboard.length === 0) return;
    const answer = await apiSend<{ cells: Cell[]; new_ids: string[] }>(
      'POST',
      `/api/notebooks/${notebookId}/cells/paste`,
      { position: state.current.selection.index + 1, cells: clipboard },
    );
    applyCells(answer.cells);
  }, [applyCells, clipboard, notebookId]);

  const mergeCells = useCallback(async (): Promise<void> => {
    const chosen = selectedIndices
      .map((index) => state.current.cells[index])
      .filter((cell): cell is Cell => cell !== undefined);
    const wanted =
      chosen.length > 1
        ? chosen
        : [chosen[0], state.current.cells[state.current.selection.index + 1]].filter(
            (cell): cell is Cell => cell !== undefined,
          );
    if (wanted.length < 2) return;
    if (!wanted.every((cell) => cell.cell_type === wanted[0].cell_type)) {
      setStatus('Cannot merge code and markdown cells');
      return;
    }
    await flush();
    try {
      const answer = await apiSend<{ cells: Cell[] }>('POST', `/api/notebooks/${notebookId}/cells/merge`, {
        tab_id: tabId,
        ids: wanted.map((cell) => cell.id),
        base_revisions: Object.fromEntries(
          wanted.map((cell) => [
            cell.id,
            state.current.cells.find((item) => item.id === cell.id)?.revision ?? cell.revision,
          ]),
        ),
      });
      applyCells(answer.cells);
      const index = answer.cells.findIndex((cell) => cell.id === wanted[0].id);
      if (index >= 0) setSelection({ anchor: index, index });
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 422) setStatus('Cannot merge code and markdown cells');
    }
  }, [applyCells, flush, notebookId, selectedIndices, tabId]);

  const splitCell = useCallback(
    async (line: number): Promise<void> => {
      const cell = state.current.cells[state.current.selection.index];
      if (!cell) return;
      await flush();
      const latest = state.current.cells.find((item) => item.id === cell.id) ?? cell;
      try {
        const answer = await apiSend<{ cells: Cell[]; new_ids: string[] }>(
          'POST',
          `/api/notebooks/${notebookId}/cells/${cell.id}/split`,
          { tab_id: tabId, base_revision: latest.revision, line },
        );
        applyCells(answer.cells);
        const index = answer.cells.findIndex((item) => item.id === answer.new_ids[0]);
        if (index >= 0) {
          setSelection({ anchor: index, index });
          lockedCell.current = null;
          setMode('edit');
          setStatus('Edit mode');
          await apiSend('POST', `/api/notebooks/${notebookId}/cells/${answer.new_ids[0]}/lock`, {
            tab_id: tabId,
          }).catch(() => undefined);
          lockedCell.current = answer.new_ids[0];
        }
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
      }
    },
    [applyCells, flush, notebookId, tabId],
  );

  const moveCell = useCallback(
    async (cellId: string, position: number): Promise<void> => {
      try {
        const answer = await apiSend<{ cells: Cell[] }>(
          'POST',
          `/api/notebooks/${notebookId}/cells/${cellId}/move`,
          { tab_id: tabId, position },
        );
        applyCells(answer.cells);
        const index = answer.cells.findIndex((cell) => cell.id === cellId);
        if (index >= 0) setSelection({ anchor: index, index });
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
      }
    },
    [applyCells, notebookId, tabId],
  );

  const runCells = useCallback(
    async (kind: 'advance' | 'in-place' | 'insert-below'): Promise<void> => {
      const { cells: known, selection: chosen } = state.current;
      const cell = known[chosen.index];
      if (!cell || !state.current.canEdit) return;
      await flush();
      if (cell.cell_type === 'code') {
        await runner.current?.enqueue([{ id: cell.id, source: sourceOf(cell) }]);
      }
      if (kind === 'advance') {
        if (chosen.index === known.length - 1) await insertCell('below', 'code');
        else select(chosen.index + 1);
        enterCommand();
        return;
      }
      if (kind === 'in-place') {
        enterCommand();
        return;
      }
      await insertCell('below', 'code');
      enterEdit();
    },
    [enterCommand, enterEdit, flush, insertCell, select, sourceOf],
  );

  const runAll = useCallback(async (): Promise<void> => {
    if (!state.current.canEdit) return;
    await flush();
    const code = state.current.cells
      .filter((cell) => cell.cell_type === 'code')
      .map((cell) => ({ id: cell.id, source: sourceOf(cell) }));
    await runner.current?.enqueue(code);
  }, [flush, sourceOf]);

  const interrupt = useCallback(() => runner.current?.interrupt(), []);

  const restart = useCallback(async (): Promise<void> => {
    await runner.current?.restart();
  }, []);

  const saveCheckpoint = useCallback(async (): Promise<void> => {
    if (!state.current.canEdit) return;
    setSaveStatus('Saving checkpoint…');
    try {
      await apiSend<{ checkpoint: Checkpoint }>('POST', `/api/notebooks/${notebookId}/checkpoints`, {});
      setSaveStatus('Checkpoint saved');
      setOutage(false);
      await reloadCheckpoints();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'storage_unavailable') {
        setSaveStatus('Checkpoint not saved: storage unavailable');
        setOutage(true);
        await reloadCheckpoints();
        return;
      }
      setSaveStatus('Checkpoint not saved: storage unavailable');
    }
  }, [notebookId, reloadCheckpoints]);

  const exportNotebook = useCallback(async (): Promise<void> => {
    const title = notebook ? notebook.title : 'notebook';
    try {
      await apiDownload(`/api/notebooks/${notebookId}/export`, `${title}.ipynb`);
      setSaveStatus(`Exported ${title}.ipynb`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setOutage(true);
      setSaveStatus('Saving paused: storage unavailable');
    }
  }, [notebook, notebookId]);

  const downloadOriginal = useCallback(async (): Promise<void> => {
    await apiDownload(`/api/notebooks/${notebookId}/original`, 'original.ipynb').catch(() => undefined);
  }, [notebookId]);

  const reloadLatest = useCallback(async (): Promise<void> => {
    setDrafts({});
    setConflictCellId(null);
    await load();
    setSaveStatus('All changes saved');
  }, [load]);

  const keepMyVersion = useCallback(async (): Promise<void> => {
    const fresh = await apiGet<{ notebook: Notebook }>(`/api/notebooks/${notebookId}`);
    setCells(fresh.notebook.cells);
    setDrafts((current) => {
      const next: Record<string, Draft> = {};
      for (const [id, draft] of Object.entries(current)) {
        const server = fresh.notebook.cells.find((cell) => cell.id === id);
        if (server) next[id] = { ...draft, base: server.revision };
      }
      return next;
    });
    setConflictCellId(null);
    window.setTimeout(() => {
      void save();
    }, 0);
  }, [notebookId, save]);

  const afterRevert = useCallback(
    (label: string) => {
      setSaveStatus(`Reverted to ${label}`);
      setDrafts({});
      void load();
      void reloadCheckpoints();
    },
    [load, reloadCheckpoints],
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (Object.keys(state.current.drafts).length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return {
    notebook,
    notFound,
    cells,
    role,
    canEdit,
    mode: canEdit ? mode : 'view',
    selection,
    selectedIndices,
    drafts,
    kernelStatus,
    connected,
    present,
    status,
    saveStatus,
    outage,
    checkpoints,
    conflictCellId,
    limits,
    lockedBy,
    announce,
    select,
    enterEdit,
    enterCommand,
    setDraft,
    insertCell,
    changeType,
    deleteCells,
    undoDelete,
    copyCells,
    cutCells,
    pasteCells,
    mergeCells,
    splitCell,
    moveCell,
    runCells,
    runAll,
    interrupt,
    restart,
    saveCheckpoint,
    exportNotebook,
    downloadOriginal,
    reloadLatest,
    keepMyVersion,
    flush,
    reloadCheckpoints,
    afterRevert,
  };
}
