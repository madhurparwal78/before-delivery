import { api } from '../api';
import { h, replace } from '../dom';
import { formatInstant } from '../format';
import { makeResultsRegion, runListResults } from '../regions';
import { intercept } from '../shell';
import { setStreamHandlers } from '../stream';
import { labelledInput, statusChip } from '../ui';
import type { ScreenCtx } from '../router';
import type { AutomationListItem, RunListItem } from '../../shared/types';

const STATUS_CHOICES = ['All', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'];

function runRow(workspaceId: string, run: RunListItem): HTMLElement {
  const item = h(
    'li',
    {
      class: 'row-item run-row',
      'data-run-id': run.id,
      'data-status': run.status,
      'data-test': run.test ? 'true' : 'false',
      'data-version': run.version === null ? '' : String(run.version),
    },
    h('a', {
      class: 'row-title',
      href: `/w/${workspaceId}/runs/${run.id}`,
      onclick: intercept,
      text: `Run #${run.number} of ${run.automation_name}`,
    }),
    statusChip(run.status),
    h('span', { class: 'row-meta', text: `Started ${formatInstant(run.started_at)}` }),
    h('span', { class: 'row-meta', text: run.version === null ? 'Draft' : `Version ${run.version}` }),
    run.test ? h('span', { class: 'chip chip-test', text: 'Test' }) : null,
  );
  if (run.replay_of !== null) item.setAttribute('data-replay-of', run.replay_of);
  return item;
}

export async function renderRuns(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const query = new URLSearchParams(window.location.search);
  const { automations } = await api<{ automations: AutomationListItem[] }>(
    'GET',
    `/api/workspaces/${workspaceId}/automations`,
  );
  const statusField = labelledInput('Status', 'select', { choices: STATUS_CHOICES, value: query.get('status') ?? 'All' });
  const automationNames = ['All automations', ...automations.map((automation) => automation.name)];
  const preselected = automations.find((automation) => automation.id === query.get('automation'));
  const automationField = labelledInput('Automation', 'select', {
    choices: automationNames,
    value: preselected === undefined ? 'All automations' : preselected.name,
  });
  const testBox = h('input', { type: 'checkbox', class: 'checkbox', 'aria-label': 'Show test runs' });
  const list = h('ul', { class: 'row-list', role: 'list', 'aria-label': 'Runs' });
  const results = makeResultsRegion();

  const load = async (): Promise<void> => {
    const params = new URLSearchParams();
    const status = (statusField.input as HTMLSelectElement).value;
    if (status !== 'All') params.set('status', status);
    const automationName = (automationField.input as HTMLSelectElement).value;
    const chosen = automations.find((automation) => automation.name === automationName);
    if (chosen !== undefined) params.set('automation', chosen.id);
    if (testBox.checked) params.set('test', 'true');
    const { runs } = await api<{ runs: RunListItem[] }>(
      'GET',
      `/api/workspaces/${workspaceId}/runs?${params.toString()}`,
    );
    replace(list, ...runs.map((run) => runRow(workspaceId, run)));
    runListResults(runs.length);
  };

  statusField.input.addEventListener('change', () => void load());
  automationField.input.addEventListener('change', () => void load());
  testBox.addEventListener('change', () => void load());

  let pending = 0;
  const refresh = (): void => {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => void load(), 40);
  };
  setStreamHandlers({ run: refresh, reconnect: refresh });

  await load();

  return h(
    'section',
    { class: 'screen-section runs-screen' },
    h('h1', { class: 'display', text: 'Runs' }),
    h(
      'div',
      { class: 'filter-row' },
      statusField.wrapper,
      automationField.wrapper,
      h('label', { class: 'field field-checkbox' }, testBox, h('span', { class: 'field-label', text: 'Show test runs' })),
    ),
    results,
    list,
  );
}
