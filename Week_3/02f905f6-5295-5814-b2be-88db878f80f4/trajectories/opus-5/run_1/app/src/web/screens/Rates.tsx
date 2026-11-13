import { useEffect, useState } from 'react';
import type { Kiln, KilnProfile, ProfileSegment, RateSet } from '../../shared/types';
import { formatMoney } from '../../shared/labels';
import { ApiFailure, api } from '../api';
import { Dialog, LiveRegion, quiet, type LiveMessage } from '../components/bits';

interface EditState {
  kiln: Kiln;
  profile: KilnProfile;
  segments: ProfileSegment[];
  coolDown: number;
}

function studioToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

export function RatesScreen(): JSX.Element {
  const [history, setHistory] = useState<RateSet[]>([]);
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [bisque, setBisque] = useState('');
  const [glaze, setGlaze] = useState('');
  const [discount, setDiscount] = useState('10');
  const [minimum, setMinimum] = useState('3.00');
  const [effective, setEffective] = useState(studioToday());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LiveMessage>(quiet);
  const [profileResult, setProfileResult] = useState<LiveMessage>(quiet);
  const [edit, setEdit] = useState<EditState | null>(null);

  const load = (): void => {
    void api.get<RateSet[]>('/api/rates').then((sets) => {
      setHistory(sets);
      const current = sets[0];
      if (current) {
        setBisque((previous) => (previous === '' ? current.bisque_rate : previous));
        setGlaze((previous) => (previous === '' ? current.glaze_rate : previous));
      }
    });
    void api.get<Kiln[]>('/api/kilns').then(setKilns);
  };

  useEffect(load, []);

  const saveRates = async (): Promise<void> => {
    setResult({ text: 'Saving rates…', tone: 'pending' });
    setFields({});
    try {
      const saved = await api.post<RateSet>('/api/rates', {
        bisque_rate: bisque,
        glaze_rate: glaze,
        member_discount_percent: Number(discount),
        order_minimum_cents: Math.round(Number(minimum) * 100),
        effective_date: effective,
      });
      setResult({
        text: `Rates saved. They apply to pieces accepted from ${saved.effective_date}.`,
        tone: 'good',
      });
      load();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        setResult({ text: 'Check these fields', tone: 'bad' });
      } else if (error instanceof ApiFailure && error.body.error === 'rate_date_taken') {
        setResult({ text: `Rates already set for ${effective}.`, tone: 'bad' });
      } else {
        setResult({ text: 'The studio server is unreachable.', tone: 'bad' });
      }
    }
  };

  const saveProfile = async (state: EditState): Promise<void> => {
    setProfileResult({ text: 'Saving profile…', tone: 'pending' });
    try {
      await api.put(`/api/kilns/${state.kiln.id}/profiles/${state.profile.id}`, {
        segments: state.segments,
        cool_down_hours: state.coolDown,
      });
      setProfileResult({
        text: 'Profile saved. It applies to firings started from now on.',
        tone: 'good',
      });
      setEdit(null);
      load();
    } catch (error) {
      setProfileResult({
        text:
          error instanceof ApiFailure && error.status === 422
            ? Object.values(error.fields)[0] ?? 'Check the profile'
            : 'The studio server is unreachable.',
        tone: 'bad',
      });
    }
  };

  return (
    <section>
      <h1>Rates</h1>
      <form
        className="pane"
        aria-label="Firing rates"
        onSubmit={(event) => {
          event.preventDefault();
          void saveRates();
        }}
      >
        <h2>Firing rates</h2>
        <div className="field">
          <label htmlFor="rate-bisque">Bisque rate ($ per in³)</label>
          <input
            id="rate-bisque"
            type="text"
            inputMode="decimal"
            value={bisque}
            onChange={(event) => setBisque(event.target.value)}
          />
          {fields.bisque_rate && <p className="field-error">{fields.bisque_rate}</p>}
        </div>
        <div className="field">
          <label htmlFor="rate-glaze">Glaze rate ($ per in³)</label>
          <input
            id="rate-glaze"
            type="text"
            inputMode="decimal"
            value={glaze}
            onChange={(event) => setGlaze(event.target.value)}
          />
          {fields.glaze_rate && <p className="field-error">{fields.glaze_rate}</p>}
        </div>
        <div className="field">
          <label htmlFor="rate-discount">Member discount (%)</label>
          <input
            id="rate-discount"
            type="number"
            min="0"
            max="50"
            step="1"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
          {fields.member_discount_percent && (
            <p className="field-error">{fields.member_discount_percent}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rate-minimum">Order minimum ($)</label>
          <input
            id="rate-minimum"
            type="text"
            inputMode="decimal"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
          />
          {fields.order_minimum_cents && (
            <p className="field-error">{fields.order_minimum_cents}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rate-effective">Effective date</label>
          <input
            id="rate-effective"
            type="date"
            value={effective}
            onChange={(event) => setEffective(event.target.value)}
          />
          {fields.effective_date && <p className="field-error">{fields.effective_date}</p>}
        </div>
        <button type="submit" className="primary">
          Save rates
        </button>
        <LiveRegion name="Rates result" message={result} />
      </form>

      <div className="pane">
        <table aria-label="Rate history">
          <caption>Rate history</caption>
          <thead>
            <tr>
              <th scope="col">Effective</th>
              <th scope="col">Bisque</th>
              <th scope="col">Glaze</th>
              <th scope="col">Discount</th>
              <th scope="col">Minimum</th>
            </tr>
          </thead>
          <tbody>
            {history.map((set) => (
              <tr key={set.id}>
                <td className="mono">{set.effective_date}</td>
                <td className="mono">${set.bisque_rate} per in³</td>
                <td className="mono">${set.glaze_rate} per in³</td>
                <td className="mono">{set.member_discount_percent}%</td>
                <td className="mono">${formatMoney(set.order_minimum_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pane" role="region" aria-label="Kiln profiles">
        <h2>Kiln profiles</h2>
        {kilns.map((kiln) => (
          <div className="card" key={kiln.id}>
            <h3>{kiln.name}</h3>
            {kiln.profiles.map((profile) => (
              <p key={profile.id}>
                {profile.name} — <span className="mono">cone {profile.cone}</span>,{' '}
                <span className="mono">{profile.firing_hours} h</span> firing,{' '}
                <span className="mono">{profile.cool_down_hours} h</span> cool-down{' '}
                <button
                  type="button"
                  onClick={() => {
                    setProfileResult(quiet);
                    setEdit({
                      kiln,
                      profile,
                      segments: profile.segments.map((segment) => ({ ...segment })),
                      coolDown: profile.cool_down_hours,
                    });
                  }}
                >
                  Edit {profile.name} on {kiln.name}
                </button>
              </p>
            ))}
          </div>
        ))}
        {!edit && <LiveRegion name="Profile result" message={profileResult} />}
      </div>

      {edit && (
        <Dialog name="Edit profile" onClose={() => setEdit(null)}>
          <h2>
            {edit.profile.name} on {edit.kiln.name}
          </h2>
          {edit.segments.map((segment, index) => (
            <div className="coord-grid" key={index}>
              <div className="field">
                <label htmlFor={`segment-rate-${index}`}>Rate (°F per hour)</label>
                <input
                  id={`segment-rate-${index}`}
                  type="number"
                  value={segment.rate_f_per_hour}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      segments: edit.segments.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, rate_f_per_hour: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`segment-target-${index}`}>Target (°F)</label>
                <input
                  id={`segment-target-${index}`}
                  type="number"
                  value={segment.target_f}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      segments: edit.segments.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, target_f: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`segment-hold-${index}`}>Hold (minutes)</label>
                <input
                  id={`segment-hold-${index}`}
                  type="number"
                  value={segment.hold_minutes}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      segments: edit.segments.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, hold_minutes: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
          <p>
            <button
              type="button"
              onClick={() =>
                setEdit({
                  ...edit,
                  segments: [
                    ...edit.segments,
                    { rate_f_per_hour: 100, target_f: 1000, hold_minutes: 0 },
                  ],
                })
              }
            >
              Add segment
            </button>
          </p>
          <div className="field">
            <label htmlFor="cool-down">Cool-down (hours)</label>
            <input
              id="cool-down"
              type="number"
              min="1"
              max="72"
              value={edit.coolDown}
              onChange={(event) => setEdit({ ...edit, coolDown: Number(event.target.value) })}
            />
          </div>
          <p>
            <button type="button" className="primary" onClick={() => void saveProfile(edit)}>
              Save profile
            </button>
          </p>
          <LiveRegion name="Profile result" message={profileResult} />
        </Dialog>
      )}
    </section>
  );
}
