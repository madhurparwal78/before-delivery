import { request } from '../api.js';
import { clear, el, setText } from '../dom.js';
import { serviceStatus } from '../state.js';
import type { Screen } from '../router.js';
import { billableMinutesText, costText } from '../../shared/billing.js';
import type { UsageView } from '../../shared/types.js';

const badge = (state: 'confirmed' | 'pending'): HTMLElement =>
  el('span', {
    class: `badge badge-${state === 'confirmed' ? 'accent' : 'caution'}`,
    text: state === 'confirmed' ? 'Confirmed' : 'Pending',
  });

export const usageScreen = (): Screen => {
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Usage by project', class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Project' }),
        el('th', { scope: 'col', text: 'Sessions' }),
        el('th', { scope: 'col', text: 'Billable minutes' }),
        el('th', { scope: 'col', text: 'Cost' }),
        el('th', { scope: 'col', text: 'Status' }),
      ]),
    ]),
    body,
  ]);
  const totalMonth = el('p', { class: 'total-month' });
  const totalCost = el('p', { class: 'total-cost numeric' });
  const total = el('section', { 'aria-label': 'Organisation total', class: 'org-total' }, [
    el('h2', { class: 'section-title', text: 'Organisation total' }),
    totalMonth,
    totalCost,
  ]);

  const node = el('section', { class: 'screen' }, [
    el('div', { class: 'screen-header' }, [el('h1', { class: 'screen-title', text: 'Usage' })]),
    table,
    total,
  ]);

  const load = async (): Promise<void> => {
    const usage = await request<UsageView>('/api/usage');
    serviceStatus.setBillingReachable(usage.billing_reachable);
    clear(body);
    for (const project of usage.projects)
      body.append(
        el('tr', {}, [
          el('th', { scope: 'row', text: project.name }),
          el('td', { class: 'numeric', text: String(project.sessions) }),
          el('td', { class: 'numeric', text: billableMinutesText(project.billable_seconds) }),
          el('td', { class: 'numeric', text: costText(project.cost_cents) }),
          el('td', {}, [badge(project.billing_state)]),
        ]),
      );
    setText(totalMonth, usage.month);
    setText(totalCost, costText(usage.org_total_cents));
  };

  void load();
  const poll = window.setInterval(() => void load().catch(() => undefined), 3000);

  return { node, destroy: () => window.clearInterval(poll) };
};
