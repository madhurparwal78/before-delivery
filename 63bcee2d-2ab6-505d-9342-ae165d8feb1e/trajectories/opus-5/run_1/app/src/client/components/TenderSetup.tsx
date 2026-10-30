/** Tender setup, publication, close moves and bid opening, by keyboard alone. */

import { useId, useState } from 'react';
import {
  SG_ZONE,
  TENDER_STATUS_LABELS,
  type TenderStatus,
  type TimeZoneName,
} from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { formatInstant } from '../../shared/format.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { clearDraft, readDraft } from '../lib/drafts.js';
import { useRouter } from '../lib/router.jsx';
import { useWorkspace } from '../lib/workspace.jsx';
import { ActionButton } from './Buttons.jsx';
import { Dialog, focusFirstDialogButton } from './Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from './Fields.jsx';
import { TableRegion } from './Panel.jsx';
import { focusWhenReady } from '../lib/focus.js';

export interface TenderBidder {
  reference: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  hasBid: boolean;
  finalSubmittedAt: string | null;
}

export interface StudioTender {
  id: string;
  title: string;
  scope: string;
  project: { id: string; reference: string; name: string };
  closesAt: string | null;
  closesAtLocal: string | null;
  timeZone: TimeZoneName;
  status: TenderStatus;
  contingencyPercent: string;
  icsSequence: number;
  bidders: TenderBidder[];
  awardedBidId: string | null;
}

interface BidderDraft {
  companyName: string;
  contactName: string;
  contactEmail: string;
}

interface SetupDraft {
  title: string;
  scope: string;
  closesAtLocal: string;
  contingencyPercent: string;
  bidders: BidderDraft[];
}

const EMPTY_BIDDER: BidderDraft = { companyName: '', contactName: '', contactEmail: '' };

function zoneWords(zone: TimeZoneName): string {
  return zone === SG_ZONE ? 'Singapore time' : 'Hong Kong time';
}

export function TenderSetup({
  projectId,
  projectTimeZone,
  tender,
  onCreated,
  onChanged,
  restoreForm,
}: {
  projectId: string;
  projectTimeZone: TimeZoneName;
  tender: StudioTender | null;
  onCreated: (tender: StudioTender) => void;
  onChanged: () => void;
  restoreForm: string | null;
}): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const { navigate } = useRouter();
  const errors = useFormErrors();
  const [draft, setDraft] = useState<SetupDraft>(() => {
    if (restoreForm === 'tender-setup' && member) {
      const stored = readDraft(member.id, 'tender-setup');
      if (stored) {
        clearDraft(member.id, 'tender-setup');
        return { ...blankDraft(tender), ...(stored as Partial<SetupDraft>) };
      }
    }
    return blankDraft(tender);
  });
  const [newClose, setNewClose] = useState('');
  const [dialog, setDialog] = useState<'publish' | 'move-close' | null>(null);
  const [busy, setBusy] = useState(false);

  const status = tender?.status ?? 'draft';
  const editable = status === 'draft';

  const focusStatus = (): void => {
    focusWhenReady('[data-tender-status]');
  };

  const showFieldErrors = (caught: ApiError): void => {
    errors.set(caught.errors);
    const first = Object.keys(caught.errors)[0];
    if (first) focusFieldError(formId, first);
    else focusFirstDialogButton();
  };

  const saveDraftTender = async (): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.saveTenderDraft);
    const body = {
      title: draft.title,
      scope: draft.scope,
      contingencyPercent: draft.contingencyPercent,
      ...(draft.closesAtLocal === '' ? {} : { closesAtLocal: draft.closesAtLocal }),
      bidders: draft.bidders,
    };
    try {
      if (tender) {
        await request(`/api/tenders/${tender.id}`, { method: 'PATCH', body });
      } else {
        const result = await request<{ tender: StudioTender }>(
          `/api/projects/${projectId}/tenders`,
          { body },
        );
        onCreated(result.tender);
      }
      refresh();
      onChanged();
      say(success.tenderDraftSaved);
      focusWhenReady('[data-focus="publish-tender"]');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') showFieldErrors(caught);
      else handleFailure(caught, { draft: { formKey: 'tender-setup', values: { ...draft } } });
    } finally {
      setBusy(false);
    }
  };

  const publish = async (): Promise<void> => {
    if (!tender) return;
    setBusy(true);
    startPending(pending.publishTender);
    try {
      const result = await request<{ invitationsSent: number }>(
        `/api/tenders/${tender.id}/publish`,
        { body: {} },
      );
      setDialog(null);
      refresh();
      onChanged();
      say(success.tenderPublished(result.invitationsSent));
      focusStatus();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        problem(caught.errors.closesAtLocal ?? fieldErrorCopy.closeNotAfterNow());
        focusFirstDialogButton();
      } else if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(refusal.otherIllegal(TENDER_STATUS_LABELS[status].toLowerCase()));
        focusFirstDialogButton();
      } else {
        handleFailure(caught);
        focusFirstDialogButton();
      }
    } finally {
      setBusy(false);
    }
  };

  const moveClose = async (): Promise<void> => {
    if (!tender) return;
    setBusy(true);
    errors.clear();
    startPending(pending.moveClose);
    try {
      const result = await request<{ tender: StudioTender; invitationsSent: number }>(
        `/api/tenders/${tender.id}`,
        { method: 'PATCH', body: { closesAtLocal: newClose } },
      );
      setDialog(null);
      refresh();
      onChanged();
      say(
        success.closeMoved(
          formatInstant(new Date(result.tender.closesAt ?? Date.now()), result.tender.timeZone),
          result.invitationsSent,
        ),
      );
      focusWhenReady('[data-focus="move-close"]');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') showFieldErrors(caught);
      else handleFailure(caught, { draft: { formKey: 'move-close', values: { newClose } } });
    } finally {
      setBusy(false);
    }
  };

  const openBids = async (): Promise<void> => {
    if (!tender) return;
    setBusy(true);
    startPending(pending.openBids);
    try {
      const result = await request<{ openedBids: number }>(
        `/api/tenders/${tender.id}/open-bids`,
        { body: {} },
      );
      refresh();
      onChanged();
      say(success.bidsOpened(result.openedBids));
      focusStatus();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'tender_still_open') {
        problem(
          refusal.bidsNotYetOpenable(
            formatInstant(
              new Date(caught.extra<string>('closesAt') ?? Date.now()),
              tender.timeZone,
            ),
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(refusal.otherIllegal(TENDER_STATUS_LABELS[status].toLowerCase()));
      } else {
        handleFailure(caught);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <h3 data-tender-status tabIndex={-1}>
          Tender status
        </h3>
        <p className="stage-state">{TENDER_STATUS_LABELS[status]}</p>
        {tender?.closesAt ? (
          <p className="meta">
            {`Closes ${formatInstant(new Date(tender.closesAt), tender.timeZone)}`}
          </p>
        ) : null}
      </div>

      <ErrorSummary formId={formId} errors={errors.errors} />

      {editable ? (
        <>
          <Field formId={formId} path="title" label="Tender title" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            )}
          </Field>
          <Field formId={formId} path="scope" label="Scope" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={5}
                value={draft.scope}
                onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
              />
            )}
          </Field>
          <Field
            formId={formId}
            path="closesAtLocal"
            label="Close date and time"
            errors={errors.errors}
            hint={`${zoneWords(projectTimeZone)}, written as YYYY-MM-DDTHH:mm:ss.`}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                placeholder="2026-11-20T17:00:00"
                value={draft.closesAtLocal}
                onChange={(event) => setDraft({ ...draft, closesAtLocal: event.target.value })}
              />
            )}
          </Field>
          <Field
            formId={formId}
            path="contingencyPercent"
            label="Contingency percent"
            errors={errors.errors}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                inputMode="decimal"
                value={draft.contingencyPercent}
                onChange={(event) =>
                  setDraft({ ...draft, contingencyPercent: event.target.value })
                }
              />
            )}
          </Field>

          {draft.bidders.map((bidder, index) => (
            <fieldset key={index}>
              <legend>{`Bidder ${index + 1}`}</legend>
              <Field
                formId={formId}
                path={`bidders[${index}].companyName`}
                label="Company name"
                errors={errors.errors}
              >
                {(attributes) => (
                  <input
                    {...attributes}
                    type="text"
                    value={bidder.companyName}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        bidders: draft.bidders.map((entry, at) =>
                          at === index ? { ...entry, companyName: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <Field
                formId={formId}
                path={`bidders[${index}].contactName`}
                label="Contact name"
                errors={errors.errors}
              >
                {(attributes) => (
                  <input
                    {...attributes}
                    type="text"
                    value={bidder.contactName}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        bidders: draft.bidders.map((entry, at) =>
                          at === index ? { ...entry, contactName: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <Field
                formId={formId}
                path={`bidders[${index}].contactEmail`}
                label="Contact email"
                errors={errors.errors}
              >
                {(attributes) => (
                  <input
                    {...attributes}
                    type="email"
                    value={bidder.contactEmail}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        bidders: draft.bidders.map((entry, at) =>
                          at === index ? { ...entry, contactEmail: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    bidders: draft.bidders.filter((_entry, at) => at !== index),
                  })
                }
              >
                {`Remove bidder ${index + 1}`}
              </button>
            </fieldset>
          ))}

          <div className="row-actions">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, bidders: [...draft.bidders, EMPTY_BIDDER] })}
            >
              Add bidder
            </button>
            <ActionButton
              busy={busy}
              pendingLabel={pending.saveTenderDraft}
              onPress={() => void saveDraftTender()}
            >
              Save draft
            </ActionButton>
            <button
              type="button"
              className="primary"
              data-focus="publish-tender"
              disabled={tender === null}
              onClick={() => setDialog('publish')}
            >
              Publish tender
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>{tender?.title}</h3>
          <p>{tender?.scope}</p>
          <p className="meta">{`Contingency ${tender?.contingencyPercent ?? '0'}%`}</p>
          <TableRegion label="Bidders table">
            <table>
              <caption>Bidders</caption>
              <thead>
                <tr>
                  <th scope="col">Bidder</th>
                  <th scope="col">Company</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Bid received</th>
                </tr>
              </thead>
              <tbody>
                {(tender?.bidders ?? []).map((bidder) => (
                  <tr key={bidder.reference}>
                    <th scope="row">{bidder.reference}</th>
                    <td>{bidder.companyName}</td>
                    <td>{`${bidder.contactName} · ${bidder.contactEmail}`}</td>
                    <td>
                      {bidder.hasBid && bidder.finalSubmittedAt
                        ? formatInstant(
                            new Date(bidder.finalSubmittedAt),
                            tender?.timeZone ?? projectTimeZone,
                          )
                        : 'Not yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>

          <div className="row-actions">
            {status === 'open' ? (
              <button
                type="button"
                data-focus="move-close"
                onClick={() => {
                  errors.clear();
                  setNewClose(tender?.closesAtLocal ?? '');
                  setDialog('move-close');
                }}
              >
                Move close
              </button>
            ) : null}
            {status === 'closed' || status === 'open' ? (
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.openBids}
                onPress={() => void openBids()}
              >
                Open bids
              </ActionButton>
            ) : null}
            {(status === 'opened' || status === 'awarded') && tender ? (
              <button
                type="button"
                onClick={() => navigate(`/office/tenders/${tender.id}/levelling`)}
              >
                Open levelling
              </button>
            ) : null}
          </div>
        </>
      )}

      {dialog === 'publish' ? (
        <Dialog
          title="Publish tender"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.publishTender}
                onPress={() => void publish()}
              >
                Publish and send invitations
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>
            Each bidder gets their own invitation with a single-use sign-in link and a calendar
            file for the close. No bidder sees any other bidder.
          </p>
        </Dialog>
      ) : null}

      {dialog === 'move-close' ? (
        <Dialog
          title="Move close"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.moveClose}
                onPress={() => void moveClose()}
              >
                Save new close
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field
            formId={formId}
            path="closesAtLocal"
            label="Close date and time"
            errors={errors.errors}
            hint={`${zoneWords(projectTimeZone)}, written as YYYY-MM-DDTHH:mm:ss.`}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={newClose}
                onChange={(event) => setNewClose(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </div>
  );
}

function blankDraft(tender: StudioTender | null): SetupDraft {
  return {
    title: tender?.title ?? '',
    scope: tender?.scope ?? '',
    closesAtLocal: tender?.closesAtLocal ?? '',
    contingencyPercent: tender?.contingencyPercent ?? '5.00',
    bidders:
      tender?.bidders.map((bidder) => ({
        companyName: bidder.companyName,
        contactName: bidder.contactName,
        contactEmail: bidder.contactEmail,
      })) ?? [EMPTY_BIDDER],
  };
}
