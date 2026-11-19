import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CARS, STARTER_CAR_IDS } from '../../shared/catalogue.js';
import { acceptedNextPath } from '../../shared/next-path.js';
import { apiPost } from '../api.js';
import { Page } from '../components/Page.js';
import { copy } from '../copy.js';
import { GUIDED_FIRST_RACE_ADDRESS } from '../race-address.js';
import { navigate, useLocation } from '../router.js';
import { refreshMe } from '../store.js';

const STARTERS = STARTER_CAR_IDS.map((carId) => CARS.find((car) => car.carId === carId)!);

export function GuestStart() {
  const location = useLocation();
  const [confirmed, setConfirmed] = useState(false);
  const [carId, setCarId] = useState<string>(STARTERS[0]!.carId);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const ageBox = useRef<HTMLInputElement>(null);
  const next = acceptedNextPath(new URLSearchParams(location.search).get('next'));

  useEffect(() => {
    document.title = 'Kerbline';
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) {
      setError(true);
      ageBox.current?.focus();
      return;
    }
    setError(false);
    setSending(true);
    const result = await apiPost<{ playerId: string }>('/v1/guests', {
      ageConfirmed: true,
      starterCarId: carId,
    });
    if (result.kind !== 'ok') {
      setSending(false);
      return;
    }
    await refreshMe();
    navigate(next ?? GUIDED_FIRST_RACE_ADDRESS);
  };

  return (
    <Page gutter={['Age', 'Car', 'Start']} brandOnly>
      <h1>Kerbline</h1>
      <p>
        Short sessions, kept progress. Every ranked time is replayed on the server before it
        counts.
      </p>
      <form className="stack" onSubmit={submit}>
        {error && (
          <div role="alert" className="cell">
            {copy.ageError}
          </div>
        )}
        <label className="choice">
          <input
            ref={ageBox}
            type="checkbox"
            checked={confirmed}
            aria-label="I am 13 or older"
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I am 13 or older
        </label>
        <fieldset role="radiogroup" aria-label="Starter car" className="cell stack">
          <legend className="label">Starter car</legend>
          {STARTERS.map((car) => (
            <label className="choice" key={car.carId}>
              <input
                type="radio"
                name="starter"
                value={car.carId}
                aria-label={car.name}
                checked={carId === car.carId}
                onChange={() => setCarId(car.carId)}
              />
              <span>
                {car.name} · class {car.class} · <span className="mono">PI {car.pi}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit" className="primary" disabled={sending}>
            {sending ? copy.starting : 'Start racing'}
          </button>
        </div>
      </form>
    </Page>
  );
}
