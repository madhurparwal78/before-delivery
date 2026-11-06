import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { EnquiryDone, EnquiryForm, EnquiryPanel } from '../components/EnquiryForm';
import { Art } from '../components/ui';

const STATS = [
  {
    studio: 'Mirrorline Studios',
    stat: '2 weeks',
    line: 'Saved on production timeline despite no access to on-camera talent'
  },
  { studio: 'Fathom & Field', stat: '80%', line: 'Cost savings vs traditional VFX Pipeline' }
];

const BUILT_FOR = [
  "We don't train on your data",
  'SOC 2 Type 2',
  'Customizable access & permissions',
  'Full ownership of your outputs',
  'Single Sign On (SSO)'
];

const LICENSING_CARDS = [
  {
    heading: 'Start at the frontier.',
    body: 'Begin from the same weights that power Vela 4.5, not a distilled copy of them.'
  },
  { heading: 'Tune it to you.', body: 'Fine-tune on your own library so the model learns your house style.' },
  { heading: 'Run within your walls.', body: 'Self-host on your infrastructure, with your own keys and controls.' },
  { heading: 'White glove service.', body: 'A named research contact from the first evaluation to production.' }
];

export function EnterpriseContact() {
  const [done, setDone] = useState(false);
  return (
    <PublicLayout>
      {done ? (
        <EnquiryDone />
      ) : (
        <section class="shell section">
          <div class="enquiry-grid">
            <EnquiryPanel seed="enquiry panel contact" />
            <div>
              <h1 style="font-size:clamp(1.9rem,3.4vw,2.6rem)">Tell us more about your use case.</h1>
              <EnquiryForm source="contact" onDone={() => setDone(true)} />
            </div>
          </div>
        </section>
      )}
    </PublicLayout>
  );
}

export function Enterprise() {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <PublicLayout>
        <EnquiryDone />
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <section class="shell section-tight">
        <div class="hero-frame">
          <div class="hero-art">
            <Art seed="kinora enterprise production ready" title="Enterprise artwork" decorative />
          </div>
          <div class="hero-body">
            <h1>
              Production-ready AI
              <br />
              Made for Enterprise
            </h1>
            <p class="lead">
              Our full suite of creative AI tools can help your teams realize bigger ideas with smaller budgets and
              timelines.
            </p>
            <a class="btn btn-light btn-pill btn-big" href="/enterprise-contact">
              Contact Sales
            </a>
          </div>
        </div>
      </section>

      <section class="shell section">
        <h2>Why Enterprises Choose Kinora</h2>
        <div class="card-grid card-grid-2" style="margin-top:24px">
          {STATS.map((item) => (
            <article class="stat-card" key={item.studio}>
              <p class="eyebrow" style="margin-bottom:8px">
                {item.studio}
              </p>
              <p class="stat" style="margin:0">
                {item.stat}
              </p>
              <p style="margin:8px 0 0">{item.line}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>Built for Enterprise</h2>
        <ul class="feature-list" style="margin-top:18px;font-size:1.05rem">
          {BUILT_FOR.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section class="shell section" id="enquiry">
        <div class="enquiry-grid">
          <EnquiryPanel seed="enquiry panel enterprise" />
          <div>
            <h2>Tell us more about your use case.</h2>
            <EnquiryForm source="contact" onDone={() => setDone(true)} />
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export function ModelLicensing() {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <PublicLayout>
        <EnquiryDone />
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <section class="shell section">
        <p class="eyebrow">Model licensing</p>
        <h1>Create your own frontier.</h1>
        <p class="lead">
          License state of the art Kinora model weights. Fine-tune on your own data, self-host on your infrastructure
          and commercialize what you create.
        </p>
        <a class="btn btn-dark btn-pill btn-big" href="/enterprise-contact">
          Talk to our team
        </a>
      </section>

      <section class="shell section-tight">
        <div class="card-grid card-grid-2">
          {LICENSING_CARDS.map((card) => (
            <article class="card lift" key={card.heading}>
              <h2 style="font-size:1.25rem">{card.heading}</h2>
              <p style="margin:0">{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <div class="enquiry-grid">
          <EnquiryPanel seed="enquiry panel licensing" />
          <div>
            <h2>Tell us more about your use case.</h2>
            <EnquiryForm source="licensing" onDone={() => setDone(true)} />
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
