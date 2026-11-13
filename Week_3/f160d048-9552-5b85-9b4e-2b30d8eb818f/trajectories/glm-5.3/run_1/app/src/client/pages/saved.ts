// Saved jobs and alerts.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, toast } from '../feedback.js';
import { live, onReload } from '../live.js';
import { newCountText, rangeText, workPatternName } from '../format.js';
import type { JobSummary, Alert as AlertShape } from '../types.js';
import type { PageContext } from '../app.js';

export function savedJobsPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'full-width' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  const list = h('ul', { role: 'list', 'aria-label': 'Saved jobs' });
  main.appendChild(h('h1', {}, 'Saved jobs'));
  main.appendChild(list);
  void build(list, ctx);
  return main;
}

async function build(list: HTMLElement, ctx: PageContext): Promise<void> {
  async function reload(): Promise<void> {
    const response = await api.get<{ jobs: JobSummary[] }>('/api/saved-jobs');
    clear(list);
    if (response.jobs.length === 0) {
      list.appendChild(h('li', {}, 'You have not saved any jobs yet. ', h('a', { href: '/jobs' }, 'Search lab jobs')));
      return;
    }
    for (const job of response.jobs) {
      const item = h('li', { 'data-id': job.id });
      item.appendChild(h('a', { href: `/jobs/${job.id}` }, `${job.title} at ${job.company_name}`));
      item.appendChild(h('p', { class: 'muted' }, `${job.city_name} · ${workPatternName(job.remote)}`));
      item.appendChild(h('p', { class: 'figures' }, rangeText(job.pay_low, job.pay_high)));
      list.appendChild(item);
    }
  }
  await reload();
  onReload(() => void reload());
  void ctx;
}

export function alertsPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  const list = h('ul', { role: 'list', 'aria-label': 'Saved alerts' });
  main.appendChild(h('h1', {}, 'Alerts'));
  main.appendChild(list);
  void buildAlerts(list);
  return main;
}

async function buildAlerts(list: HTMLElement): Promise<void> {
  async function reload(): Promise<void> {
    const response = await api.get<{ alerts: AlertShape[] }>('/api/alerts');
    clear(list);
    for (const alert of response.alerts) {
      const item = h('li', { 'data-id': alert.id });
      item.appendChild(h('p', {}, alert.label));
      item.appendChild(h('p', { class: 'new-count' }, newCountText(alert.new_count)));
      const see = h('a', { href: `/jobs?label=${encodeURIComponent(alert.label)}` }, `See jobs for ${alert.label}`);
      item.appendChild(h('p', {}, see));
      const del = h('button', { class: 'text-button', type: 'button' }, `Delete alert ${alert.label}`);
      del.addEventListener('click', async () => {
        try {
          await api.delete(`/api/alerts/${alert.id}`);
          announce('Alert deleted.');
          await reload();
        } catch (err) {
          alertBand(apiErrorMessage(err));
        }
      });
      item.appendChild(del);
      list.appendChild(item);
    }
  }
  await reload();
  live.subscribe((event) => {
    if (event.type === 'alert.matched') {
      void reload();
    }
  });
  onReload(() => void reload());
  void ApiFailure;
}
