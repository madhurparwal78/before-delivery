import { ApiFailure, api, apiUpload } from '../api';
import { h } from '../dom';
import { notice, showAlert } from '../regions';
import { formatInstant } from '../format';
import { navigate, type ScreenCtx } from '../router';
import { intercept } from '../shell';
import { actionButton, labelledInput, openDialog, VIEWER_REASON, withReason } from '../ui';
import type { AutomationListItem, TriggerKind } from '../../shared/types';

const TRIGGER_CHOICES: { label: string; kind: TriggerKind }[] = [
  { label: 'Form', kind: 'form' },
  { label: 'Schedule', kind: 'schedule' },
  { label: 'Webhook', kind: 'webhook' },
  { label: 'Row added', kind: 'row_added' },
  { label: 'Manual', kind: 'manual' },
];

const TRIGGER_WORDS: Record<TriggerKind, string> = {
  form: 'Form',
  schedule: 'Schedule',
  webhook: 'Webhook',
  row_added: 'Row added',
  manual: 'Manual',
};

export async function renderWorkspaceHome(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const viewer = ctx.workspace?.role === 'viewer';
  const reason = viewer ? VIEWER_REASON : null;
  const { automations } = await api<{ automations: AutomationListItem[] }>(
    'GET',
    `/api/workspaces/${workspaceId}/automations`,
  );

  const newButton = h('button', { type: 'button', class: 'pill pill-primary', text: 'New automation' });
  newButton.addEventListener('click', () => openNewAutomation(workspaceId, newButton));

  const fileInput = h('input', { type: 'file', class: 'visually-hidden', 'aria-label': 'Automation file', accept: '.json,application/json' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    void uploadImport(workspaceId, file);
  });
  const importButton = h('button', { type: 'button', class: 'pill pill-secondary', text: 'Import automation' });
  importButton.addEventListener('click', () => fileInput.click());
  if (viewer) fileInput.setAttribute('disabled', '');

  const rows = automations.map((automation) =>
    h(
      'li',
      { class: 'row-item', 'data-automation-id': automation.id },
      h('a', {
        class: 'row-title',
        href: `/w/${workspaceId}/automations/${automation.id}`,
        onclick: intercept,
        text: automation.name,
      }),
      h('span', { class: 'row-meta', text: TRIGGER_WORDS[automation.trigger_kind] }),
      h('span', {
        class: 'chip chip-version',
        text: automation.live_version === null ? 'Draft only' : `Live v${automation.live_version}`,
      }),
      automation.next_run_at === null
        ? null
        : h('span', { class: 'row-meta', text: `Next run ${formatInstant(automation.next_run_at)}` }),
    ),
  );

  return h(
    'section',
    { class: 'screen-section' },
    h('h1', { class: 'display', text: 'Automations' }),
    h(
      'div',
      { class: 'actions-row' },
      withReason(newButton, reason),
      withReason(importButton, reason),
      fileInput,
    ),
    rows.length === 0
      ? h(
          'div',
          { class: 'empty-state' },
          h('div', { class: 'dot-lattice', 'aria-hidden': 'true' }, h('span', { class: 'lattice-square' })),
          h('p', { class: 'body-text', text: 'No automations yet. Start with a new automation.' }),
          h('ul', { class: 'row-list', role: 'list', 'aria-label': 'Automations' }),
        )
      : h('ul', { class: 'row-list', role: 'list', 'aria-label': 'Automations' }, ...rows),
  );
}

function openNewAutomation(workspaceId: string, returnFocus: HTMLElement): void {
  openDialog({
    name: 'New automation',
    returnFocus,
    focusSelector: 'input',
    build: (close) => {
      const name = labelledInput('Automation name', 'text');
      const trigger = labelledInput('Trigger', 'select', {
        choices: TRIGGER_CHOICES.map((choice) => choice.label),
        value: 'Form',
      });
      const create = actionButton(
        'Create automation',
        async () => {
          const choice = TRIGGER_CHOICES.find(
            (item) => item.label === (trigger.input as HTMLSelectElement).value,
          );
          try {
            const created = await api<{ id: string }>('POST', `/api/workspaces/${workspaceId}/automations`, {
              name: name.input.value,
              trigger_kind: choice?.kind ?? 'manual',
            });
            close();
            navigate(`/w/${workspaceId}/automations/${created.id}`);
          } catch (error) {
            if (error instanceof ApiFailure) notice(error.message);
          }
        },
        { variant: 'primary' },
      );
      return h(
        'div',
        { class: 'dialog-body' },
        h('h2', { class: 'display', text: 'New automation' }),
        name.wrapper,
        trigger.wrapper,
        create.element,
        h('button', { type: 'button', class: 'pill pill-secondary', text: 'Close', onclick: close }),
      );
    },
  });
}

async function uploadImport(workspaceId: string, file: File): Promise<void> {
  notice('Saving import...');
  try {
    const bytes = await file.arrayBuffer();
    const result = (await apiUpload(`/api/workspaces/${workspaceId}/imports`, bytes)) as {
      automation_id: string;
    };
    navigate(`/w/${workspaceId}/automations/${result.automation_id}?imported=1`);
  } catch (error) {
    if (error instanceof ApiFailure) {
      if (error.status === 503) showAlert('Storage is unavailable. Nothing was saved.');
      else notice(error.message);
    }
  }
}
