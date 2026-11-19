import { PART_SIZE } from '../../shared/types.js';
import {
  cancelUpload,
  dismissUpload,
  pauseUpload,
  resumeUpload,
} from '../lib/uploads.js';
import { useGlobal, type UploadRow } from '../lib/store.js';

const percentOf = (row: UploadRow): number => {
  if (row.size === 0) return 0;
  const confirmed = row.confirmedParts.reduce((total, part) => {
    const start = (part - 1) * PART_SIZE;
    return total + Math.min(PART_SIZE, row.size - start);
  }, 0);
  return Math.floor((confirmed / row.size) * 100);
};

const stateText = (row: UploadRow): string => {
  switch (row.state) {
    case 'uploading':
      return `Uploading ${percentOf(row)}%`;
    case 'paused':
      return 'Paused';
    case 'waiting':
      return 'Waiting for storage';
    case 'done':
      return 'Done';
    case 'expired':
      return 'Expired';
    case 'failed':
      return 'Failed';
  }
};

export const UploadsPanel = (): JSX.Element | null => {
  const uploads = useGlobal((state) => state.uploads);
  if (uploads.length === 0) return null;
  return (
    <section aria-label="Uploads" className="uploads">
      {uploads.map((row) => (
        <div
          className={`upload-row${row.state === 'expired' ? ' expired' : ''}`}
          key={row.key}
        >
          <div>
            <span>{row.name}</span>
            <progress aria-label={row.name} value={percentOf(row)} max={100} />
            <span className="state num">{stateText(row)}</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--step)' }}>
            {row.state === 'uploading' ? (
              <button type="button" onClick={() => void pauseUpload(row.key)}>
                Pause {row.name}
              </button>
            ) : null}
            {row.state === 'paused' ? (
              <button type="button" onClick={() => void resumeUpload(row.key)}>
                Resume {row.name}
              </button>
            ) : null}
            {row.state === 'uploading' || row.state === 'paused' || row.state === 'waiting' ? (
              <button type="button" onClick={() => void cancelUpload(row.key)}>
                Cancel {row.name}
              </button>
            ) : (
              <button type="button" onClick={() => void dismissUpload(row.key)}>
                Dismiss {row.name}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
};
