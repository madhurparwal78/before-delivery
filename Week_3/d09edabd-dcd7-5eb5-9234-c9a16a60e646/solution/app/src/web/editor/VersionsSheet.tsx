import { useEffect, useRef, useState } from 'react';
import { X } from '../ui/icons';
import { figureLine, utcStamp } from '../../shared/format';
import type { Version } from '../../shared/types';
import { Dialog } from '../ui/Dialog';
import { copyPackLink, freezeVersion, loadVersions, regenerateLink, revokeLink } from './versions';
import { closeDialog, useEditor } from './state';

function VersionCard({ version, owner, register }: { version: Version; owner: boolean; register: (id: string, element: HTMLButtonElement | null) => void }) {
  return (
    <li className="version-card" data-state={version.state}>
      <h3>Version {version.number}</h3>
      <span className="version-label">{version.label}</span>
      <span className="version-state">{version.state === 'frozen' ? 'Frozen' : 'Superseded'}</span>
      <span className="meta tabular">
        {utcStamp(version.frozenAt)} UTC · {figureLine(version.stats)}
      </span>
      <span className="actions">
        <button type="button" className="btn" disabled={!version.packUrl} ref={(element) => register(version.id, element)} onClick={() => void copyPackLink(version)}>
          Copy build pack link
        </button>
        {owner ? (
          <>
            <button type="button" className="btn" onClick={() => void regenerateLink(version)}>
              Regenerate link
            </button>
            <button type="button" className="btn" disabled={!version.packUrl} onClick={() => void revokeLink(version)}>
              Revoke link
            </button>
          </>
        ) : null}
      </span>
    </li>
  );
}

/** The Versions sheet: the freeze form (owner only) and the version cards, updated in place by live events. */
export default function VersionsSheet() {
  const open = useEditor((s) => s.dialogs.versions === true);
  const versions = useEditor((s) => s.versions);
  const me = useEditor((s) => s.me);
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const copies = useRef(new Map<string, HTMLButtonElement>());
  const owner = me?.role === 'owner';

  useEffect(() => {
    if (open) void loadVersions().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!focusOn) return;
    copies.current.get(focusOn)?.focus();
    setFocusOn(null);
  }, [focusOn, versions]);

  const freeze = async (): Promise<void> => {
    const result = await freezeVersion(label);
    setErrors(result.errors ?? {});
    if (result.version) {
      setLabel('');
      setFocusOn(result.version.id);
    }
  };

  return (
    <Dialog name="Versions" open={open} onClose={() => closeDialog('versions')} className="centered wide" initialFocus={(root) => root.querySelector<HTMLElement>('input, .version-card button')}>
      <div className="dialog-head">
        <h2>Versions</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => closeDialog('versions')}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">
        {owner ? (
          <form className="freeze-form" onSubmit={(event) => { event.preventDefault(); void freeze(); }}>
            <label className="field">
              <span>Version label</span>
              <input type="text" value={label} onChange={(event) => setLabel(event.target.value)} />
              {errors.label ? <span className="field-error">{errors.label}</span> : null}
            </label>
            <button type="submit" className="btn primary">
              Freeze version
            </button>
          </form>
        ) : null}
        <ul aria-label="Version cards" className="version-list">
          {versions.map((version) => (
            <VersionCard
              key={version.id}
              version={version}
              owner={owner}
              register={(id, element) => {
                if (element) copies.current.set(id, element);
                else copies.current.delete(id);
              }}
            />
          ))}
        </ul>
        {versions.length === 0 ? <p className="muted">Nothing is frozen yet.</p> : null}
      </div>
    </Dialog>
  );
}
