import { useState, type FormEvent } from 'react';
import type { PollOpenedBody } from '../../shared/wire';
import { api, ApiError } from '../api';
import { Dialog } from '../ui/Dialog';
import { Alert } from '../ui/feedback';
import { Icon } from '../ui/icons';

const MOST_OPTIONS = 6;

export function NewPollDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setRefusal('');
    try {
      await api<PollOpenedBody>('POST', `/api/sessions/${sessionId}/polls`, { question, options });
      onClose();
    } catch (error) {
      setRefusal(error instanceof ApiError ? error.message : 'The poll could not be opened.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="New poll" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="poll-question">Question</label>
          <input id="poll-question" type="text" value={question} onChange={(event) => setQuestion(event.target.value)} autoComplete="off" />
        </div>
        {options.map((value, index) => (
          <div className="field" key={index}>
            <label htmlFor={`poll-option-${index + 1}`}>Option {index + 1}</label>
            <input
              id={`poll-option-${index + 1}`}
              type="text"
              value={value}
              autoComplete="off"
              onChange={(event) => setOptions(options.map((current, at) => (at === index ? event.target.value : current)))}
            />
          </div>
        ))}
        <p>
          <button type="button" onClick={() => setOptions([...options, ''])} disabled={options.length >= MOST_OPTIONS}>
            <Icon name="plus" size={18} />
            Add option
          </button>
        </p>
        {refusal && <Alert>{refusal}</Alert>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy} aria-busy={busy || undefined}>
            Open poll
          </button>
        </div>
      </form>
    </Dialog>
  );
}


export function StartBreakoutsDialog({ sessionId, tableCount, onClose }: { sessionId: string; tableCount: number; onClose: () => void }) {
  const [tables, setTables] = useState('2');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setRefusal('');
    try {
      await api('POST', `/api/sessions/${sessionId}/breakouts`, { tables: Number(tables) });
      onClose();
    } catch (error) {
      setRefusal(error instanceof ApiError ? error.message : 'Breakouts could not be started.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Start breakouts" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="breakout-tables">Tables</label>
          <input id="breakout-tables" type="number" inputMode="numeric" value={tables} onChange={(event) => setTables(event.target.value)} />
          <p className="hint">
            The room has {tableCount} {tableCount === 1 ? 'table' : 'tables'}. Seated learners are dealt to them in seat order.
          </p>
        </div>
        {refusal && <Alert>{refusal}</Alert>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy} aria-busy={busy || undefined}>
            Start
          </button>
        </div>
      </form>
    </Dialog>
  );
}
