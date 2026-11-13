// The remaining screens: the ladder report, the accounts screen, the invoice
// detail and the sign-in page.

import { el, clear, announce } from './dom.js';
import { get, post, newKey } from './http.js';
import { refreshServices, topStrip, notFoundPage, type AppCtx } from './chrome.js';
import { money, type Invoice, type LadderReport, type Move, type TariffRevision, type User } from './domain.js';

export async function renderReport(
  container: HTMLElement,
  user: User,
  id: string,
): Promise<void> {
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };
  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  void refreshServices(ctx);

  const result = await get<LadderReport>(`/api/ladder-reports/${id}`);
  if (!result.ok) {
    container.append(notFoundPage());
    return;
  }
  const report = result.value;
  const page = el('div', { class: 'report-page' });
  if (report.refused) {
    page.append(el('h2', {}, 'Boarding refused at ladder'));
  }
  page.append(el('h1', { class: 'num' }, report.id));
  page.append(el('div', {}, `Move ${report.move_ref}`));
  page.append(el('div', {}, report.compliant ? 'Compliant' : 'Non-compliant'));
  if (report.defects.length > 0) {
    const defects = el('ul', { class: 'defects-list' });
    for (const defect of report.defects) defects.append(el('li', {}, defect.replace(/_/g, ' ')));
    page.append(defects);
  }
  page.append(el('div', {}, `Filed from ${report.location === 'deck' ? 'Deck' : 'Pilot boat'} by ${report.filed_by} at ${report.filed_at}`));
  if (report.note !== '') page.append(el('div', {}, report.note));
  report.photos.forEach((photo, index) => {
    const row = el('div', { class: 'report-photo' });
    row.append(el('a', { class: 'link', href: `/api/photos/${photo.photo_id}/content` }, `Download photo ${index + 1}`));
    row.append(el('span', { class: 'num' }, `SHA-256 ${photo.sha256}`));
    page.append(row);
  });
  container.append(page);
}

export async function renderAccounts(container: HTMLElement, user: User): Promise<void> {
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };
  const billingAnnouncements = el('div', { role: 'status', 'aria-label': 'Billing announcements', class: 'live-region' });
  const formErrors = el('div', { role: 'alert', 'aria-label': 'Form errors', class: 'form-errors' });

  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  container.append(billingAnnouncements);
  void refreshServices(ctx);

  const layout = el('div', { class: 'accounts-layout' });
  container.append(layout);

  const revisionsResult = await get<{ revisions: TariffRevision[] }>('/api/tariff-revisions');
  const revisions = revisionsResult.ok ? revisionsResult.value.revisions : [];
  const movesResult = await get<{ moves: Move[] }>('/api/moves');
  const moves = movesResult.ok ? movesResult.value.moves : [];
  const invoicesResult = await get<{ invoices: Invoice[] }>('/api/invoices');
  const invoices = invoicesResult.ok ? invoicesResult.value.invoices : [];

  // ---- publish form, prefilled from the latest revision ----
  const latest = revisions[revisions.length - 1];
  const label = el('input', { type: 'text', 'aria-label': 'Revision label', class: 'text', value: latest?.label ?? '' }) as HTMLInputElement;
  const effectiveDate = el('input', { type: 'text', 'aria-label': 'Effective date', class: 'text num' }) as HTMLInputElement;
  const effectiveTime = el('input', { type: 'text', 'aria-label': 'Effective time', class: 'text num', value: '00:00' }) as HTMLInputElement;
  const draftFoot = el('input', { type: 'number', step: '0.01', 'aria-label': 'Rate per draft foot', class: 'text num', value: centsToDollars(latest?.draft_foot_cents ?? 0) }) as HTMLInputElement;
  const minimum = el('input', { type: 'number', step: '0.01', 'aria-label': 'Minimum charge', class: 'text num', value: centsToDollars(latest?.minimum_cents ?? 0) }) as HTMLInputElement;
  const detentionRate = el('input', { type: 'number', step: '0.01', 'aria-label': 'Detention per half hour', class: 'text num', value: centsToDollars(latest?.detention_half_hour_cents ?? 0) }) as HTMLInputElement;
  const cancellation = el('input', { type: 'number', step: '0.01', 'aria-label': 'Cancellation charge', class: 'text num', value: centsToDollars(latest?.cancellation_cents ?? 0) }) as HTMLInputElement;
  const nightPercent = el('input', { type: 'number', 'aria-label': 'Night surcharge percent', class: 'text num', value: String(latest?.night_percent ?? 0) }) as HTMLInputElement;
  const allowance = el('input', { type: 'number', 'aria-label': 'Detention allowance half hours', class: 'text num', value: String(latest?.detention_allowance_half_hours ?? 0) }) as HTMLInputElement;

  const bandsHolder = el('div', { class: 'bands' });
  type BandRow = { from: HTMLInputElement; to: HTMLInputElement; cents: HTMLInputElement };
  let bands: BandRow[] = [];
  function paintBands(rows: { from_gt: number; to_gt: number | null; cents: number }[]): void {
    clear(bandsHolder);
    bands = [];
    rows.forEach((band, index) => {
      const from = el('input', { type: 'number', 'aria-label': `Tonnage band ${index + 1} from GT`, class: 'text num', value: String(band.from_gt) }) as HTMLInputElement;
      const to = el('input', { type: 'number', 'aria-label': `Tonnage band ${index + 1} to GT`, class: 'text num', value: band.to_gt === null ? '' : String(band.to_gt) }) as HTMLInputElement;
      const cents = el('input', { type: 'number', step: '0.01', 'aria-label': `Tonnage band ${index + 1} amount`, class: 'text num', value: centsToDollars(band.cents) }) as HTMLInputElement;
      const row = el('div', { class: 'band-row' },
        from, to, cents,
        el('button', { class: 'link' }, `Remove tonnage band ${index + 1}`).tap((b) => b.addEventListener('click', () => {
          rows.splice(index, 1);
          paintBands(rows);
        })),
      );
      bandsHolder.append(row);
      bands.push({ from, to, cents });
    });
  }
  paintBands([...(latest?.tonnage_bands ?? [])]);
  const addBand = el('button', { class: 'secondary' }, 'Add tonnage band');
  addBand.addEventListener('click', () => {
    const current = readBands();
    const last = current[current.length - 1];
    const lastTo = last === undefined ? null : last.to_gt;
    current.push({ from_gt: (lastTo ?? 0) + 1, to_gt: null, cents: 0 });
    paintBands(current);
  });
  function readBands(): { from_gt: number; to_gt: number | null; cents: number }[] {
    return bands.map((row) => ({
      from_gt: Number(row.from.value || 0),
      to_gt: row.to.value === '' ? null : Number(row.to.value),
      cents: dollarsToCents(row.cents.value),
    }));
  }

  const publish = el('button', { class: 'primary' }, 'Publish revision');
  publish.addEventListener('click', async () => {
    announce(billingAnnouncements, 'Publishing revision...');
    const body = {
      label: label.value,
      effective_at: `${effectiveDate.value}T${effectiveTime.value}`,
      draft_foot_cents: dollarsToCents(draftFoot.value),
      minimum_cents: dollarsToCents(minimum.value),
      detention_half_hour_cents: dollarsToCents(detentionRate.value),
      detention_allowance_half_hours: Number(allowance.value || 0),
      cancellation_cents: dollarsToCents(cancellation.value),
      night_percent: Number(nightPercent.value || 0),
      tonnage_bands: readBands(),
    };
    const result = await post<TariffRevision>('/api/tariff-revisions', body);
    if (result.ok) {
      announce(billingAnnouncements, `Revision ${result.value.label} published, effective ${result.value.effective_at.replace('T', ' ')} port time`);
      clear(formErrors);
      window.setTimeout(() => { window.location.reload(); }, 600);
    } else if ('noReply' in result && result.noReply) {
      announce(billingAnnouncements, 'No reply from the server. Showing the last confirmed state.');
    } else if (result.ok === false && 'failure' in result) {
      clear(formErrors);
      const errors = result.failure.errors ?? {};
      for (const [field, message] of Object.entries(errors)) {
        formErrors.append(el('div', { class: 'error-row' }, `${field}: ${message}`));
      }
      announce(billingAnnouncements, `${Object.keys(errors).length} fields need attention`);
    }
  });

  const left = el('div', { class: 'accounts-column' });
  left.append(
    el('h1', {}, 'Tariff revisions'),
    el('div', { class: 'field-row' }, label),
    el('div', { class: 'field-row' }, effectiveDate, effectiveTime),
    el('div', { class: 'field-row' }, draftFoot, minimum),
    el('div', { class: 'field-row' }, detentionRate, cancellation),
    el('div', { class: 'field-row' }, nightPercent, allowance),
    bandsHolder,
    addBand,
    publish,
    formErrors,
  );

  // ---- revisions list with the moves each one priced ----
  const revisionList = el('div', { class: 'revision-list' });
  for (const revision of revisions) {
    const row = el('div', { class: 'revision-row' });
    row.append(el('span', { class: 'revision-label' }, revision.label));
    row.append(el('span', { class: 'num' }, revision.effective_at.replace('T', ' ')));
    row.append(el('span', { class: 'num' }, (revision.moves ?? []).join(', ')));
    revisionList.append(row);
  }

  // ---- moves with charges ----
  const moveList = el('div', { class: 'move-list' });
  for (const move of moves) {
    const row = el('div', { class: 'move-row' });
    row.append(el('span', { class: `status status-${move.status.replace(/\s+/g, '-')}` }, move.status));
    row.append(el('a', { class: 'link', href: `/moves/${move.ref}` }, move.ref));
    const newest = move.lines[move.lines.length - 1];
    if (newest) row.append(el('span', { class: 'num' }, money(move.lines.reduce((acc, l) => acc + l.amount_cents, 0))));
    moveList.append(row);
  }

  // ---- invoices ----
  const invoiceList = el('div', { class: 'invoice-list' });
  for (const invoice of invoices) {
    const row = el('div', { class: 'invoice-row' });
    row.append(el('a', { class: 'link', href: `/invoices/${invoice.id}` }, invoice.id));
    row.append(el('span', { class: 'num' }, `${invoice.move_ref} ${invoice.state}`));
    row.append(el('span', { class: 'num' }, invoice.number ?? '-'));
    row.append(el('span', { class: 'num' }, invoice.balance_cents === null ? '-' : money(invoice.balance_cents)));
    if (invoice.state === 'pending' && user.role === 'clerk') {
      row.append(el('button', { class: 'primary' }, `Issue invoice ${invoice.id}`).tap((b) => b.addEventListener('click', async () => {
        announce(billingAnnouncements, 'Issuing invoice...');
        const key = newKey();
        const result = await post<Invoice>(`/api/invoices/${invoice.id}/issue`, {}, { key });
        if (result.ok) {
          announce(billingAnnouncements, `Invoice ${result.value.number} issued`);
          window.setTimeout(() => window.location.reload(), 500);
        } else if ('noReply' in result && result.noReply) {
          announce(billingAnnouncements, 'No reply from the server. Showing the last confirmed state.');
        } else {
          announce(billingAnnouncements, 'Invoice pending provider confirmation');
        }
      })));
    }
    invoiceList.append(row);
  }

  const right = el('div', { class: 'accounts-column' });
  right.append(revisionList);
  right.append(el('a', { class: 'link', href: '/api/exports/moves.csv' }, 'Export moves'));
  right.append(el('h2', {}, 'Moves'));
  right.append(moveList);
  right.append(el('h2', {}, 'Invoices'));
  right.append(invoiceList);

  layout.append(left, right);
}

export async function renderInvoice(
  container: HTMLElement,
  user: User,
  id: string,
): Promise<void> {
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };
  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  const result = await get<Invoice>(`/api/invoices/${id}`);
  if (!result.ok) {
    container.append(notFoundPage());
    return;
  }
  const invoice = result.value;
  const page = el('div', { class: 'invoice-page' });
  page.append(el('h1', { class: 'num' }, invoice.id));
  page.append(el('div', {}, `Move ${invoice.move_ref} ${invoice.agency_code}`));
  if (invoice.state === 'issued') {
    page.append(el('div', { class: 'num' }, `Invoice ${invoice.number} issued, balance ${money(invoice.balance_cents ?? 0)}`));
  } else {
    page.append(el('div', { class: 'pending' }, 'Invoice pending provider confirmation'));
    page.append(el('div', { class: 'num' }, 'Number -'));
  }
  const lines = el('div', { class: 'lines' });
  for (const line of invoice.lines) {
    lines.append(el('div', { class: 'line-row num' },
      el('span', {}, `${line.label} x${line.quantity}`),
      el('span', {}, money(line.amount_cents)),
    ));
  }
  lines.append(el('div', { class: 'line-total num' }, money(invoice.total_cents)));
  page.append(lines);
  container.append(page);
}

export async function renderLogin(container: HTMLElement): Promise<void> {
  clear(container);
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user: null, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };
  const inline = el('div', { class: 'inline-status', role: 'status' });
  const page = el('div', { class: 'login-page' });
  const email = el('input', { type: 'text', 'aria-label': 'Email', class: 'text' }) as HTMLInputElement;
  const password = el('input', { type: 'password', 'aria-label': 'Password', class: 'text' }) as HTMLInputElement;
  const sign = el('button', { class: 'primary' }, 'Sign in');
  let inFlight = false;
  sign.addEventListener('click', async () => {
    if (inFlight) return;
    inFlight = true;
    inline.textContent = 'Signing in...';
    const result = await post<{ user: User }>('/api/session', { email: email.value, password: password.value });
    inFlight = false;
    if (result.ok) {
      const targets: Record<User['role'], string> = {
        dispatcher: '/board',
        agent: '/orders',
        pilot: '/pilot',
        clerk: '/accounts',
      };
      window.location.href = targets[result.value.user.role];
    } else {
      inline.textContent = 'Email or password is incorrect';
      announce(ctx.serviceAnnouncements, 'Email or password is incorrect');
    }
  });
  page.append(el('h1', {}, 'Slackwater'));
  page.append(email);
  page.append(password);
  page.append(sign);
  page.append(inline);
  container.append(page);
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number {
  return Math.round(Number(value || '0') * 100);
}
