import { useEffect, useState } from 'react';
import type { ExportRow, ShareRow, TitleBlockRevision } from '../../shared/api';
import { COMMAND_REFERENCE, EDITOR_SHORTCUTS } from '../../shared/commands';
import { ACCESS_LABELS, copy } from '../../shared/copy';
import { ApiFailure, errorCopy, request } from '../api';
import { announce, Dialog } from '../shell';

export function CommandReferenceDialog(props: { onClose: () => void }): JSX.Element {
  return (
    <Dialog title="Command reference" onClose={props.onClose}>
      <table className="layers-grid">
        <thead>
          <tr>
            <th scope="col">Alias</th>
            <th scope="col">Command</th>
            <th scope="col">Prompts</th>
          </tr>
        </thead>
        <tbody>
          {COMMAND_REFERENCE.map((entry) => (
            <tr key={entry.command}>
              <td>{entry.alias}</td>
              <td>{entry.command}</td>
              <td>{entry.prompts.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Keyboard shortcuts</h3>
      <ul className="list-plain">
        {EDITOR_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.keys}>
            {shortcut.keys} — {shortcut.action}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function TitleBlockDialog(props: { onClose: () => void }): JSX.Element {
  const [revisions, setRevisions] = useState<TitleBlockRevision[]>([]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = (): void => {
    void request<{ revisions: TitleBlockRevision[] }>('GET', '/api/templates/title-block-a3/revisions').then(
      (result) => setRevisions(result.revisions),
    );
  };
  useEffect(load, []);

  const add = async (): Promise<void> => {
    setErrors({});
    try {
      const result = await request<{ revision: TitleBlockRevision }>(
        'POST',
        '/api/templates/title-block-a3/revisions',
        { footer_note: note, effective_date: date },
      );
      announce(copy.announce.revisionAdded(result.revision.letter, result.revision.effective_date));
      setNote('');
      setDate('');
      load();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setErrors(failure.errors ?? { effective_date: errorCopy(failure) });
      }
    }
  };

  return (
    <Dialog title="Title block A3" onClose={props.onClose}>
      <ul className="list-plain" aria-label="Revisions">
        {revisions.map((revision) => (
          <li key={revision.letter}>
            {`Revision ${revision.letter} · ${revision.effective_date} · ${revision.footer_note}`}
          </li>
        ))}
      </ul>
      <div className="field">
        <label htmlFor="tb-note">Footer note</label>
        <input id="tb-note" value={note} onChange={(event) => setNote(event.target.value)} />
        {errors.footer_note !== undefined ? (
          <span className="field-error" role="alert">
            {errors.footer_note}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="tb-date">Effective date</label>
        <input id="tb-date" value={date} placeholder="YYYY-MM-DD" onChange={(event) => setDate(event.target.value)} />
        {errors.effective_date !== undefined ? (
          <span className="field-error" role="alert">
            {errors.effective_date}
          </span>
        ) : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => void add()}>
          Add revision
        </button>
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function ExportDialog(props: {
  drawingId: string;
  layouts: string[];
  currentLayout: string;
  isOwner: boolean;
  onClose: () => void;
}): JSX.Element {
  const [format, setFormat] = useState<'PDF' | 'DXF'>('PDF');
  const [layout, setLayout] = useState(props.currentLayout === 'Model' ? 'Model' : props.currentLayout);
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const announced = useState(new Set<string>())[0];

  const load = (): void => {
    void request<{ exports: ExportRow[] }>('GET', `/api/drawings/${props.drawingId}/exports`).then((result) => {
      setExports(result.exports);
      for (const row of result.exports) {
        if (row.state === 'stored' && !announced.has(row.id)) {
          announced.add(row.id);
          announce(copy.announce.exportReady(row.file));
        }
        if (row.state === 'failed' && !announced.has(row.id)) {
          announced.add(row.id);
          announce(copy.exports.storageDown);
        }
      }
    });
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 600);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.drawingId]);

  const start = async (): Promise<void> => {
    try {
      await request('POST', `/api/drawings/${props.drawingId}/exports`, {
        format: format.toLowerCase(),
        layout,
      });
      load();
    } catch (failure) {
      if (failure instanceof ApiFailure) announce(errorCopy(failure, 'export'));
    }
  };

  return (
    <>
      <Dialog title="Export" onClose={props.onClose}>
        <div role="radiogroup" aria-label="Format" style={{ display: 'flex', gap: '0.75rem' }}>
          {(['PDF', 'DXF'] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="export-format"
                checked={format === option}
                onChange={() => setFormat(option)}
              />{' '}
              {option}
            </label>
          ))}
        </div>
        <div className="field">
          <label htmlFor="export-layout">Layout</label>
          <select
            id="export-layout"
            aria-label="Layout"
            value={layout}
            disabled={format === 'DXF'}
            onChange={(event) => setLayout(event.target.value)}
          >
            {props.layouts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => void start()}>
            Export
          </button>
          {props.isOwner ? (
            <button type="button" className="btn btn-outline" onClick={() => setShowRevisions(true)}>
              Title block revisions
            </button>
          ) : null}
        </div>
        <ul className="list-plain" aria-label="Exports">
          {exports.map((row) => (
            <li key={row.id}>
              <span>{copy.exports.row(row.file, row.state)}</span>
              {row.state === 'stored' ? (
                <a href={`/api/exports/${row.id}/download`}>{`Download ${row.file}`}</a>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            Close
          </button>
        </div>
      </Dialog>
      {showRevisions ? <TitleBlockDialog onClose={() => setShowRevisions(false)} /> : null}
    </>
  );
}

export function ShareDialog(props: { drawingId: string; onClose: () => void }): JSX.Element {
  const [access, setAccess] = useState<'view' | 'markup' | 'edit'>('view');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = (): void => {
    void request<{ shares: ShareRow[] }>('GET', `/api/drawings/${props.drawingId}/shares`).then((result) =>
      setShares(result.shares),
    );
  };
  useEffect(load, [props.drawingId]);

  const send = async (): Promise<void> => {
    setPending(true);
    setErrors({});
    setMessage(null);
    try {
      const existing = shares.find(
        (share) =>
          share.status === 'active' &&
          share.access === access &&
          share.recipient_email.toLowerCase() === email.trim().toLowerCase(),
      );
      const share =
        existing ??
        (
          await request<{ share: ShareRow }>('POST', `/api/drawings/${props.drawingId}/shares`, {
            access,
            recipient_email: email.trim(),
            recipient_name: name.trim() === '' ? null : name.trim(),
            expiry_date: expiry.trim() === '' ? null : expiry.trim(),
          })
        ).share;
      await request('POST', `/api/shares/${share.id}/invite`, {});
      const text = copy.access.inviteSent(share.recipient_email);
      setMessage(text);
      announce(text);
      load();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        if (failure.errors !== null) setErrors(failure.errors);
        else {
          const text =
            failure.code === 'invite_cooldown'
              ? copy.access.inviteCooldown(email.trim(), Number(failure.extra.retry_after_seconds ?? 0))
              : errorCopy(failure, 'invite');
          setMessage(text);
          announce(text);
        }
      }
    } finally {
      setPending(false);
    }
  };

  const revoke = async (share: ShareRow): Promise<void> => {
    try {
      await request('POST', `/api/shares/${share.id}/revoke`, {});
      announce(copy.announce.linkRevoked(share.recipient_name));
      load();
    } catch (failure) {
      if (failure instanceof ApiFailure) announce(errorCopy(failure));
    }
  };

  const copyLink = async (): Promise<void> => {
    const share = shares.find((candidate) => candidate.status === 'active');
    if (share === undefined) return;
    await navigator.clipboard?.writeText(share.url).catch(() => undefined);
    announce(copy.announce.linkCopied);
  };

  return (
    <Dialog title="Share drawing" onClose={props.onClose}>
      {message !== null ? <p role="alert">{message}</p> : null}
      <div role="radiogroup" aria-label="Access" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {(['view', 'markup', 'edit'] as const).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="share-access"
              checked={access === option}
              onChange={() => setAccess(option)}
            />{' '}
            {ACCESS_LABELS[option]}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="share-email">Recipient email</label>
        <input id="share-email" value={email} onChange={(event) => setEmail(event.target.value)} />
        {errors.recipient_email !== undefined ? (
          <span className="field-error" role="alert">
            {errors.recipient_email}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="share-name">Recipient name</label>
        <input id="share-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="share-expiry">Expiry date</label>
        <input
          id="share-expiry"
          value={expiry}
          placeholder="YYYY-MM-DD"
          onChange={(event) => setExpiry(event.target.value)}
        />
        {errors.expiry_date !== undefined ? (
          <span className="field-error" role="alert">
            {errors.expiry_date}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={pending} onClick={() => void send()}>
          {pending ? copy.access.invitePending : 'Send invite'}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => void copyLink()}>
          Copy link
        </button>
      </div>
      <ul className="list-plain" aria-label="Share links">
        {shares.map((share) => (
          <li key={share.id}>
            <span>
              {copy.access.shareItem(
                ACCESS_LABELS[share.access],
                share.recipient_name,
                share.status === 'active' ? 'Active' : share.status === 'expired' ? 'Expired' : 'Revoked',
              )}
            </span>
            {share.status === 'active' ? (
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => void revoke(share)}
              >
                {`Revoke link for ${share.recipient_name}`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function EditConflictDialog(props: { changedCount: number; onLoadLatest: () => void }): JSX.Element {
  return (
    <Dialog title="Edit conflict" role="alertdialog" onClose={props.onLoadLatest}>
      <p>{copy.sync.conflictDialog(props.changedCount)}</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={props.onLoadLatest}>
          Load latest
        </button>
      </div>
    </Dialog>
  );
}

export function SaveAsDialog(props: {
  defaultName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(props.defaultName);
  return (
    <Dialog title="Save as" onClose={props.onClose}>
      <div className="field">
        <label htmlFor="save-as-name">File name</label>
        <input id="save-as-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => props.onSave(name)}>
          Save
        </button>
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
