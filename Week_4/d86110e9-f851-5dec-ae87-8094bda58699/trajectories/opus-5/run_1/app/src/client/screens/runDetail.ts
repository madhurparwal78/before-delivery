import { ApiFailure, api } from '../api';
import { canvasPanel, edgePath, kindLabel, nodeButton, portButton, type CanvasNode } from '../canvas';
import { h, prefersReducedMotion, replace } from '../dom';
import { formatInstant } from '../format';
import { notice } from '../regions';
import { navigate, type ScreenCtx } from '../router';
import { isWideViewport } from '../settings';
import { intercept } from '../shell';
import { setStreamHandlers } from '../stream';
import { actionButton, labelledInput, jsonGroup, openDialog, statusChip, VIEWER_REASON } from '../ui';
import type { RunDetail, RunStepRecord } from '../../shared/types';

function stepLog(step: RunStepRecord, returnFocus: () => HTMLElement | null): void {
  openDialog({
    name: `Step log: ${step.name}`,
    returnFocus,
    build: (close) =>
      h(
        'div',
        { class: 'dialog-body' },
        h('h2', { class: 'display display-small', text: `Step log: ${step.name}` }),
        h(
          'div',
          { role: 'group', 'aria-label': 'Status', class: 'json-group' },
          h('p', { class: 'group-label', text: 'Status' }),
          statusChip(step.status),
        ),
        jsonGroup('Input', step.input),
        jsonGroup('Output', step.output),
        h(
          'ul',
          { role: 'list', 'aria-label': 'Log', class: 'log-list' },
          ...step.log.map((line) => h('li', { class: 'log-line', text: line })),
        ),
        h(
          'div',
          { role: 'group', 'aria-label': 'Attempts', class: 'json-group' },
          h('p', { class: 'group-label', text: `Attempts: ${step.attempts}` }),
        ),
        h(
          'div',
          { role: 'group', 'aria-label': 'Timing', class: 'json-group' },
          h('p', { text: `Started: ${formatInstant(step.started_at)}` }),
          h('p', { text: `Finished: ${formatInstant(step.finished_at)}` }),
          step.due_at === null ? null : h('p', { text: `Due: ${formatInstant(step.due_at)}` }),
          step.retry_at === null ? null : h('p', { text: `Retry at: ${formatInstant(step.retry_at)}` }),
        ),
        h('button', { type: 'button', class: 'pill pill-secondary', text: 'Close', onclick: close }),
      ),
  });
}

function stepListItems(run: RunDetail): HTMLElement {
  const list = h('ol', { class: 'step-list', role: 'list', 'aria-label': 'Steps' });
  const buttons: HTMLButtonElement[] = [];
  run.steps.forEach((step, index) => {
    const button = h('button', { type: 'button', class: 'step-list-button', 'aria-label': step.name, text: step.name });
    const again = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(`.step-list-item[data-step-id="${step.id}"] button`);
    button.addEventListener('click', () => stepLog(step, again));
    button.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = index + (event.key === 'ArrowDown' ? 1 : -1);
        buttons[Math.min(buttons.length - 1, Math.max(0, next))].focus();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        stepLog(step, again);
      }
    });
    buttons.push(button);
    list.append(
      h(
        'li',
        {
          class: 'step-list-item',
          'data-step-id': step.id,
          'data-kind': step.kind,
          'data-col': String(step.col),
          'data-row': String(step.row),
          'data-status': step.status,
          'data-reused': step.reused ? 'true' : 'false',
          'data-anim': step.status === 'running' && !prefersReducedMotion() ? 'running' : 'none',
        },
        button,
        h('span', { class: 'row-meta', text: kindLabel(step.kind) }),
        statusChip(step.status),
      ),
    );
  });
  return list;
}

function runCanvas(run: RunDetail): HTMLElement {
  const { panel, surface, svg } = canvasPanel();
  const nodes: CanvasNode[] = run.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    name: step.name,
    col: step.col,
    row: step.row,
    status: step.status,
    reused: step.reused,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of run.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) continue;
    svg.append(edgePath(edge, from, to));
  }
  for (const node of nodes) {
    const button = nodeButton(node, { mode: 'run' });
    const again = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(`.step-node[data-step-id="${node.id}"]`);
    const open = (): void => {
      const step = run.steps.find((item) => item.id === node.id);
      if (step !== undefined) stepLog(step, again);
    };
    button.addEventListener('click', open);
    button.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        open();
      }
    });
    surface.append(button, portButton(node, null));
  }
  return panel;
}

export async function renderRunDetail(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const runId = ctx.params.rid;
  const reason = ctx.workspace?.role === 'viewer' ? VIEWER_REASON : null;
  let run = await api<RunDetail>('GET', `/api/workspaces/${workspaceId}/runs/${runId}`);

  const summary = h('section', { class: 'panel panel-light run-summary', role: 'region', 'aria-label': 'Run summary' });
  const actions = h('div', { class: 'actions-row' });
  const canvasHolder = h('div', { class: 'canvas-holder' });
  const listHolder = h('div', { class: 'list-holder' });

  const paint = (): void => {
    summary.setAttribute('data-run-id', run.id);
    summary.setAttribute('data-status', run.status);
    summary.setAttribute('data-test', run.test ? 'true' : 'false');
    summary.setAttribute('data-version', run.version === null ? '' : String(run.version));
    if (run.replay_of !== null) summary.setAttribute('data-replay-of', run.replay_of);
    replace(
      summary,
      h('h1', { class: 'display', text: `Run #${run.number} of ${run.automation_name}` }),
      statusChip(run.status),
      h('p', { class: 'row-meta', text: run.version === null ? 'Draft' : `Version ${run.version}` }),
      run.test ? h('span', { class: 'chip chip-test', text: 'Test' }) : null,
      h('p', { class: 'row-meta', text: `Started ${formatInstant(run.started_at)}` }),
      run.finished_at === null ? null : h('p', { class: 'row-meta', text: `Finished ${formatInstant(run.finished_at)}` }),
      run.message === null ? null : h('p', { class: 'run-message', text: run.message }),
      run.replay_of === null
        ? null
        : h('a', {
            class: 'link-action',
            href: `/w/${workspaceId}/runs/${run.replay_of}`,
            onclick: intercept,
            text: 'Original run',
          }),
    );

    replace(actions);
    const active = run.status === 'queued' || run.status === 'running' || run.status === 'waiting';
    const cancel = actionButton(
      'Cancel run',
      async () => {
        try {
          await api('POST', `/api/workspaces/${workspaceId}/runs/${run.id}/cancel`);
          await reload();
        } catch (error) {
          if (error instanceof ApiFailure) notice(error.message);
        }
      },
      { reason: reason ?? (active ? null : 'This run has finished') },
    );
    actions.append(cancel.element);

    if (run.status === 'failed') {
      const failedIndex = run.steps.findIndex((step) => step.id === run.failed_step);
      const choices = run.steps
        .filter((step, index) => step.status !== 'skipped' && (failedIndex < 0 || index <= failedIndex))
        .filter((step) => !insideLoop(run, step.id));
      const replayFrom = labelledInput('Replay from', 'select', {
        choices: choices.map((step) => step.name),
        disabled: reason,
      });
      const replay = actionButton(
        'Replay',
        async () => {
          const chosen = choices.find(
            (step) => step.name === (replayFrom.input as HTMLSelectElement).value,
          );
          try {
            const started = await api<{ run_id: string }>(
              'POST',
              `/api/workspaces/${workspaceId}/runs/${run.id}/replay`,
              { from_step: chosen?.id ?? 'trigger' },
            );
            navigate(`/w/${workspaceId}/runs/${started.run_id}`);
          } catch (error) {
            if (error instanceof ApiFailure) notice(error.message);
          }
        },
        { variant: 'primary', reason },
      );
      actions.append(replayFrom.wrapper, replay.element);
    }

    replace(canvasHolder, isWideViewport() ? runCanvas(run) : null);
    replace(listHolder, stepListItems(run));
  };

  const reload = async (): Promise<void> => {
    run = await api<RunDetail>('GET', `/api/workspaces/${workspaceId}/runs/${runId}`);
    paint();
  };

  setStreamHandlers({
    run: (event) => {
      if (event.run.id === runId) void reload();
    },
    reconnect: () => void reload(),
  });

  paint();

  return h(
    'section',
    { class: 'screen-section run-detail' },
    h('div', { class: 'run-detail-left' }, summary, actions, listHolder),
    canvasHolder,
  );
}

function insideLoop(run: RunDetail, stepId: string): boolean {
  const loops = run.steps.filter((step) => step.kind === 'loop');
  const reachable = (from: string, target: string, seen: Set<string>): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return run.edges.filter((edge) => edge.from === from).some((edge) => reachable(edge.to, target, seen));
  };
  return loops.some((loop) =>
    run.edges
      .filter((edge) => edge.from === loop.id && edge.port === 'each')
      .some((edge) => reachable(edge.to, stepId, new Set())),
  );
}
