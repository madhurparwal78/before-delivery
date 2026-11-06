import { formatMoney } from '../shared/money.ts';
import { ApiCallError, call } from './api.ts';
import { clearFeedback, runAction, showFailure, showPlainStatus, showStatus, type Regions } from './feedback.ts';
import { locale, setI18n, tr } from './i18n.ts';
import { closeDialog, openDialog } from './widgets.ts';

const regions: Regions = { status: 'staff-status', error: 'staff-error' };

function value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() ?? '';
}

function cell(text: string, mono = false): HTMLTableCellElement {
  const td = document.createElement('td');
  if (mono) td.className = 'mono';
  td.textContent = text;
  return td;
}

async function loadDoorList(screeningId: string): Promise<void> {
  const body = document.getElementById('door-list-body');
  if (body === null || screeningId === '') return;
  const data = await call<{ tickets: Array<{ ticket_code: string; seat: string; initial: string; status: string }> }>(
    'GET',
    `/api/door/screenings/${screeningId}/list`,
  );
  body.textContent = '';
  for (const ticket of data.tickets) {
    const row = document.createElement('tr');
    row.append(cell(ticket.seat, true), cell(ticket.initial), cell(ticket.ticket_code, true));
    const status = document.createElement('td');
    setI18n(status, `ticket_status_${ticket.status}`);
    row.append(status);
    body.append(row);
  }
}

function initDoor(): void {
  const select = document.getElementById('door-screening') as HTMLSelectElement | null;
  const search = document.getElementById('door-search') as HTMLInputElement | null;
  const button = document.getElementById('check-in') as HTMLButtonElement | null;
  if (select === null) return;
  void (async () => {
    const data = await call<{ screenings: Array<{ id: string; film_title: string; starts_at: string }> }>(
      'GET',
      '/api/door/screenings',
    );
    for (const screening of data.screenings) {
      const option = document.createElement('option');
      option.value = screening.id;
      option.textContent = `${screening.starts_at.slice(0, 16).replace('T', ' ')} · ${screening.film_title}`;
      select.append(option);
    }
    if (data.screenings.length > 0) await loadDoorList(select.value);
  })().catch((error: unknown) => showFailure(regions, error));

  select.addEventListener('change', () => {
    void loadDoorList(select.value).catch((error: unknown) => showFailure(regions, error));
  });

  const submit = async (): Promise<void> => {
    const code = search?.value.trim() ?? '';
    if (code === '') return;
    clearFeedback(regions);
    try {
      if (code.toUpperCase().startsWith('HB-')) {
        const result = await call<{ checked_in: number; tickets: unknown[] }>(
          'POST',
          `/api/door/bookings/${code}/check-in`,
          {},
        );
        showStatus(regions, 'checked_in_booking', { n: result.checked_in, m: result.tickets.length });
      } else {
        const result = await call<{ ticket: { seat: string } }>('POST', `/api/door/tickets/${code}/check-in`, {});
        showStatus(regions, 'checked_in_seat', { seat: result.ticket.seat });
      }
    } catch (error) {
      showFailure(regions, error);
    }
    if (search !== null) {
      search.value = '';
      search.focus();
    }
    await loadDoorList(select.value);
  };

  button?.addEventListener('click', () => {
    void submit();
  });
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });
  window.setInterval(() => {
    void loadDoorList(select.value).catch(() => undefined);
  }, 10000);
}

type Season = { slug: string; state: string; title: string };

async function loadSeasons(): Promise<void> {
  const body = document.getElementById('seasons-body');
  const select = document.getElementById('screening-season') as HTMLSelectElement | null;
  if (body === null) return;
  const data = await call<{ seasons: Season[] }>('GET', '/api/programmer/seasons');
  body.textContent = '';
  if (select !== null) {
    const chosen = select.value;
    select.textContent = '';
    for (const season of data.seasons) {
      const option = document.createElement('option');
      option.value = season.slug;
      option.textContent = season.slug;
      select.append(option);
    }
    if (chosen !== '') select.value = chosen;
  }
  for (const season of data.seasons) {
    const row = document.createElement('tr');
    row.append(cell(season.slug, true));
    const state = document.createElement('td');
    setI18n(state, `state_${season.state}`);
    row.append(state);
    const actions = document.createElement('td');
    for (const [key, target] of [
      ['schedule_season', 'scheduled'],
      ['archive_season', 'archived'],
      ['withdraw_season', 'withdrawn'],
    ] as Array<[string, string]>) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.setAttribute('data-slug', season.slug);
      setI18n(button, key);
      button.addEventListener('click', () => {
        if (target === 'withdrawn') {
          const dialog = document.getElementById('withdraw-dialog');
          if (dialog === null) return;
          dialog.setAttribute('data-slug', season.slug);
          openDialog(dialog, button);
          return;
        }
        void runAction(button, regions, async () => {
          clearFeedback(regions);
          await call('POST', `/api/programmer/seasons/${season.slug}/transition`, { to: target });
          showStatus(regions, target === 'scheduled' ? 'season_scheduled' : 'season_archived');
          await loadSeasons();
        });
      });
      actions.append(button);
    }
    row.append(actions);
    body.append(row);
  }
}

function initProgramme(): void {
  const createButton = document.getElementById('create-season') as HTMLButtonElement | null;
  const addButton = document.getElementById('add-screenings') as HTMLButtonElement | null;
  const confirmWithdraw = document.getElementById('confirm-withdrawal') as HTMLButtonElement | null;
  const withdrawClose = document.getElementById('withdraw-close');

  void loadSeasons().catch((error: unknown) => showFailure(regions, error));

  createButton?.addEventListener('click', () => {
    void runAction(createButton, regions, async () => {
      clearFeedback(regions);
      await call('POST', '/api/programmer/seasons', {
        slug: value('season-slug'),
        title_en: value('season-title-en'),
        title_fr: value('season-title-fr'),
        public_sale_date: value('season-sale-date'),
      });
      showStatus(regions, 'season_scheduled');
      await loadSeasons();
    });
  });

  addButton?.addEventListener('click', () => {
    void runAction(addButton, regions, async () => {
      clearFeedback(regions);
      const result = await call<{ screenings: unknown[] }>(
        'POST',
        `/api/programmer/seasons/${value('screening-season')}/screenings`,
        {
          film_title: value('screening-film'),
          format: value('screening-format'),
          auditorium: value('screening-auditorium'),
          first_local: value('screening-first'),
          weeks: Number(value('screening-weeks') || '1'),
        },
      );
      showStatus(regions, 'screenings_added', { n: result.screenings.length });
      await loadSeasons();
    });
  });

  confirmWithdraw?.addEventListener('click', () => {
    const dialog = document.getElementById('withdraw-dialog');
    const slug = dialog?.getAttribute('data-slug') ?? '';
    void runAction(confirmWithdraw, regions, async () => {
      clearFeedback(regions);
      const result = await call<{ refunded_bookings: number }>(
        'POST',
        `/api/programmer/seasons/${slug}/transition`,
        { to: 'withdrawn', reason: value('withdraw-reason') },
      );
      if (dialog !== null) closeDialog(dialog);
      showStatus(regions, 'season_withdrawn', { n: result.refunded_bookings });
      await loadSeasons();
    });
  });
  withdrawClose?.addEventListener('click', () => {
    const dialog = document.getElementById('withdraw-dialog');
    if (dialog !== null) closeDialog(dialog);
  });
}

type LookupResult = {
  kind: string;
  booking?: { ref: string; state: string; total_cents: number; paid_cents: number };
  account?: { number: string; name: string; credit_balance_cents: number };
  gift?: { ref: string; tier: string; price_cents: number; state: string };
};

function initFinance(): void {
  const searchButton = document.getElementById('finance-search-button') as HTMLButtonElement | null;
  const search = document.getElementById('finance-search') as HTMLInputElement | null;
  const result = document.getElementById('finance-result');
  let currentBooking: string | null = null;
  let currentAccount: string | null = null;

  const renderResult = (data: LookupResult): void => {
    if (result === null) return;
    result.textContent = '';
    const region = document.createElement('section');
    region.setAttribute('role', 'region');
    const heading = document.createElement('h3');
    heading.id = 'result-heading';
    heading.tabIndex = -1;
    if (data.kind === 'booking' && data.booking !== undefined) {
      currentBooking = data.booking.ref;
      currentAccount = data.account?.number ?? null;
      region.setAttribute('aria-label', tr('region_booking', { ref: data.booking.ref }));
      region.setAttribute('data-i18n-aria', 'region_booking');
      region.setAttribute('data-i18n-args', JSON.stringify({ ref: data.booking.ref }));
      setI18n(heading, 'region_booking', { ref: data.booking.ref });
      region.append(heading);
      const amount = document.createElement('p');
      amount.className = 'mono';
      amount.textContent = formatMoney(data.booking.total_cents, locale());
      region.append(amount);
      region.append(refundControl(), goodwillControl());
    } else if (data.kind === 'account' && data.account !== undefined) {
      currentAccount = data.account.number;
      currentBooking = null;
      region.setAttribute('aria-label', tr('region_account', { number: data.account.number }));
      region.setAttribute('data-i18n-aria', 'region_account');
      region.setAttribute('data-i18n-args', JSON.stringify({ number: data.account.number }));
      setI18n(heading, 'region_account', { number: data.account.number });
      region.append(heading);
      const balance = document.createElement('p');
      setI18n(balance, 'credit_balance', { amount_cents: data.account.credit_balance_cents });
      region.append(balance, goodwillControl());
    } else if (data.kind === 'gift' && data.gift !== undefined) {
      currentBooking = null;
      currentAccount = null;
      region.setAttribute('aria-label', tr('region_gift', { ref: data.gift.ref }));
      region.setAttribute('data-i18n-aria', 'region_gift');
      region.setAttribute('data-i18n-args', JSON.stringify({ ref: data.gift.ref }));
      setI18n(heading, 'region_gift', { ref: data.gift.ref });
      region.append(heading);
    }
    result.append(region);
    heading.focus();
  };

  const refundControl = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    setI18n(button, 'refund_booking');
    button.addEventListener('click', () => {
      const dialog = document.getElementById('refund-dialog');
      if (dialog !== null) openDialog(dialog, button);
    });
    return button;
  };

  const goodwillControl = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    setI18n(button, 'issue_goodwill');
    button.addEventListener('click', () => {
      const dialog = document.getElementById('goodwill-dialog');
      if (dialog !== null) openDialog(dialog, button);
    });
    return button;
  };

  const runLookup = async (): Promise<void> => {
    const term = search?.value.trim() ?? '';
    clearFeedback(regions);
    try {
      const data = await call<LookupResult>('GET', `/api/finance/lookup?q=${encodeURIComponent(term)}`);
      renderResult(data);
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.code === 'not_found') {
        showStatus(regions, 'lookup_miss', { query: term });
        const target = document.getElementById(regions.error);
        if (target !== null) {
          target.removeAttribute('data-i18n');
          target.textContent = tr('lookup_miss', { query: term });
        }
      } else {
        showFailure(regions, error);
      }
      search?.focus();
    }
  };

  searchButton?.addEventListener('click', () => {
    void runLookup();
  });
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runLookup();
    }
  });

  const confirmRefund = document.getElementById('confirm-refund') as HTMLButtonElement | null;
  confirmRefund?.addEventListener('click', () => {
    void runAction(confirmRefund, regions, async () => {
      clearFeedback(regions);
      if (currentBooking === null) return;
      const data = await call<{ refund: { refunded_cents: number; recredited_cents: number } }>(
        'POST',
        `/api/finance/bookings/${currentBooking}/refund`,
        { reason: value('refund-reason') },
      );
      const dialog = document.getElementById('refund-dialog');
      if (dialog !== null) closeDialog(dialog);
      showPlainStatus(
        regions,
        tr('refund_done', { amount_cents: data.refund.refunded_cents }) +
          (data.refund.recredited_cents > 0
            ? tr('refund_done_credit', { amount_cents: data.refund.recredited_cents })
            : ''),
      );
      await loadAudit();
    });
  });
  document.getElementById('refund-close')?.addEventListener('click', () => {
    const dialog = document.getElementById('refund-dialog');
    if (dialog !== null) closeDialog(dialog);
  });

  const issueCredit = document.getElementById('issue-credit') as HTMLButtonElement | null;
  issueCredit?.addEventListener('click', () => {
    void runAction(issueCredit, regions, async () => {
      clearFeedback(regions);
      if (currentAccount === null) return;
      const dollars = Number(value('goodwill-amount').replace(',', '.'));
      const data = await call<{ credit: { account_number: string; amount_cents: number } }>(
        'POST',
        '/api/finance/credits',
        {
          account_number: currentAccount,
          amount_cents: Math.round(dollars * 100),
          reason: value('goodwill-reason'),
        },
      );
      const dialog = document.getElementById('goodwill-dialog');
      if (dialog !== null) closeDialog(dialog);
      showStatus(regions, 'goodwill_done', {
        amount_cents: data.credit.amount_cents,
        number: data.credit.account_number,
      });
      await loadAudit();
    });
  });
  document.getElementById('goodwill-close')?.addEventListener('click', () => {
    const dialog = document.getElementById('goodwill-dialog');
    if (dialog !== null) closeDialog(dialog);
  });

  const loadDay = document.getElementById('load-day') as HTMLButtonElement | null;
  const takings = document.getElementById('takings-body');
  const csvLink = document.getElementById('download-csv') as HTMLAnchorElement | null;

  type Reconciliation = {
    date: string;
    local: Record<string, number>;
    killbill: Record<string, number>;
    difference_cents: number;
    status: string;
  };

  const renderRecon = (data: Reconciliation): void => {
    if (takings === null) return;
    takings.textContent = '';
    const rows: Array<[string, number, number | null]> = [
      ['figure_admission', data.local.admission_cents, null],
      ['figure_gst', data.local.gst_cents, null],
      ['figure_qst', data.local.qst_cents, null],
      ['figure_uplift', data.local.uplift_cents, null],
      ['figure_gift', data.local.gift_cents, null],
      ['figure_membership', data.local.membership_cents, null],
      ['figure_credit_spent', data.local.credit_spent_cents, null],
      ['figure_refunds', data.local.refunds_cents, data.killbill.refunds_cents],
      ['figure_net', data.local.net_payments_cents, data.killbill.net_payments_cents],
      ['figure_difference', data.difference_cents, null],
    ];
    for (const [key, local, killbill] of rows) {
      const row = document.createElement('tr');
      const header = document.createElement('th');
      header.setAttribute('scope', 'row');
      setI18n(header, key);
      const localCell = document.createElement('td');
      localCell.className = 'mono';
      setI18n(localCell, 'money_plain', { amount_cents: local });
      const kbCell = document.createElement('td');
      kbCell.className = 'mono';
      if (killbill !== null) setI18n(kbCell, 'money_plain', { amount_cents: killbill });
      row.append(header, localCell, kbCell);
      takings.append(row);
    }
    const statusRow = document.createElement('tr');
    const statusHeader = document.createElement('th');
    statusHeader.setAttribute('scope', 'row');
    setI18n(statusHeader, 'figure_status');
    const statusCell = document.createElement('td');
    setI18n(
      statusCell,
      data.status === 'matched' ? 'recon_matched' : data.status === 'accepted' ? 'recon_accepted_state' : 'recon_mismatch',
    );
    statusRow.append(statusHeader, statusCell, document.createElement('td'));
    takings.append(statusRow);
    if (csvLink !== null) csvLink.href = `/api/finance/reconciliation.csv?date=${data.date}`;
  };

  loadDay?.addEventListener('click', () => {
    void runAction(loadDay, regions, async () => {
      clearFeedback(regions);
      const date = value('recon-date');
      const data = await call<Reconciliation>(
        'GET',
        `/api/finance/reconciliation${date === '' ? '' : `?date=${date}`}`,
      );
      renderRecon(data);
    });
  });

  const confirmAccept = document.getElementById('confirm-accept') as HTMLButtonElement | null;
  document.getElementById('accept-killbill')?.addEventListener('click', () => {
    const dialog = document.getElementById('accept-dialog');
    if (dialog !== null) openDialog(dialog, document.getElementById('accept-killbill'));
  });
  document.getElementById('accept-close')?.addEventListener('click', () => {
    const dialog = document.getElementById('accept-dialog');
    if (dialog !== null) closeDialog(dialog);
  });
  confirmAccept?.addEventListener('click', () => {
    void runAction(confirmAccept, regions, async () => {
      clearFeedback(regions);
      const date = value('recon-date');
      const data = await call<Reconciliation>('POST', '/api/finance/reconciliation/accept', {
        date,
        reason: value('accept-reason'),
      });
      const dialog = document.getElementById('accept-dialog');
      if (dialog !== null) closeDialog(dialog);
      renderRecon(data);
      showStatus(regions, 'recon_accepted', { date: data.date, amount_cents: data.difference_cents });
      await loadAudit();
    });
  });

  const loadAudit = async (): Promise<void> => {
    const body = document.getElementById('audit-body');
    if (body === null) return;
    const data = await call<{
      entries: Array<{
        at: string;
        actor: string;
        action: string;
        target: string;
        amount_cents: number | null;
        reason: string | null;
      }>;
    }>('GET', '/api/finance/audit');
    body.textContent = '';
    for (const entry of data.entries) {
      const row = document.createElement('tr');
      row.append(
        cell(entry.at.slice(0, 19).replace('T', ' '), true),
        cell(entry.actor),
        cell(entry.action),
        cell(entry.target, true),
        cell(entry.amount_cents === null ? '' : formatMoney(entry.amount_cents, locale()), true),
        cell(entry.reason ?? ''),
      );
      body.append(row);
    }
  };

  const loadOutbox = async (): Promise<void> => {
    const body = document.getElementById('outbox-body');
    if (body === null) return;
    const data = await call<{
      messages: Array<{ enqueued_at: string; to: string; subject: string; state: string }>;
    }>('GET', '/api/finance/outbox');
    body.textContent = '';
    for (const message of data.messages) {
      const row = document.createElement('tr');
      row.append(cell(message.enqueued_at.slice(0, 19).replace('T', ' '), true), cell(message.to), cell(message.subject));
      const state = document.createElement('td');
      setI18n(state, `outbox_${message.state}`);
      row.append(state);
      body.append(row);
    }
  };

  let selectedEnquiry: string | null = null;
  const loadEnquiries = async (): Promise<void> => {
    const body = document.getElementById('enquiries-body');
    if (body === null) return;
    const data = await call<{
      enquiries: Array<{ ref: string; subject: string; state: string; email: string }>;
    }>('GET', '/api/finance/enquiries');
    body.textContent = '';
    for (const enquiry of data.enquiries) {
      const row = document.createElement('tr');
      row.append(cell(enquiry.ref, true), cell(enquiry.subject));
      const state = document.createElement('td');
      state.textContent = enquiry.state;
      row.append(state);
      const actions = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      setI18n(button, 'open_enquiry', { ref: enquiry.ref });
      button.addEventListener('click', () => {
        selectedEnquiry = enquiry.ref;
        const panel = document.getElementById('enquiry-reply');
        if (panel !== null) panel.hidden = false;
        document.getElementById('reply-body')?.focus();
      });
      actions.append(button);
      row.append(actions);
      body.append(row);
    }
  };

  const sendReply = document.getElementById('send-reply') as HTMLButtonElement | null;
  sendReply?.addEventListener('click', () => {
    void runAction(sendReply, regions, async () => {
      clearFeedback(regions);
      if (selectedEnquiry === null) return;
      const textarea = document.getElementById('reply-body') as HTMLTextAreaElement | null;
      await call('POST', `/api/finance/enquiries/${selectedEnquiry}/reply`, { body: textarea?.value ?? '' });
      showStatus(regions, 'reply_recorded', { email: '' });
      await loadEnquiries();
      await loadOutbox();
    });
  });

  void loadAudit().catch(() => undefined);
  void loadOutbox().catch(() => undefined);
  void loadEnquiries().catch(() => undefined);
}

export function initStaff(): void {
  if (document.getElementById('door-section') !== null) initDoor();
  if (document.getElementById('programme-section') !== null) initProgramme();
  if (document.getElementById('finance-section') !== null) initFinance();
}
