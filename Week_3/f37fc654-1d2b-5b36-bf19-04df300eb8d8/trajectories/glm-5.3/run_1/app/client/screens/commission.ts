/** Commission overview: milestones, documents, funders, ledger. */
import { getApp, goto } from '../app.js';
import { api, ApiError } from '../api.js';
import { el, toast } from '../dom.js';
import type { Commission, Funder } from '../types.js';
import { money, formatDate } from '../types.js';
import { renderTypedHeading, createCursor, prefersReducedMotion } from '../cue-line.js';
import type { RouteContext } from './router.js';

export async function commissionScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const commission = await api<Commission>(`/commissions/${id}`).catch(() => null);
  if (!commission) {
    app.main.append(el('h1', {}, 'Not found'));
    return;
  }
  await renderCommission(app, commission, true);
}

export async function renderCommission(app: ReturnType<typeof getApp>, commission: Commission, typedHeading: boolean): Promise<void> {
  app.main.textContent = '';
  const section = el('section', { class: 'card' });
  const heading = el('h1', { class: 'page-heading' });
  const cursor = createCursor();
  const headingText = typedHeading ? 'Your room is ready.' : commission.title;
  if (typedHeading && !prefersReducedMotion()) {
    renderTypedHeading(heading, headingText, cursor, () => undefined);
  } else {
    heading.textContent = headingText;
  }
  const badge = el('span', { class: 'state-badge' }, stateLabel(commission.state));
  const venueLine = el('p', { class: 'muted' }, `${commission.venue.name} — ${commission.venue.city}`);
  const headingRow = el('div', { class: 'heading-row' });
  headingRow.append(heading, cursor, badge);
  section.append(headingRow, venueLine);
  app.main.append(section);

  // Milestones table.
  const msSection = el('section', { class: 'card' });
  msSection.append(el('h2', {}, 'Milestones'));
  const msTable = el('table', { class: 'table' });
  msTable.setAttribute('aria-label', 'Milestones');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Milestone', 'Amount', 'Due', 'State', 'Invoice']) {
    headRow.append(el('th', {}, h));
  }
  thead.append(headRow);
  msTable.append(thead);
  const tbody = el('tbody');
  for (const m of commission.milestones) {
    const row = el('tr');
    row.append(
      el('td', {}, m.label),
      el('td', {}, money(m.amountCents)),
      el('td', {}, m.dueAt ? formatDate(commission.venue.timeZone ? localDateOf(m.dueAt, commission.venue.timeZone) : m.dueAt.slice(0, 10)) : '—'),
      el('td', {}, m.state),
      el('td', {}, m.killbillInvoiceId ? 'Kill Bill' : '—'),
    );
    tbody.append(row);
  }
  msTable.append(tbody);
  const msScroll = el('div', { class: 'table-scroll' });
  msScroll.append(msTable);
  msSection.append(msScroll);
  app.main.append(msSection);

  // Documents list.
  const docs = await api<{ documents: Array<{ id: string; kind: string; version: number; label: string; status: string; sha256: string | null; sizeBytes: number | null }> }>(`/commissions/${commission.id}/documents`).catch(() => null);
  const docSection = el('section', { class: 'card' });
  docSection.append(el('h2', {}, 'Documents'));
  const docList = el('ul', { class: 'doc-list', 'aria-label': 'Documents' });
  if (docs && docs.documents.length > 0) {
    for (const d of docs.documents) {
      const li = el('li', { class: 'doc-item' });
      const link = el('a', { href: `/api/documents/${d.id}/pdf`, class: 'doc-link' }, d.label);
      const meta = el('span', { class: 'muted small' }, `${d.kind} v${d.version} · ${d.status}${d.sha256 ? ` · ${d.sha256.slice(0, 12)}…` : ''}`);
      li.append(link, meta);
      docList.append(li);
    }
  } else {
    docList.append(el('li', { class: 'muted' }, 'No documents yet.'));
  }
  docSection.append(docList);
  app.main.append(docSection);

  // Funders (producer editable).
  const me = app.me;
  const isProducer = me?.roles[0] === 'producer';
  const isClient = me?.id === commission.clientId;
  const funderSection = el('section', { class: 'card' });
  funderSection.append(el('h2', {}, 'Funders'));
  await renderFunders(funderSection, commission, isProducer);
  app.main.append(funderSection);

  // Ledger.
  const ledger = await api<{ entries: Array<{ payerName: string; label: string; amountCents: number; at: string }> }>(`/commissions/${commission.id}/ledger`).catch(() => null);
  const ledgerSection = el('section', { class: 'card' });
  ledgerSection.append(el('h2', {}, 'Ledger'));
  const ledgerTable = el('table', { class: 'table' });
  ledgerTable.setAttribute('aria-label', 'Ledger');
  const lthead = el('thead');
  const lheadRow = el('tr');
  for (const h of ['Payer', 'Label', 'Amount', 'At']) lheadRow.append(el('th', {}, h));
  lthead.append(lheadRow);
  ledgerTable.append(lthead);
  const ltbody = el('tbody');
  for (const e of ledger?.entries ?? []) {
    const row = el('tr');
    row.append(el('td', {}, e.payerName), el('td', {}, e.label), el('td', {}, money(e.amountCents)), el('td', {}, new Date(e.at).toLocaleString()));
    ltbody.append(row);
  }
  ledgerTable.append(ltbody);
  const lScroll = el('div', { class: 'table-scroll' });
  lScroll.append(ledgerTable);
  ledgerSection.append(lScroll);
  app.main.append(ledgerSection);

  // Actions and links.
  const linksSection = el('section', { class: 'card actions-row' });
  for (const [label, href] of [
    ['Files', `/c/${commission.id}/files`],
    ['Preview', `/c/${commission.id}/preview`],
    ['Configure', `/c/${commission.id}/configure`],
    ['Install day', `/c/${commission.id}/day`],
    ['Checkout', `/c/${commission.id}/checkout`],
    ['CRM deliveries', `/c/${commission.id}/webhooks`],
    ['Maintenance', `/c/${commission.id}/maintenance`],
  ] as const) {
    const a = el('a', { href, class: 'btn ghost' }, label);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      goto(href);
    });
    linksSection.append(a);
  }
  if (isClient) {
    if (commission.state === 'contracted') {
      const approve = el('button', { class: 'btn primary' }, 'Approve concept');
      approve.addEventListener('click', () => {
        void transition(commission.id, 'concept_approved');
      });
      linksSection.append(approve);
    }
    if (commission.state === 'installed') {
      const sign = el('button', { class: 'btn primary' }, 'Sign acceptance');
      sign.addEventListener('click', () => {
        void transition(commission.id, 'accepted');
      });
      linksSection.append(sign);
    }
  }
  if (isProducer) {
    if (commission.state === 'concept_approved') {
      const fab = el('button', { class: 'btn primary' }, 'Start fabrication');
      fab.addEventListener('click', () => {
        void transition(commission.id, 'fabricating');
      });
      linksSection.append(fab);
    }
    if (['briefed', 'previewed', 'placed', 'held', 'contracted', 'concept_approved'].includes(commission.state)) {
      const cancel = el('button', { class: 'btn danger' }, 'Cancel commission');
      cancel.addEventListener('click', () => {
        void transition(commission.id, 'cancelled');
      });
      linksSection.append(cancel);
    }
  }
  app.main.append(linksSection);
}

async function transition(id: string, to: string): Promise<void> {
  try {
    await api(`/commissions/${id}/transitions`, { method: 'POST', body: { to } });
    toast(transitionsToast(to));
    const commission = await api<Commission>(`/commissions/${id}`);
    await renderCommission(getApp(), commission, false);
  } catch (e) {
    if (e instanceof ApiError) {
      toast(e.code === 'milestone_unpaid' ? 'That step isn\'t available yet.' : e.message || 'That step isn\'t available yet.');
    }
  }
}

function transitionsToast(to: string): string {
  const map: Record<string, string> = {
    concept_approved: 'Concept approved.',
    fabricating: 'Fabrication started.',
    installed: 'Installation confirmed.',
    accepted: 'Acceptance signed.',
    cancelled: 'Commission cancelled.',
  };
  return map[to] ?? 'Done.';
}

async function renderFunders(section: HTMLElement, commission: Commission, editable: boolean): Promise<void> {
  const existing = section.querySelector('.funders-edit');
  existing?.remove();
  const wrap = el('div', { class: 'funders-edit' });
  const list = el('div', { class: 'funders-list' });
  const rows: Array<{ name: string; email: string; bp: string; row: HTMLElement }> = [];
  const renderRow = (funder: Funder | null): HTMLElement => {
    const row = el('div', { class: 'funder-row' });
    const name = el('input', { type: 'text', class: 'answer-field', value: funder?.name ?? '' });
    name.setAttribute('aria-label', 'Sponsor name');
    name.disabled = !editable;
    const email = el('input', { type: 'text', class: 'answer-field', value: funder?.email ?? '' });
    email.setAttribute('aria-label', 'Sponsor email');
    email.disabled = !editable;
    const bp = el('input', { type: 'text', class: 'answer-field bp', value: funder ? (funder.bp / 100).toFixed(2) : '' });
    bp.setAttribute('aria-label', 'Share percent');
    bp.disabled = !editable;
    row.append(name, email, bp);
    rows.push({ name: name.value, email: email.value, bp: bp.value, row });
    return row;
  };
  for (const f of commission.funders) {
    if (f.kind === 'client') {
      const line = el('p', { class: 'muted' }, `Lead client — ${f.name ?? ''} — ${(f.bp / 100).toFixed(2)}%`);
      list.append(line);
    } else {
      const row = renderRow(f);
      const actions = el('span', { class: 'funder-actions' });
      if (editable) {
        const resend = el('button', { class: 'btn ghost small' }, 'Resend invite');
        resend.addEventListener('click', async () => {
          try {
            await api(`/funders/${f.id}/invite`, { method: 'POST' });
            toast('Invites are on their way.');
          } catch (e) {
            if (e instanceof ApiError) toast(e.message || 'Could not resend.');
          }
        });
        const revoke = el('button', { class: 'btn ghost small' }, 'Revoke invite');
        revoke.addEventListener('click', async () => {
          try {
            await api(`/funders/${f.id}/invite`, { method: 'DELETE' });
            toast('Invite revoked.');
            const fresh = await api<Commission>(`/commissions/${commission.id}`);
            await renderCommission(getApp(), fresh, false);
          } catch (e) {
            if (e instanceof ApiError) toast(e.message || 'Could not revoke.');
          }
        });
        actions.append(resend, revoke);
      }
      row.append(actions);
      list.append(row);
    }
  }
  if (editable) {
    const add = el('button', { class: 'btn ghost small' }, 'Add sponsor');
    add.addEventListener('click', () => {
      list.append(renderRow(null));
    });
    const save = el('button', { class: 'btn primary small' }, 'Save funders');
    save.addEventListener('click', async () => {
      const sponsorRows = Array.from(list.querySelectorAll<HTMLElement>('.funder-row')).map((row) => {
        const inputs = row.querySelectorAll<HTMLInputElement>('input');
        return {
          kind: 'sponsor',
          name: inputs[0]?.value ?? '',
          email: inputs[1]?.value ?? '',
          bp: Math.round(Number(inputs[2]?.value ?? '0') * 100),
        };
      });
      const clientBp = 10000 - sponsorRows.reduce((s, r) => s + r.bp, 0);
      const body = { funders: [{ kind: 'client', bp: clientBp }, ...sponsorRows] };
      try {
        await api(`/commissions/${commission.id}/funders`, { method: 'PUT', body });
        toast('Funders saved. Invites are on their way.');
        const fresh = await api<Commission>(`/commissions/${commission.id}`);
        await renderCommission(getApp(), fresh, false);
      } catch (e) {
        if (e instanceof ApiError) {
          toast(e.code === 'funders_locked' ? 'Funders are locked once a sponsor accepts or the deposit is paid.' : 'Shares must add up to 100.00%.');
        }
      }
    });
    list.append(add, save);
  }
  wrap.append(list);
  section.append(wrap);
}

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    briefed: 'Briefed',
    previewed: 'Previewed',
    placed: 'Placed',
    held: 'Held',
    contracted: 'Contracted',
    concept_approved: 'Concept approved',
    fabricating: 'Fabricating',
    installed: 'Installed',
    accepted: 'Accepted',
    maintained: 'Maintained',
    cancelled: 'Cancelled',
  };
  return map[state] ?? state;
}

function localDateOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
