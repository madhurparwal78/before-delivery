import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router.js';
import { displayAmount } from '../lib/format.js';
import { heroMeshDrift, prefersReducedMotion, revealWave, toggleThumb, type RevealCard } from '../lib/motion.js';
import { Ticker } from '../components/Common.js';

type Term = 'monthly' | 'annual';

interface PlanCard {
  readonly code: 'free' | 'studio' | 'agency';
  readonly label: string;
  readonly monthly: string;
  readonly annual: string | null;
  readonly blurb: string;
  readonly points: readonly string[];
}

const PLANS: readonly PlanCard[] = [
  {
    code: 'free',
    label: 'Free',
    monthly: '0.00',
    annual: null,
    blurb: 'Try a silent round with a small client team.',
    points: ['3 active workshops', '8 people per room', '1 silent round per workshop'],
  },
  {
    code: 'studio',
    label: 'Studio',
    monthly: '24.00',
    annual: '230.40',
    blurb: 'For the freelancer running a workshop most weeks.',
    points: ['20 active workshops', '30 people per room', 'Unlimited silent rounds'],
  },
  {
    code: 'agency',
    label: 'Agency',
    monthly: '59.00',
    annual: '566.40',
    blurb: 'For a practice delivering offsites back to back.',
    points: ['Unlimited workshops', '50 people per room', 'Unlimited silent rounds'],
  },
];

const DEMO_CARDS = [
  { id: 0, x: 18, y: 16, text: 'Intake forms change hands' },
  { id: 1, x: 112, y: 14, text: 'Nobody owns triage' },
  { id: 2, x: 206, y: 20, text: 'Two tools disagree' },
  { id: 3, x: 20, y: 84, text: 'Search times out' },
  { id: 4, x: 114, y: 88, text: 'Night shift hears last' },
  { id: 5, x: 208, y: 82, text: 'Too many status calls' },
] as const;

export function Landing(): JSX.Element {
  const [term, setTerm] = useState<Term>('monthly');
  const meshRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const previousTerm = useRef<Term>('monthly');

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return undefined;
    const animation = heroMeshDrift(mesh);
    if (!animation) return undefined;
    // The drift pauses while the hero is out of view or the tab is hidden.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !document.hidden) animation.play();
      else animation.pause();
    });
    observer.observe(mesh);
    const onVisibility = (): void => {
      if (document.hidden) animation.pause();
      else animation.play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      animation.cancel();
    };
  }, []);

  useEffect(() => {
    if (previousTerm.current === term || !thumbRef.current) return;
    const from = previousTerm.current === 'monthly' ? 0 : thumbRef.current.offsetWidth;
    const to = term === 'monthly' ? 0 : thumbRef.current.offsetWidth;
    toggleThumb(thumbRef.current, from, to);
    previousTerm.current = term;
  }, [term]);

  return (
    <div className="landing">
      <header className="hero">
        <div className="hero-mesh" ref={meshRef} aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-column">
            <p className="eyebrow mono">Lanternfold Rooms</p>
            <h1>Brainstorm face down. Reveal together.</h1>
            <hr />
            <p>
              A shared canvas built for the freelance facilitator. Run a timed silent round where
              nobody can read anyone else&rsquo;s notes, then turn every card over at once.
            </p>
            <hr />
            <p>
              Cluster what surfaced, spend a fixed budget of dots, and close the session. The
              sponsor gets an accurate recap and an invoice the same day.
            </p>
            <div className="row hero-actions">
              <Link to="/signin" className="button-link primary">
                Start a workshop
              </Link>
              <Link to="/signin" className="button-link">
                Sign in
              </Link>
            </div>
          </div>
          <RevealDemo />
        </div>
      </header>

      <section className="column plans" aria-label="Plans">
        <h2>Plans that fit one practice, not an enterprise</h2>
        <fieldset className="term-toggle" role="radiogroup" aria-label="Billing term">
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-thumb" ref={thumbRef} />
          </span>
          {(['monthly', 'annual'] as const).map((option) => (
            <label key={option} className="term-option">
              <input
                type="radio"
                name="billing-term"
                value={option}
                checked={term === option}
                onChange={() => setTerm(option)}
              />
              <span>{option === 'monthly' ? 'Monthly' : 'Annual'}</span>
            </label>
          ))}
        </fieldset>

        <div className="plan-cards">
          {PLANS.map((plan) => {
            // Free has no annual term, so its price reads the same under both.
            const price = term === 'annual' && plan.annual !== null ? plan.annual : plan.monthly;
            const suffix = term === 'annual' && plan.annual !== null ? '/ year' : '/ month';
            return (
              <article
                key={plan.code}
                role="group"
                aria-label={`${plan.label} plan`}
                className={plan.code === 'studio' ? 'plan-card recommended' : 'plan-card'}
              >
                <h3>{plan.label}</h3>
                {plan.code === 'studio' && <p className="recommended-flag mono">Recommended</p>}
                <p className="plan-price mono">
                  €<Ticker value={displayAmount(price)} /> {suffix}
                </p>
                <p>{plan.blurb}</p>
                <ul className="rule-list">
                  {plan.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * The mini canvas plays the face-down reveal. Its wave is tied to scroll: progress is 0 when
 * the demo's top edge is at 90 percent of the viewport height and 1 when it is at 30 percent.
 * Card ranks flip in order as progress rises, and scrolling back turns them face down again.
 */
function RevealDemo(): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const [faceUp, setFaceUp] = useState<ReadonlySet<number>>(new Set());
  const [playing, setPlaying] = useState(false);

  const ranks = DEMO_CARDS.map((card) => card.id);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setFaceUp(new Set(ranks));
      return undefined;
    }
    const onScroll = (): void => {
      const node = frameRef.current;
      if (!node || playing) return;
      const top = node.getBoundingClientRect().top;
      const height = window.innerHeight;
      const progress = (0.9 * height - top) / (0.6 * height);
      const clamped = Math.max(0, Math.min(1, progress));
      const shown = Math.round(clamped * DEMO_CARDS.length);
      setFaceUp(new Set(ranks.slice(0, shown)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // The rank list is fixed for the demo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const playReveal = useCallback(() => {
    const node = frameRef.current;
    if (!node) return;
    setPlaying(true);
    setFaceUp(new Set());
    // Turning the cards face down first, then playing the timed wave once.
    window.setTimeout(() => {
      const elements = [...node.querySelectorAll<HTMLElement>('[data-demo-card]')];
      const box = node.getBoundingClientRect();
      const centre = { x: box.width / 2, y: box.height / 2 };
      const cards: RevealCard[] = elements.map((element) => {
        const cardBox = element.getBoundingClientRect();
        const cardCentre = {
          x: cardBox.left - box.left + cardBox.width / 2,
          y: cardBox.top - box.top + cardBox.height / 2,
        };
        return { element, distance: Math.hypot(cardCentre.x - centre.x, cardCentre.y - centre.y) };
      });
      revealWave(cards, (element) => {
        const id = Number.parseInt(element.dataset.demoCard ?? '0', 10);
        setFaceUp((current) => new Set([...current, id]));
      });
      window.setTimeout(() => setPlaying(false), 1000);
    }, 60);
  }, []);

  return (
    <div className="demo" role="region" aria-label="Reveal demo">
      <div className="demo-frame" ref={frameRef}>
        <p className="demo-frame-title mono">Problems</p>
        {DEMO_CARDS.map((card) => (
          <div
            key={card.id}
            data-demo-card={card.id}
            className={faceUp.has(card.id) ? 'demo-card up' : 'demo-card down'}
            style={{ left: `${card.x}px`, top: `${card.y}px` }}
          >
            {faceUp.has(card.id) ? <span>{card.text}</span> : null}
          </div>
        ))}
      </div>
      <button type="button" onClick={playReveal}>
        Play the reveal
      </button>
    </div>
  );
}
