import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Speaker, Stage } from '../../shared/api';
import { OUTAGE_COPY } from '../copy';
import { loadSessions, loadSpeakers, loadStages } from '../data';
import { useTitle } from '../hooks';
import { Link, useRouter } from '../router';
import { Loading } from '../components/chrome';
import { SpeakerTile } from '../components/speaker-tile';

const STATEMENT_ROWS = ['The next', '$5 trillion', 'in transactions', "won't be", 'human.'];
const SPONSORS = ['LEDGERWEEK', 'Tidewater Labs', 'Quayside', 'Harbor Group', 'Longview Research', 'Comma Ventures', 'Reedwork', 'Lantern'];
const HERO_SOURCES = '/assets/star-trails-780.jpg 780w, /assets/star-trails-1920.jpg 1920w';

// A fine film grain drawn once by the page and laid faintly over the hero photograph.
function useGrain(): string {
  const [grain, setGrain] = useState('');
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(160, 160);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const shade = Math.floor(Math.random() * 256);
      pixels.data[index] = shade;
      pixels.data[index + 1] = shade;
      pixels.data[index + 2] = shade;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    setGrain(`url(${canvas.toDataURL('image/png')})`);
  }, []);
  return grain;
}

function Hero() {
  const grain = useGrain();
  return (
    <section className="hero">
      <div className="hero-media">
        <img className="hero-photo" src="/assets/star-trails-1920.jpg" srcSet={HERO_SOURCES} sizes="100vw" alt="" fetchPriority="high" />
        <div className="hero-grain" style={{ backgroundImage: grain }} />
        <div className="hero-shade" />
      </div>
      <div className="hero-mark">
        <p className="hero-tab">October 31 - November 1</p>
        <h1 className="hero-title" aria-label="Keel Outpost 2026">
          <span className="cut cut-name">Keel Outpost</span> <span className="cut cut-year">2026</span>
        </h1>
        <div className="hero-meta">
          <p>Harbour Quay Hall, Port Ashby</p>
          <p className="hero-partner">with LEDGERWEEK</p>
        </div>
      </div>
      <div className="hero-foot">
        <p className="hero-foot-label">Sponsored by →</p>
        <p className="hero-foot-names">{SPONSORS.join(' · ')}</p>
      </div>
    </section>
  );
}

// Each later row starts collapsing this share of the travel after the row above it.
const ROW_LAG = 0.08;

// Follows the scroll: progress 0 when the statement's top meets the window's foot, 1 when its
// centre meets the window's centre. Each row's echoes read their own lagged share as `--q`; the
// reading happens on the next animation frame after a scroll or resize.
function useStaggerProgress() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = heading.current;
    if (!element) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const height = window.innerHeight;
      const travel = height / 2 + box.height / 2;
      const progress = Math.min(1, Math.max(0, (height - box.top) / travel));
      element.querySelectorAll<HTMLElement>('.srow').forEach((row, index) => {
        const start = index * ROW_LAG;
        const share = Math.min(1, Math.max(0, (progress - start) / (1 - start)));
        row.style.setProperty('--q', share.toFixed(4));
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return heading;
}

function Statement() {
  const heading = useStaggerProgress();
  return (
    <section className="statement" aria-labelledby="statement-title">
      <h2 id="statement-title" className="statement-title" ref={heading}>
        {STATEMENT_ROWS.map((row, index) => (
          <Fragment key={row}>
            {index > 0 && ' '}
            <span className="srow">
              <span className="srow-text">{row}</span>
              {[0, 1, 2, 3].map((echo) => (
                <span key={echo} className={`echo echo-${echo}`} aria-hidden="true" data-text={row} />
              ))}
            </span>
          </Fragment>
        ))}
      </h2>
      <p className="statement-follow">Agentic finance needs the right rails. Instant settlement. Autonomous payments. Private transactions.</p>
    </section>
  );
}

export function HomePage() {
  useTitle('');
  const { place } = useRouter();
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[] | null>(null);
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([loadStages(), loadSpeakers(), loadSessions(null)]).then(([stageList, speakerList, sessions]) => {
      if (!live) return;
      setOutage(!stageList || !speakerList);
      setStages(stageList);
      setSpeakers(speakerList);
      setTitles(new Map((sessions ?? []).map((session) => [session.id, session.title])));
    });
    return () => {
      live = false;
    };
  }, []);

  const ready = stages !== null && speakers !== null;
  useLayoutEffect(() => {
    if (!place.hash) return;
    document.getElementById(decodeURIComponent(place.hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [place.key, place.hash, ready]);

  const pending = outage ? <p className="helper">{OUTAGE_COPY}</p> : <Loading />;
  return (
    <div className="home">
      <Hero />
      <section id="overview" className="intro chapter">
        <p className="intro-copy">
          Join us in Port Ashby for Keel Outpost 2026 at Harbour Quay Hall, with LEDGERWEEK. One vision: money that moves as freely as
          messages. This is where the global Keel community - founders, builders, developers, investors, traders - gathers to shape what
          comes next.
        </p>
      </section>
      <Statement />
      <section id="experiences" className="experiences" aria-labelledby="experiences-title">
        <img className="experiences-photo" src="/assets/star-trails-1920.jpg" srcSet={HERO_SOURCES} sizes="100vw" alt="" loading="lazy" />
        <div className="experiences-inner">
          <h2 id="experiences-title" className="section-title on-dark">
            Experiences
          </h2>
          <p className="helper helper-dark">Four rooms, four ways in. Pick a stage to see only its sessions.</p>
          {stages ? (
            <ul className="experience-strip">
              {stages.map((stage) => (
                <li key={stage.slug} className="experience-card">
                  <Link
                    className="card-name"
                    to={`/agenda?stage=${encodeURIComponent(stage.slug)}`}
                    aria-describedby={`stage-${stage.slug}`}
                  >
                    {stage.name}
                  </Link>
                  <span className="card-description" id={`stage-${stage.slug}`}>
                    {stage.description}
                  </span>
                  <span className="card-cta" aria-hidden="true">
                    Open the agenda →
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            pending
          )}
        </div>
      </section>
      <section id="record" className="teaser chapter" aria-labelledby="teaser-title">
        <span className="teaser-rule" aria-hidden="true" />
        <div className="teaser-body">
          <p className="eyebrow">TPS Record</p>
          <h2 id="teaser-title" className="teaser-title">
            6M+ transactions per second. Can we beat it live?
          </h2>
          <p className="helper">Guess the final figure before the cut-off. The three closest guesses win credits.</p>
          <Link className="btn btn-dark" to="/record">
            Call the number
          </Link>
        </div>
      </section>
      <section id="agenda" className="home-agenda chapter" aria-labelledby="home-agenda-title">
        <h2 id="home-agenda-title" className="section-title">
          Agenda
        </h2>
        <p className="helper">Two days, four stages, eighteen sessions. Workshop and game seats are small, so reserve early.</p>
        <div className="home-agenda-links">
          <Link className="btn btn-primary" to="/agenda">
            See the full agenda
          </Link>
          <Link className="btn btn-light" to="/signup">
            Sign up to reserve
          </Link>
        </div>
      </section>
      <section id="speakers" className="home-speakers" aria-labelledby="home-speakers-title">
        <div className="chapter">
          <h2 id="home-speakers-title" className="section-title on-dark">
            Speakers
          </h2>
          <p className="helper helper-dark">
            Builders, researchers and founders from across the ecosystem. <Link to="/speakers">Meet every speaker</Link>
          </p>
          {speakers ? (
            <ul className="speaker-wall" aria-label="Featured speakers">
              {speakers.slice(0, 8).map((speaker) => (
                <SpeakerTile key={speaker.slug} speaker={speaker} titles={titles} />
              ))}
            </ul>
          ) : (
            pending
          )}
        </div>
      </section>
      <section id="sponsors" className="sponsors" aria-labelledby="sponsors-title">
        <h2 id="sponsors-title" className="section-title on-dark">
          Sponsors
        </h2>
        <ul className="sponsor-list">
          {SPONSORS.map((sponsor) => (
            <li key={sponsor}>{sponsor}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
