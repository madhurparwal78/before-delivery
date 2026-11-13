import { useApp } from '../app.js';
import { WorkspaceHeader } from '../components/Header.js';
import { Menu } from '../components/Menu.js';
import { SignUpForm } from '../components/SignUpForm.js';
import {
  BrackenpadMark,
  DiscArcLine,
  DiscGlyphIcon,
  LineIcon,
  MockNotebookCascade,
  OutlinedCardIcon,
  type CardIcon,
  type DiscGlyph,
  type FeatureIcon,
} from '../components/graphics.js';

const RECENT = [
  {
    title: 'Tide gauge warm-up',
    date: 'Oct 28.',
    summary: 'Hourly heights from an invented gauge, plotted against the spring and neap cycle.',
  },
  {
    title: 'Rubric totals checker',
    date: 'Oct 21.',
    summary: "A teacher's notebook that totals rubric rows and flags missing marks.",
  },
  {
    title: 'Moth counts by lamp night',
    date: 'Oct 14.',
    summary: 'Three volunteers compare weekly trap counts without emailing a single copy.',
  },
];

const FEATURES: { title: string; blurb: string; icon: FeatureIcon }[] = [
  {
    title: 'Runs in your browser',
    blurb: 'Your code runs in a private worker in your own tab. Nothing runs on our server.',
    icon: 'browser',
  },
  {
    title: 'Edit together',
    blurb: 'See who is here, which cell they are in, and every run as it lands.',
    icon: 'together',
  },
  {
    title: 'Open format in and out',
    blurb: 'Import and export the open notebook format version 4. Your original file stays byte for byte.',
    icon: 'format',
  },
  {
    title: 'Find anything',
    blurb: 'Search every notebook you can open by its title, its cells and its headings.',
    icon: 'find',
  },
];

const LIFECYCLE: { title: string; blurb: string; glyph: DiscGlyph }[] = [
  { title: 'Write', blurb: 'Type a code or markdown cell from the keyboard.', glyph: 'write' },
  { title: 'Queue', blurb: 'Runs line up and everyone sees them waiting.', glyph: 'queue' },
  { title: 'Run', blurb: 'Your tab runs the cell and shares the count.', glyph: 'run' },
  { title: 'Checkpoint', blurb: 'Keep an exact snapshot you can put back.', glyph: 'checkpoint' },
];

const WORKSPACES = [
  'Fernhollow Primary',
  'Saltmarsh Survey Co-op',
  'Quillon Labs',
  'Larchgate College',
  'Okapi & Thistle',
  'Brimstone Allotments',
  'Northcott Readers',
  'Ember Valley Stats',
  'Pell & Rook',
  'Harrowgate Moth Group',
  'Tamsin Weir Studio',
  'Ledgerfield',
  'Corvid Analytics',
  'Mossbank Tutors',
  'Kestrel Row',
  'Wickham Fen Trust',
];

const PLANS: { title: string; blurb: string; icon: CardIcon }[] = [
  {
    title: 'Open notebook format',
    blurb: 'Version 4 in and out, with ids, sources, outputs and counts kept as they were.',
    icon: 'format',
  },
  {
    title: 'One free plan',
    blurb: 'The published limits, no seats: ten checkpoints a notebook and files up to 5,000,000 bytes.',
    icon: 'plan',
  },
  {
    title: 'Your file leaves with you',
    blurb: 'Download original returns the bytes you uploaded, to the byte.',
    icon: 'leave',
  },
];

function scrollToSignUp(): void {
  const form = document.getElementById('create-your-account');
  form?.scrollIntoView({ behavior: 'auto', block: 'center' });
  form?.querySelector<HTMLInputElement>('input')?.focus();
}

export function Landing(): JSX.Element {
  const app = useApp();
  return (
    <div className="landing">
      <WorkspaceHeader>
        <a
          className="header-link"
          href="#features"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('features')?.scrollIntoView();
          }}
        >
          Features
        </a>
        <a
          className="header-link"
          href="#open-format"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('open-format')?.scrollIntoView();
          }}
        >
          Open format
        </a>
        <a
          className="header-link"
          href="#limits"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('limits')?.scrollIntoView();
          }}
        >
          Limits
        </a>
        <Menu
          name="Resources"
          caret
          items={[
            { label: 'Keyboard shortcuts', onChoose: () => document.getElementById('features')?.scrollIntoView() },
            { label: 'Published limits', onChoose: () => document.getElementById('limits')?.scrollIntoView() },
            { label: 'Open format', onChoose: () => document.getElementById('open-format')?.scrollIntoView() },
          ]}
        />
        <a
          className="header-link"
          href="/signin"
          onClick={(event) => {
            event.preventDefault();
            app.navigate('/signin');
          }}
        >
          Sign in
        </a>
      </WorkspaceHeader>

      <section className="band band-grey band-hero">
        <div className="container">
          <BrackenpadMark />
        </div>
      </section>

      <section className="band band-white">
        <div className="container">
          <p className="tagline">
            Notebooks for people who think in code, with room for one or two more at the table.
          </p>
        </div>
      </section>

      <section className="band band-grey">
        <div className="container">
          <h2 className="section-heading">
            Recent from the <span className="accent-tail">notebook log</span>
          </h2>
        </div>
      </section>

      <section className="band band-white">
        <div className="container">
          <div className="card-grid">
            {RECENT.map((entry) => (
              <a
                key={entry.title}
                className="card recent-card"
                href="#create-your-account"
                onClick={(event) => {
                  event.preventDefault();
                  scrollToSignUp();
                }}
              >
                <h3>{entry.title}</h3>
                <p className="meta">{entry.date}</p>
                <p>{entry.summary}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-grey" id="checkpoints">
        <div className="container product-row">
          <div className="product-picture">
            <MockNotebookCascade />
          </div>
          <div className="product-text">
            <h2>
              Checkpoints: every version, <span className="accent-tail">side by side</span>
            </h2>
            <p className="lead">
              Save a checkpoint with one key, compare any version cell by cell, and put back exactly what
              was there.
            </p>
            <div className="button-row">
              <button type="button" className="button-embossed" onClick={scrollToSignUp}>
                Create account
              </button>
              <button
                type="button"
                className="button-embossed"
                onClick={() => document.getElementById('open-format')?.scrollIntoView()}
              >
                Read the format
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="band band-white" id="features">
        <div className="container">
          <h2 className="section-heading">
            What a notebook <span className="accent-tail">gives you</span>
          </h2>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="feature">
                <LineIcon icon={feature.icon} />
                <h3>{feature.title}</h3>
                <p>{feature.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-grey">
        <div className="container">
          <h2 className="section-heading">
            The life of a <span className="accent-tail">cell</span>
          </h2>
          <div className="disc-arc">
            <DiscArcLine />
            <ol className="disc-list">
              {LIFECYCLE.map((step) => (
                <li key={step.title}>
                  <span className="disc">
                    <DiscGlyphIcon glyph={step.glyph} />
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.blurb}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="button-row centred">
            <button type="button" className="button-embossed" onClick={scrollToSignUp}>
              Start a notebook
            </button>
          </div>
        </div>
      </section>

      <section className="band band-white">
        <div className="container">
          <h3 className="small-heading">Notebooks kept at</h3>
          <ul className="wordmark-wall">
            {WORKSPACES.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band band-grey" id="open-format">
        <div className="container">
          <h2 className="section-heading" id="limits">
            Open in, open <span className="accent-tail">out</span>
          </h2>
          <div className="card-grid">
            {PLANS.map((card) => (
              <div key={card.title} className="card plan-card">
                <OutlinedCardIcon icon={card.icon} />
                <h3>{card.title}</h3>
                <p>{card.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-upper">
          <div className="container footer-columns">
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#limits">Limits</a>
                </li>
                <li>
                  <a href="#open-format">Open format</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Wrenmoor Software</h4>
              <ul>
                <li>
                  <a href="#about">About</a>
                </li>
                <li>
                  <a href="#contact">Contact</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Policies</h4>
              <ul>
                <li>
                  <a href="#privacy">Privacy</a>
                </li>
                <li>
                  <a href="#terms">Terms</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-lower">
          <div className="container">
            <h3 className="footer-heading">Make your first notebook</h3>
            <SignUpForm />
            <p className="footnote">© 2026 Wrenmoor Software</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
