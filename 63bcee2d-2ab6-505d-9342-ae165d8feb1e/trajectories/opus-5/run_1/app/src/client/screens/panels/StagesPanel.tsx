import { useEffect, useId, useRef, useState } from 'react';
import {
  FEE_STAGE_KEYS,
  HK_ZONE,
  STAGE_NAMES,
  STAGE_STATE_LABELS,
  isStudioRole,
  type Currency,
  type StageKey,
  type StageState,
} from '../../../shared/domain.js';
import { formatAmount, formatInstant } from '../../../shared/format.js';
import { ApiError, request } from '../../lib/api.js';
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

interface Stage {
  key: StageKey;
  name: string;
  feeCents: number | null;
  currency: Currency;
  state: StageState;
  requestedAt: string | null;
  requestedBy: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
  returnedReason: string | null;
  invoice: { invoiceNumber: string; amountCents: number; currency: Currency } | null;
  internalNote?: string;
}

type DialogState =
  | { kind: 'request'; stage: Stage }
  | { kind: 'sign-off'; stage: Stage }
  | { kind: 'return'; stage: Stage }
  | null;

export function StagesPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project, restoreForm } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const { data, error } = useResource<{ stages: Stage[] }>(
    `/api/projects/${project.id}/stages`,
    [project.id],
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const restored = useRef<{ message: string; stageKey: string } | null>(
    restoreForm === 'stage-request' && member
      ? (() => {
          const draft = readDraft(member.id, 'stage-request');
          if (!draft) return null;
          clearDraft(member.id, 'stage-request');
          return {
            message: String(draft.message ?? ''),
            stageKey: String(draft.stageKey ?? ''),
          };
        })()
      : null,
  );
  const [message, setMessage] = useState(restored.current?.message ?? '');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const stages = data?.stages ?? [];

  // A draft kept through an ended session puts its own dialog back.
  useEffect(() => {
    const keep = restored.current;
    if (!keep || stages.length === 0) return;
    restored.current = null;
    const stage = stages.find((entry) => entry.key === keep.stageKey);
    if (stage) setDialog({ kind: 'request', stage });
  }, [stages]);

  const studio = member ? isStudioRole(member.role) : false;
  const mayRequest = member?.role === 'director' || member?.role === 'project_lead';
  const mayDecide = member?.role === 'client_approver';
  const currentStage =
    FEE_STAGE_KEYS.find(
      (key) => stages.find((stage) => stage.key === key)?.state !== 'signed_off',
    ) ?? 'aftercare';
  const current = stages.find((stage) => stage.key === currentStage);

  const focusStageHeading = (key: StageKey): void => {
    focusWhenReady(`[data-stage-heading="${key}"]`);
  };

  const sendRequest = async (stage: Stage): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.requestSignOff);
    try {
      await request(`/api/projects/${project.id}/stages/${stage.key}/request`, {
        body: { message },
      });
      setDialog(null);
      setMessage('');
      refresh();
      say(success.signOffRequested(stage.name));
      focusStageHeading(stage.key);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'previous_stage_open') {
        const open = caught.extra<StageKey>('stage');
        problem(refusal.otherIllegal(open ? `waiting on ${STAGE_NAMES[open]}` : 'not ready'));
        focusFirstDialogButton();
      } else if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(refusal.otherIllegal(STAGE_STATE_LABELS[stage.state].toLowerCase()));
        focusFirstDialogButton();
      } else {
        handleFailure(caught, {
          draft: { formKey: 'stage-request', values: { message, stageKey: stage.key } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOff = async (stage: Stage): Promise<void> => {
    setBusy(true);
    startPending(pending.signOff(stage.name));
    try {
      const result = await request<{ stage: Stage }>(
        `/api/projects/${project.id}/stages/${stage.key}/sign-off`,
        { body: {} },
      );
      setDialog(null);
      refresh();
      say(
        success.signedOff(
          stage.name,
          result.stage.invoice?.invoiceNumber ?? '',
          member?.email ?? '',
        ),
      );
      focusStageHeading(stage.key);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'already_signed_off') {
        setDialog(null);
        refresh();
        problem(
          refusal.signOffLostRace(
            caught.extra<string>('by') ?? '',
            stage.name,
            formatInstant(new Date(caught.extra<string>('at') ?? Date.now()), HK_ZONE),
          ),
        );
        focusStageHeading(stage.key);
      } else if (caught instanceof ApiError && caught.code === 'billing_unavailable') {
        problem(refusal.billingOutage(stage.name));
        focusFirstDialogButton();
      } else {
        handleFailure(caught);
        focusFirstDialogButton();
      }
    } finally {
      setBusy(false);
    }
  };

  const returnStage = async (stage: Stage): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.returnStage);
    try {
      await request(`/api/projects/${project.id}/stages/${stage.key}/return`, {
        body: { reason },
      });
      setDialog(null);
      setReason('');
      refresh();
      say(success.stageReturned(stage.name));
      focusStageHeading(stage.key);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, {
          draft: { formKey: 'stage-return', values: { reason, stageKey: stage.key } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (stage: Stage): Promise<void> => {
    setBusy(true);
    startPending(pending.saveNote);
    try {
      await request(`/api/projects/${project.id}/stages/${stage.key}`, {
        method: 'PATCH',
        body: { internalNote: notes[stage.key] ?? stage.internalNote ?? '' },
      });
      refresh();
      say(success.noteSaved);
    } catch (caught) {
      handleFailure(caught, {
        draft: { formKey: `stage-note-${stage.key}`, values: { note: notes[stage.key] ?? '' } },
      });
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Panel
        sheetCode={props.sheetCode}
        revision={props.revision}
        name={props.panelName}
        heading={<h2 className="panel-heading">Stages</h2>}
      >
        <p>{refusal.forbidden}</p>
      </Panel>
    );
  }

  const primaryLabel = current
    ? mayDecide && current.state === 'requested'
      ? `Sign off ${current.name}`
      : `Request sign-off for ${current.name}`
    : null;

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Stages</h2>}
    >
      <div className="stack">
        {stages.map((stage) => (
          <article className="stage" key={stage.key}>
            <h3 className="stage-heading" data-stage-heading={stage.key} tabIndex={-1}>
              {stage.name}
            </h3>
            <p className="stage-state">{STAGE_STATE_LABELS[stage.state]}</p>
            {stage.feeCents !== null ? (
              <p className="fee-figure">{formatAmount(stage.feeCents, stage.currency)}</p>
            ) : (
              <p className="meta">No fee</p>
            )}
            {stage.requestedBy && stage.requestedAt ? (
              <p className="meta">
                {`Requested by ${stage.requestedBy} on ${formatInstant(
                  new Date(stage.requestedAt),
                  HK_ZONE,
                )}`}
              </p>
            ) : null}
            {stage.signedOffBy && stage.signedOffAt ? (
              <p className="meta">
                {`Signed off by ${stage.signedOffBy} on ${formatInstant(
                  new Date(stage.signedOffAt),
                  HK_ZONE,
                )}`}
              </p>
            ) : null}
            {stage.invoice ? (
              <p className="meta">{`Invoice ${stage.invoice.invoiceNumber}`}</p>
            ) : null}
            {stage.returnedReason ? (
              <p className="meta">{`Returned: ${stage.returnedReason}`}</p>
            ) : null}

            <div className="row-actions">
              {mayRequest &&
              stage.feeCents !== null &&
              (stage.state === 'not_started' || stage.state === 'returned') ? (
                <button
                  type="button"
                  onClick={() => {
                    errors.clear();
                    setDialog({ kind: 'request', stage });
                  }}
                >
                  {`Request sign-off for ${stage.name}`}
                </button>
              ) : null}
              {mayDecide && stage.state === 'requested' ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setDialog({ kind: 'sign-off', stage })}
                  >
                    {`Sign off ${stage.name}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      errors.clear();
                      setDialog({ kind: 'return', stage });
                    }}
                  >
                    {`Return ${stage.name}`}
                  </button>
                </>
              ) : null}
            </div>

            {studio ? (
              <div className="inline">
                <div className="field">
                  <label className="field-label" htmlFor={`${formId}-note-${stage.key}`}>
                    Internal note
                  </label>
                  <textarea
                    id={`${formId}-note-${stage.key}`}
                    rows={2}
                    value={notes[stage.key] ?? stage.internalNote ?? ''}
                    onChange={(event) =>
                      setNotes({ ...notes, [stage.key]: event.target.value })
                    }
                  />
                </div>
                <ActionButton
                  busy={busy}
                  pendingLabel={pending.saveNote}
                  onPress={() => void saveNote(stage)}
                >
                  Save note
                </ActionButton>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {current && primaryLabel ? (
        <div className="sticky-bar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              errors.clear();
              setDialog(
                mayDecide && current.state === 'requested'
                  ? { kind: 'sign-off', stage: current }
                  : { kind: 'request', stage: current },
              );
            }}
          >
            {primaryLabel}
          </button>
        </div>
      ) : null}

      {dialog?.kind === 'request' ? (
        <Dialog
          title={`Request sign-off for ${dialog.stage.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.requestSignOff}
                onPress={() => void sendRequest(dialog.stage)}
              >
                Send request
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
            path="message"
            label="Message to approvers"
            errors={errors.errors}
          >
            {(attributes) => (
              <textarea
                {...attributes}
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}

      {dialog?.kind === 'sign-off' ? (
        <Dialog
          title={`Sign off ${dialog.stage.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.signOff(dialog.stage.name)}
                onPress={() => void confirmSignOff(dialog.stage)}
              >
                Confirm sign-off
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>
            {`Signing off ${dialog.stage.name} raises the stage fee invoice and sends you a
              receipt.`}
          </p>
          <p className="fee-figure">
            {formatAmount(dialog.stage.feeCents ?? 0, dialog.stage.currency)}
          </p>
        </Dialog>
      ) : null}

      {dialog?.kind === 'return' ? (
        <Dialog
          title={`Return ${dialog.stage.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.returnStage}
                onPress={() => void returnStage(dialog.stage)}
              >
                Return to studio
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field formId={formId} path="reason" label="Reason" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </Panel>
  );
}
