import { ApiCallError, getJson, sendFile, sendJson } from '../api.js';
import { el, openDialog } from '../dom.js';
import { onLive } from '../live.js';
import { emptyGlyph } from '../marks.js';
import { registerCleanup, type PageContext } from '../main.js';
import { currentSession, displayDate, displayDateTime, setPageStatus } from '../shell.js';
import { CONDITION_KINDS, CONDITION_LABELS } from '../../shared/labels.js';
import type { ConditionKind, RequestDetail, RequestSummary } from '../../shared/types.js';

export async function renderMyRequests(context: PageContext): Promise<void> {
  const { main, navigate } = context;
  const { requests } = await getJson<{ requests: RequestSummary[] }>('/api/requests');

  if (requests.length === 0) {
    main.appendChild(
      el('div', { class: 'cell field field-ember empty-state' }, emptyGlyph(), el('p', {}, 'You have no requests yet.')),
    );
    return;
  }

  main.appendChild(
    el(
      'div',
      { class: 'cell' },
      el(
        'table',
        { class: 'data-table' },
        el('caption', {}, 'My requests'),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, 'Request'),
            el('th', { scope: 'col' }, 'Asset'),
            el('th', { scope: 'col' }, 'Application'),
            el('th', { scope: 'col' }, 'State'),
            el('th', { scope: 'col' }, 'Due'),
          ),
        ),
        el(
          'tbody',
          {},
          ...requests.map((request) =>
            el(
              'tr',
              {},
              el(
                'th',
                { scope: 'row' },
                el(
                  'a',
                  {
                    href: `/requests/${request.id}`,
                    onclick: (event: Event) => {
                      event.preventDefault();
                      navigate(`/requests/${request.id}`);
                    },
                  },
                  request.id,
                ),
              ),
              el('td', {}, request.cardName),
              el('td', {}, request.applicationLabel),
              el('td', {}, request.stateLabel),
              el('td', {}, request.deadline ? displayDateTime(request.deadline) : ''),
            ),
          ),
        ),
      ),
    ),
  );
}

export async function renderRequest(context: PageContext): Promise<void> {
  const { main, navigate } = context;
  const id = context.params['id'] ?? '';
  let detail: RequestDetail;
  try {
    detail = await getJson<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`);
  } catch {
    const { notFoundPage } = await import('../main.js');
    notFoundPage(main);
    return;
  }

  const announce = el('p', {
    class: 'visually-hidden',
    role: 'alert',
    'aria-live': 'assertive',
    'aria-label': 'Request updates',
  });
  const body = el('div', { class: 'request-page' });
  main.append(announce, body);

  let firstPaint = true;
  const paint = (): void => {
    body.replaceChildren(...sections(detail, navigate, refresh));
    if (firstPaint) {
      body.querySelector<HTMLElement>('h1')?.focus();
      firstPaint = false;
    }
  };

  const refresh = async (next?: RequestDetail): Promise<void> => {
    const previous = detail.stateLabel;
    detail = next ?? (await getJson<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`));
    if (detail.stateLabel !== previous) announce.textContent = `${detail.id} is now ${detail.stateLabel}.`;
    paint();
  };

  paint();

  registerCleanup(
    onLive((event) => {
      if (
        (event.type === 'request.updated' && event.requestId === id) ||
        event.type === 'grant.updated' ||
        event.type === 'library.updated'
      ) {
        void refresh();
      }
    }),
  );
}

type Refresh = (next?: RequestDetail) => Promise<void>;

function sections(detail: RequestDetail, navigate: (path: string) => void, refresh: Refresh): HTMLElement[] {
  const session = currentSession();
  const isRequester = session.principal?.id === detail.requester.id;
  const parts: HTMLElement[] = [header(detail)];

  if (detail.stageReason) {
    parts.push(decisionArea(detail, refresh));
  }
  parts.push(details(detail, navigate));
  parts.push(grantSection(detail));
  parts.push(proofSection(detail, isRequester, refresh));

  if (isRequester) {
    const actions = el('div', { class: 'cell request-actions' });
    if (['draft', 'routed', 'under_review', 'changes_requested'].includes(detail.state)) {
      actions.appendChild(
        action('Withdraw request', async () => {
          const next = await sendJson<RequestDetail>('POST', `/api/requests/${detail.id}/withdraw`);
          setPageStatus(`${detail.id} withdrawn.`);
          await refresh(next);
        }),
      );
    }
    if (detail.state === 'changes_requested') {
      actions.appendChild(
        action('Resubmit request', async () => {
          const next = await sendJson<RequestDetail>('POST', `/api/requests/${detail.id}/resubmit`, {});
          setPageStatus(`${detail.id} resubmitted.`);
          await refresh(next);
        }),
      );
    }
    if (actions.childElementCount > 0) parts.push(actions);
  }

  return parts;
}

function action(label: string, run: () => Promise<void>): HTMLElement {
  const alert = el('p', { class: 'alert', role: 'alert' });
  const button = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        button.disabled = true;
        button.textContent = 'Saving';
        void run()
          .catch((error: unknown) => {
            alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
          })
          .finally(() => {
            button.disabled = false;
            button.textContent = label;
          });
      },
    },
    label,
  ) as HTMLButtonElement;
  return el('span', { class: 'action' }, button, alert);
}

function escalationLabel(detail: RequestDetail): string | null {
  if (detail.escalation === 'no_eligible_reviewer') return 'Escalated: no eligible reviewer';
  if (detail.escalation === 'deadline_missed') return 'Escalated: deadline missed';
  return null;
}

function header(detail: RequestDetail): HTMLElement {
  const label = escalationLabel(detail);
  return el(
    'div',
    { class: 'cell request-header' },
    el('h1', { tabindex: '-1' }, detail.id),
    el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Request state', class: 'state-label' }, detail.stateLabel),
    el('p', {}, `Held by ${detail.holder.displayName}`),
    detail.deadline ? el('p', {}, `Due ${displayDateTime(detail.deadline)}`) : null,
    label ? el('p', { class: 'escalation' }, label) : null,
  );
}

function details(detail: RequestDetail, navigate: (path: string) => void): HTMLElement {
  return el(
    'div',
    { class: 'cell request-details' },
    el('h2', {}, detail.cardName),
    el('p', {}, `${detail.applicationLabel} · ${detail.territories.join(', ')}`),
    el('p', {}, `Campaign ${displayDate(detail.campaignStartsOn)} to ${displayDate(detail.campaignEndsOn)}`),
    el('p', {}, `Requested by ${detail.requester.displayName}, ${detail.requester.organisationName}`),
    detail.note ? el('p', { class: 'note' }, detail.note) : null,
    el(
      'ul',
      { 'aria-label': 'Cited rules', class: 'cited-rules' },
      ...detail.citedRules.map((rule) =>
        el(
          'li',
          {},
          el(
            'a',
            {
              href: `/rules/${rule.identifier}`,
              onclick: (event: Event) => {
                event.preventDefault();
                navigate(`/rules/${rule.identifier}`);
              },
            },
            rule.identifier,
          ),
        ),
      ),
    ),
    el(
      'ol',
      { class: 'stage-list', 'aria-label': 'Stages' },
      ...detail.stages.map((stage) =>
        el(
          'li',
          {},
          `${stage.label}: ${stage.decisionLabel ?? 'Open'}${stage.assigneeName ? ` — ${stage.assigneeName}` : ''}${
            stage.comment ? ` — ${stage.comment}` : ''
          }`,
        ),
      ),
    ),
    detail.conditions.length > 0
      ? el(
          'ul',
          { class: 'condition-list', 'aria-label': 'Conditions' },
          ...detail.conditions.map((condition) => el('li', {}, condition.text)),
        )
      : null,
  );
}

function grantSection(detail: RequestDetail): HTMLElement {
  const grant = detail.grant;
  return el(
    'section',
    { class: 'cell grant-cell', 'aria-label': 'Grant' },
    el('h2', {}, 'Grant'),
    grant
      ? el(
          'div',
          {},
          el('p', {}, grant.id),
          el('p', {}, grant.statusLabel),
          el('p', {}, `Ends ${displayDate(grant.notAfter)}`),
          ...grant.conditions.map((condition) => el('p', { class: 'condition-text' }, condition.text)),
        )
      : el('p', {}, 'No grant yet.'),
  );
}

function proofSection(detail: RequestDetail, isRequester: boolean, refresh: Refresh): HTMLElement {
  const session = currentSession();
  const grant = detail.grant;
  const alert = el('p', { class: 'alert', role: 'alert' });
  const section = el('section', { class: 'cell proof-cell', 'aria-label': 'Proofs' }, el('h2', {}, 'Proofs'));

  for (const proof of detail.proofs) {
    section.appendChild(el('p', { class: 'proof-row' }, `${proof.fileName} — ${proof.statusLabel}`));
    if (proof.reason) section.appendChild(el('p', { class: 'proof-reason' }, proof.reason));
  }

  const canReview =
    session.principal !== null &&
    ['brand_reviewer', 'legal_reviewer', 'owner'].includes(session.principal.role) &&
    detail.proofs.some((proof) => proof.status === 'pending_review');

  if (canReview) {
    const pending = detail.proofs.find((proof) => proof.status === 'pending_review')!;
    const reason = el('input', { type: 'text', id: 'proof-reason', 'aria-label': 'Proof rejection reason' }) as HTMLInputElement;
    section.append(
      action('Accept proof', async () => {
        await sendJson('POST', `/api/proofs/${pending.id}/accept`);
        setPageStatus('Proof accepted.');
        await refresh();
      }),
      el('label', { for: 'proof-reason' }, 'Proof rejection reason'),
      reason,
      action('Reject proof', async () => {
        await sendJson('POST', `/api/proofs/${pending.id}/reject`, { reason: reason.value });
        setPageStatus('Proof rejected.');
        await refresh();
      }),
    );
  }

  if (isRequester && grant && grant.status === 'pending_proof') {
    const file = el('input', { type: 'file', id: 'proof-file', 'aria-label': 'Proof file' }) as HTMLInputElement;
    const upload = el(
      'button',
      {
        type: 'button',
        class: 'pill',
        onclick: () => {
          const chosen = file.files?.[0];
          if (!chosen) return;
          alert.textContent = '';
          upload.disabled = true;
          upload.textContent = 'Uploading';
          void sendFile(`/api/grants/${grant.id}/proofs`, chosen)
            .then(async () => {
              setPageStatus('Proof uploaded. Waiting for review.');
              await refresh();
            })
            .catch((error: unknown) => {
              alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
            })
            .finally(() => {
              upload.disabled = false;
              upload.textContent = 'Upload proof';
            });
        },
      },
      'Upload proof',
    ) as HTMLButtonElement;
    section.append(el('label', { for: 'proof-file' }, 'Proof file'), file, upload);
  }

  section.appendChild(alert);
  return section;
}

function decisionArea(detail: RequestDetail, refresh: Refresh): HTMLElement {
  if (window.innerWidth >= 768) {
    return el('section', { class: 'cell decision-cell', 'aria-label': 'Decision' }, ...decisionControls(detail, refresh, null));
  }
  const open = el(
    'button',
    {
      type: 'button',
      class: 'pill decide-button',
      onclick: () => {
        const dialog = el('dialog', { class: 'sheet bottom-sheet', 'aria-label': `Decide ${detail.id}` }) as HTMLDialogElement;
        dialog.append(...decisionControls(detail, refresh, () => dialog.close()));
        dialog.appendChild(
          el('button', { type: 'button', class: 'pill ghost', onclick: () => dialog.close() }, 'Cancel'),
        );
        openDialog(dialog, open);
      },
    },
    'Decide',
  ) as HTMLButtonElement;
  return el('div', { class: 'decide-bar' }, open);
}

function decisionControls(detail: RequestDetail, refresh: Refresh, close: (() => void) | null): HTMLElement[] {
  const preview = detail.grantPreview;
  const comment = el('textarea', { id: 'decision-comment', 'aria-label': 'Comment', rows: '2' }) as HTMLTextAreaElement;
  const alert = el('p', { class: 'alert', role: 'alert' });

  const decide = (label: string, decision: 'approve' | 'reject' | 'request_changes'): HTMLButtonElement => {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'pill',
        onclick: () => {
          alert.textContent = '';
          button.disabled = true;
          button.textContent = 'Saving';
          const stage = detail.stages.find((candidate) => candidate.decision === null);
          void sendJson<RequestDetail>('POST', `/api/requests/${detail.id}/stages/${stage?.n ?? 1}/decision`, {
            decision,
            comment: comment.value.trim() === '' ? null : comment.value,
          })
            .then(async (next) => {
              setPageStatus('Decision saved.');
              close?.();
              await refresh(next);
            })
            .catch((error: unknown) => {
              alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
            })
            .finally(() => {
              button.disabled = false;
              button.textContent = label;
            });
        },
      },
      label,
    ) as HTMLButtonElement;
    return button;
  };

  const kind = el(
    'select',
    { id: 'condition-kind', 'aria-label': 'Condition' },
    ...CONDITION_KINDS.map((key) => el('option', { value: key }, CONDITION_LABELS[key])),
  ) as HTMLSelectElement;
  const value = el('input', { type: 'text', id: 'condition-value', 'aria-label': 'Condition value' }) as HTMLInputElement;

  const add = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        alert.textContent = '';
        add.disabled = true;
        add.textContent = 'Saving';
        void sendJson('POST', `/api/requests/${detail.id}/conditions`, {
          kind: kind.value as ConditionKind,
          value: value.value,
        })
          .then(async () => {
            setPageStatus('Condition added.');
            await refresh();
          })
          .catch((error: unknown) => {
            alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
          })
          .finally(() => {
            add.disabled = false;
            add.textContent = 'Add condition';
          });
      },
    },
    'Add condition',
  ) as HTMLButtonElement;

  return [
    el('p', { class: 'stage-reason' }, detail.stageReason ?? ''),
    el(
      'p',
      { class: 'grant-preview' },
      preview
        ? preview.zeroLength
          ? `This grant would end on ${displayDate(preview.notAfter)}, before it starts. Approving records the decision but grants nothing.`
          : `Grant will end on ${displayDate(preview.notAfter)} (${preview.cap})`
        : '',
    ),
    el('label', { for: 'decision-comment' }, 'Comment'),
    comment,
    decide('Approve', 'approve'),
    decide('Reject', 'reject'),
    decide('Request changes', 'request_changes'),
    el('label', { for: 'condition-kind' }, 'Condition'),
    kind,
    el('label', { for: 'condition-value' }, 'Condition value'),
    value,
    add,
    alert,
  ];
}
