// The remaining staff screens: review queue, incoming messages, counterparties,
// rules, months, regulator's files, partner keys, members and the listing.
import { h, inputText, radioGroup, radioValue } from './dom.js';
import { api } from './api.js';
import { openDialog, type PanelHandle } from './panels.js';
import { problemsRegion, fieldErrorsClear } from './feedback.js';
import { staffView, h1 } from './staff-frame.js';
import { startPolling, getSession, registerDialogOpener } from './state.js';
import { fieldWrap, handleAuth } from './screens-cases.js';
import { formatStamp, formatFiat, formatCountdown } from './format.js';

// ---------- Review queue ----------

interface Claim { memberId: string; memberName: string; claimedAt: string; endsAt: string; remainingSeconds: number }
interface ReviewRow { id: string; reference: string; counterparty: { id: string; name: string }; fiatValueCents: number; currency: string; createdAt: string; claim: Claim | null }

export async function renderReview(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const role = getSession()?.member.role ?? 'compliance_analyst';
  const memberId = getSession()?.member.id ?? '';
  const tableWrap = h('div', { class: 'table-wrap' });
  const claimPanel = h('div', { class: 'claim-panel' });
  const claimCountdown = h('div', { role: 'timer', 'aria-label': 'Claim countdown', class: 'countdown mono' });
  let lastRows: ReviewRow[] = [];

  view.work.append(h('div', { class: 'screen-head' }, h1('Review queue')), tableWrap);
  view.evidence.append(claimPanel);

  async function load(): Promise<void> {
    const res = await api<{ cases: ReviewRow[] }>('GET', `/api/w/${slug}/review`);
    if (res.ok && res.body !== null) {
      const rows = res.body.cases;
      lastRows = rows;
      const headers = ['Reference', 'Counterparty', 'Fiat value', 'Created', 'Claim'];
      tableWrap.replaceChildren(h('table', { 'aria-label': 'Cases in review', class: 'table' },
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.length === 0
          ? h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Nothing here yet.'))
          : rows.map((r) => h('tr', {},
            h('td', {}, h('a', { href: `/w/${slug}/cases/${r.id}` }, r.reference)),
            h('td', {}, r.counterparty.name),
            h('td', { class: 'mono' }, formatFiat(r.currency, r.fiatValueCents)),
            h('td', { class: 'mono' }, formatStamp(r.createdAt, ws.timeZone, ws.city)),
            h('td', {}, r.claim === null || role !== 'compliance_analyst'
              ? ''
              : r.claim.memberId === memberId
                ? h('button', { type: 'button', class: 'btn', 'aria-label': 'Decide', onclick: (e: Event) => openDecideDialog(r, e.currentTarget as HTMLElement) }, 'Decide')
                : h('button', { type: 'button', class: 'btn', 'aria-label': 'Claim', onclick: (e: Event) => void claim(r, e.currentTarget as HTMLElement) }, 'Claim')))),
        )));
      const mine = rows.find((r) => r.claim !== null && r.claim.memberId === memberId);
      claimCountdown.textContent = mine !== undefined && mine.claim !== null ? `Claim ends in ${formatCountdown(mine.claim.remainingSeconds)}` : '';
      claimPanel.replaceChildren(h('h2', {}, 'Your claim'), claimCountdown,
        h('p', { class: 'hint' }, mine !== undefined ? `You hold ${mine.reference}.` : 'Claim a case to decide it.'));
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }

  async function claim(row: ReviewRow, opener: HTMLElement): Promise<void> {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Claim case', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        dialog.append(h('h2', {}, 'Claim case'), h('p', {}, `Claim ${row.reference}?`),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Claim', onclick: async () => {
              desk.announce('Claiming…');
              const res = await api<{ claim: Claim }>('POST', `/api/w/${slug}/review/${row.id}/claim`, {});
              if (res.ok && res.body !== null) {
                desk.announce(`Claimed. Your claim lasts until ${formatStamp(res.body.claim.endsAt, ws.timeZone, ws.city)}.`);
                panel.close();
                await load();
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'claim', {}); return; }
                desk.announce(res.error.message, 'error');
                panel.close();
                await load();
              }
            } }, 'Claim'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }

  function openDecideDialog(row: ReviewRow, opener: HTMLElement, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Decide case', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        const decision = radioGroup('Decision', [
          { value: 'reject', label: 'Reject', checked: true },
          { value: 'accept', label: 'Accept', checked: false },
        ]);
        const reason = inputText({ id: 'reason', 'aria-label': 'Reason', class: 'input', value: initial.reason ?? '' });
        dialog.append(h('h2', {}, 'Decide case'), problemsRegion(),
          fieldWrap(decision, 'Decision'), fieldWrap(reason, 'Reason'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Save decision', onclick: async () => {
              const value = radioValue('Decision') ?? 'reject';
              desk.announce('Saving decision…');
              fieldErrorsClear(dialog);
              const res = await api('POST', `/api/w/${slug}/review/${row.id}/decision`, { decision: value, reason: reason.value });
              if (res.ok) {
                desk.announce(`Decision saved: ${value === 'accept' ? 'Accepted' : 'Rejected'}.`);
                panel.close();
                await load();
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'decision', { decision: value, reason: reason.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
                else await load();
              }
            } }, 'Save decision'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }

  registerDialogOpener('decision', (values) => {
    const rows = lastRows;
    const mine = rows.find((r) => r.claim !== null && r.claim.memberId === memberId);
    if (mine !== undefined) openDecideDialog(mine, claimPanel, values);
  });

  await load();
  startPolling(async () => {
    await load();
  });
}

// ---------- Incoming messages ----------

interface MessageRow { id: string; messageId: string; type: string; receivedAt: string; counterparty: { name: string }; outcome: string }

export async function renderMessages(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const tableWrap = h('div', { class: 'table-wrap' });
  view.work.append(h('div', { class: 'screen-head' }, h1('Incoming messages')), tableWrap);
  const res = await api<{ messages: MessageRow[] }>('GET', `/api/w/${slug}/messages`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', desk, 'none', {}); return; }
  const rows = res.body?.messages ?? [];
  const headers = ['Received', 'Sender', 'Message id', 'Type', 'Outcome'];
  tableWrap.replaceChildren(h('table', { 'aria-label': 'Incoming messages', class: 'table' },
    h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, rows.length === 0
      ? h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Nothing here yet.'))
      : rows.map((m) => h('tr', {},
        h('td', { class: 'mono' }, formatStamp(m.receivedAt, ws.timeZone, ws.city)),
        h('td', {}, h('a', { href: `/w/${slug}/messages/${m.id}` }, m.counterparty.name)),
        h('td', { class: 'mono' }, m.messageId),
        h('td', {}, m.type),
        h('td', {}, m.outcome))))));
}

interface MessageBody extends MessageRow {
  working: Record<string, unknown> | null;
  nameCheck: { result: string; customerId: string; customerName: string } | null;
  sha256: string; sizeBytes: number;
}

export async function renderMessagePage(root: HTMLElement, slug: string, messageId: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const role = getSession()?.member.role ?? 'compliance_analyst';
  const res = await api<{ message: MessageBody }>('GET', `/api/w/${slug}/messages/${messageId}`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', desk, 'none', {}); return; }
  const message = res.body?.message;
  if (message === undefined) {
    view.work.append(h1('Message not found'));
    return;
  }
  view.work.append(h('div', { class: 'screen-head' }, h1(`Message ${message.messageId}`)));
  const nameCheckText = message.nameCheck != null ? `Name check: ${message.nameCheck.result === 'match' ? 'Match' : message.nameCheck.result === 'partial' ? 'Partial' : 'No match'}` : '';
  view.work.append(
    h('p', { class: 'name-check' }, nameCheckText),
    h('p', { class: 'hint mono' }, `SHA-256 ${message.sha256} · ${message.sizeBytes} bytes · received ${formatStamp(message.receivedAt, ws.timeZone, ws.city)}`),
    role !== 'support_agent'
      ? h('button', { type: 'button', class: 'btn', 'aria-label': 'Download original', onclick: async () => {
          desk.announce('Preparing file…');
          const response = await fetch(`/api/w/${slug}/messages/${message.id}/original`);
          if (response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            triggerDownload(`${message.messageId}.json`, bytes, 'application/json');
            desk.announce(`File downloaded: ${message.messageId}.json.`);
          } else {
            const body = await response.json() as { error: { message: string } };
            desk.announce(body.error.message, 'error');
          }
        } }, 'Download original')
      : '',
    h('pre', { class: 'working-copy mono' }, JSON.stringify(message.working ?? {}, null, 2)),
  );
  const facts = h('div', { role: 'region', 'aria-label': 'Message facts', class: 'evidence' });
  facts.append(h('h2', {}, 'Message facts'), factPairs([
    ['Received', formatStamp(message.receivedAt, ws.timeZone, ws.city)],
    ['Sender', message.counterparty.name],
    ['Type', message.type],
    ['Outcome', message.outcome],
    ['Message id', message.messageId],
  ]));
  const showFacts = h('button', { type: 'button', class: 'btn show-facts', 'aria-label': 'Show facts', onclick: (e: Event) => {
    let factsPanel!: PanelHandle;
    factsPanel = openDialog({
      name: 'Message facts', kind: 'sheet', opener: e.currentTarget as HTMLElement, onClose: () => {},
      build: (dialog) => {
        dialog.append(h('h2', {}, 'Message facts'),
          factPairs([
            ['Received', formatStamp(message.receivedAt, ws.timeZone, ws.city)],
            ['Sender', message.counterparty.name],
            ['Type', message.type],
            ['Outcome', message.outcome],
          ]),
          h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', 'aria-label': 'Close', onclick: () => factsPanel.close() }, 'Close')));
      },
    });
  } }, 'Show facts');
  view.evidence.append(facts);
  view.work.append(h('div', { class: 'narrow-only' }, showFacts));
}

function factPairs(pairs: [string, string][]): HTMLElement {
  const dl = h('dl', { class: 'facts-list' });
  for (const [k, v] of pairs) dl.append(h('dt', {}, k), h('dd', {}, v));
  return dl;
}

export function triggerDownload(filename: string, bytes: Uint8Array, contentType: string): void {
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
