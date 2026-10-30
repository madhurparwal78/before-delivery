import { useCallback, useEffect, useState } from 'react';
import { apiDownload, apiGet, apiSend, apiUpload, saveBlob } from '../api';
import { useFeedback } from '../feedback';
import { Dialog } from '../components/Dialog';
import type { DocumentRow, Tenant, User } from '../types';

const KIND_LABELS: Record<DocumentRow['kind'], string> = {
  certificate_of_insurance: 'Certificate of insurance',
  food_handler_card: 'Food handler card',
  health_permit: 'Health permit',
};

const STATUS_WORDS: Record<string, string> = {
  pending_review: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const TENANT_STATUS_WORDS: Record<Tenant['status'], string> = {
  applied: 'Applied',
  documents_review: 'Documents review',
  active: 'Active',
  suspended: 'Suspended',
  offboarded: 'Offboarded',
};

const SIZE_CAP_LABEL = '5,000,000 bytes';

export function DocumentsScreen({ user }: { user: User }): JSX.Element {
  const { perform, background, fieldErrors } = useFeedback();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [kind, setKind] = useState<DocumentRow['kind']>('certificate_of_insurance');
  const [expiresOn, setExpiresOn] = useState('');
  const [holderName, setHolderName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [rejectTarget, setRejectTarget] = useState<DocumentRow | null>(null);

  const load = useCallback(
    async (announce: boolean): Promise<void> => {
      const run = async (): Promise<{ documents: DocumentRow[]; tenants: Tenant[] }> => {
        const [docs, tenantList] = await Promise.all([
          apiGet<{ documents: DocumentRow[] }>('/api/documents'),
          apiGet<{ tenants: Tenant[] }>('/api/tenants'),
        ]);
        return { documents: docs.documents, tenants: tenantList.tenants };
      };
      const result = announce
        ? await perform({ pending: 'Loading…', success: () => '', run })
        : await background({ run });
      if (result) {
        setDocuments(result.documents);
        setTenants(result.tenants);
        setTenantId((current) => current || (result.tenants[0]?.id ?? ''));
      }
    },
    [perform, background],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const ownTenant = user.tenant_id ? tenantsById.get(user.tenant_id) : null;

  const upload = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set('kind', kind);
    form.set('expires_on', expiresOn);
    form.set('holder_name', holderName);
    if (user.role === 'operator') form.set('tenant_id', tenantId);
    form.set('file', file, file.name);
    const result = await perform({
      pending: `Uploading ${file.name}…`,
      success: () => `${KIND_LABELS[kind]} uploaded. The kitchen will review it.`,
      errors: (failure) => {
        if (failure.code === 'file_too_large') return 'That file is larger than the upload limit.';
        if (failure.code === 'unsupported_file_type') {
          return 'Only PDF, JPEG or PNG files are accepted. This file is not one of them.';
        }
        if (failure.code === 'storage_unavailable') {
          return 'Document storage is unreachable. Nothing was uploaded; try again in a moment.';
        }
        return null;
      },
      run: () => apiUpload<DocumentRow>('/api/documents', form),
    });
    if (result) {
      setFile(null);
      void load(false);
    }
  };

  const openFile = async (document: DocumentRow): Promise<void> => {
    const result = await perform({
      pending: 'Opening file…',
      success: () => '',
      errors: (failure) =>
        failure.code === 'storage_unavailable'
          ? 'Document storage is unreachable. Try again in a moment.'
          : null,
      run: () => apiDownload(`/api/documents/${document.id}/file`),
    });
    if (result) saveBlob(result.blob, result.fileName);
  };

  const approve = async (document: DocumentRow): Promise<void> => {
    const business = tenantsById.get(document.tenant_id)?.business_name ?? document.tenant_id;
    await perform({
      pending: 'Approving…',
      success: () =>
        `${KIND_LABELS[document.kind]} for ${business} approved. The owner's email is queued.`,
      errors: (failure) => {
        if (failure.code === 'storage_unavailable') {
          return "Document storage is unreachable, so the file can't be checked. Nothing was approved.";
        }
        if (failure.code === 'file_missing') {
          return "The stored file can't be read. Ask the tenant to upload it again.";
        }
        return null;
      },
      run: () => apiSend<DocumentRow>('POST', `/api/documents/${document.id}/approve`, {}),
    });
    void load(false);
  };

  const reject = async (document: DocumentRow, reason: string): Promise<void> => {
    const business = tenantsById.get(document.tenant_id)?.business_name ?? document.tenant_id;
    const result = await perform({
      pending: 'Sending rejection…',
      success: () =>
        `${KIND_LABELS[document.kind]} for ${business} rejected. The owner's email is queued.`,
      errors: (failure) =>
        failure.code === 'validation_failed' ? 'Give a reason for the tenant.' : null,
      run: () =>
        apiSend<DocumentRow>('POST', `/api/documents/${document.id}/reject`, { reason }),
    });
    if (result) setRejectTarget(null);
    void load(false);
  };

  return (
    <div>
      <h1>Documents</h1>
      {ownTenant ? (
        <p>
          <span className="badge">{TENANT_STATUS_WORDS[ownTenant.status]}</span>
        </p>
      ) : null}

      <form className="panel" aria-label="Upload document" onSubmit={(event) => void upload(event)}>
        <h2>Upload document</h2>
        {user.role === 'operator' ? (
          <div className="field">
            <label htmlFor="upload-tenant">Tenant</label>
            <select
              id="upload-tenant"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.business_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="upload-kind">Document type</label>
          <select
            id="upload-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as DocumentRow['kind'])}
          >
            <option value="certificate_of_insurance">Certificate of insurance</option>
            <option value="food_handler_card">Food handler card</option>
            <option value="health_permit">Health permit</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="upload-expiry">Expiry date</label>
          <input
            id="upload-expiry"
            type="date"
            value={expiresOn}
            aria-describedby={fieldErrors['expires_on'] ? 'expiry-error' : undefined}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
          {fieldErrors['expires_on'] ? (
            <p className="field-error" id="expiry-error">
              {fieldErrors['expires_on']}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="upload-holder">Name on card</label>
          <input
            id="upload-holder"
            type="text"
            value={holderName}
            aria-describedby={fieldErrors['holder_name'] ? 'holder-error' : undefined}
            onChange={(event) => setHolderName(event.target.value)}
          />
          {fieldErrors['holder_name'] ? (
            <p className="field-error" id="holder-error">
              {fieldErrors['holder_name']}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="upload-file">Document file</label>
          <input
            id="upload-file"
            type="file"
            aria-describedby="upload-file-help"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p id="upload-file-help">PDF, JPEG or PNG, up to {SIZE_CAP_LABEL}</p>
        </div>
        <button type="submit" className="primary">
          Upload document
        </button>
      </form>

      <div className="table-wrap">
        <table role="table" aria-label="Documents">
          <thead role="rowgroup">
            <tr role="row">
              {user.role === 'operator' ? <th role="columnheader">Tenant</th> : null}
              <th role="columnheader">Type</th>
              <th role="columnheader">Name on card</th>
              <th role="columnheader">Expiry date</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">File</th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {documents.map((document) => {
              const business =
                tenantsById.get(document.tenant_id)?.business_name ?? document.tenant_id;
              const expired = document.status === 'approved' && !document.valid;
              return (
                <tr role="row" key={document.id}>
                  {user.role === 'operator' ? (
                    <td role="cell" data-label="Tenant">
                      {business}
                    </td>
                  ) : null}
                  <td role="cell" data-label="Type">
                    {KIND_LABELS[document.kind]}
                  </td>
                  <td role="cell" data-label="Name on card">
                    {document.holder_name ?? ''}
                  </td>
                  <td role="cell" data-label="Expiry date" className="num">
                    {document.expires_on}
                  </td>
                  <td role="cell" data-label="Status">
                    {expired ? 'Expired' : STATUS_WORDS[document.status]}
                  </td>
                  <td role="cell" data-label="File">
                    <a
                      href={`/api/documents/${document.id}/file`}
                      onClick={(event) => {
                        event.preventDefault();
                        void openFile(document);
                      }}
                    >
                      Open {KIND_LABELS[document.kind]}
                    </a>
                  </td>
                  <td role="cell" data-label="Actions">
                    <div className="row-actions">
                      {user.role === 'operator' && document.status === 'pending_review' ? (
                        <>
                          <button type="button" onClick={() => void approve(document)}>
                            Approve {KIND_LABELS[document.kind]} for {business}, expires{' '}
                            {document.expires_on}
                          </button>
                          <button type="button" onClick={() => setRejectTarget(document)}>
                            Reject {KIND_LABELS[document.kind]} for {business}, expires{' '}
                            {document.expires_on}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rejectTarget ? (
        <RejectDialog
          onClose={() => setRejectTarget(null)}
          onSubmit={(reason) => void reject(rejectTarget, reason)}
        />
      ) : null}
    </div>
  );
}

function RejectDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Dialog title="Reject document" onClose={onClose}>
      <div className="field">
        <label htmlFor="reject-reason">Reason</label>
        <textarea
          id="reject-reason"
          rows={3}
          style={{ width: '100%' }}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => onSubmit(reason)}>
          Send rejection
        </button>
      </div>
    </Dialog>
  );
}
