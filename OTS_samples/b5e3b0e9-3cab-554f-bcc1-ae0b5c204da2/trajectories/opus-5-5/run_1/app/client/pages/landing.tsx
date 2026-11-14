import { useLayoutEffect, useState } from 'preact/hooks';
import { useApp } from '../app-context.js';
import { TRAINING_NOTICE } from '../components/shell.js';
import { SigninForm } from './account.js';

/** A drawing of Wrenfield for the hero; it is decoration, so it carries no object ids. */
const NODES: Record<string, [number, number]> = {
  R09: [100, 100], R27: [900, 100], A1: [850, 200], A6: [150, 200], J2: [650, 200], J3: [500, 200], J4: [350, 200],
  W: [350, 320], E: [650, 320], S1: [300, 420], S2: [400, 420], S3: [600, 420], S4: [700, 420],
};
const LINES: [string, string, string][] = [
  ['A2', 'J2', 'A1'], ['A3', 'J3', 'J2'], ['A4', 'J4', 'J3'], ['A5', 'A6', 'J4'], ['W1', 'W', 'J4'], ['E1', 'E', 'J2'],
  ['S1T', 'S1', 'W'], ['S2T', 'S2', 'W'], ['S3T', 'S3', 'E'], ['S4T', 'S4', 'E'],
];
const RUN = ['S1T', 'W1', 'A4', 'A3', 'A2'];

function Schematic() {
  const { reducedMotion } = useApp();
  const [lit, setLit] = useState(reducedMotion ? RUN.length : 0);
  const [bar, setBar] = useState(reducedMotion);
  useLayoutEffect(() => {
    if (reducedMotion) {
      setLit(RUN.length);
      setBar(true);
      return undefined;
    }
    const timers = RUN.map((_, i) => setTimeout(() => setLit(i + 1), 600 + i * 90));
    timers.push(setTimeout(() => setBar(true), 600 + (RUN.length - 1) * 90 + 200));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);
  return (
    <svg viewBox="0 40 1000 420" class="hero-schematic" aria-hidden="true" focusable="false">
      <line x1="100" y1="100" x2="900" y2="100" class="hero-runway" />
      {LINES.map(([id, from, to]) => {
        const [x1, y1] = NODES[from]!;
        const [x2, y2] = NODES[to]!;
        const on = RUN.indexOf(id) >= 0 && RUN.indexOf(id) < lit;
        return <line key={id} x1={x1} y1={y1} x2={x2} y2={y2} class={on ? 'hero-taxi on' : 'hero-taxi'} />;
      })}
      <rect x="826" y="194" width="48" height="12" class={bar ? 'hero-bar on' : 'hero-bar'} />
      {['S1', 'S2', 'S3', 'S4'].map((stand) => (
        <rect key={stand} x={NODES[stand]![0] - 14} y={NODES[stand]![1] - 10} width="28" height="20" class="hero-stand" />
      ))}
    </svg>
  );
}

export function LandingPage() {
  return (
    <div class="landing">
      <section class="hero guides" aria-labelledby="hero-heading">
        <h1 id="hero-heading" class="hero-headline">
          Type the taxi. See the line.
        </h1>
        <p class="hero-clearance mono">GABCD TAXI HP A1 VIA A</p>
        <div class="hero-cta">
          <a href="/signup" class="hero-cta-link">
            Open your school
          </a>
        </div>
        <div class="hero-map">
          <Schematic />
        </div>
      </section>
      <section class="second-screen" aria-labelledby="second-heading">
        <h2 id="second-heading" class="second-line">
          Every clearance has a <span class="bar">second</span> it was given.
        </h2>
        <p class="second-notice">{TRAINING_NOTICE}</p>
        <a href="/signup" class="second-link">
          Create an account
        </a>
      </section>
      <section class="signin-sheet" aria-labelledby="sheet-heading">
        <h2 id="sheet-heading">Sign in</h2>
        <SigninForm idPrefix="sheet" />
      </section>
    </div>
  );
}
