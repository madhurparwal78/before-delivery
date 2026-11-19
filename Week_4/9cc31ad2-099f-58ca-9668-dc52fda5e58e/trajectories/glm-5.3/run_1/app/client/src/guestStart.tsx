// Guest start: age confirmation, starter car choice, the next-address rule.
import { useEffect, useRef, useState, type JSX } from 'react';
import { api, ApiError } from './api';
import { navigate } from './ui';
import { CARS } from '../../shared/domain';

/** The next-address rule: only /lobby/ followed by letters, digits, - or _. */
export function acceptedNext(raw: string | null): string | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/lobby/')) return null;
  const tail = decoded.slice('/lobby/'.length);
  return /^[A-Za-z0-9_-]+$/.test(tail) ? decoded : null;
}

export default function GuestStart(): JSX.Element {
  const [age, setAge] = useState(false);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [carId, setCarId] = useState('kestrel-hatch');
  const nextRef = useRef<string | null>(acceptedNext(new URLSearchParams(window.location.search).get('next')));
  const ageRef = useRef<HTMLInputElement | null>(null);
  const starters = CARS.filter(c => c.starter);

  useEffect(() => {
    // Arrow keys move the selection inside the radio group.
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.target instanceof HTMLElement && (e.target.closest('[role="radiogroup"], form') !== null))) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = starters.findIndex(c => c.carId === carId);
        setCarId(starters[(idx + 1) % starters.length].carId);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = starters.findIndex(c => c.carId === carId);
        setCarId(starters[(idx - 1 + starters.length) % starters.length].carId);
      } else if (e.key === ' ' && e.target === ageRef.current) {
        e.preventDefault();
        setAge(a => !a);
        setError(false);
      } else if (e.key === 'Enter') {
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async (): Promise<void> => {
    if (starting) return;
    if (!age) {
      setError(true);
      ageRef.current?.focus();
      return;
    }
    setStarting(true);
    try {
      await api.guests(carId);
      const next = nextRef.current;
      if (next) navigate(next, 'button[name="join"]');
      else navigate('/race?layout=saltflat-ring&mode=practice&event=guided-first-race', '[data-focus="race-hud"]');
    } catch {
      setStarting(false);
    }
  };

  return (
    <main className="guest-start" style={{ maxWidth: 520, margin: '32px auto' }}>
      <h1>Start racing</h1>
      <p>Confirm your age, pick a starter car and you are on the grid.</p>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span className="label">Age</span>
          <input
            ref={ageRef}
            type="checkbox"
            checked={age}
            onChange={() => { setAge(!age); setError(false); }}
          />{' '}
          I am 13 or older
        </label>
        {error && (
          <div className="alert" role="alert">
            Confirm you are 13 or older to play.
          </div>
        )}
        <fieldset style={{ border: '1px solid var(--rule)', margin: '16px 0', padding: '12px' }}>
          <legend className="label">Starter car</legend>
          <div role="radiogroup" aria-label="Starter car">
            {starters.map(c => (
              <label key={c.carId} className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="radio"
                  name="starter-car"
                  value={c.carId}
                  checked={carId === c.carId}
                  onChange={() => setCarId(c.carId)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const idx = starters.findIndex(x => x.carId === carId);
                      setCarId(starters[(idx + 1) % starters.length].carId);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const idx = starters.findIndex(x => x.carId === carId);
                      setCarId(starters[(idx - 1 + starters.length) % starters.length].carId);
                    }
                  }}
                  data-focus={carId === 'kestrel-hatch' ? undefined : undefined}
                />
                <span>
                  <strong>{c.name}</strong>{' '}
                  <span className="mono">class {c.class} · PI {c.pi}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={starting}>
          {starting ? 'Starting…' : 'Start racing'}
        </button>
      </form>
    </main>
  );
}
