import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { useUser } from '../lib/store.js';
import type { Entry, Named } from '../lib/types.js';
import type { JSX } from 'react';

export function StudioScreen(): JSX.Element {
  const { user, loading } = useUser();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [disciplines, setDisciplines] = useState<Named[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState({
    title: '',
    statement: '',
    discipline: 'sound',
    medium: '',
    year: '',
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const body = await request<{ entries: Entry[] }>('/api/entries');
    setEntries(body.entries);
    setSelectedId((current) => current ?? body.entries[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (user === null) return;
    void load();
    void request<{ disciplines: Named[] }>('/api/programme').then((body) =>
      setDisciplines(body.disciplines),
    );
  }, [user, load]);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  useEffect(() => {
    if (selected === null) return;
    setDraft({
      title: selected.title,
      statement: selected.statement,
      discipline: selected.discipline,
      medium: selected.medium,
      year: selected.year,
    });
  }, [selected]);

  if (loading) return <section className="wide ground-paper">Loading…</section>;
  if (user === null || user.role !== 'artist') {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Studio</h1>
        <p>Only artists can use the studio.</p>
      </section>
    );
  }

  const createEntry = async (): Promise<void> => {
    const entry = await request<Entry>('/api/entries', {
      method: 'POST',
      body: {
        title: 'Untitled entry',
        statement: '',
        discipline: disciplines[0]?.id ?? 'sound',
        medium: '',
        year: '2027',
      },
    });
    setStatus('New entry created.');
    setSelectedId(entry.id);
    await load();
  };

  const saveDraft = async (): Promise<void> => {
    if (selected === null) return;
    try {
      await request(`/api/entries/${selected.id}`, { method: 'PATCH', body: draft });
      setStatus('Saved.');
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'not_editable'
          ? 'This entry can only be edited while it is a draft.'
          : 'Check the details and try again.',
      );
    }
  };

  const uploadImage = async (): Promise<void> => {
    if (selected === null || file === null) {
      setStatus('Choose an image first.');
      return;
    }
    setStatus('Uploading…');
    const form = new FormData();
    form.set('file', file);
    try {
      await request(`/api/entries/${selected.id}/images`, { method: 'POST', body: form });
      setStatus('Image uploaded.');
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const code = error.failure.fields['file'] ?? error.failure.code;
      if (error.failure.status === 413) setStatus('This image is larger than 10,000,000 bytes.');
      else if (code === 'unsupported_type') setStatus('Upload a JPEG, PNG or WebP image.');
      else if (code === 'invalid_name') {
        setStatus("This file name isn't allowed. Rename the file and try again.");
      } else if (code === 'storage_unavailable') {
        setStatus("We couldn't store your file right now. Try again in a moment.");
      } else setStatus('We could not accept that image.');
    }
  };

  const submitForReview = async (): Promise<void> => {
    if (selected === null) return;
    try {
      await request(`/api/entries/${selected.id}/transitions`, {
        method: 'POST',
        body: { to: 'review', note: null, publish_at: null },
      });
      setStatus(`${selected.title} sent for review.`);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.fields['images'] !== undefined) {
        setStatus('Upload an image before you submit.');
        return;
      }
      setStatus(
        `${selected.title} can't move from ${String(error.failure.extra['from'] ?? selected.status)} to review.`,
      );
    }
  };

  const viewOriginal = async (imageId: string): Promise<void> => {
    if (selected === null) return;
    const link = await request<{ url: string }>(
      `/api/entries/${selected.id}/images/${imageId}/read`,
      { method: 'POST' },
    );
    window.open(link.url, '_blank', 'noopener');
  };

  return (
    <section className="studio wide ground-paper">
      <h1 className="display">Studio</h1>
      <p className="status" role="status" aria-label="Studio status">
        {status}
      </p>

      <div className="studio-layout">
        <div className="studio-list">
          <button type="button" className="primary" onClick={() => void createEntry()}>
            New entry
          </button>
          <ul className="ruled" aria-label="My entries">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-pressed={entry.id === selectedId}
                  onClick={() => setSelectedId(entry.id)}
                >
                  {entry.title}
                </button>
                <span className="meta">{entry.status}</span>
              </li>
            ))}
          </ul>
        </div>

        {selected === null ? (
          <p className="muted">No entries yet.</p>
        ) : (
          <div className="studio-editor">
            <div className="field">
              <label htmlFor="entry-title">Title</label>
              <input
                id="entry-title"
                type="text"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="entry-statement">Artist statement</label>
              <textarea
                id="entry-statement"
                rows={5}
                value={draft.statement}
                onChange={(event) => setDraft({ ...draft, statement: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="entry-discipline">Discipline</label>
              <select
                id="entry-discipline"
                value={draft.discipline}
                onChange={(event) => setDraft({ ...draft, discipline: event.target.value })}
              >
                {disciplines.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {discipline.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="entry-medium">Medium</label>
              <input
                id="entry-medium"
                type="text"
                value={draft.medium}
                onChange={(event) => setDraft({ ...draft, medium: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="entry-year">Year</label>
              <input
                id="entry-year"
                type="text"
                value={draft.year}
                onChange={(event) => setDraft({ ...draft, year: event.target.value })}
              />
            </div>
            <button type="button" onClick={() => void saveDraft()}>
              Save draft
            </button>

            <div className="field">
              <label htmlFor="artwork-image">Artwork image</label>
              <input
                id="artwork-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <button type="button" onClick={() => void uploadImage()}>
              Upload image
            </button>

            <ul className="ruled" aria-label="Entry images">
              {selected.images.map((image) => (
                <li key={image.id}>
                  <span className="figures">{`${image.width}×${image.height}`}</span>
                  <button type="button" onClick={() => void viewOriginal(image.id)}>
                    View original
                  </button>
                </li>
              ))}
              {selected.images.length === 0 ? <li className="muted">No image yet.</li> : null}
            </ul>

            <button type="button" className="primary" onClick={() => void submitForReview()}>
              Submit for review
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
