/** Sponsor invite, share, commissions list, studio board, jobs, crew, CRM and maintenance. */
import { getApp, goto, setStatus } from '../app.js';
import { api, ApiError } from '../api.js';
import { el, toast } from '../dom.js';
import type { Commission, CommissionListEntry, CrmDelivery, InstallDayDetail, Job, ShareInfo } from '../types.js';
import { money, formatDate } from '../types.js';
import type { RouteContext } from './router.js';

// ---------- Sponsor invite ----------

export async function inviteScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const token = ctx.path.split('/')[2] ?? '';
  const accept = ctx.params.get('accept') === '1';

  const info = await api<ShareInfo>(`/invites/${token}`).catch((e) => {
    if (e instanceof ApiError) return e;
    return null;
  });
  if (info instanceof ApiError) {
    if (info.status === 410) {
      app.main.append(expiredInvite());
      return;
    }
    app.main.append(invalidInvite());
    return;
  }
  if (!info) {
    app.main.append(invalidInvite());
    return;
  }

  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, info.commission.title));
  section.append(el('p', { class: 'muted' }, `${info.commission.venueName} — ${info.commission.installationType}`));
  section.append(el('h2', {}, 'Your share'));
  section.append(
    el('p', {}, `${(info.share.bp / 100).toFixed(2)}%`),
    el('p', {}, `Work: ${money(info.share.subtotalCents ?? 0)}`),
    el('p', {}, `Sales tax: ${money(info.share.taxCents ?? 0)}`),
    el('p', { class: 'quote-total' }, `Total: ${money(info.share.amountCents ?? 0)}`),
  );
  const button = el('button', { class: 'btn primary' }, 'Accept and sign in');
  button.addEventListener('click', () => {
    location.href = `/auth/login?returnTo=${encodeURIComponent(`/i/${token}?accept=1`)}`;
  });
  section.append(button);
  app.main.append(section);

  if (accept && app.me) {
    // On return, the browser accepts the invite.
    try {
      const result = await api<{ commissionId: string; funderId: string }>(`/invites/${token}/accept`, { method: 'POST' });
      toast("You're in. Here's your share.");
      goto(`/c/${result.commissionId}/share`);
      return;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'invite_used') {
          toast('This invite was already accepted by another account.');
        } else if (e.code === 'invite_expired') {
          app.main.textContent = '';
          app.main.append(expiredInvite());
          return;
        } else if (e.code === 'billing_unavailable') {
          toast(e.message || 'Billing is unavailable.');
        }
      }
    }
  }
}

function expiredInvite(): HTMLElement {
  const card = el('section', { class: 'card' });
  card.append(el('h1', { class: 'page-heading' }, 'This invite has expired'), el('p', {}, 'Ask Spindrift Rooms for a new link.'));
  return card;
}

function invalidInvite(): HTMLElement {
  const card = el('section', { class: 'card' });
  card.append(el('h1', { class: 'page-heading' }, "This invite link isn't valid"), el('p', {}, 'It may have been replaced or withdrawn. Ask Spindrift Rooms for a new link.'));
  return card;
}

// ---------- Sponsor share ----------

export async function shareScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const info = await api<ShareInfo & { share: { state?: string; dueAt?: string | null; documentId?: string | null } }>(`/commissions/${id}/share`).catch(() => null);
  if (!info) {
    app.main.append(el('h1', {}, 'Not found'));
    return;
  }
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, info.commission.title));
  section.append(el('p', { class: 'muted' }, `${info.commission.venueName} — ${info.commission.installationType}`));
  section.append(el('p', { class: 'muted' }, 'Spindrift Rooms'));
  section.append(el('h2', {}, 'Your share'));
  section.append(
    el('p', {}, `${(info.share.bp / 100).toFixed(2)}%`),
    el('p', {}, `Work: ${money(info.share.subtotalCents ?? 0)}`),
    el('p', {}, `Sales tax: ${money(info.share.taxCents ?? 0)}`),
    el('p', { class: 'quote-total' }, `Total: ${money(info.share.amountCents ?? 0)}`),
    el('p', {}, info.share.dueAt ? `Due ${formatDate(info.share.dueAt.slice(0, 10))}` : ''),
    el('p', {}, `State: ${info.share.state ?? 'invited'}`),
  );
  const pay = el('button', { class: 'btn primary' }, 'Pay my share');
  pay.setAttribute('aria-haspopup', 'dialog');
  const status = app.statusRegions.payment;
  let attempt = 0;
  pay.addEventListener('click', async () => {
    attempt += 1;
    const key = `share-${info.share.funderId ?? id}-${attempt}-${Date.now()}`;
    setStatus(status, 'Confirming payment with the billing system...');
    try {
      const result = await api<{ amountCents: number }>(`/funders/${info.share.funderId ?? ''}/payments`, {
        method: 'POST',
        body: { nameOnCard: 'Sponsor', cardNumber: '4242424242424242' },
        idempotencyKey: key,
      });
      setStatus(status, `Paid ${money(result.amountCents)}. Your receipt is on its way.`);
      window.location.reload();
    } catch (e) {
      if (e instanceof ApiError) {
        setStatus(status, e.message || "The payment didn't go through. Nothing has been charged.");
      }
    }
  });
  section.append(pay);
  app.main.append(section);
}

// ---------- Commissions list ----------

export async function commissionsScreen(): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const list = await api<{ commissions: CommissionListEntry[] }>('/commissions').catch(() => null);
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Commissions'));
  if (!list || list.commissions.length === 0) {
    section.append(el('p', { class: 'empty-state' }, 'Nothing commissioned yet. Start with the room?'));
    app.main.append(section);
    return;
  }
  const table = el('table', { class: 'table wide' });
  table.setAttribute('aria-label', 'Commissions');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Title', 'State', 'Venue', 'Next due']) headRow.append(el('th', {}, h));
  thead.append(headRow);
  table.append(thead);
  const tbody = el('tbody');
  for (const c of list.commissions) {
    const row = el('tr');
    const titleCell = el('td', {});
    const link = el('a', { href: `/c/${c.id}`, class: 'doc-link' }, c.title);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      goto(`/c/${c.id}`);
    });
    titleCell.append(link);
    row.append(titleCell, el('td', {}, c.state), el('td', {}, c.venueName), el('td', {}, c.nextDueCents !== null ? money(c.nextDueCents) : '—'));
    tbody.append(row);
  }
  table.append(tbody);
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(table);
  section.append(scroll);
  app.main.append(section);
}

// ---------- Studio board ----------

export async function studioScreen(): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Studio'));
  const board = el('p', { class: 'visually-hidden' });
  board.id = 'board-live';
  const list = await api<{ commissions: CommissionListEntry[] }>('/commissions').catch(() => null);
  if (!list || list.commissions.length === 0) {
    section.append(el('p', { class: 'empty-state' }, 'Nothing commissioned yet. Start with the room?'));
    app.main.append(section);
    return;
  }
  const table = el('table', { class: 'table wide' });
  table.setAttribute('aria-label', 'Commissions');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Commission', 'Client', 'State', 'Install day', 'Paid', 'Next due']) headRow.append(el('th', {}, h));
  thead.append(headRow);
  table.append(thead);
  const tbody = el('tbody');
  const renderRows = (commissions: CommissionListEntry[]): void => {
    tbody.textContent = '';
    for (const c of commissions) {
      const row = el('tr');
      const cell = el('td', {});
      const link = el('a', { href: `/c/${c.id}`, class: 'doc-link' }, c.title);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        goto(`/c/${c.id}`);
      });
      cell.append(link);
      row.append(cell, el('td', {}, c.clientName), el('td', {}, c.state), el('td', {}, c.installDate ? formatDate(c.installDate) : '—'), el('td', {}, money(c.paidCents)), el('td', {}, c.nextDueCents !== null ? money(c.nextDueCents) : '—'));
      tbody.append(row);
    }
  };
  renderRows(list.commissions);
  table.append(tbody);
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(table);
  section.append(scroll, board);
  app.main.append(section);

  // The board updates in place within 2 seconds of any confirmed payment.
  const source = new EventSource('/api/events');
  source.addEventListener('payment.confirmed', async (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { commissionId: string; payerName: string; amountCents: number; label: string; commissionTitle?: string };
    setStatus(app.statusRegions.board, `${data.payerName} paid ${money(data.amountCents)} toward ${data.commissionTitle ?? data.label}.`);
    const fresh = await api<{ commissions: CommissionListEntry[] }>('/commissions').catch(() => null);
    if (fresh) renderRows(fresh.commissions);
  });
}

// ---------- Jobs ----------

export async function jobsScreen(): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Jobs'));
  const jobs = await api<{ jobs: Job[] }>('/jobs').catch(() => null);
  if (!jobs || jobs.jobs.length === 0) {
    section.append(el('p', { class: 'empty-state' }, 'No jobs waiting. All quiet?'));
    app.main.append(section);
    return;
  }
  const table = el('table', { class: 'table wide' });
  table.setAttribute('aria-label', 'Jobs');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Kind', 'Commission', 'Status', 'Attempts', 'Last error', 'Finished']) headRow.append(el('th', {}, h));
  thead.append(headRow);
  table.append(thead);
  const tbody = el('tbody');
  for (const j of jobs.jobs) {
    const row = el('tr');
    row.append(
      el('td', {}, j.kind),
      el('td', {}, j.commissionId ?? '—'),
      el('td', {}, j.status),
      el('td', {}, String(j.attempts)),
      el('td', {}, j.lastError ?? '—'),
      el('td', {}, j.finishedAt ? new Date(j.finishedAt).toLocaleString() : '—'),
    );
    tbody.append(row);
  }
  table.append(tbody);
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(table);
  section.append(scroll);
  app.main.append(section);
}

// ---------- Crew ----------

export async function crewScreen(): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Install days'));
  const days = await api<{ installDays: Array<{ id: string; date: string; commissionTitle: string; venue: { name: string } }> }>('/install-days').catch(() => null);
  if (!days || days.installDays.length === 0) {
    section.append(el('p', { class: 'empty-state' }, 'No install days yet. Check back after a booking?'));
    app.main.append(section);
    return;
  }
  const list = el('ul', { class: 'crew-list', 'aria-label': 'Install days' });
  for (const d of days.installDays) {
    const li = el('li', { class: 'crew-row' });
    const btn = el('button', { class: 'btn ghost crew-day' }, `${formatDate(d.date)} — ${d.commissionTitle} at ${d.venue.name}`);
    btn.addEventListener('click', () => {
      goto(`/crew/days/${d.id}`);
    });
    li.append(btn);
    list.append(li);
  }
  section.append(list);
  app.main.append(section);
}

export async function crewDayScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const dayId = ctx.path.split('/')[3] ?? '';
  const day = await api<InstallDayDetail>(`/install-days/${dayId}`).catch(() => null);
  if (!day) {
    app.main.append(el('h1', {}, 'Not found'));
    return;
  }
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Day sheet'));
  section.append(el('p', {}, day.venue.name));
  section.append(el('p', {}, formatDate(day.date)));
  section.append(el('p', {}, day.commissionTitle));
  section.append(el('p', {}, day.clientName));
  section.append(el('h2', {}, 'Pieces'));
  for (const item of day.layout.items) {
    section.append(el('p', { class: 'muted' }, `${item.kind} — ${item.x} m, ${item.y} m, ${item.rotationDeg}°`));
  }
  section.append(el('h2', {}, 'Load-in alert'));
  for (const alert of day.alerts) {
    section.append(el('p', { class: 'muted' }, `${alert.title} — ${alert.status}`));
  }
  const confirm = el('button', { class: 'btn primary' }, 'Confirm installation');
  confirm.addEventListener('click', async () => {
    try {
      await api(`/commissions/${day.commissionId}/transitions`, { method: 'POST', body: { to: 'installed' } });
      toast('Installation confirmed.');
      const fresh = await api<InstallDayDetail>(`/install-days/${dayId}`);
      section.querySelector('.confirmed')?.remove();
      section.append(el('p', { class: 'confirmed' }, 'Installation confirmed.'));
      void fresh;
    } catch (e) {
      if (e instanceof ApiError) {
        toast(e.code === 'milestone_unpaid' ? "That step isn't available yet." : e.message || "That step isn't available yet.");
      }
    }
  });
  section.append(confirm);
  app.main.append(section);
}

// ---------- CRM settings ----------

export async function crmSettingsScreen(): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'CRM settings'));
  const existing = await api<{ url: string | null; signingSecret: string | null }>('/me/crm-endpoint').catch(() => null);
  const input = el('input', { type: 'text', class: 'answer-field', placeholder: 'https://crm.example.com/hooks/spindrift' });
  input.setAttribute('aria-label', 'CRM endpoint URL');
  input.value = existing?.url ?? '';
  const save = el('button', { class: 'btn primary' }, 'Save endpoint');
  save.addEventListener('click', async () => {
    try {
      const result = await api<{ url: string; signingSecret: string }>('/me/crm-endpoint', { method: 'PUT', body: { url: input.value } });
      toast('Endpoint saved.');
      secret.textContent = result.signingSecret;
    } catch (e) {
      if (e instanceof ApiError) {
        toast(e.code === 'webhooks_unavailable' ? "Couldn't save the endpoint — our webhook service isn't answering. Try again in a minute." : 'Enter a full http or https address.');
      }
    }
  });
  const secret = el('p', { class: 'muted' }, existing?.signingSecret ?? '');
  section.append(input, save, el('h2', {}, 'Signing secret'), secret);
  app.main.append(section);
}

// ---------- CRM deliveries ----------

export async function deliveriesScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'CRM deliveries'));
  const deliveries = await api<{ deliveries: CrmDelivery[] }>(`/commissions/${id}/webhook-deliveries`).catch(() => null);
  if (!deliveries || deliveries.deliveries.length === 0) {
    section.append(el('p', { class: 'empty-state' }, 'No CRM deliveries yet. Add your endpoint?'));
    app.main.append(section);
    return;
  }
  const table = el('table', { class: 'table wide' });
  table.setAttribute('aria-label', 'CRM deliveries');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Event', 'Type', 'Created', 'Attempts', 'Final state']) headRow.append(el('th', {}, h));
  thead.append(headRow);
  table.append(thead);
  const tbody = el('tbody');
  for (const d of deliveries.deliveries) {
    const row = el('tr');
    row.append(
      el('td', {}, d.eventId),
      el('td', {}, d.eventType),
      el('td', {}, new Date(d.createdAt).toLocaleString()),
      el('td', {}, String(d.attempts.length)),
      el('td', {}, d.finalState),
    );
    row.addEventListener('click', () => {
      const detail = row.nextElementSibling;
      if (detail) detail.remove();
      else {
        const detailRow = el('tr', { class: 'attempt-detail' });
        const cell = el('td', { colspan: '5' });
        for (const attempt of d.attempts) {
          cell.append(el('p', { class: 'muted small' }, `${new Date(attempt.at).toLocaleString()} — ${attempt.responseStatus} — ${attempt.status}`));
        }
        detailRow.append(cell);
        row.after(detailRow);
      }
    });
    tbody.append(row);
  }
  table.append(tbody);
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(table);
  section.append(scroll);
  app.main.append(section);
}

// ---------- Maintenance ----------

export async function maintenanceScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Maintenance'));
  const existing = await api<{ plan: string; chargedThroughDate: string | null; invoices: Array<{ invoiceNumber: string; amountCents: number; items: Array<{ description: string; amountCents: number; startDate: string; endDate: string | null }> }> }>(`/commissions/${id}/maintenance`).catch(() => null);
  const commission = await api<Commission>(`/commissions/${id}`).catch(() => null);

  const planGroup = el('div', { class: 'chip-group', role: 'radiogroup', 'aria-label': 'Maintenance plan' });
  let selected = 'essential';
  for (const [value, label] of [
    ['essential', 'Essential'],
    ['priority', 'Priority'],
  ] as const) {
    const option = el('label', { class: 'chip-wrap' });
    const input = el('input', { type: 'radio', name: 'plan', value });
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      if (input.checked) selected = value;
    });
    if (existing?.plan === value) {
      input.checked = true;
      selected = value;
    }
    option.append(input, el('span', { class: 'chip-box' }), el('span', { class: 'chip-label' }, label));
    planGroup.append(option);
  }
  section.append(planGroup);

  if (!existing) {
    const start = el('button', { class: 'btn primary' }, 'Start maintenance');
    start.addEventListener('click', async () => {
      try {
        await api(`/commissions/${id}/maintenance`, { method: 'POST', body: { plan: selected } });
        toast(`Maintenance started on the ${selected === 'essential' ? 'Essential' : 'Priority'} plan.`);
        window.location.reload();
      } catch (e) {
        if (e instanceof ApiError) {
          toast(e.code === 'milestone_unpaid' ? "That step isn't available yet." : e.message || 'Could not start maintenance.');
        }
      }
    });
    section.append(start);
  } else {
    section.append(el('h2', {}, 'Current plan'));
    section.append(el('p', {}, `${existing.plan} — charged through ${existing.chargedThroughDate ?? 'today'}`));
    const change = el('button', { class: 'btn primary' }, 'Change plan');
    change.addEventListener('click', async () => {
      try {
        const result = await api<{ plan: string; previousPlan: string; prorationDate: string; invoice: { items: Array<{ description: string; amountCents: number; startDate: string; endDate: string | null }>; amountCents: number } | null }>(`/commissions/${id}/maintenance`, {
          method: 'PUT',
          body: { plan: selected },
        });
        toast(`Switched to the ${result.plan === 'essential' ? 'Essential' : 'Priority'} plan. Kill Bill's proration is below.`);
        if (result.invoice) {
          const table = el('table', { class: 'table' });
          table.setAttribute('aria-label', 'Proration');
          const thead = el('thead');
          const headRow = el('tr');
          for (const h of ['Description', 'Amount', 'Start', 'End']) headRow.append(el('th', {}, h));
          thead.append(headRow);
          table.append(thead);
          const tbody = el('tbody');
          for (const item of result.invoice.items) {
            const row = el('tr');
            row.append(el('td', {}, item.description), el('td', {}, money(item.amountCents)), el('td', {}, item.startDate), el('td', {}, item.endDate ?? '—'));
            tbody.append(row);
          }
          table.append(tbody);
          section.querySelector('.proration')?.remove();
          const proration = el('section', { class: 'card proration' });
          proration.append(el('h2', {}, 'Proration'), table);
          section.append(proration);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === 'same_plan') {
            toast("You're already on that plan.");
          } else {
            toast(e.message || 'Could not change the plan.');
          }
        }
      }
    });
    section.append(change);
  }
  void commission;
  app.main.append(section);
}
