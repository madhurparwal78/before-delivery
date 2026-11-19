import { useState } from "react";
import { Link } from "react-router-dom";
import Field from "../components/Field.jsx";
import { Cross, Tick } from "../components/Icons.jsx";
import { Tabs } from "../components/Tabs.jsx";

const PLANS = ["Starter", "Team", "Scale", "Private Cloud"];
const PACKAGES = [
  ["30 credits · $140/mo", "$140"], ["80 credits · $340/mo", "$340"], ["200 credits · $780/mo", "$780"],
  ["400 credits · $1,420/mo", "$1,420"], ["800 credits · $2,560/mo", "$2,560"], ["1,600 credits · $4,200/mo", "$4,200"],
];
const ROWS = [
  ["Fastest Sync Interval", ["1 hr", "15 min", "5 min", "5 min"]],
  ["Cron Schedules", ["Included", "Included", "Included", "Included"]],
  ["Builder", ["Included", "Included", "Included", "Included"]],
  ["Single Sign-On", ["Not included", "Not included", "Included", "Included"]],
  ["Audit Log", ["Included", "Included", "Included", "Included"]],
];
const FEATURES = {
  Starter: ["Syncs as often as every hour", "Cron schedules and the Builder", "Tamper-evident audit log"],
  Team: ["Syncs as often as every 15 minutes", "Credits you can forecast", "Roles for admins, editors and viewers"],
  Scale: ["Syncs as often as every 5 minutes", "Single sign-on", "Volume pricing on credits"],
  "Private Cloud": ["Runs in your own cloud account", "Single sign-on", "Data never leaves your network"],
};
const NOTES = {
  Starter: "For one team proving its first pipelines.",
  Team: "For data teams running the warehouse every day.",
  Scale: "For companies with many teams and stricter controls.",
  "Private Cloud": "Wayline in your own cloud account, run by you.",
};

function Features({ plan }) {
  return <ul className="checklist plan-features">{FEATURES[plan].map((item) => <li key={item}><Tick />{item}</li>)}</ul>;
}

function Cell({ value }) {
  if (value === "Included") return <td><span className="yes"><Tick />Included</span></td>;
  if (value === "Not included") return <td><span className="no"><Cross />Not included</span></td>;
  return <td>{value}</td>;
}

function CompareTable({ plans }) {
  return (
    <table className="compare-table" aria-labelledby="compare-heading">
      <colgroup><col className="col-row" />{plans.map((plan) => <col key={plan} />)}</colgroup>
      <thead>
        <tr>
          <td />
          {plans.map((plan) => <th key={plan} scope="col">{plan}</th>)}
        </tr>
      </thead>
      <tbody>
        {ROWS.map(([name, values]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            {plans.map((plan) => <Cell key={plan} value={values[PLANS.indexOf(plan)]} />)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Pricing() {
  const [credits, setCredits] = useState(0);
  return (
    <>
      <section className="page-hero dots">
        <div className="container section-head center">
          <span className="label eyebrow">Pricing</span>
          <h1 className="display">Plans that grow with your pipelines</h1>
          <p className="lede">Try it free for 21 days with 250 credits, roughly 60 GB of syncs. No card needed.</p>
        </div>
      </section>
      <section className="container">
        <div className="plans">
          <article className="card plan">
            <h2>Starter</h2>
            <p>{NOTES.Starter}</p>
            <div className="price"><span>From</span><strong>$15</strong><span>/month</span></div>
            <Features plan="Starter" />
            <Link to="/login" className="btn btn-outline">Try it free</Link>
          </article>
          <article className="card plan featured">
            <span className="chip label">Best value past 25 GB</span>
            <h2>Team</h2>
            <p>{NOTES.Team}</p>
            <div className="price"><strong>{PACKAGES[credits][1]}</strong><span>/month</span></div>
            <Field label="Credit package">
              {(control) => (
                <select {...control} className="select" value={credits} onChange={(e) => setCredits(Number(e.target.value))}>
                  {PACKAGES.map(([label], index) => <option key={label} value={index}>{label}</option>)}
                </select>
              )}
            </Field>
            <Features plan="Team" />
            <Link to="/login" className="btn btn-primary">Try it free</Link>
          </article>
          {["Scale", "Private Cloud"].map((plan) => (
            <article className="card plan" key={plan}>
              <h2>{plan}</h2>
              <p>{NOTES[plan]}</p>
              <div className="price"><strong>Custom</strong></div>
              <Features plan={plan} />
              <Link to="/signin" className="btn btn-outline">Talk to sales</Link>
            </article>
          ))}
        </div>
        <div className="compare" data-reveal>
          <h2 id="compare-heading" className="h2">Compare the plans</h2>
          <div className="compare-wide"><CompareTable plans={PLANS} /></div>
          <Tabs label="Plan" names={PLANS} className="compare-narrow"
            render={(index) => <CompareTable plans={[PLANS[index]]} />} />
        </div>
      </section>
    </>
  );
}
