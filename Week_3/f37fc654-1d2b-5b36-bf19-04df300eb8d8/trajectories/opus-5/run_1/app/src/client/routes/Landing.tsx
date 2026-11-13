import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStage } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { CueLine, Dialog } from '../components/ui.js';
import { LANDING_CAPTIONS, LANDING_HEADLINE } from '../../shared/copy.js';
import { CASE_STUDIES } from '../../shared/seed.js';

const KEYFRAME_COUNT = 5;

/**
 * The landing stage. The hero is pinned for four viewport heights while the
 * camera passes through five keyframes; scrolling back plays the path in
 * reverse.
 */
export function Landing(): JSX.Element {
  const { patch } = useStage();
  const reducedMotion = useReducedMotion();
  const [openCaseStudy, setOpenCaseStudy] = useState<string | null>(null);

  useEffect(() => {
    patch({
      scene: 'landing',
      silhouette: 'camera-reactive-wall',
      roomWidthM: null,
      roomDepthM: null,
      dust: 60,
      entrance: 1,
      keyframe: 0,
      keyframeProgress: 0,
    });
  }, [patch]);

  useEffect(() => {
    const onScroll = (): void => {
      const viewport = window.innerHeight;
      const offset = window.scrollY;
      // Keyframe k is reached when the page has scrolled k viewport heights.
      const exact = Math.max(0, Math.min(KEYFRAME_COUNT - 1, offset / viewport));
      const nearest = Math.round(exact);
      patch({
        scene: 'landing',
        keyframe: nearest,
        keyframeProgress: exact - Math.floor(exact),
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [patch]);

  const study = CASE_STUDIES.find((item) => item.id === openCaseStudy) ?? null;

  return (
    <main className="landing-track">
      <section className="landing-hero">
        <div className="column">
          <CueLine text={LANDING_HEADLINE} reducedMotion={reducedMotion} />
          <p className="inline">
            <Link to="/brief/new?step=1" className="chip">
              Start a commission
            </Link>
          </p>
        </div>
      </section>

      {LANDING_CAPTIONS.map((caption) => (
        <section className="landing-caption" key={caption}>
          <div className="column">
            <h2>{caption}</h2>
          </div>
        </section>
      ))}

      <section className="column wide">
        <h2>Recent commissions</h2>
        <div className="case-grid">
          {CASE_STUDIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="card case-card"
              onClick={() => setOpenCaseStudy(item.id)}
            >
              <span className="badge">{item.installationLabel}</span>
              <strong>{item.title}</strong>
              <span className="muted">{item.venueName}</span>
            </button>
          ))}
        </div>
      </section>

      {study ? (
        <Dialog
          title={study.title}
          closeLabel="Close case study"
          variant="case-study"
          onClose={() => setOpenCaseStudy(null)}
        >
          <p>{study.blurb}</p>
          <dl>
            <dt className="muted">Installation</dt>
            <dd>{study.installationLabel}</dd>
            <dt className="muted">Venue</dt>
            <dd>{study.venueName}</dd>
          </dl>
          <Link to="/brief/new?step=1">Start a commission</Link>
        </Dialog>
      ) : null}
    </main>
  );
}
