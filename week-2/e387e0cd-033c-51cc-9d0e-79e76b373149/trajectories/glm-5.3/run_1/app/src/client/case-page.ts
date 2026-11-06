// The case page: Handshake track, evidence, guarded actions and the countdown,
// all from the server's record.
import { h, inputText } from './dom.js';
import { api } from './api.js';
import { openDialog, type PanelHandle } from './panels.js';
import { problemsRegion, fieldErrorsClear } from './feedback.js';
import { staffView, h1 } from './staff-frame.js';
import { startPolling, getSession, registerDialogOpener } from './state.js';
import { createTrack, type TrackHandle } from './track.js';
import { formatStamp, stampFormatter, formatFiat, formatCountdown } from './format.js';
import { fieldWrap, statusText, handleAuth } from './screens-cases.js';

interface TrackStation { station: string; label: string; state: string; text: string; at: string | null }
interface CaseBody {
  id: string; reference: string; createdAt: string; asset: string; amount: string; wallet: string;
  fiatValueCents: number; currency: string; path: string; status: string; releaseAllowed: boolean;
  answerDueAt: string | null; answerRemainingSeconds: number; outcome: string | null; closedAt: string | null;
  archived: boolean; originator: { name: string; identityNumber: string; dateOfBirth?: string } | null;
  beneficiaryName: string | null; counterparty: { id: string; name: string; lei: string; jurisdictionCode: string; network: string } | null;
  decidedUnder: { thresholdCents: number | null; thresholdCurrency: string | null; ruleInForceSince: string | null; rateCents: number; confirmationLimitCents: number; counterpartyName: string | null; counterpartyRule: string | null };
  dataSent: { channel: string; at: string; counterpartyNameAsSent: string } | null;
  answer: { decision: string; at: string; late: boolean; via: string } | null;
  requestPage: { status: string; sentAt: string; endsAt: string; remainingSeconds: number; contactEmail: string } | null;
  releaseReason: { text: string; recordedBy: string; recordedAt: string } | null;
  erasure: { status: string; dueAt: string | null; erasedAt: string | null };
  track: TrackStation[];
}

export async function renderCasePage(root: HTMLElement, slug: string, caseId: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const work = view.work;
  const role = getSession()?.member.role ?? 'compliance_analyst';
  const stamp = stampFormatter(ws.timeZone, ws.city);

  const trackWrap = h('div', { class: 'track-wrap' });
  let track: TrackHandle | null = null;
  const evidence = h('div', { role: 'region', 'aria-label': 'Evidence', class: 'evidence' });
  const actions = h('div', { role: 'region', 'aria-label': 'Case actions', class: 'case-actions' });
  const countdown = h('div', { role: 'timer', 'aria-label': 'Answer countdown', class: 'countdown mono' });
  const statusLine = h('p', { class: 'status-text' });

  view.work.append(
    h('div', { class: 'screen-head' }, h1(`Case ${''}`)),
    statusLine, countdown, trackWrap,
  );
  view.evidence.append(evidence);
  view.work.append(actions);

  let announcedNoResponse = false;
  let current: CaseBody | null = null;

  async function load(): Promise<void> {
    const res = await api<{ case: CaseBody }>('GET', `/api/w/${slug}/cases/${caseId}`);
    if (!res.ok) {
      if (res.status === 401) handleAuth(res.error?.code ?? '', desk, 'none', {});
      else if (res.error !== null) statusLine.textContent = res.error.message;
      return;
    }
    const body = res.body?.case;
    if (body === undefined) return;
    current = body;
    render(body);
    desk.repaint();
  }

  function render(body: CaseBody): void {
    const heading = work.querySelector('h1');
    if (heading !== null) heading.textContent = `Case ${body.reference}`;
    statusLine.textContent = statusText(body.status);
    if (body.status === 'no_response') {
      const ended = `No response. The answer period ended at ${formatStamp(body.answerDueAt ?? body.createdAt, ws.timeZone, ws.city)}.`;
      statusLine.textContent = ended;
      if (!announcedNoResponse) {
        announcedNoResponse = true;
        desk.announce(ended, 'error');
      }
    }

    // countdown from the server's remaining seconds
    if (body.status === 'awaiting_answer' && body.answerDueAt !== null) {
      countdown.textContent = `Answer due in ${formatCountdown(body.answerRemainingSeconds)}`;
      countdown.setAttribute('datetime', body.answerDueAt);
    } else {
      countdown.textContent = '';
    }

    const facts = {
      nameAsSent: body.dataSent?.counterpartyNameAsSent ?? (body.wallet === 'self_hosted' ? 'Self-hosted wallet' : null),
      rule: body.decidedUnder.thresholdCents !== null && body.decidedUnder.thresholdCurrency !== null
        ? `${formatFiat(body.decidedUnder.thresholdCurrency, body.decidedUnder.thresholdCents)} since ${body.decidedUnder.ruleInForceSince ?? '—'}`
        : 'No rule in force',
      rate: formatFiat(body.currency, body.decidedUnder.rateCents),
      fiatValue: formatFiat(body.currency, body.fiatValueCents),
      answer: body.answer !== null ? `${body.answer.decision === 'accepted' ? 'Accepted' : 'Rejected'}${body.answer.late ? ' (late)' : ''} at ${stamp(body.answer.at)}` : null,
    };
    if (track === null) {
      track = createTrack(body.track, facts, stamp);
      trackWrap.append(track.el);
    } else {
      track.update(body.track, facts);
    }

    evidence.replaceChildren(
      h('h2', {}, 'Evidence'),
      factList([
        ['Counterparty', body.counterparty !== null
          ? { link: true, text: body.counterparty.name, href: `/w/${slug}/counterparties/${body.counterparty.id}` }
          : { link: false, text: 'Self-hosted wallet' }],
        ['Name as sent', body.dataSent?.counterpartyNameAsSent ?? body.decidedUnder.counterpartyName ?? '—'],
        ['Rule', facts.rule],
        ['Rate', facts.rate],
        ['Fiat value', facts.fiatValue],
        ['Threshold', body.decidedUnder.thresholdCents !== null && body.decidedUnder.thresholdCurrency !== null ? formatFiat(body.decidedUnder.thresholdCurrency, body.decidedUnder.thresholdCents) : 'No rule in force'],
        ['Originator', body.originator !== null ? `${body.originator.name} (${body.originator.identityNumber})` : '—'],
        ['Beneficiary', body.beneficiaryName ?? '—'],
        ['Data request page', body.requestPage !== null
          ? (body.requestPage.status === 'live' ? `Request page live until ${formatStamp(body.requestPage.endsAt, ws.timeZone, ws.city)}.` : `Request page ended at ${formatStamp(body.requestPage.endsAt, ws.timeZone, ws.city)}.`)
          : '—'],
        ['Retention', retentionText(body, ws.timeZone, ws.city)],
      ]),
    );

    renderActions(body);
  }

  function renderActions(body: CaseBody): void {
    actions.replaceChildren();
    const officer = role === 'compliance_officer';
    const analyst = role === 'compliance_analyst';
    const operations = role === 'operations_lead';
    const open = body.outcome === null;

    if (operations && open) {
      actions.append(actionButton('Release', body.releaseAllowed, () => doAction('release', 'Releasing…', `POST`, `/api/w/${slug}/cases/${caseId}/release`, {}, 'Released. The withdrawal can leave.')));
      actions.append(actionButton('Return withdrawal', true, () => openReturnDialog(body)));
    }
    if ((officer || analyst) && body.status === 'awaiting_ownership') {
      actions.append(actionButton('Record ownership', true, () => openOwnershipDialog(body)));
    }
    if (officer && body.status === 'no_response' && body.releaseReason === null) {
      actions.append(actionButton('Record reason', true, () => openReasonDialog(body)));
    }
    if ((officer || analyst) && body.requestPage !== null) {
      if (body.requestPage.status === 'live') {
        actions.append(actionButton('Send new request page', true, () => doAction('new-request-page', 'Sending…', 'POST', `/api/w/${slug}/cases/${caseId}/request-page`, {}, 'New request page sent to', (c) => c.requestPage?.contactEmail ?? '')));
        actions.append(actionButton('End request page', true, () => doAction('end-request-page', 'Ending…', 'DELETE', `/api/w/${slug}/cases/${caseId}/request-page`, undefined, 'Request page ended.')));
      }
    }
    if (officer && body.outcome !== null && !body.archived) {
      actions.append(actionButton('Archive case', true, () => doAction('archive', 'Saving…', 'POST', `/api/w/${slug}/cases/${caseId}/archive`, {}, 'Case archived.')));
    }
    if (officer && body.archived) {
      actions.append(actionButton('Bring back', true, () => doAction('restore', 'Saving…', 'POST', `/api/w/${slug}/cases/${caseId}/restore`, {}, 'Case brought back.')));
    }
  }

  function actionButton(label: string, enabled: boolean, onclick: () => void): HTMLButtonElement {
    const btn = h('button', { type: 'button', class: 'btn', 'aria-label': label, onclick: () => {
      if (btn.disabled) return;
      onclick();
    } }, label) as HTMLButtonElement;
    btn.disabled = !enabled;
    return btn;
  }

  async function doAction(kind: string, pendingCopy: string, method: string, path: string, body: Record<string, unknown> | undefined, successPrefix?: string, successSuffixFn?: (c: CaseBody) => string): Promise<void> {
    desk.announce(pendingCopy);
    const res = await api<{ case: CaseBody }>(method, path, body);
    if (res.ok && res.body !== null) {
      current = res.body.case;
      if (successPrefix !== undefined && successSuffixFn !== undefined) {
        desk.announce(`${successPrefix} ${successSuffixFn(res.body.case)}.`);
      } else if (successPrefix !== undefined) {
        desk.announce(successPrefix);
      } else {
        desk.announce('Done.');
      }
      render(res.body.case);
    } else if (res.error !== null) {
      if (res.status === 401) {
        handleAuth(res.error.code, desk, kind, {});
        return;
      }
      desk.announce(res.error.message, 'error');
    }
  }

  function openReturnDialog(body: CaseBody, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Return withdrawal',
      kind: 'sheet',
      opener: actions.querySelector('button[aria-label="Return withdrawal"]') as HTMLElement,
      onClose: () => {},
      build: (dialog) => {
        const reason = inputText({ id: 'reason', 'aria-label': 'Reason', class: 'input', value: initial.reason ?? '' });
        dialog.append(h('h2', {}, 'Return withdrawal'), problemsRegion(), fieldWrap(reason, 'Reason'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Return withdrawal', onclick: async () => {
              desk.announce('Returning…');
              fieldErrorsClear(dialog);
              const res = await api<{ case: CaseBody }>('POST', `/api/w/${slug}/cases/${caseId}/return`, { reason: reason.value });
              if (res.ok && res.body !== null) {
                desk.announce('Returned to the customer\'s balance.');
                panel.close();
                render(res.body.case);
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'return', { reason: reason.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Return withdrawal'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
    void body;
  }

  function openOwnershipDialog(body: CaseBody, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Record ownership',
      kind: 'sheet',
      opener: actions.querySelector('button[aria-label="Record ownership"]') as HTMLElement,
      onClose: () => {},
      build: (dialog) => {
        const confirmedOn = inputText({ id: 'confirmedOn', 'aria-label': 'Confirmed on', class: 'input mono', value: initial.confirmedOn ?? ws.today });
        dialog.append(h('h2', {}, 'Record ownership'), problemsRegion(), fieldWrap(confirmedOn, 'Confirmed on'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Record', onclick: async () => {
              desk.announce('Saving…');
              fieldErrorsClear(dialog);
              const res = await api<{ case: CaseBody }>('POST', `/api/w/${slug}/cases/${caseId}/ownership`, { confirmedOn: confirmedOn.value });
              if (res.ok && res.body !== null) {
                desk.announce('Ownership confirmed.');
                panel.close();
                render(res.body.case);
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'ownership', { confirmedOn: confirmedOn.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Record'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
    void body;
  }

  function openReasonDialog(body: CaseBody, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Record release reason',
      kind: 'sheet',
      opener: actions.querySelector('button[aria-label="Record reason"]') as HTMLElement,
      onClose: () => {},
      build: (dialog) => {
        const reason = inputText({ id: 'reason', 'aria-label': 'Reason', class: 'input', value: initial.reason ?? '' });
        dialog.append(h('h2', {}, 'Record release reason'), problemsRegion(), fieldWrap(reason, 'Reason'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Save reason', onclick: async () => {
              desk.announce('Saving reason…');
              fieldErrorsClear(dialog);
              const res = await api<{ case: CaseBody }>('POST', `/api/w/${slug}/cases/${caseId}/release-reason`, { reason: reason.value });
              if (res.ok && res.body !== null) {
                desk.announce('Reason recorded. The operations lead can now release this withdrawal.');
                panel.close();
                render(res.body.case);
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'release-reason', { reason: reason.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Save reason'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
    void body;
  }

  registerDialogOpener('return', (values) => {
    if (current !== null) openReturnDialog(current, values);
  });
  registerDialogOpener('ownership', (values) => {
    if (current !== null) openOwnershipDialog(current, values);
  });
  registerDialogOpener('release-reason', (values) => {
    if (current !== null) openReasonDialog(current, values);
  });

  await load();
  startPolling(async () => {
    await load();
  });
}

function factList(rows: [string, { link: boolean; text: string; href?: string } | string][]): HTMLElement {
  const dl = h('dl', { class: 'facts-list' });
  for (const [name, value] of rows) {
    const dd = typeof value === 'string'
      ? h('dd', {}, value)
      : value.link && value.href !== undefined
        ? h('dd', {}, h('a', { href: value.href }, value.text))
        : h('dd', {}, value.text);
    dl.append(h('dt', {}, name), dd);
  }
  return dl;
}

function retentionText(body: CaseBody, timeZone: string, city: string): string {
  const erasure = body.erasure;
  if (erasure.status === 'not_due') return 'Personal data is kept while the case is open.';
  if (erasure.status === 'scheduled' && erasure.dueAt !== null) return `Personal data is kept until ${formatStamp(erasure.dueAt, timeZone, city)}.`;
  if (erasure.status === 'pending') return 'Erasing personal data. Waiting for storage to confirm.';
  if (erasure.status === 'erased' && erasure.erasedAt !== null) return `Personal data erased on ${formatStamp(erasure.erasedAt, timeZone, city)}.`;
  return body.archived ? 'Archived.' : '';
}
