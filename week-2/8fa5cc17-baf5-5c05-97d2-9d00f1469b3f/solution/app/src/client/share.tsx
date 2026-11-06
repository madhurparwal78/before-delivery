// The read-only share pages: always Paper, no session, following the server's link status and scope.
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/share.css';
import { renderBody } from '../shared/richtext.ts';

const REFRESH_MS = 5000;
const OUTSIDE_QUOTE = 'Quoted from a note outside this share.';

type Status = 'active' | 'expired' | 'revoked' | 'unknown';
interface SharedBlock { id?: string; kind: 'text' | 'quote' | 'attachment'; hidden?: boolean; body?: string | null; origin?: { object_id: string; object_title: string }; attachment?: { id: string; filename: string; content_type: string } }
interface SharedObject { id: string; title: string; type_name: string; properties: Record<string, string | number | null>; blocks: SharedBlock[]; backlinks: Array<{ from_object_id: string; from_title: string; kind: string }> }

const parts = window.location.pathname.split('/');
const token = decodeURIComponent(parts[2] ?? '');
const objectId = parts[3] === 'o' ? decodeURIComponent(parts[4] ?? '') : null;
const base = `/s/${encodeURIComponent(token)}`;

async function read<T>(path: string): Promise<{ status: number; data: T | null }> {
  const r = await fetch(`${base}${path}`, { credentials: 'omit' });
  const data = (r.headers.get('content-type') ?? '').includes('application/json') ? ((await r.json()) as T) : null;
  return { status: r.status, data };
}

function Body({ html }: { html: string }) {
  // The stored body is sanitised again on render with the same allowlist (links gain rel).
  return <div className="share-body" dangerouslySetInnerHTML={{ __html: renderBody(html) }} />;
}

function SharePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [collection, setCollection] = useState<{ name: string; objects: Array<{ id: string; title: string; type_name: string }> } | null>(null);
  const [object, setObject] = useState<SharedObject | null>(null);
  const [outside, setOutside] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await read<{ status: Status }>('/api/status');
      const st: Status = s.status === 404 ? 'unknown' : s.data?.status ?? 'unknown';
      setStatus(st);
      if (st !== 'active') return;
      if (objectId) {
        const o = await read<SharedObject & { error?: string }>(`/api/objects/${encodeURIComponent(objectId)}`);
        if (o.status === 200 && o.data) {
          setObject(o.data);
          setOutside(false);
        } else if (o.status === 404 && o.data?.error === 'not_in_share') setOutside(true);
      } else {
        const c = await read<{ collection: { name: string }; objects: Array<{ id: string; title: string; type_name: string }> }>('/api/collection');
        if (c.status === 200 && c.data) setCollection({ name: c.data.collection.name, objects: c.data.objects });
      }
    } catch {
      // the next refresh asks again
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    document.title = object && !outside ? `${object.title} · Quire` : collection ? `${collection.name} · Quire` : 'Quire';
  }, [object, collection, outside]);

  if (status === null) return <main className="share" />;
  if (status === 'unknown') {
    return <main className="share"><h1>This link is not recognised</h1></main>;
  }
  if (status !== 'active') {
    return (
      <main className="share">
        <h1>This link is no longer active</h1>
        <p role="status" aria-label="Link status">Ask the person who shared it for a new link.</p>
      </main>
    );
  }
  if (objectId) {
    if (outside) {
      return (
        <main className="share">
          <h1>This note is not part of this share.</h1>
          <p role="status" aria-label="Link status" />
          <p><a href={base}>Back to the shared notes</a></p>
        </main>
      );
    }
    if (!object) return <main className="share" />;
    const props = Object.entries(object.properties).filter(([, v]) => v !== null && v !== undefined);
    return (
      <main className="share">
        <p className="kicker small-caps muted"><a href={base}>Shared notes</a> · {object.type_name}</p>
        <div className="share-object">
        <article className="share-text">
          <h1>{object.title}</h1>
          {props.length > 0 && (
            <dl className="share-props">
              {props.map(([k, v]) => <div key={k}><dt className="small-caps">{k}</dt><dd>{String(v)}</dd></div>)}
            </dl>
          )}
          <p role="status" aria-label="Link status" className="sr-only" />
          {object.blocks.map((b, i) => {
            if (b.kind === 'quote') {
              return b.hidden || !b.origin
                ? <figure key={`h${i}`} className="share-quote hidden-quote"><p>{OUTSIDE_QUOTE}</p></figure>
                : (
                  <figure key={b.id} className="share-quote" aria-label={`Quote from ${b.origin.object_title}`}>
                    <figcaption className="small-caps"><a href={`${base}/o/${b.origin.object_id}`}>{b.origin.object_title}</a></figcaption>
                    <Body html={b.body ?? ''} />
                  </figure>
                );
            }
            if (b.kind === 'attachment' && b.attachment) {
              const url = `${base}/api/attachments/${b.attachment.id}`;
              return (
                <figure key={b.id} className="share-attachment" aria-label={b.attachment.filename}>
                  {b.attachment.content_type.startsWith('image/') ? <img src={url} alt={b.attachment.filename} /> : <a href={url}>{b.attachment.filename}</a>}
                </figure>
              );
            }
            return <Body key={b.id ?? i} html={b.body ?? ''} />;
          })}
        </article>
        <section role="region" aria-label="Backlinks" className="share-backlinks">
          <h2 className="small-caps">Backlinks</h2>
          {object.backlinks.length === 0 ? <p className="muted">No shared notes link here.</p> : (
            <ul>
              {object.backlinks.map((b, i) => (
                <li key={`${b.from_object_id}-${i}`}><a href={`${base}/o/${b.from_object_id}`}>{b.from_title}</a> <span className="muted small-caps">{b.kind === 'quote' ? 'quoted' : b.kind}</span></li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </main>
    );
  }
  if (!collection) return <main className="share" />;
  return (
    <main className="share">
      <p className="kicker small-caps muted">A shared collection</p>
      <h1>{collection.name}</h1>
      <p role="status" aria-label="Link status" className="sr-only" />
      <ul aria-label="Shared notes" className="shared-notes">
        {collection.objects.map((o) => (
          <li key={o.id}><a href={`${base}/o/${o.id}`}>{o.title}</a> <span className="muted small-caps">{o.type_name}</span></li>
        ))}
      </ul>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><SharePage /></StrictMode>);
