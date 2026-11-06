import { all, manageDialog, one, readState, setText } from './dom.js';
import { call, newIdempotencyKey } from './api.js';
import { notify, showFailure } from './forms.js';
import { formatAmount, formatDate, localeFromLang } from '../shared/locale.js';
import { downgradeAccepted, s, upgradeDone } from '../shared/strings.js';

interface PlanState {
  current: string;
  labels: Record<string, string>;
}

const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));
const state = readState<PlanState>('plan-state');
const dialog = one<HTMLDialogElement>('[data-plan-dialog]');
const alertNode = one('[data-plan-alert]');

if (state !== null && dialog !== null) {
  const targetNode = one('[data-plan-target]', dialog);
  let opener: HTMLElement | null = null;
  let target = '';
  const handle = manageDialog(dialog, () => opener);

  for (const button of all<HTMLButtonElement>('[data-switch-plan]')) {
    button.addEventListener('click', () => {
      opener = button;
      target = button.dataset.switchPlan ?? '';
      setText(targetNode, state.labels[target] ?? target);
      setText(alertNode, '');
      handle.open();
    });
  }

  one<HTMLButtonElement>('[data-cancel-plan]', dialog)?.addEventListener('click', () =>
    handle.close(),
  );

  one<HTMLButtonElement>('[data-confirm-plan]', dialog)?.addEventListener('click', () => {
    void (async () => {
      notify(s('noticePlanPending', locale));
      try {
        const reply = await call<{
          plan: string;
          pending: { plan: string; effective_date: string } | null;
          charged_cents?: number;
        }>('/api/studio/plan', {
          method: 'POST',
          locale,
          idempotencyKey: newIdempotencyKey(),
          body: { plan: target },
        });
        handle.close();
        const label = state.labels[target] ?? target;
        if (reply.pending !== null) {
          notify(downgradeAccepted(label, formatDate(reply.pending.effective_date, locale), locale));
        } else {
          notify(upgradeDone(label, formatAmount(reply.charged_cents ?? 0, locale), locale));
        }
        window.setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        notify('');
        showFailure(alertNode, error, locale, null);
      }
    })();
  });
}
