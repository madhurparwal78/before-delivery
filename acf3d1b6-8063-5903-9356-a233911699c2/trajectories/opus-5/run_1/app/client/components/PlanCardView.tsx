import { useState } from 'preact/hooks';
import { PlanCard } from '../../shared/catalog';
import { dollars } from '../format';
import { InfoCircle } from './Icons';

function CreditsTip({ plan }: { plan: PlanCard }) {
  const [open, setOpen] = useState(false);
  const id = `tip-${plan.id}`;
  return (
    <span class="tip-holder">
      <button
        type="button"
        class="tip-button"
        aria-label={`What ${plan.name} credits buy`}
        aria-expanded={open ? 'true' : 'false'}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <InfoCircle />
      </button>
      {open ? (
        <span class="tip-bubble" id={id} role="note">
          {plan.creditsTip}
        </span>
      ) : null}
    </span>
  );
}

export function PlanCardView({ plan, yearly }: { plan: PlanCard; yearly: boolean }) {
  const custom = plan.monthly_price === null;
  const paid = !custom && plan.monthly_price! > 0;
  const price = custom ? 'Custom' : dollars(yearly ? plan.yearly_price! : plan.monthly_price!);

  return (
    <article class="card plan-card">
      <div class="row-between">
        <h3 style="margin:0">{plan.name}</h3>
        {plan.tab ? <span class="pill-badge">{plan.tab}</span> : null}
      </div>

      <div class="plan-price" key={yearly ? 'yearly' : 'monthly'}>
        <span class={`amount price-fade`}>{price}</span>
        {yearly && paid ? <span class="was">{dollars(plan.monthly_price!)}</span> : null}
        {plan.priceSuffix ? <span class="muted">{plan.priceSuffix}</span> : null}
      </div>
      {yearly && plan.yearlyNote ? <p class="muted" style="margin:0">{plan.yearlyNote}</p> : null}

      <div class="plan-credits">
        <span class="mono">{plan.creditsLine}</span>
        <CreditsTip plan={plan} />
      </div>

      {plan.badge ? <span class="pill-badge warm">{plan.badge}</span> : null}
      <p style="margin:0">{plan.description}</p>

      <a class={`btn ${plan.id === 'free' ? 'btn-light' : 'btn-dark'}`} href={plan.ctaHref}>
        {plan.cta}
      </a>

      <ul class="feature-list">
        {plan.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </article>
  );
}
