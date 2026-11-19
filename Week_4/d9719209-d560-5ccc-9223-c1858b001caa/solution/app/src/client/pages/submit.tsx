import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { ImageView, PostView } from '../../shared/types.js';
import { ApiError, api, newKey, upload } from '../api.js';
import { announce } from '../announce.js';
import { useCommunity } from '../community.js';
import '../composer.css';
import { navigate } from '../router.js';
import { useSession } from '../session.js';
import { Banner, Button, Empty, Field, Html, Skeleton, Tabs, pageTitle, useFocusFirstInvalid } from '../ui.js';

const OUTAGE = 'Image uploads are unavailable right now. Your draft is kept.';
const IMAGES_ERROR = 'Wait for every image to upload, or remove the ones that failed';
const TITLE_ERROR = 'Titles are 1 to 300 characters';
const BODY_ERROR = 'Bodies are at most 40,000 characters';
const MAX_IMAGES = 10;
const characters = (text: string): number => [...text].length;

interface Tile {
  key: number;
  file: File;
  preview: string;
  status: 'uploading' | 'done' | 'failed';
  imageId: string | null;
  alt: string;
  error: string | null;
}

function uploadFailure(error: unknown): { text: string; outage: boolean } {
  if (error instanceof ApiError) {
    if (error.code === 'STORAGE_UNAVAILABLE') return { text: OUTAGE, outage: true };
    if (error.status === 413) return { text: 'This image is too large', outage: false };
    if (error.fields.file) return { text: error.fields.file, outage: false };
  }
  return { text: "This image didn't upload. Try again.", outage: false };
}

function Arrow({ up }: { up: boolean }): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? 'M5 15 L12 8 L19 15' : 'M5 9 L12 16 L19 9'} />
    </svg>
  );
}

export function SubmitPage({ name }: { name: string }): React.JSX.Element {
  const { user, loading: sessionLoading } = useSession();
  const community = useCommunity(name);
  const data = community.data;
  pageTitle(data ? `New post in c/${data.name}` : '');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<{ html: string | null; error: string | null }>({ html: null, error: null });
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef(newKey());
  const nextKey = useRef(1);
  const inFlight = useRef(false);
  const alerted = useRef(false);
  const focusRetry = useRef(false);
  const focusMove = useRef<{ key: number; dir: 'up' | 'down' } | null>(null);
  const live = useRef(tiles);
  live.current = tiles;
  useFocusFirstInvalid(form, tries);

  useEffect(() => {
    if (!sessionLoading && !user) navigate(`/login?next=${encodeURIComponent(location.pathname)}`, true);
  }, [sessionLoading, user]);

  useEffect(() => () => live.current.forEach((t) => URL.revokeObjectURL(t.preview)), []);

  useLayoutEffect(() => {
    if (focusMove.current) {
      const { key, dir } = focusMove.current;
      focusMove.current = null;
      form.current?.querySelector<HTMLElement>(`[data-tile-key="${key}"] [data-move="${dir}"]`)?.focus();
    }
    if (focusRetry.current && tiles.every((t) => t.status !== 'uploading')) {
      focusRetry.current = false;
      form.current?.querySelector<HTMLElement>('[data-retry]')?.focus();
    }
  }, [tiles]);

  const patch = (key: number, change: Partial<Tile>): void => setTiles((all) => all.map((t) => (t.key === key ? { ...t, ...change } : t)));

  const send = async (key: number, file: File): Promise<void> => {
    patch(key, { status: 'uploading', error: null });
    try {
      const image = await upload<ImageView>('/api/images', file);
      if (!live.current.some((t) => t.key === key)) return;
      alerted.current = false;
      patch(key, { status: 'done', imageId: image.id });
      const position = live.current.findIndex((t) => t.key === key) + 1;
      announce(`Image ${position} uploaded`);
    } catch (error) {
      if (!live.current.some((t) => t.key === key)) return;
      const failure = uploadFailure(error);
      patch(key, { status: 'failed', error: failure.text });
      if (failure.outage && !alerted.current) {
        alerted.current = true;
        focusRetry.current = true;
        announce(OUTAGE, true);
      }
    }
  };

  const addFiles = (files: File[]): void => {
    const room = MAX_IMAGES - tiles.length;
    const fresh = files.slice(0, Math.max(0, room)).map<Tile>((file) => ({
      key: nextKey.current++, file, preview: URL.createObjectURL(file), status: 'uploading', imageId: null, alt: '', error: null,
    }));
    if (fresh.length === 0) return;
    setTiles((all) => [...all, ...fresh]);
    setErrors((e) => { const { images: _images, ...rest } = e; return rest; });
    for (const tile of fresh) void send(tile.key, tile.file);
  };

  const move = (index: number, dir: 'up' | 'down'): void => {
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= tiles.length) return;
    const moved = tiles[index] as Tile;
    focusMove.current = { key: moved.key, dir };
    setTiles((all) => {
      const next = [...all];
      next[index] = next[to] as Tile;
      next[to] = moved;
      return next;
    });
  };

  const remove = (key: number): void => {
    const gone = tiles.find((t) => t.key === key);
    if (gone) URL.revokeObjectURL(gone.preview);
    setTiles((all) => all.filter((t) => t.key !== key));
  };

  const showPreview = async (next: 'write' | 'preview'): Promise<void> => {
    setTab(next);
    if (next !== 'preview') return;
    setPreview({ html: null, error: null });
    try {
      const result = await api<{ html: string }>('POST', '/api/markdown/preview', { bodyMd: body });
      setPreview({ html: result.html, error: null });
    } catch (error) {
      setPreview({ html: null, error: error instanceof ApiError && error.fields.bodyMd ? error.fields.bodyMd : "The preview couldn't load" });
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (inFlight.current || !data) return;
    const next: Record<string, string> = {};
    const trimmed = title.trim();
    if (trimmed.length < 1 || characters(trimmed) > 300) next.title = TITLE_ERROR;
    if (characters(body) > 40_000) next.bodyMd = BODY_ERROR;
    if (tiles.some((t) => t.status !== 'done')) next.images = IMAGES_ERROR;
    setFormError(null);
    if (Object.keys(next).length > 0) {
      setErrors(next);
      setTries((n) => n + 1);
      return;
    }
    setErrors({});
    inFlight.current = true;
    setBusy(true);
    try {
      const payload = {
        title: trimmed, bodyMd: body, spoiler,
        images: tiles.map((t) => ({ id: t.imageId as string, alt: t.alt.trim() })),
      };
      const post = await api<PostView>('POST', `/api/communities/${data.name}/posts`, payload, { key: idempotencyKey.current });
      announce('Post published');
      navigate(post.url);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError("The post didn't go through. Your draft is kept.");
      } else if (error.code === 'EMAIL_UNVERIFIED') {
        setFormError('Verify your email to post');
        announce('Verify your email to post');
      } else if (error.code === 'NOT_APPROVED') {
        void community.reload();
      } else if (error.code === 'STORAGE_UNAVAILABLE') {
        setFormError(OUTAGE);
        announce(OUTAGE, true);
      } else if (error.code === 'IMAGES_NOT_READY') {
        setErrors({ images: IMAGES_ERROR });
        setTries((n) => n + 1);
      } else if (error.code === 'RATE_LIMITED') {
        setFormError(`Slow down — try again in ${error.retryAfter ?? 1} s`);
      } else if (error.status === 422) {
        const mapped: Record<string, string> = {};
        for (const [field, text] of Object.entries(error.fields)) mapped[field === 'alt' ? 'images' : field] = text;
        setErrors(mapped);
        setTries((n) => n + 1);
        if (error.fields.idempotencyKey) setFormError(error.fields.idempotencyKey);
      } else {
        setFormError("The post didn't go through. Your draft is kept.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (community.error?.status === 404) return <Empty title="Community not found">There is no community called c/{name}.</Empty>;
  if (!data || sessionLoading) return <Skeleton rows={3} />;
  const allowed = data.viewer.canPost;

  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setOver(false);
    if (allowed) addFiles([...event.dataTransfer.files]);
  };

  return (
    <div className="page-solo composer">
      <h1>{`New post in c/${data.name}`}</h1>
      {!allowed && (
        <Banner tone="warn"><p>Approved posters only</p><p>Moderators of c/{data.name} approve who can post here. You can still read and comment.</p></Banner>
      )}
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate aria-busy={busy || undefined}>
        <fieldset disabled={!allowed}>
          <Field label="Title" error={errors.title}>
            {(props) => <input type="text" {...props} value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Tabs
            className="composer-body-tabs" label="Body editor" value={tab} panelId="composer-body-panel"
            options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]}
            onChange={(next) => void showPreview(next)}
          />
          <div id="composer-body-panel">
            {tab === 'write' ? (
              <Field label="Body" error={errors.bodyMd} hint="Markdown is supported.">
                {(props) => <textarea {...props} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}
              </Field>
            ) : (
              <div className="composer-preview" aria-label="Preview of the body">
                {preview.error ? <p className="field-error">{preview.error}</p>
                  : preview.html === null ? <p className="muted">Rendering preview...</p>
                    : preview.html === '' ? <p className="muted">Nothing to preview yet.</p> : <Html html={preview.html} />}
              </div>
            )}
          </div>
          <label className="check"><input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /><span>Spoiler</span></label>
          <div
            className="dropzone" data-over={over}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
          >
            <Field label="Add images" error={errors.images} hint="JPEG, PNG or WebP. Up to 10 images; each uploads as soon as you add it.">
              {(props) => (
                <input
                  type="file" {...props} multiple accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }}
                />
              )}
            </Field>
          </div>
          {tiles.length > 0 && (
            <ul className="tiles">
              {tiles.map((tile, i) => {
                const n = i + 1;
                return (
                  <li key={tile.key}>
                    <div role="group" aria-label={`Image ${n} of ${tiles.length}`} id={`image-tile-${n}`} className="tile" data-tile-key={tile.key}>
                      <img className="tile-thumb" src={tile.preview} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      <div>
                        <p className="tile-status" data-failed={tile.status === 'failed'}>
                          {tile.status === 'uploading' ? `Uploading image ${n}` : tile.status === 'done' ? `Image ${n} uploaded` : tile.error}
                        </p>
                        <input
                          type="text" aria-label={`Alt text for image ${n}`} placeholder="Alt text (optional)" value={tile.alt}
                          onChange={(e) => patch(tile.key, { alt: e.target.value })}
                        />
                        <div className="tile-actions">
                          <Button aria-label={`Move image ${n} up`} aria-disabled={i === 0} data-move="up" onClick={() => move(i, 'up')}><Arrow up /></Button>
                          <Button aria-label={`Move image ${n} down`} aria-disabled={i === tiles.length - 1} data-move="down" onClick={() => move(i, 'down')}><Arrow up={false} /></Button>
                          <Button onClick={() => remove(tile.key)}><span aria-hidden="true">✕</span><span className="sr-only">{`Remove image ${n}`}</span></Button>
                          {tile.status === 'failed' && <Button data-retry onClick={() => void send(tile.key, tile.file)}>Retry upload</Button>}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {formError && <p className="field-error form-error">{formError}</p>}
          <div className="form-actions">
            <Button type="submit" variant="primary" busy={busy}>{busy ? 'Posting...' : 'Post'}</Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
