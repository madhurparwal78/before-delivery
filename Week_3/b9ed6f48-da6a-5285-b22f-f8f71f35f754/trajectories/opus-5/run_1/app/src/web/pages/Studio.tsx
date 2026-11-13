import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { Dialog, ErrorSummary } from '../components/Dialog.js';
import {
  STATUS_LABELS,
  copy,
  messageFor,
  movedNotice,
  uploadComplete,
  uploadPending,
  type ItemStatus,
} from '../../shared/copy.js';
import { TRANSITIONS, TRANSITION_LABELS, actorKindFor, judgeTransition } from '../../shared/lifecycle.js';
import { wallEntryToIso } from '../../shared/lisbon.js';
import type { ChapterSummary, CuratorItem } from '../../shared/types.js';

const STATUSES: ItemStatus[] = ['draft', 'review', 'scheduled', 'published', 'withdrawn'];

interface ItemsResponse {
  items: CuratorItem[];
}

function NewEventDialog({
  chapters,
  onClose,
  onSaved,
}: {
  chapters: ChapterSummary[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { announce } = useStore();
  const [chapter, setChapter] = useState(chapters[0]?.number ?? 1);
  const [year, setYear] = useState(1950);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <Dialog title="New timeline event" onClose={onClose}>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{ chapter: 'event-chapter', year: 'event-year', title: 'event-title', summary: 'event-summary' }}
      />
      <div className="field">
        <label htmlFor="event-chapter">Chapter</label>
        <select
          id="event-chapter"
          aria-label="Chapter"
          value={String(chapter)}
          onChange={(event) => setChapter(Number(event.target.value))}
        >
          {chapters.map((entry) => (
            <option key={entry.number} value={String(entry.number)}>
              {`Chapter ${entry.numeral}`}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="event-year">Year</label>
        <input
          id="event-year"
          type="number"
          aria-label="Year"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
        />
        {fields.year ? <span className="field-error">{fields.year}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="event-title">Title</label>
        <input
          id="event-title"
          type="text"
          aria-label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {fields.title ? <span className="field-error">{fields.title}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="event-summary">Summary</label>
        <textarea
          id="event-summary"
          aria-label="Summary"
          rows={3}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
        {fields.summary ? <span className="field-error">{fields.summary}</span> : null}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setFields({});
            void api<{ item: CuratorItem }>('/api/curator/events', {
              method: 'POST',
              body: { chapter, year, title, summary, source_ids: [] },
            })
              .then(() => {
                announce(copy.draftSaved);
                onSaved();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Save draft
        </button>
      </div>
    </Dialog>
  );
}

function ScheduleDialog({
  item,
  onClose,
  onDone,
}: {
  item: CuratorItem;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { announce } = useStore();
  const [entry, setEntry] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <Dialog title="Schedule" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ publish_at: 'schedule-at' }} />
      <div className="field">
        <label htmlFor="schedule-at">Publish at (Lisbon time)</label>
        <input
          id="schedule-at"
          type="text"
          aria-label="Publish at (Lisbon time)"
          placeholder="2026-11-14 18:30:05"
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
        />
        {fields.publish_at ? <span className="field-error">{fields.publish_at}</span> : null}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setFields({});
            const converted = wallEntryToIso(entry);
            if (converted.kind === 'skipped') {
              setFields({ publish_at: copy.skippedTime });
              return;
            }
            if (converted.kind === 'format') {
              setFields({ publish_at: copy.timeAfterNow });
              return;
            }
            void api(`/api/curator/items/${item.id}/transitions`, {
              method: 'POST',
              body: { to: 'scheduled', publish_at: converted.iso },
            })
              .then(() => {
                announce(movedNotice(STATUS_LABELS.scheduled));
                onDone();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Schedule
        </button>
      </div>
    </Dialog>
  );
}

function WithdrawDialog({
  item,
  onClose,
  onDone,
}: {
  item: CuratorItem;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { announce } = useStore();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <Dialog title="Withdraw" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ reason: 'withdraw-reason' }} />
      <div className="field">
        <label htmlFor="withdraw-reason">Reason</label>
        <textarea
          id="withdraw-reason"
          aria-label="Reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {fields.reason ? <span className="field-error">{fields.reason}</span> : null}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setFields({});
            void api(`/api/curator/items/${item.id}/transitions`, {
              method: 'POST',
              body: { to: 'withdrawn', reason },
            })
              .then(() => {
                announce(movedNotice(STATUS_LABELS.withdrawn));
                onDone();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Withdraw
        </button>
      </div>
    </Dialog>
  );
}

function UploadForm({ items, onDone }: { items: CuratorItem[]; onDone: () => void }): JSX.Element {
  const [kind, setKind] = useState('image');
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  return (
    <form
      aria-label="Upload media"
      onSubmit={(event) => {
        event.preventDefault();
        if (!file) {
          setFields({ file: copy.uploadType });
          return;
        }
        setMessage(null);
        setFields({});
        setStatus(uploadPending(file.name));
        const form = new FormData();
        form.set('file', file);
        form.set('kind', kind);
        form.set('item_id', itemId);
        form.set('transcript', transcript);
        void api('/api/curator/media', { method: 'POST', form })
          .then(() => {
            setStatus(uploadComplete(file.name));
            onDone();
          })
          .catch((error: unknown) => {
            setStatus('');
            if (error instanceof ApiError) {
              setMessage(error.message);
              setFields(error.fields);
            }
          });
      }}
    >
      <h2>Upload media</h2>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{ file: 'upload-file', transcript: 'upload-transcript', kind: 'upload-kind' }}
      />
      <div className="field">
        <label htmlFor="upload-kind">Kind</label>
        <select id="upload-kind" aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="narration">Narration</option>
          <option value="image">Image</option>
          <option value="scan">Scan</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="upload-item">Item</label>
        <select id="upload-item" aria-label="Item" value={itemId} onChange={(event) => setItemId(event.target.value)}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="upload-file">File</label>
        <input
          id="upload-file"
          type="file"
          aria-label="File"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {fields.file ? <span className="field-error">{fields.file}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="upload-transcript">Transcript</label>
        <textarea
          id="upload-transcript"
          aria-label="Transcript"
          rows={3}
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
        {fields.transcript ? <span className="field-error">{fields.transcript}</span> : null}
      </div>
      <div className="inline-actions">
        <button type="submit">Upload</button>
      </div>
      <p role="status" aria-label="Upload status" className="readout">
        {status}
      </p>
    </form>
  );
}

export function Studio({ chapters }: { chapters: ChapterSummary[] }): JSX.Element {
  const { user, announce } = useStore();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const query = `/api/curator/items?type=${type}&status=${status}`;
  const items = useResource<ItemsResponse>(query);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [scheduling, setScheduling] = useState<CuratorItem | null>(null);
  const [withdrawing, setWithdrawing] = useState<CuratorItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!user || (user.role !== 'curator' && user.role !== 'lead_curator')) {
    return (
      <>
        <h1>The studio</h1>
        <p className="secondary">{messageFor('forbidden')}</p>
      </>
    );
  }

  const allItems = items.data?.items ?? [];

  function move(item: CuratorItem, to: ItemStatus): void {
    setMessage(null);
    void api(`/api/curator/items/${item.id}/transitions`, { method: 'POST', body: { to } })
      .then(() => {
        announce(movedNotice(STATUS_LABELS[to]));
        items.reload();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError) setMessage(error.message);
      });
  }

  return (
    <>
      <h1>The studio</h1>
      {message ? (
        <div role="alert" className="alert">
          <p>{message}</p>
        </div>
      ) : null}
      <div className="columns">
        <div className="field">
          <label htmlFor="studio-type">Type</label>
          <select id="studio-type" aria-label="Type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            <option value="chapter">Chapters</option>
            <option value="event">Events</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="studio-status">Status</label>
          <select
            id="studio-status"
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {STATUS_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="inline-actions">
        <button type="button" onClick={() => setNewEventOpen(true)}>
          New event
        </button>
      </div>

      <div className="table-scroll">
        <table aria-label="Items">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Owner</th>
              <th scope="col">Moves</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item) => {
              const actor = actorKindFor(user.role, item.owner_email, user.email);
              return (
                <tr key={item.id}>
                  <th scope="row">{item.title}</th>
                  <td>{item.type}</td>
                  <td>{STATUS_LABELS[item.status]}</td>
                  <td className="secondary">{item.owner_email}</td>
                  <td>
                    <div className="inline-actions">
                      {TRANSITIONS.filter((rule) => rule.from === item.status).map((rule) => {
                        const verdict = judgeTransition(item.status, rule.to, actor);
                        if (verdict.kind !== 'allowed') return null;
                        const label = TRANSITION_LABELS[`${rule.from}>${rule.to}`] as string;
                        return (
                          <button
                            key={rule.to}
                            type="button"
                            onClick={() => {
                              if (rule.needsPublishAt) setScheduling(item);
                              else if (rule.needsReason) setWithdrawing(item);
                              else move(item, rule.to);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {chapters.map((chapter) => {
        const chapterEvents = allItems.filter(
          (item) => item.type === 'event' && item.chapter === chapter.number && item.status === 'published',
        );
        return (
          <section key={chapter.number} aria-label={`Chapter ${chapter.numeral} events`}>
            <h2 style={{ fontSize: 'var(--step-2)' }}>{`Chapter ${chapter.numeral} events`}</h2>
            {chapterEvents.length === 0 ? (
              <p className="secondary">{copy.emptyChapterEvents}</p>
            ) : (
              <ul>
                {chapterEvents.map((item) => (
                  <li key={item.id}>{item.title}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <UploadForm items={allItems} onDone={() => items.reload()} />

      {newEventOpen ? (
        <NewEventDialog
          chapters={chapters}
          onClose={() => setNewEventOpen(false)}
          onSaved={() => items.reload()}
        />
      ) : null}
      {scheduling ? (
        <ScheduleDialog item={scheduling} onClose={() => setScheduling(null)} onDone={() => items.reload()} />
      ) : null}
      {withdrawing ? (
        <WithdrawDialog item={withdrawing} onClose={() => setWithdrawing(null)} onDone={() => items.reload()} />
      ) : null}
    </>
  );
}
