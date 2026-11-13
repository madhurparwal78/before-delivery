import { useEffect, useId, useState } from 'react';
import type { Share } from '../../shared/types.js';
import { ApiFailure, apiGet, apiSend } from '../api.js';
import { Dialog } from './Dialog.js';

interface ShareDialogProps {
  notebookId: string;
  onClose: () => void;
}

export function ShareDialog({ notebookId, onClose }: ShareDialogProps): JSX.Element {
  const base = useId();
  const [shares, setShares] = useState<Share[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const answer = await apiGet<{ shares: Share[] }>(`/api/notebooks/${notebookId}/shares`);
    setShares(answer.shares);
  };

  useEffect(() => {
    void load();
  }, [notebookId]);

  const send = async (): Promise<void> => {
    setNotice('Sending invitation…');
    setFieldError(null);
    try {
      await apiSend<{ share: Share }>('POST', `/api/notebooks/${notebookId}/shares`, { email, role });
      setNotice(`Invitation sent to ${email}`);
      setEmail('');
      await load();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'already_shared') setNotice(`${email} already has access`);
      else if (error.code === 'mail_unavailable') setNotice('Invitation not sent: email is unavailable');
      else if (error.status === 422) {
        setNotice(null);
        setFieldError(error.fieldErrors[0]?.message ?? error.message);
      } else setNotice(error.message);
    }
  };

  const remove = async (share: Share): Promise<void> => {
    await apiSend('DELETE', `/api/notebooks/${notebookId}/shares/${share.id}`);
    await load();
  };

  return (
    <Dialog name="Share notebook" onClose={onClose}>
      <h2>Share notebook</h2>
      <div className="field">
        <label htmlFor={`${base}-email`}>Email</label>
        <input
          id={`${base}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldError ? <p className="field-error">{fieldError}</p> : null}
      </div>
      <fieldset className="role-group">
        <legend>Role</legend>
        <div role="radiogroup" aria-label="Role">
          <label>
            <input
              type="radio"
              name={`${base}-role`}
              checked={role === 'editor'}
              aria-label="Editor"
              onChange={() => setRole('editor')}
            />
            Editor
          </label>
          <label>
            <input
              type="radio"
              name={`${base}-role`}
              checked={role === 'viewer'}
              aria-label="Viewer"
              onChange={() => setRole('viewer')}
            />
            Viewer
          </label>
        </div>
      </fieldset>
      <div className="button-row">
        <button
          type="button"
          className="button-embossed"
          onClick={() => {
            void send();
          }}
        >
          Send invitation
        </button>
        <button type="button" className="button-plain" onClick={onClose}>
          Close
        </button>
      </div>
      {notice ? <p className="form-notice">{notice}</p> : null}
      <h3>People with access</h3>
      <ul className="share-list" aria-label="People with access">
        {shares.map((share) => (
          <li key={share.id}>
            <span className="share-who">{share.display_name ?? share.email}</span>
            <span className="share-role">{share.role === 'editor' ? 'Editor' : 'Viewer'}</span>
            <span className="share-status">{share.status === 'active' ? 'Active' : 'Invited'}</span>
            <button
              type="button"
              className="button-plain"
              aria-label={`Remove ${share.display_name ?? share.email}`}
              onClick={() => {
                void remove(share);
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
