// Rules, the daily report, months and month close, the regulator's files,
// partner keys, members and the directory listing.
import { h, inputText, selectEl } from './dom.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { openDialog, type PanelHandle } from './panels.js';
import { problemsRegion, fieldErrorsClear } from './feedback.js';
import { staffView, h1 } from './staff-frame.js';
import { registerDialogOpener } from './state.js';
import { fieldWrap, handleAuth } from './screens-cases.js';
import { formatStamp, formatFiat, formatMonthLabel } from './format.js';

// ---------- Rules ----------

interface RuleChange { id: string; thresholdCents: number; takesEffectOn: string; takesEffectAt: string; announcedBy: string; announcedAt: string; state: string }
interface RuleJurisdiction { code: string; name: string; currency: string; ruleInForce: { thresholdCents: number; since: string } | null; changes: RuleChange[] }

export async function renderRules(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const role = (await import('./state.js')).getSession()?.member.role ?? '';
  const isOfficer = role === 'compliance_officer';
  const tableWrap = h('div', { class: 'table-wrap' });

  const announceButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Announce change', onclick: (e: Event) => openAnnounceDialog(e.currentTarget as HTMLElement) }, 'Announce change');
  view.work.append(h('div', { class: 'screen-head' }, h1('Rules'),
    h('div', { class: 'head-actions' }, isOfficer ? announceButton : '')), tableWrap);

  view.evidence.append(h('div', { class: 'evidence' },
    h('h2', {}, 'Our rule'),
    h('p', { class: 'hint' }, `${ws.jurisdictionCode} threshold ${formatFiat(ws.currency, 0)} (the workspace's own rule book).`)));

  async function load(): Promise<void> {
    const res = await api<{ jurisdictions: RuleJurisdiction[] }>('GET', `/api/w/${slug}/rules`);
    if (res.ok && res.body !== null) {
      const rows = res.body.jurisdictions;
      const headers = ['Jurisdiction', 'Rule in force', 'Since', 'Announced change'];
      tableWrap.replaceChildren(h('table', { 'aria-label': 'Jurisdiction rules', class: 'table' },
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.map((j) => h('tr', {},
          h('td', {}, h('a', { href: `/w/${slug}/rules/${j.code}` }, j.name)),
          h('td', { class: 'mono' }, j.ruleInForce !== null ? formatFiat(j.currency, j.ruleInForce.thresholdCents) : 'No rule'),
          h('td', { class: 'mono' }, j.ruleInForce !== null ? j.ruleInForce.since : '—'),
          h('td', { class: 'mono' }, j.changes.length > 0 ? `${formatFiat(j.currency, j.changes[j.changes.length - 1].thresholdCents)} from ${j.changes[j.changes.length - 1].takesEffectOn}` : ''))))));
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }

  function openAnnounceDialog(opener: HTMLElement, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Announce change', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        const jurisdiction = selectEl({ id: 'jurisdictionCode', 'aria-label': 'Jurisdiction', class: 'select' });
        void loadJurisdictionOptions(jurisdiction, slug, ws.jurisdictionCode);
        const threshold = inputText({ id: 'thresholdCents', 'aria-label': 'Threshold', class: 'input mono', placeholder: '1000.00', value: initial.threshold ?? '' });
        const takesEffectOn = inputText({ id: 'takesEffectOn', 'aria-label': 'Takes effect on', class: 'input mono', value: initial.takesEffectOn ?? ws.today });
        dialog.append(h('h2', {}, 'Announce change'), problemsRegion(),
          fieldWrap(jurisdiction, 'Jurisdiction'), fieldWrap(threshold, 'Threshold'), fieldWrap(takesEffectOn, 'Takes effect on'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Announce', onclick: async () => {
              desk.announce('Announcing…');
              fieldErrorsClear(dialog);
              const amountParts = threshold.value.split('.');
              const whole = amountParts[0] ?? '0';
              const frac = (amountParts[1] ?? '0').padEnd(2, '0');
              const cents = Number(`${whole}${frac}`);
              const res = await api<{ change: RuleChange }>('POST', `/api/w/${slug}/rules/changes`, {
                jurisdictionCode: jurisdiction.value, thresholdCents: cents, takesEffectOn: takesEffectOn.value,
              });
              if (res.ok && res.body !== null) {
                const change = res.body.change;
                const name = await jurisdictionName(jurisdiction.value);
                desk.announce(`Change announced for ${name} from ${change.takesEffectOn}.`);
                panel.close();
                navigate(`/w/${slug}/rules/${jurisdiction.value}`);
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'announce', { threshold: threshold.value, takesEffectOn: takesEffectOn.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Announce'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }

  registerDialogOpener('announce', (values) => {
    openAnnounceDialog(announceButton, values);
  });

  await load();
  startPollingRules();
  function startPollingRules(): void {
    import('./state.js').then(({ startPolling }) => startPolling(async () => {
      await load();
    }));
  }
}

async function loadJurisdictionOptions(select: HTMLSelectElement, slug: string, own: string): Promise<void> {
  const res = await api<{ jurisdictions: RuleJurisdiction[] }>('GET', `/api/w/${slug}/rules`);
  const options = (res.body?.jurisdictions ?? []).map((j) => h('option', { value: j.code }, `${j.name} (${j.code})`));
  select.replaceChildren(...options);
  select.value = own;
}

async function jurisdictionName(code: string): Promise<string> {
  const res = await api<{ jurisdiction: { name: string } }>('GET', `/api/public/jurisdictions/${code}`);
  return res.body?.jurisdiction.name ?? code;
}

export async function renderRulePage(root: HTMLElement, slug: string, code: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const res = await api<{ jurisdiction: RuleJurisdiction }>('GET', `/api/w/${slug}/rules/${code}`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', view.desk, 'none', {}); return; }
  const jurisdiction = res.body?.jurisdiction;
  const name = jurisdiction?.name ?? code;
  view.work.append(h1(`${name} rules`));
  const rows = jurisdiction?.changes ?? [];
  view.work.append(h('table', { 'aria-label': 'Rule history', class: 'table' },
    h('thead', {}, h('tr', {}, ['Threshold', 'Takes effect', 'Announced by', 'Announced at', 'State'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, rows.length === 0
      ? h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Nothing here yet.'))
      : rows.map((c) => h('tr', {},
        h('td', { class: 'mono' }, formatFiat(jurisdiction?.currency ?? 'EUR', c.thresholdCents)),
        h('td', { class: 'mono' }, c.takesEffectOn),
        h('td', {}, c.announcedBy),
        h('td', { class: 'mono' }, formatStamp(c.announcedAt, view.ws.timeZone, view.ws.city)),
        h('td', {}, c.state))))));
}

// ---------- Daily report ----------

export async function renderDailyReport(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const facts = h('div', { class: 'day-facts' });
  const tableWrap = h('div', { class: 'table-wrap' });
  const date = inputText({ id: 'date', 'aria-label': 'Business date', class: 'input mono', value: ws.today });
  view.work.append(
    h('div', { class: 'screen-head' }, h1('Daily report'),
      h('div', { class: 'head-actions' },
        fieldWrap(date, 'Business date'),
        h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Show report', onclick: () => void load() }, 'Show report'))),
    facts, tableWrap);

  async function load(): Promise<void> {
    const res = await api<{ date: string; timeZone: string; startsAt: string; endsAt: string; hours: number; transfers: number; cases: { reference: string; createdAt: string; asset: string; amount: string; fiatValueCents: number; currency: string; counterpartyName: string | null; status: string }[] }>('GET', `/api/w/${slug}/reports/daily?date=${date.value}`);
    if (res.ok && res.body !== null) {
      const d = res.body;
      facts.replaceChildren(
        h('p', { class: 'fact' }, `Starts ${formatStamp(d.startsAt, ws.timeZone, ws.city)}`),
        h('p', { class: 'fact' }, `Ends ${formatStamp(d.endsAt, ws.timeZone, ws.city)}`),
        h('p', { class: 'fact' }, `Length ${d.hours} hours`),
        h('p', { class: 'fact' }, `${d.transfers} transfers`));
      if (d.cases.length === 0) {
        tableWrap.replaceChildren(h('p', { class: 'hint' }, `No transfers on ${d.date}.`));
      } else {
        tableWrap.replaceChildren(h('table', { 'aria-label': 'Transfers', class: 'table' },
          h('thead', {}, h('tr', {}, ['Reference', 'Created', 'Amount', 'Fiat value', 'Counterparty', 'Status'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', {}, d.cases.map((c) => h('tr', {},
            h('td', {}, c.reference),
            h('td', { class: 'mono' }, formatStamp(c.createdAt, ws.timeZone, ws.city)),
            h('td', { class: 'mono' }, `${c.asset} ${c.amount}`),
            h('td', { class: 'mono' }, formatFiat(c.currency, c.fiatValueCents)),
            h('td', {}, c.counterpartyName ?? 'Self-hosted wallet'),
            h('td', {}, c.status))))));
      }
      desk.repaint();
    } else if (res.error !== null) {
      desk.announce(res.error.message, 'error');
    }
  }

  await load();
}

// ---------- Months ----------

interface MonthSummary { month: string; status: string; messageCount: number; totalCents: number; currency: string; invoiceId: string | null; closedAt: string | null }

export async function renderMonths(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk } = view;
  const tableWrap = h('div', { class: 'table-wrap' });
  view.work.append(h('div', { class: 'screen-head' }, h1('Months')), tableWrap);

  const res = await api<{ months: MonthSummary[] }>('GET', `/api/w/${slug}/months`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', desk, 'none', {}); return; }
  const months = res.body?.months ?? [];
  tableWrap.replaceChildren(h('table', { 'aria-label': 'Business months', class: 'table' },
    h('thead', {}, h('tr', {}, ['Month', 'Messages', 'Total', 'Status'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, months.map((m) => h('tr', {},
      h('td', {}, h('a', { href: `/w/${slug}/months/${m.month}` }, formatMonthLabel(m.month))),
      h('td', { class: 'mono' }, String(m.messageCount)),
      h('td', { class: 'mono' }, formatFiat(m.currency, m.totalCents)),
      h('td', {}, monthStatus(m)))))));
}

function monthStatus(m: MonthSummary): string {
  if (m.status === 'invoiced') return 'Invoiced';
  if (m.status === 'ready') return 'Ready to close';
  return 'Open';
}

export async function renderMonthPage(root: HTMLElement, slug: string, month: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk } = view;
  const role = (await import('./state.js')).getSession()?.member.role ?? '';
  const res = await api<{ month: MonthSummary & { lines: { tier: number; label: string; count: number; unitPrice: string; amountCents: number }[] } }>('GET', `/api/w/${slug}/months/${month}`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', desk, 'none', {}); return; }
  const m = res.body?.month;
  if (m === undefined) {
    view.work.append(h1('Not found'));
    return;
  }
  view.work.append(h('div', { class: 'screen-head' }, h1(formatMonthLabel(month)),
    h('div', { class: 'head-actions' }, role === 'finance_lead' && m.status === 'ready'
      ? h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Close month', onclick: (e: Event) => openCloseDialog(m, e.currentTarget as HTMLElement) }, 'Close month')
      : '')));
  view.work.append(h('table', { 'aria-label': 'Fee lines', class: 'table' },
    h('thead', {}, h('tr', {}, ['Tier', 'Messages', 'Unit price', 'Amount'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, m.lines.length === 0
      ? h('tr', {}, h('td', { colspan: '4', class: 'empty' }, 'Nothing here yet.'))
      : m.lines.map((line) => h('tr', {},
        h('td', {}, line.label),
        h('td', { class: 'mono' }, String(line.count)),
        h('td', { class: 'mono' }, line.unitPrice),
        h('td', { class: 'mono' }, formatFiat(m.currency, line.amountCents)))))));
  view.evidence.append(h('div', { class: 'evidence' },
    h('h2', {}, 'Invoice'),
    h('p', { class: 'hint mono' }, m.invoiceId !== null ? `Invoice id ${m.invoiceId}` : 'No invoice yet.'),
    h('p', { class: 'hint' }, `Status ${monthStatus(m)}`)));

  function openCloseDialog(m0: MonthSummary & { lines: { tier: number; label: string; count: number; unitPrice: string; amountCents: number }[] }, opener: HTMLElement): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Close month', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        dialog.append(h('h2', {}, 'Close month'),
          h('p', { class: 'hint' }, `${formatMonthLabel(month)} fee lines:`),
          h('ul', { class: 'fee-lines' }, m0.lines.map((line) =>
            h('li', { class: 'mono' }, `${line.label}: ${line.count} × ${line.unitPrice} = ${formatFiat(m0.currency, line.amountCents)}`))),
          h('p', { class: 'hint' }, `Total ${formatFiat(m0.currency, m0.totalCents)}`),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel'),
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Close month', onclick: async () => {
              desk.announce('Closing month…');
              const res = await api<{ month: MonthSummary }>('POST', `/api/w/${slug}/months/${month}/close`, {});
              if (res.ok && res.body !== null) {
                desk.announce(`${formatMonthLabel(month)} closed. Invoice received.`);
                panel.close();
                await refresh();
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'close-month', {}); return; }
                desk.announce(res.error.message, 'error');
              }
            } }, 'Close month')));
      },
    });
  }

  async function refresh(): Promise<void> {
    const { renderRoute } = await import('./router.js');
    await renderRoute();
  }
}
