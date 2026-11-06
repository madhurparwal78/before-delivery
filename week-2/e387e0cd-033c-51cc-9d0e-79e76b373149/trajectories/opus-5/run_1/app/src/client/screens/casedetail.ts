import {
  CASE_STATUS_TEXT,
  ERROR_COPY,
  noResponseCopy,
  PENDING_COPY,
  requestPageSentCopy,
  STATE_COPY,
  SUCCESS_COPY,
} from '../../shared/copy';
import { get, request, RequestFailed } from '../api';
import { carry, takeCarried } from '../carry';
import { button, definition, element, heading } from '../dom';
import {
  businessDateOf,
  showCountdown,
  showCrypto,
  showDate,
  showDateTime,
  showMaskedAddress,
  showMoney,
} from '../format';
import { Cleanup, navigate, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { Field, longTextField, problemsSummary, textField } from '../ui/fields';
import { staffFrame, StaffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';
import { HandshakeTrack, trackFactsFrom } from '../ui/track';
import { ArchivedCaseBody, CaseBody } from './cases';

type AnyCase = CaseBody | ArchivedCaseBody;

function archived(body: AnyCase): body is ArchivedCaseBody {
  return body.archived === true;
}

function retentionCopy(body: CaseBody, frame: StaffFrame): string {
  const erasure = body.erasure;
  if (erasure.status === 'erased' && erasure.erasedAt !== null) {
    return STATE_COPY.retentionErased(showDateTime(erasure.erasedAt, frame.workspace));
  }
  if (erasure.status === 'pending') return STATE_COPY.retentionPending;
  if (erasure.status === 'scheduled' && erasure.dueAt !== null) {
    return STATE_COPY.retentionScheduled(showDateTime(erasure.dueAt, frame.workspace));
  }
  return 'Personal data is kept while the case is open.';
}

function requestPageCopy(body: CaseBody, frame: StaffFrame): string {
  if (body.requestPage === null) return 'No data request page.';
  if (body.requestPage.status === 'live') {
    return STATE_COPY.caseRequestPageLive(showDateTime(body.requestPage.endsAt, frame.workspace));
  }
  if (body.requestPage.status === 'answered') return STATE_COPY.requestPageAnswered;
  return STATE_COPY.caseRequestPageEnded(showDateTime(body.requestPage.endsAt, frame.workspace));
}

export async function caseDetailScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const caseId = context.params.caseId;
  const frame = await staffFrame(host, slug, 'cases');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);

  let body: AnyCase;
  try {
    body = (await get<{ case: AnyCase }>(`/api/w/${slug}/cases/${caseId}`)).case;
  } catch (error) {
    frame.work.append(heading(1, 'Page not found'), element('p', { text: STATE_COPY.unknownPage }));
    if (!(error instanceof RequestFailed)) throw error;
    return () => frame.destroy();
  }

  const title = heading(1, `Case ${body.reference}`);
  const trackHost = element('div', { className: 'track-host' });
  const countdown = element('p', {
    className: 'countdown mono',
    attributes: { role: 'timer', 'aria-label': 'Answer countdown' },
  });
  const statusLine = element('p', { className: 'case-status' });
  const actions = element('div', {
    className: 'case-actions',
    attributes: { role: 'region', 'aria-label': 'Case actions' },
  });
  const evidence = element('div', {
    className: 'evidence panel',
    attributes: { role: 'region', 'aria-label': 'Evidence' },
  });
  frame.work.append(title, trackHost, countdown, statusLine, note.node, actions);
  frame.evidence.append(evidence);

  let track: HandshakeTrack | null = null;
  let announcedNoResponse = false;

  const dialogs = {
    returnWithdrawal: null as Dialog | null,
    ownership: null as Dialog | null,
    reason: null as Dialog | null,
  };

  const actOn = async (
    path: string,
    method: string,
    payload: unknown,
    pending: string,
    success: string,
  ): Promise<boolean> => {
    note.say(pending, 'pending');
    try {
      const answer = await request<{ case: AnyCase }>(method, path, payload);
      note.say(success);
      body = answer.case;
      paint();
      return true;
    } catch (error) {
      if (error instanceof RequestFailed) {
        note.say(error.failure.message, 'refused');
        return false;
      }
      note.say(ERROR_COPY.not_found, 'refused');
      return false;
    }
  };

  const buildReasonDialog = (
    name: string,
    label: string,
    submitLabel: string,
    send: (reason: string, controller: { close(): void }, field: Field, problems: ReturnType<typeof problemsSummary>) => Promise<void>,
  ): Dialog =>
    new Dialog(frame.layer, {
      name,
      build: (controller) => {
        const reason = longTextField(label, 'reason');
        const problems = problemsSummary();
        const submit = button(submitLabel, () => void send(reason.control.value, controller, reason, problems), {
          className: 'control primary',
        });
        const cancel = button('Cancel', () => controller.close());
        return {
          body: [
            element('h2', { text: name, className: 'dialog-title' }),
            problems.node,
            reason.node,
            dialogActions(submit, cancel),
          ],
          first: () => reason.control,
        };
      },
    });

  const paintActions = (current: CaseBody): void => {
    const focused = actions.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).textContent
      : null;
    actions.replaceChildren();
    const add = (
      label: string,
      enabled: boolean,
      onClick: () => void,
      className = 'control',
    ): void => {
      const control = button(label, onClick, { className });
      if (!enabled) control.setAttribute('disabled', 'disabled');
      actions.append(control);
    };
    const role = frame.member.role;
    const closed = current.status === 'released' || current.status === 'returned';
    if (role === 'operations_lead') {
      add('Release', current.releaseAllowed, () => {
        void actOn(
          `/api/w/${slug}/cases/${caseId}/release`,
          'POST',
          {},
          PENDING_COPY.release,
          SUCCESS_COPY.release,
        );
      }, 'control primary');
      const returnButton = button('Return withdrawal', () => {
        if (dialogs.returnWithdrawal === null) {
          dialogs.returnWithdrawal = buildReasonDialog(
            'Return withdrawal',
            'Reason',
            'Return withdrawal',
            async (reason, controller, field, problems) => {
              problems.clear();
              const done = await actOn(
                `/api/w/${slug}/cases/${caseId}/return`,
                'POST',
                { reason },
                PENDING_COPY.returnWithdrawal,
                SUCCESS_COPY.returnWithdrawal,
              );
              if (done) controller.close();
              else {
                problems.showOne(note.node.textContent ?? '');
                problems.focus();
                void field;
              }
            },
          );
          frame.dialogs.push(dialogs.returnWithdrawal);
        }
        dialogs.returnWithdrawal.open(returnButton);
      });
      if (closed) returnButton.setAttribute('disabled', 'disabled');
      actions.append(returnButton);
    }
    if (role === 'compliance_officer' || role === 'compliance_analyst') {
      const ownershipButton = button('Record ownership', () => {
        if (dialogs.ownership === null) {
          dialogs.ownership = new Dialog(frame.layer, {
            name: 'Record ownership',
            build: (controller) => {
              const confirmedOn = textField(
                'Confirmed on',
                'confirmedOn',
                businessDateOf(current.now, frame.workspace),
              );
              confirmedOn.control.classList.add('mono');
              const problems = problemsSummary();
              const submit = button('Record', () => {
                problems.clear();
                void actOn(
                  `/api/w/${slug}/cases/${caseId}/ownership`,
                  'POST',
                  { confirmedOn: confirmedOn.control.value },
                  PENDING_COPY.recordOwnership,
                  SUCCESS_COPY.recordOwnership,
                ).then((done) => {
                  if (done) controller.close();
                  else {
                    problems.showOne(note.node.textContent ?? '');
                    problems.focus();
                  }
                });
              }, { className: 'control primary' });
              const cancel = button('Cancel', () => controller.close());
              return {
                body: [
                  element('h2', { text: 'Record ownership', className: 'dialog-title' }),
                  problems.node,
                  confirmedOn.node,
                  dialogActions(submit, cancel),
                ],
                first: () => confirmedOn.control,
              };
            },
          });
          frame.dialogs.push(dialogs.ownership);
        }
        dialogs.ownership.open(ownershipButton);
      });
      if (current.status !== 'awaiting_ownership') {
        ownershipButton.setAttribute('disabled', 'disabled');
      }
      actions.append(ownershipButton);
      add('Send new request page', current.requestPage !== null && !closed && current.answer === null, () => {
        void actOn(
          `/api/w/${slug}/cases/${caseId}/request-page`,
          'POST',
          {},
          PENDING_COPY.sendRequestPage,
          requestPageSentCopy(current.requestPage?.contactEmail ?? ''),
        );
      });
      add('End request page', current.requestPage?.status === 'live', () => {
        void actOn(
          `/api/w/${slug}/cases/${caseId}/request-page`,
          'DELETE',
          undefined,
          PENDING_COPY.endRequestPage,
          SUCCESS_COPY.endRequestPage,
        );
      });
    }
    if (role === 'compliance_officer') {
      const reasonButton = button('Record reason', () => {
        if (dialogs.reason === null) {
          dialogs.reason = buildReasonDialog(
            'Record release reason',
            'Reason',
            'Save reason',
            async (reason, controller, field, problems) => {
              problems.clear();
              const done = await actOn(
                `/api/w/${slug}/cases/${caseId}/release-reason`,
                'POST',
                { reason },
                PENDING_COPY.recordReason,
                SUCCESS_COPY.recordReason,
              );
              if (done) controller.close();
              else {
                problems.showOne(note.node.textContent ?? '');
                problems.focus();
                void field;
              }
            },
          );
          frame.dialogs.push(dialogs.reason);
        }
        dialogs.reason.open(reasonButton);
      });
      if (current.status !== 'no_response') reasonButton.setAttribute('disabled', 'disabled');
      actions.append(reasonButton);
      add('Archive case', closed && !current.archived, () => {
        void request<{ case: ArchivedCaseBody }>('POST', `/api/w/${slug}/cases/${caseId}/archive`, {})
          .then(() => {
            carry(SUCCESS_COPY.archive);
            navigate(`/w/${slug}/cases/${caseId}`);
          })
          .catch((error: unknown) => {
            note.say(
              error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
              'refused',
            );
          });
      });
    }
    if (focused !== null) {
      const again = [...actions.querySelectorAll('button')].find(
        (control) => control.textContent === focused,
      );
      again?.focus();
    }
  };

  const paintArchived = (current: ArchivedCaseBody): void => {
    title.textContent = `Case ${current.reference}`;
    trackHost.replaceChildren();
    countdown.textContent = '';
    statusLine.textContent =
      current.archivedAt === null
        ? STATE_COPY.retentionArchived('')
        : STATE_COPY.retentionArchived(showDateTime(current.archivedAt, frame.workspace));
    evidence.replaceChildren(
      element('h2', { text: 'Evidence' }),
      definition('Reference', element('span', { text: current.reference, className: 'mono' })),
      definition(
        'Closed at',
        element('span', {
          text: current.closedAt === null ? '' : showDateTime(current.closedAt, frame.workspace),
          className: 'mono',
        }),
      ),
    );
    actions.replaceChildren();
    if (frame.member.role === 'compliance_officer') {
      actions.append(
        button('Bring back', () => {
          void request('POST', `/api/w/${slug}/cases/${caseId}/restore`, {})
            .then(() => {
              carry(SUCCESS_COPY.restore);
              navigate(`/w/${slug}/cases/${caseId}`);
            })
            .catch((error: unknown) => {
              note.say(
                error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
                'refused',
              );
            });
        }, { className: 'control primary' }),
      );
    }
  };

  const paint = (): void => {
    if (archived(body)) {
      paintArchived(body);
      return;
    }
    const current = body;
    title.textContent = `Case ${current.reference}`;
    const facts = trackFactsFrom(current.decidedUnder, current);
    if (track === null) {
      track = new HandshakeTrack(frame.layer, frame.workspace, current.track, facts);
      trackHost.replaceChildren(track.node);
    } else {
      track.update(current.track, facts);
    }
    statusLine.textContent = CASE_STATUS_TEXT[current.status] ?? current.status;
    countdown.textContent =
      current.status === 'awaiting_answer' && current.answerRemainingSeconds !== null
        ? STATE_COPY.answerCountdown(showCountdown(current.answerRemainingSeconds))
        : '';
    if (current.status === 'no_response' && !announcedNoResponse) {
      announcedNoResponse = true;
      if (current.answerDueAt !== null) {
        note.say(noResponseCopy(showDateTime(current.answerDueAt, frame.workspace)), 'refused');
      }
    }
    evidence.replaceChildren(
      element('h2', { text: 'Evidence' }),
      definition(
        'Counterparty',
        current.counterparty === null
          ? 'Self-hosted wallet'
          : element('a', {
              text: current.counterparty.name,
              className: 'control link',
              attributes: { href: `/w/${slug}/counterparties/${current.counterparty.id}` },
            }),
      ),
      definition('Name as sent', current.dataSent?.counterpartyNameAsSent ?? current.decidedUnder.counterpartyName ?? 'Self-hosted wallet'),
      definition(
        'Rule',
        element('span', {
          className: 'mono',
          text:
            current.decidedUnder.ruleInForceSince === null
              ? 'No rule in force'
              : `${showMoney(current.decidedUnder.thresholdCurrency, current.decidedUnder.thresholdCents)} from ${showDate(current.decidedUnder.ruleInForceSince)}`,
        }),
      ),
      definition(
        'Rate',
        element('span', {
          className: 'mono',
          text: `${showMoney(current.decidedUnder.thresholdCurrency, current.decidedUnder.rateCents)} per ${current.asset}`,
        }),
      ),
      definition(
        'Fiat value',
        element('span', {
          className: 'mono',
          text: showMoney(current.currency, current.fiatValueCents),
        }),
      ),
      definition(
        'Threshold',
        element('span', {
          className: 'mono',
          text: showMoney(current.decidedUnder.thresholdCurrency, current.decidedUnder.thresholdCents),
        }),
      ),
      definition('Originator', current.originator === null ? 'Erased' : current.originator.name),
      definition('Beneficiary name', current.beneficiaryName ?? 'Erased'),
      definition('Data request page', requestPageCopy(current, frame)),
      definition('Retention', retentionCopy(current, frame)),
      definition(
        'Destination address',
        element('span', {
          className: 'mono',
          text: showMaskedAddress(current.destinationAddress),
        }),
      ),
      definition(
        'Amount',
        element('span', {
          className: 'mono',
          text: showCrypto(current.asset, current.amount),
        }),
      ),
    );
    paintActions(current);
  };

  paint();

  const refresh = async (): Promise<void> => {
    const answer = await get<{ case: AnyCase }>(`/api/w/${slug}/cases/${caseId}`);
    body = answer.case;
    paint();
  };

  const timer = window.setInterval(() => {
    void refresh().catch(() => undefined);
  }, 5000);
  return () => {
    window.clearInterval(timer);
    track?.destroy();
    frame.destroy();
  };
}
