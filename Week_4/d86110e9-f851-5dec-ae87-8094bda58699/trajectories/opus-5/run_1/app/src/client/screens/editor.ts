import { ApiFailure, api, apiDownload } from '../api';
import {
  CELL,
  GRID_COLUMNS,
  GRID_ROWS,
  canvasPanel,
  edgePath,
  kindLabel,
  nodeButton,
  nodeLeft,
  nodeTop,
  portButton,
  runToken,
  type CanvasNode,
} from '../canvas';
import { TOOLBAR_KINDS } from '../choices';
import { h, prefersReducedMotion, replace } from '../dom';
import { draftNotice, makeDraftRegion, notice, showAlert } from '../regions';
import { currentSession, type ScreenCtx } from '../router';
import { isWideViewport } from '../settings';
import { intercept } from '../shell';
import { setStreamHandlers } from '../stream';
import { openStepPanel, type TableChoice } from '../stepPanel';
import { actionButton, labelledInput, statusChip, VIEWER_REASON, withReason } from '../ui';
import {
  PORTS,
  type AutomationDetail,
  type Edge,
  type JsonObject,
  type RunDetail,
  type RunListItem,
  type StepNode,
} from '../../shared/types';

interface TokenInfo {
  runId: string;
  version: number | null;
  stepId: string;
}

interface UndoAction {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

type FocusTarget = { kind: 'cursor' } | { kind: 'step'; id: string } | { kind: 'edge'; id: string };

const DRAFT_SAVED = 'Draft saved. Not live until you publish.';

export async function renderEditor(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const automationId = ctx.params.aid;
  const viewer = ctx.workspace?.role === 'viewer';
  const reason = viewer ? VIEWER_REASON : null;
  const base = `/api/workspaces/${workspaceId}/automations/${automationId}`;

  let automation = await api<AutomationDetail>('GET', base);
  const tables = (await api<{ tables: TableChoice[] }>('GET', `/api/workspaces/${workspaceId}/tables`)).tables;

  let cursor = { col: 2, row: 2 };
  let focusState: FocusTarget = { kind: 'cursor' };
  let pendingFocus: FocusTarget | null = null;
  let edgeDraft: { from: string; portIndex: number; target: string | null } | null = null;
  let freshEdges = new Set<string>();
  let tokens: TokenInfo[] = [];
  let ghosts: { version: number; nodes: CanvasNode[]; edges: Edge[] }[] = [];
  let shownVersion: number | null = automation.live_version;
  const undoStack: UndoAction[] = [];
  const redoStack: UndoAction[] = [];

  const header = h('div', { class: 'editor-header' });
  const drainGroup = h('div', { role: 'group', 'aria-label': 'Version drain', class: 'version-drain' });
  const actionsRow = h('div', { class: 'actions-row editor-actions' });
  const runLinkHolder = h('span', { class: 'run-link-holder' });
  const toolbar = h('div', { role: 'toolbar', 'aria-label': 'Step kinds', class: 'kind-toolbar' });
  const canvasHolder = h('div', { class: 'canvas-holder' });
  const draftRegion = makeDraftRegion();

  let chain: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void> | void): void => {
    chain = chain.then(() => work()).catch(() => undefined);
  };

  const nodesOf = (detail: AutomationDetail): CanvasNode[] => [
    {
      id: 'trigger',
      kind: detail.trigger.kind,
      name: detail.trigger.name,
      col: detail.trigger.col,
      row: detail.trigger.row,
    },
    ...detail.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      name: step.name,
      col: step.col,
      row: step.row,
    })),
  ];

  const nodeById = (id: string): CanvasNode | undefined => nodesOf(automation).find((node) => node.id === id);

  const executionOrder = (): string[] => {
    const order: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      const node = nodeById(id);
      if (node === undefined) return;
      for (const port of PORTS[node.kind]) {
        for (const edge of automation.edges
          .filter((item) => item.from === id && item.port === port)
          .sort((a, b) => a.order - b.order)) {
          walk(edge.to);
        }
      }
    };
    walk('trigger');
    const rest = automation.steps
      .filter((step) => !seen.has(step.id))
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    return [...order, ...rest.map((step) => step.id)];
  };

  const cellTaken = (col: number, row: number, exceptId?: string): boolean =>
    nodesOf(automation).some((node) => node.col === col && node.row === row && node.id !== exceptId);

  async function refetch(): Promise<void> {
    const before = new Set(automation.edges.map((edge) => edge.id));
    automation = await api<AutomationDetail>('GET', base);
    for (const edge of automation.edges) if (!before.has(edge.id)) freshEdges.add(edge.id);
    paint();
  }

  function handleDraftFailure(error: ApiFailure): void {
    draftNotice('refusal', error.message);
    const held = error.step as StepNode | undefined;
    if (held !== undefined && held !== null) {
      automation = { ...automation, steps: automation.steps.map((step) => (step.id === held.id ? held : step)) };
      paint();
    }
  }

  function savedNotice(): void {
    draftNotice('refusal', null);
    draftNotice('saved', DRAFT_SAVED);
  }

  async function saveStep(stepId: string, body: JsonObject): Promise<void> {
    try {
      await api('PUT', `${base}/draft/steps/${stepId}`, body);
      savedNotice();
      await refetch();
    } catch (error) {
      if (error instanceof ApiFailure) handleDraftFailure(error);
    }
  }

  const panelContext = {
    tables,
    reason,
    saveFields: (stepId: string, fields: JsonObject) => saveStep(stepId, { fields }),
    saveName: (stepId: string, name: string) => saveStep(stepId, { name }),
    saveSample: (stepId: string, raw: string) => {
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = raw;
      }
      return saveStep(stepId, { sample: parsed as JsonObject });
    },
    fieldValue: (stepId: string, key: string) => automation.steps.find((step) => step.id === stepId)?.fields[key],
  };

  function openPanel(id: string): void {
    const node = id === 'trigger' ? automation.trigger : automation.steps.find((step) => step.id === id);
    if (node === undefined) return;
    focusState = { kind: 'step', id };
    openStepPanel({ ...panelContext, automation }, node, () => {
      focusState = { kind: 'step', id };
      return (
        canvasHolder.querySelector<HTMLElement>(`.step-node[data-step-id="${id}"]`) ??
        canvasHolder.querySelector<HTMLElement>(`.step-list-item[data-step-id="${id}"] button`)
      );
    });
  }

  async function addStep(kind: string, col: number, row: number): Promise<void> {
    if (viewer) return;
    try {
      const step = await api<StepNode>('POST', `${base}/draft/steps`, { kind, col, row });
      cursor = { col, row };
      focusState = { kind: 'step', id: step.id };
      pendingFocus = focusState;
      savedNotice();
      undoStack.push({
        undo: async () => {
          await api('DELETE', `${base}/draft/steps/${step.id}`);
          cursor = { col: step.col, row: step.row };
          focusState = { kind: 'cursor' };
          pendingFocus = focusState;
          await refetch();
        },
        redo: async () => {
          await api('POST', `${base}/draft/steps`, { kind, col, row, id: step.id });
          await api('PUT', `${base}/draft/steps/${step.id}`, { name: step.name, fields: step.fields });
          focusState = { kind: 'step', id: step.id };
          pendingFocus = focusState;
          await refetch();
        },
      });
      redoStack.length = 0;
      await refetch();
    } catch (error) {
      if (error instanceof ApiFailure) draftNotice('refusal', error.message);
    }
  }

  async function moveStep(id: string, col: number, row: number): Promise<void> {
    const node = nodeById(id);
    if (node === undefined || viewer) return;
    const from = { col: node.col, row: node.row };
    automation = applyPosition(id, col, row);
    cursor = { col, row };
    focusState = { kind: 'step', id };
    pendingFocus = focusState;
    paint();
    try {
      await api('PUT', `${base}/draft/steps/${id}`, { col, row });
      savedNotice();
      undoStack.push({
        undo: async () => {
          automation = applyPosition(id, from.col, from.row);
          await api('PUT', `${base}/draft/steps/${id}`, { col: from.col, row: from.row });
          focusState = { kind: 'step', id };
          pendingFocus = focusState;
          await refetch();
        },
        redo: async () => {
          automation = applyPosition(id, col, row);
          await api('PUT', `${base}/draft/steps/${id}`, { col, row });
          focusState = { kind: 'step', id };
          pendingFocus = focusState;
          await refetch();
        },
      });
      redoStack.length = 0;
    } catch (error) {
      automation = applyPosition(id, from.col, from.row);
      if (error instanceof ApiFailure) draftNotice('refusal', error.message);
      pendingFocus = { kind: 'step', id };
      paint();
    }
  }

  function applyPosition(id: string, col: number, row: number): AutomationDetail {
    if (id === 'trigger') return { ...automation, trigger: { ...automation.trigger, col, row } };
    return {
      ...automation,
      steps: automation.steps.map((step) => (step.id === id ? { ...step, col, row } : step)),
    };
  }

  async function deleteStep(id: string): Promise<void> {
    const step = automation.steps.find((item) => item.id === id);
    if (step === undefined || viewer) return;
    const edges = automation.edges.filter((edge) => edge.from === id || edge.to === id);
    try {
      await api('DELETE', `${base}/draft/steps/${id}`);
      cursor = { col: step.col, row: step.row };
      focusState = { kind: 'cursor' };
      pendingFocus = focusState;
      savedNotice();
      undoStack.push({
        undo: async () => {
          await api('POST', `${base}/draft/steps`, { kind: step.kind, col: step.col, row: step.row, id: step.id });
          await api('PUT', `${base}/draft/steps/${step.id}`, { name: step.name, fields: step.fields });
          for (const edge of edges) {
            await api('POST', `${base}/draft/edges`, { from: edge.from, port: edge.port, to: edge.to });
          }
          focusState = { kind: 'step', id: step.id };
          pendingFocus = focusState;
          await refetch();
        },
        redo: async () => {
          await api('DELETE', `${base}/draft/steps/${step.id}`);
          focusState = { kind: 'cursor' };
          pendingFocus = focusState;
          await refetch();
        },
      });
      redoStack.length = 0;
      await refetch();
    } catch (error) {
      if (error instanceof ApiFailure) draftNotice('refusal', error.message);
    }
  }

  async function addEdge(from: string, port: string, to: string): Promise<void> {
    if (viewer) return;
    try {
      const edge = await api<Edge>('POST', `${base}/draft/edges`, { from, port, to });
      freshEdges.add(edge.id);
      savedNotice();
      focusState = { kind: 'step', id: to };
      pendingFocus = focusState;
      undoStack.push({
        undo: async () => {
          await api('DELETE', `${base}/draft/edges/${edge.id}`);
          focusState = { kind: 'step', id: from };
          pendingFocus = focusState;
          await refetch();
        },
        redo: async () => {
          await addEdge(from, port, to);
        },
      });
      redoStack.length = 0;
      await refetch();
    } catch (error) {
      if (error instanceof ApiFailure) draftNotice('refusal', error.message);
      focusState = { kind: 'step', id: from };
      pendingFocus = focusState;
      paint();
    }
  }

  async function deleteEdge(edgeId: string): Promise<void> {
    const edge = automation.edges.find((item) => item.id === edgeId);
    if (edge === undefined || viewer) return;
    await api('DELETE', `${base}/draft/edges/${edgeId}`);
    savedNotice();
    focusState = { kind: 'step', id: edge.from };
    pendingFocus = focusState;
    undoStack.push({
      undo: async () => {
        await addEdge(edge.from, edge.port, edge.to);
      },
      redo: async () => {
        const again = automation.edges.find(
          (item) => item.from === edge.from && item.port === edge.port && item.to === edge.to,
        );
        if (again !== undefined) await deleteEdge(again.id);
      },
    });
    redoStack.length = 0;
    await refetch();
  }

  function startEdge(from: string): void {
    const node = nodeById(from);
    if (node === undefined) return;
    const ports = PORTS[node.kind];
    edgeDraft =
      edgeDraft !== null && edgeDraft.from === from
        ? { from, portIndex: (edgeDraft.portIndex + 1) % ports.length, target: edgeDraft.target }
        : { from, portIndex: 0, target: null };
    draftNotice(
      'edge',
      `Drawing an edge from ${node.name} (${ports[edgeDraft.portIndex]}). Choose a target and press Enter.`,
    );
    focusState = { kind: 'step', id: from };
    pendingFocus = focusState;
    paint();
  }

  function cancelEdge(): void {
    const from = edgeDraft?.from ?? null;
    edgeDraft = null;
    draftNotice('edge', null);
    if (from !== null) {
      focusState = { kind: 'step', id: from };
      pendingFocus = focusState;
    }
    paint();
  }

  function cellFromPointer(clientX: number, clientY: number, surface: HTMLElement): { col: number; row: number } {
    const rect = surface.getBoundingClientRect();
    const col = Math.min(GRID_COLUMNS, Math.max(1, Math.floor((clientX - rect.left) / CELL) + 1));
    const row = Math.min(GRID_ROWS, Math.max(1, Math.floor((clientY - rect.top) / CELL) + 1));
    return { col, row };
  }

  function paintDrain(animateFrom: number | null): void {
    const numeral = h('span', { class: 'version-numeral' });
    if (automation.live_version === null) {
      numeral.append(h('span', { class: 'numeral-text', text: 'No version' }));
    } else {
      numeral.setAttribute('aria-label', `v${automation.live_version}`);
      numeral.append(h('span', { class: 'numeral-text', text: 'v' }));
      String(automation.live_version)
        .split('')
        .forEach((digit, index) => {
          const span = h('span', { class: 'numeral-digit', text: digit });
          if (animateFrom !== null && animateFrom !== automation.live_version && !prefersReducedMotion()) {
            span.classList.add('digit-step');
            span.style.animationDelay = `${index * 30}ms`;
          }
          numeral.append(span);
        });
    }
    replace(
      drainGroup,
      numeral,
      h('span', { class: 'drain-count', text: `Runs left on older versions: ${automation.drain_count}` }),
    );
    drainGroup.setAttribute(
      'data-live-version',
      automation.live_version === null ? '' : String(automation.live_version),
    );
    drainGroup.setAttribute('data-drain-count', String(automation.drain_count));
    shownVersion = automation.live_version;
  }

  function showRunLink(runId: string, number: number): void {
    replace(
      runLinkHolder,
      h('a', {
        class: 'link-action',
        href: `/w/${workspaceId}/runs/${runId}`,
        onclick: intercept,
        text: `View run #${number}`,
      }),
    );
  }

  function paintActions(): void {
    const testRun = actionButton(
      'Test run',
      async () => {
        try {
          const started = await api<{ run_id: string; number: number }>('POST', `${base}/runs`, { test: true });
          showRunLink(started.run_id, started.number);
        } catch (error) {
          if (error instanceof ApiFailure) notice(error.message);
        }
      },
      { reason },
    );
    const publish = actionButton(
      'Publish',
      async () => {
        const previous = automation.live_version;
        try {
          await api('POST', `${base}/publish`);
          draftNotice('refusal', null);
          automation = await api<AutomationDetail>('GET', base);
          paintDrain(previous);
          paint();
          await refreshTokens();
        } catch (error) {
          if (error instanceof ApiFailure) {
            draftNotice('refusal', error.message);
            if (error.stepId !== null) {
              focusState = { kind: 'step', id: error.stepId };
              pendingFocus = focusState;
              paint();
            }
          }
        }
      },
      { variant: 'primary', reason },
    );
    const exportReason = reason ?? (automation.live_version === null ? 'Publish a version before exporting' : null);
    const exportButton = actionButton(
      'Export live version',
      async () => {
        notice('Saving export...');
        try {
          const file = await apiDownload(`${base}/versions/${automation.live_version ?? 1}/export`);
          const url = URL.createObjectURL(file.bytes);
          const link = h('a', { href: url, download: file.filename });
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          notice('Export saved');
        } catch (error) {
          if (error instanceof ApiFailure) {
            if (error.status === 503) showAlert('Storage is unavailable. Nothing was saved.');
            else notice(error.message);
          }
        }
      },
      { reason: exportReason },
    );
    replace(actionsRow, testRun.element);
    if (automation.trigger_kind === 'manual') {
      const input = labelledInput('Run input (JSON)', 'text', { value: '{}', disabled: reason });
      const runNow = actionButton(
        'Run now',
        async () => {
          let parsed: unknown = {};
          try {
            parsed = JSON.parse(input.input.value === '' ? '{}' : input.input.value) as unknown;
          } catch {
            parsed = input.input.value;
          }
          try {
            const started = await api<{ run_id: string; number: number }>('POST', `${base}/runs`, { input: parsed });
            showRunLink(started.run_id, started.number);
          } catch (error) {
            if (error instanceof ApiFailure) notice(error.message);
          }
        },
        { reason },
      );
      actionsRow.append(input.wrapper, runNow.element);
    }
    actionsRow.append(
      publish.element,
      exportButton.element,
      h('a', {
        class: 'link-action',
        href: `/w/${workspaceId}/runs?automation=${automationId}`,
        onclick: intercept,
        text: 'View runs',
      }),
      runLinkHolder,
    );
  }

  function paintToolbar(): void {
    replace(
      toolbar,
      ...TOOLBAR_KINDS.map((entry) => {
        const button = h('button', { type: 'button', class: 'pill pill-secondary kind-button', text: entry.label });
        let drag: { x: number; y: number; moved: boolean } | null = null;
        let suppressClick = false;
        button.addEventListener('mousedown', (event: MouseEvent) => {
          if (viewer) return;
          drag = { x: event.clientX, y: event.clientY, moved: false };
        });
        document.addEventListener('mousemove', (event: MouseEvent) => {
          if (drag === null) return;
          if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 6) drag.moved = true;
        });
        document.addEventListener('mouseup', (event: MouseEvent) => {
          if (drag === null) return;
          const moved = drag.moved;
          drag = null;
          if (!moved) return;
          suppressClick = true;
          const surface = canvasHolder.querySelector<HTMLElement>('.canvas-surface');
          if (surface === null) return;
          const rect = surface.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            return;
          }
          const cell = cellFromPointer(event.clientX, event.clientY, surface);
          enqueue(() => addStep(entry.kind, cell.col, cell.row));
        });
        button.addEventListener('click', () => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          enqueue(() => addStep(entry.kind, cursor.col, cursor.row));
        });
        return withReason(button, reason);
      }),
    );
  }

  function moveCursor(deltaCol: number, deltaRow: number): void {
    cursor = {
      col: Math.min(GRID_COLUMNS, Math.max(1, cursor.col + deltaCol)),
      row: Math.min(GRID_ROWS, Math.max(1, cursor.row + deltaRow)),
    };
    focusState = { kind: 'cursor' };
    const element = canvasHolder.querySelector<HTMLElement>('.grid-cursor');
    if (element === null) return;
    element.setAttribute('data-col', String(cursor.col));
    element.setAttribute('data-row', String(cursor.row));
    element.style.left = `${nodeLeft(cursor.col) - 8}px`;
    element.style.top = `${nodeTop(cursor.row) - 8}px`;
    element.focus();
  }

  function focusElement(target: FocusTarget): void {
    if (target.kind === 'cursor') {
      canvasHolder.querySelector<HTMLElement>('.grid-cursor')?.focus();
      return;
    }
    if (target.kind === 'step') {
      const node = canvasHolder.querySelector<HTMLElement>(`.step-node[data-step-id="${target.id}"]`);
      if (node !== null) {
        node.focus();
        return;
      }
      canvasHolder
        .querySelector<HTMLElement>(`.step-list-item[data-step-id="${target.id}"] button`)
        ?.focus();
      return;
    }
    canvasHolder.querySelector<SVGElement & { focus: () => void }>(`[data-edge-id="${target.id}"]`)?.focus();
  }

  function candidateTargets(): string[] {
    return executionOrder().filter((id) => id !== edgeDraft?.from && id !== 'trigger');
  }

  function nearestInDirection(key: string, fromId: string, candidates: string[]): string {
    const from = nodeById(fromId);
    if (from === undefined) return candidates[0];
    const scored = candidates
      .map((id) => nodeById(id))
      .filter((node): node is CanvasNode => node !== undefined)
      .filter((node) => {
        if (key === 'ArrowRight') return node.col > from.col;
        if (key === 'ArrowLeft') return node.col < from.col;
        if (key === 'ArrowDown') return node.row > from.row;
        return node.row < from.row;
      })
      .sort(
        (a, b) =>
          Math.abs(a.col - from.col) +
          Math.abs(a.row - from.row) -
          (Math.abs(b.col - from.col) + Math.abs(b.row - from.row)),
      );
    return scored[0]?.id ?? candidates[0];
  }

  function onCanvasKey(event: KeyboardEvent): void {
    const key = event.key;
    const state = focusState;
    const stepId = state.kind === 'step' ? state.id : null;
    const edgeId = state.kind === 'edge' ? state.id : null;

    if (edgeDraft !== null) {
      if (key === 'Escape') {
        event.preventDefault();
        cancelEdge();
        return;
      }
      if (key === 'Tab' || key.startsWith('Arrow')) {
        event.preventDefault();
        const candidates = candidateTargets();
        if (candidates.length === 0) return;
        if (key === 'Tab') {
          const index = edgeDraft.target === null ? -1 : candidates.indexOf(edgeDraft.target);
          edgeDraft.target = candidates[(index + 1) % candidates.length];
        } else {
          edgeDraft.target = nearestInDirection(key, edgeDraft.target ?? edgeDraft.from, candidates);
        }
        focusState = { kind: 'step', id: edgeDraft.target };
        pendingFocus = focusState;
        paint();
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        const node = nodeById(edgeDraft.from);
        const target = edgeDraft.target;
        if (node === undefined || target === null) return;
        const port = PORTS[node.kind][edgeDraft.portIndex];
        const from = edgeDraft.from;
        edgeDraft = null;
        draftNotice('edge', null);
        enqueue(() => addEdge(from, port, target));
        return;
      }
      if (key.toLowerCase() === 'c' && stepId !== null && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        startEdge(stepId);
        return;
      }
    }

    if (key === 'Tab') return;

    if (key.startsWith('Arrow')) {
      const delta = {
        ArrowUp: { col: 0, row: -1 },
        ArrowDown: { col: 0, row: 1 },
        ArrowLeft: { col: -1, row: 0 },
        ArrowRight: { col: 1, row: 0 },
      }[key];
      if (delta === undefined) return;
      event.preventDefault();
      if (stepId !== null) {
        const node = nodeById(stepId);
        if (node === undefined) return;
        const col = Math.min(GRID_COLUMNS, Math.max(1, node.col + delta.col));
        const row = Math.min(GRID_ROWS, Math.max(1, node.row + delta.row));
        if (col === node.col && row === node.row) return;
        if (cellTaken(col, row, stepId)) {
          draftNotice('refusal', 'That cell is already taken');
          return;
        }
        enqueue(() => moveStep(stepId, col, row));
        return;
      }
      if (state.kind === 'cursor') moveCursor(delta.col, delta.row);
      return;
    }

    if (key === 'Enter' && stepId !== null) {
      event.preventDefault();
      openPanel(stepId);
      return;
    }

    if (key === 'Escape' && stepId !== null) {
      event.preventDefault();
      const node = nodeById(stepId);
      if (node === undefined) return;
      cursor = { col: node.col, row: node.row };
      focusState = { kind: 'cursor' };
      pendingFocus = focusState;
      paint();
      return;
    }

    if (key === 'Delete') {
      if (edgeId !== null) {
        event.preventDefault();
        enqueue(() => deleteEdge(edgeId));
        return;
      }
      if (stepId !== null && stepId !== 'trigger') {
        event.preventDefault();
        enqueue(() => deleteStep(stepId));
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      event.preventDefault();
      enqueue(async () => {
        const action = undoStack.pop();
        if (action === undefined) return;
        redoStack.push(action);
        await action.undo();
      });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') {
      event.preventDefault();
      enqueue(async () => {
        const action = redoStack.pop();
        if (action === undefined) return;
        undoStack.push(action);
        await action.redo();
      });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (key === '.' && stepId !== null) {
      event.preventDefault();
      const outgoing = automation.edges.filter((edge) => edge.from === stepId);
      if (outgoing.length === 0) return;
      const index = outgoing.findIndex((edge) => edge.id === edgeId);
      const next = outgoing[(index + 1) % outgoing.length];
      focusState = { kind: 'edge', id: next.id };
      focusElement(focusState);
      return;
    }

    if (key.toLowerCase() === 'c' && stepId !== null) {
      event.preventDefault();
      startEdge(stepId);
      return;
    }

    const entry = TOOLBAR_KINDS.find((item) => item.key === key.toLowerCase());
    if (entry !== undefined) {
      event.preventDefault();
      enqueue(() => addStep(entry.kind, cursor.col, cursor.row));
    }
  }

  function attachNodePointer(button: HTMLButtonElement, node: CanvasNode, surface: HTMLElement): void {
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const move = (event: MouseEvent): void => {
      if (drag === null || viewer) return;
      if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 6) {
        drag.moved = true;
        button.classList.add('dragging');
        button.style.left = `${nodeLeft(node.col) + (event.clientX - drag.x)}px`;
        button.style.top = `${nodeTop(node.row) + (event.clientY - drag.y)}px`;
      }
    };
    const up = (event: MouseEvent): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (drag === null) return;
      const moved = drag.moved;
      drag = null;
      if (!moved) {
        focusState = { kind: 'step', id: node.id };
        button.focus();
        openPanel(node.id);
        return;
      }
      const cell = cellFromPointer(event.clientX, event.clientY, surface);
      if (cell.col === node.col && cell.row === node.row) {
        paint();
        return;
      }
      enqueue(() => moveStep(node.id, cell.col, cell.row));
    };
    button.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      focusState = { kind: 'step', id: node.id };
      button.focus();
      drag = { x: event.clientX, y: event.clientY, moved: false };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function attachPortPointer(port: HTMLButtonElement, node: CanvasNode, portName: string): HTMLButtonElement {
    port.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (viewer) return;
      const up = (upEvent: MouseEvent): void => {
        document.removeEventListener('mouseup', up);
        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const holder = element?.closest<HTMLElement>('.port-input');
        const targetId = holder?.getAttribute('data-step-id') ?? null;
        if (targetId === null || targetId === node.id) return;
        enqueue(() => addEdge(node.id, portName, targetId));
      };
      document.addEventListener('mouseup', up);
    });
    return port;
  }

  function buildCanvas(): { panel: HTMLElement; surface: HTMLElement } {
    const { panel, surface, svg } = canvasPanel();
    const nodes = nodesOf(automation);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    for (const ghost of ghosts) {
      const ghostById = new Map(ghost.nodes.map((node) => [node.id, node]));
      for (const edge of ghost.edges) {
        const from = ghostById.get(edge.from);
        const to = ghostById.get(edge.to);
        if (from === undefined || to === undefined) continue;
        svg.append(edgePath(edge, from, to, { ghost: { version: ghost.version } }));
      }
    }

    for (const edge of automation.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (from === undefined || to === undefined) continue;
      svg.append(
        edgePath(edge, from, to, {
          animate: freshEdges.has(edge.id),
          onActivate: (edgeId) => {
            focusState = { kind: 'edge', id: edgeId };
          },
        }),
      );
    }
    freshEdges = new Set();

    const cursorElement = h('div', {
      role: 'group',
      'aria-label': 'Grid cursor',
      class: 'grid-cursor',
      tabIndex: 0,
      'data-col': String(cursor.col),
      'data-row': String(cursor.row),
    });
    cursorElement.style.left = `${nodeLeft(cursor.col) - 8}px`;
    cursorElement.style.top = `${nodeTop(cursor.row) - 8}px`;
    cursorElement.addEventListener('focus', () => {
      focusState = { kind: 'cursor' };
    });
    surface.append(cursorElement);

    for (const id of executionOrder()) {
      const node = byId.get(id);
      if (node === undefined) continue;
      const button = nodeButton(node, { mode: 'editor' });
      if (edgeDraft !== null && edgeDraft.target === node.id) button.classList.add('edge-target');
      button.addEventListener('focus', () => {
        focusState = { kind: 'step', id: node.id };
      });
      attachNodePointer(button, node, surface);
      surface.append(button);
      for (const port of PORTS[node.kind]) {
        surface.append(attachPortPointer(portButton(node, port), node, port));
      }
      surface.append(portButton(node, null));
    }

    for (const token of tokens) {
      const node = byId.get(token.stepId);
      if (node === undefined) continue;
      surface.append(runToken(token.runId, token.version, token.stepId, node));
    }

    panel.addEventListener('keydown', onCanvasKey);
    return { panel, surface };
  }

  function buildStepList(): HTMLElement {
    const list = h('ol', { class: 'step-list', role: 'list', 'aria-label': 'Steps' });
    for (const id of executionOrder()) {
      const node = nodeById(id);
      if (node === undefined) continue;
      const button = h('button', {
        type: 'button',
        class: 'step-list-button',
        'aria-label': node.name,
        text: node.name,
      });
      button.addEventListener('click', () => openPanel(node.id));
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          openPanel(node.id);
        }
      });
      list.append(
        h(
          'li',
          {
            class: 'step-list-item',
            'data-step-id': node.id,
            'data-kind': node.kind,
            'data-col': String(node.col),
            'data-row': String(node.row),
            'data-anim': 'none',
          },
          button,
          h('span', { class: 'row-meta', text: kindLabel(node.kind) }),
          statusChip('draft'),
        ),
      );
    }
    return list;
  }

  function paint(): void {
    if (shownVersion !== automation.live_version) paintDrain(shownVersion);
    else {
      drainGroup.setAttribute('data-drain-count', String(automation.drain_count));
      const counter = drainGroup.querySelector('.drain-count');
      if (counter !== null) counter.textContent = `Runs left on older versions: ${automation.drain_count}`;
    }
    const hadFocus = canvasHolder.contains(document.activeElement);
    if (isWideViewport()) replace(canvasHolder, buildCanvas().panel);
    else replace(canvasHolder, buildStepList());
    const target = pendingFocus ?? (hadFocus ? focusState : null);
    pendingFocus = null;
    if (target !== null) focusElement(target);
  }

  async function refreshTokens(): Promise<void> {
    const { runs } = await api<{ runs: RunListItem[] }>(
      'GET',
      `/api/workspaces/${workspaceId}/runs?automation=${automationId}`,
    );
    const live = runs.filter(
      (run) => !run.test && (run.status === 'queued' || run.status === 'running' || run.status === 'waiting'),
    );
    const next: TokenInfo[] = [];
    const ghostVersions = new Set<number>();
    for (const run of live) {
      const detail = await api<RunDetail>('GET', `/api/workspaces/${workspaceId}/runs/${run.id}`);
      const at =
        detail.steps.find(
          (step) => step.status === 'running' || step.status === 'waiting' || step.status === 'retrying',
        ) ?? [...detail.steps].reverse().find((step) => step.status === 'succeeded');
      if (at !== undefined) next.push({ runId: run.id, version: run.version, stepId: at.id });
      if (run.version !== null && automation.live_version !== null && run.version < automation.live_version) {
        ghostVersions.add(run.version);
      }
    }
    tokens = next;
    const nextGhosts: typeof ghosts = [];
    for (const version of ghostVersions) {
      const content = await api<AutomationDetail>('GET', `${base}/versions/${version}`);
      nextGhosts.push({ version, nodes: nodesOf(content), edges: content.edges });
    }
    ghosts = nextGhosts;
    paint();
  }

  setStreamHandlers({
    draft: (event) => {
      if (event.automation_id !== automationId) return;
      enqueue(async () => {
        if (event.revision <= automation.revision) return;
        await refetch();
      });
    },
    presence: (event) => {
      if (event.automation_id !== automationId) return;
      const me = currentSession()?.id;
      const others = event.members.filter((member) => member.id !== me);
      draftNotice(
        'presence',
        others.length === 0 ? null : others.map((member) => `${member.name} is also editing this draft`).join(' '),
      );
    },
    version: (event) => {
      if (event.automation_id !== automationId) return;
      enqueue(async () => {
        const previous = automation.live_version;
        automation = await api<AutomationDetail>('GET', base);
        if (previous !== automation.live_version) paintDrain(previous);
        paint();
        await refreshTokens();
      });
    },
    drain: (event) => {
      if (event.automation_id !== automationId) return;
      automation = { ...automation, drain_count: event.count };
      if (event.count === 0) ghosts = [];
      paint();
    },
    run: () => {
      enqueue(() => refreshTokens());
    },
    reconnect: () => {
      enqueue(() => refetch());
    },
  });

  replace(header, h('h1', { class: 'display', text: automation.name }), drainGroup, actionsRow);
  paintDrain(null);
  paintActions();
  paintToolbar();
  paint();
  enqueue(() => refreshTokens());

  if (new URLSearchParams(window.location.search).get('imported') === '1') {
    draftNotice('saved', 'Import saved. This is a draft.');
  }

  return h(
    'section',
    { class: 'screen-section editor-screen' },
    header,
    draftRegion,
    h('div', { class: 'editor-body' }, isWideViewport() ? toolbar : null, canvasHolder),
  );
}
