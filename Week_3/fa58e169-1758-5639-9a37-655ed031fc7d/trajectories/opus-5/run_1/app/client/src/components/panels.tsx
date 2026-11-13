import { useState, type ReactNode } from 'react';
import type { RepeatBox } from '../../../src/domain/types';
import type { ColourWarning, NoteData, TesterData, VersionData } from '../api';
import { Dialog } from './dialog';

function Panel({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="side-panel">
      <h2 className="panel-heading">{title}</h2>
      {children}
    </div>
  );
}

export function RepeatsPanel({
  repeats,
  onTimes,
  onExpand,
}: {
  repeats: RepeatBox[];
  onTimes: (id: string, times: number) => void;
  onExpand: (id: string) => void;
}): JSX.Element {
  return (
    <Panel title="Repeats">
      <ul aria-label="Repeats" className="plain-list">
        {repeats.length === 0 ? (
          <li>No repeats yet.</li>
        ) : (
          repeats.map((box) => (
            <li key={box.id}>
              <span>{`Repeat ${box.id}`}</span>
              <input
                type="number"
                role="spinbutton"
                aria-label={`Times for ${box.id}`}
                value={box.times}
                min={2}
                max={20}
                onChange={(event) => onTimes(box.id, Number(event.target.value))}
              />
              <button type="button" onClick={() => onExpand(box.id)}>
                {`Expand repeat ${box.id}`}
              </button>
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}

export function ColourKeyPanel({
  colours,
  error,
  onAdd,
}: {
  colours: { letter: string; name: string; hex: string }[];
  error: string;
  onAdd: (name: string, hex: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#');
  return (
    <Panel title="Colour key">
      <ul aria-label="Colour key" className="plain-list">
        {colours.map((colour) => (
          <li key={colour.letter}>
            <span className="colour-chip" style={{ backgroundColor: colour.hex }} aria-hidden="true" />
            {`${colour.letter} ${colour.name}`}
          </li>
        ))}
      </ul>
      <label className="field">
        <span>Colour name</span>
        <input aria-label="Colour name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Colour hex</span>
        <input aria-label="Colour hex" value={hex} onChange={(event) => setHex(event.target.value)} />
      </label>
      <button type="button" onClick={() => onAdd(name, hex)}>
        Add colour
      </button>
      <p role="alert" aria-label="Colour error" className="alert">
        {error}
      </p>
    </Panel>
  );
}

export function RowErrorsPanel({
  errors,
  onGo,
}: {
  errors: { row: number; message: string }[];
  onGo: (row: number) => void;
}): JSX.Element {
  return (
    <Panel title="Row errors">
      <ul aria-label="Row errors" className="plain-list">
        {errors.length === 0 ? (
          <li>All rows check out.</li>
        ) : (
          errors.map((error) => (
            <li key={`${error.row}-${error.message}`} data-row={error.row}>
              <button type="button" className="error-button" onClick={() => onGo(error.row)}>
                {error.message}
              </button>
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}

export function ColourWarningsPanel({ warnings }: { warnings: ColourWarning[] }): JSX.Element {
  return (
    <Panel title="Colour warnings">
      <ul aria-label="Colour warnings" className="plain-list">
        {warnings.length === 0 ? (
          <li>No colour warnings.</li>
        ) : (
          warnings.map((warning) => (
            <li key={`${warning.row}-${warning.message}`} data-row={warning.row}>
              {warning.message}
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}

export function HereNowPanel({
  people,
  me,
}: {
  people: { id: string; name: string }[];
  me: string;
}): JSX.Element {
  const others = people.filter((person) => person.id !== me).sort((a, b) => a.name.localeCompare(b.name));
  const viewer = people.find((person) => person.id === me);
  return (
    <Panel title="Here now">
      <ul aria-label="Here now" className="plain-list">
        {viewer ? <li key={viewer.id}>{`${viewer.name} (you)`}</li> : null}
        {others.map((person) => (
          <li key={person.id}>{person.name}</li>
        ))}
      </ul>
    </Panel>
  );
}

interface VersionsPanelProps {
  versions: VersionData[];
  publishError: string;
  versionError: string;
  busy: boolean;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onCompare: () => void;
  onSaveVersion: (note: string) => Promise<void>;
  onPublish: () => void;
  onRestore: (version: number) => Promise<void>;
}

export function VersionsPanel(props: VersionsPanelProps): JSX.Element {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [restoring, setRestoring] = useState<number | null>(null);
  const next = props.versions.length + 1;

  return (
    <Panel title="Versions">
      <div className="row-of-buttons">
        <button type="button" onClick={() => setSaving(true)}>
          Save version
        </button>
        <button
          type="button"
          className="primary"
          onClick={props.onPublish}
          disabled={props.busy}
          aria-busy={props.busy}
        >
          Publish
        </button>
      </div>
      <p role="alert" aria-label="Publish error" className="alert">
        {props.publishError}
      </p>
      <div className="row-of-buttons">
        <label className="field">
          <span>From version</span>
          <select
            aria-label="From version"
            value={props.from}
            onChange={(event) => props.onFrom(event.target.value)}
          >
            {props.versions.map((version) => (
              <option key={version.version} value={String(version.version)}>
                {`Version ${version.version}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>To version</span>
          <select
            aria-label="To version"
            value={props.to}
            onChange={(event) => props.onTo(event.target.value)}
          >
            {props.versions.map((version) => (
              <option key={version.version} value={String(version.version)}>
                {`Version ${version.version}`}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={props.onCompare} disabled={props.versions.length === 0}>
          Compare
        </button>
      </div>
      <table className="table">
        <caption className="visually-hidden">Versions</caption>
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Note</th>
            <th scope="col">Saved on</th>
            <th scope="col">Stitches</th>
          </tr>
        </thead>
        <tbody>
          {props.versions.map((version) => (
            <tr key={version.version}>
              <td>{version.version}</td>
              <td>{version.note}</td>
              <td>{version.savedOn}</td>
              <td>
                <span className="figures">{version.stitches}</span>
                <button type="button" onClick={() => setRestoring(version.version)}>
                  {`Restore version ${version.version}`}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {saving ? (
        <Dialog name="Save version" onClose={() => setSaving(false)}>
          <div className="form">
            <label className="field">
              <span>Version note</span>
              <input
                aria-label="Version note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <p role="alert" aria-label="Version error" className="alert">
              {props.versionError}
            </p>
            <div className="row-of-buttons">
              <button
                type="button"
                className="primary"
                disabled={props.busy}
                aria-busy={props.busy}
                onClick={() => {
                  void props.onSaveVersion(note).then(() => {
                    setNote('');
                    setSaving(false);
                  });
                }}
              >
                Save
              </button>
              <button type="button" onClick={() => setSaving(false)}>
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {restoring !== null ? (
        <Dialog name={`Restore version ${restoring}?`} onClose={() => setRestoring(null)}>
          <p>{`This makes version ${next} from version ${restoring}. Nothing is deleted.`}</p>
          <div className="row-of-buttons">
            <button
              type="button"
              className="primary"
              disabled={props.busy}
              aria-busy={props.busy}
              onClick={() => {
                void props.onRestore(restoring).then(() => setRestoring(null));
              }}
            >
              Restore
            </button>
            <button type="button" onClick={() => setRestoring(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </Panel>
  );
}

interface TestersPanelProps {
  testers: TesterData[];
  testerError: string;
  coDesignerError: string;
  owner: boolean;
  busy: boolean;
  onInvite: (email: string) => void;
  onCoDesigner: (email: string) => void;
}

export function TestersPanel(props: TestersPanelProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [mate, setMate] = useState('');
  return (
    <Panel title="Testers">
      <label className="field">
        <span>Tester email</span>
        <input aria-label="Tester email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => props.onInvite(email)}
        disabled={props.busy}
        aria-busy={props.busy}
      >
        Invite tester
      </button>
      <p role="alert" aria-label="Tester error" className="alert">
        {props.testerError}
      </p>
      {props.owner ? (
        <>
          <label className="field">
            <span>Co-designer email</span>
            <input
              aria-label="Co-designer email"
              value={mate}
              onChange={(event) => setMate(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => props.onCoDesigner(mate)}>
            Add co-designer
          </button>
          <p role="alert" aria-label="Co-designer error" className="alert">
            {props.coDesignerError}
          </p>
        </>
      ) : null}
      <table className="table">
        <caption className="visually-hidden">Testers</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Version</th>
            <th scope="col">Row</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {props.testers.map((tester) => (
            <tr key={tester.id}>
              <td>{tester.name}</td>
              <td>{tester.version}</td>
              <td>{tester.row}</td>
              <td>{tester.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function RowNotesPanel({ notes }: { notes: NoteData[] }): JSX.Element {
  return (
    <Panel title="Row notes">
      <ul aria-label="Row notes" className="plain-list">
        {notes.map((note, index) => (
          <li key={`${note.row}-${index}`}>{`Row ${note.row}: ${note.text} (${note.tester})`}</li>
        ))}
      </ul>
    </Panel>
  );
}
