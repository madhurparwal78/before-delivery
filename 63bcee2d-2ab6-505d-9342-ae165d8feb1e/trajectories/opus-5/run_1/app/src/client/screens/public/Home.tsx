import { useId } from 'react';
import { PublicShell } from '../../components/PublicShell.jsx';
import { FeaturedRail, type RailCard } from '../../components/FeaturedRail.jsx';
import { LineReveal } from '../../components/LineReveal.jsx';
import { PrimaryLink } from '../../components/Buttons.jsx';
import { useResource } from '../../lib/workspace.jsx';

const HEADING_LINES = ['Rollouts built store by store,', 'signed off stage by stage.'];

export function Home(): JSX.Element {
  const railName = useId();
  const { data } = useResource<{ caseStudies: RailCard[] }>('/api/public/featured');

  return (
    <PublicShell title="Marrow Hall Interiors">
      <section className="section" data-tone="light">
        <div className="section-inner">
          <h1 className="hero-heading">
            <LineReveal lines={HEADING_LINES} />
          </h1>
          <p>
            Marrow Hall Interiors fits out multi-store retail, workplace and food-and-beverage
            rollouts across Hong Kong, Singapore and Macao. Six to forty stores for one brand at a
            time, with the stage gates, the drawing register and the money in one place.
          </p>
          <p>
            <PrimaryLink to="/work" label="See the work" />
          </p>
        </div>
      </section>

      <section className="section" data-tone="light" aria-labelledby={railName}>
        <div className="section-inner">
          <h2 id={railName}>Featured work</h2>
          <FeaturedRail cards={data?.caseStudies ?? []} />
        </div>
      </section>

      <section className="section" data-tone="dark">
        <div className="section-inner">
          <h2>How we deliver</h2>
          <p>
            Every rollout runs through seven stage gates, from Groundwork to Aftercare. The brand
            signs each fee-bearing stage off itself, and the fee is invoiced the moment they do.
          </p>
          <p>
            Tenders are sealed. Bids stay closed until the close instant has passed, then every
            exclusion is priced and the levelling table is published to the project record, so the
            award can be read back years later.
          </p>
          <p>
            Variations are raised on site, reviewed against a named approval limit and kept with
            their history. Retention is held at ten per cent of each valuation, capped at five per
            cent of the contract sum, and released in two halves against the defects period.
          </p>
        </div>
      </section>

      <section className="section" data-tone="light">
        <div className="section-inner">
          <h2>Start a project</h2>
          <p>
            Tell us the sector, the region and how many stores. We will come back with a stage plan
            and a fee proposal.
          </p>
          <p>
            <PrimaryLink to="/start" label="Start a project" />
          </p>
        </div>
      </section>
    </PublicShell>
  );
}
