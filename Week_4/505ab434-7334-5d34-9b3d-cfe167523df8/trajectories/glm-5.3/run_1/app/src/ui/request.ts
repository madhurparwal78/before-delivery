import { api, el, loadMe, setAlert, setStatus, busyButton, type Me, type RequestDetail } from './types';
import { openSheet, isPhone } from './dialog';
import { formatDay } from './types';

export const CONDITION_KINDS: Record<string, string> = {
  clear_space: 'Clear space',
  no_recolour: 'No recolour',
  attribution: 'Attribution',
  proof_required: 'Proof required',
  territory: 'Territory',
  expiry_override: 'Expiry override',
};

let me: Me | null = null;

export async function initRequest(): Promise<void> {
  me = await loadMe();
  const root = document.getElementById('request-root');
  if (!root) return;
  const match = /\/requests\/([^/]+)$/.exec(window.location.pathname);
  if (!match) return;
  const id = decodeURIComponent(match[1]);

  const live = el('p', { id: 'request-updates', role: 'alert', 'aria-live': 'assertive', class: 'sr-only' });
  document.body.append(live);

  const state = { detail: null as RequestDetail | null, lastState: '' };

  const load = async (): Promise<void> => {
    const detail = await api<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`);
    state.detail = detail;
    render(root, detail);
    if (state.lastState && state.lastState !== detail.state) {
      live.textContent = `${detail.id} is now ${detail.stateLabel}.`;
    }
    state.lastState = detail.state;
  };

  window.addEventListener('rulehouse:request-updated', (event) => {
    const payload = (event as CustomEvent<{ requestId?: string }>).detail ?? {};
    if (!payload.requestId || payload.requestId === id) void load();
  });
  window.addEventListener('rulehouse:library-updated', () => void load());

  await load();
}

function render(root: HTMLElement, detail: RequestDetail): void {
  const grid = el('div', { class: 'request-grid' });
  const main = el('section', { class: 'request-main' });

  main.append(
    el('h1', { id: 'request-heading' }, detail.id),
    el('p', { id: 'request-state', role: 'status' }, detail.stateLabel),
    el('p', {}, `Held by ${detail.holder.displayName}`),
  );
  if (detail.deadline) {
    main.append(el('p', {}, `Due ${formatDateTime(detail.deadline)}`));
  }
  if (detail.escalation === 'no_eligible_reviewer') {
    main.append(el('p', {}, 'Escalated: no eligible reviewer'));
  } else if (detail.escalation === 'deadline_missed') {
    main.append(el('p', {}, 'Escalated: deadline missed'));
  }

  const details = el('div', { class: 'cell' });
  details.append(el('h2', {}, 'Details'));
  const list = el('dl');
  const add = (term: string, value: string): void => {
    list.append(el('dt', {}, term), el('dd', {}, value));
  };
  add('Asset', detail.cardName);
  add('Application', detail.applicationLabel);
  add('Territories', detail.territories.join(', '));
  add('Campaign start', formatDay(detail.campaignStartsOn, ''));
  add('Campaign end', formatDay(detail.campaignEndsOn, ''));
  add('Requester', `${detail.requester.displayName} (${detail.requester.organisationName})`);
  if (detail.submittedAt) add('Submitted', formatDateTime(detail.submittedAt));
  if (detail.note) add('Note', detail.note);
  details.append(list);
  main.append(details);

  const cited = el('div', { class: 'cell' });
  cited.append(el('h2', {}, 'Cited rules'));
  const citedList = el('ul');
  for (const rule of detail.citedRules) {
    citedList.append(el('li', {}, el('a', { href: `/rules/${encodeURIComponent(rule.identifier)}` }, rule.identifier)));
  }
  cited.append(citedList);
  main.append(cited);

  const stagesCell = el('div', { class: 'cell' });
  stagesCell.append(el('h2', {}, 'Stages'));
  const stageList = el('ol');
  for (const stage of detail.stages) {
    const line = el('li', {}, `Stage ${stage.n}: ${stage.label}`);
    if (stage.assigneeName) line.append(` — ${stage.assigneeName}`);
    if (stage.decision) line.append(` — ${stage.decisionLabel}`);
    if (stage.comment) line.append(` — ${stage.comment}`);
    stageList.append(line);
  }
  stagesCell.append(stageList);
  main.append(stagesCell);

  const conditionsCell = el('div', { class: 'cell' });
  conditionsCell.append(el('h2', {}, 'Conditions'));
  if (detail.conditions.length === 0) {
    conditionsCell.append(el('p', {}, 'No conditions.'));
  } else {
    const conditionList = el('ul');
    for (const condition of detail.conditions) {
      conditionList.append(el('li', {}, condition.text));
    }
    conditionsCell.append(conditionList);
  }
  main.append(conditionsCell);

  if (detail.grant) {
    const grantCell = el('div', { class: 'cell', role: 'region', 'aria-label': 'Grant' });
    grantCell.append(
      el('h2', {}, 'Grant'),
      el('p', {}, `${detail.grant.id} · ${detail.grant.statusLabel}`),
      el('p', {}, `Ends ${formatDay(detail.grant.notAfter, '')}`),
    );
    for (const condition of detail.grant.conditions) {
      grantCell.append(el('p', {}, condition.text));
    }
    main.append(grantCell);
  }

  if (detail.proofs.length > 0 || detail.grant?.status === 'pending_proof') {
    const proofsCell = el('div', { class: 'cell', role: 'region', 'aria-label': 'Proofs' });
    proofsCell.append(el('h2', {}, 'Proofs'));
    for (const proof of detail.proofs) {
      const row = el('p', {}, `${proof.fileName} — ${proof.statusLabel}`);
      if (proof.reason) row.append(` — ${proof.reason}`);
      proofsCell.append(row);
    }
    if (detail.grant?.status === 'pending_proof' && me?.principal.id === detail.requester.id) {
      const fileInput = el('input', { type: 'file', id: 'proof-file', 'aria-label': 'Proof file' });
      const upload = el('button', { type: 'button' }, 'Upload proof');
      const slot = el('div', { class: 'alert-slot' });
      upload.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const restore = busyButton(upload, 'Uploading');
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch(`/api/grants/${detail.grant!.id}/proofs`, { method: 'POST', body: form });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data?.message ?? 'Something went wrong.');
          }
          setStatus('Proof uploaded. Waiting for review.');
          window.dispatchEvent(new CustomEvent('rulehouse:refresh-request'));
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
        } finally {
          restore();
        }
      });
      proofsCell.append(
        el('label', { class: 'field', for: 'proof-file' }, el('span', {}, 'Proof file'), fileInput),
        upload,
        slot,
      );
    }
    main.append(proofsCell);
  }

  if (me?.principal.id === detail.requester.id) {
    if (['draft', 'routed', 'under_review', 'changes_requested'].includes(detail.state)) {
      const withdraw = el('button', { type: 'button' }, 'Withdraw request');
      withdraw.addEventListener('click', async () => {
        const restore = busyButton(withdraw, 'Saving');
        try {
          await api(`/api/requests/${detail.id}/withdraw`, { method: 'POST', body: '{}' });
          setStatus(`${detail.id} withdrawn.`);
          window.dispatchEvent(new CustomEvent('rulehouse:refresh-request'));
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', null);
        } finally {
          restore();
        }
      });
      main.append(withdraw);
    }
    if (detail.state === 'changes_requested') {
      const resubmit = el('button', { type: 'button' }, 'Resubmit request');
      resubmit.addEventListener('click', async () => {
        const restore = busyButton(resubmit, 'Saving');
        try {
          await api(`/api/requests/${detail.id}/resubmit`, { method: 'POST', body: '{}' });
          setStatus(`${detail.id} resubmitted.`);
          window.dispatchEvent(new CustomEvent('rulehouse:refresh-request'));
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', null);
        } finally {
          restore();
        }
      });
      main.append(resubmit);
    }
  }

  grid.append(main);

  const open = detail.stages.find((stage) => stage.decision === null);
  const canDecide =
    me && open && (me.principal.role === 'owner' || me.principal.id === open.assigneeName);
  const decide = (): HTMLElement => buildDecisionPanel(detail, open);
  if (open && canDecide) {
    if (isPhone()) {
      const button = el('button', { type: 'button', class: 'decide-button' }, 'Decide');
      button.addEventListener('click', () => {
        openSheet({
          label: `Decide ${detail.id}`,
          build: (body) => {
            body.append(decide());
          },
          opener: button,
          onClosed: () => undefined,
        });
      });
      grid.append(el('section', { class: 'decision-panel mobile-panel', 'aria-label': 'Decision' }));
      document.body.append(button);
    } else {
      grid.append(el('section', { class: 'decision-panel desktop-panel', role: 'region', 'aria-label': 'Decision' }, decide()));
    }
  }

  root.replaceChildren(grid);
}

function buildDecisionPanel(detail: RequestDetail, open: { n: number } | undefined): HTMLElement {
  const panel = el('div', { class: 'decision-body' });
  const slot = el('div', { class: 'alert-slot' });
  if (detail.stageReason) panel.append(el('p', {}, detail.stageReason));
  if (detail.grantPreview) {
    if (detail.grantPreview.zeroLength) {
      panel.append(
        el('p', {}, `This grant would end on ${formatDay(detail.grantPreview.notAfter, '')}, before it starts. Approving records the decision but grants nothing.`),
      );
    } else {
      panel.append(
        el('p', {}, `Grant will end on ${formatDay(detail.grantPreview.notAfter, '')} (${detail.grantPreview.cap})`),
      );
    }
  }
  const comment = el('textarea', { id: 'decision-comment', rows: '3', 'aria-label': 'Comment' });
  const kind = el('select', { id: 'condition-kind' });
  for (const [value, label] of Object.entries(CONDITION_KINDS)) {
    kind.append(el('option', { value }, label));
  }
  const value = el('input', { type: 'text', id: 'condition-value', 'aria-label': 'Condition value' });
  const addCondition = el('button', { type: 'button' }, 'Add condition');
  addCondition.addEventListener('click', async () => {
    const restore = busyButton(addCondition, 'Saving');
    try {
      await api(`/api/requests/${detail.id}/conditions`, {
        method: 'POST',
        body: JSON.stringify({ kind: kind.value, value: value.value || null }),
      });
      setStatus('Condition added.');
      value.value = '';
      window.dispatchEvent(new CustomEvent('rulehouse:refresh-request'));
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  const decide = (decision: string) => {
    return async (event: Event): Promise<void> => {
      const button = event.currentTarget as HTMLButtonElement;
      const restore = busyButton(button, 'Saving');
      try {
        await api(`/api/requests/${detail.id}/stages/${open?.n ?? 1}/decision`, {
          method: 'POST',
          body: JSON.stringify({ decision, comment: comment.value || null }),
        });
        setStatus('Decision saved.');
        window.dispatchEvent(new CustomEvent('rulehouse:refresh-request'));
      } catch (err) {
        setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
      } finally {
        restore();
      }
    };
  };

  const approve = el('button', { type: 'button', class: 'primary' }, 'Approve');
  approve.addEventListener('click', (event) => void decide('approve')(event));
  const reject = el('button', { type: 'button' }, 'Reject');
  reject.addEventListener('click', (event) => void decide('reject')(event));
  const requestChanges = el('button', { type: 'button' }, 'Request changes');
  requestChanges.addEventListener('click', (event) => void decide('request_changes')(event));

  panel.append(
    el('label', { class: 'field' }, el('span', {}, 'Comment'), comment),
    approve,
    reject,
    requestChanges,
    el('label', { class: 'field' }, el('span', {}, 'Condition'), kind),
    el('label', { class: 'field' }, el('span', {}, 'Condition value'), value),
    addCondition,
    slot,
  );
  return panel;
}

window.addEventListener('rulehouse:refresh-request', () => {
  void initRequest();
});

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: me?.timeZone ?? 'Europe/Berlin',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return `${get('day')} ${months[Number(get('month')) - 1]} ${get('year')} ${get('hour')}:${get('minute')}`;
}
