// The editorial landing page: serif hero over the drifting mesh, the mini canvas that plays the face-down
// reveal (scrubbed by scroll, or played by its button), and the three plans under the term toggle.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENTITLEMENTS, PLANS, PLAN_LABELS, PRICES, type Plan, type Term } from "../../shared/plans.js";
import { formatAmount } from "../../shared/copy.js";
import { crossfade, flip, rankGap, reducedMotion } from "../motion.js";
import { Link, Ticker, useTitle } from "../ui.js";

/** Six cards on a 400 × 260 demo frame; each sits at its own distance from the centre, so each is a rank. */
const DEMO_CARDS = [
  { x: 142, y: 44, text: "Handoffs lose the why" },
  { x: 38, y: 152, text: "Nobody owns Fridays" },
  { x: 278, y: 40, text: "Two tools, two truths" },
  { x: 162, y: 162, text: "Pilot one triage lead" },
  { x: 24, y: 46, text: "Demos keep leads close" },
  { x: 292, y: 158, text: "Search times out" },
];
const DEMO_W = 400;
const DEMO_H = 260;
const CARD_W = 96;
const CARD_H = 58;

const DISTANCES = DEMO_CARDS.map((c) => Math.round(Math.hypot(c.x + CARD_W / 2 - DEMO_W / 2, c.y + CARD_H / 2 - DEMO_H / 2)));
const SORTED = [...new Set(DISTANCES)].sort((a, b) => a - b);
const RANKS = DISTANCES.map((d) => SORTED.indexOf(d));
const RANK_COUNT = SORTED.length;

function useMeshDrift(mesh: React.RefObject<HTMLDivElement>, hero: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = mesh.current;
    const section = hero.current;
    if (!el || !section || reducedMotion()) return;
    const drift = el.animate([{ transform: "translate(-2.5%, -2%)" }, { transform: "translate(2.5%, 2%)" }], {
      duration: 12000,
      direction: "alternate",
      iterations: Infinity,
      easing: "ease-in-out",
    });
    let inView = true;
    // Only a change between running and paused touches the animation; replaying a running loop restarts its timing.
    const sync = () => {
      const run = inView && document.visibilityState === "visible";
      if (run && drift.playState === "paused") drift.play();
      else if (!run && drift.playState === "running") drift.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? true;
      sync();
    });
    observer.observe(section);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      drift.cancel();
    };
  }, [mesh, hero]);
}

function RevealDemo() {
  const region = useRef<HTMLElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const backs = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = useRef(reducedMotion()).current;
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => {
    if (reduced) return;
    const onScroll = () => {
      const top = region.current?.getBoundingClientRect().top ?? 0;
      const vh = window.innerHeight;
      setPlaying(null);
      setProgress(Math.min(1, Math.max(0, (0.9 * vh - top) / (0.6 * vh))));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  useLayoutEffect(() => {
    if (playing === null) return;
    const gap = rankGap(RANK_COUNT);
    DEMO_CARDS.forEach((_, i) => {
      const card = cards.current[i];
      const back = backs.current[i];
      if (!card || !back) return;
      if (reduced) crossfade(back);
      else flip(card, back, (RANKS[i] ?? 0) * gap);
    });
  }, [playing, reduced]);

  const faceUp = (i: number) => playing !== null || (RANKS[i] ?? 0) + 0.5 <= progress * RANK_COUNT;

  return (
    <section ref={region} className="demo" aria-label="Reveal demo">
      <div className="demo-frame" aria-hidden="true">
        <p className="demo-frame-title">
          Kick-off <span className="mono">{DEMO_CARDS.filter((_, i) => !faceUp(i)).length ? `${DEMO_CARDS.filter((_, i) => !faceUp(i)).length} hidden` : "6 notes"}</span>
        </p>
        {DEMO_CARDS.map((c, i) => (
          <div
            key={playing === null ? `c${i}` : `p${playing}-${i}`}
            ref={(el) => {
              cards.current[i] = el;
            }}
            className="demo-card sticky"
            style={{ left: `${(c.x / DEMO_W) * 100}%`, top: `${(c.y / DEMO_H) * 100}%` }}
          >
            {c.text}
            <div
              ref={(el) => {
                backs.current[i] = el;
              }}
              className="card-back-face"
              style={{ opacity: faceUp(i) && playing === null ? 0 : 1 }}
            />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-quiet demo-play" onClick={() => setPlaying((n) => (n ?? 0) + 1)}>
        Play the reveal
      </button>
    </section>
  );
}

function priceOf(plan: Plan, term: Term): { amount: string; unit: string } {
  const annual = term === "annual" && PRICES[plan].annual !== undefined;
  return { amount: formatAmount((annual ? PRICES[plan].annual : PRICES[plan].monthly) ?? "0.00"), unit: annual ? "year" : "month" };
}

const PLAN_POINTS: Record<Plan, string[]> = Object.fromEntries(
  PLANS.map((plan) => {
    const e = ENTITLEMENTS[plan];
    return [
      plan,
      [
        e.activeWorkshops === null ? "Unlimited active workshops" : `${e.activeWorkshops} active workshops`,
        `${e.participantsPerWorkshop} participants per room`,
        e.silentRoundsPerWorkshop === null ? "Unlimited silent rounds" : `${e.silentRoundsPerWorkshop} silent round per workshop`,
        `${e.invitesPerDay.toLocaleString("en-GB")} invites a day`,
        e.recapScale === 2 ? "Sharp 2× recap images" : "Standard recap images",
      ],
    ];
  }),
) as Record<Plan, string[]>;

export function TermToggle({ term, onChange, name }: { term: Term; onChange: (t: Term) => void; name: string }) {
  const thumb = useRef<HTMLSpanElement>(null);
  const last = useRef(term);
  useLayoutEffect(() => {
    const from = last.current;
    last.current = term;
    if (from === term || !thumb.current || reducedMotion()) return;
    const x = (t: Term) => (t === "annual" ? "translateX(100%)" : "translateX(0)");
    thumb.current.animate([{ transform: x(from) }, { transform: x(term) }], { duration: 250, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [term]);
  return (
    <div role="radiogroup" aria-label="Billing term" className="segmented">
      <span ref={thumb} className="segmented-thumb" aria-hidden="true" style={{ transform: term === "annual" ? "translateX(100%)" : "translateX(0)" }} />
      {(["monthly", "annual"] as const).map((t) => (
        <label key={t} className="segment">
          <input type="radio" name={name} checked={term === t} onChange={() => onChange(t)} />
          {t === "monthly" ? "Monthly" : "Annual"}
        </label>
      ))}
    </div>
  );
}

function Plans() {
  const [term, setTerm] = useState<Term>("monthly");
  return (
    <section className="plans" aria-label="Plans">
      <div className="plans-head">
        <h2 className="h2">
          Plans for a practice, not a client workspace
        </h2>
        <TermToggle name="landing-term" term={term} onChange={setTerm} />
      </div>
      <div className="plan-grid">
        {PLANS.map((plan) => {
          const price = priceOf(plan, term);
          const text = `€${price.amount} / ${price.unit}`;
          return (
            <div key={plan} role="group" aria-label={`${PLAN_LABELS[plan]} plan`} className={plan === "studio" ? "plan plan-recommended" : "plan"}>
              <div className="plan-inner">
                <div className="plan-name">
                  <h3 className="h3">{PLAN_LABELS[plan]}</h3>
                  {plan === "studio" && <span className="badge">Recommended</span>}
                </div>
                <p className="price">
                  <span className="sr-only">{text}</span>
                  <span aria-hidden="true">
                    €<Ticker value={price.amount} /> / {price.unit}
                  </span>
                </p>
                <ul className="plan-points">
                  {PLAN_POINTS[plan].map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Landing() {
  useTitle("Brainstorm face down");
  const hero = useRef<HTMLElement>(null);
  const mesh = useRef<HTMLDivElement>(null);
  useMeshDrift(mesh, hero);
  return (
    <div className="landing">
      <header className="site-header">
        <span className="wordmark">Lanternfold Rooms</span>
        <Link to="/signin" className="btn btn-quiet">
          Sign in
        </Link>
      </header>
      <main>
        <section ref={hero} className="hero">
          <div ref={mesh} className="mesh" aria-hidden="true" />
          <div className="hero-copy">
            <p className="eyebrow">For freelance facilitators</p>
            <h1 className="display">Brainstorm face down. Reveal together.</h1>
            <p className="lede">Silent rounds where nobody reads anyone else’s note until you turn them all over at once — then cluster, dot-vote and send the recap and invoice the same day.</p>
            <hr className="rule" />
            <div className="hero-points">
              <p>
                <strong>One join link.</strong> Client teams join without accounts, and only that room.
              </p>
              <p>
                <strong>Honest votes.</strong> Dot totals come from the ledger, never a screenshot.
              </p>
            </div>
            <hr className="rule" />
            <Link to="/signin" className="btn btn-primary">
              Start a workshop
            </Link>
          </div>
          <RevealDemo />
        </section>
        <Plans />
      </main>
      <footer className="site-footer">Lanternfold Rooms — a shared canvas for paid remote workshops.</footer>
    </div>
  );
}
