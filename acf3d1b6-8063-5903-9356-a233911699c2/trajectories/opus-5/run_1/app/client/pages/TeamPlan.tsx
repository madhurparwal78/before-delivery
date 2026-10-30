import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { PlanCardView } from '../components/PlanCardView';
import { Art } from '../components/ui';
import { ChevronDown } from '../components/Icons';
import { PLAN_CARDS } from '../../shared/catalog';

const BLOCKS = [
  {
    heading: "One place for your team's work",
    body: 'Projects, generations and credit history sit in one workspace, so a campaign is never spread across personal accounts.'
  },
  {
    heading: 'Manage the whole team from one balance',
    body: 'Every seat adds 6,900 credits a month to a single shared pool, and they land the moment you add the seat.'
  },
  {
    heading: 'Bring Kinora to the tools you already use',
    body: 'Hand finished generations to the places your team already reviews work, with the prompt and cost attached.'
  }
];

const AUDIENCES = [
  { heading: 'Marketing teams', body: 'Ship seasonal campaigns and social cutdowns without booking a crew.' },
  { heading: 'Studios and agencies', body: 'Pitch with moving boards and keep every client brief in its own project.' },
  { heading: 'In-house creative', body: 'Keep product shots on brand while the balance stays visible to everyone.' }
];

const FAQ = [
  {
    question: 'What is the Team plan?',
    answer: 'Team is a plan for groups of two to nine people who create together in one Kinora workspace.'
  },
  {
    question: 'How does the shared credit pool work?',
    answer:
      'Every seat adds 6,900 credits a month to one pool. Any member can spend from it, every generation is charged to it, and a cancelled generation returns its credits to it.'
  },
  {
    question: 'Can I change the number of seats?',
    answer:
      'Seats are arranged with our sales team. A Team workspace holds between two and nine people, and each new seat adds its credits the moment the person joins.'
  },
  {
    question: 'When should we consider Enterprise instead?',
    answer:
      'When you need more than nine people, several workspaces, single sign on or a security review, Enterprise is the right fit.'
  }
];

function Disclosure({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = `faq-${question.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div class="disclosure">
      <button
        type="button"
        class="disclosure-button"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {question}
        <ChevronDown />
      </button>
      {open ? (
        <div class="disclosure-answer" id={id}>
          {answer}
        </div>
      ) : null}
    </div>
  );
}

export function TeamPlan() {
  const team = PLAN_CARDS.filter((plan) => plan.family === 'team');

  return (
    <PublicLayout>
      <section class="shell section-tight">
        <div class="hero-frame">
          <div class="hero-art">
            <Art seed="kinora team shared balance campaign" title="Team plan artwork" decorative />
          </div>
          <div class="hero-body">
            <h1>Kinora Team</h1>
            <p class="lead">
              Grow your business faster with more on-brand campaigns, product shots and social, made in a fraction of
              the time.
            </p>
            <a class="btn btn-light btn-pill btn-big" href="/enterprise-contact">
              Get Team
            </a>
          </div>
        </div>
      </section>

      <section class="shell section">
        <div class="card-grid">
          {BLOCKS.map((block) => (
            <article class="card" key={block.heading}>
              <h2 style="font-size:1.3rem">{block.heading}</h2>
              <p style="margin:0">{block.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>For every team with creative needs</h2>
        <div class="card-grid" style="margin-top:24px">
          {AUDIENCES.map((audience) => (
            <article class="card lift" key={audience.heading}>
              <Art
                className="art-thumb"
                seed={`team audience ${audience.heading}`}
                title={`${audience.heading} artwork`}
                decorative
              />
              <h3 style="margin-top:16px;font-size:1.1rem">{audience.heading}</h3>
              <p style="margin:0">{audience.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>Plans for teams</h2>
        <div class="card-grid card-grid-2" style="margin-top:24px">
          {team.map((plan) => (
            <PlanCardView key={plan.id} plan={plan} yearly />
          ))}
        </div>
      </section>

      <section class="shell section">
        <h2>Frequently asked questions</h2>
        <div style="margin-top:12px">
          {FAQ.map((item) => (
            <Disclosure key={item.question} question={item.question} answer={item.answer} />
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
