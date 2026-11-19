import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { useStore, store } from '../lib/store.js';
import { announce } from '../components/Announcements.tsx';
import type { UploadItem } from '../lib/types.js';
import { Icon } from './Icon.tsx';

interface ManagedUpload {
  id: string;
  name: string;
  file: File | null;
  state: 'starting' | 'uploading' | 'paused' | 'waiting' | 'done' | 'cancelled' | 'expired';
  progress: number;
  serverState: UploadItem | null;
}

const PART_SIZE = 5_242_880;

export function UploadsPanel({ openFolderId }: { openFolderId: string | null }): preact.JSX.Element {
  const services = useStore(s => s.services);
  const [uploads, setUploads] = useState<ManagedUpload[]>([]);
  const running = useRef(new Map<string, { cancel: boolean }>());

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.uploads();
        setUploads(res.uploads.map(u => ({
          id: u.id,
          name: u.name,
          file: null,
          state: u.state === 'paused' ? 'paused' : u.state === 'abandoned' ? 'expired' : 'uploading',
          progress: (u.confirmedParts.length / u.partCount) * 100,
          serverState: u,
        })));
      } catch { /* none */ }
    })();
  }, []);

  useEffect(() => {
    if (services.storage === 'up') {
      setUploads(prev => prev.map(u => u.state === 'waiting' ? { ...u, state: 'uploading' } : u));
    }
  }, [services.storage]);

  const startUpload = async (file: File, folderId: string): Promise<void> => {
    if (services.storage === 'down') {
      announce('File storage is unreachable. Uploads are paused and previews are unavailable until it returns.');
      setUploads(prev => [...prev, { id: `local-${Date.now()}`, name: file.name, file, state: 'waiting', progress: 0, serverState: null }]);
      return;
    }
    const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let upload: UploadItem;
    try {
      const res = await api.createUpload(folderId, file.name, file.size, file.type || 'application/octet-stream', key);
      upload = res.upload;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'storage_unavailable') {
        announce('File storage is unreachable. Uploads are paused and previews are unavailable until it returns.');
      } else {
        announce('Something went wrong. Nothing was changed.');
      }
      return;
    }
    const managed: ManagedUpload = { id: upload.id, name: file.name, file, state: 'uploading', progress: 0, serverState: upload };
    setUploads(prev => [...prev, managed]);
    void pump(managed, file);
  };

  const pump = async (initial: ManagedUpload, file: File): Promise<void> => {
    const token = { cancel: false };
    running.current.set(initial.id, token);
    let current = initial;
    while (!token.cancel) {
      if (current.state === 'paused' || current.state === 'expired') break;
      if (current.state === 'waiting') { await sleep(1000); continue; }
      const server = current.serverState;
      if (!server) break;
      const nextPart = findNextPart(server);
      if (nextPart === null) {
        try {
          const done = await api.completeUpload(server.id);
          announce(`Uploaded ${done.file.name}`);
          setUploads(prev => prev.map(u => u.id === server.id ? { ...u, state: 'done', progress: 100 } : u));
          const foldersRes = await api.folders();
          store.set({ folders: foldersRes.folders });
          try { const st = await api.storage(); store.set({ storage: st }); } catch { /* ignore */ }
          document.dispatchEvent(new CustomEvent('lintel:refresh-folder'));
          break;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === 'storage_unavailable') {
            setUploads(prev => prev.map(u => u.id === server.id ? { ...u, state: 'waiting' } : u));
            current = { ...current, state: 'waiting' };
            continue;
          }
          if (code === 'upload_abandoned' || code === 'upload_cancelled') {
            setUploads(prev => prev.map(u => u.id === server.id ? { ...u, state: 'expired' } : u));
            announce(`Upload of ${server.name} expired`);
            break;
          }
          break;
        }
      }
      const slice = file.slice((nextPart - 1) * PART_SIZE, Math.min(nextPart * PART_SIZE, file.size));
      const bytes = await slice.arrayBuffer();
      try {
        const res = await api.uploadPart(server.id, nextPart, bytes);
        const confirmed = res.upload.confirmedParts.length;
        setUploads(prev => prev.map(u => u.id === server.id ? {
          ...u,
          serverState: res.upload,
          progress: Math.min(100, (confirmed / res.upload.partCount) * 100),
          state: u.state === 'paused' ? 'paused' : 'uploading',
        } : u));
        current = { ...current, serverState: res.upload, state: 'uploading' };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'storage_unavailable') {
          setUploads(prev => prev.map(u => u.id === server.id ? { ...u, state: 'waiting' } : u));
          current = { ...current, state: 'waiting' };
          continue;
        }
        if (code === 'upload_paused') { break; }
        if (code === 'upload_abandoned' || code === 'upload_cancelled') {
          setUploads(prev => prev.map(u => u.id === server.id ? { ...u, state: 'expired' } : u));
          announce(`Upload of ${server.name} expired`);
          break;
        }
        break;
      }
    }
    running.current.delete(initial.id);
  };

  const pause = async (u: ManagedUpload): Promise<void> => {
    try {
      await api.pauseUpload(u.id);
      const token = running.current.get(u.id);
      if (token) token.cancel = true;
      setUploads(prev => prev.map(x => x.id === u.id ? { ...x, state: 'paused' } : x));
    } catch { /* ignore */ }
  };

  const resume = async (u: ManagedUpload): Promise<void> => {
    if (!u.file) {
      announce('This upload has expired on this device.');
      return;
    }
    try {
      const res = await api.resumeUpload(u.id);
      setUploads(prev => prev.map(x => x.id === u.id ? { ...x, state: 'uploading', serverState: res.upload } : x));
      void pump({ ...u, state: 'uploading', serverState: res.upload }, u.file);
    } catch { /* ignore */ }
  };

  const cancel = async (u: ManagedUpload): Promise<void> => {
    const token = running.current.get(u.id);
    if (token) token.cancel = true;
    try {
      await api.cancelUpload(u.id);
      announce(`Cancelled upload of ${u.name}`);
      setUploads(prev => prev.filter(x => x.id !== u.id));
    } catch { /* ignore */ }
  };

  const dismiss = (u: ManagedUpload): void => {
    setUploads(prev => prev.filter(x => x.id !== u.id));
  };

  if (uploads.length === 0) return <></>;

  return (
    <div class="uploads-panel" role="region" aria-label="Uploads">
      <h3>Uploads</h3>
      {uploads.map(u => (
        <div key={u.id} class="upload-row">
          <progress value={u.progress} max={100} aria-label={u.name} />
          <span class="uname">{u.name}</span>
          <span class={`ustate${u.state === 'waiting' || u.state === 'expired' ? ' ' + u.state : ''}`}>
            {u.state === 'uploading' && `Uploading ${Math.floor(u.progress)}%`}
            {u.state === 'paused' && 'Paused'}
            {u.state === 'waiting' && 'Waiting for storage'}
            {u.state === 'done' && 'Done'}
            {u.state === 'expired' && 'Expired'}
          </span>
          <span class="uactions">
            {(u.state === 'uploading' || u.state === 'waiting') && <button type="button" aria-label={`Pause ${u.name}`} onClick={() => void pause(u)}>Pause</button>}
            {u.state === 'paused' && <button type="button" aria-label={`Resume ${u.name}`} onClick={() => void resume(u)}>Resume</button>}
            {(u.state === 'uploading' || u.state === 'paused' || u.state === 'waiting') && <button type="button" aria-label={`Cancel ${u.name}`} onClick={() => void cancel(u)}>Cancel</button>}
            {u.state === 'done' && <button type="button" aria-label={`Dismiss ${u.name}`} onClick={() => dismiss(u)}>Dismiss</button>}
            {u.state === 'expired' && <button type="button" aria-label={`Dismiss ${u.name}`} onClick={() => dismiss(u)}>Dismiss</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

function findNextPart(server: UploadItem): number | null {
  for (let i = 1; i <= server.partCount; i++) {
    if (!server.confirmedParts.includes(i)) return i;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
