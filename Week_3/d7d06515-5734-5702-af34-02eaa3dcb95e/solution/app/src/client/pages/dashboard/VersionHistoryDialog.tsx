// dialog "Version history — <name>": stored file versions and restore (brief: Files > Restore).
import { useCallback, useEffect, useState } from 'react';
import { COPY, copy } from '../../../shared/copy.ts';
import { sizeLabel } from '../../../shared/size.ts';
import type { DrawingView, VersionItem } from '../../../shared/types.ts';
import { get, post } from '../../api.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { LoadingStrokes } from '../../ui/LoadingStrokes.tsx';
import { announce } from '../../ui/announce.tsx';
import { restoreFailure } from '../errors.ts';

interface VersionHistoryProps {
  drawing: { id: string; name: string };
  onClose: () => void;
  onRestored: () => void;
  returnFocus: () => HTMLElement | null;
}

export function VersionHistoryDialog({ drawing, onClose, onRestored, returnFocus }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ message: string; ok: boolean } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const answer = await get<{ versions: VersionItem[] }>(`/api/drawings/${drawing.id}/file-versions`);
    setVersions(answer.versions);
  }, [drawing.id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const restore = async (number: number): Promise<void> => {
    if (restoring !== null) return;
    setRestoring(number);
    setOutcome(null);
    try {
      // The edit carries the version the drawing is on now, so a concurrent change refuses it.
      const current = await get<DrawingView>(`/api/drawings/${drawing.id}`);
      const result = await post<{ file_version: number; version: number }>(
        `/api/drawings/${drawing.id}/file-versions/${number}/restore`,
        { base_version: current.version },
      );
      const message = copy.restored(number, result.file_version);
      setOutcome({ message, ok: true });
      announce(message);
      onRestored();
      await load();
    } catch (error) {
      const message = restoreFailure(error);
      setOutcome({ message, ok: false });
      announce(message);
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog label={`Version history — ${drawing.name}`} onClose={onClose} returnFocus={returnFocus} className="dialog-wide">
      <h2>Version history — {drawing.name}</h2>
      {versions === null ? <LoadingStrokes /> : null}
      {versions !== null && versions.length === 0 ? <p className="muted">{COPY.versionsEmpty}</p> : null}
      {versions !== null && versions.length > 0 ? (
        <ul aria-label="Versions" className="version-list">
          {versions.map((version) => (
            <li key={version.number}>
              <span>{copy.versionItem(version.number, version.created_label, version.actor, sizeLabel(version.size_bytes))}</span>
              <button
                type="button"
                className="btn btn-outline"
                aria-disabled={restoring !== null || undefined}
                onClick={() => void restore(version.number)}
              >
                Restore version {version.number}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {outcome ? <p className={outcome.ok ? 'success-copy' : 'form-error'}>{outcome.message}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
