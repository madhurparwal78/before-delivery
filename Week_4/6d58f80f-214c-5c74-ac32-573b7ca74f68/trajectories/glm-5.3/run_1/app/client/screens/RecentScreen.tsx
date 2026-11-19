import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import type { DriveFile } from '../lib/types.js';
import { formatSize, formatPhoenixTime } from '../lib/format.js';

export function RecentScreen(): preact.JSX.Element {
  const [files, setFiles] = useState<DriveFile[]>([]);
  useEffect(() => {
    void api.recentFiles().then(r => setFiles(r.files)).catch(() => setFiles([]));
  }, []);
  return (
    <div class="table-wrap">
      <table class="data-table" aria-label="Recent files">
        <thead>
          <tr><th>Name</th><th>Size</th><th>Modified</th><th>Location</th></tr>
        </thead>
        <tbody>
          {files.map(f => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td class="numeric">{formatSize(f.size)}</td>
              <td class="numeric">{formatPhoenixTime(f.modifiedAt)}</td>
              <td>{f.folderName}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {files.length === 0 && <div class="empty-state">Nothing here yet.</div>}
    </div>
  );
}
