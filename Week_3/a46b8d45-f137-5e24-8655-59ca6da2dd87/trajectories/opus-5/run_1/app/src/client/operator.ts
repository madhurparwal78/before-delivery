/**
 * The operator's screens in the browser. The whole path works by keyboard alone, and every
 * refusal is announced in the page's one alert region.
 */

import { ApiRefusal, callApi, clearAlert, find, findAll, showAlert, showStatus, whilePressed } from './dom';
import { OPERATOR_SUCCESS, OPERATOR_WORKING, operatorWrongState, waitingNotices } from '../shared/copy';
import { FittingFan } from './fan';
import { isClaimState } from '../shared/claim-state';

interface ClaimView {
  reference: string;
  state: string;
  quotes: { revision: number; status: string; total_minor: number }[];
  payment: { paid_minor: number } | null;
  ruling: { edition: string } | null;
  notices_pending: number;
}

const WORKSPACE_POLL_MS = 10_000;

function newIdempotencyKey(): string {
  return `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Announces an operator refusal in the page's one alert region. */
function reportRefusal(error: unknown): void {
  if (!(error instanceof ApiRefusal)) return;
  const { code, message, state, fields } = error.failure;
  if (code === 'wrong_state' && state !== undefined && isClaimState(state)) {
    showAlert(operatorWrongState(state));
    return;
  }
  if (code === 'validation_failed' && fields !== undefined) {
    for (const [field, reason] of Object.entries(fields)) {
      const holder = find<HTMLElement>(`[data-field-error="${field.replace(/_/g, '-')}"]`);
      if (holder !== null) holder.textContent = reason;
    }
  }
  // The server's operator copy is already the published sentence.
  showAlert(message);
}

/* --------------------------------------------------------------------------- sign-in */

export function wireSignIn(): void {
  const form = find<HTMLFormElement>('#sign-in-form');
  if (form === null) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = find<HTMLButtonElement>('#sign-in');
    clearAlert();
    showStatus(OPERATOR_WORKING);
    void whilePressed(button, () =>
      callApi<void>('/api/ops/session', {
        method: 'POST',
        body: {
          email: find<HTMLInputElement>('#ops-email')?.value ?? '',
          password: find<HTMLInputElement>('#ops-password')?.value ?? '',
        },
      }),
    )
      .then(() => {
        showStatus('');
        window.location.assign('/ops/claims');
      })
      .catch((error: unknown) => {
        showStatus('');
        reportRefusal(error);
      });
  });
}

/* ------------------------------------------------------------------------- dialogs */

/**
 * Pressing the opener again while the dialog is fading out reopens it, and nothing left
 * over from the earlier close may hide it later.
 */
class Dialog {
  private closeTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly opener: HTMLElement,
  ) {
    for (const cancel of findAll<HTMLButtonElement>('[data-dialog-cancel]', root)) {
      cancel.addEventListener('click', () => this.close());
    }
    root.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key === 'Tab') this.keepFocusInside(event);
    });
  }

  private focusable(): HTMLElement[] {
    return findAll<HTMLElement>('button, input, [href], select, textarea', this.root).filter(
      (element) => !(element as HTMLButtonElement).disabled,
    );
  }

  /** Focus never leaves an open dialog: Tab wraps round its controls. */
  private keepFocusInside(event: KeyboardEvent): void {
    const stops = this.focusable();
    if (stops.length === 0) return;
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  open(): void {
    // Any timer from an earlier close is dropped, so it can never hide the dialog later.
    window.clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.root.hidden = false;
    this.root.classList.remove('is-closing');
    this.root.classList.add('is-open');
    const first = this.root.querySelector<HTMLElement>('[data-dialog-first]');
    first?.focus();
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.root.classList.add('is-closing');
    this.closeTimer = window.setTimeout(() => {
      // By the end of the fade it has left the screen and the accessibility tree.
      this.root.hidden = true;
      this.root.classList.remove('is-closing');
      this.opener.focus();
    }, 160);
  }
}

/* ----------------------------------------------------------------------- workspace */

export function wireWorkspace(reference: string): void {
  const workspace = find<HTMLElement>('.workspace');
  if (workspace === null) return;

  const fanRoot = find<HTMLElement>('.fan');
  const fan = fanRoot === null ? null : new FittingFan(fanRoot);

  const act = async (
    name: string,
    run: () => Promise<ClaimView | void>,
    success: (view: ClaimView) => string,
    addressAfter?: (view: ClaimView) => string,
  ): Promise<void> => {
    clearAlert();
    showStatus(OPERATOR_WORKING);
    try {
      const view = (await run()) as ClaimView;
      showStatus(success(view));
      if (addressAfter !== undefined) window.location.assign(addressAfter(view));
      else window.location.reload();
    } catch (error) {
      showStatus('');
      reportRefusal(error);
    }
  };

  const button = (action: string): HTMLButtonElement | null =>
    find<HTMLButtonElement>(`[data-action="${action}"]`);

  // Identify
  const identify = button('identify');
  identify?.addEventListener('click', () => {
    void whilePressed(identify, () =>
      act(
        'identify',
        () =>
          callApi<ClaimView>(`/api/ops/claims/${reference}/identify`, {
            method: 'POST',
            body: {
              model: find<HTMLSelectElement>('#identify-model')?.value ?? '',
              booklet_number: fan?.selected() ?? '',
              quantity: Number(find<HTMLInputElement>('#identify-quantity')?.value ?? '1'),
            },
          }),
        (view) => OPERATOR_SUCCESS.identified(view.ruling?.edition ?? ''),
        () => `/ops/claims/${reference}/quote`,
      ),
    );
  });

  // Quote and re-quote
  const quote = button('quote');
  quote?.addEventListener('click', () => {
    void whilePressed(quote, () =>
      act(
        'quote',
        () =>
          callApi<ClaimView>(`/api/ops/claims/${reference}/quote`, {
            method: 'POST',
            body: {},
            headers: { 'Idempotency-Key': newIdempotencyKey() },
          }),
        (view) => OPERATOR_SUCCESS.quoted(view.quotes[0]?.revision ?? 1),
        (view) => `/ops/claims/${reference}/quote/${view.quotes[0]?.revision ?? 1}`,
      ),
    );
  });

  // Payment leaves the address unchanged.
  const payment = button('payment');
  payment?.addEventListener('click', () => {
    void whilePressed(payment, () =>
      act(
        'payment',
        () =>
          callApi<ClaimView>(`/api/ops/claims/${reference}/payment`, {
            method: 'POST',
            body: {},
            headers: { 'Idempotency-Key': newIdempotencyKey() },
          }),
        (view) => OPERATOR_SUCCESS.payment(view.payment?.paid_minor ?? 0),
      ),
    );
  });

  const dispatch = button('dispatch');
  dispatch?.addEventListener('click', () => {
    void whilePressed(dispatch, () =>
      act(
        'dispatch',
        () =>
          callApi<ClaimView>(`/api/ops/claims/${reference}/dispatch`, {
            method: 'POST',
            body: {},
            headers: { 'Idempotency-Key': newIdempotencyKey() },
          }),
        () => OPERATOR_SUCCESS.dispatched(),
        () => `/ops/claims/${reference}/dispatched`,
      ),
    );
  });

  const close = button('close');
  close?.addEventListener('click', () => {
    void whilePressed(close, () =>
      act(
        'close',
        () => callApi<ClaimView>(`/api/ops/claims/${reference}/close`, { method: 'POST', body: {} }),
        () => OPERATOR_SUCCESS.closed(),
        () => `/ops/claims/${reference}`,
      ),
    );
  });

  const withdraw = button('withdraw-link');
  withdraw?.addEventListener('click', () => {
    void whilePressed(withdraw, () =>
      act(
        'withdraw',
        () => callApi<void>(`/api/ops/claims/${reference}/share-link`, { method: 'DELETE' }),
        () => OPERATOR_SUCCESS.linkWithdrawn(),
        () => `/ops/claims/${reference}`,
      ),
    );
  });

  const newLink = button('new-link');
  newLink?.addEventListener('click', () => {
    void whilePressed(newLink, () =>
      act(
        'new-link',
        () => callApi<ClaimView>(`/api/ops/claims/${reference}/share-link`, { method: 'POST', body: {} }),
        () => OPERATOR_SUCCESS.newLink(),
        () => `/ops/claims/${reference}`,
      ),
    );
  });

  wireDeclineDialog(reference, act);
  wireEraseDialog(reference, act);
  wireDisclosures();
  wireWaitingNotices(reference);
}

type Act = (
  name: string,
  run: () => Promise<ClaimView | void>,
  success: (view: ClaimView) => string,
  addressAfter?: (view: ClaimView) => string,
) => Promise<void>;

function wireDeclineDialog(reference: string, act: Act): void {
  const root = find<HTMLElement>('#decline-dialog');
  const opener = find<HTMLButtonElement>('[data-action="decline"]');
  if (root === null || opener === null) return;

  const dialog = new Dialog(root, opener);
  opener.addEventListener('click', () => dialog.open());

  const confirm = find<HTMLButtonElement>('#confirm-decline', root);
  const reasons = findAll<HTMLInputElement>('input[name="decline-reason"]', root);
  // Confirm decline needs a chosen reason.
  const refreshConfirm = (): void => {
    if (confirm !== null) confirm.disabled = !reasons.some((radio) => radio.checked);
  };
  for (const radio of reasons) radio.addEventListener('change', refreshConfirm);
  refreshConfirm();

  confirm?.addEventListener('click', () => {
    const reason = reasons.find((radio) => radio.checked)?.value ?? '';
    void whilePressed(confirm, () =>
      act(
        'decline',
        () =>
          callApi<ClaimView>(`/api/ops/claims/${reference}/decline`, {
            method: 'POST',
            body: { reason },
            headers: { 'Idempotency-Key': newIdempotencyKey() },
          }),
        () => OPERATOR_SUCCESS.declined(),
        () => `/ops/claims/${reference}/declined`,
      ),
    );
  });
}

function wireEraseDialog(reference: string, act: Act): void {
  const root = find<HTMLElement>('#erase-dialog');
  const opener = find<HTMLButtonElement>('[data-action="erase"]');
  if (root === null || opener === null) return;

  const dialog = new Dialog(root, opener);
  opener.addEventListener('click', () => dialog.open());

  const typed = find<HTMLInputElement>('#erase-reference', root);
  const confirm = find<HTMLButtonElement>('#erase-everything', root);
  // Erase everything stays enabled only while the typed text equals the reference exactly.
  const refreshConfirm = (): void => {
    if (confirm !== null) confirm.disabled = (typed?.value ?? '') !== reference;
  };
  typed?.addEventListener('input', refreshConfirm);
  refreshConfirm();

  confirm?.addEventListener('click', () => {
    void whilePressed(confirm, () =>
      act(
        'erase',
        () =>
          callApi<ClaimView>(`/api/ops/claims/${reference}/erase`, {
            method: 'POST',
            body: { confirm_reference: typed?.value ?? '' },
          }),
        () => OPERATOR_SUCCESS.erased(),
        () => `/ops/claims/${reference}`,
      ),
    );
  });
}

/** While the claim has notices waiting, the workspace keeps the waiting line up to date. */
function wireWaitingNotices(reference: string): void {
  const tick = (): void => {
    void callApi<ClaimView>(`/api/ops/claims/${reference}`)
      .then((view) => {
        const status = document.getElementById('desk-status');
        if (status === null) return;
        const waiting = view.notices_pending;
        const line = waitingNotices(waiting);
        const already = status.textContent ?? '';
        const withoutLine = already.replace(/Notices waiting to send: \d+/, '').trim();
        if (waiting > 0) {
          status.textContent = withoutLine === '' ? line : `${withoutLine} ${line}`;
        } else {
          status.textContent = withoutLine;
        }
        if (waiting > 0) window.setTimeout(tick, WORKSPACE_POLL_MS);
      })
      .catch(() => undefined);
  };
  window.setTimeout(tick, WORKSPACE_POLL_MS);
}

/* --------------------------------------------------------------------- disclosures */

export function wireDisclosures(): void {
  for (const toggle of findAll<HTMLButtonElement>('.disclosure-toggle')) {
    const panelId = toggle.getAttribute('aria-controls') ?? '';
    const panel = document.getElementById(panelId);
    if (panel === null) continue;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      // A collapsed disclosure is hidden, unfocusable and absent from the tree.
      panel.hidden = open;
    });
  }
}

/* ------------------------------------------------------------- imports and editions */

interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
  unmatched: { line: number; reason: string }[];
}

export function wireImports(): void {
  const button = find<HTMLButtonElement>('#import-file');
  const chooser = find<HTMLInputElement>('#supplier-file');
  const rows = find<HTMLElement>('#unmatched-rows');
  if (button === null || chooser === null || rows === null) return;

  button.addEventListener('click', () => {
    const file = chooser.files?.[0];
    if (file === undefined) return;
    clearAlert();
    showStatus(OPERATOR_WORKING);

    // The supplier file travels as the request body.
    void whilePressed(button, async () =>
      callApi<ImportReport>('/api/ops/imports', {
        method: 'POST',
        raw: { text: await file.text(), contentType: 'text/csv' },
      }),
    )
      .then((report) => {
        showStatus(OPERATOR_SUCCESS.importDone(report.created, report.updated, report.unchanged, report.unmatched.length));
        rows.innerHTML = '';
        for (const row of report.unmatched) {
          const tr = document.createElement('tr');
          const line = document.createElement('td');
          line.className = 'mono';
          line.textContent = String(row.line);
          const reason = document.createElement('td');
          reason.className = 'mono';
          reason.textContent = row.reason;
          tr.append(line, reason);
          rows.append(tr);
        }
      })
      .catch((error: unknown) => {
        showStatus('');
        reportRefusal(error);
      });
  });
}

export function wireEditions(): void {
  const form = find<HTMLFormElement>('#edition-form');
  if (form === null) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = find<HTMLButtonElement>('#save-edition');
    clearAlert();
    for (const holder of findAll<HTMLElement>('[data-field-error]')) holder.textContent = '';
    showStatus(OPERATOR_WORKING);

    void whilePressed(button, () =>
      callApi<{ code: string; starts_on: string }>('/api/ops/editions', {
        method: 'POST',
        body: {
          code: find<HTMLInputElement>('#edition-code')?.value ?? '',
          title: find<HTMLInputElement>('#edition-title')?.value ?? '',
          starts_on: find<HTMLInputElement>('#edition-starts-on')?.value ?? '',
          standard_months: Number(find<HTMLInputElement>('#edition-standard-months')?.value ?? '0'),
          club_months: Number(find<HTMLInputElement>('#edition-club-months')?.value ?? '0'),
          owner_contribution_percent: Number(
            find<HTMLInputElement>('#edition-owner-contribution-percent')?.value ?? '0',
          ),
        },
      }),
    )
      .then((edition) => {
        showStatus(OPERATOR_SUCCESS.editionSaved(edition.code, edition.starts_on));
        window.location.reload();
      })
      .catch((error: unknown) => {
        showStatus('');
        reportRefusal(error);
      });
  });
}
