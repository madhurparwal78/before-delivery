import {
  claimedCopy,
  claimLapsedCopy,
  decisionSavedCopy,
  ERROR_COPY,
  PENDING_COPY,
  STATE_COPY,
} from '../../shared/copy';
import { get, request, RequestFailed } from '../api';
import { button, dataTable, element, heading } from '../dom';
import { showCountdown, showDateTime, showMoney } from '../format';
import { Cleanup, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { longTextField, problemsSummary, radioGroup } from '../ui/fields';
import { staffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';

interface ReviewRow {
  id: string;
  reference: string;
  counterparty: { id: string; name: string } | null;
  fiatValueCents: number;
  currency: string;
  createdAt: string;
  claim: {
    memberId: string;
    memberName: string;
    claimedAt: string;
    endsAt: string;
    remainingSeconds: number;
  } | null;
}

export async function reviewScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'review');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const tableHost = element('div', { className: 'table-host' });
  const countdown = element('p', {
    className: 'countdown mono',
    attributes: { role: 'timer', 'aria-label': 'Claim countdown' },
  });
  const claimPanel = element('div', {
    className: 'panel claim-panel',
    children: [element('h2', { text: 'Your claim' }), countdown],
  });
  let rows: ReviewRow[] = [];
  let claimDialog: Dialog | null = null;
  let decideDialog: Dialog | null = null;
  let typedReason = '';
  const heldUntil = new Map<string, string>();

  const openClaim = (row: ReviewRow, opener: HTMLElement): void => {
    claimDialog?.destroy();
    claimDialog = new Dialog(frame.layer, {
      name: 'Claim case',
      build: (controller) => {
        const claim = button('Claim', () => {
          note.say(PENDING_COPY.claim, 'pending');
          void request<{ claim: ReviewRow['claim'] }>(
            'POST',
            `/api/w/${slug}/review/${row.id}/claim`,
            {},
          )
            .then((answer) => {
              if (answer.claim !== null) {
                note.say(claimedCopy(showDateTime(answer.claim.endsAt, frame.workspace)));
              }
              controller.close();
              void refresh();
            })
            .catch((error: unknown) => {
              note.say(
                error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
                'refused',
              );
              controller.close();
              void refresh();
            });
        }, { className: 'control primary' });
        const cancel = button('Cancel', () => controller.close());
        return {
          body: [
            element('h2', { text: 'Claim case', className: 'dialog-title' }),
            element('p', { text: `Case ${row.reference}` }),
            dialogActions(claim, cancel),
          ],
          first: () => claim,
        };
      },
    });
    frame.dialogs.push(claimDialog);
    claimDialog.open(opener);
  };

  const openDecide = (row: ReviewRow, opener: HTMLElement): void => {
    decideDialog?.destroy();
    decideDialog = new Dialog(frame.layer, {
      name: 'Decide case',
      build: (controller) => {
        const decision = radioGroup('Decision', 'decision', [
          { value: 'accept', label: 'Accept' },
          { value: 'reject', label: 'Reject' },
        ], 'reject');
        const reason = longTextField('Reason', 'reason', typedReason);
        reason.control.addEventListener('input', () => {
          typedReason = reason.control.value;
        });
        const problems = problemsSummary();
        const save = button('Save decision', () => {
          problems.clear();
          note.say(PENDING_COPY.saveDecision, 'pending');
          void request('POST', `/api/w/${slug}/review/${row.id}/decision`, {
            decision: decision.value(),
            reason: reason.control.value,
          })
            .then(() => {
              note.say(decisionSavedCopy(decision.value() === 'accept' ? 'accept' : 'reject'));
              typedReason = '';
              controller.close();
              void refresh();
            })
            .catch((error: unknown) => {
              if (!(error instanceof RequestFailed)) {
                note.say(ERROR_COPY.not_found, 'refused');
                return;
              }
              note.say(error.failure.message, 'refused');
              if (Object.keys(error.failure.fields).length > 0) {
                problems.show(error.failure.fields, [reason]);
              } else {
                problems.showOne(error.failure.message);
              }
              problems.focus();
              void refresh();
            });
        }, { className: 'control primary' });
        const cancel = button('Cancel', () => controller.close());
        return {
          body: [
            element('h2', { text: 'Decide case', className: 'dialog-title' }),
            problems.node,
            decision.node,
            reason.node,
            dialogActions(save, cancel),
          ],
          first: () => decision.firstControl,
        };
      },
    });
    frame.dialogs.push(decideDialog);
    decideDialog.open(opener);
  };

  const paint = (): void => {
    const focused = tableHost.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.rowKey ?? null
      : null;
    tableHost.replaceChildren(
      dataTable<ReviewRow>(
        'Cases in review',
        [
          { label: 'Reference', cell: (row) => element('span', { text: row.reference, className: 'mono' }) },
          { label: 'Counterparty', cell: (row) => row.counterparty?.name ?? '' },
          {
            label: 'Fiat value',
            cell: (row) =>
              element('span', { text: showMoney(row.currency, row.fiatValueCents), className: 'mono' }),
          },
          {
            label: 'Created',
            cell: (row) =>
              element('span', { text: showDateTime(row.createdAt, frame.workspace), className: 'mono' }),
          },
          {
            label: 'Claim',
            cell: (row) => {
              const mine = row.claim !== null && row.claim.memberId === frame.member.id;
              if (mine) {
                const decide = button('Decide', () => openDecide(row, decide), {
                  className: 'control primary',
                  attributes: { 'data-row-key': `decide-${row.id}` },
                });
                if (frame.member.role !== 'compliance_analyst') {
                  decide.setAttribute('disabled', 'disabled');
                }
                return decide;
              }
              const claim = button('Claim', () => openClaim(row, claim), {
                attributes: { 'data-row-key': `claim-${row.id}` },
              });
              if (frame.member.role !== 'compliance_analyst') {
                claim.setAttribute('disabled', 'disabled');
              }
              return element('span', {
                children: [
                  claim,
                  row.claim === null
                    ? null
                    : element('span', {
                        text: `${row.claim.memberName}, ${showDateTime(row.claim.claimedAt, frame.workspace)}`,
                        className: 'claim-holder mono',
                      }),
                ],
              });
            },
          },
        ],
        rows,
        STATE_COPY.emptyTable,
      ),
    );
    if (focused !== null) {
      tableHost.querySelector<HTMLElement>(`[data-row-key="${focused}"]`)?.focus();
    }
    const mine = rows.find((row) => row.claim !== null && row.claim.memberId === frame.member.id);
    countdown.textContent =
      mine === undefined || mine.claim === null
        ? ''
        : STATE_COPY.claimCountdown(showCountdown(mine.claim.remainingSeconds));
  };

  const refresh = async (): Promise<void> => {
    const body = await get<{ cases: ReviewRow[]; now: string }>(`/api/w/${slug}/review`);
    rows = body.cases;
    // A claim that has lapsed is reported by the server, never by the clock.
    for (const row of rows) {
      const mine = row.claim !== null && row.claim.memberId === frame.member.id;
      if (mine && row.claim !== null) {
        heldUntil.set(row.id, row.claim.endsAt);
        continue;
      }
      const was = heldUntil.get(row.id);
      if (was !== undefined) {
        heldUntil.delete(row.id);
        note.say(claimLapsedCopy(showDateTime(was, frame.workspace)), 'refused');
      }
    }
    paint();
  };

  frame.work.append(heading(1, 'Review queue'), note.node, tableHost);
  frame.evidence.append(claimPanel);
  await refresh();
  const timer = window.setInterval(() => {
    void refresh().catch(() => undefined);
  }, 5000);
  return () => {
    window.clearInterval(timer);
    claimDialog?.destroy();
    decideDialog?.destroy();
    frame.destroy();
  };
}
