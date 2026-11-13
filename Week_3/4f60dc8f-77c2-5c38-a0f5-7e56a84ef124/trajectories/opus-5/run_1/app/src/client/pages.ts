import {
  INVOICE_STATUS_WORD,
  type EngagementView,
  type InvoiceView,
  type ReviewView,
} from '../shared/domain.js';
import { formatMoney, type CurrencyCode } from '../shared/money.js';
import { payByLine } from '../shared/format.js';
import { SIGNIN_SENT_COPY } from '../shared/errors.js';
import {
  announce,
  api,
  createDialog,
  onBreakpointChange,
  pending,
  qs,
  qsa,
  setFieldErrors,
  showErrorSummary,
} from './core.js';
import { initOutage } from './chrome.js';

export const initStartForm = (): void => {
  const form = qs<HTMLFormElement>('[data-start-form]');
  if (form === null) return;
  const submit = qs<HTMLButtonElement>('[data-submit]', form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    for (const input of qsa<HTMLInputElement>('input[data-field]', form))
      body[input.dataset.field ?? ''] = input.value.trim();
    const currency = qsa<HTMLInputElement>('input[name="currency"]', form).find(
      (input) => input.checked,
    );
    body.currency = currency?.value ?? '';
    if (body.finance_email === '') delete body.finance_email;
    pending(submit, 'Starting');
    void (async () => {
      const result = await api<{ engagement: EngagementView }>('/api/projects/start', { body });
      pending(submit, null);
      setFieldErrors(form, result.body.fields);
      if (!result.ok) {
        showErrorSummary(form, result.body.fields, result.body.message ?? '');
        return;
      }
      window.location.assign(`/rig/${result.body.engagement.id}`);
    })();
  });
};

export const initSignInForm = (next: string | null): void => {
  const form = qs<HTMLFormElement>('[data-signin-form]');
  if (form === null) return;
  const email = qs<HTMLInputElement>('[data-field="email"]', form);
  const code = qs<HTMLInputElement>('[data-field="code"]', form);
  const sendButton = qs<HTMLButtonElement>('[data-send-code]', form);
  const signInButton = qs<HTMLButtonElement>('[data-signin]', form);
  const note = qs<HTMLElement>('[data-signin-note]', form);

  sendButton?.addEventListener('click', () => {
    pending(sendButton, 'Sending');
    void (async () => {
      const result = await api<{ status: string }>('/api/session/code', {
        body: { email: email?.value.trim() ?? '' },
      });
      pending(sendButton, null);
      if (result.status === 429) {
        setFieldErrors(form, { email: result.body.message ?? '' });
        showErrorSummary(form, { email: result.body.message ?? '' }, result.body.message ?? '');
        return;
      }
      if (!result.ok) {
        setFieldErrors(form, result.body.fields);
        showErrorSummary(form, result.body.fields, result.body.message ?? '');
        return;
      }
      setFieldErrors(form, {});
      if (note !== null) note.textContent = SIGNIN_SENT_COPY;
    })();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    pending(signInButton, 'Sending');
    void (async () => {
      const result = await api<{ landing: string }>('/api/session', {
        body: { email: email?.value.trim() ?? '', code: code?.value.trim() ?? '', next },
      });
      pending(signInButton, null);
      if (!result.ok) {
        setFieldErrors(form, { code: result.body.message ?? '' });
        showErrorSummary(form, { code: result.body.message ?? '' }, result.body.message ?? '');
        return;
      }
      window.location.assign(result.body.landing);
    })();
  });
};

const paintInvoiceLayout = (): void => {
  const wide = qs<HTMLElement>('[data-invoices-wide]');
  const medium = qs<HTMLElement>('[data-invoices-medium]');
  const cards = qs<HTMLElement>('[data-invoices-cards]');
  if (wide === null || medium === null || cards === null) return;
  onBreakpointChange((phone, tablet) => {
    wide.hidden = phone || tablet;
    medium.hidden = !tablet;
    cards.hidden = !phone;
  });
};

const paintStatusWords = (): void => {
  for (const node of qsa<HTMLElement>('.status-word')) {
    const word = node.textContent ?? '';
    const key = (Object.keys(INVOICE_STATUS_WORD) as (keyof typeof INVOICE_STATUS_WORD)[]).find(
      (status) => INVOICE_STATUS_WORD[status] === word,
    );
    if (key !== undefined) node.dataset.status = key;
  }
};

export const initEngagementPage = (engagement: EngagementView): void => {
  const root = qs<HTMLElement>('[data-engagement]');
  if (root === null) return;
  const engagementId = root.dataset.engagement ?? '';
  const outage = initOutage('engagement');
  const currency = engagement.quote.currency as CurrencyCode;
  const success = qs<HTMLElement>('[data-engagement-success]');
  const dialogElement = qs<HTMLElement>('[data-pay-dialog]');
  const dialog = dialogElement === null ? null : createDialog(dialogElement);
  let invoices = engagement.invoices;
  let payingInvoice: InvoiceView | null = null;
  let paymentKey = '';

  paintInvoiceLayout();
  paintStatusWords();

  const repaint = (): void => {
    for (const invoice of invoices) {
      for (const node of qsa<HTMLElement>(`[data-pay-invoice="${invoice.id}"]`))
        node.hidden =
          invoice.status !== 'issued' &&
          invoice.status !== 'payment_failed' &&
          invoice.status !== 'overdue';
    }
    const rows = qsa<HTMLElement>('[data-invoices] tbody tr');
    void rows;
    paintStatusWords();
  };

  const refresh = async (): Promise<void> => {
    const result = await api<EngagementView>(`/api/engagements/${engagementId}`);
    if (!result.ok) {
      outage.noteFromError(result.body.error);
      return;
    }
    invoices = result.body.invoices;
    for (const invoice of invoices) {
      for (const container of qsa<HTMLElement>('[data-invoices] tbody tr, [data-invoices] li')) {
        const button = qs<HTMLElement>(`[data-pay-invoice="${invoice.id}"]`, container);
        if (button === null) continue;
        const word = qs<HTMLElement>('.status-word', container);
        if (word !== null) {
          word.textContent = INVOICE_STATUS_WORD[invoice.status];
          word.dataset.status = invoice.status;
        }
        const payBy = qs<HTMLElement>('.pay-by', container);
        const line =
          invoice.status === 'payment_failed' && invoice.overdue_at !== null
            ? payByLine(invoice.overdue_at)
            : '';
        if (payBy !== null) payBy.textContent = line;
        else if (line !== '') {
          const node = document.createElement('span');
          node.className = 'pay-by';
          node.textContent = line;
          word?.after(node);
        }
      }
    }
    repaint();
  };

  for (const button of qsa<HTMLButtonElement>('[data-pay-invoice]')) {
    button.addEventListener('click', () => {
      if (dialog === null) return;
      const invoiceId = button.dataset.payInvoice ?? '';
      payingInvoice = invoices.find((invoice) => invoice.id === invoiceId) ?? null;
      if (payingInvoice === null) return;
      paymentKey = crypto.randomUUID();
      const name = `Pay invoice ${payingInvoice.number ?? ''}`;
      dialog.element.setAttribute('aria-label', name);
      const heading = qs<HTMLElement>('h2', dialog.element);
      if (heading !== null) heading.textContent = name;
      const confirm = qs<HTMLButtonElement>('[data-dialog-confirm]', dialog.element);
      if (confirm !== null)
        confirm.textContent = `Pay ${formatMoney(BigInt(payingInvoice.amount_minor), currency)}`;
      dialog.open(button);
    });
  }

  if (dialog !== null) {
    qs<HTMLButtonElement>('[data-dialog-cancel]', dialog.element)?.addEventListener('click', () =>
      dialog.close(),
    );
    const confirm = qs<HTMLButtonElement>('[data-dialog-confirm]', dialog.element);
    const errorSlot = qs<HTMLElement>('[data-dialog-error]', dialog.element);
    confirm?.addEventListener('click', () => {
      if (payingInvoice === null) return;
      const invoiceId = payingInvoice.id;
      const card = {
        number: qs<HTMLInputElement>('[data-card="number"]', dialog.element)?.value ?? '',
        expiry: qs<HTMLInputElement>('[data-card="expiry"]', dialog.element)?.value ?? '',
        cvc: qs<HTMLInputElement>('[data-card="cvc"]', dialog.element)?.value ?? '',
        name: qs<HTMLInputElement>('[data-card="name"]', dialog.element)?.value ?? '',
      };
      pending(confirm, 'Processing payment');
      void (async () => {
        const result = await api<{ invoice: InvoiceView }>(`/api/invoices/${invoiceId}/payments`, {
          method: 'POST',
          body: { card },
          headers: { 'Idempotency-Key': paymentKey },
        });
        pending(confirm, null);
        if (!result.ok) {
          outage.noteFromError(result.body.error);
          setFieldErrors(dialog.element, result.body.fields);
          if (errorSlot !== null) errorSlot.textContent = result.body.message ?? '';
          confirm.focus();
          await refresh();
          return;
        }
        if (errorSlot !== null) errorSlot.textContent = '';
        dialog.close({ restoreFocus: false });
        await refresh();
        if (success === null) return;
        success.innerHTML = '';
        const heading = document.createElement('h2');
        heading.textContent = 'Invoice paid';
        const note = document.createElement('p');
        note.textContent = 'Thank you. A receipt will follow by email.';
        success.append(heading, note);
        success.hidden = false;
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      })();
    });
  }

  window.setInterval(() => {
    if (invoices.some((invoice) => invoice.status === 'payment_failed' || invoice.status === 'issued' || invoice.status === 'overdue'))
      void refresh();
  }, 10_000);

  void refresh();
};

export const initReviewPage = (review: ReviewView, token: string): void => {
  const root = qs<HTMLElement>('[data-review]');
  if (root === null) return;
  const rounds = qs<HTMLElement>('[data-rounds]');
  const success = qs<HTMLElement>('[data-review-success]');
  const acceptButton = qs<HTMLButtonElement>('[data-review-accept]');
  const reviseButton = qs<HTMLButtonElement>('[data-review-revise]');
  const dialogElement = qs<HTMLElement>('[data-revision-dialog]');
  const dialog = dialogElement === null ? null : createDialog(dialogElement);
  let requestKey = '';
  let used = review.revision_rounds_used;

  const showSuccess = (heading: string, lines: string[]): void => {
    if (success === null) return;
    success.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = heading;
    success.append(title);
    for (const line of lines) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      success.append(paragraph);
    }
    success.hidden = false;
    title.setAttribute('tabindex', '-1');
    title.focus();
  };

  acceptButton?.addEventListener('click', () => {
    pending(acceptButton, 'Sending');
    void (async () => {
      const result = await api<ReviewView>(`/api/review/${token}/accept`, { method: 'POST', body: {} });
      pending(acceptButton, null);
      if (!result.ok) {
        announce(success, result.body.message ?? '');
        return;
      }
      showSuccess('Milestone accepted', [
        'Thank you. The studio will be in touch about the next step.',
      ]);
    })();
  });

  reviseButton?.addEventListener('click', () => {
    if (dialog === null) return;
    requestKey = crypto.randomUUID();
    dialog.open(reviseButton);
  });

  if (dialog !== null) {
    qs<HTMLButtonElement>('[data-dialog-cancel]', dialog.element)?.addEventListener('click', () =>
      dialog.close(),
    );
    const send = qs<HTMLButtonElement>('[data-revision-send]', dialog.element);
    const errorSlot = qs<HTMLElement>('[data-dialog-error]', dialog.element);
    send?.addEventListener('click', () => {
      const note = qs<HTMLTextAreaElement>('[data-revision-note]', dialog.element)?.value ?? '';
      pending(send, 'Sending');
      void (async () => {
        const result = await api<{ round: number; change_order: boolean; review: ReviewView }>(
          `/api/review/${token}/revisions`,
          { method: 'POST', body: { note }, headers: { 'Idempotency-Key': requestKey } },
        );
        pending(send, null);
        if (!result.ok) {
          setFieldErrors(dialog.element, result.body.fields);
          if (errorSlot !== null) errorSlot.textContent = result.body.message ?? '';
          return;
        }
        if (errorSlot !== null) errorSlot.textContent = '';
        dialog.close({ restoreFocus: false });
        used = result.body.round;
        if (rounds !== null) rounds.textContent = `Revision rounds used: ${used} of 2`;
        showSuccess('Revision requested', [
          result.body.change_order
            ? `Round ${result.body.round}. This round adds a change order to this milestone's invoice.`
            : `Round ${result.body.round} of 2 included.`,
        ]);
      })();
    });
  }
};

export const initStudioSignIn = (): void => {
  const form = qs<HTMLFormElement>('[data-studio-form]');
  if (form === null) return;
  const button = qs<HTMLButtonElement>('[data-studio-signin]', form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    pending(button, 'Sending');
    void (async () => {
      const password = qs<HTMLInputElement>('[data-field="password"]', form)?.value ?? '';
      const result = await api<{ role: string }>('/api/studio/session', { body: { password } });
      pending(button, null);
      if (!result.ok) {
        setFieldErrors(form, { password: result.body.message ?? '' });
        showErrorSummary(form, { password: result.body.message ?? '' }, result.body.message ?? '');
        return;
      }
      window.location.reload();
    })();
  });
};

const flash = (text: string): void => {
  const slot = qs<HTMLElement>('[data-studio-success]');
  if (slot === null) return;
  slot.textContent = text;
  slot.hidden = false;
};

export const initStudioDashboard = (): void => {
  const root = qs<HTMLElement>('.studio-dashboard');
  if (root === null) return;

  for (const button of qsa<HTMLButtonElement>('[data-toggle-published]')) {
    button.addEventListener('click', () => {
      const slug = button.dataset.togglePublished ?? '';
      const publishing = button.textContent === 'Publish';
      void (async () => {
        const result = await api(`/api/studio/work/${slug}`, {
          method: 'PATCH',
          body: { published: publishing },
        });
        if (!result.ok) {
          flash(result.body.message ?? '');
          return;
        }
        window.location.reload();
      })();
    });
  }

  for (const button of qsa<HTMLButtonElement>('[data-save-service]')) {
    button.addEventListener('click', () => {
      const code = button.dataset.saveService ?? '';
      const row = button.closest('[data-service]');
      if (row === null) return;
      const title = qs<HTMLInputElement>('[data-service-title]', row)?.value ?? '';
      const price = Number(qs<HTMLInputElement>('[data-service-price]', row)?.value ?? '0');
      pending(button, 'Sending');
      void (async () => {
        const result = await api(`/api/studio/services/${code}`, {
          method: 'PATCH',
          body: { title, list_price_pence: price },
        });
        pending(button, null);
        setFieldErrors(row, result.body.fields);
        flash(result.ok ? 'Service saved.' : (result.body.message ?? ''));
      })();
    });
  }

  const rateForm = qs<HTMLElement>('[data-rate-form]');
  qs<HTMLButtonElement>('[data-add-rate]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (rateForm === null) return;
    const currency = qs<HTMLSelectElement>('[data-rate-currency]', rateForm)?.value ?? '';
    const rate = qs<HTMLInputElement>('[data-rate-value]', rateForm)?.value ?? '';
    const effective = qs<HTMLInputElement>('[data-rate-effective]', rateForm)?.value.trim() ?? '';
    pending(button, 'Sending');
    void (async () => {
      const body: Record<string, unknown> = { currency, rate };
      if (effective !== '') body.effective_at = effective;
      const result = await api('/api/studio/fx-rates', { body });
      pending(button, null);
      setFieldErrors(rateForm, result.body.fields);
      if (!result.ok) {
        flash(result.body.message ?? '');
        return;
      }
      flash('Rate saved.');
      window.location.reload();
    })();
  });
};

export const initStudioEngagement = (): void => {
  const root = qs<HTMLElement>('[data-studio-engagement]');
  if (root === null) return;
  const engagementId = root.dataset.studioEngagement ?? '';

  for (const button of qsa<HTMLButtonElement>('[data-still-upload]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.stillUpload ?? '';
      const [milestone, shotCode] = key.split(':');
      const input = qs<HTMLInputElement>(`[data-still-input="${CSS.escape(key)}"]`);
      const file = input?.files?.[0];
      if (file === undefined) return;
      const form = new FormData();
      form.append('shot_code', shotCode);
      form.append('milestone', milestone);
      form.append('file', file, file.name);
      pending(button, 'Sending');
      void (async () => {
        const result = await api(`/api/studio/engagements/${engagementId}/stills`, { form });
        pending(button, null);
        flash(result.ok ? 'Still posted.' : (result.body.message ?? ''));
      })();
    });
  }

  const sendButton = qs<HTMLButtonElement>('[data-send-for-review]');
  sendButton?.addEventListener('click', () => {
    pending(sendButton, 'Sending');
    void (async () => {
      const result = await api(`/api/studio/engagements/${engagementId}/send-for-review`, {
        body: {},
      });
      pending(sendButton, null);
      flash(
        result.ok
          ? 'Review link created. The reviewer will receive it by email.'
          : (result.body.message ?? ''),
      );
    })();
  });

  const revokeButton = qs<HTMLButtonElement>('[data-revoke-review-link]');
  revokeButton?.addEventListener('click', () => {
    void (async () => {
      await api(`/api/studio/engagements/${engagementId}/review-link`, { method: 'DELETE' });
      flash('Review link revoked.');
    })();
  });

  for (const button of qsa<HTMLButtonElement>('[data-issue-invoice]')) {
    button.addEventListener('click', () => {
      const invoiceId = button.dataset.issueInvoice ?? '';
      pending(button, 'Sending');
      void (async () => {
        const result = await api(`/api/studio/invoices/${invoiceId}/issue`, { body: {} });
        pending(button, null);
        flash(result.ok ? 'Invoice issued.' : (result.body.message ?? ''));
        if (result.ok) window.location.reload();
      })();
    });
  }

  const cancelDialogElement = qs<HTMLElement>('[data-cancel-dialog]');
  const cancelDialog = cancelDialogElement === null ? null : createDialog(cancelDialogElement);
  const cancelButton = qs<HTMLButtonElement>('[data-cancel-refund]');
  cancelButton?.addEventListener('click', () => cancelDialog?.open(cancelButton));

  if (cancelDialog !== null) {
    qs<HTMLButtonElement>('[data-dialog-cancel]', cancelDialog.element)?.addEventListener(
      'click',
      () => cancelDialog.close(),
    );
    const confirm = qs<HTMLButtonElement>('[data-cancel-confirm]', cancelDialog.element);
    confirm?.addEventListener('click', () => {
      const amount = Number(
        qs<HTMLInputElement>('[data-refund-amount]', cancelDialog.element)?.value ?? '0',
      );
      pending(confirm, 'Sending');
      void (async () => {
        const result = await api<{ refunded_minor: number; engagement: EngagementView }>(
          `/api/studio/engagements/${engagementId}/cancel`,
          { body: { refund_minor: amount } },
        );
        pending(confirm, null);
        setFieldErrors(cancelDialog.element, result.body.fields);
        if (!result.ok) {
          const errorSlot = qs<HTMLElement>('[data-dialog-error]', cancelDialog.element);
          if (errorSlot !== null) errorSlot.textContent = result.body.message ?? '';
          return;
        }
        cancelDialog.close({ restoreFocus: false });
        const currency = result.body.engagement.quote.currency as CurrencyCode;
        flash(
          `Engagement cancelled. Refund of ${formatMoney(BigInt(result.body.refunded_minor), currency)} recorded.`,
        );
      })();
    });
  }
};
