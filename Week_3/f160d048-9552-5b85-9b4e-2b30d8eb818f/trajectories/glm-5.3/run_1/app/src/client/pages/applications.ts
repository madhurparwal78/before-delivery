// My applications and one application's detail.
import { h, clear } from '../dom.js';
import { api, apiErrorMessage } from '../api.js';
import { alertBand, announce } from '../feedback.js';
import { live, onReload } from '../live.js';
import { stageLabel } from '../format.js';
import type { MyApplication } from '../types.js';
import type { PageContext } from '../app.js';

export function applicationsPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  const list = h('ul', { role: 'list', 'aria-label': 'My applications' });
  main.appendChild(h('h1', {}, 'My applications'));
  main.appendChild(list);
  void buildList(list);
  return main;
}

async function buildList(list: HTMLElement): Promise<void> {
  async function reload(): Promise<void> {
    const response = await api.get<{ applications: MyApplication[] }>('/api/me/applications');
    clear(list);
    for (const application of response.applications) {
      const item = h('li', { 'data-id': application.id });
      item.appendChild(h('a', { href: `/applications/${application.id}` }, `${application.job_title} at ${application.company_name}`));
      item.appendChild(h('p', { class: 'stage', 'data-stage': application.stage }, stageLabel(application.stage)));
      list.appendChild(item);
    }
  }
  await reload();
  live.subscribe((event) => {
    if (event.type === 'application.stage') {
      const existing = list.querySelector<HTMLElement>(`li[data-id="${event.data.application_id}"]`);
      if (existing) {
        const stage = existing.querySelector('.stage');
        if (stage) {
          stage.setAttribute('data-stage', event.data.stage as string);
          stage.textContent = stageLabel(event.data.stage as string);
        }
      }
      const job = event.data.job_title as string | undefined;
      if (job) announce(`Your application for ${job} is now at ${stageLabel(event.data.stage as string)}.`);
    }
  });
  onReload(() => void reload());
}

export function applicationDetailPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  const id = ctx.params['1'] ?? ctx.params.id ?? '';
  void buildDetail(main, id);
  return main;
}

async function buildDetail(main: HTMLElement, id: string): Promise<void> {
  const application = await api.get<MyApplication>(`/api/applications/${id}`).catch(() => null);
  if (!application) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return;
  }
  main.appendChild(h('h1', {}, `${application.job_title} at ${application.company_name}`));
  main.appendChild(h('p', { class: 'stage', 'data-stage': application.stage }, stageLabel(application.stage)));
  main.appendChild(h('p', {}, `Applied on ${application.applied_on}`));
  if (application.candidate_name) main.appendChild(h('p', {}, application.candidate_name));
  if (application.contact_email) main.appendChild(h('p', {}, application.contact_email));
  if (application.resume_file_id) {
    main.appendChild(h('p', {}, h('a', { href: `/api/files/${application.resume_file_id}` }, 'Download resume')));
  }
  live.subscribe((event) => {
    if (event.type === 'application.stage' && event.data.application_id === id) {
      const stage = main.querySelector('.stage');
      if (stage) {
        stage.setAttribute('data-stage', event.data.stage as string);
        stage.textContent = stageLabel(event.data.stage as string);
      }
    }
  });
  onReload(() => undefined);
  void alertBand;
  void apiErrorMessage;
}
