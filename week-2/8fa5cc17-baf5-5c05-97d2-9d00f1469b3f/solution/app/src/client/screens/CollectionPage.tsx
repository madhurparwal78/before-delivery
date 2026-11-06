// A collection: its objects (never-share ones marked), the board, and its share links.
import { useCallback, useEffect, useState } from 'react';
import { api, get } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { announce, COPY } from '../feedback.ts';
import { linkHandler, navigate } from '../router.ts';
import { useSync } from '../sync.ts';
import type { ObjectJson, ShareLinkJson } from '../types.ts';
import '../styles/settings.css';

const STATUS_WORDS: Record<ShareLinkJson['status'], string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
const STATUS_REFRESH_MS = 5000;

export function CollectionPage({ collectionId }: { collectionId: string }) {
  const [collection, setCollection] = useState<{ id: string; name: string; objects: ObjectJson[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [links, setLinks] = useState<ShareLinkJson[]>([]);
  const [sharing, setSharing] = useState(false);
  const [revoking, setRevoking] = useState<ShareLinkJson | null>(null);
  const [expires, setExpires] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await get<{ id: string; name: string; objects: ObjectJson[] }>(`/api/collections/${collectionId}`);
    if (r.status === 404) setMissing(true);
    else if (r.status === 200) setCollection(r.data);
  }, [collectionId]);

  const loadLinks = useCallback(async () => {
    const r = await get<{ share_links: ShareLinkJson[] }>(`/api/collections/${collectionId}/share-links`);
    if (r.status === 200) setLinks(r.data.share_links);
  }, [collectionId]);

  useEffect(() => {
    void load();
    void loadLinks();
    // Link statuses are the server's: asked again while the page stays open.
    const timer = setInterval(() => void loadLinks(), STATUS_REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === 'visible') void loadLinks();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [load, loadLinks]);

  useSync((event, data) => {
    if (event === 'share_link.changed' && (data as { collection_id: string }).collection_id === collectionId) void loadLinks();
    if (event === 'object.saved' || event === 'object.removed' || event === 'sync.reset') void load();
    if (event === 'settings.saved' || event === 'sync.reset') void loadLinks();
  });

  const create = async () => {
    const r = await api<ShareLinkJson & { errors?: Record<string, string> }>('POST', `/api/collections/${collectionId}/share-links`, { expires_at: expires });
    if (r.status === 201) {
      setSharing(false);
      setError('');
      announce(`Link created. It stops working at ${r.data.expires_at_display}.`);
      await loadLinks();
    } else if (r.status === 422) {
      setError(r.data.errors?.expires_at ?? '');
      document.getElementById('link-expires')?.focus();
    }
  };

  const revoke = async () => {
    const link = revoking;
    if (!link) return;
    const r = await api('POST', `/api/share-links/${link.id}/revoke`);
    setRevoking(null);
    if (r.status === 200) announce('Link revoked. Anyone using it now sees that it is no longer active.');
    await loadLinks();
  };

  const regenerate = async (link: ShareLinkJson) => {
    const r = await api('POST', `/api/share-links/${link.id}/regenerate`);
    if (r.status === 201) announce('New link created. The old link no longer works.');
    await loadLinks();
  };

  if (missing) return <div className="not-found"><h1>{COPY.notFound}</h1></div>;
  if (!collection) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  return (
    <div className="collection">
      <p className="kicker small-caps muted">Collection</p>
      <h1>{collection.name}</h1>
      <div className="object-actions">
        <button type="button" onClick={() => navigate(`/collections/${collectionId}/board`)}>Board</button>
        <button type="button" onClick={() => setSharing(true)}>Share collection</button>
      </div>
      <h2 className="section-head">Notes</h2>
      {collection.objects.length === 0 ? <p className="muted">No notes in this collection yet.</p> : (
        <ul className="plain-list">
          {collection.objects.map((o) => (
            <li key={o.id}>
              <a href={`/o/${o.id}`} onClick={linkHandler(`/o/${o.id}`)}>{o.title}</a>
              <span className="muted small-caps">{o.type_name}</span>
              {o.share_visibility === 'never' && <span className="never-tag small-caps">Never shared</span>}
            </li>
          ))}
        </ul>
      )}
      <h2 className="section-head" id="links-head">Share links</h2>
      {links.length === 0 && <p className="muted">No share links yet.</p>}
      <ul aria-label="Share links" className="share-links">
        {links.map((l) => (
          <li key={l.id}>
            <span className={`status-word small-caps status-${l.status}`}>{STATUS_WORDS[l.status]}</span>
            <span>Expires {l.expires_at_display}</span>
            <code className="link-url">{`${window.location.origin}${l.url}`}</code>
            {l.status === 'active' && (
              <span className="link-actions">
                <button type="button" className="quiet" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${l.url}`)}>Copy link</button>
                <button type="button" className="quiet" onClick={() => setRevoking(l)}>Revoke link</button>
                <button type="button" className="quiet" onClick={() => void regenerate(l)}>Regenerate link</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {sharing && (
        <Dialog label="Share collection" onClose={() => setSharing(false)}>
          <h2>Share collection</h2>
          <p className="muted">Readers see only this collection's shareable notes, until the minute you choose.</p>
          <div className="field">
            <label htmlFor="link-expires">Link expires (home clock)</label>
            <input id="link-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)}
              aria-describedby={error ? 'link-expires-error' : undefined} />
            {error && <p id="link-expires-error" className="field-error">{error}</p>}
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={() => setSharing(false)}>Cancel</button>
            <button type="button" className="primary" onClick={() => void create()}>Create link</button>
          </div>
        </Dialog>
      )}
      {revoking && (
        <Dialog label="Revoke this link?" role="alertdialog" onClose={() => setRevoking(null)} describedBy="revoke-copy">
          <h2>Revoke this link?</h2>
          <p id="revoke-copy">Anyone with this link loses access at once.</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setRevoking(null)}>Cancel</button>
            <button type="button" className="primary" onClick={() => void revoke()}>Revoke</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
