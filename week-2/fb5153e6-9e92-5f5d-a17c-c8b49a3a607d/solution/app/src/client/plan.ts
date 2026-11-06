import { all, manageDialog, one, readState, setText } from './dom.js';
import { call, newIdempotencyKey } from './api.js';
import { notify, showFailure } from './forms.js';
import { formatAmount, formatDate, localeFromLang } from '../shared/locale.js';
import { downgradeAccepted, pendingChangeLine, s, upgradeDone } from '../shared/strings.js';

interface PlanState {
  current: string;
  labels: Record<string, string>;
}

const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));
const state = readState<PlanState>('plan-state');
const dialog = one<HTMLDialogElement>('[data-plan-dialog]');
const alertNode = one('[data-plan-alert]');

/** The page reads as the reply describes, at once, without waiting for the reload. */
function showPlan(current: string, pending: { plan: string; effective_date: string } | null): void {
  if (state === null) return;
  const currentNode = one('[data-current-plan]');
  if (currentNode !== null) {
    currentNode.setAttribute('data-current-plan', current);
    setText(currentNode, state.labels[current] ?? current);
  }
  let line = one('[data-pending-change]');
  if (pending === null) {
    line?.remove();
    return;
  }
  if (line === null && currentNode !== null) {
    line = document.createElement('p');
    line.setAttribute('data-pending-change', 'true');
    currentNode.after(line);
  }
  if (line !== null) {
    setText(
      line,
      pendingChangeLine(state.labels[pending.plan] ?? pending.plan, formatDate(pending.effective_date, locale), locale),
    );
  }
}

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
        showPlan(reply.plan, reply.pending);
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
