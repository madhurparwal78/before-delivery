import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock, formatDate } from '../../shared/format';
import { MESSAGES } from '../../shared/messages';
import type { VersionInfo } from '../../shared/types';
import { api, publicSettings } from '../api';
import { Dialog } from '../ui/Dialog';
import { Notice } from './controls';
import { useEditorSelector, useEditorStore } from './EditorProvider';
import { publish, usePublishing } from './publish';

function embedCode(projectId: string, name: string): string {
  return `<iframe src="${window.location.origin}/embed/${projectId}" title="${name.replace(/"/g, '&quot;')}" width="100%" height="600" style="border:0" loading="lazy"></iframe>`;
}

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const store = useEditorStore();
  const projectId = useEditorSelector((e) => e.projectId);
  const name = useEditorSelector((e) => e.project.name);
  const role = useEditorSelector((e) => e.role);
  const versionTick = useEditorSelector((e) => e.versionTick);
  const publishing = usePublishing();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const code = useRef<HTMLInputElement>(null);
  const zone = publicSettings().timeZone;
  const owner = role === 'Owner';

  const load = useCallback(async () => {
    const { versions: list } = await api.get<{ versions: VersionInfo[] }>(`/api/projects/${projectId}/versions`);
    setVersions([...list].sort((a, b) => b.number - a.number));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, versionTick]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/import/original`, { credentials: 'same-origin' }).then((response) => setImported(response.ok), () => setImported(false));
  }, [projectId]);

  const republish = async (number: number): Promise<void> => {
    setError(undefined);
    setBusyVersion(number);
    const failure = await publish(store, number);
    setBusyVersion(null);
    if (failure) setError(failure);
    else await load();
  };

  const copy = async (): Promise<void> => {
    const text = code.current?.value ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      code.current?.select();
      document.execCommand('copy');
    }
    store.actions.announce(MESSAGES.embedCopied);
  };

  return (
    <Dialog name="Versions" onClose={onClose} className="dialog-wide">
      <div className="dialog-head">
        <h2>Versions</h2>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <Notice message={error} />
      {versions.length === 0 ? <p className="muted">Not published yet.</p> : null}
      <ul role="list" aria-label="Versions" className="plain-list version-list">
        {versions.map((version) => (
          <li key={version.number} className="version-item">
            <div className="version-line">
              Version {version.number} · {formatDate(version.publishedAt, zone)} {formatClock(version.publishedAt, zone)} ·{' '}
              {version.status === 'live' ? 'Live' : version.status === 'superseded' ? 'Superseded' : 'Publishing'}
            </div>
            <div className="muted">{version.notice === 'sent' ? MESSAGES.noticeSent : MESSAGES.noticeQueued}</div>
            <div className="version-actions">
              <button type="button" className="btn btn-compact" disabled={!owner || publishing} onClick={() => void republish(version.number)}>
                {busyVersion === version.number ? MESSAGES.publishing : `Republish version ${version.number}`}
              </button>
              <a className="btn btn-compact" href={`/api/projects/${projectId}/versions/${version.number}/export`} download>
                Export version {version.number} JSON
              </a>
            </div>
          </li>
        ))}
      </ul>
      <div className="embed-card">
        <label className="field-label">
          Embed code
          <input ref={code} type="text" readOnly aria-label="Embed code" value={embedCode(projectId, name)} />
        </label>
        <button type="button" className="btn btn-compact" onClick={() => void copy()}>
          Copy embed code
        </button>
      </div>
      <div className="version-actions">
        <a className="btn btn-compact" href={`/api/projects/${projectId}/export`} download>
          Export working JSON
        </a>
        {imported && (
          <a className="btn btn-compact" href={`/api/projects/${projectId}/import/original`} download>
            Download original import
          </a>
        )}
      </div>
    </Dialog>
  );
}
