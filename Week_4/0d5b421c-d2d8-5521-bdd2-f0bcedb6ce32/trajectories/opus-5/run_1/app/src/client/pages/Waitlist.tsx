import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RulesResponse, WaitlistResponse } from '../../shared/types';
import { PartySizes } from '../components/PartySizes';
import { LiveRegion, OutageBanners, PinnedTitle } from '../components/Shell';
import { ApiFailure, apiGet, apiPost, serverNowMs } from '../lib/api';
import { COPY, bookingSummaryLine, lisbonDateNow, waitlistJoined } from '../lib/format';

export function Waitlist(): JSX.Element {
  const [params] = useSearchParams();
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const today = lisbonDateNow(serverNowMs());

  const initialParty = Number(params.get('party'));
  const [party, setParty] = useState(
    Number.isInteger(initialParty) && initialParty >= 1 && initialParty <= 8 ? initialParty : 2,
  );
  const rawDate = params.get('date');
  const [date, setDate] = useState(
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate >= today ? rawDate : today,
  );
  const [earliest, setEarliest] = useState(params.get('earliest') ?? '18:00');
  const [latest, setLatest] = useState(params.get('latest') ?? '22:00');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void apiGet<RulesResponse>('/api/rules')
      .then(setRules)
      .catch(() => undefined);
  }, []);

  const slotTimes = rules?.slot_times ?? [];

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const response = await apiPost<WaitlistResponse>('/api/waitlist', {
        date,
        party_size: party,
        earliest,
        latest,
        name: name.trim(),
        email: email.trim(),
      });
      setAnnouncement(waitlistJoined(response.position));
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 422) setErrors(failure.fields);
    } finally {
      setPending(false);
    }
  };

  const horizon = rules?.booking_horizon_days ?? 30;
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const latestDate = new Date(Date.UTC(year, month - 1, day + horizon)).toISOString().slice(0, 10);

  return (
    <div className="page waitlist">
      <OutageBanners />
      <PinnedTitle>{bookingSummaryLine(date, null, party)}</PinnedTitle>
      <LiveRegion label="Booking updates" message={announcement} />
      <form className="one-column" onSubmit={(event) => void submit(event)}>
        <PartySizes party={party} onChoose={setParty} />
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={date}
            min={today}
            max={latestDate}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Earliest time</span>
          <select value={earliest} onChange={(event) => setEarliest(event.target.value)}>
            {slotTimes.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Latest time</span>
          <select value={latest} onChange={(event) => setLatest(event.target.value)}>
            {slotTimes.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        {errors.latest ? <p className="field-error">⚠ {errors.latest}</p> : null}
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {errors.name ? <p className="field-error">⚠ {COPY.nameError}</p> : null}
        <label className="field">
          <span>Email</span>
          <input type="text" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {errors.email ? <p className="field-error">⚠ {COPY.emailError}</p> : null}
        <button type="submit" className="button button--accent" disabled={pending}>
          Join the waitlist
        </button>
      </form>
    </div>
  );
}
