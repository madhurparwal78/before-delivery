import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { Art, TabPanel, TabRow } from '../components/ui';
import { ChevronRight } from '../components/Icons';

const PARTNERS = [
  'Northwind Pictures',
  'Caldera Motors',
  'Helio Health',
  'Sable & Finch',
  'Bright Harbour',
  'Orenda Labs',
  'Pacific Grain',
  'Lumen Retail'
];

const PLATFORMS = [
  {
    name: 'Kinora Creative',
    line: 'Your complete Creative Suite with everything you need, to make anything you want.',
    buttons: [
      { label: 'Try now', href: '/signup', skin: 'btn-dark' },
      { label: 'Learn more', href: '/product', skin: 'btn-light' },
      { label: 'For Enterprise', href: '/enterprise', skin: 'btn-light' }
    ],
    caption: 'Used by 60m+ creatives around the world. Try free, cancel anytime.'
  },
  {
    name: 'Kinora Dev',
    line: 'The same models behind one API, for teams building video into their own products.',
    buttons: [{ label: 'Contact Sales', href: '/enterprise-contact', skin: 'btn-light' }],
    caption: ''
  },
  {
    name: 'Kinora Robotics',
    line: 'World simulation for machines that have to act in the physical world.',
    buttons: [{ label: 'Contact Sales', href: '/enterprise-contact', skin: 'btn-light' }],
    caption: ''
  }
];

const USE_TABS = [
  {
    id: 'how',
    label: 'How Kinora is Used',
    heading: 'From a sentence to a finished sequence',
    body: 'Teams write what they want to see, pick a model and a length, and get a finished sequence they can share the same afternoon. Every generation is paid for in credits from one shared balance.'
  },
  {
    id: 'agent',
    label: 'Create with Agent',
    heading: 'Describe the change, not the timeline',
    body: 'Ask for a different light, a tighter crop or a calmer pace and the studio starts the next generation for you, keeping the prompt that worked.'
  },
  {
    id: 'workflows',
    label: 'Build your own Workflows',
    heading: 'Chain the steps you repeat',
    body: 'Save the sequence of models and prompts your team runs every week as a template, then run it again on a new brief.'
  },
  {
    id: 'enterprise',
    label: 'Enterprise-grade',
    heading: 'Controls your security team will recognise',
    body: 'Single sign on, audited access, full ownership of your outputs and no training on your data, with credits budgeted per workspace.'
  },
  {
    id: 'models',
    label: "The World's Best Models",
    heading: 'Three models, one world model',
    body: 'Vela 4.5 for cinematic motion, Vela 4 Turbo for fast exploration and Vela Image 4 for stills, all drawing on the same understanding of the world.'
  }
];

const RESEARCH_ROWS = ['Vela 4.5', 'General World Models', 'Research Hub'];

const NEWS = [
  {
    title: 'Vela 4.5 is available to every plan',
    summary: 'Our most cinematic model now renders for 12 credits a second, with steadier characters across cuts.'
  },
  {
    title: 'Team workspaces share one balance',
    summary: 'Every seat adds 6,900 credits a month to a single pool, so a campaign is budgeted in one place.'
  },
  {
    title: 'Kinora Research publishes three new papers',
    summary: 'On long-horizon simulation, consistent characters and evaluating motion without reference video.'
  },
  {
    title: 'Model licensing opens to selected partners',
    summary: 'Run Kinora weights inside your own infrastructure, fine-tuned on your own library.'
  }
];

export function Home() {
  const [tab, setTab] = useState(USE_TABS[0].id);
  const active = USE_TABS.find((item) => item.id === tab)!;

  return (
    <PublicLayout>
      <section class="shell section-tight">
        <div class="hero-frame">
          <div class="hero-art">
            <Art seed="kinora home hero real world intelligence" title="Kinora hero" decorative />
          </div>
          <div class="hero-body">
            <h1>Building Real-World Intelligence</h1>
            <p class="lead">
              Kinora is building foundational Real-World Intelligence that can understand, simulate and act in the
              world. We offer products and services built on-top of this intelligence to empower individuals and
              organizations to do more in the world.
            </p>
            <a class="btn btn-light btn-pill btn-big" href="/signup">
              Try Kinora for free
            </a>
          </div>
        </div>
      </section>

      <section class="shell section-tight">
        <p class="muted">We partner with the world's leading organizations to advance their industries:</p>
        <div class="marquee">
          <div class="marquee-track">
            {[...PARTNERS, ...PARTNERS].map((partner, index) => (
              <span class="marquee-item" key={`${partner}-${index}`} aria-hidden={index >= PARTNERS.length ? 'true' : undefined}>
                {partner}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section class="shell section">
        <h2>Three platforms built on-top of the same Real-World Intelligence models</h2>
        <div class="card-grid" style="margin-top:28px">
          {PLATFORMS.map((platform) => (
            <article class="card" key={platform.name}>
              <Art
                className="art-thumb"
                seed={`platform ${platform.name}`}
                title={`${platform.name} artwork`}
                decorative
              />
              <h3 style="margin-top:16px">{platform.name}</h3>
              <p>{platform.line}</p>
              <div class="chip-group">
                {platform.buttons.map((button) => (
                  <a class={`btn ${button.skin}`} href={button.href} key={`${platform.name}-${button.label}`}>
                    {button.label}
                  </a>
                ))}
              </div>
              {platform.caption ? (
                <p class="muted" style="font-size:.88rem;margin-top:14px">
                  {platform.caption}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <TabRow
          label="How Kinora is used"
          idPrefix="home-use"
          tabs={USE_TABS.map((item) => ({ id: item.id, label: item.label }))}
          value={tab}
          onChange={setTab}
        />
        <div style="margin-top:22px">
          <TabPanel idPrefix="home-use" id={active.id}>
            <div class="card" style="display:grid;gap:22px;grid-template-columns:minmax(0,1fr)">
              <h3>{active.heading}</h3>
              <p style="margin:0">{active.body}</p>
              <Art className="art-thumb" seed={`home tab ${active.id}`} title={`${active.label} artwork`} decorative />
            </div>
          </TabPanel>
        </div>
      </section>

      <section class="shell section">
        <div class="dark-band">
          <h2>Kinora Research</h2>
          <p style="color:var(--footer-muted)">
            We publish what we learn about simulating the world, and the models that come out of it.
          </p>
          <div style="margin-top:18px">
            {RESEARCH_ROWS.map((row) => (
              <a class="dark-row" href="/research" key={row}>
                <span style="color:#fff;font-size:1.1rem">{row}</span>
                <ChevronRight />
              </a>
            ))}
          </div>
        </div>
      </section>

      <section class="shell section">
        <h2>See the latest from Kinora</h2>
        <div class="card-grid card-grid-2" style="margin-top:24px">
          {NEWS.map((item) => (
            <article class="card lift" key={item.title}>
              <Art className="art-thumb" seed={`news ${item.title}`} title={`${item.title} artwork`} decorative />
              <h3 style="margin-top:16px;font-size:1.12rem">{item.title}</h3>
              <p style="margin:0">{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
