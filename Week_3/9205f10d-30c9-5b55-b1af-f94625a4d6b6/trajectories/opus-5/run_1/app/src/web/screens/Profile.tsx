import { useState, type ReactNode } from 'react';
import { api, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import { usePolled } from '../hooks.js';
import { CREDENTIAL_OPTIONS, longDate } from '../format.js';
import type { CredentialStatus } from '../../shared/types.js';

const STATUS_WORD: Record<CredentialStatus, string> = {
  uploaded: 'Uploaded',
  verified: 'Verified',
  expired: 'Expired',
};

export function Profile(): ReactNode {
  const credentials = usePolled(() => api.myCredentials(), ['my-credentials']);
  const [credentialType, setCredentialType] = useState<string>('NIC');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    if (file === null) {
      setFieldError('Choose a certificate file.');
      return;
    }
    setPending(true);
    setFieldError('');
    setMessage('Uploading certificate…');
    try {
      await api.uploadCertificate(credentialType, file);
      setMessage('Certificate uploaded. A coordinator will verify it.');
      credentials.refresh();
    } catch (failure) {
      if (failure instanceof RequestFailed) setMessage(uploadCopy(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page">
      <h1>Profile</h1>
      <div className="two-col">
        <form
          aria-label="Upload certificate"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor="credential-type">Credential type</label>
            <select
              id="credential-type"
              value={credentialType}
              onChange={(event) => setCredentialType(event.target.value)}
            >
              {CREDENTIAL_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="certificate-file">Certificate file</label>
            <input
              id="certificate-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              aria-invalid={fieldError !== ''}
              aria-describedby={fieldError !== '' ? 'certificate-file-error' : undefined}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {fieldError !== '' ? (
              <p className="field-error" id="certificate-file-error">
                {fieldError}
              </p>
            ) : null}
          </div>
          <button type="submit" disabled={pending}>
            Upload certificate
          </button>
          <p className="live" role="status" aria-label="Upload status">
            {message}
          </p>
        </form>
        <table>
          <caption>My credentials</caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {(credentials.data?.credentials ?? []).map((credential) => (
              <tr key={credential.id}>
                <td className="num">{credential.credential_type}</td>
                <td className={credential.status === 'expired' ? 'outage' : undefined}>
                  {STATUS_WORD[credential.status]}
                </td>
                <td className="num">
                  {credential.expires_on === null ? '—' : longDate(credential.expires_on)}
                </td>
                <td className="num">{longDate(credential.uploaded_at.slice(0, 10))}</td>
              </tr>
            ))}
            {credentials.data !== null && credentials.data.credentials.length === 0 ? (
              <tr>
                <td className="empty" colSpan={4}>
                  You have no credentials on file yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function uploadCopy(failure: RequestFailed): string {
  switch (failure.code) {
    case 'payload_too_large':
      return 'That file is over 5,000,000 bytes. Choose a smaller file.';
    case 'unsupported_type':
      return 'Upload a PDF, PNG or JPEG file.';
    case 'storage_unavailable':
      return 'Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes.';
    case 'unreachable':
      return UNREACHABLE_COPY;
    default:
      return failure.fields['file'] ?? failure.fields['credential_type'] ?? failure.message;
  }
}
