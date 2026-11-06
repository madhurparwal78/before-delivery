import { COPY, JOB_STAGE_LABELS } from '../../shared/domain.js';
import { getJson, RequestFailed, sendJson } from '../lib/api.js';
import { button, el, labelledField, openDialog, setFieldError } from '../lib/dom.js';
import { announce, errorSummary, showTopBar, view } from '../lib/shell.js';
import type { Job } from '../lib/types.js';

const TIME_ZONES = [
  'America/Chicago',
  'America/Denver',
  'America/New_York',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Stockholm',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export async function renderJobs(navigate: (path: string) => void): Promise<void> {
  showTopBar(true);
  const root = view();
  const me = await getJson<{ user: { is_owner: boolean } }>('/api/me');
  const jobs = (await getJson<{ jobs: Job[] }>('/api/jobs')).jobs;
  root.replaceChildren();

  const header = el('div', { class: 'pagehead' }, [el('h1', {}, ['Your jobs'])]);
  const rows = el('div', { class: 'joblist' });
  if (me.user.is_owner) {
    const newJob = button('New job', {}, () => openNewJob(navigate, newJob));
    header.append(newJob);
  }
  root.append(header, rows);

  if (jobs.length === 0) {
    rows.append(el('p', { class: 'empty' }, [COPY.noJobs]));
    return;
  }
  for (const job of jobs) {
    const link = el('a', { href: `/jobs/${job.id}`, 'data-link': 'true' }, [job.name]);
    rows.append(
      el('div', { class: 'jobrow' }, [
        link,
        el('span', { class: 'stage' }, [JOB_STAGE_LABELS[job.status]]),
        el('span', { class: 'num' }, [`${job.progress.percent}% verified`]),
      ]),
    );
  }
}

function openNewJob(navigate: (path: string) => void, opener: HTMLElement): void {
  openDialog(
    'New job',
    (dialog) => {
      const name = labelledField('Job name');
      const address = labelledField('Address');
      const zone = labelledField('Time zone', { list: 'timezones', value: 'America/Chicago' });
      const list = el('datalist', { id: 'timezones' }, TIME_ZONES.map((tz) => el('option', { value: tz })));
      const problem = el('div', { class: 'formproblem' });
      const submit = el('button', { type: 'submit' }, ['Create job']);
      const form = el('form', { novalidate: true }, [
        problem,
        name.wrap,
        address.wrap,
        zone.wrap,
        list,
        submit,
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void (async () => {
          problem.replaceChildren();
          for (const field of [name, address, zone]) setFieldError(field.error, field.input, null);
          submit.disabled = true;
          submit.setAttribute('aria-busy', 'true');
          announce(COPY.saving);
          try {
            const job = await sendJson<Job>('POST', '/api/jobs', {
              name: name.input.value,
              address: address.input.value,
              time_zone: zone.input.value,
            });
            announce('Job created.');
            dialog.close();
            navigate(`/jobs/${job.id}`);
          } catch (error) {
            if (error instanceof RequestFailed) {
              const fields = error.body.fields ?? {};
              const entries: { field: string; message: string; focus: () => void }[] = [];
              for (const [key, field] of [
                ['name', name],
                ['address', address],
                ['time_zone', zone],
              ] as const) {
                const message = fields[key];
                if (message !== undefined) {
                  setFieldError(field.error, field.input, message);
                  entries.push({ field: key, message, focus: () => field.input.focus() });
                }
              }
              if (entries.length === 0) {
                entries.push({
                  field: 'name',
                  message: error.body.message,
                  focus: () => name.input.focus(),
                });
                setFieldError(name.error, name.input, error.body.message);
              }
              const summary = errorSummary(entries);
              if (summary !== null) problem.append(summary);
            }
            announce('');
          } finally {
            submit.disabled = false;
            submit.removeAttribute('aria-busy');
          }
        })();
      });
      dialog.body.append(form);
    },
    opener,
  );
}
