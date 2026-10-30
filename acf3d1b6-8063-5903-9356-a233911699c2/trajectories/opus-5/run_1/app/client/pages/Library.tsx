import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { Art } from '../components/ui';
import { ChevronDown } from '../components/Icons';

const USE_CASES = [
  {
    heading: 'Social Media Content Creation',
    line: 'Vertical cutdowns, hooks and loops made in the morning and posted by lunch.'
  },
  { heading: 'Product shots', line: 'One product, a dozen sets, every frame lit the same way.' },
  {
    heading: 'Packaging & Retail Visualization',
    line: 'See a carton on a shelf, in a window and in a hand before the print run.'
  },
  { heading: 'Automotive Product Photography', line: 'Orbit a car through weather and time of day without a track.' },
  { heading: 'UGC ads', line: 'Handheld, first-person spots that feel filmed in a real apartment.' }
];

const WORKFLOW_REASONS = [
  {
    heading: 'Combine multiple models, modalities and tasks',
    body: 'Put a still model, a video model and a language step in one line of work.'
  },
  {
    heading: 'Create reusable templates',
    body: 'Save the sequence that worked and hand it to the rest of the team.'
  },
  { heading: 'Automate repetitive tasks', body: 'Run the same treatment over a list of products or briefs.' }
];

const FEATURED_WORKFLOWS = [
  'Image Style Generator',
  'Image Variations',
  'Storyboard Creator',
  'Virtual Try On',
  'Custom Instructions Workshop',
  'Image to Text',
  'Hair Salon',
  'Animatic Generator',
  'Style Blend'
];

const PAPERS = [
  {
    title: 'Vela 4.5: cinematic motion from a single sentence',
    authors: 'M. Ellery, J. Okonkwo, R. Lindqvist, S. Adeyemi',
    date: '14 September 2026',
    abstract:
      'We describe the training recipe behind Vela 4.5, a world model that keeps characters, light and lens behaviour consistent across cuts while following a short written brief.'
  },
  {
    title: 'General world models for long-horizon simulation',
    authors: 'P. Navarro, H. Takeda, C. Brandt',
    date: '2 July 2026',
    abstract:
      'A study of what a simulator must remember to keep a scene coherent over a minute of generated time, and how memory can be budgeted against compute.'
  },
  {
    title: 'Measuring motion without reference video',
    authors: 'L. Ferreira, D. Whitlock',
    date: '19 March 2026',
    abstract:
      'We propose an evaluation for generated motion that does not depend on a matched reference clip, and show it agrees with the judgements of working editors.'
  }
];

const FEATURED_ARTICLES = [
  {
    title: 'How a two-person studio ships a campaign a week',
    author: 'Ida Brennan',
    date: '8 October 2026',
    summary: 'A working method for briefs, prompts and credit budgets that fits in one afternoon.'
  },
  {
    title: 'Writing prompts that survive the second draft',
    author: 'Ruben Alvarez',
    date: '21 September 2026',
    summary: 'Why naming the light and the lens beats naming the mood, with before and after examples.'
  },
  {
    title: 'Credits, explained for producers',
    author: 'Nell Okafor',
    date: '3 September 2026',
    summary: 'What a second of Vela 4.5 costs, and how to plan a shared balance across a team.'
  }
];

const ALL_ARTICLES = [
  { title: 'A shot list for generated video', author: 'Ida Brennan', date: '29 August 2026' },
  { title: 'Keeping a character consistent across cuts', author: 'Sam Oduya', date: '12 August 2026' },
  { title: 'From storyboard to animatic in one sitting', author: 'Ruben Alvarez', date: '30 July 2026' },
  { title: 'What we learned from 10,000 product reshoots', author: 'Nell Okafor', date: '16 July 2026' },
  { title: 'Budgeting a shared credit pool', author: 'Priya Raman', date: '2 July 2026' }
];

export function UseCases() {
  return (
    <PublicLayout>
      <section class="shell section">
        <h1>AI video for whatever you make</h1>
        <p class="lead">
          Five ways teams use Kinora every day, each starting from a written brief and ending in finished frames.
        </p>
      </section>
      <section class="shell section-tight">
        <h2>Find your use case</h2>
        <div class="card-grid" style="margin-top:24px">
          {USE_CASES.map((item) => (
            <article class="card lift" key={item.heading}>
              <Art className="art-thumb" seed={`use case ${item.heading}`} title={`${item.heading} artwork`} decorative />
              <h3 style="margin-top:16px;font-size:1.1rem">{item.heading}</h3>
              <p style="margin:0">{item.line}</p>
            </article>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function Workflows() {
  const [open, setOpen] = useState(false);
  return (
    <PublicLayout>
      <section class="shell section">
        <h1>Introducing Kinora Workflows</h1>
        <p class="lead">
          Workflows chain the models and prompts your team repeats into one run. They are on the way; today the studio
          renders one generation at a time.
        </p>
      </section>

      <section class="shell section-tight">
        <h2>Why Workflows?</h2>
        <div class="card-grid" style="margin-top:22px">
          {WORKFLOW_REASONS.map((reason) => (
            <article class="card" key={reason.heading}>
              <h3 style="font-size:1.08rem">{reason.heading}</h3>
              <p style="margin:0">{reason.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>Featured Workflows</h2>
        <div class="card-grid" style="margin-top:22px">
          {FEATURED_WORKFLOWS.map((workflow) => (
            <article class="card lift" key={workflow}>
              <h3 style="font-size:1.05rem;margin:0">{workflow}</h3>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>Frequently asked questions</h2>
        <div class="disclosure" style="margin-top:10px">
          <button
            type="button"
            class="disclosure-button"
            aria-expanded={open ? 'true' : 'false'}
            aria-controls="workflow-credits"
            onClick={() => setOpen(!open)}
          >
            Do workflows take credits?
            <ChevronDown />
          </button>
          {open ? (
            <div class="disclosure-answer" id="workflow-credits">
              Yes. Media model nodes and LLM nodes use credits when they run.
            </div>
          ) : null}
        </div>
      </section>
    </PublicLayout>
  );
}

export function Research() {
  return (
    <PublicLayout>
      <section class="shell section">
        <h1>
          Building general-purpose multimodal
          <br />
          simulators of the world.
        </h1>
      </section>
      <section class="shell section-tight">
        <div class="stack">
          {PAPERS.map((paper) => (
            <article class="card" key={paper.title}>
              <p class="eyebrow" style="margin-bottom:6px">
                {paper.date}
              </p>
              <h2 style="font-size:1.3rem">{paper.title}</h2>
              <p class="muted" style="margin:0 0 10px">
                {paper.authors}
              </p>
              <p style="margin:0">{paper.abstract}</p>
            </article>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function Resources() {
  return (
    <PublicLayout>
      <section class="shell section">
        <h1>Resources</h1>
        <h2>Featured</h2>
        <div class="card-grid" style="margin-top:22px">
          {FEATURED_ARTICLES.map((article) => (
            <article class="card lift" key={article.title}>
              <Art className="art-thumb" seed={`article ${article.title}`} title={`${article.title} artwork`} decorative />
              <h3 style="margin-top:16px;font-size:1.1rem">{article.title}</h3>
              <p class="muted" style="margin:0 0 8px">
                {article.author} &middot; {article.date}
              </p>
              <p style="margin:0">{article.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section-tight">
        <h2>All Resources</h2>
        <div class="stack" style="margin-top:18px">
          {ALL_ARTICLES.map((article) => (
            <article class="panel-soft row-between" key={article.title}>
              <span style="color:var(--ink);font-weight:500">{article.title}</span>
              <span class="muted">
                {article.author} &middot; {article.date}
              </span>
            </article>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}

export function Privacy() {
  return (
    <PublicLayout>
      <section class="shell section" style="max-width:820px">
        <h1>Privacy</h1>
        <p class="lead">
          This page says exactly what Kinora stores, who can read it and the one cookie the app sets.
        </p>

        <h2>What an account stores</h2>
        <p>
          When you sign up we store your name, your email address and a hashed password, never the password itself.
          Your account belongs to one workspace, and the workspace holds its projects, its generations (the prompt,
          the model, the length or image count, the aspect and the cost) and its credit history.
        </p>

        <h2>What an enquiry stores</h2>
        <p>
          An enterprise or licensing enquiry stores the fields of the form you filled in: your name, business email,
          company, company size, industry, the products you said you were interested in and your message. We email a
          copy to our sales inbox and an acknowledgement to you.
        </p>

        <h2>What an invitation stores</h2>
        <p>
          An invitation stores the email address it was sent to, the workspace it belongs to and an unguessable link
          token, so the person you invited can join your team.
        </p>

        <h2>Who reads it</h2>
        <p>
          Only Kinora staff and the members of your own workspace read your workspace's projects, generations and
          credit history. We do not sell it, and we do not send it to any other service.
        </p>

        <h2>Cookies</h2>
        <p>
          The app sets at most one cookie, a session cookie that keeps you signed in. There is no tracking cookie, no
          analytics and no measurement of any kind, and the pages call no outside network service.
        </p>
      </section>
    </PublicLayout>
  );
}

export function NotFound() {
  return (
    <PublicLayout>
      <section class="shell section" style="text-align:center;padding:96px 24px">
        <h1>Page not found</h1>
        <p class="lead" style="margin:0 auto 24px">
          We could not find that page.
        </p>
        <a class="btn btn-dark btn-pill btn-big" href="/">
          Back to home
        </a>
      </section>
    </PublicLayout>
  );
}
