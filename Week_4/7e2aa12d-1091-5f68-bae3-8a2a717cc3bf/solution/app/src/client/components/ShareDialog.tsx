import { useState } from 'react';
import {
  CO_EDIT_LINK_REGENERATED,
  VIEW_LINK_CREATED,
  VIEW_LINK_REGENERATED,
  VIEW_LINK_REVOKED,
  collaboratorRemoved,
} from '../../shared/messages.js';
import type { ShareInfo } from '../../shared/types.js';
import { request } from '../lib/api.js';
import type { ApiResult, ErrorBody } from '../lib/api.js';
import { Dialog } from './Dialog.js';
import { Problem } from './Dialogs.js';
import { CloseIcon } from './Icons.js';

interface ShareDialogProps {
  layoutId: string;
  /** The links as the server holds them: the dialog opens already filled in. */
  initial: ShareInfo;
  onClose: () => void;
  announce: (text: string) => void;
  call: <T>(work: () => Promise<ApiResult<T>>) => Promise<ApiResult<T> | null>;
}

/** The "Share" dialog: the view link, the co-edit link and the collaborators. Each button acts at once. */
export function ShareDialog({ layoutId, initial, onClose, announce, call }: ShareDialogProps) {
  const [share, setShare] = useState<ShareInfo>(initial);
  const [problem, setProblem] = useState('');
  const base = `/api/layouts/${layoutId}`;
  const absolute = (path: string | null): string => (path ? `${window.location.origin}${path}` : '');

  /** Run a link action, update the dialog in place and announce the result. */
  const act = async <T,>(method: string, path: string, done: (body: T) => Partial<ShareInfo>, announcement: string): Promise<void> => {
    const result = await call(() => request<T | ErrorBody>(method, `${base}/${path}`));
    if (!result) return;
    if (result.status >= 400) {
      setProblem((result.body as ErrorBody).message ?? '');
      return;
    }
    setProblem('');
    setShare((current) => ({ ...current, ...done(result.body as T) }));
    announce(announcement);
  };

  const active = share.view_path !== null;

  return (
    <Dialog label="Share" onClose={onClose}>
      {(close) => (
        <div className="share">
          <header className="drawer-head">
            <h2>Share</h2>
            <button type="button" className="icon-button" aria-label="Close share" onClick={close}>
              <CloseIcon />
            </button>
          </header>
          <section>
            <h3>View link</h3>
            <p className="note">Anyone with this link can read the layout and its code, signed out.</p>
            <input type="text" readOnly aria-label="View link" className="mono" value={absolute(share.view_path)} onFocus={(event) => event.currentTarget.select()} />
            <div className="button-row">
              <button type="button" disabled={active} onClick={() => void act<{ view_path: string }>('POST', 'view-link', (body) => ({ view_path: body.view_path }), VIEW_LINK_CREATED)}>
                Create view link
              </button>
              <button type="button" disabled={!active} onClick={() => void act<{ view_path: string }>('POST', 'view-link', (body) => ({ view_path: body.view_path }), VIEW_LINK_REGENERATED)}>
                Regenerate view link
              </button>
              <button type="button" disabled={!active} onClick={() => void act<undefined>('DELETE', 'view-link', () => ({ view_path: null }), VIEW_LINK_REVOKED)}>
                Revoke view link
              </button>
            </div>
          </section>
          <section>
            <h3>Co-edit link</h3>
            <p className="note">A designer who opens this link and signs in joins the layout and edits it with you.</p>
            <input type="text" readOnly aria-label="Co-edit link" className="mono" value={absolute(share.join_path)} onFocus={(event) => event.currentTarget.select()} />
            <div className="button-row">
              <button type="button" onClick={() => void act<{ join_path: string }>('POST', 'join-link', (body) => ({ join_path: body.join_path }), CO_EDIT_LINK_REGENERATED)}>
                Regenerate co-edit link
              </button>
            </div>
          </section>
          <section>
            <h3>Collaborators</h3>
            <ul aria-label="Collaborators" className="collaborators">
              {share.collaborators.map((username) => (
                <li key={username}>
                  <span className="mono">{username}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${username}`}
                    onClick={() =>
                      void act<undefined>('DELETE', `collaborators/${encodeURIComponent(username)}`, () => ({ collaborators: share.collaborators.filter((name) => name !== username) }), collaboratorRemoved(username))
                    }
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <Problem message={problem} />
        </div>
      )}
    </Dialog>
  );
}
