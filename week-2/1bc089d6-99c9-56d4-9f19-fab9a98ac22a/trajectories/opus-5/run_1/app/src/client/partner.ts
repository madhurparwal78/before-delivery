import { call } from './modules/api.js';
import { COPY } from './modules/copy.js';
import { create, el } from './modules/dom.js';
import { startsAtLocal, type SharedPlan } from '../shared/plan.js';

const heading = el('shared-heading');
const when = el('shared-when');
const list = el('shared-rituals');
const total = el('shared-total');

/** The partner's read-only view: bedtime, time zone, rituals and total minutes. */
async function openShared(): Promise<void> {
  when.textContent = COPY.sharedLoading;
  const token = window.location.pathname.replace(/^\/p\//, '');
  const answer = await call<{ plan: SharedPlan }>('GET', `/api/share/${encodeURIComponent(token)}`);
  if (answer.status === 200 && answer.data) {
    const plan = answer.data.plan;
    when.textContent = `Winding down from ${startsAtLocal(plan.bedtime)} for bed at ${plan.bedtime}, ${plan.time_zone} time.`;
    list.replaceChildren(
      ...plan.rituals.map((ritual) => create('li', {}, `${ritual.title} · ${ritual.minutes} min`)),
    );
    total.textContent = `${plan.total_minutes} minutes in all`;
    return;
  }
  list.replaceChildren();
  total.textContent = '';
  if (answer.status === 503) {
    when.textContent = COPY.unavailable;
    return;
  }
  heading.textContent = COPY.sharedGone;
  when.textContent = '';
}

void openShared();
