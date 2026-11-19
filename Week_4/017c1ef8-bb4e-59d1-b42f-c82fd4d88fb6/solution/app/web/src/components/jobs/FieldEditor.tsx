import { useEffect, useId, useRef, useState } from 'react';
import { announce } from '../../announce';
import { ApiError, api } from '../../api';
import { useConfig } from '../../clock';
import { firstName, instantToZonedText, zonedTextToInstant } from '../../format';
import { Alert, Button } from '../../ui';
import { SOMETHING_WENT_WRONG, WORKPLACES, WORKPLACE_LABELS, fieldMessages } from './jobModel';

export type ScalarField = 'title' | 'location' | 'workplace' | 'closes_at' | 'description';

const FIELD_LABELS: Record<ScalarField, string> = { title: 'Title', location: 'Location', workplace: 'Workplace', closes_at: 'Closes', description: 'Description' };

interface Conflict {
  by: string;
  current: string;
  version: number;
}

interface FieldEditorProps {
  jobId: string;
  field: ScalarField;
  /** The stored value and version as the server last reported them. */
  server: { value: string; version: number };
  /** Set when another editor saved a newer version: who did. */
  savedBy: string | null;
  /** Another editor is typing here. */
  typing: string | null;
}

const TYPING_SIGNAL_MS = 1000;

/** One job field: saves on blur (and on Enter for a single line), meets conflicts, follows other editors. */
export function FieldEditor({ jobId, field, server, savedBy, typing }: FieldEditorProps) {
  const { time_zone: zone } = useConfig();
  const show = (value: string): string => (field === 'closes_at' ? instantToZonedText(value, zone) : value);
  const id = useId();
  const [text, setText] = useState(show(server.value));
  const [saved, setSaved] = useState(show(server.value));
  const [version, setVersion] = useState(server.version);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [message, setMessage] = useState('');
  const [alert, setAlert] = useState('');
  const [newVersionBy, setNewVersionBy] = useState<string | null>(null);
  const saving = useRef(false);
  const lastSignal = useRef(Number.NEGATIVE_INFINITY);
  const dirty = text !== saved;

  // A value another editor saved replaces ours when we have no unsaved change; otherwise we keep ours and note it.
  useEffect(() => {
    if (server.version <= version) return;
    if (!dirty) {
      setText(show(server.value));
      setSaved(show(server.value));
      setVersion(server.version);
      setNewVersionBy(null);
    } else if (savedBy) setNewVersionBy(savedBy);
  }, [server.version]);

  const save = async (value: string, sentVersion: number): Promise<void> => {
    if (saving.current) return;
    let stored: string = value;
    if (field === 'closes_at') {
      const instant = zonedTextToInstant(value, zone);
      if (!instant) {
        setMessage('Use YYYY-MM-DD HH:MM.');
        return;
      }
      stored = instant;
    }
    saving.current = true;
    setMessage('');
    setAlert('');
    try {
      const result = await api.patch<{ version: number }>(`/api/jobs/${jobId}/fields/${field}`, { value: stored, version: sentVersion });
      setVersion(result.version);
      setSaved(value);
      setNewVersionBy(null);
      announce('Jobs announcements', `${FIELD_LABELS[field]} saved.`);
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'field_conflict') {
        const by = error.body.by as { name: string };
        setConflict({ by: by.name, current: show(error.body.current as string), version: error.body.current_version as number });
      } else if (error instanceof ApiError && error.body.error === 'validation') setMessage(fieldMessages(error)[field] ?? SOMETHING_WENT_WRONG);
      else setAlert(SOMETHING_WENT_WRONG);
    } finally {
      saving.current = false;
    }
  };

  const commit = (value = text): void => {
    if (conflict || value === saved) return;
    void save(value, version);
  };

  const signalTyping = (): void => {
    const at = performance.now();
    if (at - lastSignal.current < TYPING_SIGNAL_MS) return;
    lastSignal.current = at;
    void api.post(`/api/jobs/${jobId}/editor/typing`, { field }).catch(() => undefined);
  };

  const note = newVersionBy ? `${firstName(newVersionBy)} saved a new version` : typing ? `${firstName(typing)} is typing here` : '';
  const noteId = `${id}-note`;
  const label = FIELD_LABELS[field];
  const common = { id, 'aria-describedby': noteId, 'aria-invalid': message ? true : undefined };

  return (
    <div className="field editor-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {field === 'description' ? (
        <textarea
          {...common}
          className="input"
          rows={6}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            signalTyping();
          }}
          onBlur={() => commit()}
        />
      ) : field === 'workplace' ? (
        <select
          {...common}
          className="input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            commit(event.target.value);
          }}
        >
          {WORKPLACES.map((value) => (
            <option key={value} value={value}>
              {WORKPLACE_LABELS[value]}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          className="input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            signalTyping();
          }}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
      )}
      {message ? <p className="field-message">{message}</p> : null}
      <p id={noteId} className="field-note muted" data-field-note data-field={field}>
        {note}
      </p>
      <Alert>{alert}</Alert>
      {conflict ? (
        <div role="alert" className="alert">
          <p>{`${conflict.by} changed this field while you were editing.`}</p>
          <div className="row">
            <Button
              onClick={() => {
                setText(conflict.current);
                setSaved(conflict.current);
                setVersion(conflict.version);
                setNewVersionBy(null);
                setConflict(null);
              }}
            >
              Use theirs
            </Button>
            <Button
              onClick={() => {
                const sentVersion = conflict.version;
                setConflict(null);
                setVersion(sentVersion);
                void save(text, sentVersion);
              }}
            >
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
