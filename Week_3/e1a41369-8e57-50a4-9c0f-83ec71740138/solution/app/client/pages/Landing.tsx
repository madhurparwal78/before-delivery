import { useState } from "react";
import { GameFeed } from "../components/GameFeed";
import { Seam } from "../components/Seam";
import { Serpent } from "../components/Serpent";
import { say } from "../feed";
import { Link } from "../router";

const DEMO_MAX = 30;
const DEMO_BLOW = 10;
const SAMPLES = ["Water the plants", "Stretch for ten minutes", "Read one chapter"];

/** A working demo of the boss fight: it runs in the page and sends nothing to the server. */
function Demo({ onDefeat }: { onDefeat: () => void }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const health = DEMO_MAX - ticked.length * DEMO_BLOW;
  const tick = (title: string): void => {
    const next = [...ticked, title];
    setTicked(next);
    say(`Boss took ${DEMO_BLOW.toFixed(1)} damage`);
    if (next.length === SAMPLES.length) onDefeat();
  };
  return (
    <section className="demo" role="region" aria-label="Demo quest">
      <Seam boss="Drowsewyrm" health={health} max={DEMO_MAX} label="Demo boss health" defeatedBy={health === 0 ? "You" : null} />
      <ul className="demo-list" role="list">
        {SAMPLES.map((title) => (
          <li key={title}>
            <label className="demo-item">
              <input type="checkbox" className="tick" aria-label={`Complete ${title}`} checked={ticked.includes(title)} disabled={ticked.includes(title)} onChange={() => tick(title)} />
              <span>{title}</span>
            </label>
          </li>
        ))}
      </ul>
      <GameFeed />
    </section>
  );
}

export function Landing() {
  const [defeated, setDefeated] = useState(false);
  return (
    <main className="landing">
      <section className="hero hero-blush">
        <h1 className="hero-title">Every chore lands a blow.</h1>
        <p className="hero-sub">Deedfall is the habit tracker for people who keep routines with friends. Finish a daily and the shared boss takes the hit. Miss one and it strikes back at the whole party, by name.</p>
        <Link className={defeated ? "btn btn-solid" : "btn btn-accent"} href="/signin">Start your first day</Link>
      </section>
      <section className="hero hero-ink">
        <Serpent />
        <Demo onDefeat={() => setDefeated(true)} />
      </section>
    </main>
  );
}
