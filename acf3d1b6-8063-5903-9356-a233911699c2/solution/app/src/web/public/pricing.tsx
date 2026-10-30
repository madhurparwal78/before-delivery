import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { planOf, type WorkspacePlanId } from '../../shared/catalog.js';
import { Check } from '../ui/icons.js';
import { InfoTip } from '../ui/info-tip.js';
import { EASE_IN_OUT, play } from '../ui/motion.js';
import { TabPanel, Tabs } from '../ui/tabs.js';

const dollars = (cents: number) => `$${cents / 100}`;

interface PlanCopy {
  id: WorkspacePlanId | 'enterprise';
  description: string;
  credits: string;
  tip?: string;
  button: string;
  href: string;
  features: string[];
  flag?: string;
  badge?: string;
}

/** The limit lines come from the plan itself, so each limit is decided once. */
const projects = (id: WorkspacePlanId) => {
  const n = planOf(id).project_limit;
  return `Up to ${n} ${n === 1 ? 'project' : 'projects'}`;
};
const atATime = (id: WorkspacePlanId) => `${planOf(id).parallel_limit} generations at a time`;

const INDIVIDUAL: PlanCopy[] = [
  {
    id: 'free',
    description: "For people looking to explore Kinora's AI Tools",
    credits: '125 credits (one time)',
    tip: "125 one-time credits to explore Kinora's AI tools.",
    button: 'Start Free',
    href: '/signup',
    features: ['A selection of generative creative models to test concepts', projects('free'), atATime('free')],
  },
  {
    id: 'standard',
    description: 'For curious creators trying AI video',
    credits: '625 credits /mo',
    tip: '625 credits monthly = 52s of Vela 4.5, 104s of Vela 4 Turbo, or 78 Vela Image 4 images.',
    button: 'Get Standard',
    href: '/enterprise-contact',
    features: ['Access to all Vela models', atATime('standard'), projects('standard'), 'No watermarks'],
  },
  {
    id: 'pro',
    description: 'For creators leveling up their craft',
    credits: '2,250 credits /mo',
    tip: '2,250 credits monthly = 187s of Vela 4.5, 375s of Vela 4 Turbo, or 281 Vela Image 4 images.',
    button: 'Get Pro',
    href: '/enterprise-contact',
    features: ['Everything in Standard', atATime('pro'), projects('pro')],
    flag: 'Popular',
  },
  {
    id: 'max',
    description: 'Best value for heavy solo usage',
    credits: '9,500 credits /mo',
    tip: '9,500 credits monthly = 791s of Vela 4.5, 1,583s of Vela 4 Turbo, or 1,187 Vela Image 4 images.',
    button: 'Get Max',
    href: '/enterprise-contact',
    features: ['Early access to new models', atATime('max'), projects('max')],
    flag: 'Best value',
    badge: 'Credits roll over 1 mo.',
  },
];

const TEAM_AND_ENTERPRISE: PlanCopy[] = [
  {
    id: 'team',
    description: 'Best for fast-moving teams with high production needs',
    credits: '6,900 credits per seat per month, pooled across the workspace',
    button: 'Get Team',
    href: '/enterprise-contact',
    features: [
      'Everything in Max',
      `Up to ${planOf('team').project_limit} shared projects`,
      'One shared credit pool',
      `${planOf('team').parallel_limit} parallel generations`,
      'Two to nine seats',
    ],
  },
  {
    id: 'enterprise',
    description: 'Built for organizations: security, privacy, admin controls and SSO',
    credits: 'Pricing and credits sized to your organization',
    button: 'Talk to Sales',
    href: '/enterprise-contact',
    features: ['Everything in Team', 'Unlimited members and workspaces', 'Custom SSO, SOC 2 and ISO/IEC 27001, no training on your data'],
  },
];

function Price({ copy, yearly }: { copy: PlanCopy; yearly: boolean }) {
  const block = useRef<HTMLDivElement>(null);
  const shown = useRef(yearly);
  useLayoutEffect(() => {
    if (shown.current === yearly) return;
    shown.current = yearly;
    play(block.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_IN_OUT });
  }, [yearly]);
  if (copy.id === 'enterprise') {
    return (
      <div class="price">
        <span class="price-amount">Custom</span>
      </div>
    );
  }
  const plan = planOf(copy.id);
  const team = copy.id === 'team';
  const unit = team ? 'per seat per month' : '/month';
  const paid = plan.monthly_price > 0;
  const saving = ((plan.monthly_price - plan.yearly_price) * 12) / 100;
  const note = !paid ? 'Free forever.' : !yearly ? 'Billed monthly.' : team ? 'billed yearly, 20% off' : `Billed annually. Save $${saving}/year.`;
  return (
    <div class="price" ref={block}>
      <p class="price-line">
        {yearly && paid && <s class="price-was">{dollars(plan.monthly_price)}</s>}
        <span class="price-amount">{dollars(yearly ? plan.yearly_price : plan.monthly_price)}</span>
        <span class="price-unit">{unit}</span>
      </p>
      <p class="price-note">{note}</p>
    </div>
  );
}

function PlanCard({ copy, yearly }: { copy: PlanCopy; yearly: boolean }) {
  const name = copy.id === 'enterprise' ? 'Enterprise' : planOf(copy.id).name;
  return (
    <article class={`card plan-card${copy.flag === 'Popular' ? ' is-popular' : ''}`}>
      {copy.flag && <p class={`plan-flag plan-flag-${copy.id}`}>{copy.flag}</p>}
      <div class="plan-head">
        <h3>{name}</h3>
        {copy.badge && <span class="badge badge-orange">{copy.badge}</span>}
      </div>
      <p class="plan-description">{copy.description}</p>
      <Price copy={copy} yearly={yearly} />
      <p class="plan-credits">
        <span>{copy.credits}</span>
        {copy.tip && <InfoTip id={`plan-${copy.id}`} label={`What ${name} credits buy`} text={copy.tip} />}
      </p>
      <a class={`button ${copy.id === 'free' ? 'button-light' : 'button-dark'} button-block`} href={copy.href}>
        {copy.button}
      </a>
      <ul class="plan-features">
        {copy.features.map((feature) => (
          <li key={feature}>
            <Check size={16} />
            {feature}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function TeamAndEnterpriseCards({ yearly }: { yearly: boolean }) {
  return (
    <div class="plans plans-2">
      {TEAM_AND_ENTERPRISE.map((copy) => (
        <PlanCard key={copy.id} copy={copy} yearly={yearly} />
      ))}
    </div>
  );
}

const FAMILIES = ['Individual', 'Team & Enterprise', 'API'];

export function PricingPage() {
  const [family, setFamily] = useState(0);
  const [yearly, setYearly] = useState(true);
  return (
    <section class="page-hero container pricing">
      <h1 class="display">Choose the Right Plan for You</h1>
      <p class="caption">Trusted by 60M+ creators and leading enterprises</p>
      <div class="pricing-controls">
        <Tabs id="family" label="Plan family" tabs={FAMILIES} selected={family} onSelect={setFamily} class="segmented" />
        <div class="billing">
          <span aria-hidden="true">Monthly</span>
          <button
            type="button"
            role="switch"
            class="switch"
            aria-checked={yearly ? 'true' : 'false'}
            aria-label="Yearly billing"
            onClick={() => setYearly(!yearly)}
          >
            <span class="switch-thumb" />
          </button>
          <span aria-hidden="true">Yearly</span>
          <span class="badge badge-indigo">2 months free</span>
        </div>
      </div>
      <TabPanel id="family" selected={family} class="plans-panel">
        {family === 0 && (
          <div class="plans plans-4">
            {INDIVIDUAL.map((copy) => (
              <PlanCard key={copy.id} copy={copy} yearly={yearly} />
            ))}
          </div>
        )}
        {family === 1 && <TeamAndEnterpriseCards yearly={yearly} />}
        {family === 2 && (
          <div class="plans plans-1">
            <article class="card plan-card api-card">
              <h3>API</h3>
              <p class="plan-description">API access is arranged with our sales team.</p>
              <a class="button button-dark" href="/enterprise-contact">Contact sales</a>
            </article>
          </div>
        )}
      </TabPanel>
    </section>
  );
}
