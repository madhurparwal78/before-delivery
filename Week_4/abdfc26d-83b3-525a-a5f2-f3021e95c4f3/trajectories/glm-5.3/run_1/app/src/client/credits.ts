import { api } from './api.js';
import { announce, observeEntrances, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);
  if (!me) {
    window.location.href = '/auth/login?return_to=/studio/credits';
    return;
  }
  const status = document.querySelector<HTMLElement>('[data-credits-status]');

  const credits = await api<{ available: number; held: number }>('GET', '/api/me/credits');
  const creditsLine = document.querySelector<HTMLElement>('[data-credits-line]');
  if (credits.ok && creditsLine) {
    const body = credits.body as { available: number; held: number };
    creditsLine.textContent = `${body.available} available · ${body.held} reserved`;
  }

  const planResult = await api<{ plan: { code: 'studio-monthly' | 'pro-monthly'; state: string; ends_on: string | null } | null }>('GET', '/api/me/plan');
  const planLine = document.querySelector<HTMLElement>('[data-plan-line]');
  const cancelBtn = document.querySelector<HTMLButtonElement>('[data-cancel-plan]');
  const current = planResult.ok ? (planResult.body as { plan: { code: string; state: string; ends_on: string | null } | null }).plan : null;
  if (planLine) {
    if (!current) planLine.textContent = `No plan yet.`;
    else if (current.state === 'pending_payment') planLine.textContent = `Waiting for Kill Bill to confirm your payment.`;
    else if (current.state === 'active') planLine.textContent = `Your ${current.code === 'studio-monthly' ? 'Studio' : 'Pro'} plan is active.`;
    else if (current.state === 'cancelling' && current.ends_on) planLine.textContent = `Your plan ends on ${current.ends_on}.`;
    else if (current.state === 'ended') planLine.textContent = `Your plan ended.`;
  }
  if (cancelBtn) {
    cancelBtn.hidden = !(current && (current.state === 'active' || current.state === 'cancelling'));
  }

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-choose-plan]'))) {
    const plan = button.dataset.choosePlan ?? '';
    button.addEventListener('click', async () => {
      const result = await api<unknown>('POST', '/api/me/plan', { plan });
      if (result.status === 503) {
        announce(status, `Payments are offline right now. Your hold is kept until its timer runs out.`);
        return;
      }
      if (result.status === 409) {
        announce(status, `You already have a plan.`);
        return;
      }
      if (result.ok) {
        announce(status, `Waiting for Kill Bill to confirm your payment.`);
        window.setTimeout(() => window.location.reload(), 4000);
      }
    });
  }

  cancelBtn?.addEventListener('click', async () => {
    const result = await api<{ plan: { ends_on: string | null } }>('POST', '/api/me/plan/cancel');
    if (result.status === 409) {
      const body = result.body as { error: { code: string } };
      announce(status, body.error.code === 'plan_not_confirmed'
        ? `Your plan can be cancelled once Kill Bill confirms it.`
        : `You do not have a plan to cancel.`);
      return;
    }
    if (result.ok) {
      const body = result.body as { plan: { ends_on: string | null } };
      announce(status, `Your plan ends on ${body.plan.ends_on}.`);
      window.setTimeout(() => window.location.reload(), 3000);
    }
  });

  const packBtn = document.querySelector<HTMLButtonElement>('[data-buy-pack]');
  packBtn?.addEventListener('click', async () => {
    const key = cryptoRandom();
    const result = await api<unknown>('POST', '/api/me/credit-packs', { pack: 'pack-500' }, { idempotencyKey: key });
    if (result.status === 503) {
      announce(status, `Payments are offline right now. Your hold is kept until its timer runs out.`);
      return;
    }
    if (result.ok) {
      announce(status, `Waiting for Kill Bill to confirm your payment.`);
      window.setTimeout(() => window.location.reload(), 5000);
    }
  });

  observeEntrances();
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

void main();
