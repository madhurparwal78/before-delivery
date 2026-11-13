import { useState } from 'react';
import { tenths1 } from '../../shared/format.js';
import { announce } from '../store.js';
import { navigate } from '../router.js';
import { HealthSeam } from '../components/HealthSeam.js';
import { Meter } from '../components/Meters.js';

const DEMO_FULL = 30;
const DEMO_DAMAGE = 10;
const SAMPLES = ['Water the plants', 'Stretch for ten minutes', 'Read one chapter'];

/** The sleepy serpent, drawn in blush lines and fills only. */
function Drowsewyrm(): JSX.Element {
  return (
    <svg className="serpent" viewBox="0 0 320 200" role="img" aria-label="The Drowsewyrm, a sleeping serpent">
      <path
        d="M10 160 C 60 160, 60 100, 110 100 C 160 100, 160 160, 210 160 C 250 160, 262 132, 262 112"
        fill="none"
        strokeWidth="14"
        strokeLinecap="square"
      />
      <path d="M232 60 h60 v52 h-60 z" />
      <path d="M292 60 l20 -34 v34 z" />
      <path d="M232 60 l-20 -34 v34 z" />
      <rect className="serpent-eye" x="246" y="84" width="16" height="5" />
      <rect className="serpent-eye" x="272" y="84" width="16" height="5" />
      <rect className="serpent-eye" x="248" y="96" width="28" height="5" />
      <path d="M12 150 h26 v20 h-26 z" />
    </svg>
  );
}

export function Landing(): JSX.Element {
  const [ticked, setTicked] = useState<string[]>([]);
  const health = Math.max(0, DEMO_FULL - ticked.length * DEMO_DAMAGE);

  const tick = (title: string): void => {
    if (ticked.includes(title)) return;
    setTicked((current) => [...current, title]);
    announce(`Boss took ${tenths1(DEMO_DAMAGE)} damage`);
  };

  return (
    <main className="landing">
      <section className="hero-headline">
        <h1 className="hero-title">Every chore lands a blow.</h1>
        <p className="hero-sub">
          Keep your habits, dailies and to-dos with friends. Every finished task strikes the boss your party is
          fighting, and every missed daily lets it strike back.
        </p>
        <a
          className="primary hero-action"
          href="/signin"
          onClick={(event) => {
            event.preventDefault();
            navigate('/signin');
          }}
        >
          Start your first day
        </a>
      </section>
      <section className="hero-boss">
        <Drowsewyrm />
        <div role="region" aria-label="Demo quest" className="demo-quest">
          <HealthSeam
            boss="Drowsewyrm"
            health={health}
            max={DEMO_FULL}
            defeated={health === 0}
            defeatLine="You landed the last blow."
          />
          <Meter
            name="Demo boss health"
            value={health}
            max={DEMO_FULL}
            text={`${tenths1(health)} / ${tenths1(DEMO_FULL)}`}
            tone="boss"
          />
          <ul className="demo-list" role="list">
            {SAMPLES.map((title) => (
              <li key={title}>
                <label className="demo-row">
                  <input
                    type="checkbox"
                    className="circle-check"
                    aria-label={`Complete ${title}`}
                    checked={ticked.includes(title)}
                    disabled={ticked.includes(title)}
                    onChange={() => tick(title)}
                  />
                  <span>{title}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
