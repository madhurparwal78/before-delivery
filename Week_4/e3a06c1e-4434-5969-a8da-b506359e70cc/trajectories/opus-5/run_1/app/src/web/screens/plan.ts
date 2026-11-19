import { ApiFailure, newIdempotencyKey, request } from '../api.js';
import { clear, el } from '../dom.js';
import { serviceStatus } from '../state.js';
import { StatusRegion } from '../ui/status.js';
import type { Screen } from '../router.js';
import { genericFailure, planCopy, planLabel } from '../../shared/copy.js';
import type { Plan, PlanChangeView } from '../../shared/types.js';

interface PlanReply {
  plan: Plan;
  billing_reachable: boolean;
  change: PlanChangeView | null;
}

export const planScreen = (): Screen => {
  const status = new StatusRegion('Plan status');
  const current = el('section', { 'aria-label': 'Current plan', class: 'current-plan' });
  const button = el('button', { type: 'button', class: 'button button-primary', text: 'Switch to Scale' });
  const actions = el('div', { class: 'tab-actions' }, [button]);
  const node = el('section', { class: 'screen' }, [
    el('div', { class: 'screen-header' }, [el('h1', { class: 'screen-title', text: 'Plan' })]),
    current,
    actions,
    status.node,
  ]);

  let idempotencyKey: string | null = null;
  let inFlight = false;
  let lastState: string | null = null;
  let target: Plan = 'scale';

  const render = (reply: PlanReply): void => {
    serviceStatus.setBillingReachable(reply.billing_reachable);
    clear(current);
    current.append(
      el('h2', { class: 'section-title', text: 'Current plan' }),
      el('p', { class: 'plan-name' }, [
        el('span', { class: 'plan-name-text', text: planLabel(reply.plan) }),
        el('span', { class: 'badge badge-accent', text: 'Active' }),
      ]),
    );
    if (reply.change !== null)
      current.append(
        el('p', {
          class: 'plan-change',
          text: `Change to ${planLabel(reply.change.target)}: ${reply.change.state}`,
        }),
      );

    target = reply.plan === 'pilot' ? 'scale' : 'pilot';
    button.textContent = `Switch to ${planLabel(target)}`;
    button.disabled = inFlight;

    const change = reply.change;
    const signature = change === null ? `plan:${reply.plan}` : `${change.id}:${change.state}`;
    if (signature === lastState) return;
    lastState = signature;
    if (change === null || change.state === 'confirmed') status.set(planCopy.confirmed(reply.plan));
    else if (change.state === 'requested') status.set(planCopy.requested(change.target));
    else status.set(planCopy.failed(reply.plan));
  };

  const switchPlan = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    button.disabled = true;
    idempotencyKey ??= newIdempotencyKey();
    try {
      const reply = await request<{ change: PlanChangeView }>('/api/org/plan-changes', {
        method: 'POST',
        json: { plan: target },
        idempotencyKey,
      });
      idempotencyKey = null;
      lastState = `${reply.change.id}:${reply.change.state}`;
      status.set(planCopy.requested(reply.change.target));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) idempotencyKey = null;
      if (error instanceof ApiFailure && error.code === 'billing_unavailable') {
        serviceStatus.setBillingReachable(false);
        status.set(planCopy.unreachable);
      } else if (!(error instanceof ApiFailure)) status.set(genericFailure);
    } finally {
      inFlight = false;
      button.disabled = false;
    }
  };

  const load = async (): Promise<void> => {
    render(await request<PlanReply>('/api/org/plan'));
  };

  button.addEventListener('click', () => void switchPlan());
  void load();
  const poll = window.setInterval(() => void load().catch(() => undefined), 2000);

  return { node, destroy: () => window.clearInterval(poll) };
};
