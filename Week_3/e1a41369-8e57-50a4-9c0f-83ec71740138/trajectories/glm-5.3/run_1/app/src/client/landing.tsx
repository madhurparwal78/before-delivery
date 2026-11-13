import { useState } from 'react';
import { navigate } from './app.js';

const SAMPLES = ['Water the plants', 'Stretch for ten minutes', 'Read one chapter'];
const FULL = 30.0;

/** The landing page: split hero with the demo quest (DP-58, DP-59). */
export function Landing() {
  const [bossHealth, setBossHealth] = useState(FULL);
  const [done, setDone] = useState<boolean[]>([false, false, false]);
  const [feed, setFeed] = useState('');

  const defeat = bossHealth <= 0;

  const tick = (i: number) => {
    if (done[i] || defeat) return;
    const newDone = [...done];
    newDone[i] = true;
    setDone(newDone);
    const remaining = Math.max(0, bossHealth - 10.0);
    setBossHealth(remaining);
    setFeed(`${SAMPLES[i]} complete: +10 experience, +1.00 gold`);
    if (remaining > 0) {
      setTimeout(() => setFeed('Boss took 10.0 damage'), 300);
    } else {
      setTimeout(() => setFeed('You landed the last blow.'), 300);
    }
  };

  const seam = Math.max(0, bossHealth / FULL) * 100;

  return (
    <main className="landing">
      <section className="hero hero-copy">
        <h1 className="hero-headline">Every chore lands a blow.</h1>
        <p className="hero-subline">
          Habits, dailies and to-dos in four lists. Finish them, earn gold, and strike a shared boss with your party.
        </p>
        <a className="btn btn-primary hero-cta" href="/signin">Start your first day</a>
      </section>
      <section className="hero hero-boss">
        <svg className="drowsewyrm" viewBox="0 0 400 220" aria-hidden="true">
          <path
            className="wyrm-line"
            d="M40 170 C 90 130, 150 190, 210 150 S 320 90, 360 130"
            fill="none"
            strokeWidth="16"
            strokeLinecap="square"
          />
          <circle className="wyrm-eye" cx="332" cy="118" r="7" />
          <path className="wyrm-fill" d="M60 190 C 110 165, 170 205, 230 175 S 330 130, 365 158 L 365 200 L 60 200 Z" />
          <path className="wyrm-fin" d="M150 120 L 175 85 L 195 118 Z" />
        </svg>
        <div className="demo-quest" role="region" aria-label="Demo quest">
          <div className="seam-panel" data-seam="panel">
            {defeat ? (
              <div className="defeat-field">
                <p className="defeat-word" aria-hidden="true">DOWN</p>
                <p className="defeat-line">You landed the last blow.</p>
              </div>
            ) : (
              <>
                <div className="seam-damage" style={{ height: `${100 - seam}%` }} aria-hidden="true" />
                <div className="seam-remaining" data-seam="remaining" style={{ height: `${seam}%` }} aria-hidden="true" />
                <p className="boss-name" aria-hidden="true">Drowsewyrm</p>
              </>
            )}
          </div>
          <meter
            className="boss-meter"
            aria-label="Demo boss health"
            min={0}
            max={30.0}
            value={defeat ? 0 : bossHealth}
          >
            {fmt(bossHealth)} / 30.0
          </meter>
          <span className="meter-value">{fmt(defeat ? 0 : bossHealth)} / 30.0</span>
          <ul className="demo-list">
            {SAMPLES.map((title, i) => (
              <li key={title} className="demo-row">
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Complete ${title}`}
                    checked={done[i]}
                    disabled={done[i] || defeat}
                    onChange={() => tick(i)}
                  />
                  <span>{title}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <p className="game-feed" role="status" aria-live="polite" aria-label="Game feed">{feed}</p>
    </main>
  );
}

function fmt(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1);
}
