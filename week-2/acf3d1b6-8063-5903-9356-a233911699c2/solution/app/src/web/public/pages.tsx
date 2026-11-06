import { useState } from 'preact/hooks';
import { Art } from '../ui/art.js';
import { ChevronDown } from '../ui/icons.js';
import { EnquiryForm, EnquiryThanks, EnterpriseEnquiry } from './enquiry.js';
import { TeamAndEnterpriseCards } from './pricing.js';

const FAQ: [string, string][] = [
  ['What is the Team plan?', 'Team is a plan for groups of two to nine people who create together in one Kinora workspace.'],
  [
    'How does the shared credit pool work?',
    'Every member spends from one balance. Each seat adds 6,900 credits to it the moment the person joins, and every generation anyone starts is charged to that same pool.',
  ],
  [
    'Can I change the number of seats?',
    'Yes. Our sales team sets up Team workspaces and adjusts seats with you; the owner then invites teammates by email until all seats are in use.',
  ],
  [
    'When should we consider Enterprise instead?',
    'When you need more than nine people, several workspaces, single sign-on or custom security terms, Enterprise is sized to your organization.',
  ],
];

function Question({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="faq-row">
      <h3>
        <button
          type="button"
          class="faq-question"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={`faq-${index}`}
          onClick={() => setOpen(!open)}
        >
          {question}
          <ChevronDown class={open ? 'is-flipped' : undefined} />
        </button>
      </h3>
      <p id={`faq-${index}`} class="faq-answer" hidden={!open}>
        {answer}
      </p>
    </div>
  );
}

export function TeamPlanPage() {
  return (
    <>
      <section class="page-hero container split">
        <div>
          <h1 class="display">Kinora Team</h1>
          <p class="lede">
            Grow your business faster with more on-brand campaigns, product shots and social, made in a fraction of the
            time.
          </p>
          <a class="pill pill-dark pill-large" href="/enterprise-contact">Get Team</a>
        </div>
        <Art phrase="Kinora Team, many soft lights sharing one glowing pool" aspect="1:1" class="frame-art" />
      </section>
      <section class="section container grid-3">
        <article class="card block">
          <h2 class="title">One place for your team's work</h2>
          <p>Projects, generations and their history live in one shared workspace, so everyone sees the same work.</p>
        </article>
        <article class="card block">
          <h2 class="title">Manage the whole team from one balance</h2>
          <p>Every seat adds 6,900 credits a month to a single shared pool, and they land the moment you add the seat.</p>
        </article>
        <article class="card block">
          <h2 class="title">Bring Kinora to the tools you already use</h2>
          <p>Hand finished shots to your editing, design and review tools without changing how your team works.</p>
        </article>
      </section>
      <section class="section container">
        <h2 class="heading section-title">For every team with creative needs</h2>
        <div class="grid-3">
          {[
            ['Marketing teams', 'Campaign films, product shots and social cuts on brand, in hours rather than weeks.'],
            ['Studios and agencies', 'Pitch with finished frames, explore directions fast and deliver more variations.'],
            ['In-house creative', 'Keep a steady stream of on-brand content without growing the production budget.'],
          ].map(([title, text]) => (
            <article key={title} class="card block">
              <h3 class="title">{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section class="section container">
        <TeamAndEnterpriseCards yearly />
      </section>
      <section class="section container narrow">
        <h2 class="heading section-title">Frequently asked questions</h2>
        <div class="faq">
          {FAQ.map(([question, answer], index) => (
            <Question key={question} question={question} answer={answer} index={index} />
          ))}
        </div>
      </section>
    </>
  );
}

export function EnterprisePage() {
  const [sent, setSent] = useState(false);
  if (sent) return <EnquiryThanks />;
  return (
    <>
      <section class="page-hero container">
        <h1 class="display">
          <span class="display-line">Production-ready AI</span>
          <span class="display-line">Made for Enterprise</span>
        </h1>
        <p class="lede">
          Our full suite of creative AI tools can help your teams realize bigger ideas with smaller budgets and timelines.
        </p>
        <a class="pill pill-dark pill-large" href="/enterprise-contact">Contact Sales</a>
      </section>
      <section class="section container">
        <h2 class="heading section-title">Why Enterprises Choose Kinora</h2>
        <div class="grid-2">
          <article class="card stat">
            <p class="stat-figure">2 weeks</p>
            <p>Saved on production timeline despite no access to on-camera talent</p>
            <p class="caption">Halvard Pictures</p>
          </article>
          <article class="card stat">
            <p class="stat-figure">80%</p>
            <p>Cost savings vs traditional VFX Pipeline</p>
            <p class="caption">Saltmarsh Media</p>
          </article>
        </div>
      </section>
      <section class="section container">
        <h2 class="heading section-title">Built for Enterprise</h2>
        <ul class="assurances">
          {['We don\'t train on your data', 'SOC 2 Type 2', 'Customizable access & permissions', 'Full ownership of your outputs', 'Single Sign On (SSO)'].map(
            (item) => (
              <li key={item} class="card assurance">{item}</li>
            ),
          )}
        </ul>
      </section>
      <EnterpriseEnquiry onSent={() => setSent(true)} />
    </>
  );
}

export function EnterpriseContactPage() {
  const [sent, setSent] = useState(false);
  return sent ? <EnquiryThanks /> : <EnterpriseEnquiry standalone onSent={() => setSent(true)} />;
}

export function ModelLicensingPage() {
  const [sent, setSent] = useState(false);
  if (sent) return <EnquiryThanks />;
  return (
    <>
      <section class="page-hero container">
        <p class="eyebrow">Model licensing</p>
        <h1 class="display">Create your own frontier.</h1>
        <p class="lede">
          License state of the art Kinora model weights. Fine-tune on your own data, self-host on your infrastructure and
          commercialize what you create.
        </p>
        <a class="pill pill-dark pill-large" href="/enterprise-contact">Talk to our team</a>
      </section>
      <section class="section container grid-2">
        {[
          ['Start at the frontier.', 'Begin from the same Vela weights that power the Kinora studio.'],
          ['Tune it to you.', 'Fine-tune on your own footage, products and style until it draws like your team.'],
          ['Run within your walls.', 'Self-host on your own infrastructure so your data never leaves it.'],
          ['White glove service.', 'Our research engineers help you train, evaluate and deploy.'],
        ].map(([title, text]) => (
          <article key={title} class="card block">
            <h2 class="title">{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section class="section container narrow">
        <h2 class="heading section-title">Tell us about your licensing needs.</h2>
        <EnquiryForm source="licensing" onSent={() => setSent(true)} />
      </section>
    </>
  );
}

export function UseCasesPage() {
  return (
    <>
      <section class="page-hero container">
        <h1 class="display">AI video for whatever you make</h1>
      </section>
      <section class="section container">
        <h2 class="heading section-title">Find your use case</h2>
        <div class="grid-3">
          {[
            ['Social Media Content Creation', 'Vertical cuts, loops and teasers made for every feed in minutes.', 'social loops of pastel morning light'],
            ['Product shots', 'Hero shots of any product in any setting, without booking a studio.', 'a glass product on wet stone under rim light'],
            ['Packaging & Retail Visualization', 'See packaging and shelves in real stores before anything is printed.', 'warm shop window glow at dusk'],
            ['Automotive Product Photography', 'Cars on any road, in any weather and light, from every angle.', 'a red car on a coastal road at sunset'],
            ['UGC ads', 'Handheld, authentic-looking ads that feel filmed by real customers.', 'a sunny living room in soft daylight'],
          ].map(([title, text, phrase]) => (
            <article key={title} class="card use-card">
              <Art phrase={phrase} aspect="16:9" class="card-art" />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function WorkflowsPage() {
  return (
    <>
      <section class="page-hero container">
        <h1 class="display">Introducing Kinora Workflows</h1>
        <p class="lede">Chain models, prompts and steps into recipes your team can run again and again. Coming to the studio.</p>
      </section>
      <section class="section container">
        <h2 class="heading section-title">Why Workflows?</h2>
        <div class="grid-3">
          {[
            ['Combine multiple models, modalities and tasks', 'Pass a still into a video model, then into an upscaler, in one run.'],
            ['Create reusable templates', 'Save a good result as a recipe anyone on the team can reuse.'],
            ['Automate repetitive tasks', 'Run the same steps across a whole catalogue of products at once.'],
          ].map(([title, text]) => (
            <article key={title} class="card block">
              <h3 class="title">{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section class="section container">
        <h2 class="heading section-title">Featured Workflows</h2>
        <ul class="chips">
          {['Image Style Generator', 'Image Variations', 'Storyboard Creator', 'Virtual Try On', 'Custom Instructions Workshop', 'Image to Text', 'Hair Salon', 'Animatic Generator', 'Style Blend'].map(
            (name) => (
              <li key={name} class="chip">{name}</li>
            ),
          )}
        </ul>
      </section>
      <section class="section container narrow">
        <h2 class="heading section-title">FAQ</h2>
        <div class="card block">
          <h3 class="title">Do workflows take credits?</h3>
          <p>Yes. Media model nodes and LLM nodes use credits when they run.</p>
        </div>
      </section>
    </>
  );
}

const PAPERS = [
  {
    title: 'Vela 4.5: Steady Long-Shot Video Generation',
    authors: 'Kinora Research — A. Moreau, J. Okafor, L. Brandt',
    date: '14 October 2026',
    abstract: 'We describe a video model that keeps camera motion, lighting and identity consistent across shots of up to ten seconds.',
  },
  {
    title: 'General World Models as Simulators of Everyday Physics',
    authors: 'Kinora Research — S. Ivers, M. Tanaka',
    date: '2 September 2026',
    abstract: 'Training on diverse footage lets a single model predict how objects fall, flow and collide, without hand-written physics.',
  },
  {
    title: 'Measuring Temporal Coherence in Generated Video',
    authors: 'Kinora Research — R. Lindqvist, P. Achebe, C. Duval',
    date: '18 July 2026',
    abstract: 'We propose a benchmark for flicker, drift and identity changes, and report how human raters agree with it.',
  },
];

export function ResearchPage() {
  return (
    <>
      <section class="page-hero container">
        <h1 class="display">
          <span class="display-line">Building general-purpose multimodal</span>
          <span class="display-line">simulators of the world.</span>
        </h1>
      </section>
      <section class="section container grid-3" aria-label="Papers">
        {PAPERS.map((paper) => (
          <article key={paper.title} class="card paper">
            <p class="caption">{paper.date}</p>
            <h2 class="title">{paper.title}</h2>
            <p class="caption">{paper.authors}</p>
            <p>{paper.abstract}</p>
          </article>
        ))}
      </section>
    </>
  );
}

const FEATURED = [
  { title: 'Writing prompts that direct the camera', text: 'Subject, light and lens words, and how each one changes the shot.' },
  { title: 'One balance for the whole team', text: 'How shared credits work in a Team workspace, seat by seat.' },
  { title: 'From storyboard to animatic in an afternoon', text: 'A walkthrough of a small studio planning a thirty-second spot.' },
];

const ARTICLES = [
  { title: 'Choosing between Vela 4.5 and Vela 4 Turbo', author: 'Nadia Hale', date: '20 October 2026' },
  { title: 'Aspect ratios for every feed', author: 'Owen Price', date: '8 October 2026' },
  { title: 'Keeping a character consistent across shots', author: 'Mei Lin', date: '25 September 2026' },
  { title: 'Lighting words the models understand', author: 'Tomas Reyes', date: '11 September 2026' },
  { title: 'A credit budget for a product launch', author: 'Grace Adeyemi', date: '28 August 2026' },
];

export function ResourcesPage() {
  return (
    <>
      <section class="page-hero container">
        <h1 class="display">Resources</h1>
        <p class="lede">Guides, walkthroughs and notes from the people who make Kinora.</p>
      </section>
      <section class="section container">
        <h2 class="heading section-title">Featured</h2>
        <div class="grid-3">
          {FEATURED.map((item) => (
            <article key={item.title} class="card block">
              <h3 class="title">{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section class="section container">
        <h2 class="heading section-title">All Resources</h2>
        <ul class="article-rows">
          {ARTICLES.map((item) => (
            <li key={item.title} class="article-row">
              <h3 class="article-title">{item.title}</h3>
              <p class="caption">
                {item.author} · {item.date}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function PrivacyPage() {
  return (
    <section class="page-hero container narrow prose">
      <h1 class="display">Privacy</h1>
      <p class="lede">What Kinora keeps about you, who reads it, and the one cookie we set.</p>
      <h2 class="heading">Your account</h2>
      <p>
        An account stores your name, your email address, a hashed password (never the password itself) and the workspace
        you belong to, with its projects, generations and credit history.
      </p>
      <h2 class="heading">Enquiries</h2>
      <p>
        An enterprise or licensing enquiry stores the fields of the form: your name, business email, company, company
        size, industry, the products you are interested in and your message.
      </p>
      <h2 class="heading">Invitations</h2>
      <p>An invitation stores the invited email address and the workspace it invites that person to.</p>
      <h2 class="heading">Who reads it</h2>
      <p>
        Only Kinora staff and the members of your own workspace read this information. We do not sell it or share it
        with advertisers.
      </p>
      <h2 class="heading">Cookies</h2>
      <p>
        The app sets at most one cookie, and only to keep you signed in. There is no tracking cookie, no analytics and no
        advertising cookie.
      </p>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section class="confirmation container">
      <Art phrase="Page not found, an empty quiet horizon at dusk" aspect="16:9" class="confirmation-art" />
      <h1 class="display">Page not found</h1>
      <p class="lede">We could not find that page.</p>
      <a class="button button-dark" href="/">Back to home</a>
    </section>
  );
}
