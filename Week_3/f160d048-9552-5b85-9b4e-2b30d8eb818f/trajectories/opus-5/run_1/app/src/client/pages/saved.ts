import {
  CITIES,
  moneyRange,
  newCountText,
  PAY_BANDS,
  ROLE_FAMILIES,
  WORK_PATTERNS,
  workPatternName,
} from '../../shared/reference';
import { failureOf, get, post, remove } from '../core/api';
import { el, on } from '../core/dom';
import { onLive } from '../core/live';
import { navigate, type Cleanup } from '../core/router';
import { pageAlert, working } from '../core/shell';
import { emptyState } from '../widgets/layout';

interface JobSummary {
  id: string;
  title: string;
  company_name: string;
  city_name: string;
  remote: string;
  pay_low: number;
  pay_high: number;
}

export async function renderSavedJobs(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: 'Saved jobs' })]);
  container.append(page);
  const saved = await get<{ jobs: JobSummary[] }>('/api/saved-jobs');

  if (saved.jobs.length === 0) {
    page.append(
      emptyState(
        'You have not saved any jobs yet.',
        el('a', { href: '/jobs', class: 'solid-button', text: 'Search lab jobs' }),
      ),
    );
    return () => undefined;
  }

  const list = el('ul', { 'aria-label': 'Saved jobs', class: 'plain-list' });
  for (const job of saved.jobs) {
    list.append(
      el('li', { 'data-id': job.id }, [
        el('a', { href: `/jobs/${job.id}`, text: `${job.title} at ${job.company_name}` }),
        el('p', {
          class: 'figures',
          text: `${job.city_name} · ${workPatternName(job.remote)} · ${moneyRange(job.pay_low, job.pay_high)}`,
        }),
      ]),
    );
  }
  page.append(list);
  return () => undefined;
}

interface Alert {
  id: string;
  label: string;
  new_count: number;
}

const FACET_NAMES: ReadonlyArray<{ param: string; names: ReadonlyArray<{ id: string; name: string }> }> = [
  { param: 'city', names: CITIES },
  { param: 'role', names: ROLE_FAMILIES },
  { param: 'remote', names: WORK_PATTERNS },
  { param: 'band', names: PAY_BANDS },
];

/** Turns an alert's published label back into the search it was saved from. */
function searchFor(label: string): string {
  if (label === 'All jobs') return '/jobs';
  const query = new URLSearchParams();
  const text: string[] = [];
  for (const part of label.split(', ')) {
    const facet = FACET_NAMES.find((candidate) => candidate.names.some((item) => item.name === part));
    const value = facet?.names.find((item) => item.name === part);
    if (facet && value) query.append(facet.param, value.id);
    else text.push(part);
  }
  if (text.length > 0) query.set('q', text.join(', '));
  return `/jobs?${query.toString()}`;
}

export async function renderAlerts(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: 'Alerts' })]);
  container.append(page);
  const alert = pageAlert(page);
  const list = el('ul', { 'aria-label': 'Saved alerts', class: 'plain-list' });
  page.append(list);

  let alerts: Alert[] = [];
  const paint = (): void => {
    list.replaceChildren();
    for (const item of alerts) {
      const seeJobs = el('a', { href: '#', text: `See jobs for ${item.label}` });
      on(seeJobs, 'click', (event) => {
        event.preventDefault();
        void post(`/api/alerts/${item.id}/seen`).then(() => navigate(searchFor(item.label)));
      });
      const deleteButton = el('button', {
        type: 'button',
        class: 'nav-action',
        'aria-label': `Delete alert ${item.label}`,
        text: 'Delete',
      });
      on(deleteButton, 'click', () => {
        const done = working(deleteButton);
        void remove(`/api/alerts/${item.id}`)
          .then(async () => {
            alerts = (await get<{ alerts: Alert[] }>('/api/alerts')).alerts;
            paint();
          })
          .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
          .finally(done);
      });
      list.append(
        el('li', { 'data-id': item.id }, [
          el('p', { class: 'alert-label', text: item.label }),
          el('p', { class: 'alert-count', text: newCountText(item.new_count) }),
          seeJobs,
          deleteButton,
        ]),
      );
    }
  };

  alerts = (await get<{ alerts: Alert[] }>('/api/alerts')).alerts;
  paint();

  const stopLive = onLive((messages) => {
    for (const message of messages) {
      if (message.type !== 'alert.matched') continue;
      const item = alerts.find((candidate) => candidate.id === String(message.data['alert_id']));
      if (!item) continue;
      item.new_count = Number(message.data['new_count']);
      paint();
    }
  });
  return stopLive;
}
