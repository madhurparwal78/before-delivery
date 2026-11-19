import { useEffect, useRef, useState } from 'react';
import { COPY } from '../copy.js';
import { RequestFailed, get, patch, uploadDocument } from '../api.js';
import { inZone } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Banner } from '../components/Banner.js';
import type { DocumentRecord, Me } from '../api.js';

export function ProfileScreen(props: { me: Me }): React.JSX.Element {
  const [displayName, setDisplayName] = useState(props.me.display_name);
  const [status, setStatus] = useState('');
  const [outage, setOutage] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = (): void => {
    void get<{ documents: DocumentRecord[] }>('/api/me/documents')
      .then((value) => setDocuments(value.documents))
      .catch(() => undefined);
  };

  useEffect(reload, []);

  const save = async (): Promise<void> => {
    setStatus(COPY.profilePending);
    try {
      await patch<Me>('/api/me', { display_name: displayName });
      setStatus(COPY.profileSaved);
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'validation') {
        setStatus(COPY.profileNameError);
        return;
      }
      throw error;
    }
  };

  const upload = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];
    if (file === undefined) {
      setStatus(COPY.documentError);
      return;
    }
    setStatus(COPY.uploadPending);
    try {
      await uploadDocument(file);
      setOutage(false);
      setStatus(COPY.documentUploaded);
      reload();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'documents_unavailable') {
        setOutage(true);
        setStatus('');
        return;
      }
      setStatus(COPY.documentError);
    }
  };

  return (
    <Shell me={props.me} path="/profile" field="slate" stickers={['coin']}>
      <h1>Profile</h1>
      {outage ? <Banner>{COPY.documentsUnavailable}</Banner> : null}
      <div className="card">
        <h2>Display name</h2>
        <div className="form-inline">
          <div>
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <button type="button" className="pill" onClick={() => void save()}>
            Save profile
          </button>
        </div>
        <span className="status" role="status" aria-live="polite" aria-label="Profile status">
          {status}
        </span>
      </div>

      <div className="card">
        <h2>ID document</h2>
        <div className="form-inline">
          <div>
            <label htmlFor="id-document">ID document</label>
            <input id="id-document" ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" />
          </div>
          <button type="button" className="pill" onClick={() => void upload()}>
            Upload ID document
          </button>
        </div>
        <div className="table-scroll">
          <table aria-label="Your documents">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>{document.filename}</td>
                  <td>{document.content_type}</td>
                  <td>{document.size_bytes}</td>
                  <td>{inZone(props.me.venue?.time_zone ?? 'UTC', document.uploaded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
