import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AssetDetail,
  AssetReadResponse,
  BulkTagResponse,
  DeprecateResponse,
  ReinstateResponse,
  UndoResponse,
} from '../../shared/api';
import type { Role, Tag } from '../../shared/domain';
import { apiJson, apiUpload, errorMessage, newIdempotencyKey } from './api';
import { COPY } from './hooks';
import { ColumnDetail } from './ColumnDetail';
import { Dialog, TagGlyphs } from './ui';

export interface AssetPaneProps {
  asset: AssetDetail | null;
  column: import('../../shared/api').ColumnReadResponse | null;
  role: Role;
  live: boolean;
  onOpenColumn: (id: string) => void;
  onAction: (text: string) => void;
  onConfirmed: () => Promise<void>;
  onRefused: () => Promise<void>;
  headingRef: React.RefObject<HTMLHeadingElement>;
  onOpenAsset: (id: string) => void;
}

/**
 * The Asset detail pane: description, certification controls with their dialogs,
 * the evidence block, the bulk tag bar and the Columns table.
 */
export function AssetPane(props: AssetPaneProps): ReactNode {
  const { asset, column, role, live, onOpenColumn, onAction, onConfirmed, onRefused, headingRef, onOpenAsset } = props;
  const writable = live && (role === 'Steward' || role === 'Admin');
  const isAdmin = role === 'Admin';

  const [dialog, setDialog] = useState<'verify' | 'deprecate' | 'reinstate' | 'suppress' | null>(null);
  const [dialogStatus, setDialogStatus] = useState('');
  const [dialogErrors, setDialogErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [uploadPending, setUploadPending] = useState(false);
  const idempotencyKey = useRef<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState<Tag>('PII');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [undoBatch, setUndoBatch] = useState<string | null>(null);
  const verifyBtnRef = useRef<HTMLButtonElement>(null);
  const deprecateBtnRef = useRef<HTMLButtonElement>(null);
  const reinstateBtnRef = useRef<HTMLButtonElement>(null);
  const applyBtnRef = useRef<HTMLButtonElement>(null);
  const columnHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // One opening, one key: each new dialog opening starts with empty fields and a new key.
    if (dialog === 'verify' || dialog === 'deprecate') {
      idempotencyKey.current = newIdempotencyKey();
    }
  }, [dialog]);

  if (!asset) {
    return (
      <section className="detail-pane" aria-label="Asset detail">
        <p className="muted detail-empty">{COPY.noAsset}</p>
      </section>
    );
  }

  const openDialog = (which: 'verify' | 'deprecate' | 'reinstate'): void => {
    setDialogErrors({});
    setDialogStatus('');
    setFile(null);
    setNote('');
    setReason('');
    setDialog(which);
  };

  const closeDialog = (): void => {
    const opener =
      dialog === 'verify' ? verifyBtnRef.current : dialog === 'deprecate' ? deprecateBtnRef.current : reinstateBtnRef.current;
    setDialog(null);
    if (opener) opener.focus();
    else headingRef.current?.focus();
  };

  /** Focus after a certification move (DP-57). */
  const focusCertification = (): void => {
    const target =
      asset.state === 'draft' && dialog === 'verify'
        ? deprecateBtnRef.current
        : asset.state === 'deprecated'
          ? reinstateBtnRef.current
          : verifyBtnRef.current;
    (target ?? headingRef.current)?.focus();
  };

  const submitVerify = async (): Promise<void> => {
    if (!file) {
      setDialogErrors({ evidence: 'Attach a PDF or text sign-off.' });
      setDialogStatus('Attach a PDF or text sign-off.');
      return;
    }
    setUploadPending(true);
    setDialogStatus(COPY.uploadingEvidence);
    const form = new FormData();
    form.append('evidence', file, file.name);
    form.append('note', note);
    const res = await apiUpload<AssetReadResponse | AssetDetail>(
      `/api/assets/${encodeURIComponent(asset.id)}/verify`,
      form,
      idempotencyKey.current
    );
    setUploadPending(false);
    if (res.status === 200) {
      onAction(`Verified. Evidence stored as ${file.name}.`);
      setDialog(null);
      await onConfirmed();
      deprecateBtnRef.current?.focus();
    } else if (res.status === 422) {
      const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
      setDialogErrors(fields);
      setDialogStatus(Object.values(fields)[0] ?? '');
    } else {
      const msg = errorMessage(res.body, 'Verification failed.');
      setDialogStatus(msg);
      if (res.status === 409 || res.status === 503) {
        onAction(msg);
      }
      await onRefused();
    }
  };

  const submitDeprecate = async (): Promise<void> => {
    setDialogStatus(COPY.saving);
    const res = await apiJson<DeprecateResponse>(
      'POST',
      `/api/assets/${encodeURIComponent(asset.id)}/deprecate`,
      { reason },
      idempotencyKey.current
    );
    if (res.status === 200) {
      onAction(`Deprecated. Downstream owner notices queued: ${res.body.notices_queued}.`);
      setDialog(null);
      await onConfirmed();
      focusCertification();
    } else if (res.status === 422) {
      const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
      setDialogErrors(fields);
      setDialogStatus(Object.values(fields)[0] ?? '');
    } else {
      setDialogStatus(errorMessage(res.body, 'Deprecation failed.'));
    }
  };

  const submitReinstate = async (): Promise<void> => {
    setDialogStatus(COPY.saving);
    const res = await apiJson<ReinstateResponse>('POST', `/api/assets/${encodeURIComponent(asset.id)}/reinstate`, {});
    if (res.status === 200) {
      onAction(`Reinstated to draft. Unsent notices cancelled: ${res.body.notices_cancelled}.`);
      setDialog(null);
      await onConfirmed();
      verifyBtnRef.current?.focus();
    } else {
      setDialogStatus(errorMessage(res.body, 'Reinstatement failed.'));
    }
  };

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBulk = async (): Promise<void> => {
    if (bulkBusy || selected.size === 0) return;
    setBulkBusy(true);
    onAction(COPY.saving);
    const res = await apiJson<BulkTagResponse>(
      'POST',
      `/api/assets/${encodeURIComponent(asset.id)}/tags/bulk`,
      { tag: bulkTag, columns: [...selected] },
      newIdempotencyKey()
    );
    setBulkBusy(false);
    if (res.status === 200) {
      const { applied, requested } = res.body;
      onAction(`${bulkTag} applied to ${applied} of ${requested} columns.`);
      setSelected(new Set());
      if (res.body.batch_id) setUndoBatch(res.body.batch_id);
      await onConfirmed();
      applyBtnRef.current?.focus();
    } else {
      onAction(errorMessage(res.body, 'The bulk apply was refused.'));
    }
  };

  const undoBulk = async (): Promise<void> => {
    if (!undoBatch) return;
    const res = await apiJson<UndoResponse>('POST', `/api/tag-batches/${undoBatch}/undo`, {});
    if (res.status === 200) {
      onAction(`Bulk tag undone on ${res.body.restored} columns.`);
      setUndoBatch(null);
      await onConfirmed();
      applyBtnRef.current?.focus();
    } else {
      onAction(errorMessage(res.body, 'The undo was refused.'));
      setUndoBatch(null);
      await onRefused();
      applyBtnRef.current?.focus();
    }
  };

  return (
    <section className="detail-pane" aria-label="Asset detail">
      <h2 className="asset-heading" tabIndex={-1} ref={headingRef}>
        {asset.id}
      </h2>
      <dl className="asset-meta">
        <div>
          <dt>Kind</dt>
          <dd>{asset.kind}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{asset.state}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{asset.owner.name}</dd>
        </div>
        {asset.terms.length > 0 && (
          <div>
            <dt>Terms</dt>
            <dd>
              {asset.terms.map((t) => (
                <span key={t.id} className="term-chip">
                  {t.name}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      <p className="asset-description">{asset.description}</p>
      {asset.deprecated_upstream !== null && (
        <div role="note" aria-label="Deprecated upstream" className="deprecated-warning">
          {COPY.deprecatedUpstream(asset.deprecated_upstream)}{' '}
          <button type="button" className="link-btn" onClick={() => onOpenAsset(asset.deprecated_upstream!)}>
            {asset.deprecated_upstream}
          </button>
        </div>
      )}
            <div className="cert-controls">
        {(live && (role === 'Steward' || role === 'Admin')) && asset.state === 'draft' && (
          <button ref={verifyBtnRef} type="button" className="btn" onClick={() => openDialog('verify')}>
            Verify
          </button>
        )}
        {(live && (role === 'Steward' || role === 'Admin')) && (asset.state === 'draft' || asset.state === 'verified') && (
          <button ref={deprecateBtnRef} type="button" className="btn" onClick={() => openDialog('deprecate')}>
            Deprecate
          </button>
        )}
        {isAdmin && asset.state === 'deprecated' && (
          <button ref={reinstateBtnRef} type="button" className="btn" onClick={() => openDialog('reinstate')}>
            Reinstate
          </button>
        )}
      </div>
      {asset.state !== 'draft' && asset.verified_at ? (
        <div className="verified-at mono">Verified at {asset.verified_at}</div>
      ) : null}
      {asset.evidence && live && role !== 'Viewer' && (
        <div className="evidence-block">
          <a className="evidence-link" href={`/api/assets/${encodeURIComponent(asset.id)}/evidence`} aria-label="Download evidence">
            {asset.evidence.filename}
          </a>
          <div className="evidence-sha mono" data-sha>
            {asset.evidence.sha256}
          </div>
        </div>
      )}
      {writable && (
        <div className="bulk-bar">
          <label className="field">
            <span className="field-label">Tag to apply</span>
            <select className="input" value={bulkTag} onChange={(e) => setBulkTag(e.target.value as Tag)} aria-label="Tag to apply">
              <option value="PII">PII</option>
              <option value="Confidential">Confidential</option>
            </select>
          </label>
          <button ref={applyBtnRef} type="button" className="btn" onClick={() => void applyBulk()} disabled={bulkBusy}>
            Apply tag to selected
          </button>
        </div>
      )}
      <table className="columns-table" aria-label="Columns">
        <thead>
          <tr>
            {writable && (
              <th scope="col" className="col-select">
                Select
              </th>
            )}
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Tags</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {asset.columns.map((c) => (
            <tr key={c.id} className={column?.id === c.id ? 'row-selected' : undefined}>
              {writable && (
                <td data-label="Select">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                    aria-label={`Select ${c.name}`}
                  />
                </td>
              )}
              <td data-label="Name">
                <button type="button" className="column-btn" onClick={() => onOpenColumn(c.id)}>
                  {c.name}
                </button>
              </td>
              <td data-label="Type" className="mono">
                {c.data_type}
              </td>
              <td data-label="Tags">
                <TagGlyphs tags={c.effective_tags} />
              </td>
              <td data-label="Samples" className="mono samples-cell">
                {c.samples.map((s, i) => (
                  <span key={i} className="sample">
                    {s}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {column && (
        <ColumnDetail
          column={column}
          role={role}
          live={live}
          onAction={onAction}
          onConfirmed={onConfirmed}
          onRefused={onRefused}
          focusHeadingRef={columnHeadingRef}
          dialogOpen={dialog === 'suppress'}
          setDialogOpen={(open) => setDialog(open ? 'suppress' : null)}
        />
      )}
      {undoBatch && (
        <button type="button" className="btn undo-btn" onClick={() => void undoBulk()}>
          Undo
        </button>
      )}
      {dialog === 'verify' && (
        <Dialog
          title="Verify asset"
          onClose={closeDialog}
          onOpen={(node) => {
            (node?.querySelector('input[type="file"]') as HTMLElement | null)?.focus();
          }}
        >
          <label className="field">
            <span className="field-label">Evidence file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt"
              className="input file-input"
              aria-label="Evidence file"
              aria-invalid={dialogErrors.evidence !== undefined}
              aria-describedby={dialogErrors.evidence !== undefined ? 'verify-evidence-error' : undefined}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {dialogErrors.evidence !== undefined && (
              <span id="verify-evidence-error" className="field-error">
                {dialogErrors.evidence}
              </span>
            )}
          </label>
          <label className="field">
            <span className="field-label">Note</span>
            <input
              type="text"
              className="input"
              aria-label="Note"
              value={note}
              aria-invalid={dialogErrors.note !== undefined}
              aria-describedby={dialogErrors.note !== undefined ? 'verify-note-error' : undefined}
              onChange={(e) => setNote(e.target.value)}
            />
            {dialogErrors.note !== undefined && (
              <span id="verify-note-error" className="field-error">
                {dialogErrors.note}
              </span>
            )}
          </label>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          {uploadPending && <div data-upload-progress="" className="upload-progress" aria-hidden="true" />}
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => void submitVerify()}>
              Verify asset
            </button>
            <button type="button" className="btn" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'deprecate' && (
        <Dialog
          title="Deprecate asset"
          onClose={closeDialog}
          onOpen={(node) => {
            (node?.querySelector('input[type="text"]') as HTMLElement | null)?.focus();
          }}
        >
          <label className="field">
            <span className="field-label">Reason</span>
            <input
              type="text"
              className="input"
              aria-label="Reason"
              value={reason}
              aria-invalid={dialogErrors.reason !== undefined}
              aria-describedby={dialogErrors.reason !== undefined ? 'deprecate-reason-error' : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            {dialogErrors.reason !== undefined && (
              <span id="deprecate-reason-error" className="field-error">
                {dialogErrors.reason}
              </span>
            )}
          </label>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => void submitDeprecate()}>
              Deprecate asset
            </button>
            <button type="button" className="btn" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'reinstate' && (
        <Dialog title="Reinstate asset" onClose={closeDialog}>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => void submitReinstate()}>
              Reinstate asset
            </button>
            <button type="button" className="btn" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
