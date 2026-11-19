import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Link } from '../router.tsx';
import { Icon, Screen } from '../ui.tsx';
import './home.css';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- revision player: a sample stack of five changes at each of five revisions ----

interface PlayerRow {
  title: string;
  word: string;
  tone: 'idle' | 'kept' | 'dismissed' | 'conflict' | 'skipped';
}

const CHANGES = ['Add ledger entry schema', 'Index entries by tenant', 'Rate table loader', 'Round totals to cents', 'Export monthly statements'];

const REVISIONS: { caption: string; rows: PlayerRow[] }[] = [
  {
    caption: 'Revision 1: five changes pushed, two approved',
    rows: [
      { title: CHANGES[0], word: 'Open', tone: 'idle' },
      { title: CHANGES[1], word: 'Approved', tone: 'kept' },
      { title: CHANGES[2], word: 'Approved', tone: 'kept' },
      { title: CHANGES[3], word: 'Open', tone: 'idle' },
      { title: CHANGES[4], word: 'Open', tone: 'idle' },
    ],
  },
  {
    caption: 'Revision 2: a fix lands on the bottom change',
    rows: [
      { title: CHANGES[0], word: 'New revision', tone: 'idle' },
      { title: CHANGES[1], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[2], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[3], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[4], word: 'Approvals kept', tone: 'kept' },
    ],
  },
  {
    caption: 'Revision 3: the fix touches a path change 3 owns',
    rows: [
      { title: CHANGES[0], word: 'New revision', tone: 'idle' },
      { title: CHANGES[1], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[2], word: 'Approvals dismissed (1)', tone: 'dismissed' },
      { title: CHANGES[3], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[4], word: 'Approvals kept', tone: 'kept' },
    ],
  },
  {
    caption: 'Revision 4: a later push collides with change 3',
    rows: [
      { title: CHANGES[0], word: 'New revision', tone: 'idle' },
      { title: CHANGES[1], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[2], word: 'Conflicts in 2 files', tone: 'conflict' },
      { title: CHANGES[3], word: 'Not restacked', tone: 'skipped' },
      { title: CHANGES[4], word: 'Not restacked', tone: 'skipped' },
    ],
  },
  {
    caption: 'Revision 5: the author resolves it and the stack restacks',
    rows: [
      { title: CHANGES[0], word: 'New revision', tone: 'idle' },
      { title: CHANGES[1], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[2], word: 'Approvals dismissed (0)', tone: 'dismissed' },
      { title: CHANGES[3], word: 'Approvals kept', tone: 'kept' },
      { title: CHANGES[4], word: 'Approvals kept', tone: 'kept' },
    ],
  },
];

function RevisionPlayer() {
  const root = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const started = useRef(false);
  const [rev, setRev] = useState(0);

  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  // One step every two seconds, once through the five revisions, then it stops.
  const play = (from: number) => {
    stop();
    setRev(from);
    const next = (at: number) => {
      if (at >= REVISIONS.length - 1) return;
      timer.current = window.setTimeout(() => {
        setRev(at + 1);
        next(at + 1);
      }, 2000);
    };
    next(from);
  };

  useLayoutEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (started.current || !entries.some((entry) => entry.isIntersecting) || reducedMotion()) return;
        started.current = true;
        play(0);
      },
      { threshold: 0.35 },
    );
    observer.observe(root.current!);
    return () => {
      observer.disconnect();
      stop();
    };
  }, []);

  const view = REVISIONS[rev];
  return (
    <section ref={root} className="player" aria-label="Revision player" data-reveal>
      <div className="player-screen">
        <div className="player-inner" key={rev}>
          <p className="player-caption" id="player-caption">{view.caption}</p>
          <div role="tabpanel" aria-labelledby={`rev-tab-${rev}`}>
          <ol className="player-stack">
            {view.rows.map((row, index) => (
              <li key={row.title} className={`player-row tone-${row.tone}`}>
                <span className="player-n num">#{index + 1}</span>
                <span className="player-title">{row.title}</span>
                <span className="player-word">{row.word}</span>
              </li>
            ))}
          </ol>
          </div>
        </div>
      </div>
      <div className="player-controls">
        <div role="tablist" aria-label="Revisions" className="player-tabs">
          {REVISIONS.map((_, index) => (
            <button
              key={index}
              id={`rev-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={index === rev}
              tabIndex={index === rev ? 0 : -1}
              className="player-tab"
              onClick={() => {
                stop();
                setRev(index);
              }}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const target = (index + step + REVISIONS.length) % REVISIONS.length;
                stop();
                setRev(target);
                document.getElementById(`rev-tab-${target}`)?.focus();
              }}
            >
              Revision {index + 1}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => play(0)}>
          <Icon name="arrow" size={14} />
          Play
        </button>
      </div>
    </section>
  );
}

// ---- hero wireframe: five stacked slabs drawn once ----

function Wireframe() {
  return (
    <svg className="wire" viewBox="0 0 520 300" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="wire-stroke" gradientUnits="userSpaceOnUse" x1="60" x2="460" y1="40" y2="260">
          <stop offset="0" stop-color="#ffb931" />
          <stop offset="0.55" stop-color="#ffffff" />
          <stop offset="1" stop-color="#1061ff" />
        </linearGradient>
        <filter id="wire-bloom" x="-20%" y="-30%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="5" result="soft" />
          <feMerge>
            <feMergeNode in="soft" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#wire-bloom)" fill="none" stroke="url(#wire-stroke)" stroke-width="2.5" stroke-linejoin="round">
        {[0, 1, 2, 3, 4].map((slab) => (
          <g key={slab} transform={`translate(${70 + slab * 14} ${222 - slab * 42}) rotate(${-5 + slab * 2.2})`} className="slab" style={{ '--i': slab } as Record<string, number>}>
            <rect x="0" y="0" width="300" height="46" rx="12" pathLength="1" />
            <path d="M18 23h60M96 23h34" pathLength="1" stroke-opacity="0.7" />
          </g>
        ))}
      </g>
    </svg>
  );
}

// ---- bento mockups ----

function PushLog() {
  const lines = [
    ['a91f03c2e7b1', 'round-totals', 'Round totals to cents', '2 seconds ago'],
    ['5d20be77c14a', 'fixed-rate', 'Use fixed rate', '41 seconds ago'],
    ['c3e8199a02df', 'tenant-index', 'Index entries by tenant', '6 minutes ago'],
  ];
  return (
    <div className="mock mock-log" aria-hidden="true">
      <div className="window window-back">
        <div className="window-bar"><span className="dots"><i /><i /><i /></span><span>notes.txt</span></div>
      </div>
      <div className="window">
        <div className="window-bar"><span className="dots"><i /><i /><i /></span><span>harbor-ledger</span></div>
        <div className="window-body mono">
          <p className="log-cmd">push@harbor % ridgestack push --stack</p>
          {lines.map(([id, branch, message, ago], index) => (
            <div key={id} className="log-entry">
              <p><span className={`log-dot d${index}`}>●</span> <span className="log-branch">{branch}</span>{index === 0 ? <span className="log-cur"> (current)</span> : null}</p>
              <p className="log-ago">{ago}</p>
              <p className="log-msg">{id} {message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  return (
    <div className="mock mock-toasts" aria-hidden="true">
      <div className="toast-back toast-back-2" />
      <div className="toast-back toast-back-1" />
      <div className="toast-top">
        <span className="toast-icon"><Icon name="merge" size={20} /></span>
        <p>priya requested your review on <b>#14</b> Index entries by tenant</p>
      </div>
      <ul className="inbox-rows">
        <li><span className="avatar a1" /><span>Rate table loader</span><em>tidepool-api</em></li>
        <li><span className="avatar a2" /><span>Round totals to cents</span><em>harbor-ledger</em></li>
      </ul>
    </div>
  );
}

function CheckPanel() {
  return (
    <div className="mock mock-checks" aria-hidden="true">
      <div className="check-panel">
        <p className="check-head"><span>Run status</span><span>×</span></p>
        <p className="check-row"><span className="tick"><Icon name="check" size={12} /></span> lint <em>(required)</em></p>
        <p className="check-sub">0 problems in 41 files</p>
        <p className="check-row"><span className="ring" /> unit <em>(required)</em></p>
        <p className="check-sub">312 of 540 tests</p>
        <p className="check-row"><span className="tick"><Icon name="check" size={12} /></span> audit</p>
      </div>
      <div className="check-hero"><span className="gauge" /><span>unit <em>(required)</em></span></div>
    </div>
  );
}

function RuleChips() {
  const chips = ['Approvals', 'Code owners', 'Required checks', 'Merge queue', 'Restack', 'Approvals', 'Code owners'];
  return (
    <div className="mock mock-chips" aria-hidden="true">
      <div className="chip-column">
        {chips.map((chip, index) => (
          <span key={index} className="rule-chip" style={{ '--s': index % 2 ? 18 : -10 } as Record<string, number>}>
            <Icon name={index % 3 === 0 ? 'check' : index % 3 === 1 ? 'lock' : 'queue'} size={18} />
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

function SuggestionThread() {
  return (
    <div className="mock mock-thread" aria-hidden="true">
      <div className="thread-side">
        <p>Threads</p>
        <p className="side-row">src/rates.ts · 1</p>
        <p className="side-row">src/ledger.ts · 3</p>
        <p className="side-row side-dim">README.md · 2</p>
      </div>
      <div className="thread-main">
        <div className="thread-head"><Icon name="file" size={14} /> Suggestion on src/ledger.ts, line 3</div>
        <p className="thread-author"><span className="avatar a3" /> tomas <em>· 3h ago</em></p>
        <div className="thread-diff mono">
          <p className="del"><span>3</span><span>−</span>  return a.reduce((s, x) =&gt; s + x, 0);</p>
          <p className="add"><span>3</span><span>+</span>  return Math.round(sum * 100) / 100;</p>
        </div>
        <p className="thread-body">Round once at the end, then keep <code>cents</code> as a whole number.</p>
      </div>
    </div>
  );
}

function BentoCard({ title, body, mock, wide, delay }: { title: string; body: string; mock: preact.ComponentChild; wide?: boolean; delay: number }) {
  return (
    <article className={`bento bento-card ${wide ? 'bento-wide' : ''}`} data-reveal style={{ '--d': `${delay}s` } as Record<string, string>}>
      <div className="bento-text">
        <h3>{title}</h3>
        <p>{body}</p>
        <Link href="/signup" className="arrow-link">{`Try it on ${wide ? 'harbor-ledger' : 'tidepool-api'}`}</Link>
      </div>
      <div className="bento-mock">{mock}</div>
    </article>
  );
}

function NeonWordmark() {
  return (
    <div className="neon" data-reveal-glow>
      <svg viewBox="0 0 1000 210" role="img" aria-label="Ridgestack neon wordmark">
        <defs>
          <filter id="neon-bloom" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="3" result="a" />
            <feGaussianBlur stdDeviation="10" in="SourceGraphic" result="b" />
            <feGaussianBlur stdDeviation="26" in="SourceGraphic" result="c" />
            <feMerge>
              <feMergeNode in="c" />
              <feMergeNode in="b" />
              <feMergeNode in="a" />
            </feMerge>
          </filter>
        </defs>
        <g className="neon-glow" filter="url(#neon-bloom)">
          <text x="500" y="158" text-anchor="middle" textLength="940" lengthAdjust="spacingAndGlyphs" className="neon-text">Ridgestack</text>
        </g>
        <text x="500" y="158" text-anchor="middle" textLength="940" lengthAdjust="spacingAndGlyphs" className="neon-text neon-core">Ridgestack</text>
      </svg>
    </div>
  );
}

const PUSH_SAMPLE = `POST /api/repos/harbor/harbor-ledger/push
Authorization: Bearer rgs_<repository token>
Content-Type: application/json

{
  "branch": "round-totals",
  "expected_head": null,
  "from": "main",
  "message": "Round totals to cents",
  "files": [{ "path": "src/ledger.ts", "content": "export function total() {}\\n" }]
}`;

export function Home({ services }: { services: boolean | null }) {
  const page = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = page.current!;
    const targets = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12 });
    for (const target of targets) {
      if (target.getBoundingClientRect().top > window.innerHeight * 0.92) target.classList.add('reveal-pending');
      observer.observe(target);
    }
    const glow = root.querySelector('[data-reveal-glow]')!;
    const lit = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      glow.classList.add('lit');
      lit.disconnect();
    }, { threshold: 0.3 });
    lit.observe(glow);
    // The rule chips drift with the scroll position; nothing here runs on a timer.
    const drift = () => root.style.setProperty('--drift', String(Math.min(60, window.scrollY * 0.06)));
    window.addEventListener('scroll', drift, { passive: true });
    drift();
    return () => {
      observer.disconnect();
      lit.disconnect();
      window.removeEventListener('scroll', drift);
    };
  }, []);

  return (
    <Screen className="home">
      <div ref={page} className="home-page">
        <section className="hero">
          <div className="hero-copy">
            <h1>Stacks that keep their approvals</h1>
            <p className="hero-sub">
              Ridgestack restacks every change above a fix file by file, keeps an approval only when the approved diff did not move, and writes down why each change leaves the merge queue.
            </p>
            <div className="hero-actions">
              <Link href="/signup" className="btn btn-primary btn-lg">Open a workspace</Link>
              <a
                href="#push-api"
                className="btn btn-ghost btn-lg"
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById('push-api')?.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
                }}
              >
                Read the push API
              </a>
            </div>
            <p className="hero-note">Postgres, MinIO and Mailpit. No git, no code execution, no AI.</p>
          </div>
          <div className="hero-art">
            <Wireframe />
            <RevisionPlayer />
          </div>
        </section>

        <section className="bento-grid" id="features" aria-label="Features">
          <BentoCard wide delay={0} title="Every push, written down" body="One revision per push, stored exactly as submitted, with the stack restacked above it before the command returns." mock={<PushLog />} />
          <BentoCard delay={0.08} title="Reviews reach the right person" body="Review requests and mentions land in the inbox and by mail, with the change one click away." mock={<Toasts />} />
          <BentoCard delay={0.16} title="Checks from outside" body="Runners report through the checks API. A required check that never reports times out on the server clock." mock={<CheckPanel />} />
          <BentoCard delay={0.08} title="Merge rules you can read" body="Approvals, code owners, required checks, the merge queue and restack, each in one place." mock={<RuleChips />} />
          <BentoCard delay={0.16} title="Suggestions that apply" body="Propose replacement lines on a comment, then apply one or a whole batch as a single revision." mock={<SuggestionThread />} />
        </section>

        <section className="runners" id="check-runners" data-reveal>
          <h2>Check runners report from outside</h2>
          <p>Ridgestack never runs your code. Runners push revisions and report check results through the push and checks APIs with a repository token.</p>
        </section>

        <section className="api" data-reveal>
          <h2 id="push-api" tabIndex={-1}>Push API</h2>
          <pre className="api-sample mono" tabIndex={0} aria-label="Sample push request">{PUSH_SAMPLE}</pre>
        </section>

        <div className="closing" data-reveal>
          <Link href="/signup" className="start-pill">Start a stack</Link>
        </div>

        <footer className="home-footer">
          <div className="footer-top">
            <div className="footer-brand">
              <span className="footer-logo">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 17l5-8 4 5 3-4 6 7z" /></svg>
                Ridgestack
              </span>
              <p>Review and merge governance for stacks of small changes.</p>
            </div>
            <div className="footer-cols">
              <nav aria-label="Product">
                <h3>Product</h3>
                <a href="#features">Features</a>
                <a href="#push-api">Push API</a>
              </nav>
              <nav aria-label="Runners">
                <h3>Runners</h3>
                <a href="#check-runners">Check runners</a>
                <a href="#push-api">Checks API <span className="badge new">NEW</span></a>
              </nav>
              <nav aria-label="Account">
                <h3>Account</h3>
                <Link href="/login">Log in</Link>
                <Link href="/signup">Sign up <span className="badge count">0</span></Link>
              </nav>
              <nav aria-label="Start">
                <h3>Start</h3>
                <Link href="/signup">Create an account</Link>
                <Link href="/login">Sign in</Link>
              </nav>
            </div>
          </div>
          <hr />
          <div className="footer-status">
            <span className={`status-dot ${services ? '' : 'down'}`} aria-hidden="true" />
            <span role="status" aria-label="Service status">{services ? 'All services are running' : 'Some services are unavailable'}</span>
            <span className="copyright">© Tessaline Works</span>
          </div>
          <NeonWordmark />
        </footer>
      </div>
    </Screen>
  );
}
