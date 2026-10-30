import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Attachment,
  Company,
  ContactRef,
  FeatureSummary,
  HierarchyResponse,
  Insight,
  Note,
  NoteListItem,
  NoteListResponse,
  NoteSource,
  NoteStatus,
} from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp, usePrefersReducedMotion } from '../app-state';
import { Dialog, FieldError } from '../components/Dialog';
import { DragThread, EvidenceThread, type Point } from '../components/EvidenceThread';
import { HierarchyRail } from '../components/HierarchyRail';
import { NoteReader, type PendingSelection } from '../components/NoteReader';
import { COUNT_MS, QUICK_MS, THREAD_MS } from '../motion';
import { SOURCE_LABELS } from '../labels';
import { navigate, useRoute } from '../router';

const FILTERS: { status: NoteStatus; label: string }[] = [
  { status: 'unprocessed', label: 'Unprocessed' },
  { status: 'snoozed', label: 'Snoozed' },
  { status: 'processed', label: 'Processed' },
];

/** The three sources a member may log by hand; csv_import is set by the importer. */
const SOURCE_OPTIONS: NoteSource[] = ['support_ticket', 'sales_call', 'email'];

/** The inbox list is paged, so the oldest notes are reached with "Load more notes". */
const PAGE_SIZE = 5;

const PANES = ['Inbox', 'Note', 'Hierarchy'] as const;
type Pane = (typeof PANES)[number];

function isAfter(a: NoteListItem, b: NoteListItem): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

export function Inbox(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const reduced = usePrefersReducedMotion();
  const noteId = route.startsWith('/inbox/') ? route.slice('/inbox/'.length) : null;

  const [filter, setFilter] = useState<NoteStatus>('unprocessed');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState({ unprocessed: 0, snoozed: 0, processed: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [hierarchy, setHierarchy] = useState<HierarchyResponse | null>(null);
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [contacts, setContacts] = useState<ContactRef[]>([]);
  const [pane, setPane] = useState<Pane>('Inbox');
  const [narrow, setNarrow] = useState(() => innerWidth < 900);
  const [logOpen, setLogOpen] = useState(false);
  const [linkedFeatureId, setLinkedFeatureId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ from: Point; to: Point; name: string; fading: boolean } | null>(null);
  const [drag, setDrag] = useState<{ from: Point; to: Point; selection: PendingSelection } | null>(null);
  const [linkRequest, setLinkRequest] = useState<{ featureId: string; selection: PendingSelection } | null>(
    null,
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const loadMoreButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onResize = (): void => setNarrow(innerWidth < 900);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  const loadHierarchy = useCallback(async () => {
    const [tree, picker] = await Promise.all([
      request<HierarchyResponse>('/api/hierarchy'),
      request<{ features: FeatureSummary[] }>('/api/features'),
    ]);
    setHierarchy(tree);
    setFeatures(picker.features);
  }, []);

  useEffect(() => {
    void loadHierarchy();
    void request<{ companies: Company[] }>('/api/companies').then((data) =>
      setContacts(data.companies.flatMap((company) => company.contacts)),
    );
  }, [loadHierarchy]);

  const loadFirstPage = useCallback(
    async (status: NoteStatus, replace: boolean) => {
      const data = await request<NoteListResponse>(`/api/notes?status=${status}&limit=${PAGE_SIZE}`);
      setCounts(data.counts);
      if (replace) {
        setNotes(data.notes);
        setCursor(data.nextCursor);
        return;
      }
      setNotes((current) => {
        const known = new Map(current.map((item) => [item.id, item]));
        const merged = [...current];
        for (const incoming of data.notes) {
          const index = merged.findIndex((item) => item.id === incoming.id);
          if (index !== -1) {
            merged[index] = incoming;
            continue;
          }
          if (!known.has(incoming.id)) {
            const at = merged.findIndex((item) => isAfter(item, incoming));
            if (at === -1) merged.push(incoming);
            else merged.splice(at, 0, incoming);
          }
        }
        return merged;
      });
    },
    [],
  );

  useEffect(() => {
    void loadFirstPage(filter, true);
  }, [filter, loadFirstPage]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadFirstPage(filter, false), 30000);
    return () => window.clearInterval(timer);
  }, [filter, loadFirstPage]);

  useEffect(() => {
    setLinkedFeatureId(null);
    if (noteId === null) {
      setNote(null);
      return;
    }
    void request<{ note: Note }>(`/api/notes/${noteId}`)
      .then((data) => {
        setNote(data.note);
        setPane('Note');
      })
      .catch(() => setNote(null));
  }, [noteId]);

  const loadMore = async (): Promise<void> => {
    if (cursor === null) return;
    setLoadingMore(true);
    try {
      const data = await request<NoteListResponse>(
        `/api/notes?status=${filter}&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      );
      const firstNewId = data.notes[0]?.id;
      setNotes((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...data.notes.filter((item) => !known.has(item.id))];
      });
      setCursor(data.nextCursor);
      setCounts(data.counts);
      if (data.nextCursor === null && firstNewId !== undefined) {
        requestAnimationFrame(() => {
          const option = document.getElementById(`note-option-${firstNewId}`);
          if (option instanceof HTMLElement) option.focus();
        });
      } else {
        requestAnimationFrame(() => loadMoreButton.current?.focus());
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        app.setAlert('The inbox changed filter. Showing the first page again.');
        await loadFirstPage(filter, true);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const railVisible = !narrow || pane === 'Hierarchy';

  const announceLink = (
    verb: 'Linked to' | 'Unlinked from',
    feature: FeatureSummary,
    before: { impact: number },
  ): void => {
    app.announceEvidence(
      `${verb} ${feature.name}; impact ${before.impact} → ${feature.impact}; ` +
        `now rank ${feature.rank ?? 0} of ${feature.rankTotal}`,
    );
  };

  const runThread = (feature: FeatureSummary, insightId: string): void => {
    if (reduced || narrow) {
      setLinkedFeatureId(feature.id);
      void loadHierarchy();
      return;
    }
    requestAnimationFrame(() => {
      const marks = bodyRef.current?.querySelectorAll<HTMLElement>(
        `mark[data-insights~="${insightId}"]`,
      );
      const lastMark = marks && marks.length > 0 ? marks[marks.length - 1] : null;
      const row = rowRefs.current.get(feature.id) ?? null;
      if (lastMark === null || row === null) {
        void loadHierarchy();
        return;
      }
      const markRect = lastMark.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      setThread({
        from: { x: markRect.right, y: markRect.top + markRect.height / 2 },
        to: { x: rowRect.left, y: rowRect.top + rowRect.height / 2 },
        name: feature.name,
        fading: false,
      });
      window.setTimeout(() => void loadHierarchy(), THREAD_MS);
      window.setTimeout(() => setThread((current) => (current ? { ...current, fading: true } : null)), THREAD_MS + COUNT_MS);
      window.setTimeout(() => setThread(null), THREAD_MS + COUNT_MS + QUICK_MS);
    });
  };

  useEffect(() => {
    if (drag === null) return;
    const onMove = (event: MouseEvent): void =>
      setDrag((current) => (current ? { ...current, to: { x: event.clientX, y: event.clientY } } : null));
    const onUp = (): void => setDrag(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  return (
    <main className={narrow ? 'inbox narrow' : 'inbox'}>
      {narrow ? (
        <div role="tablist" aria-label="Panes" className="pane-tabs">
          {PANES.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={pane === item}
              className={pane === item ? 'tab current' : 'tab'}
              onClick={() => setPane(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {!narrow || pane === 'Inbox' ? (
        <section className="note-list" aria-label="Inbox">
          <div role="tablist" aria-label="Inbox filter" className="filter-tabs">
            {FILTERS.map((item) => (
              <button
                key={item.status}
                type="button"
                role="tab"
                aria-selected={filter === item.status}
                className={filter === item.status ? 'tab current' : 'tab'}
                onClick={() => setFilter(item.status)}
              >
                {item.label} <span className="figure">{counts[item.status]}</span>
              </button>
            ))}
          </div>
          <button type="button" className="button" onClick={() => setLogOpen(true)}>
            Log note
          </button>
          <ul role="listbox" aria-label="Notes" className="notes">
            {notes.map((item) => (
              <li
                key={item.id}
                id={`note-option-${item.id}`}
                role="option"
                aria-selected={item.id === noteId}
                tabIndex={0}
                className={item.id === noteId ? 'note-option current' : 'note-option'}
                onClick={() => navigate(`/inbox/${item.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/inbox/${item.id}`);
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const target = event.currentTarget;
                    const sibling =
                      event.key === 'ArrowDown' ? target.nextElementSibling : target.previousElementSibling;
                    if (sibling instanceof HTMLElement) sibling.focus();
                  }
                }}
              >
                <span className="note-option-title">{item.title}</span>
                <span className="note-option-meta">
                  {item.contactName ?? 'No contact'} · {SOURCE_LABELS[item.source]}
                </span>
                <span className="note-option-date">{item.createdAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
          {cursor !== null ? (
            <button
              type="button"
              className="button"
              ref={loadMoreButton}
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading notes…' : 'Load more notes'}
            </button>
          ) : null}
        </section>
      ) : null}

      {!narrow || pane === 'Note' ? (
        <section className="reading-column">
          {note === null ? (
            <p className="empty">Choose a note to read it here.</p>
          ) : (
            <NoteReader
              note={note}
              contacts={contacts}
              features={features}
              bodyRef={bodyRef}
              dragStart={(point, selection) => setDrag({ from: point, to: point, selection })}
              linkRequest={linkRequest}
              onLinkRequestHandled={() => setLinkRequest(null)}
              onNoteChanged={(updated) => {
                setNote(updated);
                void loadFirstPage(filter, true);
              }}
              onNoteDeleted={() => {
                setNote(null);
                navigate('/inbox');
                void loadFirstPage(filter, true);
                void loadHierarchy();
              }}
              onLinked={(insight: Insight, feature, before) => {
                setNote((current) =>
                  current === null ? current : { ...current, insights: [...current.insights, insight] },
                );
                announceLink('Linked to', feature, before);
                runThread(feature, insight.id);
              }}
              onUnlinked={(insight, feature, before) => {
                setNote((current) =>
                  current === null
                    ? current
                    : { ...current, insights: current.insights.filter((item) => item.id !== insight.id) },
                );
                announceLink('Unlinked from', feature, before);
                void loadHierarchy();
              }}
            />
          )}
        </section>
      ) : null}

      {railVisible ? (
        <HierarchyRail
          hierarchy={hierarchy}
          linkedFeatureId={linkedFeatureId}
          dragging={drag !== null}
          registerRow={(featureId, element) => {
            if (element === null) rowRefs.current.delete(featureId);
            else rowRefs.current.set(featureId, element);
          }}
          onDropFeature={(featureId) => {
            if (drag === null) return;
            setLinkRequest({ featureId, selection: drag.selection });
            setDrag(null);
          }}
        />
      ) : null}

      {thread !== null ? (
        <EvidenceThread from={thread.from} to={thread.to} featureName={thread.name} fading={thread.fading} />
      ) : null}
      {drag !== null ? <DragThread from={drag.from} to={drag.to} /> : null}

      {logOpen ? (
        <LogNoteDialog
          contacts={contacts}
          onClose={() => setLogOpen(false)}
          onSaved={() => {
            setLogOpen(false);
            void loadFirstPage(filter, true);
          }}
        />
      ) : null}
    </main>
  );
}

function LogNoteDialog({
  contacts,
  onClose,
  onSaved,
}: {
  contacts: ContactRef[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const app = useApp();
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [source, setSource] = useState<NoteSource>('support_ticket');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (): Promise<void> => {
    setErrors({});
    app.setPending('Saving note…');
    let created: Note;
    try {
      const data = await request<{ note: Note }>('/api/notes', {
        method: 'POST',
        body: { title, body: bodyRef.current?.innerHTML ?? '', source, contactId: contactId === '' ? null : contactId },
      });
      created = data.note;
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) {
        if (error.status === 422) setErrors(error.fields);
        else app.setAlert(error.message);
      }
      return;
    }

    const file = fileRef.current?.files?.[0];
    if (!file) {
      app.setSaveStatus('Note saved.');
      onSaved();
      return;
    }
    if (file.size > 10_000_000) {
      app.setAlert(`${file.name} is larger than 10 MB.`);
      onSaved();
      return;
    }
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const uploaded = await request<{ attachment: Attachment }>(`/api/notes/${created.id}/attachments`, {
        method: 'POST',
        formData: form,
      });
      app.setSaveStatus(
        uploaded.attachment.status === 'pending'
          ? `Note saved. ${uploaded.attachment.filename} will upload when storage is back.`
          : 'Note saved.',
      );
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) {
        if (error.status === 415) app.setAlert('Attach a .txt, .vtt, .pdf, .png or .jpg file.');
        else if (error.status === 413) app.setAlert(`${file.name} is larger than 10 MB.`);
        else app.setAlert(error.fields.file ?? error.message);
      }
    }
    onSaved();
  };

  return (
    <Dialog label="Log note" onClose={onClose}>
      <div className="field">
        <label htmlFor="log-title">Title</label>
        <input
          id="log-title"
          type="text"
          aria-label="Title"
          aria-describedby="log-title-error"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <FieldError id="log-title-error" message={errors.title} />
      </div>
      <div className="field">
        <label htmlFor="log-body">Note body</label>
        <div
          id="log-body"
          ref={bodyRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Note body"
          aria-describedby="log-body-error"
          contentEditable
          suppressContentEditableWarning
          className="rich-input"
        />
        <FieldError id="log-body-error" message={errors.body} />
      </div>
      <div className="field">
        <label htmlFor="log-contact">Contact</label>
        <select
          id="log-contact"
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
      <div className="field">
        <label htmlFor="log-source">Source</label>
        <select
          id="log-source"
          aria-label="Source"
          value={source}
          onChange={(event) => setSource(event.target.value as NoteSource)}
        >
          {SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {SOURCE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="log-file">Attach transcript or file</label>
        <input id="log-file" type="file" ref={fileRef} aria-label="Attach transcript or file" />
      </div>
      <div className="dialog-actions">
        <button type="button" className="button accent" onClick={() => void save()}>
          Save note
        </button>
      </div>
    </Dialog>
  );
}
