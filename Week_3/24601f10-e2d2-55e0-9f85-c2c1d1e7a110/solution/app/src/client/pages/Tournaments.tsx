import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { FILLS, FORMATS, type Fill, type Format, type TournamentView } from '../../shared/api.js';
import { api, failureOf } from '../api.js';
import { FormatObject } from '../art/Objects.js';
import { Chrome, EmptyState } from '../components/Chrome.js';
import { Field } from '../components/Field.js';
import { FORMAT_NAMES, timeZones } from '../format.js';
import { clearError, raise } from '../notices.js';
import { Link, navigate } from '../router.js';

const STATE_LABELS: Record<TournamentView['state'], string> = {
  draft: 'Draft', checkin_open: 'Check-in open', checkin_closed: 'Check-in closed', running: 'Running', finished: 'Finished',
};

export function TournamentList(): ReactNode {
  const [tournaments, setTournaments] = useState<TournamentView[] | null>(null);
  useEffect(() => {
    void api.get<{ tournaments: TournamentView[] }>('/api/tournaments').then((body) => setTournaments(body.tournaments));
  }, []);
  return (
    <Chrome>
      <div className="stack">
        <h1 className="page-title">Your tournaments</h1>
        <Link to="/t/new" className="btn">New tournament</Link>
        {tournaments === null ? <p className="loading">Loading...</p> : tournaments.length === 0 ? (
          <EmptyState object={<FormatObject format="single_elimination" fill="lilac" label="Single elimination cup" />} text="No tournaments yet." />
        ) : (
          <ul aria-label="Your tournaments" className="plain-list big-list">
            {tournaments.map((t) => (
              <li key={t.id}>
                <Link to={`/t/${t.id}`} className="big-link">{t.name}</Link>
                <span className="meta">{`${FORMAT_NAMES[t.format]} · ${STATE_LABELS[t.state]}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Chrome>
  );
}

const FILL_LABELS: Record<Fill, string> = { lilac: 'Lilac', lemon: 'Lemon', mint: 'Mint' };

export function CreateTournament(): ReactNode {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format | ''>('');
  const [zone, setZone] = useState('UTC');
  const [fill, setFill] = useState<Fill | ''>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    clearError();
    setFields({});
    setBusy(true);
    try {
      const body = await api.post<{ tournament: TournamentView }>('/api/tournaments', { name, format, time_zone: zone, fill });
      navigate(`/t/${body.tournament.id}/setup`);
    } catch (error) {
      const failure = failureOf(error);
      setFields(failure.body.fields ?? {});
      if (!failure.body.fields) raise(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Chrome>
      <form className="form-card" onSubmit={(event) => void submit(event)}>
        <h1 className="form-title">New tournament</h1>
        <Field label="Tournament name" error={fields['name']}>
          {(props) => <input {...props} type="text" value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="field">
          <span className="field-label">Format</span>
          <div role="radiogroup" aria-label="Format" className="choices">
            {FORMATS.map((item) => (
              <label key={item} className="choice">
                <input type="radio" name="format" value={item} checked={format === item} onChange={() => setFormat(item)} />
                <span>{FORMAT_NAMES[item]}</span>
              </label>
            ))}
          </div>
          {fields['format'] ? <span className="field-error">{fields['format']}</span> : null}
        </div>
        <Field label="Time zone" error={fields['time_zone']}>
          {(props) => (
            <select {...props} value={zone} onChange={(event) => setZone(event.target.value)}>
              {timeZones().map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
        </Field>
        <div className="field">
          <span className="field-label">Trophy fill</span>
          <div role="radiogroup" aria-label="Trophy fill" className="choices">
            {FILLS.map((item) => (
              <label key={item} className="choice">
                <input type="radio" name="fill" value={item} checked={fill === item} onChange={() => setFill(item)} />
                <span>{FILL_LABELS[item]}</span>
              </label>
            ))}
          </div>
          {fields['fill'] ? <span className="field-error">{fields['fill']}</span> : null}
        </div>
        <button type="submit" className="btn" disabled={busy}>Create tournament</button>
      </form>
    </Chrome>
  );
}
