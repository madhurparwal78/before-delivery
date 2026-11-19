import { useState } from "react";
import { MarketingLayout } from "./marketing.jsx";
import { Tabs } from "./components.jsx";

const PACKAGES = [
  ["30 credits · $140/mo", "$140"],
  ["80 credits · $340/mo", "$340"],
  ["200 credits · $780/mo", "$780"],
  ["400 credits · $1,420/mo", "$1,420"],
  ["800 credits · $2,560/mo", "$2,560"],
  ["1,600 credits · $4,200/mo", "$4,200"],
];

const PLANS = ["Starter", "Team", "Scale", "Private Cloud"];

const ROWS = [
  ["Fastest Sync Interval", "1 hr", "15 min", "5 min", "5 min"],
  ["Cron Schedules", true, true, true, true],
  ["Builder", true, true, true, true],
  ["Single Sign-On", false, false, true, true],
  ["Audit Log", true, true, true, true],
];

function Tick({ hidden }) {
  return (
    <span className="glyph glyph-ok" aria-hidden="true" hidden={hidden}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12l5 5L20 6" />
      </svg>
    </span>
  );
}

function Cross() {
  return (
    <span className="glyph glyph-no" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </span>
  );
}

function Cell({ value }) {
  if (value === true) {
    return <span><Tick />Included</span>;
  }
  if (value === false) {
    return <span><Cross />Not included</span>;
  }
  return <span>{value}</span>;
}

function CompareTable({ plans }) {
  return (
    <table className="compare-table">
      <caption className="visually-hidden">Compare the plans</caption>
      <thead>
        <tr>
          <th scope="col">&nbsp;</th>
          {plans.map((plan) => (
            <th key={plan} scope="col">{plan}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map(([label, ...values]) => {
          const cells = PLANS.reduce((acc, plan) => {
            acc.push(values[PLANS.indexOf(plan)]);
            return acc;
          }, []);
          const shown = PLANS.filter((plan) => plans.includes(plan));
          return (
            <tr key={label}>
              <th scope="row">{label}</th>
              {PLANS.map((plan, index) => {
                if (!plans.includes(plan)) return null;
                return <td key={plan}><Cell value={cells[index]} /></td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function PricingPage() {
  const [creditPackage, setCreditPackage] = useState(0);
  const [plan, setPlan] = useState("Starter");
  return (
    <MarketingLayout>
      <section className="section wrap">
        <span className="eyebrow">Pricing</span>
        <h1>Plans that grow with your pipelines</h1>
        <p style={{ maxWidth: "64ch" }}>Try it free for 21 days with 250 credits, roughly 60 GB of
        syncs. No card needed.</p>
        <div className="grid-4" style={{ marginTop: "2rem" }}>
          <article className="card plan-card">
            <h3>Starter</h3>
            <span className="label-mono" style={{ color: "var(--muted)" }}>From</span>
            <div className="plan-price">$15</div>
            <span className="label-mono" style={{ color: "var(--muted)" }}>/month</span>
            <p style={{ fontSize: "0.9rem" }}>For a first pipeline and a small team.</p>
          </article>
          <article className="card plan-card recommended">
            <span className="plan-flag">Best value past 25 GB</span>
            <h3>Team</h3>
            <div className="plan-price">{PACKAGES[creditPackage][1]}</div>
            <span className="label-mono" style={{ color: "var(--muted)" }}>/month</span>
            <div className="field">
              <label htmlFor="credit-package">Credit package</label>
              <select id="credit-package" className="select" value={creditPackage}
                onChange={(e) => setCreditPackage(Number(e.target.value))}>
                {PACKAGES.map(([label], index) => (
                  <option key={label} value={index}>{label}</option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: "0.9rem", margin: 0 }}>
              Recommended for teams past their first few pipelines.
            </p>
          </article>
          <article className="card plan-card">
            <h3>Scale</h3>
            <div className="plan-price">Custom</div>
            <p style={{ fontSize: "0.9rem" }}>For platforms running hundreds of pipelines.</p>
          </article>
          <article className="card plan-card">
            <h3>Private Cloud</h3>
            <div className="plan-price">Custom</div>
            <p style={{ fontSize: "0.9rem" }}>Run the whole data plane yourself.</p>
          </article>
        </div>
      </section>
      <section className="section wrap">
        <h2>Compare the plans</h2>
        <div style={{ marginTop: "1rem" }} className="compare-wrap">
          <div className="plan-tabs-narrow">
            <Tabs name="Plan" idBase="plan-compare"
              active={plan}
              onChange={setPlan}
              tabs={PLANS.map((name) => ({ id: name, label: name }))} />
          </div>
          <style>{`@media (min-width: 768px) { .plan-tabs-narrow { display: none; } }`}</style>
          <div className="plan-table-wide">
            <table className="compare-table">
              <caption className="visually-hidden">Compare the plans</caption>
              <thead>
                <tr>
                  <th scope="col">&nbsp;</th>
                  {PLANS.map((name) => <th key={name} scope="col">{name}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, ...values]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {values.map((value, index) => (
                      <td key={PLANS[index]}><Cell value={value} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <style>{`@media (max-width: 767px) { .plan-table-wide { display: none; } }`}</style>
          <div className="plan-table-narrow">
            <table className="compare-table">
              <caption className="visually-hidden">Compare the plans</caption>
              <thead>
                <tr>
                  <th scope="col">&nbsp;</th>
                  <th scope="col">{plan}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, ...values]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td><Cell value={values[PLANS.indexOf(plan)]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <style>{`@media (min-width: 768px) { .plan-table-narrow { display: none; } }`}</style>
        </div>
      </section>
    </MarketingLayout>
  );
}
