import { useState, type ReactNode } from 'react';
import { api, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import { usePolled } from '../hooks.js';
import { longDate } from '../format.js';

export function Credentials(): ReactNode {
  const review = usePolled(() => api.reviewCredentials('uploaded'), ['review-credentials']);
  const [expiryByCredential, setExpiryByCredential] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState('');

  const rows = review.data?.credentials ?? [];
  const rowsEmpty = review.data !== null && rows.length === 0;

  const openFile = async (id: string): Promise<void> => {
    setPending(id);
    try {
      const link = await api.credentialFile(id);
      window.open(link.url, '_blank', 'noopener');
      setMessage('');
    } catch (failure) {
      if (failure instanceof RequestFailed) setMessage(reviewCopy(failure));
    } finally {
      setPending('');
    }
  };

  const verify = async (id: string, credential: string, name: string): Promise<void> => {
    setPending(id);
    setFieldErrors({});
    try {
      const expiresOn = expiryByCredential[id] ?? '';
      const result = await api.verifyCredential(id, expiresOn);
      setMessage(
        `Verified ${credential} for ${name}, valid through ${longDate(result.expires_on ?? expiresOn)}.`,
      );
      review.refresh();
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        if (failure.code === 'validation') {
          setFieldErrors({ [id]: failure.fields['expires_on'] ?? failure.message });
          setMessage('');
        } else setMessage(reviewCopy(failure));
      }
    } finally {
      setPending('');
    }
  };

  return (
    <main className="page">
      <h1>Credentials</h1>
      <table className="stacked-table">
        <caption>Credentials awaiting review</caption>
        <thead>
          <tr>
            <th scope="col">Interpreter</th>
            <th scope="col">Type</th>
            <th scope="col">Uploaded</th>
            <th scope="col">File</th>
            <th scope="col">Expiry date</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((credential) => {
            const name = credential.interpreter.display_name;
            const errorId = `expiry-error-${credential.id}`;
            return (
              <tr key={credential.id}>
                <td data-label="Interpreter">{name}</td>
                <td data-label="Type" className="num">
                  {credential.credential_type}
                </td>
                <td data-label="Uploaded" className="num">
                  {longDate(credential.uploaded_at.slice(0, 10))}
                </td>
                <td data-label="File">
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`View file for ${name} ${credential.credential_type}`}
                    disabled={pending === credential.id}
                    onClick={() => void openFile(credential.id)}
                  >
                    View file
                  </button>
                </td>
                <td data-label="Expiry date">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    aria-label={`Expiry date for ${name} ${credential.credential_type}`}
                    aria-invalid={fieldErrors[credential.id] !== undefined}
                    aria-describedby={fieldErrors[credential.id] !== undefined ? errorId : undefined}
                    value={expiryByCredential[credential.id] ?? ''}
                    onChange={(event) =>
                      setExpiryByCredential((current) => ({
                        ...current,
                        [credential.id]: event.target.value,
                      }))
                    }
                  />
                  {fieldErrors[credential.id] !== undefined ? (
                    <p className="field-error" id={errorId}>
                      {fieldErrors[credential.id]}
                    </p>
                  ) : null}
                </td>
                <td data-label="Action">
                  <button
                    type="button"
                    aria-label={`Verify ${name} ${credential.credential_type}`}
                    disabled={pending === credential.id}
                    onClick={() => void verify(credential.id, credential.credential_type, name)}
                  >
                    Verify
                  </button>
                </td>
              </tr>
            );
          })}
          {rowsEmpty ? (
            <tr>
              <td className="empty" colSpan={6}>
                No certificates are waiting for review.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="live" role="status" aria-label="Review status">
        {message}
      </p>
    </main>
  );
}

function reviewCopy(failure: RequestFailed): string {
  switch (failure.code) {
    case 'storage_unavailable':
      return 'Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes.';
    case 'unreachable':
      return UNREACHABLE_COPY;
    default:
      return failure.message;
  }
}
