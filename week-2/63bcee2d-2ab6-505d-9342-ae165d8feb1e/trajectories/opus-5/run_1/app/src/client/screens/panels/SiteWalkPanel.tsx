import { useEffect, useId, useRef, useState } from 'react';
import {
  HK_ZONE,
  SNAG_STATE_LABELS,
  type SnagAction,
  type SnagState,
} from '../../../shared/domain.js';
import { fieldErrorCopy } from '../../../shared/fieldErrors.js';
import { dateInZone } from '../../../shared/zoned.js';
import { ApiError, request } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import { clearDraft, readDraft } from '../../lib/drafts.js';
import { prefersReducedMotion } from '../../lib/motion.js';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { ActionButton } from '../../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../../components/Fields.jsx';
import { IntentSeam, isNearSeam } from '../../components/IntentSeam.jsx';
import { Panel } from '../../components/Panel.jsx';
import { Shape } from '../../components/Shapes.jsx';
import { SNAG_STATE_SHAPES } from '../../../shared/domain.js';
import type { PanelProps } from '../ProjectPage.jsx';
import { focusWhenReady } from '../../lib/focus.js';

interface Viewpoint {
  id: string;
  name: string;
  storeCode: string;
  hasRender: boolean;
  photoId: string | null;
}

interface Snag {
  id: string;
  number: number;
  s: number;
  y: number;
  title: string;
  note: string;
  observedOn: string;
  state: SnagState;
  version: number;
}

export function SiteWalkPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project, restoreForm } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const viewpoints = useResource<{ viewpoints: Viewpoint[] }>(
    `/api/projects/${project.id}/viewpoints`,
    [project.id],
  );
  const [viewpointId, setViewpointId] = useState('');
  const chosen =
    viewpoints.data?.viewpoints.find((entry) => entry.id === viewpointId) ??
    viewpoints.data?.viewpoints[0] ??
    null;
  const snags = useResource<{ snags: Snag[] }>(
    chosen ? `/api/viewpoints/${chosen.id}/snags` : null,
    [chosen?.id ?? ''],
  );

  const [seam, setSeam] = useState(50);
  const [activeSnagId, setActiveSnagId] = useState('');
  const [droppedSnagId, setDroppedSnagId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'drop' | null>(
    restoreForm === 'drop-snag' ? 'drop' : null,
  );
  const [across, setAcross] = useState(50);
  const [down, setDown] = useState(50);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [observedOn, setObservedOn] = useState(() => dateInZone(new Date(), HK_ZONE));
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState<Record<string, { s: number; y: number }>>({});
  const photoInput = useRef<HTMLInputElement | null>(null);
  const renderInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (restoreForm === 'drop-snag' && member) {
      const stored = readDraft(member.id, 'drop-snag');
      if (stored) {
        clearDraft(member.id, 'drop-snag');
        setTitle(String(stored.title ?? ''));
        setNote(String(stored.note ?? ''));
      }
    }
  }, [restoreForm, member]);

  const mayEdit =
    member?.role === 'director' || member?.role === 'project_lead' || member?.role === 'designer';
  const mayFix = mayEdit || member?.role === 'contractor';
  const list = (snags.data?.snags ?? []).map((snag) => {
    const shift = moved[snag.id];
    return shift ? { ...snag, s: shift.s, y: shift.y } : snag;
  });
  const active = list.find((snag) => snag.id === activeSnagId) ?? null;

  const renderUrl = chosen ? `/api/viewpoints/${chosen.id}/render` : '';
  const photoUrl = chosen ? `/api/viewpoints/${chosen.id}/photo` : '';

  const openDropSheet = (): void => {
    errors.clear();
    setAcross(seam);
    setDown(50);
    setSheet('drop');
  };

  const selectSnag = (id: string): void => {
    setActiveSnagId(id);
    const snag = list.find((entry) => entry.id === id);
    if (snag) setSeam(snag.s);
  };

  const pinSnag = async (): Promise<void> => {
    if (!chosen) return;
    setBusy(true);
    errors.clear();
    startPending(pending.pinSnag);
    try {
      const result = await request<{ snag: Snag }>(`/api/viewpoints/${chosen.id}/snags`, {
        body: { s: across, y: down, title, note, observedOn },
      });
      setSheet(null);
      setTitle('');
      setNote('');
      snags.reload();
      refresh();
      setDroppedSnagId(result.snag.id);
      say(success.snagPinned(result.snag.number, result.snag.s, result.snag.y));
      focusWhenReady(`[data-snag-id="${result.snag.id}"]`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, { draft: { formKey: 'drop-snag', values: { title, note } } });
      }
    } finally {
      setBusy(false);
    }
  };

  /** The marker moves at once; a refusal puts it back where it was saved. */
  const moveSnag = (id: string, s: number, y: number): void => {
    const original = snags.data?.snags.find((snag) => snag.id === id);
    if (!original) return;
    setMoved((current) => ({ ...current, [id]: { s, y } }));
    void (async () => {
      try {
        await request(`/api/snags/${id}`, { method: 'PATCH', body: { s, y } });
        snags.reload();
        setMoved((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        say(success.snagMoved(original.number));
      } catch (caught) {
        setMoved((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        if (caught instanceof ApiError && caught.code === 'illegal_transition') {
          problem(refusal.closedSnagMoved(original.number));
        } else {
          handleFailure(caught);
        }
      }
    })();
  };

  const transition = async (snag: Snag, action: SnagAction): Promise<void> => {
    setBusy(true);
    startPending(pending.snagTransition);
    try {
      const result = await request<{ snag: Snag }>(`/api/snags/${snag.id}/transitions`, {
        body: { action },
      });
      snags.reload();
      refresh();
      say(
        success.snagTransition(
          snag.number,
          SNAG_STATE_LABELS[result.snag.state].toLowerCase(),
        ),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(refusal.otherIllegal(SNAG_STATE_LABELS[snag.state].toLowerCase()));
      } else {
        handleFailure(caught);
      }
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (kind: 'photo' | 'render', file: File): Promise<void> => {
    if (!chosen) return;
    startPending(pending.uploadImage(file.name));
    const form = new FormData();
    form.set('file', file, file.name);
    try {
      await request(
        kind === 'photo'
          ? `/api/viewpoints/${chosen.id}/photos`
          : `/api/viewpoints/${chosen.id}/render`,
        { method: kind === 'photo' ? 'POST' : 'PUT', form },
      );
      viewpoints.reload();
      refresh();
      say(
        kind === 'photo'
          ? success.photoUploaded(file.name, chosen.name)
          : success.renderUploaded(file.name, chosen.name),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        problem(
          refusal.refusedUpload(
            file.name,
            caught.errors.file ?? fieldErrorCopy.unsupportedImage(file.name),
          ),
        );
      } else if (caught instanceof ApiError && caught.code === 'storage_unavailable') {
        problem(refusal.storageOutageUpload(file.name));
      } else {
        handleFailure(caught);
      }
    }
  };

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Site walk</h2>}
    >
      <div className="field">
        <label className="field-label" htmlFor={`${formId}-viewpoint`}>
          Viewpoint
        </label>
        <select
          id={`${formId}-viewpoint`}
          value={chosen?.id ?? ''}
          onChange={(event) => {
            setViewpointId(event.target.value);
            setActiveSnagId('');
          }}
        >
          {(viewpoints.data?.viewpoints ?? []).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {`${entry.name} · ${entry.storeCode}`}
            </option>
          ))}
        </select>
      </div>

      {chosen ? (
        <div className="site-walk">
          <div className="seam-column">
            <IntentSeam
              renderUrl={renderUrl}
              photoUrl={photoUrl}
              seam={seam}
              onSeamChange={setSeam}
              snags={list}
              activeSnagId={activeSnagId}
              onSelectSnag={selectSnag}
              onMoveSnag={moveSnag}
              onOpenDropSheet={openDropSheet}
              droppedSnagId={droppedSnagId}
              labelId={`${formId}-seam`}
            />
            {mayEdit ? (
              <div className="seam-presets">
                <button type="button" className="primary" onClick={openDropSheet}>
                  Drop snag here
                </button>
                <button type="button" onClick={() => photoInput.current?.click()}>
                  Upload site photo
                </button>
                <button type="button" onClick={() => renderInput.current?.click()}>
                  Upload render
                </button>
              </div>
            ) : null}
            <div className="field" hidden>
              <label className="field-label" htmlFor={`${formId}-photo`}>
                Site photo file
              </label>
              <input
                id={`${formId}-photo`}
                ref={photoInput}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadImage('photo', file);
                }}
              />
              <label className="field-label" htmlFor={`${formId}-render`}>
                Render file
              </label>
              <input
                id={`${formId}-render`}
                ref={renderInput}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadImage('render', file);
                }}
              />
            </div>
          </div>

          <div className="snag-column">
            <h3>Snags</h3>
            <ul className="snag-list" aria-label="Snags">
              {list.map((snag) => {
                const near = isNearSeam(snag.s, seam);
                return (
                  <li key={snag.id}>
                    <button
                      type="button"
                      className="snag-card"
                      aria-pressed={activeSnagId === snag.id}
                      onClick={() => selectSnag(snag.id)}
                    >
                      <span>{`Snag ${snag.number}`}</span>
                      <span>
                        {SNAG_STATE_LABELS[snag.state]}
                        <Shape name={SNAG_STATE_SHAPES[snag.state]} />
                      </span>
                      <span>{snag.title}</span>
                      {near ? <span>Near seam</span> : null}
                    </button>
                    <p className="meta">{snag.note === '' ? 'No note' : snag.note}</p>
                  </li>
                );
              })}
            </ul>

            {active ? (
              <div className="row-actions">
                {mayFix && (active.state === 'open' || active.state === 'reopened') ? (
                  <ActionButton
                    busy={busy}
                    pendingLabel={pending.snagTransition}
                    onPress={() => void transition(active, 'fix')}
                  >
                    Mark fixed
                  </ActionButton>
                ) : null}
                {mayEdit && active.state === 'fixed' ? (
                  <ActionButton
                    busy={busy}
                    pendingLabel={pending.snagTransition}
                    onPress={() => void transition(active, 'close')}
                  >
                    Close snag
                  </ActionButton>
                ) : null}
                {mayEdit && (active.state === 'fixed' || active.state === 'closed') ? (
                  <ActionButton
                    busy={busy}
                    pendingLabel={pending.snagTransition}
                    onPress={() => void transition(active, 'reopen')}
                  >
                    Reopen snag
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="meta">This project has no viewpoint yet.</p>
      )}

      {mayEdit ? (
        <div className="sticky-bar">
          <button type="button" className="primary" onClick={openDropSheet}>
            Drop snag here
          </button>
        </div>
      ) : null}

      {sheet === 'drop' ? (
        <Dialog
          title="Drop snag"
          onClose={() => setSheet(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.pinSnag}
                onPress={() => void pinSnag()}
              >
                Pin snag
              </ActionButton>
              <button type="button" onClick={() => setSheet(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field formId={formId} path="s" label="Across" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="number"
                min={0}
                max={100}
                step={1}
                value={across}
                onChange={(event) => setAcross(Number(event.target.value))}
              />
            )}
          </Field>
          <Field formId={formId} path="y" label="Height" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="number"
                min={0}
                max={100}
                step={1}
                value={down}
                onChange={(event) => setDown(Number(event.target.value))}
              />
            )}
          </Field>
          <Field formId={formId} path="title" label="Snag title" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </Field>
          <Field formId={formId} path="note" label="Note" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          <Field
            formId={formId}
            path="observedOn"
            label="Observed on"
            errors={errors.errors}
            hint="Written as YYYY-MM-DD."
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={observedOn}
                onChange={(event) => setObservedOn(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </Panel>
  );
}
