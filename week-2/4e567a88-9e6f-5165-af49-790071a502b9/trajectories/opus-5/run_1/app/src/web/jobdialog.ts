import { ApiFailure, JobView, api } from './api';
import { DialogHandle, el, num, openDialog } from './dom';
import { credits, rate as formatRate, shortDateTime, units } from './format';
import { modelName } from './state';
import { alertError, notice } from './shell';

const CANCELLABLE = ['queued', 'leased', 'running'];

function row(label: string, value: Node | string): HTMLElement {
  return el('div', { class: 'detail-row' }, [
    el('dt', { text: label }),
    el('dd', {}, [typeof value === 'string' ? document.createTextNode(value) : value]),
  ]);
}

export function jobFields(job: JobView): HTMLElement {
  const list = el('dl', { class: 'detail-list' }, [
    row('Job', num(job.id)),
    row('Model', modelName(job.model)),
    row('Status', job.status),
    row('Submitted by', job.submitted_by.name),
    row('Submitted', num(shortDateTime(job.submitted_at))),
    row('Priority', job.priority),
    row('Units', num(`${units(job.billed_units ?? job.estimated_units, job.unit)}`)),
    row('Rate', num(formatRate(job.rate.micro_per_unit))),
    row(
      'Cost (credits)',
      num(credits(job.charged_micro === null ? job.reserved_micro : job.charged_micro)),
    ),
  ]);
  if (job.queue_position !== null) list.append(row('Queue position', num(`#${job.queue_position}`)));
  if (job.waiting_reason !== null) list.append(row('Waiting', 'Waiting for storage'));
  if (job.failure_reason !== null) list.append(row('Failure', job.failure_reason));
  if (job.outputs.length > 0) list.append(row('Outputs', job.outputs.join(', ')));
  if (job.payload_visible && job.input) {
    list.append(
      row(
        'Input',
        el(
          'div',
          { class: 'payload' },
          Object.entries(job.input).map(([key, value]) =>
            el('p', {}, [el('span', { class: 'payload-key', text: `${key}: ` }), String(value)]),
          ),
        ),
      ),
    );
  } else {
    list.append(row('Input', 'Hidden — restricted payload'));
  }
  return list;
}

export function openJobDialog(job: JobView, options: { onChanged?: () => void; opener?: HTMLElement | null } = {}): DialogHandle {
  return openDialog({
    label: `Job ${job.id}`,
    opener: options.opener ?? null,
    content: (close) => {
      const buttons: Node[] = [];
      if (CANCELLABLE.includes(job.status)) {
        const cancel = el('button', {
          type: 'button',
          class: 'secondary',
          text: `Cancel job ${job.id}`,
          'aria-label': `Cancel job ${job.id}`,
        });
        cancel.addEventListener('click', () => {
          notice('Cancelling…');
          void api
            .post<{ job: JobView }>(`/api/jobs/${job.id}/cancel`)
            .then((response) => {
              notice(`Job ${job.id} cancelled; ${credits(response.job.released_micro)} credits released.`);
              options.onChanged?.();
              close();
            })
            .catch((error: unknown) => {
              if (!(error instanceof ApiFailure)) throw error;
              if (error.status === 409) {
                alertError(`Job ${job.id} already ${error.detail.status ?? 'finished'}; nothing to cancel.`);
              } else {
                alertError(error.message);
              }
            });
        });
        buttons.push(cancel);
      }
      const closeButton = el('button', { type: 'button', class: 'secondary', text: 'Close' });
      closeButton.addEventListener('click', close);
      buttons.push(closeButton);
      return [
        el('h2', { class: 'dialog-title', text: `Job ${job.id}` }),
        jobFields(job),
        el('div', { class: 'dialog-actions' }, buttons),
      ];
    },
  });
}

export async function openJobById(jobId: string, onChanged?: () => void): Promise<void> {
  try {
    const response = await api.get<{ job: JobView }>(`/api/jobs/${jobId}`);
    openJobDialog(response.job, { onChanged });
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    alertError(error.message);
  }
}
