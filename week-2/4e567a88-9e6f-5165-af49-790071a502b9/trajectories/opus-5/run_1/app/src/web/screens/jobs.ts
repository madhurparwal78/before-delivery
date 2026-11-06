import { JobView, MeterView, api } from '../api';
import { clear, el, num, table } from '../dom';
import { credits, rate as formatRate, shortDateTime, units } from '../format';
import { openJobDialog } from '../jobdialog';
import { Ribbon } from '../meter';
import { Shell } from '../shell';
import { modelName, noteZoneFromPeriod, state } from '../state';

const STATUSES = ['queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled'];

export function mountJobs(shell: Shell): () => void {
  const ribbon = new Ribbon();
  const statusSelect = el('select', { class: 'control', 'aria-label': 'Status' }, [
    el('option', { value: '', text: 'All statuses' }),
    ...STATUSES.map((status) => el('option', { value: status, text: status })),
  ]);
  const tableHolder = el('div', { class: 'table-holder' });
  const jobsById = new Map<string, JobView>();
  const timers: number[] = [];
  let renderedTable = '';

  function teamId(): string {
    return state.member!.role === 'member' ? state.member!.team_id! : state.selectedTeamId;
  }

  const exportLink = el('a', { class: 'export-link', href: '#', text: 'Export CSV' });

  function renderTable(jobs: JobView[]): void {
    const signature = jobs
      .map((job) => `${job.id}:${job.status}:${job.charged_micro}:${job.payload_visible}`)
      .join(',');
    if (signature === renderedTable) return;
    renderedTable = signature;
    clear(tableHolder);
    tableHolder.append(
      table(
        'Jobs',
        ['Job', 'Model', 'Status', 'Submitted by', 'Submitted', 'Units', 'Rate', 'Cost (credits)', 'Prompt'],
        jobs.map((job) => {
          const open = el('button', { type: 'button', class: 'link-button', 'aria-label': `Open job ${job.id}` }, [
            num(job.id),
          ]);
          open.addEventListener('click', () => openJobDialog(job, { onChanged: () => void load(), opener: open }));
          const prompt = job.payload_visible
            ? String(job.input?.['prompt'] ?? job.input?.['text'] ?? '')
            : 'Hidden — restricted payload';
          return {
            cells: [
              open,
              modelName(job.model),
              job.status,
              job.submitted_by.name,
              num(shortDateTime(job.submitted_at)),
              num(units(job.billed_units ?? job.estimated_units, job.unit)),
              num(formatRate(job.rate.micro_per_unit)),
              num(credits(job.charged_micro === null ? job.reserved_micro : job.charged_micro)),
              prompt,
            ],
          };
        }),
      ),
    );
  }

  async function load(): Promise<void> {
    const status = statusSelect.value;
    const query = new URLSearchParams({ team: teamId(), limit: '50' });
    if (status !== '') query.set('status', status);
    const [response, meter] = await Promise.all([
      api.get<{ jobs: JobView[] }>(`/api/jobs?${query.toString()}`),
      api.get<MeterView>(`/api/teams/${teamId()}/meter`),
    ]);
    noteZoneFromPeriod(meter.period.label, meter.period.starts_at);
    jobsById.clear();
    for (const job of response.jobs) jobsById.set(job.id, job);
    ribbon.update(meter, jobsById);
    renderTable(response.jobs);
    exportLink.setAttribute('href', `/api/jobs.csv?team=${encodeURIComponent(teamId())}`);
  }

  statusSelect.addEventListener('change', () => void load());
  ribbon.onOpenJob((jobId) => {
    const job = jobsById.get(jobId);
    if (job) openJobDialog(job, { onChanged: () => void load() });
  });

  shell.main.append(
    el('h1', { class: 'screen-title', text: 'Jobs' }),
    ribbon.root,
    el('div', { class: 'toolbar' }, [statusSelect, exportLink]),
    tableHolder,
  );
  void load();
  timers.push(window.setInterval(() => void load(), 2000));
  return () => {
    for (const timer of timers) window.clearInterval(timer);
  };
}
