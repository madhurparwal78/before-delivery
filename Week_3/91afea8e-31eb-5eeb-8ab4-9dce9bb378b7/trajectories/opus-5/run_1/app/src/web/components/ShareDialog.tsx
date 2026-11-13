/** The share dialog for a wishlist or a cart: one live link, replaceable, switchable off. */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Dialog, PendingButton } from './ui.tsx';
import type { ShareLink } from '../../shared/types.js';

export function ShareDialog({
  kind,
  open,
  onClose,
}: {
  kind: 'wishlist' | 'cart';
  open: boolean;
  onClose: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [link, setLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const base = kind === 'wishlist' ? '/api/wishlist/share' : '/api/cart/share';
  const title = kind === 'wishlist' ? 'Share wishlist' : 'Share cart';

  const create = async (path: string): Promise<void> => {
    const created = await api<ShareLink>(path, {
      method: 'POST',
      body: { display_name: name },
    });
    setLink(created);
    setName(created.display_name);
  };

  return (
    <Dialog name={title} open={open} onClose={onClose}>
      <label htmlFor={`share-name-${kind}`}>Name to show</label>
      <input
        id={`share-name-${kind}`}
        type="text"
        aria-label="Name to show"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="row">
        <PendingButton label="Create link" onPress={() => create(base)} />
        <PendingButton
          label="Make a new link"
          className="btn btn-quiet"
          onPress={() => create(`${base}/regenerate`)}
        />
        <PendingButton
          label="Turn off link"
          className="btn btn-pink"
          onPress={async () => {
            await api(base, { method: 'DELETE' });
            setLink(null);
          }}
        />
      </div>
      <label htmlFor={`share-link-${kind}`}>Share link</label>
      <input
        id={`share-link-${kind}`}
        type="text"
        aria-label="Share link"
        readOnly
        value={link === null ? '' : `${window.location.origin}${link.url}`}
      />
      <div className="row">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            if (link === null) return;
            void navigator.clipboard
              ?.writeText(`${window.location.origin}${link.url}`)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          Copy link
        </button>
        {copied ? <span className="chip">link copied</span> : null}
      </div>
    </Dialog>
  );
}
