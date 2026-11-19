import { useEffect, useRef, useState, type AnimationEvent, type KeyboardEvent } from 'react';
import { Link, useTitle } from '../router';
import { EXAMPLES, HookToLoop } from '../site/graphs';
import { PixelIcon } from '../site/pixels';
import { Reveal, useReducedMotion } from '../ui';
import '../build/styles/site.css';

const LINES = ['Draft in peace.', 'Publish with eyes open.'];
const LAST_LETTER = LINES.join('').replace(/ /g, '').length - 1;

function Headline({ onBuilt }: { onBuilt: () => void }) {
  let index = 0;
  return (
    <h1 className="hero-title" aria-label={LINES.join(' ')}>
      {LINES.map((line) => (
        <span key={line} className="hero-line" aria-hidden="true">
          {line.split(' ').map((word, wordIndex) => (
            <span key={wordIndex}>
              <span className="hero-word">
              {[...word].map((letter, letterIndex) => {
                const mine = index;
                index += 1;
                return (
                  <span
                    key={letterIndex}
                    className="hero-letter"
                    style={{ ['--i' as string]: mine }}
                    onAnimationEnd={mine === LAST_LETTER ? onBuilt : undefined}
                  >
                    {letter}
                  </span>
                );
              })}
              </span>
              {' '}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}

function PreviewFrame({ built }: { built: boolean }) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(reduced);
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [switched, setSwitched] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const usable = ready || (reduced && built);

  const choose = (next: number): void => {
    if (!usable || next === active) return;
    setLeaving(reduced ? null : active);
    setSwitched(true);
    setActive(next);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!usable || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const next = (active + (event.key === 'ArrowRight' ? 1 : EXAMPLES.length - 1)) % EXAMPLES.length;
    choose(next);
    tabs.current[next]?.focus();
  };
  const settled = (event: AnimationEvent<HTMLDivElement>): void => {
    if (event.animationName === 'diagram-in') setReady(true);
    if (event.animationName === 'panel-out') setLeaving(null);
  };

  return (
    <div id="preview" className="preview-frame">
      <div className="preview-stage panel-dark on-dark" data-built={built} tabIndex={0}>
        {built ? (
          <div className="diagram-layer" onAnimationEnd={settled}>
            {leaving !== null ? (
              <div role="tabpanel" aria-label={EXAMPLES[leaving]?.name} className="diagram-panel leaving">
                {EXAMPLES[leaving]?.view()}
              </div>
            ) : null}
            <div
              key={active}
              role="tabpanel"
              id={`panel-${active}`}
              aria-labelledby={`tab-${active}`}
              className={`diagram-panel${switched ? ' entering' : ' first'}`}
            >
              {EXAMPLES[active]?.view()}
            </div>
          </div>
        ) : (
          <div className="stage-skeleton" aria-hidden="true">
            <span /><span /><span />
          </div>
        )}
      </div>
      <div role="tablist" aria-label="Example automations" className="preview-tabs" onKeyDown={keys}>
        {EXAMPLES.map((example, index) => (
          <button
            key={example.name}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${index}`}
            aria-selected={active === index}
            aria-controls={`panel-${index}`}
            aria-disabled={!usable}
            tabIndex={active === index ? 0 : -1}
            className="preview-tab"
            onClick={() => choose(index)}
          >
            {example.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const KINDS: Array<{ title: string; body: string; icon: 'bolt' | 'branch' | 'grid' | 'mail' }> = [
  { title: 'Triggers', body: 'Start from a public form, a schedule, an incoming webhook, a new table row or a button press.', icon: 'bolt' },
  { title: 'Logic and waiting', body: 'Filter, branch, loop over lists or rows, and put a run to sleep until the workspace clock says go.', icon: 'branch' },
  { title: 'Tables', body: 'Add rows and update rows in built-in tables, and loop over every row of one.', icon: 'grid' },
  { title: 'Mail and webhooks', body: 'Send real email to your members and call your own hooks, with retries and an error path.', icon: 'mail' },
];

const STORIES = [
  { company: 'Kestrel Cold Chain', mark: 'a', headline: 'No second confirmation email, ever.', quote: 'We replay a failed delivery check from the step that broke. The customer gets one message, not two.', name: 'Maren Okafor', role: 'Operations lead' },
  { company: 'Ledgerline Finance', mark: 'b', headline: 'Month end runs on the version we signed off.', quote: 'We published a fix while invoices were waiting. The sleeping runs finished on the old logic and we watched the counter reach zero.', name: 'Teodor Brandt', role: 'Finance controller' },
  { company: 'Tidewater Support', mark: 'c', headline: 'Two editors, one draft, no silent overwrites.', quote: 'When a teammate holds a step, my save is refused with their name. That one notice ended our Friday surprises.', name: 'Priya Lindqvist', role: 'Support manager' },
];

function BrandMark({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" className="brand-mark" aria-hidden="true">
      {kind === 'a' ? <path d="M4 26 16 6l12 20z" /> : kind === 'b' ? <><rect x="4" y="4" width="10" height="10" rx="3" /><rect x="18" y="18" width="10" height="10" rx="3" /></> : <circle cx="16" cy="16" r="12" />}
    </svg>
  );
}

export function Landing() {
  useTitle('Draft in peace. Publish with eyes open.');
  const reduced = useReducedMotion();
  const [built, setBuilt] = useState(reduced);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <div className="landing">
      <section className="hero">
        <Headline onBuilt={() => setBuilt(true)} />
        <p className="hero-sub">
          Wire forms, schedules, webhooks and tables into automations. Test them, publish numbered versions, and replay any failed run.
        </p>
        <div className="hero-actions">
          <Link to="/sign-up" className="btn btn-primary">
            Create a workspace
          </Link>
          <Link to="/sign-in" className="btn btn-secondary">
            Sign in
          </Link>
        </div>
        <PreviewFrame built={built} />
      </section>

      <section className="split" aria-labelledby="split-title">
        <Reveal className="split-copy">
          <h2 id="split-title">Edit freely. Go live on purpose.</h2>
          <ul className="hairlist">
            <li>
              <h3>Drafts stay drafts</h3>
              <p>Saving is not publishing. Test-run on sample data, then publish a numbered version when you are ready.</p>
            </li>
            <li>
              <h3>Runs keep their version</h3>
              <p>A run asleep in a wait step finishes on the logic it started with, and a counter shows how many are left.</p>
            </li>
            <li>
              <h3>Replay from a step</h3>
              <p>Choose any step at or before the failure. Earlier steps are reused, so nothing is emailed twice.</p>
            </li>
          </ul>
        </Reveal>
        <Reveal className="split-panel">
          <div className="panel-dark on-dark">
            <HookToLoop />
          </div>
        </Reveal>
      </section>

      <section id="step-kinds" className="kinds">
        <Reveal>
          <h2>Four kinds of step, one canvas</h2>
        </Reveal>
        <Reveal>
          <section aria-label="Step kinds" className="kind-row" tabIndex={0}>
            {KINDS.map((kind) => (
              <article key={kind.title} className="kind-card on-dark">
                <div className="kind-art">
                  <PixelIcon name={kind.icon} />
                </div>
                <div className="kind-text">
                  <h3>{kind.title}</h3>
                  <p className="muted-on-dark">{kind.body}</p>
                </div>
              </article>
            ))}
          </section>
        </Reveal>
      </section>

      <section id="stories" className="stories">
        <Reveal>
          <h2>Teams that ship with eyes open</h2>
        </Reveal>
        <Reveal>
          <section aria-label="Automation stories" className="story-row" tabIndex={0}>
            {STORIES.map((story) => (
              <article key={story.company} className="story-card on-dark">
                <header>
                  <BrandMark kind={story.mark} />
                  <span className="mono-label">{story.company}</span>
                </header>
                <h3>{story.headline}</h3>
                <blockquote>{story.quote}</blockquote>
                <footer>
                  <span className="initials" aria-hidden="true">
                    {story.name.split(' ').map((part) => part[0]).join('')}
                  </span>
                  <span>
                    <strong>{story.name}</strong>
                    <br />
                    <span className="muted-on-dark">{story.role}</span>
                  </span>
                </footer>
              </article>
            ))}
          </section>
        </Reveal>
      </section>
    </div>
  );
}
