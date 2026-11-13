import { useState, type ReactNode } from 'react';
import { api, failureOf } from '../api.js';
import { notify, raise } from '../notices.js';
import { Dialog } from './Dialog.js';

export function ShareDialog({ tournamentId, link, onLink, onClose }: {
  tournamentId: string;
  link: string;
  onLink: (link: string) => void;
  onClose: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Link copied');
    } catch {
      raise('The link could not be copied. Select it and copy it by hand.');
    }
  };

  const replace = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = await api.post<{ share_url: string }>(`/api/tournaments/${tournamentId}/share/rotate`);
      onLink(body.share_url);
      notify('Link replaced. The old link no longer works.');
    } catch (error) {
      raise(failureOf(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Share tournament" onClose={onClose}>
      <div className="field">
        <label htmlFor="share-link">Share link</label>
        <input id="share-link" type="text" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => void copy()}>Copy link</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void replace()}>Replace link</button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
