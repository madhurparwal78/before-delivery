import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ComplianceDocument, DocumentType, MemberSummary } from '../../shared/types';
import { DOCUMENT_LABELS } from '../../shared/types';
import { stateWords } from '../../shared/format';
import { ApiFailure, api, openDocumentFile } from '../api';
import type { Session } from '../app';
import { useServices } from '../services';
import { Dialog } from '../ui/Dialog';
import { DataTable, type Column } from '../ui/DataTable';

const MEMBER_TYPES: DocumentType[] = ['insurance', 'food_handler'];
const ALL_TYPES: DocumentType[] = ['insurance', 'food_handler', 'kitchen_agreement'];

export function PapersScreen({ session }: { session: Session }): ReactNode {
  const operator = session.user.role === 'operator';
  const [documents, setDocuments] = useState<ComplianceDocument[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [type, setType] = useState<DocumentType>('insurance');
  const [expiry, setExpiry] = useState('');
  const [memberId, setMemberId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<ComplianceDocument | null>(null);
  const [reason, setReason] = useState('');
  const services = useServices();

  const reload = useCallback(() => {
    void api
      .documents()
      .then(({ documents: found }) => setDocuments(found))
      .catch(() => undefined);
  }, []);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!operator) return;
    void api
      .members(session.kitchen.id)
      .then(({ members: found }) => {
        setMembers(found);
        setMemberId((current) => current || (found[0]?.id ?? ''));
      })
      .catch(() => undefined);
  }, [operator, session.kitchen.id]);

  const say = (message: string, error = false): void => {
    setStatus(message);
    setStatusError(error);
  };

  const upload = (event: React.FormEvent): void => {
    event.preventDefault();
    setFieldErrors({});
    if (!file) {
      setFieldErrors({ file: 'Choose a file.' });
      say('Choose a file.', true);
      return;
    }
    const form = new FormData();
    form.set('type', type);
    if (type !== 'kitchen_agreement') form.set('expires_on', expiry);
    if (operator) form.set('member_id', memberId);
    form.set('file', file);
    setBusy(true);
    say('Uploading…');
    void api
      .uploadDocument(form)
      .then(({ document }) => {
        say(`Uploaded ${document.label}. It counts once the kitchen verifies it.`);
        setFile(null);
        setExpiry('');
        reload();
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof ApiFailure)) {
          say('Upload failed. Try again.', true);
          return;
        }
        const code = failure.body.error;
        if (code === 'unsupported_type') say('Upload a PDF, PNG or JPEG file.', true);
        else if (code === 'file_too_large') say('Files can be at most 5,000,000 bytes.', true);
        else if (code === 'files_unavailable')
          say('File storage is unreachable. Uploading is paused; try again shortly.', true);
        else if (code === 'validation' && failure.body.errors) {
          const errors = failure.body.errors;
          const next: Record<string, string> = {};
          if (errors.file) next.file = 'That file name is not allowed. Rename the file and try again.';
          if (errors.expires_on) next.expires_on = 'Choose an expiry date from today onward.';
          if (errors.type) next.type = errors.type;
          setFieldErrors(next);
          say(Object.values(next)[0] ?? failure.message, true);
        } else say(failure.message, true);
      })
      .finally(() => setBusy(false));
  };

  const review = (document: ComplianceDocument, action: 'verify' | 'reject', why?: string): void => {
    setBusy(true);
    say('Saving…');
    void api
      .reviewDocument(document.id, action, why)
      .then(({ document: updated }) => {
        const business = updated.business ?? document.business ?? '';
        say(
          action === 'verify'
            ? `Verified ${updated.label} for ${business}.`
            : `Rejected ${updated.label} for ${business}.`,
        );
        setRejecting(null);
        setReason('');
        reload();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.body.error === 'invalid_transition') {
          say(`This document is already ${stateWords(failure.body.from ?? '')}.`, true);
        } else if (failure instanceof ApiFailure) {
          say(failure.message, true);
        }
        setRejecting(null);
      })
      .finally(() => setBusy(false));
  };

  const openFile = (document: ComplianceDocument): void => {
    void openDocumentFile(document.id).catch((failure: unknown) => {
      if (failure instanceof ApiFailure && failure.body.error === 'files_unavailable') {
        say('File storage is unreachable. Opening documents is paused.', true);
      } else if (failure instanceof ApiFailure) {
        say(failure.message, true);
      }
    });
  };

  const baseColumns: Column<ComplianceDocument>[] = [
    { label: 'Type', render: (row) => row.label },
    ...(operator
      ? [{ label: 'Member', render: (row: ComplianceDocument) => row.business ?? '' }]
      : []),
    { label: 'Expires', render: (row) => <span className="num">{row.expires_on ?? '—'}</span> },
    {
      label: 'State',
      render: (row) => (
        <span
          className={`pill${row.state === 'expiring' ? ' lit' : ''}${row.state === 'expired' || row.state === 'rejected' ? ' bad' : ''}`}
        >
          {row.state}
        </span>
      ),
    },
    {
      label: 'File',
      render: (row) => (
        <a
          href={`/api/documents/${row.id}/file`}
          onClick={(event) => {
            event.preventDefault();
            openFile(row);
          }}
        >
          Open {row.label}
        </a>
      ),
    },
    ...(operator
      ? [
          {
            label: 'Review',
            render: (row: ComplianceDocument) =>
              row.state === 'uploaded' ? (
                <span className="actions">
                  <button type="button" disabled={busy} onClick={() => review(row, 'verify')}>
                    Verify
                  </button>
                  <button type="button" disabled={busy} onClick={() => setRejecting(row)}>
                    Reject
                  </button>
                </span>
              ) : (
                <span className="pill">reviewed</span>
              ),
          },
        ]
      : []),
  ];

  const toReview = documents.filter((document) => document.state === 'uploaded');

  return (
    <div className="page">
      <header>
        <h1>Papers</h1>
        <p>Insurance certificates and food-handler cards decide which days can be booked.</p>
      </header>

      <p role="status" aria-label="Form status" className={`status-line${statusError ? ' error' : ''}`}>
        {status}
      </p>

      {operator ? (
        <>
          <section className="section">
            <h3>Documents to review</h3>
            <DataTable
              label="Documents to review"
              columns={baseColumns}
              rows={toReview}
              rowKey={(row) => row.id}
              empty="Nothing waiting for review."
            />
          </section>
          <section className="section">
            <h3>All documents</h3>
            <DataTable
              label="All documents"
              columns={baseColumns}
              rows={documents}
              rowKey={(row) => row.id}
              empty="No documents on file."
            />
          </section>
        </>
      ) : (
        <section className="section">
          <h3>My documents</h3>
          <DataTable
            label="My documents"
            columns={baseColumns}
            rows={documents}
            rowKey={(row) => row.id}
            empty="No documents on file."
          />
        </section>
      )}

      <section className="section">
        <h3>Upload</h3>
        <form onSubmit={upload} aria-label="Upload document" style={{ maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="doc-type">Document type</label>
            <select
              id="doc-type"
              value={type}
              onChange={(event) => {
                const chosen = ALL_TYPES.find((candidate) => candidate === event.target.value);
                if (chosen) setType(chosen);
              }}
              aria-describedby={fieldErrors.type ? 'doc-type-error' : undefined}
            >
              {(operator ? ALL_TYPES : MEMBER_TYPES).map((value) => (
                <option key={value} value={value}>
                  {DOCUMENT_LABELS[value]}
                </option>
              ))}
            </select>
            {fieldErrors.type && (
              <p className="field-error" id="doc-type-error">
                {fieldErrors.type}
              </p>
            )}
          </div>

          {operator && (
            <div className="field">
              <label htmlFor="doc-member">Member</label>
              <select
                id="doc-member"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.business}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type !== 'kitchen_agreement' && (
            <div className="field">
              <label htmlFor="doc-expiry">Expiry date</label>
              <input
                id="doc-expiry"
                type="date"
                required
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                aria-describedby={fieldErrors.expires_on ? 'doc-expiry-error' : undefined}
              />
              {fieldErrors.expires_on && (
                <p className="field-error" id="doc-expiry-error">
                  {fieldErrors.expires_on}
                </p>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="doc-file">File</label>
            <input
              id="doc-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => setFile(event.target.files ? event.target.files[0] : null)}
              aria-describedby={fieldErrors.file ? 'doc-file-error' : undefined}
            />
            {fieldErrors.file && (
              <p className="field-error" id="doc-file-error">
                {fieldErrors.file}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="primary"
            disabled={busy || services.paused('upload_document')}
          >
            Upload
          </button>
        </form>
      </section>

      {rejecting && (
        <Dialog title="Reject document" onClose={() => setRejecting(null)}>
          <div className="field">
            <label htmlFor="reject-reason">Reason</label>
            <input
              id="reject-reason"
              type="text"
              aria-label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="actions">
            <button type="button" onClick={() => setRejecting(null)}>
              Back
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || reason.trim().length === 0}
              onClick={() => review(rejecting, 'reject', reason.trim())}
            >
              Reject document
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
