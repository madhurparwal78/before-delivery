// The partner page: a shared hour, read-only, with no email and no note.
import { qs, el, announce, fetchJson } from './dom.js';
import { startsAtLocal } from '../shared/plan.js';

interface SharedPlan {
  bedtime: string;
  time_zone: string;
  rituals: { id: string; title: string; minutes: number }[];
  total_minutes: number;
}

export function bootPartner(): void {
  const status = qs<HTMLElement>('#partner-status');
  const body = qs<HTMLElement>('#partner-body');
  const heading = qs<HTMLElement>('#partner-heading');
  const token = window.location.pathname.split('/').pop() ?? '';
  void (async () => {
    const res = await fetchJson<{ plan: SharedPlan }>(`/api/share/${encodeURIComponent(token)}`).catch(() => null);
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    if (res.status !== 200 || !res.body) {
      heading.textContent = 'This shared hour is no longer available.';
      status.textContent = '';
      return;
    }
    const plan = res.body.plan;
    status.hidden = true;
    body.hidden = false;
    const start = startsAtLocal(plan.bedtime);
    body.append(el('p', {}, `Winding down from ${start} for bed at ${plan.bedtime}, ${plan.time_zone} time.`));
    const list = el('ul', { class: 'partner-list', 'aria-label': 'Rituals' }) as HTMLUListElement;
    for (const ritual of plan.rituals) {
      list.append(el('li', {}, `${ritual.title} · ${ritual.minutes} min`));
    }
    body.append(list);
    body.append(el('p', { class: 'partner-total' }, `${plan.total_minutes} minutes in all`));
  })();
}
