import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { PlanCardView } from '../components/PlanCardView';
import { Switch, TabPanel, TabRow } from '../components/ui';
import { PLAN_CARDS } from '../../shared/catalog';

const FAMILIES = [
  { id: 'individual', label: 'Individual' },
  { id: 'team', label: 'Team & Enterprise' },
  { id: 'api', label: 'API' }
];

export function Pricing() {
  const [family, setFamily] = useState('individual');
  const [yearly, setYearly] = useState(true);

  const individual = PLAN_CARDS.filter((plan) => plan.family === 'individual');
  const team = PLAN_CARDS.filter((plan) => plan.family === 'team');

  return (
    <PublicLayout>
      <section class="shell section">
        <h1>Choose the Right Plan for You</h1>
        <p class="lead">Trusted by 60M+ creators and leading enterprises</p>

        <div class="row-between" style="margin:28px 0 24px">
          <TabRow
            label="Plan family"
            idPrefix="pricing-family"
            tabs={FAMILIES}
            value={family}
            onChange={setFamily}
            segmented
          />
          <div class="switch-row">
            <span class={yearly ? 'muted' : ''}>Monthly</span>
            <Switch label="Yearly billing" checked={yearly} onChange={setYearly} />
            <span class={yearly ? '' : 'muted'}>Yearly</span>
            <span class="pill-badge">2 months free</span>
          </div>
        </div>

        <TabPanel idPrefix="pricing-family" id={family}>
          {family === 'individual' ? (
            <div class="card-grid">
              {individual.map((plan) => (
                <PlanCardView key={plan.id} plan={plan} yearly={yearly} />
              ))}
            </div>
          ) : null}
          {family === 'team' ? (
            <div class="card-grid card-grid-2">
              {team.map((plan) => (
                <PlanCardView key={plan.id} plan={plan} yearly={yearly} />
              ))}
            </div>
          ) : null}
          {family === 'api' ? (
            <div class="card-grid card-grid-2">
              <article class="card plan-card">
                <h3 style="margin:0">API</h3>
                <p style="margin:0">API access is arranged with our sales team.</p>
                <a class="btn btn-dark" href="/enterprise-contact">
                  Contact sales
                </a>
              </article>
            </div>
          ) : null}
        </TabPanel>
      </section>
    </PublicLayout>
  );
}
