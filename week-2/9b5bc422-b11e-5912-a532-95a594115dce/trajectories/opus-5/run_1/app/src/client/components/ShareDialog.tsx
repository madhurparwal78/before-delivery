import { useEffect, useState } from 'react';
import { announce as copy, empty, pending } from '../../domain/copy.ts';
import { useStore } from '../hooks.ts';
import { announce, syncing } from '../store/store.ts';
import { share } from '../store/sync.ts';
import { Dialog } from './Dialog.tsx';

export function ShareDialog(props: { documentId: string; onClose: () => void }) {
  const state = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [onAccount, setOnAccount] = useState(false);
  const [busy, setBusy] = useState(false);

  const signedOut = !state.account;
  const notSynced = !signedOut && (!syncing() || !onAccount);

  useEffect(() => {
    if (signedOut) return;
    void share.get(props.documentId).then((result) => {
      if (result.status === 200) {
        setOnAccount(true);
        const given = result.body.share as { url: string } | null;
        setUrl(given?.url ?? null);
      } else {
        setOnAccount(false);
      }
    });
  }, [props.documentId, signedOut, state.pending.items]);

  const create = async (regenerated: boolean) => {
    setBusy(true);
    const result = await share.create(props.documentId);
    setBusy(false);
    if (result.status === 201) {
      setUrl(result.body.url as string);
      announce(regenerated ? copy.linkRegenerated : copy.linkCreated);
    }
  };

  return (
    <Dialog name="Share" onClose={props.onClose}>
      <h2 className="display">Share</h2>
      {signedOut && <p>{empty.shareSignedOut}</p>}
      {!signedOut && notSynced && <p>{empty.shareNotSynced}</p>}
      {!signedOut && !notSynced && (
        <>
          {!url && (
            <button type="button" className="button" disabled={busy} onClick={() => void create(false)}>
              {busy ? pending.creatingLink : 'Create link'}
            </button>
          )}
          {url && (
            <>
              <label className="field">
                <span>Share link</span>
                <input type="text" readOnly value={url} />
              </label>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).catch(() => undefined);
                  announce(copy.linkCopied);
                }}
              >
                Copy link
              </button>
              <button type="button" className="button" onClick={() => void create(true)}>
                New link
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void share.revoke(props.documentId).then(() => {
                    setUrl(null);
                    announce(copy.linkRevoked);
                  });
                }}
              >
                Revoke link
              </button>
            </>
          )}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
