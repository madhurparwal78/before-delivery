import { useCallback, useId, useRef, useState } from 'react';
import {
  HK_ZONE,
  REVIEW_CODE_LABELS,
  isStudioRole,
  type ReviewCode,
} from '../../../shared/domain.js';
import { fieldErrorCopy } from '../../../shared/fieldErrors.js';
import { formatDate, formatInstant } from '../../../shared/format.js';
import { ApiError, request } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import { clearDraft, readDraft } from '../../lib/drafts.js';
import { useMinuteClock } from '../../lib/useTenderClock.js';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { ActionButton } from '../../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../../components/Fields.jsx';
import { Panel, TableRegion } from '../../components/Panel.jsx';
import { focusWhenReady } from '../../lib/focus.js';
import { ReviewCodeBadge, ReviewDueBadge } from '../../components/Shapes.jsx';
import type { PanelProps } from '../ProjectPage.jsx';

interface ShopDrawing {
  id: string;
  reference: string;
  title: string;
  submission: number;
  status: 'received' | 'returned';
  receivedAt: string;
  reviewDueOn: string;
  overdue: boolean;
  review: { code: ReviewCode; comments: string; by: string | null; at: string | null } | null;
}

export function ShopDrawingsPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project, restoreForm } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const [tick, setTick] = useState(0);
  const drawings = useResource<{ shopDrawings: ShopDrawing[] }>(
    `/api/projects/${project.id}/shop-drawings`,
    [project.id, tick],
  );
  useMinuteClock(useCallback(() => setTick((value) => value + 1), []));

  const fileInput = useRef<HTMLInputElement | null>(null);
  const resubmitInput = useRef<HTMLInputElement | null>(null);
  const resubmitTarget = useRef<ShopDrawing | null>(null);
  const [dialog, setDialog] = useState<
    { kind: 'submit' } | { kind: 'review'; target: ShopDrawing } | null
  >(() => (restoreForm === 'submit-shop-drawing' ? { kind: 'submit' } : null));
  const [reference, setReference] = useState('');
  const [title, setTitle] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState<ReviewCode>(1);
  const [reviewComments, setReviewComments] = useState('');
  const [busy, setBusy] = useState(false);

  if (restoreForm === 'submit-shop-drawing' && member && reference === '' && title === '') {
    const stored = readDraft(member.id, 'submit-shop-drawing');
    if (stored) {
      clearDraft(member.id, 'submit-shop-drawing');
      setReference(String(stored.reference ?? ''));
      setTitle(String(stored.title ?? ''));
    }
  }

  const list = drawings.data?.shopDrawings ?? [];
  const studio = member ? isStudioRole(member.role) : false;
  const mayReview =
    member?.role === 'director' || member?.role === 'project_lead' || member?.role === 'designer';
  const maySubmit = mayReview || member?.role === 'contractor';

  const submit = async (): Promise<void> => {
    if (!file) {
      errors.set({ file: fieldErrorCopy.required('Drawing file') });
      focusFieldError(formId, 'file');
      return;
    }
    setBusy(true);
    errors.clear();
    startPending(pending.sendForReview);
    const form = new FormData();
    form.set('reference', reference);
    form.set('title', title);
    if (studio && receivedAt !== '') form.set('receivedAt', receivedAt);
    form.set('file', file, file.name);
    try {
      const result = await request<{ shopDrawing: ShopDrawing }>(
        `/api/projects/${project.id}/shop-drawings`,
        { form },
      );
      setDialog(null);
      setReference('');
      setTitle('');
      setReceivedAt('');
      setFile(null);
      refresh();
      drawings.reload();
      say(
        success.shopDrawingReceived(
          result.shopDrawing.reference,
          formatDate(result.shopDrawing.reviewDueOn),
        ),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'file_too_large') {
        errors.set({
          file: fieldErrorCopy.fileTooLarge(
            file.name,
            caught.extra<number>('limitBytes') ?? 10_000_000,
          ),
        });
        focusFieldError(formId, 'file');
      } else if (caught instanceof ApiError && caught.code === 'storage_unavailable') {
        problem(refusal.storageOutageUpload(file.name));
        focusFirstDialogButton();
      } else {
        handleFailure(caught, {
          draft: { formKey: 'submit-shop-drawing', values: { reference, title } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const resubmit = async (target: ShopDrawing, chosen: File): Promise<void> => {
    setBusy(true);
    startPending(pending.sendForReview);
    const form = new FormData();
    form.set('file', chosen, chosen.name);
    try {
      const result = await request<{ shopDrawing: ShopDrawing }>(
        `/api/shop-drawings/${target.id}/resubmissions`,
        { form },
      );
      refresh();
      drawings.reload();
      say(
        success.shopDrawingReceived(
          result.shopDrawing.reference,
          formatDate(result.shopDrawing.reviewDueOn),
        ),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'storage_unavailable') {
        problem(refusal.storageOutageUpload(chosen.name));
      } else if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(refusal.otherIllegal('still under review'));
      } else {
        handleFailure(caught);
      }
    } finally {
      setBusy(false);
    }
  };

  const returnDrawing = async (target: ShopDrawing): Promise<void> => {
    if (code >= 2 && reviewComments.trim() === '') {
      errors.set({ comments: fieldErrorCopy.commentsMissing(REVIEW_CODE_LABELS[code]) });
      focusFieldError(formId, 'comments');
      return;
    }
    setBusy(true);
    errors.clear();
    startPending(pending.returnDrawing);
    const index = list.findIndex((entry) => entry.id === target.id);
    try {
      await request(`/api/shop-drawings/${target.id}/review`, {
        body: { code, comments: reviewComments },
      });
      setDialog(null);
      setReviewComments('');
      refresh();
      drawings.reload();
      say(success.drawingReturned(target.reference, REVIEW_CODE_LABELS[code]));
      const next = list.slice(index + 1).find((entry) => entry.status === 'received');
      focusWhenReady(
        next ? `[data-review="${next.reference}"]` : '[data-shop-drawings-heading]',
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'already_reviewed') {
        setDialog(null);
        drawings.reload();
        problem(
          refusal.shopDrawingLostRace(
            caught.extra<string>('by') ?? '',
            target.reference,
            formatInstant(new Date(caught.extra<string>('at') ?? Date.now()), HK_ZONE),
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, {
          draft: { formKey: `review-${target.id}`, values: { code, reviewComments } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={
        <h2 className="panel-heading" data-shop-drawings-heading tabIndex={-1}>
          Shop drawings
        </h2>
      }
    >
      {maySubmit ? (
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              errors.clear();
              setDialog({ kind: 'submit' });
            }}
          >
            Submit shop drawing
          </button>
        </div>
      ) : null}

      <div className="field" hidden>
        <label className="field-label" htmlFor={`${formId}-resubmit-file`}>
          Resubmission file
        </label>
        <input
          id={`${formId}-resubmit-file`}
          ref={resubmitInput}
          type="file"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            const target = resubmitTarget.current;
            if (chosen && target) void resubmit(target, chosen);
          }}
        />
      </div>

      <TableRegion label="Shop drawings table">
        <table>
          <caption>Shop drawings</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Title</th>
              <th scope="col" className="numeric">
                Submission
              </th>
              <th scope="col">Received</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((drawing) => (
              <tr key={drawing.id}>
                <th scope="row">{drawing.reference}</th>
                <td>{drawing.title}</td>
                <td className="numeric">{drawing.submission}</td>
                <td>{formatInstant(new Date(drawing.receivedAt), HK_ZONE)}</td>
                <td>
                  <ReviewDueBadge overdue={drawing.overdue} reviewDueOn={drawing.reviewDueOn} />
                </td>
                <td>
                  {drawing.review ? (
                    <ReviewCodeBadge code={drawing.review.code} />
                  ) : (
                    <span className="badge">Awaiting review</span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    {mayReview && drawing.status === 'received' ? (
                      <button
                        type="button"
                        data-review={drawing.reference}
                        onClick={() => {
                          errors.clear();
                          setCode(1);
                          setReviewComments('');
                          setDialog({ kind: 'review', target: drawing });
                        }}
                      >
                        {`Review ${drawing.reference}`}
                      </button>
                    ) : null}
                    {maySubmit &&
                    drawing.review &&
                    (drawing.review.code === 3 || drawing.review.code === 4) ? (
                      <button
                        type="button"
                        onClick={() => {
                          resubmitTarget.current = drawing;
                          resubmitInput.current?.click();
                        }}
                      >
                        {`Resubmit ${drawing.reference}`}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>

      {maySubmit ? (
        <div className="sticky-bar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              errors.clear();
              setDialog({ kind: 'submit' });
            }}
          >
            Submit shop drawing
          </button>
        </div>
      ) : null}

      {dialog?.kind === 'submit' ? (
        <Dialog
          title="Submit shop drawing"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.sendForReview}
                onPress={() => void submit()}
              >
                Send for review
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field formId={formId} path="reference" label="Reference" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            )}
          </Field>
          <Field formId={formId} path="title" label="Title" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </Field>
          <Field formId={formId} path="file" label="Drawing file" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                ref={fileInput}
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
          {studio ? (
            <Field
              formId={formId}
              path="receivedAt"
              label="Received at"
              errors={errors.errors}
              hint="Optional. An ISO instant, for the studio logging a transmittal that arrived earlier."
            >
              {(attributes) => (
                <input
                  {...attributes}
                  type="text"
                  placeholder="2026-10-19T02:00:00.000Z"
                  value={receivedAt}
                  onChange={(event) => setReceivedAt(event.target.value)}
                />
              )}
            </Field>
          ) : null}
        </Dialog>
      ) : null}

      {dialog?.kind === 'review' ? (
        <Dialog
          title={`Review ${dialog.target.reference}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.returnDrawing}
                onPress={() => void returnDrawing(dialog.target)}
              >
                Return drawing
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <p className="group-heading" id={`${formId}-code-label`}>
            Review code
          </p>
          <div role="radiogroup" aria-labelledby={`${formId}-code-label`}>
            {([1, 2, 3, 4] as ReviewCode[]).map((value) => (
              <div className="radio-row" key={value}>
                <input
                  type="radio"
                  id={`${formId}-code-${value}`}
                  name={`${formId}-code`}
                  checked={code === value}
                  onChange={() => setCode(value)}
                />
                <label htmlFor={`${formId}-code-${value}`}>{REVIEW_CODE_LABELS[value]}</label>
              </div>
            ))}
          </div>
          <Field formId={formId} path="comments" label="Comments" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={4}
                value={reviewComments}
                onChange={(event) => setReviewComments(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </Panel>
  );
}
