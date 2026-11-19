import { useState } from "react";
import { MarketingLayout } from "./Chrome";
import { Tabs } from "../components/ui";
import { Icon } from "../components/Icon";
import { useViewportWidth } from "../lib/hooks";

const PLANS = ["Starter", "Team", "Scale", "Private Cloud"] as const;
type Plan = (typeof PLANS)[number];

const CREDIT_PACKAGES = [
  { label: "30 credits · $140/mo", price: "$140" },
  { label: "80 credits · $340/mo", price: "$340" },
  { label: "200 credits · $780/mo", price: "$780" },
  { label: "400 credits · $1,420/mo", price: "$1,420" },
  { label: "800 credits · $2,560/mo", price: "$2,560" },
  { label: "1,600 credits · $4,200/mo", price: "$4,200" },
];

const COMPARISON: { row: string; cells: Record<Plan, string> }[] = [
  {
    row: "Fastest Sync Interval",
    cells: { Starter: "1 hr", Team: "15 min", Scale: "5 min", "Private Cloud": "5 min" },
  },
  {
    row: "Cron Schedules",
    cells: { Starter: "Included", Team: "Included", Scale: "Included", "Private Cloud": "Included" },
  },
  {
    row: "Builder",
    cells: { Starter: "Included", Team: "Included", Scale: "Included", "Private Cloud": "Included" },
  },
  {
    row: "Single Sign-On",
    cells: {
      Starter: "Not included",
      Team: "Not included",
      Scale: "Included",
      "Private Cloud": "Included",
    },
  },
  {
    row: "Audit Log",
    cells: { Starter: "Included", Team: "Included", Scale: "Included", "Private Cloud": "Included" },
  },
];

function Cell({ value }: { value: string }): JSX.Element {
  if (value === "Included") {
    return (
      <>
        <span className="glyph-tick" aria-hidden="true">
          <Icon name="tick" />
        </span>
        Included
      </>
    );
  }
  if (value === "Not included") {
    return (
      <>
        <span className="glyph-cross" aria-hidden="true">
          <Icon name="cross" />
        </span>
        Not included
      </>
    );
  }
  return <>{value}</>;
}

function ComparisonTable({ plans }: { plans: Plan[] }): JSX.Element {
  return (
    <table className="compare-table" aria-label="Compare the plans">
      <thead>
        <tr>
          <td />
          {plans.map((plan) => (
            <th scope="col" key={plan}>
              {plan}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {COMPARISON.map((entry) => (
          <tr key={entry.row}>
            <th scope="row">{entry.row}</th>
            {plans.map((plan) => (
              <td key={plan}>
                <Cell value={entry.cells[plan]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Pricing(): JSX.Element {
  const [credits, setCredits] = useState(0);
  const [plan, setPlan] = useState<Plan>("Starter");
  const width = useViewportWidth();
  const narrow = width < 768;

  return (
    <MarketingLayout>
      <section className="band dotted">
        <h1>Plans that grow with your pipelines</h1>
        <p className="lede">
          Try it free for 21 days with 250 credits, roughly 60 GB of syncs. No card needed.
        </p>
      </section>
      <div className="band">
        <div className="plan-grid">
          <article className="plan-card">
            <h2>Starter</h2>
            <p className="eyebrow">From</p>
            <p className="plan-price">$15</p>
            <p>/month</p>
            <p>For one team moving a few systems into the warehouse.</p>
          </article>
          <article className="plan-card recommended">
            <h2>Team</h2>
            <p className="eyebrow">Best value past 25 GB</p>
            <p className="plan-price">{CREDIT_PACKAGES[credits].price}</p>
            <p>/month</p>
            <div className="field">
              <label htmlFor="credit-package">Credit package</label>
              <select
                id="credit-package"
                value={credits}
                onChange={(event) => setCredits(Number(event.target.value))}
              >
                {CREDIT_PACKAGES.map((option, index) => (
                  <option value={index} key={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </article>
          <article className="plan-card">
            <h2>Scale</h2>
            <p className="plan-price">Custom</p>
            <p>Cron schedules every five minutes, single sign-on and priority support.</p>
          </article>
          <article className="plan-card">
            <h2>Private Cloud</h2>
            <p className="plan-price">Custom</p>
            <p>Run the data plane in your own cloud. Wayline keeps the control plane.</p>
          </article>
        </div>
      </div>
      <div className="band">
        <h2>Compare the plans</h2>
        {narrow ? (
          <>
            <Tabs
              name="Plan"
              tabs={PLANS.map((entry) => ({ id: entry, label: entry }))}
              selected={plan}
              onSelect={(id) => setPlan(id as Plan)}
            />
            <div role="tabpanel" id={`panel-${plan}`} aria-labelledby={`tab-${plan}`} tabIndex={-1}>
              <ComparisonTable plans={[plan]} />
            </div>
          </>
        ) : (
          <ComparisonTable plans={[...PLANS]} />
        )}
      </div>
    </MarketingLayout>
  );
}
