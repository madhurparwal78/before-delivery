import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ContactRef, FeatureSummary, Importance, Insight, Note } from '../../shared/types';
import type { HighlightSpan } from '../../shared/segments';
import { formatZonedDateTime } from '../../shared/format';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { IMPORTANCE_LABELS, SOURCE_LABELS } from '../labels';
import { HighlightedBody, parseNoteBody } from './HighlightedBody';
import { Dialog, FieldError } from './Dialog';
import { Link } from '../router';

export interface PendingSelection {
  start: number;
  end: number;
  quote: string;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Turns a DOM selection inside the note body into offsets in the plain text. */
export function selectionOffsets(container: HTMLElement, text: string): PendingSelection | null {
  const selection = getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const lead = document.createRange();
  lead.setStart(container, 0);
  lead.setEnd(range.startContainer, range.startOffset);
  let start = lead.toString().length;
  let end = start + range.toString().length;
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;
  if (end > text.length) end = text.length;
  const quote = text.slice(start, end);
  if (start >= end || quote.trim() === '') return null;
  return { start, end, quote };
}

export interface NoteReaderProps {
  note: Note;
  contacts: ContactRef[];
  features: FeatureSummary[];
  onNoteChanged: (note: Note) => void;
  onNoteDeleted: () => void;
  onLinked: (insight: Insight, feature: FeatureSummary, before: { impact: number; rank: number | null }) => void;
  onUnlinked: (insight: Insight, feature: FeatureSummary, before: { impact: number; rank: number | null }) => void;
  bodyRef: React.RefObject<HTMLDivElement>;
  dragStart: (point: { x: number; y: number }, selection: PendingSelection) => void;
  linkRequest: { featureId: string; selection: PendingSelection } | null;
  onLinkRequestHandled: () => void;
}

export function NoteReader(props: NoteReaderProps): JSX.Element {
  const { note, contacts, features, onNoteChanged, onNoteDeleted, onLinked, onUnlinked, bodyRef } = props;
  const app = useApp();
  const doc = useMemo(() => parseNoteBody(note.body), [note.body]);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<'link' | 'snooze' | 'edit' | 'delete' | null>(null);
  const [popover, setPopover] = useState<string[] | null>(null);
  const linkButton = useRef<HTMLButtonElement>(null);

  const clearPending = useCallback(() => {
    setPending(null);
    setToolbar(null);
  }, []);

  const spans: HighlightSpan[] = useMemo(() => {
    const saved = note.insights.map((insight) => ({
      insightId: insight.id,
      start: insight.start,
      end: insight.end,
    }));
    return pending === null
      ? saved
      : [...saved, { insightId: null, start: pending.start, end: pending.end }];
  }, [note.insights, pending]);

  const readSelection = useCallback(() => {
    const container = bodyRef.current;
    if (container === null) return;
    const found = selectionOffsets(container, doc.text);
    if (found === null) return;
    setPending(found);
    const rect = getSelection()?.getRangeAt(0).getBoundingClientRect();
    if (rect) {
      setToolbar({
        x: Math.min(Math.max(rect.left + rect.width / 2, 120), innerWidth - 120),
        y: Math.max(rect.top, 56),
      });
    }
    // The quote shortcut and the dialog both belong to the reading column.
    if (!container.contains(document.activeElement)) container.focus({ preventScroll: true });
  }, [bodyRef, doc.text]);

  useEffect(() => {
    clearPending();
  }, [note.id, clearPending]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        clearPending();
        return;
      }
      if ((event.key === 'l' || event.key === 'L') && pending !== null && dialog === null) {
        const target = event.target as HTMLElement | null;
        if (target && (target.isContentEditable || target.closest('input, textarea, [role="dialog"]'))) return;
        event.preventDefault();
        setDialog('link');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, dialog, clearPending]);

  useEffect(() => {
    if (note.attachments.every((attachment) => attachment.status === 'available')) return;
    const timer = window.setInterval(() => {
      void request<{ note: Note }>(`/api/notes/${note.id}`)
        .then((data) => onNoteChanged(data.note))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [note.id, note.attachments, onNoteChanged]);

  const commitLink = useCallback(
    async (featureId: string, importance: Importance, selection: PendingSelection) => {
      app.setPending('Linking…');
      try {
        const result = await request<{
          insight: Insight;
          feature: FeatureSummary;
          before: { impact: number; priority: number; rank: number | null };
        }>('/api/insights', {
          method: 'POST',
          body: { noteId: note.id, featureId, start: selection.start, end: selection.end, importance },
        });
        app.setSaveStatus('');
        onLinked(result.insight, result.feature, result.before);
        clearPending();
      } catch (error) {
        if (error instanceof ApiError) app.setAlert(error.message);
        clearPending();
      }
    },
    [app, note.id, onLinked, clearPending],
  );

  const { linkRequest, onLinkRequestHandled } = props;
  useEffect(() => {
    if (linkRequest === null) return;
    onLinkRequestHandled();
    void commitLink(linkRequest.featureId, 'important', linkRequest.selection);
  }, [linkRequest, onLinkRequestHandled, commitLink]);

  const unlink = async (insight: Insight): Promise<void> => {
    try {
      const result = await request<{
        feature: FeatureSummary;
        before: { impact: number; priority: number; rank: number | null };
      }>(`/api/insights/${insight.id}`, { method: 'DELETE' });
      setPopover(null);
      onUnlinked(insight, result.feature, result.before);
    } catch (error) {
      if (error instanceof ApiError) app.setAlert(error.message);
    }
  };

  const changeStatus = async (to: 'processed' | 'unprocessed'): Promise<void> => {
    try {
      const result = await request<{ note: Note }>(`/api/notes/${note.id}/status`, {
        method: 'POST',
        body: { to },
      });
      onNoteChanged(result.note);
      app.setSaveStatus(to === 'processed' ? 'Marked processed.' : 'Moved back to Unprocessed.');
    } catch (error) {
      if (error instanceof ApiError) app.setAlert(error.message);
    }
  };

  const insightsById = new Map(note.insights.map((insight) => [insight.id, insight]));
  const received = note.receivedOn ?? note.createdAt.slice(0, 10);

  return (
    <article className="reader" aria-label="Note">
      <h2 className="display">{note.title}</h2>
      <dl className="note-meta">
        <div>
          <dt>Source</dt>
          <dd>{SOURCE_LABELS[note.source]}</dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{note.contact?.name ?? 'No contact'}</dd>
        </div>
        <div>
          <dt>Company</dt>
          <dd>
            {note.company ? <Link to={`/companies/${note.company.id}`}>{note.company.name}</Link> : '—'}
          </dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{received}</dd>
        </div>
      </dl>

      <div className="note-actions">
        {note.status === 'processed' ? (
          <button type="button" className="button" onClick={() => void changeStatus('unprocessed')}>
            Reopen
          </button>
        ) : (
          <button type="button" className="button" onClick={() => void changeStatus('processed')}>
            Mark processed
          </button>
        )}
        <button type="button" className="button" onClick={() => setDialog('snooze')}>
          Snooze
        </button>
        <button type="button" className="button" onClick={() => setDialog('edit')}>
          Edit note
        </button>
        <button type="button" className="button" onClick={() => setDialog('delete')}>
          Delete note
        </button>
      </div>

      <div
        className="note-body"
        ref={bodyRef}
        tabIndex={0}
        onMouseUp={readSelection}
        onKeyUp={(event) => {
          if (event.shiftKey || event.key === 'Shift') readSelection();
        }}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          const mark = target.closest('mark[data-pending="true"]');
          if (mark !== null && pending !== null) {
            event.preventDefault();
            props.dragStart({ x: event.clientX, y: event.clientY }, pending);
          }
        }}
      >
        <HighlightedBody
          doc={doc}
          spans={spans}
          tickFor={(insightId) => {
            const insight = insightsById.get(insightId);
            if (!insight) return null;
            return (
              <span className="tick" role="img" aria-label={`Linked to ${insight.featureName}`}>
                <Check aria-hidden="true" size={13} />
              </span>
            );
          }}
          onMarkClick={(segment) => setPopover(segment.insightIds)}
        />
      </div>

      {toolbar !== null && pending !== null ? (
        <div className="selection-toolbar" style={{ left: toolbar.x, top: toolbar.y }}>
          <button type="button" className="button accent" ref={linkButton} onClick={() => setDialog('link')}>
            Link to feature · L
          </button>
        </div>
      ) : null}

      {popover !== null ? (
        <div className="popover" role="group" aria-label="Linked features">
          {popover.map((insightId) => {
            const insight = insightsById.get(insightId);
            if (!insight) return null;
            return (
              <div key={insightId} className="popover-row">
                <span>
                  {insight.featureName} · {IMPORTANCE_LABELS[insight.importance]}
                </span>
                <button type="button" className="button quiet" onClick={() => void unlink(insight)}>
                  Unlink {insight.featureName}
                </button>
              </div>
            );
          })}
          <button type="button" className="button quiet" onClick={() => setPopover(null)}>
            Close
          </button>
        </div>
      ) : null}

      <section className="linked-evidence">
        <h3>Linked evidence</h3>
        <ul aria-label="Linked evidence">
          {note.insights.map((insight) => (
            <li key={insight.id}>
              <blockquote>{insight.quote}</blockquote>
              <span className="evidence-feature">{insight.featureName}</span>
              <span className="evidence-importance">{IMPORTANCE_LABELS[insight.importance]}</span>
              <button type="button" className="button quiet" onClick={() => void unlink(insight)}>
                Unlink {insight.featureName}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="attachments">
        <h3>Attachments</h3>
        <ul aria-label="Attachments">
          {note.attachments.map((attachment) => (
            <li key={attachment.id}>
              {attachment.status === 'available' ? (
                <a href={`/api/attachments/${attachment.id}`}>{attachment.filename}</a>
              ) : (
                <span>{attachment.filename} — Pending upload</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {dialog === 'link' && pending !== null ? (
        <LinkDialog
          quote={pending.quote}
          features={features}
          onCancel={() => {
            setDialog(null);
            clearPending();
            bodyRef.current?.focus();
          }}
          onLink={(featureId, importance) => {
            setDialog(null);
            void commitLink(featureId, importance, pending);
            bodyRef.current?.focus();
          }}
        />
      ) : null}

      {dialog === 'snooze' ? (
        <SnoozeDialog
          noteId={note.id}
          timeZone={app.workspace?.timeZone ?? 'UTC'}
          onClose={() => setDialog(null)}
          onSnoozed={(updated) => {
            setDialog(null);
            onNoteChanged(updated);
            app.setSaveStatus(
              `Snoozed until ${formatZonedDateTime(updated.snoozedUntil as string, app.workspace?.timeZone ?? 'UTC')}.`,
            );
          }}
        />
      ) : null}

      {dialog === 'edit' ? (
        <EditNoteDialog
          note={note}
          contacts={contacts}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null);
            onNoteChanged(updated);
            app.setSaveStatus('Note updated.');
          }}
        />
      ) : null}

      {dialog === 'delete' ? (
        <Dialog label="Delete note?" role="alertdialog" onClose={() => setDialog(null)}>
          <p>This also removes its {note.insights.length} linked insights.</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button accent"
              onClick={() => {
                app.setPending('Deleting note…');
                void request(`/api/notes/${note.id}`, { method: 'DELETE' }).then(() => {
                  setDialog(null);
                  app.setSaveStatus('Note deleted.');
                  onNoteDeleted();
                });
              }}
            >
              Delete
            </button>
            <button type="button" className="button" onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </article>
  );
}

function LinkDialog({
  quote,
  features,
  onCancel,
  onLink,
}: {
  quote: string;
  features: FeatureSummary[];
  onCancel: () => void;
  onLink: (featureId: string, importance: Importance) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FeatureSummary[]>(features);
  const [featureId, setFeatureId] = useState(features[0]?.id ?? '');
  const [importance, setImportance] = useState<Importance>('important');

  useEffect(() => {
    const trimmed = query.trim();
    const timer = window.setTimeout(() => {
      void request<{ features: FeatureSummary[] }>(
        `/api/features${trimmed === '' ? '' : `?q=${encodeURIComponent(trimmed)}`}`,
      )
        .then((data) => {
          setMatches(data.features);
          setFeatureId((current) =>
            data.features.some((feature) => feature.id === current) ? current : data.features[0]?.id ?? '',
          );
        })
        .catch(() => undefined);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  const activeIndex = matches.findIndex((feature) => feature.id === featureId);

  return (
    <Dialog label="Link quote to feature" onClose={onCancel}>
      <blockquote className="dialog-quote">{quote}</blockquote>
      <div className="field">
        <label htmlFor="link-feature">Feature</label>
        <input
          id="link-feature"
          role="combobox"
          type="text"
          aria-label="Feature"
          aria-expanded={matches.length > 0}
          aria-controls="link-feature-options"
          aria-autocomplete="list"
          aria-activedescendant={featureId === '' ? undefined : `link-option-${featureId}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setFeatureId(matches[Math.min(activeIndex + 1, matches.length - 1)]?.id ?? featureId);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setFeatureId(matches[Math.max(activeIndex - 1, 0)]?.id ?? featureId);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (featureId !== '') onLink(featureId, importance);
            }
          }}
        />
        <ul role="listbox" id="link-feature-options" aria-label="Features" className="option-list">
          {matches.map((feature) => (
            <li
              key={feature.id}
              id={`link-option-${feature.id}`}
              role="option"
              aria-selected={feature.id === featureId}
              className={feature.id === featureId ? 'option active' : 'option'}
              onMouseDown={(event) => {
                event.preventDefault();
                setFeatureId(feature.id);
              }}
            >
              {feature.name}
            </li>
          ))}
        </ul>
      </div>
      <fieldset className="field">
        <legend>Importance</legend>
        <div role="radiogroup" aria-label="Importance">
          {(Object.keys(IMPORTANCE_LABELS) as Importance[]).map((value) => (
            <label key={value} className="radio">
              <input
                type="radio"
                name="importance"
                value={value}
                checked={importance === value}
                onChange={() => setImportance(value)}
              />
              {IMPORTANCE_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="dialog-actions">
        <button
          type="button"
          className="button accent"
          disabled={featureId === ''}
          onClick={() => onLink(featureId, importance)}
        >
          Link quote
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function SnoozeDialog({
  noteId,
  timeZone,
  onClose,
  onSnoozed,
}: {
  noteId: string;
  timeZone: string;
  onClose: () => void;
  onSnoozed: (note: Note) => void;
}): JSX.Element {
  const app = useApp();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Dialog label="Snooze note" onClose={onClose}>
      <div className="field">
        <label htmlFor="snooze-until">Snooze until</label>
        <input
          id="snooze-until"
          type="datetime-local"
          aria-label="Snooze until"
          aria-describedby="snooze-error snooze-zone"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p id="snooze-zone" className="hint">
          {timeZone}
        </p>
        <FieldError id="snooze-error" message={error} />
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button accent"
          onClick={() => {
            app.setPending('Snoozing…');
            void request<{ note: Note }>(`/api/notes/${noteId}/snooze`, {
              method: 'POST',
              body: { until: value.slice(0, 16) },
            })
              .then((data) => onSnoozed(data.note))
              .catch((caught: unknown) => {
                if (caught instanceof ApiError) {
                  setError(caught.fields.until ?? caught.message);
                  app.setSaveStatus('');
                }
              });
          }}
        >
          Snooze note
        </button>
      </div>
    </Dialog>
  );
}

function EditNoteDialog({
  note,
  contacts,
  onClose,
  onSaved,
}: {
  note: Note;
  contacts: ContactRef[];
  onClose: () => void;
  onSaved: (note: Note) => void;
}): JSX.Element {
  const app = useApp();
  const [title, setTitle] = useState(note.title);
  const [contactId, setContactId] = useState(note.contact?.id ?? '');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (bodyRef.current !== null) bodyRef.current.innerHTML = note.body;
  }, [note.body]);

  return (
    <Dialog label="Edit note" onClose={onClose}>
      <div className="field">
        <label htmlFor="edit-title">Title</label>
        <input
          id="edit-title"
          type="text"
          aria-label="Title"
          aria-describedby="edit-title-error"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <FieldError id="edit-title-error" message={errors.title} />
      </div>
      <div className="field">
        <label htmlFor="edit-body">Note body</label>
        <div
          id="edit-body"
          ref={bodyRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Note body"
          aria-describedby="edit-body-error"
          contentEditable
          suppressContentEditableWarning
          className="rich-input"
        />
        <FieldError id="edit-body-error" message={errors.body} />
      </div>
      <div className="field">
        <label htmlFor="edit-contact">Contact</label>
        <select
          id="edit-contact"
          aria-label="Contact"
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
        >
          <option value="">No contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button accent"
          onClick={() => {
            app.setPending('Saving changes…');
            void request<{ note: Note }>(`/api/notes/${note.id}`, {
              method: 'PATCH',
              body: {
                title,
                body: bodyRef.current?.innerHTML ?? '',
                contactId: contactId === '' ? null : contactId,
              },
            })
              .then((data) => onSaved(data.note))
              .catch((caught: unknown) => {
                if (!(caught instanceof ApiError)) return;
                app.setSaveStatus('');
                if (caught.code === 'highlight_conflict') {
                  const count = caught.detail.insightIds?.length ?? 0;
                  app.setAlert(
                    `This edit removes highlighted text from ${count} linked insights.` +
                      ' Unlink them first or keep that text.',
                  );
                  return;
                }
                if (caught.status === 422) setErrors(caught.fields);
                else app.setAlert(caught.message);
              });
          }}
        >
          Save changes
        </button>
      </div>
    </Dialog>
  );
}
