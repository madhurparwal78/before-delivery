import { useEffect, useState } from 'react';
import type { CheckpointRow, LabRecord, SceneRecord, ShareLinkRow } from '../../shared/api.js';
import { emptyCopy, noticeCopy } from '../../shared/copy.js';
import { exposableKeys, MAX_EXPOSED } from '../../shared/bundle.js';
import { findSpec } from '../../shared/params.js';
import type { SceneDocument } from '../../shared/scene.js';
import { ApiFault, api } from '../api.js';
import { Dialog } from '../components/Dialog.jsx';
import { announce } from '../regions.js';

/* --------------------------------------------------------- shortcuts --- */

const SHORTCUTS: readonly [string, string][] = [
  ['R', 'Run, or Stop while running'],
  ['P', 'Pause or Resume'],
  ['N', 'Step'],
  ['Escape', 'Stop, while running and no dialog is open'],
  ['W, E, T', 'Move, Rotate, Scale'],
  ['S', 'Snap'],
  ['G', 'Grid'],
  ['F', 'frame the selected object'],
  ['Delete or Backspace', 'remove the selected object'],
  ['F2', 'rename the selected object'],
  ['Ctrl+Z or Cmd+Z', 'undo'],
  ['Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y', 'redo'],
  ['Ctrl+K or Cmd+K', 'open the command palette'],
  ['?', 'open Keyboard shortcuts'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <table>
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <td className="num">{keys}</td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dialog-actions">
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------- commands -- */

export interface Command {
  label: string;
  run: () => void;
}

export function CommandsDialog({
  commands,
  onClose,
}: {
  commands: readonly Command[];
  onClose: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const matches = commands.filter((command) =>
    command.label.toLowerCase().includes(text.trim().toLowerCase()),
  );

  return (
    <Dialog title="Commands" onClose={onClose}>
      <div className="field">
        <label htmlFor="command-input">Command</label>
        <input
          id="command-input"
          type="text"
          role="combobox"
          aria-label="Command"
          aria-expanded="true"
          aria-controls="command-list"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const chosen = matches[active];
              if (chosen) {
                onClose();
                chosen.run();
              }
            }
          }}
        />
      </div>
      <ul className="list" role="listbox" id="command-list" aria-label="Matching commands">
        {matches.map((command, index) => (
          <li
            key={command.label}
            role="option"
            aria-selected={index === active}
            style={index === active ? { background: 'var(--surface)' } : undefined}
            onClick={() => {
              onClose();
              command.run();
            }}
          >
            {command.label}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/* ------------------------------------------------------------ restore -- */

export function RestoreDialog({
  checkpoint,
  onClose,
  onRestore,
}: {
  checkpoint: CheckpointRow;
  onClose: () => void;
  onRestore: () => void;
}): JSX.Element {
  return (
    <Dialog title="Restore checkpoint" alert onClose={onClose}>
      <p>
        Restore <strong>{checkpoint.label}</strong>? The scene returns to revision{' '}
        <span className="num">{checkpoint.revision}</span> as a new revision.
      </p>
      <div className="dialog-actions">
        <button type="button" className="chip" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="chip on" onClick={onRestore}>
          Restore
        </button>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------- conflict -- */

export function ConflictDialog({
  onKeepMine,
  onUseTheirs,
}: {
  onKeepMine: () => void;
  onUseTheirs: () => void;
}): JSX.Element {
  return (
    <Dialog title="Scene changed elsewhere" alert onClose={() => undefined}>
      <p>This scene changed elsewhere while you were editing. Choose which version to keep.</p>
      <div className="dialog-actions">
        <button type="button" className="chip" onClick={onUseTheirs}>
          Use their version
        </button>
        <button type="button" className="chip on" onClick={onKeepMine}>
          Keep my changes
        </button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ publish -- */

export function PublishDialog({
  scene,
  document,
  checkpoints,
  onClose,
  onPublished,
}: {
  scene: SceneRecord;
  document: SceneDocument;
  checkpoints: readonly CheckpointRow[];
  onClose: () => void;
  onPublished: () => void;
}): JSX.Element {
  const [checkpointId, setCheckpointId] = useState(checkpoints[0]?.id ?? '');
  const [exposed, setExposed] = useState<string[]>(scene.lab?.exposed ?? []);
  const [lab, setLab] = useState<LabRecord | null>(scene.lab);
  const [problem, setProblem] = useState<string | null>(null);

  const keys = exposableKeys(document);

  const publish = async (): Promise<void> => {
    setProblem(null);
    if (checkpoints.length === 0) {
      announce('notices', noticeCopy.publishNoCheckpoint);
      return;
    }
    announce('notices', noticeCopy.publishPending);
    try {
      const response = await api<{ lab: LabRecord; delivery: 'sent' | 'queued' }>(
        `/api/scenes/${scene.id}/publish`,
        { method: 'POST', body: { checkpointId, exposed } },
      );
      setLab(response.lab);
      announce(
        'notices',
        response.delivery === 'sent'
          ? noticeCopy.published(response.lab.url)
          : noticeCopy.publishedQueued(response.lab.url),
      );
      onPublished();
    } catch (error) {
      if (!(error instanceof ApiFault)) return;
      if (error.code === 'no_checkpoint') announce('notices', noticeCopy.publishNoCheckpoint);
      else if (error.fields.exposed) setProblem(error.fields.exposed);
      else announce('notices', error.message);
    }
  };

  return (
    <Dialog title="Publish lab" wide onClose={onClose}>
      <div className="field">
        <label htmlFor="publish-checkpoint">Checkpoint</label>
        <select
          id="publish-checkpoint"
          aria-label="Checkpoint"
          value={checkpointId}
          onChange={(event) => setCheckpointId(event.target.value)}
        >
          {checkpoints.map((checkpoint) => (
            <option key={checkpoint.id} value={checkpoint.id}>
              {checkpoint.label}
            </option>
          ))}
        </select>
      </div>
      <p className="panel-title">Student controls</p>
      {keys.map((key) => {
        const [objectId, paramKey] = [key.slice(0, key.lastIndexOf('.')), key.slice(key.lastIndexOf('.') + 1)];
        const object = document.objects.find((candidate) => candidate.id === objectId);
        const spec = object ? findSpec(object.kind, paramKey) : undefined;
        if (!object || !spec) return null;
        const label = `${object.name}: ${spec.label}`;
        return (
          <label className="radio-row" key={key}>
            <input
              type="checkbox"
              aria-label={label}
              checked={exposed.includes(key)}
              onChange={(event) => {
                setExposed((current) =>
                  event.target.checked
                    ? [...current, key].slice(0, MAX_EXPOSED)
                    : current.filter((entry) => entry !== key),
                );
              }}
            />
            {label}
          </label>
        );
      })}
      {problem ? <p className="field-error">{problem}</p> : null}
      {lab ? (
        <div className="panel" style={{ marginTop: 8 }}>
          <div className="panel-body">
            <p className="num">{lab.url}</p>
            <div className="row">
              <button
                type="button"
                className="chip"
                onClick={() => {
                  void navigator.clipboard?.writeText(lab.url);
                  announce('notices', noticeCopy.copied);
                }}
              >
                Copy lab link
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  void api<{ lab: LabRecord }>(`/api/scenes/${scene.id}/lab-link/regenerate`, {
                    method: 'POST',
                  })
                    .then((response) => {
                      setLab(response.lab);
                      announce('notices', noticeCopy.labLinkRegenerated);
                      onPublished();
                    })
                    .catch((error: unknown) => {
                      if (error instanceof ApiFault) announce('notices', error.message);
                    });
                }}
              >
                Regenerate lab link
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  void api(`/api/scenes/${scene.id}/unpublish`, { method: 'POST' })
                    .then(() => {
                      setLab(null);
                      announce('notices', noticeCopy.unpublished);
                      onPublished();
                    })
                    .catch((error: unknown) => {
                      if (error instanceof ApiFault) announce('notices', error.message);
                    });
                }}
              >
                Unpublish
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
        <button type="button" className="chip publish" onClick={() => void publish()}>
          Publish lab
        </button>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------- share -- */

export function ShareDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}): JSX.Element {
  const [links, setLinks] = useState<ShareLinkRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  const load = (): void => {
    void api<{ links: ShareLinkRow[] }>(`/api/projects/${projectId}/share-links`)
      .then((response) => setLinks(response.links))
      .catch(() => setLinks([]));
  };

  useEffect(load, [projectId]);

  const create = async (withEmail: boolean): Promise<void> => {
    setEmailError(null);
    try {
      const response = await api<{ link: ShareLinkRow; delivery: 'sent' | 'queued' | null }>(
        `/api/projects/${projectId}/share-links`,
        { method: 'POST', body: withEmail ? { email } : {} },
      );
      if (!withEmail) announce('notices', noticeCopy.linkCreated);
      else
        announce(
          'notices',
          response.delivery === 'sent'
            ? noticeCopy.linkEmailed(email)
            : noticeCopy.linkEmailQueued(email),
        );
      setEmail('');
      load();
    } catch (error) {
      if (error instanceof ApiFault) setEmailError(error.fields.email ?? error.message);
    }
  };

  return (
    <Dialog title="Share project" onClose={onClose}>
      <div className="row">
        <button type="button" className="chip" onClick={() => void create(false)}>
          Create read-only link
        </button>
      </div>
      <div className="field">
        <label htmlFor="share-email">Email the link to</label>
        <input
          id="share-email"
          type="text"
          value={email}
          aria-invalid={emailError ? true : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {emailError ? <span className="field-error">{emailError}</span> : null}
      </div>
      <button type="button" className="chip" onClick={() => void create(true)}>
        Create and email link
      </button>
      <p className="panel-title" style={{ marginTop: 10 }}>
        Active links
      </p>
      {links && links.length === 0 ? <p className="empty">{emptyCopy.links}</p> : null}
      <ul className="list" aria-label="Active links">
        {(links ?? []).map((link) => (
          <li key={link.id}>
            <span className="num" style={{ flex: 1, overflowWrap: 'anywhere' }}>
              {link.url}
            </span>
            <span className="muted">Expires {link.expiresAt.slice(0, 10)}</span>
            <button
              type="button"
              className="chip"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard?.writeText(link.url);
                announce('notices', noticeCopy.copied);
              }}
            >
              Copy link
            </button>
            <button
              type="button"
              className="chip"
              aria-label="Regenerate link"
              onClick={() => {
                void api(`/api/share-links/${link.id}/regenerate`, { method: 'POST' }).then(() => {
                  announce('notices', noticeCopy.linkRegenerated);
                  load();
                });
              }}
            >
              Regenerate link
            </button>
            <button
              type="button"
              className="chip"
              aria-label="Revoke link"
              onClick={() => {
                void api(`/api/share-links/${link.id}`, { method: 'DELETE' }).then(() => {
                  announce('notices', noticeCopy.linkRevoked);
                  load();
                });
              }}
            >
              Revoke link
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
