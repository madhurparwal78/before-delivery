// Share drawing (owner only): creates a share link for one recipient, emails it, copies it, lists and revokes links.
import { useEffect, useRef, useState } from 'react';
import type { ShareAccess, ShareView } from '../../../shared/types.ts';
import { ApiError, get, post } from '../../api.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { TextField } from '../../ui/Field.tsx';
import { inviteRefusal } from '../panels/refusals.ts';
import { useEditor } from '../store.ts';
import '../../styles/panels.css';

const ACCESS_LABELS: Record<ShareAccess, string> = { view: 'Can view', markup: 'Can mark up', edit: 'Can edit' };
const STATUS_WORDS: Record<ShareView['status'], string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
/** How often the list re-reads link statuses, so an expiry shows up while the dialog is open. */
const REFRESH_MS = 1000;

const recipientOf = (share: ShareView): string => share.recipient_name || share.recipient_email;

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const drawingId = editor.drawing?.id;
  const [access, setAccess] = useState<ShareAccess>('view');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [shares, setShares] = useState<ShareView[]>([]);
  const [pending, setPending] = useState<'invite' | 'copy' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  /** Links this dialog made, by recipient, access and expiry, so a second action reuses the first link. */
  const made = useRef(new Map<string, string>());
  const ticket = useRef(0);

  const refresh = async (): Promise<ShareView[]> => {
    const mine = ++ticket.current;
    const answer = await get<{ shares: ShareView[] }>(`/api/drawings/${drawingId}/shares`);
    if (mine === ticket.current) setShares(answer.shares);
    return answer.shares;
  };

  useEffect(() => {
    if (!drawingId) return undefined;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [drawingId]);

  /** The active link for what the form says, created when this dialog has none yet. */
  const ensureLink = async (): Promise<ShareView> => {
    const key = [email.trim().toLowerCase(), access, expiry.trim()].join('|');
    const known = shares.find((share) => share.id === made.current.get(key));
    if (known?.status === 'active') return known;
    const { share } = await post<{ share: ShareView }>(`/api/drawings/${drawingId}/shares`, {
      access,
      recipient_email: email.trim(),
      recipient_name: name.trim() || undefined,
      expiry_date: expiry.trim() || null,
    });
    made.current.set(key, share.id);
    setShares((current) => [...current, share]);
    return share;
  };

  const attempt = async (action: 'invite' | 'copy', job: (share: ShareView) => Promise<void>): Promise<void> => {
    if (pending) return;
    setPending(action);
    setFieldErrors({});
    setFormError(null);
    setSent(null);
    try {
      await job(await ensureLink());
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.status === 422 && Object.keys(failure.fields).length > 0) setFieldErrors(failure.fields);
      else {
        const message = inviteRefusal(failure, email.trim());
        setFormError(message);
        editor.announce(message);
      }
    } finally {
      setPending(null);
      void refresh();
    }
  };

  const invite = (): Promise<void> =>
    attempt('invite', async (share) => {
      const answer = await post<{ invite: 'sent'; sent_to: string }>(`/api/shares/${share.id}/invite`);
      const message = `Invite sent to ${answer.sent_to}`;
      setSent(message);
      editor.announce(message);
    });

  const copyLink = (): Promise<void> =>
    attempt('copy', async (share) => {
      setLinkUrl(share.url);
      try {
        await navigator.clipboard.writeText(share.url);
        editor.announce('Link copied.');
      } catch {
        // The clipboard is unavailable or refused; the link stays visible in the Link field to copy by hand.
      }
    });

  const revoke = async (share: ShareView): Promise<void> => {
    setFormError(null);
    try {
      const { share: revoked } = await post<{ share: ShareView }>(`/api/shares/${share.id}/revoke`);
      setShares((current) => current.map((item) => (item.id === revoked.id ? revoked : item)));
      editor.announce(`Link for ${recipientOf(revoked)} revoked.`);
    } catch (failure) {
      const message = inviteRefusal(failure, share.recipient_email);
      setFormError(message);
      editor.announce(message);
    }
  };

  return (
    <Dialog label="Share drawing" onClose={onClose}>
      <h2>Share drawing</h2>
      <form noValidate className="share-form" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
        <div className="share-access">
          <span className="label" aria-hidden="true">Access</span>
          <div role="radiogroup" aria-label="Access" className="choice-row">
            {(Object.keys(ACCESS_LABELS) as ShareAccess[]).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name="share-access" checked={access === value} onChange={() => setAccess(value)} />
                <span>{ACCESS_LABELS[value]}</span>
              </label>
            ))}
          </div>
          {fieldErrors.access ? <p role="alert" className="field-error">{fieldErrors.access}</p> : null}
        </div>
        <TextField label="Recipient email" kind="email" value={email} onChange={setEmail} error={fieldErrors.recipient_email} />
        <TextField label="Recipient name" value={name} onChange={setName} error={fieldErrors.recipient_name} />
        <TextField label="Expiry date" value={expiry} onChange={setExpiry} error={fieldErrors.expiry_date} />
        {formError ? <p role="alert" className="panel-alert">{formError}</p> : null}
        {sent ? <p className="panel-success">{sent}</p> : null}
        {linkUrl ? (
          <div className="field">
            <label htmlFor="share-link-url">Link</label>
            <input id="share-link-url" className="input" readOnly value={linkUrl} onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" aria-disabled={pending !== null} onClick={() => void copyLink()}>Copy link</button>
          <button type="submit" className="btn btn-primary" aria-disabled={pending !== null}>
            {pending === 'invite' ? 'Sending invite…' : 'Send invite'}
          </button>
        </div>
      </form>
      <ul className="share-links" aria-label="Share links">
        {shares.map((share) => (
          <li key={share.id} className="panel-item">
            <p className="panel-item-text">{`${ACCESS_LABELS[share.access]} · ${recipientOf(share)} · ${STATUS_WORDS[share.status]}`}</p>
            {share.status === 'active' ? (
              <div className="panel-item-actions">
                <button type="button" className="btn btn-outline" aria-label={`Revoke link for ${recipientOf(share)}`} onClick={() => void revoke(share)}>Revoke</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
