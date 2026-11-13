// Employer home, the new job form, the pipeline board and the applicant page.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, toast } from '../feedback.js';
import { live, onReload } from '../live.js';
import { applicantLine, CITIES, ROLE_FAMILIES, WORK_PATTERNS, stageLabel } from '../format.js';
import type { Applicant, JobSummary, Me } from '../types.js';
import type { PageContext } from '../app.js';

function isTeam(me: Me | null): boolean {
  return me !== null && (me.role === 'employer_admin' || me.role === 'recruiter');
}

export function employerHomePage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!isTeam(ctx.me)) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return main;
  }
  void buildEmployer(main, ctx);
  return main;
}

async function buildEmployer(main: HTMLElement, ctx: PageContext): Promise<void> {
  main.appendChild(h('h1', {}, 'Employer home'));

  // Verification block.
  const email = h('input', { type: 'email', id: 'work-email', 'aria-label': 'Work email' }) as HTMLInputElement;
  const sendCode = h('button', { class: 'text-button', type: 'button' }, 'Send code');
  const code = h('input', { type: 'text', id: 'code', 'aria-label': 'Verification code' }) as HTMLInputElement;
  const verify = h('button', { class: 'solid-button', type: 'button' }, 'Verify');
  const status = h('p', { class: 'muted' });

  sendCode.addEventListener('click', async () => {
    try {
      await api.post('/api/employer/verification/request', { email: email.value });
      status.textContent = `A code is on its way to ${email.value}.`;
      announce(`A code is on its way to ${email.value}.`);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 429) {
        alertBand(err.body.message);
        return;
      }
      alertBand(apiErrorMessage(err));
    }
  });

  verify.addEventListener('click', async () => {
    try {
      await api.post('/api/employer/verification/confirm', { code: code.value });
      status.textContent = 'Verified employer';
      announce('Your team is verified.');
      await ctx.refreshMe();
      ctx.rerender();
    } catch (err) {
      alertBand(apiErrorMessage(err));
    }
  });

  if (ctx.me!.role === 'employer_admin') {
    main.appendChild(h('h2', {}, 'Verify your team'));
    main.appendChild(email);
    main.appendChild(sendCode);
    main.appendChild(code);
    main.appendChild(verify);
    main.appendChild(status);
  }

  // The lab mark.
  const mark = h('input', { type: 'file', id: 'mark', accept: 'image/png' }) as HTMLInputElement;
  mark.setAttribute('aria-label', 'Lab mark (PNG)');
  const markButton = h('button', { class: 'text-button', type: 'button' }, 'Upload mark');
  markButton.addEventListener('click', async () => {
    if (!mark.files || mark.files.length === 0) {
      alertBand('Upload a PNG image.');
      return;
    }
    const data = new Uint8Array(await mark.files[0].arrayBuffer());
    try {
      await api.raw('/api/employer/company/mark', {
        method: 'PUT',
        body: data as unknown as BodyInit,
        headers: { 'content-type': 'image/png' },
      });
      announce('Mark updated.');
      ctx.rerender();
    } catch (err) {
      alertBand(apiErrorMessage(err));
    }
  });
  main.appendChild(h('h2', {}, 'Lab mark'));
  main.appendChild(mark);
  main.appendChild(markButton);

  // Your jobs.
  const jobsList = h('ul', { role: 'list', 'aria-label': 'Your jobs' });
  main.appendChild(h('h2', {}, 'Your jobs'));
  main.appendChild(jobsList);
  main.appendChild(h('p', {}, h('a', { class: 'solid-button', href: '/employer/jobs/new' }, 'List a job')));

  async function reloadJobs(): Promise<void> {
    const response = await api.get<{ jobs: (JobSummary & { status: string })[] }>('/api/employer/jobs');
    clear(jobsList);
    for (const job of response.jobs) {
      const item = h('li', { 'data-id': job.id });
      item.appendChild(h('a', { href: `/employer/jobs/${job.id}` }, job.title));
      item.appendChild(h('span', { class: 'muted' }, ` ${job.status === 'listed' ? 'Listed' : job.status === 'draft' ? 'Draft' : 'Closed'}`));
      const close = h('button', { class: 'text-button', type: 'button' }, `Close ${job.title}`);
      close.addEventListener('click', async () => {
        try {
          await api.post(`/api/employer/jobs/${job.id}/close`);
          announce(`${job.title} is closed.`);
          await reloadJobs();
        } catch (err) {
          alertBand(apiErrorMessage(err));
        }
      });
      item.appendChild(close);
      if (job.status !== 'listed') {
        const relist = h('button', { class: 'text-button', type: 'button' }, `List ${job.title} again`);
        relist.addEventListener('click', async () => {
          try {
            await api.post(`/api/employer/jobs/${job.id}/list`);
            announce(`${job.title} is listed.`);
            await reloadJobs();
          } catch (err) {
            if (err instanceof ApiFailure && err.status === 503) {
              alertBand(err.body.message);
              return;
            }
            alertBand(apiErrorMessage(err));
          }
        });
        item.appendChild(relist);
      }
      jobsList.appendChild(item);
    }
  }
  await reloadJobs();
  onReload(() => void reloadJobs());
}

export function newJobPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!isTeam(ctx.me)) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return main;
  }
  main.appendChild(h('h1', {}, 'List a job'));
  const title = h('input', { type: 'text', id: 'job-title' }) as HTMLInputElement;
  title.setAttribute('aria-label', 'Title');
  const role = h('select', { id: 'job-role' }) as HTMLSelectElement;
  role.setAttribute('aria-label', 'Role');
  for (const family of ROLE_FAMILIES) {
    role.appendChild(h('option', { value: family.id }, family.name));
  }
  const city = h('select', { id: 'job-city' }) as HTMLSelectElement;
  city.setAttribute('aria-label', 'City');
  for (const entry of CITIES) {
    city.appendChild(h('option', { value: entry.id }, entry.name));
  }
  const pattern = h('div', { role: 'radiogroup', 'aria-label': 'Work pattern' });
  for (const option of WORK_PATTERNS) {
    const radio = h('input', { type: 'radio', name: 'remote', id: `remote-${option.id}`, value: option.id }) as HTMLInputElement;
    pattern.appendChild(h('label', { for: `remote-${option.id}` }, option.name));
    pattern.appendChild(radio);
  }
  const payLow = h('input', { type: 'number', id: 'pay-low' }) as HTMLInputElement;
  payLow.setAttribute('aria-label', 'Pay from (rupees a year)');
  const payHigh = h('input', { type: 'number', id: 'pay-high' }) as HTMLInputElement;
  payHigh.setAttribute('aria-label', 'Pay to (rupees a year)');
  const description = h('textarea', { id: 'job-description', rows: '5' }) as HTMLTextAreaElement;
  description.setAttribute('aria-label', 'Description');
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'List job');
  submit.addEventListener('click', async () => {
    const remote = pattern.querySelector<HTMLInputElement>('input:checked')?.value;
    try {
      const job = await api.post<JobSummary>('/api/employer/jobs', {
        title: title.value,
        role_family: role.value,
        city: city.value,
        remote,
        pay_low: Number.parseInt(payLow.value, 10),
        pay_high: Number.parseInt(payHigh.value, 10),
        description: description.value,
      });
      toast(`${job.title} is listed.`);
      announce(`${job.title} is listed.`);
      ctx.navigate(`/employer/jobs/${job.id}`);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 503) {
        alertBand(err.body.message);
        return;
      }
      alertBand(apiErrorMessage(err));
    }
  });

  main.appendChild(title);
  main.appendChild(role);
  main.appendChild(city);
  main.appendChild(pattern);
  main.appendChild(payLow);
  main.appendChild(payHigh);
  main.appendChild(description);
  main.appendChild(submit);
  return main;
}

export function pipelinePage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'full-width' });
  if (!isTeam(ctx.me)) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return main;
  }
  const id = ctx.params['1'] ?? ctx.params.id ?? '';
  void buildPipeline(main, ctx, id);
  return main;
}

async function buildPipeline(main: HTMLElement, ctx: PageContext, jobId: string): Promise<void> {
  const job = await api.get<JobSummary & { description: string; status: string }>(`/api/jobs/${jobId}`).catch(() => null);
  if (!job) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return;
  }
  main.appendChild(h('h1', {}, `Pipeline for ${job.title}`));

  const exportCsv = h('a', { class: 'text-button', href: `/api/employer/jobs/${jobId}/applicants.csv` }, 'Export applicants CSV');
  main.appendChild(exportCsv);

  const visible = new Set(['submitted', 'screening', 'interview', 'offer', 'declined']);
  const filterGroup = h('div', { role: 'group', 'aria-label': 'Stage filter' });
  const clearFilters = h('button', { class: 'text-button', type: 'button' }, 'Clear filters');
  const columns: Record<string, HTMLElement> = {};
  const lists: Record<string, HTMLElement> = {};
  const board = h('div', { class: 'pipeline' });
  let applicants: Applicant[] = [];

  const stages = ['submitted', 'screening', 'interview', 'offer', 'declined'] as const;

  for (const stage of stages) {
    const heading = h('h2', { class: 'column-heading' }, `${stageLabel(stage)} (0)`);
    const list = h('ul', { role: 'list', 'aria-label': stageLabel(stage), 'data-stage': stage });
    lists[stage] = list;
    const column = h('div', { class: 'pipeline-column', 'data-stage': stage }, heading, list);
    columns[stage] = column;
    board.appendChild(column);
  }

  function renderFilters(): void {
    clear(filterGroup);
    for (const stage of stages) {
      const chipButton = h('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': visible.has(stage) ? 'true' : 'false',
      }, stageLabel(stage));
      chipButton.addEventListener('click', () => {
        if (visible.has(stage)) visible.delete(stage);
        else visible.add(stage);
        const shown = applicants.filter((applicant) => visible.has(applicant.stage)).length;
        announce(`Filter ${visible.has(stage) ? 'removed' : 'added'}: ${stageLabel(stage)}. ${applicantLine(shown)}.`);
        renderFilters();
        renderBoard();
      });
      chipButton.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (visible.has(stage)) {
            visible.delete(stage);
            renderFilters();
            renderBoard();
          }
        }
      });
      filterGroup.appendChild(chipButton);
    }
  }

  function renderBoard(): void {
    for (const stage of stages) {
      const list = lists[stage];
      clear(list);
      const inStage = applicants.filter((applicant) => applicant.stage === stage);
      const heading = columns[stage].querySelector('.column-heading') as HTMLElement;
      heading.textContent = `${stageLabel(stage)} (${inStage.length})`;
      for (const applicant of inStage) {
        list.appendChild(applicantCard(applicant));
      }
      columns[stage].style.display = visible.has(stage) ? '' : 'none';
    }
  }

  function applicantCard(applicant: Applicant): HTMLElement {
    const card = h('button', {
      class: 'applicant-card',
      type: 'button',
      'data-id': applicant.id,
      tabindex: '0',
    }, `${applicant.candidate_name}, ${stageLabel(applicant.stage)}`) as HTMLButtonElement;
    card.addEventListener('click', () => {
      ctx.navigate(`/employer/applications/${applicant.id}`);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (picked && picked.applicant.id === applicant.id) {
          return; // the document handler drops a held card
        }
        pickup(card, applicant);
      }
    });
    return card;
  }

  let picked: { card: HTMLButtonElement; applicant: Applicant } | null = null;
  let targetIndex = 0;

  async function move(applicant: Applicant, toStage: string): Promise<void> {
    try {
      await api.post(`/api/employer/applications/${applicant.id}/stage`, { stage: toStage });
      announce(`${applicant.candidate_name} moved to ${stageLabel(toStage)}.`);
      await reload();
    } catch (err) {
      announce(`${applicant.candidate_name} cannot move to ${stageLabel(toStage)}.`);
      if (err instanceof ApiFailure) alertBand(err.body.message);
    }
  }

  function pickup(card: HTMLButtonElement, applicant: Applicant): void {
    picked = { card, applicant };
    targetIndex = stages.indexOf(applicant.stage as (typeof stages)[number]);
    card.setAttribute('data-state', 'running');
    announce(`Picked up ${applicant.candidate_name}, in ${stageLabel(applicant.stage)}. Use Left and Right to move, Space to drop, Escape to cancel.`);
  }

  document.addEventListener('keydown', (event) => {
    if (!picked) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const order = stages.filter((stage) => visible.has(stage));
      const currentIndex = order.indexOf(stages[targetIndex]);
      const next = Math.max(0, Math.min(order.length - 1, currentIndex + (event.key === 'ArrowRight' ? 1 : -1)));
      targetIndex = stages.indexOf(order[next]);
      for (const stage of stages) {
        columns[stage].classList.toggle('column-target', stages.indexOf(stage) === targetIndex);
      }
      announce(`${picked.applicant.candidate_name} over ${stageLabel(stages[targetIndex])}.`);
    } else if (event.key === ' ') {
      event.preventDefault();
      const toStage = stages[targetIndex];
      if (toStage === picked.applicant.stage) {
        announce(`Move cancelled. ${picked.applicant.candidate_name} stays in ${stageLabel(picked.applicant.stage)}.`);
        cleanupPick();
        return;
      }
      const { applicant } = picked;
      cleanupPick();
      void move(applicant, toStage);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      announce(`Move cancelled. ${picked.applicant.candidate_name} stays in ${stageLabel(picked.applicant.stage)}.`);
      cleanupPick();
    }
  });

  function cleanupPick(): void {
    if (picked) {
      picked.card.setAttribute('data-state', 'done');
      picked.card.setAttribute('data-motion', 'card-drop');
      picked.card.setAttribute('data-motion-ms', document.documentElement.getAttribute('data-motion-pref') === 'reduced' ? '0' : '240');
    }
    picked = null;
    for (const stage of stages) {
      columns[stage].classList.remove('column-target');
    }
  }

  async function reload(): Promise<void> {
    const response = await api.get<{ applicants: Applicant[] }>(`/api/employer/jobs/${jobId}/applicants`);
    applicants = response.applicants;
    renderBoard();
  }

  renderFilters();
  main.appendChild(filterGroup);
  main.appendChild(clearFilters);
  main.appendChild(board);
  await reload();

  live.subscribe((event) => {
    if (event.type === 'application.stage') {
      void reload();
    }
  });
  onReload(() => void reload());
}

export function applicantPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!isTeam(ctx.me)) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return main;
  }
  const id = ctx.params['1'] ?? ctx.params.id ?? '';
  void buildApplicant(main, id);
  return main;
}

async function buildApplicant(main: HTMLElement, id: string): Promise<void> {
  const applicant = await api.get<Applicant>(`/api/employer/applications/${id}`).catch(() => null);
  if (!applicant) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return;
  }
  main.appendChild(h('h1', {}, applicant.candidate_name));
  main.appendChild(h('p', { class: 'stage', 'data-stage': applicant.stage }, stageLabel(applicant.stage)));
  main.appendChild(h('p', {}, applicant.contact_email));
  if (applicant.phone) main.appendChild(h('p', {}, applicant.phone));
  if (applicant.cover_note) main.appendChild(h('p', {}, applicant.cover_note));
  main.appendChild(h('p', {}, h('a', { href: `/api/files/${applicant.resume_file_id}` }, 'Resume')));
}
