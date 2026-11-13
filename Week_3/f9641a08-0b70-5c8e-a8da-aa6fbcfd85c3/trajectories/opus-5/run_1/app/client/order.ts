import {
  ApiError,
  announce,
  api,
  cartAnnounce,
  escapeHtml,
  jsonScript,
  newIdempotencyKey,
  qs,
  qsa,
  rupees,
  upload
} from './core.js';
import { closeDialog, openDialog } from './dialog.js';
import { onLive } from './live.js';

type Candidate = { sku: string; colour: string; size: string; available: number };

type OrderLine = {
  id: string;
  sku: string;
  product: string;
  colour: string;
  size: string;
  fulfillment: string;
  shipment: { carrier: string; tracking_number: string } | null;
  return_eligible: boolean;
  trial_eligible: boolean;
  warranty: { registration_id: string; covered_until: string } | null;
};

type Order = {
  number: string;
  status: string;
  version: number;
  payment: { status: string };
  lines: OrderLine[];
  timeline: Array<{ status: string; label: string; at: string }>;
};

const STATUS_WORDS: Record<string, string> = {
  placed: 'Placed',
  packed: 'Packed',
  partially_shipped: 'Partially shipped',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

const PAYMENT_WORDS: Record<string, string> = {
  pending: 'Pending',
  authorized: 'Authorized',
  captured: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  failed: 'Failed'
};

let candidates: Record<string, Candidate[]> = {};
let activeLineId = '';
let activeRegistrationId = '';
let caseKey = newIdempotencyKey();
const evidenceIds: string[] = [];

function orderNumber(): string {
  return document.body.dataset.order ?? '';
}

function radioValue(selector: string, attribute: string): string {
  return qs<HTMLElement>(`${selector} [role="radio"][aria-checked="true"]`)?.dataset[attribute] ?? '';
}

function bindRadioGroup(selector: string, onChange?: () => void): void {
  const group = qs<HTMLElement>(selector);
  if (group === null) return;
  group.addEventListener('click', (event) => {
    const radio = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (radio === null) return;
    for (const item of qsa<HTMLElement>('[role="radio"]', group)) {
      const on = item === radio;
      item.setAttribute('aria-checked', on ? 'true' : 'false');
      item.setAttribute('tabindex', on ? '0' : '-1');
    }
    if (onChange !== undefined) onChange();
  });
  group.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const radios = qsa<HTMLElement>('[role="radio"]', group);
    const index = radios.findIndex((item) => item.getAttribute('aria-checked') === 'true');
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = radios[(Math.max(0, index) + step + radios.length) % radios.length];
    for (const item of radios) {
      const on = item === next;
      item.setAttribute('aria-checked', on ? 'true' : 'false');
      item.setAttribute('tabindex', on ? '0' : '-1');
    }
    next.focus();
    if (onChange !== undefined) onChange();
  });
}

function renderExchangeOptions(): void {
  const group = qs<HTMLElement>('[data-exchange-group]');
  if (group === null) return;
  const outcome = radioValue('[data-outcome-group]', 'outcome');
  const list = candidates[activeLineId] ?? [];
  group.hidden = outcome !== 'exchange';
  group.innerHTML = list
    .map(
      (candidate, index) => `<button type="button" role="radio" aria-label="${escapeHtml(
        `${candidate.colour}, ${candidate.size}`
      )}" aria-checked="false" tabindex="${index === 0 ? '0' : '-1'}" data-exchange-sku="${escapeHtml(
        candidate.sku
      )}" ${candidate.available <= 0 ? 'disabled' : ''}>${escapeHtml(
        `${candidate.colour}, ${candidate.size}`
      )}</button>`
    )
    .join('');
  const exchangeRadio = qs<HTMLElement>('[data-outcome-group] [data-outcome="exchange"]');
  if (exchangeRadio !== null) {
    if (list.length === 0) exchangeRadio.setAttribute('disabled', '');
    else exchangeRadio.removeAttribute('disabled');
  }
}

function applyOrder(order: Order): void {
  const status = qs<HTMLElement>('[data-order-status]');
  if (status !== null) status.textContent = STATUS_WORDS[order.status] ?? order.status;
  const payment = qs<HTMLElement>('[data-payment-status]');
  if (payment !== null) payment.textContent = PAYMENT_WORDS[order.payment.status] ?? order.payment.status;
  const timeline = qs<HTMLElement>('[data-timeline]');
  if (timeline !== null) {
    timeline.innerHTML = order.timeline
      .map(
        (item) =>
          `<li>${escapeHtml(item.label)} — ${escapeHtml(
            new Date(item.at).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata'
            })
          )}</li>`
      )
      .join('');
  }
  for (const line of order.lines) {
    const group = qs<HTMLElement>(`[data-order-line="${line.id}"]`);
    if (group === null) continue;
    const tracking = qs<HTMLElement>('[data-line-tracking]', group);
    if (tracking !== null) {
      tracking.textContent = line.shipment === null ? '' : `${line.shipment.carrier} ${line.shipment.tracking_number}`;
    }
  }
  const cancelButton = qs<HTMLElement>('[data-cancel-open]');
  if (cancelButton !== null && order.status !== 'placed' && order.status !== 'packed') cancelButton.remove();
}

async function reload(): Promise<void> {
  try {
    const order = await api<Order>(`/api/orders/${orderNumber()}`);
    applyOrder(order);
  } catch {
    // Keep the rendered state.
  }
}

const CASE_PATHS: Record<string, string> = {
  return: '/api/returns',
  trial: '/api/trials',
  warranty: '/api/warranty/claims'
};

async function announceDecision(kind: string, number: string): Promise<void> {
  try {
    const record = await api<{ status: string; refund_amount: number | null; reject_reason: string | null }>(
      `${CASE_PATHS[kind]}/${number}`
    );
    if (record.status === 'rejected' && record.reject_reason !== null) {
      announce('cart-updates', `Rejected: ${record.reject_reason}`);
      return;
    }
    if (record.status === 'approved') {
      announce('cart-updates', kind === 'trial' ? 'Trial return approved' : 'Approved — ship it back within 14 days.');
      return;
    }
    if (record.status === 'refunded' && record.refund_amount !== null) {
      announce('cart-updates', `Refund issued: ${rupees(record.refund_amount)}.`);
    }
  } catch {
    // The case may belong to another session.
  }
}

async function submitReturn(button: HTMLButtonElement): Promise<void> {
  const errorHolder = qs<HTMLElement>('[data-return-error]');
  if (errorHolder !== null) errorHolder.textContent = '';
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Submitting';
  try {
    const outcome = radioValue('[data-outcome-group]', 'outcome');
    const result = await api<{ number: string }>('/api/returns', {
      method: 'POST',
      headers: { 'Idempotency-Key': caseKey },
      body: {
        order_line_id: activeLineId,
        quantity: Number(qs<HTMLInputElement>('[data-return-quantity]')?.value ?? '1'),
        reason: radioValue('[data-reason-group]', 'reason'),
        outcome,
        exchange_sku: outcome === 'exchange' ? radioValue('[data-exchange-group]', 'exchangeSku') : null
      }
    });
    cartAnnounce(`Return ${result.number} requested.`);
    closeDialog('return');
    await reload();
  } catch (error) {
    if (error instanceof ApiError && errorHolder !== null) {
      errorHolder.textContent = error.body.fields === undefined
        ? error.body.message
        : Object.values(error.body.fields)[0] ?? error.body.message;
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function submitTrial(button: HTMLButtonElement): Promise<void> {
  const errorHolder = qs<HTMLElement>('[data-trial-error]');
  if (errorHolder !== null) errorHolder.textContent = '';
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Submitting';
  try {
    const result = await api<{ number: string }>('/api/trials', {
      method: 'POST',
      headers: { 'Idempotency-Key': caseKey },
      body: {
        order_line_id: activeLineId,
        note: qs<HTMLTextAreaElement>('[data-trial-note]')?.value ?? ''
      }
    });
    cartAnnounce(`Trial return ${result.number} requested.`);
    closeDialog('trial');
    await reload();
  } catch (error) {
    if (error instanceof ApiError && errorHolder !== null) errorHolder.textContent = error.body.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function uploadEvidence(kind: 'photo' | 'receipt', file: File): Promise<void> {
  const progress = qs<HTMLElement>('[data-upload-progress]');
  const errorHolder = qs<HTMLElement>('[data-claim-error]');
  if (errorHolder !== null) errorHolder.textContent = '';
  if (progress !== null) progress.textContent = `Uploading ${file.name}`;
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', file);
  try {
    const stored = await upload<{ id: string; filename: string }>('/api/warranty/evidence', form, {
      'Idempotency-Key': newIdempotencyKey()
    });
    evidenceIds.push(stored.id);
    if (progress !== null) progress.textContent = `Uploaded ${stored.filename}`;
    const list = qs<HTMLElement>('[data-evidence-list]');
    if (list !== null) {
      const item = document.createElement('li');
      item.textContent = `${stored.filename} — Evidence stored`;
      list.appendChild(item);
    }
  } catch (error) {
    if (error instanceof ApiError && errorHolder !== null) {
      errorHolder.textContent = `${file.name}: ${error.body.message}`;
    }
    if (progress !== null) progress.textContent = '';
  }
}

async function submitClaim(button: HTMLButtonElement): Promise<void> {
  const errorHolder = qs<HTMLElement>('[data-claim-error]');
  if (errorHolder !== null) errorHolder.textContent = '';
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Submitting';
  try {
    const result = await api<{ number: string }>('/api/warranty/claims', {
      method: 'POST',
      headers: { 'Idempotency-Key': caseKey },
      body: {
        registration_id: activeRegistrationId,
        component: radioValue('[data-component-group]', 'component'),
        description: qs<HTMLTextAreaElement>('[data-claim-description]')?.value ?? '',
        evidence_ids: [...evidenceIds]
      }
    });
    cartAnnounce(`Claim ${result.number} submitted.`);
    closeDialog('claim');
    await reload();
  } catch (error) {
    if (error instanceof ApiError) {
      const copy =
        error.body.fields === undefined
          ? error.body.message
          : Object.values(error.body.fields)[0] ?? error.body.message;
      if (errorHolder !== null) errorHolder.textContent = copy;
      const descriptionError = qs<HTMLElement>('[data-error-for="description"]');
      if (descriptionError !== null && error.body.fields?.description !== undefined) {
        descriptionError.textContent = error.body.fields.description;
      }
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function setupOrder(): void {
  const data = jsonScript<{ order: Order; exchange_candidates: Record<string, Candidate[]> } | null>(
    'order-data',
    null
  );
  if (data === null) return;
  candidates = data.exchange_candidates;

  bindRadioGroup('[data-reason-group]');
  bindRadioGroup('[data-outcome-group]', renderExchangeOptions);
  bindRadioGroup('[data-exchange-group]');
  bindRadioGroup('[data-component-group]');

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const cancelOpen = target.closest<HTMLElement>('[data-cancel-open]');
    if (cancelOpen !== null) {
      event.preventDefault();
      openDialog('cancel', cancelOpen);
      qs<HTMLElement>('[data-dialog-close="cancel"]')?.focus();
      return;
    }

    const cancelConfirm = target.closest<HTMLButtonElement>('[data-cancel-confirm]');
    if (cancelConfirm !== null) {
      event.preventDefault();
      cancelConfirm.disabled = true;
      cancelConfirm.textContent = 'Cancelling';
      void api<Order>(`/api/orders/${orderNumber()}/cancel`, { method: 'POST' })
        .then((order) => {
          applyOrder(order);
          closeDialog('cancel');
          const heading = qs<HTMLElement>('h1');
          heading?.focus();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError) cartAnnounce(error.body.message);
        })
        .finally(() => {
          cancelConfirm.disabled = false;
          cancelConfirm.textContent = 'Yes, cancel order';
        });
      return;
    }

    const returnOpen = target.closest<HTMLElement>('[data-return-open]');
    if (returnOpen !== null) {
      event.preventDefault();
      activeLineId = returnOpen.dataset.returnOpen ?? '';
      caseKey = newIdempotencyKey();
      renderExchangeOptions();
      openDialog('return', returnOpen);
      return;
    }

    const trialOpen = target.closest<HTMLElement>('[data-trial-open]');
    if (trialOpen !== null) {
      event.preventDefault();
      activeLineId = trialOpen.dataset.trialOpen ?? '';
      caseKey = newIdempotencyKey();
      openDialog('trial', trialOpen);
      return;
    }

    const claimOpen = target.closest<HTMLElement>('[data-claim-open]');
    if (claimOpen !== null) {
      event.preventDefault();
      activeRegistrationId = claimOpen.dataset.claimOpen ?? '';
      caseKey = newIdempotencyKey();
      evidenceIds.length = 0;
      const list = qs<HTMLElement>('[data-evidence-list]');
      if (list !== null) list.innerHTML = '';
      openDialog('claim', claimOpen);
      return;
    }

    const register = target.closest<HTMLButtonElement>('[data-register-warranty]');
    if (register !== null) {
      event.preventDefault();
      register.disabled = true;
      void api<{ covered_until: string }>('/api/warranty/registrations', {
        method: 'POST',
        body: { order_line_id: register.dataset.registerWarranty }
      })
        .then(() => window.location.reload())
        .catch((error: unknown) => {
          if (error instanceof ApiError) cartAnnounce(error.body.message);
          register.disabled = false;
        });
      return;
    }

    if (target.closest('[data-add-photo]') !== null) {
      event.preventDefault();
      qs<HTMLInputElement>('[data-photo-input]')?.click();
      return;
    }
    if (target.closest('[data-add-receipt]') !== null) {
      event.preventDefault();
      qs<HTMLInputElement>('[data-receipt-input]')?.click();
      return;
    }

    const submitReturnButton = target.closest<HTMLButtonElement>('[data-submit-return]');
    if (submitReturnButton !== null) {
      event.preventDefault();
      if (!submitReturnButton.disabled) void submitReturn(submitReturnButton);
      return;
    }
    const submitTrialButton = target.closest<HTMLButtonElement>('[data-submit-trial]');
    if (submitTrialButton !== null) {
      event.preventDefault();
      if (!submitTrialButton.disabled) void submitTrial(submitTrialButton);
      return;
    }
    const submitClaimButton = target.closest<HTMLButtonElement>('[data-submit-claim]');
    if (submitClaimButton !== null) {
      event.preventDefault();
      if (!submitClaimButton.disabled) void submitClaim(submitClaimButton);
    }
  });

  const photoInput = qs<HTMLInputElement>('[data-photo-input]');
  photoInput?.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (file !== undefined) void uploadEvidence('photo', file);
  });
  const receiptInput = qs<HTMLInputElement>('[data-receipt-input]');
  receiptInput?.addEventListener('change', () => {
    const file = receiptInput.files?.[0];
    if (file !== undefined) void uploadEvidence('receipt', file);
  });

  onLive((type, payload) => {
    if (type === 'order' && payload.number === orderNumber()) {
      void reload();
    }
    if (type === 'return' || type === 'trial' || type === 'warranty') {
      void announceDecision(type, String(payload.number));
      void reload();
    }
  });

  if (new URLSearchParams(window.location.search).get('placed') === '1') {
    qs<HTMLElement>('[data-confirmation]')?.focus();
  }

  void reload();
}
