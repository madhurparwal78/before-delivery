import { api, formatPrice, type Catalog, type Membership } from '../api.ts';
import { shell, openDialog, closeDialog, errorSummary, clearErrorSummary, notice, newIdempotencyKey, isApiFailure } from '../shell.ts';

/** Support: the three tiers, the plan dialog and the donation form. */

export async function initSupportPage(): Promise<void> {
  await renderTiers();
  wirePlanDialog();
  wireDonateForm();
}

async function renderTiers(): Promise<void> {
  const grid = document.querySelector<HTMLElement>('[data-role="tiers"]');
  if (!grid) return;
  let catalog: Catalog | null = null;
  try {
    catalog = await api.get<Catalog>('/api/catalog');
  } catch {
    catalog = null;
  }
  const slots = Array.from(grid.querySelectorAll<HTMLElement>('[data-tier]'));
  for (const slot of slots) {
    const tier = slot.dataset['tier'] ?? '';
    const priceEl = slot.querySelector<HTMLElement>('[data-role="tier-price"]');
    const changeEl = slot.querySelector<HTMLElement>('[data-role="tier-change"]');
    if (!catalog) {
      if (priceEl) priceEl.textContent = 'Prices are unavailable right now.';
      if (changeEl) changeEl.textContent = '';
      continue;
    }
    const entry = catalog.tiers.find((t) => t.tier === tier);
    if (!entry) continue;
    if (priceEl) {
      priceEl.textContent = `${formatPrice(entry.prices['EUR'] ?? 0, 'EUR')} a month`;
    }
    if (changeEl) {
      const scheduled = entry.scheduled_changes.find((c) => c.currency === 'EUR');
      changeEl.textContent = scheduled ? `From ${scheduled.effective_on}: ${formatPrice(scheduled.amount_minor, 'EUR')} a month` : '';
    }
  }
}

let planKey = newIdempotencyKey();

export function wirePlanDialog(): void {
  for (const opener of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action="support"], [data-action="choose-plan"]'))) {
    opener.addEventListener('click', () => void openPlanDialog(opener));
  }
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-plan');
  if (!dialog) return;
  if (dialog.dataset['wired'] === '1') return;
  dialog.dataset['wired'] = '1';

  for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="plan-tier"]'))) {
    radio.addEventListener('change', () => void refreshPlanState(dialog));
  }
  for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="plan-currency"]'))) {
    radio.addEventListener('change', () => void refreshPlanState(dialog));
  }
  const joinButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-join"]');
  joinButton?.addEventListener('click', () => void submitJoin(dialog));
  const changeButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-change"]');
  changeButton?.addEventListener('click', () => void submitChange(dialog));
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-cancel"]');
  cancelButton?.addEventListener('click', () => void submitCancel(dialog));
  const undoButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-undo"]');
  undoButton?.addEventListener('click', () => void submitUndo(dialog));
}

async function openPlanDialog(opener: HTMLButtonElement): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-plan');
  if (!dialog) return;
  clearErrorSummary(dialog);
  openDialog('dialog-plan', opener);
  await refreshPlanState(dialog);
}

/** After any membership action answers, and after a refusal, the dialog reads the confirmed state again. */
async function refreshPlanState(dialog: HTMLDialogElement): Promise<void> {
  const priceStatus = dialog.querySelector<HTMLElement>('[data-role="plan-price"]');
  let catalog: Catalog | null = null;
  try {
    catalog = await api.get<Catalog>('/api/catalog');
  } catch {
    catalog = null;
  }
  let membership: Membership | null = null;
  try {
    const res = await api.get<{ membership: Membership | null }>('/api/me/membership');
    membership = res.membership;
  } catch {
    membership = null;
  }

  const tier = dialog.querySelector<HTMLInputElement>('[data-role="plan-tier"]:checked')?.value ?? 'reader';
  const currency = dialog.querySelector<HTMLInputElement>('[data-role="plan-currency"]:checked')?.value ?? 'EUR';

  if (priceStatus) {
    if (!catalog) {
      priceStatus.textContent = 'Prices are unavailable right now.';
    } else {
      const entry = catalog.tiers.find((t) => t.tier === tier);
      const amount = entry?.prices[currency] ?? 0;
      priceStatus.textContent = `${formatPrice(amount, currency)} a month`;
    }
  }

  // Currency radios: disabled with the currency-locked copy when the account currency is fixed.
  const lockedCurrency = membership && membership.status !== 'cancelled' ? membership.currency : null;
  for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="plan-currency"]'))) {
    const locked = lockedCurrency !== null && radio.value !== lockedCurrency;
    radio.disabled = locked;
    const label = dialog.querySelector(`[data-currency-label="${radio.value}"]`);
    if (label) {
      label.textContent = locked ? `${radio.value} — your supporter account pays in ${lockedCurrency}` : radio.value;
      label.classList.toggle('muted', locked);
    }
  }

  // Members see their current tier checked, and only legal action buttons.
  const joinButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-join"]');
  const changeButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-change"]');
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-cancel"]');
  const undoButton = dialog.querySelector<HTMLButtonElement>('[data-role="plan-undo"]');
  const signInToJoin = dialog.querySelector<HTMLButtonElement>('[data-role="plan-sign-in"]');
  const cardField = dialog.querySelector<HTMLElement>('[data-role="plan-card"]');
  const pendingNote = dialog.querySelector<HTMLElement>('[data-role="plan-pending"]');
  if (pendingNote) pendingNote.textContent = '';

  if (!shell.user) {
    if (signInToJoin) signInToJoin.hidden = false;
    if (joinButton) joinButton.hidden = true;
    if (changeButton) changeButton.hidden = true;
    if (cancelButton) cancelButton.hidden = true;
    if (undoButton) undoButton.hidden = true;
    if (cardField) cardField.hidden = true;
    return;
  }
  if (signInToJoin) signInToJoin.hidden = true;

  if (!membership || membership.status === 'cancelled') {
    if (joinButton) joinButton.hidden = false;
    if (changeButton) changeButton.hidden = true;
    if (cancelButton) cancelButton.hidden = true;
    if (undoButton) undoButton.hidden = true;
    if (cardField) cardField.hidden = false;
    return;
  }

  // Check the member's current tier.
  for (const radio of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-role="plan-tier"]'))) {
    radio.checked = radio.value === membership.tier;
  }
  if (cardField) cardField.hidden = true;
  if (changeButton) changeButton.hidden = false;
  if (cancelButton) cancelButton.hidden = false;
  const canUndo = membership.status === 'pending_change';
  if (undoButton) undoButton.hidden = !canUndo;
  if (pendingNote && membership.status === 'pending_change' && membership.pending) {
    const pending = membership.pending;
    pendingNote.textContent = pending.kind === 'downgrade'
      ? `Changes to ${pending.tier} on ${pending.effective_on}.`
      : `Ends on ${pending.effective_on}.`;
  }
  if (membership.status === 'overdue' && pendingNote) {
    pendingNote.textContent = `Payment of ${formatPrice(membership.amount_due_minor ?? 0, membership.currency)} is overdue.`;
  }
}

async function submitJoin(dialog: HTMLDialogElement): Promise<void> {
  clearErrorSummary(dialog);
  const tier = dialog.querySelector<HTMLInputElement>('[data-role="plan-tier"]:checked')?.value ?? 'reader';
  const currency = dialog.querySelector<HTMLInputElement>('[data-role="plan-currency"]:checked')?.value ?? 'EUR';
  const card = dialog.querySelector<HTMLInputElement>('[data-role="plan-card-input"]')?.value ?? '';
  notice('Processing payment, please wait.');
  try {
    const res = await api.post<{ membership: Membership; receipt_email: string }>('/api/me/membership', { tier, currency, card_number: card }, planKey);
    planKey = newIdempotencyKey();
    notice(`Welcome, ${res.membership.tier_name} supporter.`);
    await refreshPlanState(dialog);
  } catch (e) {
    await handlePlanError(dialog, e);
  }
}

async function submitChange(dialog: HTMLDialogElement): Promise<void> {
  clearErrorSummary(dialog);
  const tier = dialog.querySelector<HTMLInputElement>('[data-role="plan-tier"]:checked')?.value ?? 'reader';
  notice('Processing payment, please wait.');
  try {
    const res = await api.post<{ membership: Membership; order: unknown; receipt_email: string | null }>('/api/me/membership/change', { tier }, planKey);
    planKey = newIdempotencyKey();
    const membership = res.membership;
    if (membership.status === 'pending_change' && membership.pending?.kind === 'downgrade') {
      notice(`Your change to ${membership.pending.tier} is pending until ${membership.pending.effective_on}.`);
    } else {
      notice(`You're now a ${membership.tier_name} supporter.`);
    }
    await refreshPlanState(dialog);
  } catch (e) {
    await handlePlanError(dialog, e);
  }
}

async function submitCancel(dialog: HTMLDialogElement): Promise<void> {
  clearErrorSummary(dialog);
  try {
    const res = await api.post<{ membership: Membership }>('/api/me/membership/cancel', {}, planKey);
    planKey = newIdempotencyKey();
    const membership = res.membership;
    if (membership.pending?.kind === 'cancel') {
      notice(`Your membership ends on ${membership.pending.effective_on}.`);
    } else {
      notice('Your membership has been cancelled.');
    }
    await refreshPlanState(dialog);
  } catch (e) {
    await handlePlanError(dialog, e);
  }
}

async function submitUndo(dialog: HTMLDialogElement): Promise<void> {
  clearErrorSummary(dialog);
  try {
    await api.post<{ membership: Membership }>('/api/me/membership/undo', {}, planKey);
    planKey = newIdempotencyKey();
    notice('Your pending change was undone.');
    await refreshPlanState(dialog);
  } catch (e) {
    await handlePlanError(dialog, e);
  }
}

async function handlePlanError(dialog: HTMLDialogElement, e: unknown): Promise<void> {
  if (isApiFailure(e)) {
    errorSummary(dialog, e.message, e.fields);
    notice(e.message);
  } else {
    errorSummary(dialog, 'Something went wrong.');
  }
  // After a refusal the dialog reads the confirmed state again.
  await refreshPlanState(dialog).catch(() => undefined);
}

function wireDonateForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-role="donate-form"]');
  if (!form) return;
  let key = newIdempotencyKey();
  let signature = '';
  let pending = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    const amount = form.querySelector<HTMLInputElement>('[data-role="donate-amount"]')?.value ?? '';
    const currency = form.querySelector<HTMLInputElement>('[data-role="donate-currency"]:checked')?.value ?? 'EUR';
    const card = form.querySelector<HTMLInputElement>('[data-role="donate-card"]')?.value ?? '';
    const note = form.querySelector<HTMLInputElement>('[data-role="donate-note"]')?.value ?? '';

    // One Idempotency-Key for one set of field values, including after a lost reply.
    const nextSignature = [amount, currency, card, note].join('|');
    if (nextSignature !== signature) {
      signature = nextSignature;
      key = newIdempotencyKey();
    }

    pending = true;
    const donateButton = form.querySelector<HTMLButtonElement>('[data-role="donate-submit"]');
    if (donateButton) donateButton.disabled = true;
    notice('Processing payment, please wait.');
    try {
      const minor = parseAmountMinor(amount, currency);
      if (minor === null) {
        const alert = form.querySelector<HTMLElement>('[data-role="alert"]');
        if (alert) {
          alert.textContent = '';
          const ul = document.createElement('ul');
          ul.className = 'alert-list';
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = '#';
          a.textContent = 'Enter an amount such as 25.00, or a whole number for yen.';
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            form.querySelector<HTMLInputElement>('[data-role="donate-amount"]')?.focus();
          });
          li.appendChild(a);
          ul.appendChild(li);
          alert.appendChild(ul);
          alert.hidden = false;
        }
        return;
      }
      const res = await api.post<{ order: { amount_minor: number; currency: string }; receipt_email: string }>(
        '/api/donations',
        { amount_minor: minor, currency, card_number: card, note },
        key,
      );
      notice(`Donation of ${formatPrice(res.order.amount_minor, res.order.currency)} received.`);
      const heading = form.querySelector<HTMLElement>('[data-role="donate-thanks"]');
      if (heading) heading.hidden = false;
      form.querySelector<HTMLInputElement>('[data-role="donate-card"]')!.value = '';
    } catch (e) {
      if (isApiFailure(e)) {
        const alert = form.querySelector<HTMLElement>('[data-role="alert"]');
        if (alert) {
          alert.textContent = e.message;
          alert.hidden = false;
        }
        notice(e.message);
      } else {
        // A reply that never arrives: the fields stay as entered and the same key is reused.
        const alert = form.querySelector<HTMLElement>('[data-role="alert"]');
        if (alert) {
          alert.textContent = 'Connection lost. Press Donate again to finish safely.';
          alert.hidden = false;
        }
      }
    } finally {
      pending = false;
      if (donateButton) donateButton.disabled = false;
    }
  });
}

/** "25" or "25.00" for two-decimal currencies, a whole number for yen. */
export function parseAmountMinor(text: string, currency: string): number | null {
  const t = text.trim();
  if (currency === 'JPY') {
    if (!/^\d+$/.test(t)) return null;
    return Number(t);
  }
  const m = t.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return whole * 100 + frac;
}

void closeDialog;
