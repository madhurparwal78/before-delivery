/** The sealed bid form: one bid per company, amendable until the close instant. */

import { useId, useState } from 'react';
import { TENDER_STATUS_LABELS, type TenderStatus, type TimeZoneName } from '../../shared/domain.js';
import { centsToDecimal, formatInstant } from '../../shared/format.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { clearDraft, readDraft } from '../lib/drafts.js';
import { useWorkspace } from '../lib/workspace.jsx';
import { ActionButton } from './Buttons.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from './Fields.jsx';

export interface ContractorBid {
  id: string;
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  exclusions: { id: string; label: string }[];
  finalSubmittedAt: string;
  amendments: number;
}

export interface ContractorTender {
  id: string;
  title: string;
  scope: string;
  project: { id: string; reference: string; name: string };
  closesAt: string | null;
  closesAtLocal: string | null;
  timeZone: TimeZoneName;
  status: TenderStatus;
  myBid: ContractorBid | null;
}

interface BidDraft {
  base: string;
  provisionalSums: { label: string; amount: string }[];
  exclusions: { label: string }[];
}

function parseAmount(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function draftFrom(bid: ContractorBid | null): BidDraft {
  return {
    base: bid ? centsToDecimal(bid.baseCents) : '',
    provisionalSums:
      bid?.provisionalSums.map((entry) => ({
        label: entry.label,
        amount: centsToDecimal(entry.amountCents),
      })) ?? [],
    exclusions: bid?.exclusions.map((entry) => ({ label: entry.label })) ?? [],
  };
}

export function ContractorBidForm({
  tender,
  onChanged,
  restoreForm,
}: {
  tender: ContractorTender;
  onChanged: () => void;
  restoreForm: string | null;
}): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const [draft, setDraft] = useState<BidDraft>(() => {
    if (restoreForm === 'bid' && member) {
      const stored = readDraft(member.id, 'bid');
      if (stored) {
        clearDraft(member.id, 'bid');
        return { ...draftFrom(tender.myBid), ...(stored as Partial<BidDraft>) };
      }
    }
    return draftFrom(tender.myBid);
  });
  const [busy, setBusy] = useState(false);

  const amending = tender.myBid !== null;

  const submit = async (): Promise<void> => {
    const base = parseAmount(draft.base);
    const found: Record<string, string> = {};
    if (Number.isNaN(base)) found.baseCents = fieldErrorCopy.badAmount();
    const sums = draft.provisionalSums.map((entry, index) => {
      const amount = parseAmount(entry.amount);
      if (Number.isNaN(amount)) {
        found[`provisionalSums[${index}].amountCents`] = fieldErrorCopy.badAmount();
      }
      return { label: entry.label, amountCents: Number.isNaN(amount) ? 0 : amount };
    });
    if (Object.keys(found).length > 0) {
      errors.set(found);
      const first = Object.keys(found)[0];
      if (first) focusFieldError(formId, first);
      return;
    }

    setBusy(true);
    errors.clear();
    startPending(amending ? pending.submitAmendment : pending.submitBid);
    try {
      const result = await request<{ bid: ContractorBid }>(`/api/tenders/${tender.id}/bid`, {
        method: amending ? 'PUT' : 'POST',
        body: {
          baseCents: base,
          provisionalSums: sums,
          exclusions: draft.exclusions,
        },
      });
      refresh();
      onChanged();
      const when = formatInstant(new Date(result.bid.finalSubmittedAt), tender.timeZone);
      say(amending ? success.bidAmended(when) : success.bidSubmitted(when));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'tender_closed') {
        problem(
          refusal.lateBid(
            formatInstant(
              new Date(caught.extra<string>('closedAt') ?? tender.closesAt ?? Date.now()),
              tender.timeZone,
            ),
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'bid_exists') {
        problem(refusal.otherIllegal('already bid'));
      } else {
        handleFailure(caught, { draft: { formKey: 'bid', values: { ...draft } } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stage">
      <h3>{tender.title}</h3>
      <p>{tender.scope}</p>
      <p className="stage-state">{TENDER_STATUS_LABELS[tender.status]}</p>
      {tender.closesAt ? (
        <p className="meta">
          {`Closes ${formatInstant(new Date(tender.closesAt), tender.timeZone)}`}
        </p>
      ) : null}

      <ErrorSummary formId={formId} errors={errors.errors} />

      <Field formId={formId} path="baseCents" label="Base amount" errors={errors.errors}>
        {(attributes) => (
          <input
            {...attributes}
            type="text"
            inputMode="decimal"
            value={draft.base}
            onChange={(event) => setDraft({ ...draft, base: event.target.value })}
          />
        )}
      </Field>

      {draft.provisionalSums.map((entry, index) => (
        <fieldset key={index}>
          <legend>{`Provisional sum ${index + 1}`}</legend>
          <Field
            formId={formId}
            path={`provisionalSums[${index}].label`}
            label="Provisional sum label"
            errors={errors.errors}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={entry.label}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    provisionalSums: draft.provisionalSums.map((item, at) =>
                      at === index ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
            )}
          </Field>
          <Field
            formId={formId}
            path={`provisionalSums[${index}].amountCents`}
            label="Provisional sum amount"
            errors={errors.errors}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                inputMode="decimal"
                value={entry.amount}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    provisionalSums: draft.provisionalSums.map((item, at) =>
                      at === index ? { ...item, amount: event.target.value } : item,
                    ),
                  })
                }
              />
            )}
          </Field>
        </fieldset>
      ))}

      {draft.exclusions.map((entry, index) => (
        <Field
          key={index}
          formId={formId}
          path={`exclusions[${index}].label`}
          label="Exclusion"
          errors={errors.errors}
        >
          {(attributes) => (
            <input
              {...attributes}
              type="text"
              value={entry.label}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  exclusions: draft.exclusions.map((item, at) =>
                    at === index ? { label: event.target.value } : item,
                  ),
                })
              }
            />
          )}
        </Field>
      ))}

      <div className="row-actions">
        <button
          type="button"
          onClick={() =>
            setDraft({
              ...draft,
              provisionalSums: [...draft.provisionalSums, { label: '', amount: '' }],
            })
          }
        >
          Add provisional sum
        </button>
        <button
          type="button"
          onClick={() => setDraft({ ...draft, exclusions: [...draft.exclusions, { label: '' }] })}
        >
          Add exclusion
        </button>
        <ActionButton
          className="primary"
          busy={busy}
          pendingLabel={amending ? pending.submitAmendment : pending.submitBid}
          onPress={() => void submit()}
        >
          {amending ? 'Submit amendment' : 'Submit bid'}
        </ActionButton>
      </div>
    </section>
  );
}
