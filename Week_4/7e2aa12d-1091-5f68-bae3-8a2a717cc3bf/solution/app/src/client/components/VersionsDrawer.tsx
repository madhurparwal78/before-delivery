import { useCallback, useEffect, useState } from 'react';
import type { VersionSummary } from '../../shared/types.js';
import { request } from '../lib/api.js';
import type { ApiResult } from '../lib/api.js';
import { Dialog } from './Dialog.js';
import { CloseIcon } from './Icons.js';
import { Problem } from './Dialogs.js';
import type { Outcome } from '../lib/workspace.js';

interface VersionsDrawerProps {
  layoutId: string;
  /** Bumps when the layout changes, so the list follows restores. */
  revision: number;
  onClose: () => void;
  onRestore: (number: number) => Promise<Outcome>;
  call: <T>(work: () => Promise<ApiResult<T>>) => Promise<ApiResult<T> | null>;
}

const versionLabel = (version: VersionSummary): string => `Version ${version.number}: ${version.name}`;

/** The "Versions" drawer: saved versions, a comparison of two, and restore with its own confirmation. */
export function VersionsDrawer({ layoutId, revision, onClose, onRestore, call }: VersionsDrawerProps) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [differences, setDifferences] = useState<string[]>([]);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await call(() => request<{ versions: VersionSummary[] }>('GET', `/api/layouts/${layoutId}/versions`));
    if (result?.status === 200) setVersions(result.body.versions);
  }, [call, layoutId]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const fromValue = from || String(versions[0]?.number ?? '');
  const toValue = to || String(versions.at(-1)?.number ?? '');

  const compare = async (): Promise<void> => {
    const result = await call(() => request<{ differences: string[] }>('GET', `/api/layouts/${layoutId}/compare?from=${fromValue}&to=${toValue}`));
    if (!result) return;
    if (result.status === 200) setDifferences(result.body.differences);
  };

  const options = versions.map((version) => (
    <option key={version.number} value={version.number}>
      {versionLabel(version)}
    </option>
  ));

  return (
    <Dialog label="Versions" drawer onClose={onClose}>
      {(close) => (
        <div className="drawer-body">
          <header className="drawer-head">
            <h2>Versions</h2>
            <button type="button" className="icon-button" aria-label="Close versions" onClick={close}>
              <CloseIcon />
            </button>
          </header>
          <ul aria-label="Saved versions" className="version-list">
            {versions.map((version) => (
              <li key={version.number}>
                <span>{versionLabel(version)}</span>
                <button type="button" onClick={() => setRestoring(version.number)}>
                  {`Restore version ${version.number}`}
                </button>
              </li>
            ))}
          </ul>
          {versions.length === 0 && <p className="note">No versions saved yet.</p>}
          <div className="compare">
            <label className="field">
              <span>Compare from</span>
              <select aria-label="Compare from" value={fromValue} onChange={(event) => setFrom(event.target.value)}>
                {options}
              </select>
            </label>
            <label className="field">
              <span>Compare to</span>
              <select aria-label="Compare to" value={toValue} onChange={(event) => setTo(event.target.value)}>
                {options}
              </select>
            </label>
            <button type="button" disabled={versions.length === 0} onClick={() => void compare()}>
              Compare
            </button>
          </div>
          <ul aria-label="Differences" className="differences mono">
            {differences.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
          {restoring !== null && (
            <Dialog label={`Restore version ${restoring}?`} onClose={() => setRestoring(null)}>
              {(closeConfirm) => (
                <RestoreConfirm
                  number={restoring}
                  onCancel={closeConfirm}
                  onRestore={async () => {
                    const outcome = await onRestore(restoring);
                    if (outcome.ok) closeConfirm();
                    return outcome;
                  }}
                />
              )}
            </Dialog>
          )}
        </div>
      )}
    </Dialog>
  );
}

function RestoreConfirm({ number, onCancel, onRestore }: { number: number; onCancel: () => void; onRestore: () => Promise<Outcome> }) {
  const [problem, setProblem] = useState('');
  return (
    <div>
      <h2>{`Restore version ${number}?`}</h2>
      <p>The layout returns exactly to this version. It becomes a new version, and nothing already saved is changed.</p>
      <Problem message={problem} />
      <div className="button-row end">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const outcome = await onRestore();
            if (!outcome.ok) setProblem(outcome.message);
          }}
        >
          Restore
        </button>
      </div>
    </div>
  );
}
