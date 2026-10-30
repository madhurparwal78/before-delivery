import { useId, useRef, useState } from 'react';
import {
  HK_ZONE,
  VARIATION_ACTION_PAST,
  VARIATION_STATE_WORDS,
  type Currency,
  type VariationAction,
  type VariationState,
} from '../../../shared/domain.js';
import { fieldErrorCopy } from '../../../shared/fieldErrors.js';
import { centsToDecimal, formatAmount, formatInstant } from '../../../shared/format.js';
import { ApiError, newRetryKey, request } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import { clearDraft, readDraft } from '../../lib/drafts.js';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { ActionButton } from '../../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../../components/Fields.jsx';
import { Panel } from '../../components/Panel.jsx';
import type { PanelProps } from '../ProjectPage.jsx';
import { focusWhenReady } from '../../lib/focus.js';

interface Person {
  id: string;
  name: string;
  role: string;
  organisation: string;
}

interface Variation {
  id: string;
  number: string;
  title: string;
  description: string;
  amountCents: number;
  currency: Currency;
  storeCode: string | null;
  state: VariationState;
  rejectReason: string | null;
  raisedBy: Person;
  raisedAt: string;
  version: number;
  updatedBy: Person;
  updatedAt: string;
}

interface VariationForm {
  title: string;
  description: string;
  amount: string;
  storeCode: string;
}

const EMPTY: VariationForm = { title: '', description: '', amount: '', storeCode: '' };

function parseAmount(text: string): number {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function VariationsPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project, restoreForm } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const { data, reload } = useResource<{ variations: Variation[] }>(
    `/api/projects/${project.id}/variations`,
    [project.id],
  );
  const retryKey = useRef<string>(newRetryKey());
  const [dialog, setDialog] = useState<
    | { kind: 'raise' }
    | { kind: 'edit'; target: Variation }
    | { kind: 'reject'; target: Variation }
    | null
  >(() => (restoreForm === 'raise-variation' ? { kind: 'raise' } : null));
  const [form, setForm] = useState<VariationForm>(() => {
    if (restoreForm === 'raise-variation' && member) {
      const stored = readDraft(member.id, 'raise-variation');
      if (stored) {
        clearDraft(member.id, 'raise-variation');
        return { ...EMPTY, ...(stored as Partial<VariationForm>) };
      }
    }
    return EMPTY;
  });
  const [rejectReason, setRejectReason] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [optimistic, setOptimistic] = useState<Record<string, VariationState>>({});
  const [busy, setBusy] = useState(false);

  const variations = data?.variations ?? [];
  const mayRaise =
    member?.role === 'director' || member?.role === 'project_lead' || member?.role === 'contractor';
  const mayReview = member?.role === 'director' || member?.role === 'project_lead';

  const focusNumber = (number: string): void => {
    focusWhenReady(`[data-variation-heading="${number}"]`);
  };

  const validate = (values: VariationForm): Record<string, string> => {
    const found: Record<string, string> = {};
    const amount = parseAmount(values.amount);
    if (Number.isNaN(amount) || amount === 0) found.amountCents = fieldErrorCopy.badAmount();
    return found;
  };

  const raise = async (): Promise<void> => {
    const found = validate(form);
    if (Object.keys(found).length > 0) {
      errors.set(found);
      const first = Object.keys(found)[0];
      if (first) focusFieldError(formId, first);
      return;
    }
    setBusy(true);
    errors.clear();
    startPending(pending.submitVariation);
    try {
      const result = await request<{ variation: Variation }>(
        `/api/projects/${project.id}/variations`,
        {
          idempotencyKey: retryKey.current,
          body: {
            title: form.title,
            description: form.description,
            amountCents: parseAmount(form.amount),
            ...(form.storeCode === '' ? {} : { storeCode: form.storeCode }),
          },
        },
      );
      setDialog(null);
      setForm(EMPTY);
      retryKey.current = newRetryKey();
      refresh();
      reload();
      say(success.variationRaised(result.variation.number));
      focusNumber(result.variation.number);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'idempotency_key_reused') {
        problem(refusal.reusedRetryKey);
        focusFirstDialogButton();
      } else {
        handleFailure(caught, {
          draft: { formKey: 'raise-variation', values: { ...form } },
        });
        focusFirstDialogButton();
      }
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = async (target: Variation): Promise<void> => {
    const found = validate(form);
    if (Object.keys(found).length > 0) {
      errors.set(found);
      const first = Object.keys(found)[0];
      if (first) focusFieldError(formId, first);
      return;
    }
    setBusy(true);
    errors.clear();
    startPending(pending.saveVariation);
    try {
      await request(`/api/variations/${target.id}`, {
        method: 'PATCH',
        body: {
          version: target.version,
          title: form.title,
          description: form.description,
          amountCents: parseAmount(form.amount),
          storeCode: form.storeCode === '' ? null : form.storeCode,
        },
      });
      setDialog(null);
      refresh();
      reload();
      say(success.variationSaved(target.number));
      focusNumber(target.number);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'stale_version') {
        problem(
          refusal.newerVersion(
            caught.extra<string>('savedBy') ?? '',
            formatInstant(new Date(caught.extra<string>('savedAt') ?? Date.now()), HK_ZONE),
          ),
        );
        reload();
        focusFirstDialogButton();
      } else if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, { draft: { formKey: 'edit-variation', values: { ...form } } });
      }
    } finally {
      setBusy(false);
    }
  };

  const transition = async (
    target: Variation,
    action: VariationAction,
    reason?: string,
  ): Promise<void> => {
    const nextState: VariationState =
      action === 'start_review'
        ? 'under_review'
        : action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'withdrawn';
    if (action === 'withdraw') setOptimistic({ ...optimistic, [target.id]: 'withdrawn' });
    setBusy(true);
    startPending(pending.variationTransition);
    try {
      await request(`/api/variations/${target.id}/transitions`, {
        body: { action, ...(reason === undefined ? {} : { reason }) },
      });
      setDialog(null);
      setRejectReason('');
      setOptimistic((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      refresh();
      reload();
      say(success.variationTransition(target.number, VARIATION_STATE_WORDS[nextState]));
      focusNumber(target.number);
    } catch (caught) {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      if (caught instanceof ApiError && caught.code === 'over_approval_limit') {
        problem(
          refusal.overApprovalLimit(
            formatAmount(
              caught.extra<number>('limitCents') ?? 0,
              (caught.extra<string>('currency') ?? target.currency) as Currency,
            ),
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'own_variation') {
        problem(refusal.ownVariation);
      } else if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(
          refusal.variationIllegal(
            target.number,
            VARIATION_ACTION_PAST[action],
            VARIATION_STATE_WORDS[
              (caught.extra<VariationState>('from') ?? target.state) as VariationState
            ],
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'validation') {
        problem(caught.errors.reason ?? fieldErrorCopy.required('Reason'));
        focusFirstDialogButton();
      } else {
        handleFailure(caught);
      }
    } finally {
      setBusy(false);
    }
  };

  const postComment = async (target: Variation): Promise<void> => {
    setBusy(true);
    startPending(pending.postComment);
    try {
      await request(`/api/variations/${target.id}/comments`, {
        body: { body: comments[target.id] ?? '' },
      });
      setComments({ ...comments, [target.id]: '' });
      refresh();
      reload();
      say(success.commentPosted);
    } catch (caught) {
      handleFailure(caught, {
        draft: {
          formKey: `comment-${target.id}`,
          values: { body: comments[target.id] ?? '' },
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const storeField = (
    <Field formId={formId} path="storeCode" label="Store" errors={errors.errors}>
      {(attributes) => (
        <select
          {...attributes}
          value={form.storeCode}
          onChange={(event) => setForm({ ...form, storeCode: event.target.value })}
        >
          <option value="">Whole rollout</option>
          {project.stores.map((store) => (
            <option key={store.code} value={store.code}>
              {`${store.code} ${store.name}`}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const bodyFields = (
    <>
      <ErrorSummary formId={formId} errors={errors.errors} />
      <Field formId={formId} path="title" label="Title" errors={errors.errors}>
        {(attributes) => (
          <input
            {...attributes}
            type="text"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        )}
      </Field>
      <Field formId={formId} path="description" label="Description" errors={errors.errors}>
        {(attributes) => (
          <textarea
            {...attributes}
            rows={5}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        )}
      </Field>
      <Field formId={formId} path="amountCents" label="Amount" errors={errors.errors}>
        {(attributes) => (
          <input
            {...attributes}
            type="text"
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        )}
      </Field>
      {storeField}
    </>
  );

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Variations</h2>}
    >
      {mayRaise ? (
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              errors.clear();
              setForm(EMPTY);
              setDialog({ kind: 'raise' });
            }}
          >
            Raise variation
          </button>
        </div>
      ) : null}

      <ul className="snag-list" aria-label="Variations">
        {variations.map((variation) => {
          const state = optimistic[variation.id] ?? variation.state;
          const isRaiser = variation.raisedBy.id === member?.id;
          return (
            <li className="stage" key={variation.id}>
              <h3
                className="stage-heading"
                data-variation-heading={variation.number}
                tabIndex={-1}
              >
                {variation.number}
              </h3>
              <p className="stage-state">{VARIATION_STATE_WORDS[state]}</p>
              <p>{variation.title}</p>
              <p className="fee-figure">
                {formatAmount(variation.amountCents, variation.currency)}
              </p>
              <p className="meta">
                {`${variation.storeCode ?? 'Whole rollout'} · raised by ${
                  variation.raisedBy.name
                } (${variation.raisedBy.organisation}) on ${formatInstant(
                  new Date(variation.raisedAt),
                  HK_ZONE,
                )} · version ${variation.version}, last saved by ${
                  variation.updatedBy.name
                } at ${formatInstant(new Date(variation.updatedAt), HK_ZONE)}`}
              </p>
              <p>{variation.description}</p>
              {variation.rejectReason ? (
                <p className="meta">{`Rejected: ${variation.rejectReason}`}</p>
              ) : null}

              <div className="row-actions">
                {mayReview && state === 'raised' ? (
                  <ActionButton
                    busy={busy}
                    pendingLabel={pending.variationTransition}
                    onPress={() => void transition(variation, 'start_review')}
                  >
                    {`Start review of ${variation.number}`}
                  </ActionButton>
                ) : null}
                {mayReview && state === 'under_review' ? (
                  <>
                    <ActionButton
                      className="primary"
                      busy={busy}
                      pendingLabel={pending.variationTransition}
                      onPress={() => void transition(variation, 'approve')}
                    >
                      {`Approve ${variation.number}`}
                    </ActionButton>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectReason('');
                        setDialog({ kind: 'reject', target: variation });
                      }}
                    >
                      {`Reject ${variation.number}`}
                    </button>
                  </>
                ) : null}
                {isRaiser && (state === 'raised' || state === 'under_review') ? (
                  <ActionButton
                    busy={busy}
                    pendingLabel={pending.variationTransition}
                    onPress={() => void transition(variation, 'withdraw')}
                  >
                    {`Withdraw ${variation.number}`}
                  </ActionButton>
                ) : null}
                {(mayReview || isRaiser) && (state === 'raised' || state === 'under_review') ? (
                  <button
                    type="button"
                    onClick={() => {
                      errors.clear();
                      setForm({
                        title: variation.title,
                        description: variation.description,
                        amount: centsToDecimal(variation.amountCents),
                        storeCode: variation.storeCode ?? '',
                      });
                      setDialog({ kind: 'edit', target: variation });
                    }}
                  >
                    {`Edit ${variation.number}`}
                  </button>
                ) : null}
              </div>

              <div className="inline">
                <div className="field">
                  <label className="field-label" htmlFor={`${formId}-comment-${variation.id}`}>
                    Comment
                  </label>
                  <textarea
                    id={`${formId}-comment-${variation.id}`}
                    rows={2}
                    value={comments[variation.id] ?? ''}
                    onChange={(event) =>
                      setComments({ ...comments, [variation.id]: event.target.value })
                    }
                  />
                </div>
                <ActionButton
                  busy={busy}
                  pendingLabel={pending.postComment}
                  onPress={() => void postComment(variation)}
                >
                  Post comment
                </ActionButton>
              </div>
            </li>
          );
        })}
      </ul>

      {mayRaise ? (
        <div className="sticky-bar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              errors.clear();
              setForm(EMPTY);
              setDialog({ kind: 'raise' });
            }}
          >
            Raise variation
          </button>
        </div>
      ) : null}

      {dialog?.kind === 'raise' ? (
        <Dialog
          title="Raise variation"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.submitVariation}
                onPress={() => void raise()}
              >
                Submit variation
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          {bodyFields}
        </Dialog>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <Dialog
          title={`Edit ${dialog.target.number}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.saveVariation}
                onPress={() => void saveChanges(dialog.target)}
              >
                Save changes
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          {bodyFields}
        </Dialog>
      ) : null}

      {dialog?.kind === 'reject' ? (
        <Dialog
          title={`Reject ${dialog.target.number}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.variationTransition}
                onPress={() => void transition(dialog.target, 'reject', rejectReason)}
              >
                Confirm rejection
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <Field formId={formId} path="reason" label="Reason" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={4}
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </Panel>
  );
}
