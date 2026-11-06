/**
 * Jobs — the workshop lead's home. Table of jobs and the Estimate dialog
 * (create or edit), with versions and the estimate-changed answer.
 */
import { api, ApiFailure } from '../api.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { navigate } from '../app.ts';
import { estimateLabel } from '../../shared/copy.ts';
import type { Screen } from './screen.ts';

export interface JobSummary {
  id: string;
  number: string;
  car: { id: string; name: string };
  owner: { name: string };
  title: string;
  status: string;
  version: number;
  expires_at: string | null;
  lines: { kind: string; description: string; quantity: string; unit_price: string | null }[];
  total: string;
}

export function renderJobs(main: HTMLElement): Screen {
  const body = h('tbody');
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'job-updates' });

  const rowFor = (job: JobSummary): HTMLElement => {
    const link = h('a', { href: `/jobs/${job.id}`, text: job.number });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(`/jobs/${job.id}`);
    });
    return h('tr', null,
      h('td', null, link),
      h('td', { text: job.car.name }),
      h('td', { text: job.title }),
      h('td', { 'data-cell': 'status', text: estimateLabel(job.status, job.expires_at) }),
      h('td', { class: 'num', text: `CHF ${job.total}` }));
  };
  const patchRow = (row: HTMLElement, job: JobSummary): void => {
    patchText(row.querySelector('[data-cell="status"]') as HTMLElement, estimateLabel(job.status, job.expires_at));
  };

  const render = async (): Promise<void> => {
    main.replaceChildren(
      h('div', { class: 'row-flex', style: 'justify-content:space-between;' },
        h('h1', { text: 'Jobs' }),
        h('button', { text: 'New estimate', onclick: (event: Event) => openEstimateDialog(event.currentTarget as HTMLElement, null, region) })),
      region,
      h('table', { class: 'sheet', 'aria-label': 'Jobs' },
        h('thead', null, h('tr', null,
          h('th', { text: 'Number' }), h('th', { text: 'Car' }), h('th', { text: 'Title' }),
          h('th', { text: 'Status' }), h('th', { class: 'num', text: 'Total' }))),
        body),
    );
    const response = (await api.get('/api/jobs')) as { jobs: JobSummary[] };
    reconcile(body, response.jobs, (job) => job.id, rowFor, patchRow);
  };

  return {
    render,
    destroy() {
      // the Jobs table has no periodic re-read
    },
  };
}

export interface EstimateDraft {
  id: string;
  number: string;
  version: number;
  status: string;
  expires_at: string | null;
  owner: { name: string };
  title: string;
  lines: { id: string; kind: string; description: string; quantity: string; unit_price: string | null }[];
}

/** The Estimate dialog for creating and editing, with If-Match versions. */
export function openEstimateDialog(
  opener: HTMLElement | null,
  existing: EstimateDraft | null,
  region: HTMLElement,
  onSaved?: () => Promise<void>,
): void {
  openDialog({
    name: 'Estimate',
    opener,
    build: (dialog, close) => {
      const summary = h('div');
      const car = h('select', { 'data-field': 'car_id' });
      const title = h('input', { type: 'text', 'data-field': 'title', value: existing?.title ?? '' });
      const version = existing?.version ?? null;
      const linesArea = h('div');
      let lineCount = existing?.lines.length ?? 0;

      const lineRow = (kind: string, description: string, quantity: string, unitPrice: string, index: number): HTMLElement => {
        const kindSelect = h('select', { 'data-field': `lines-${index}-kind`, 'aria-label': 'Line kind' },
          h('option', { value: 'part', ...(kind === 'part' ? { selected: true } : {}), text: 'Part' }),
          h('option', { value: 'labour', ...(kind === 'labour' ? { selected: true } : {}), text: 'Labour' }),
          h('option', { value: 'paint_materials', ...(kind === 'paint_materials' ? { selected: true } : {}), text: 'Paint materials' }));
        const priceInput = h('input', { type: 'text', class: 'mono', 'data-field': `lines-${index}-unit_price`, 'aria-label': 'Unit price (CHF)', value: unitPrice });
        const priceField = h('div', { class: `field ${kind === 'labour' ? 'hidden' : ''}` },
          h('label', { text: 'Unit price (CHF)' }), priceInput);
        kindSelect.addEventListener('change', () => {
          priceField.classList.toggle('hidden', kindSelect.value === 'labour');
        });
        return h('div', { class: 'row', 'data-line': String(index) },
          h('div', { class: 'field' }, h('label', { text: 'Line kind' }), kindSelect),
          h('div', { class: 'field' }, h('label', { text: 'Description' }),
            h('input', { type: 'text', 'data-field': `lines-${index}-description`, value: description })),
          h('div', { class: 'field' }, h('label', { text: 'Quantity' }),
            h('input', { type: 'text', class: 'mono', 'data-field': `lines-${index}-quantity`, value: quantity })),
          priceField,
          h('button', {
            'aria-label': `Remove line ${index + 1}`,
            text: 'Remove',
            onclick: (event: Event) => (event.currentTarget as HTMLElement).closest('[data-line]')?.remove(),
          }));
      };

      const addLine = (kind = 'part', description = '', quantity = '1', unitPrice = ''): void => {
        linesArea.append(lineRow(kind, description, quantity, unitPrice, lineCount));
        lineCount += 1;
      };
      if (existing && existing.lines.length > 0) {
        for (const line of existing.lines) {
          addLine(line.kind, line.description, line.quantity, line.unit_price ?? '');
        }
      } else {
        addLine();
      }

      const save = h('button', { class: 'primary', text: 'Save estimate' });
      save.addEventListener('click', async () => {
        summary.replaceChildren();
        const lines: { kind: string; description: string; quantity: string; unit_price?: string }[] = [];
        for (const row of Array.from(linesArea.querySelectorAll('[data-line]'))) {
          const index = row.getAttribute('data-line') as string;
          const kind = row.querySelector<HTMLSelectElement>(`[data-field="lines-${index}-kind"]`)?.value ?? '';
          const description = row.querySelector<HTMLInputElement>(`[data-field="lines-${index}-description"]`)?.value ?? '';
          const quantity = row.querySelector<HTMLInputElement>(`[data-field="lines-${index}-quantity"]`)?.value ?? '';
          const unitPrice = row.querySelector<HTMLInputElement>(`[data-field="lines-${index}-unit_price"]`)?.value ?? '';
          lines.push(kind === 'labour' ? { kind, description, quantity } : { kind, description, quantity, unit_price: unitPrice });
        }
        const payload = { title: title.value, lines };
        announce(region, 'Saving...');
        try {
          if (existing) {
            await api.patch(`/api/jobs/${existing.id}`, payload, `"${version}"`);
            announce(region, `Estimate ${existing.number} saved.`);
          } else {
            const answer = (await api.post('/api/jobs', { car_id: car.value, ...payload })) as { job: { id: string; number: string } };
            announce(region, `Estimate ${answer.job.number} saved.`);
          }
          close('submit');
          await onSaved?.();
        } catch (err) {
          if (err instanceof ApiFailure) {
            if (err.detail.code === 'estimate_changed') {
              announce(region, `Estimate ${existing?.number} was changed by someone else. Your edits are kept; reload to see the latest.`);
              summary.replaceChildren(h('div', { role: 'alert' }, h('p', { class: 'error', text: 'There is a problem' })));
              save.focus();
              return;
            }
            if (err.detail.code === 'invalid_transition') {
              announce(region, 'This job has moved on. Reload to see its current state.');
              return;
            }
            if (err.detail.fields) {
              summary.replaceChildren(fieldSummary(err.detail.fields, dialog));
              return;
            }
            announce(region, err.detail.code ?? 'Saving failed.');
          }
        }
      });

      dialog.append(
        h('h2', { text: 'Estimate' }),
        summary,
        h('div', { class: 'field' }, h('label', { text: 'Car' }), car),
        h('div', { class: 'field' }, h('label', { text: 'Job title' }), title),
        linesArea,
        h('div', { class: 'actions' },
          h('button', { text: 'Add line', onclick: () => addLine() }),
          save,
          h('button', { text: 'Close', onclick: () => close('cancel') })),
      );
      if (!existing) {
        void api.get('/api/cars?status=stored').then((response) => {
          const data = response as { cars: { id: string; name: string; bay: { code: string } | null }[] };
          const stored = data.cars
            .filter((candidate) => candidate.bay !== null)
            .sort((a, b) => (a.bay?.code ?? '').localeCompare(b.bay?.code ?? ''));
          for (const candidate of stored) {
            car.append(h('option', { value: candidate.id, text: candidate.name }));
          }
        });
      } else {
        car.setAttribute('disabled', 'true');
        car.append(h('option', { text: '', value: '' }));
      }
    },
  });
}

export function fieldSummary(fields: Record<string, string>, scope: HTMLElement): HTMLElement {
  const link = (field: string, message: string): HTMLElement =>
    h('a', {
      href: '#',
      text: message,
      onclick: (event: Event) => {
        event.preventDefault();
        const name = field.split('.').pop() ?? field;
        const control = scope.querySelector<HTMLElement>(`[data-field="${name}"]`);
        control?.focus();
      },
    });
  return h('div', { role: 'alert' },
    h('p', { class: 'error-summary', text: 'There is a problem' }),
    h('ul', null, ...Object.entries(fields).map(([field, message]) => h('li', null, link(field, message)))));
}
