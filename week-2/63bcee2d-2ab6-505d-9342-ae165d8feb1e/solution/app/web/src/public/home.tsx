import { useEffect, useState } from "react";
import { get } from "../api";
import { PageHeading } from "./heading";
import { Rail, type FeaturedCard } from "./rail";
import { RollLink } from "./shell";

// Home: the plaster opening with the line-revealed heading and the featured rail, the dark "How we
// deliver" section, and the call to action.

const STEPS = [
  { code: "01", name: "Stage gates", text: "Each rollout runs Groundwork to Handover. The brand signs every stage off in Plumbline, and its fee is invoiced the same day." },
  { code: "02", name: "One drawing register", text: "Sheets carry their revision letters and transmittals list every file with its checksum, so site teams build from the current set." },
  { code: "03", name: "Sealed tenders", text: "Contractors bid once and amend before close. Bids open together and are levelled in exact cents, exclusions priced." },
  { code: "04", name: "Retention per store", text: "Certificates split across stores to the cent, and every hold and release is posted as a balanced pair." },
];

export function HomePage() {
  const [featured, setFeatured] = useState<FeaturedCard[]>([]);

  useEffect(() => {
    void get<{ caseStudies: FeaturedCard[] }>("/api/public/featured").then((result) => {
      if (result.ok) setFeatured(result.data.caseStudies);
    });
  }, []);

  return (
    <>
      <section className="section section-plaster hero" data-tone="light">
        <div className="grid">
          <p className="sheet-caption">
            <span>Marrow Hall Interiors</span><span>Commercial interiors</span><span>Hong Kong · Singapore · Macao</span>
          </p>
          <PageHeading reveal title="Marrow Hall Interiors" className="hero-heading"
            lines={["Rollouts built store by store,", "signed off stage by stage."]} />
          <p className="hero-lede">
            We fit out retail, workplace and food-and-beverage rollouts of six to forty stores for one brand at a time, with every stage,
            drawing, tender and certificate in one place the brand and its contractors share.
          </p>
          <dl className="hero-key">
            <div><dt>Stores per rollout</dt><dd>6–40</dd></div>
            <div><dt>Fee-bearing stage gates</dt><dd>6</dd></div>
            <div><dt>Regions</dt><dd>HK · SG · MO</dd></div>
          </dl>
          <div className="hero-actions">
            <RollLink href="/work" label="See the work" />
          </div>
        </div>
        <div className="grid">{featured.length > 0 && <Rail cards={featured} />}</div>
      </section>
      <section className="section section-dark" data-tone="dark">
        <div className="grid">
          <p className="sheet-caption"><span>Method</span><span>Four drawings to a rollout</span></p>
          <h2 className="section-heading">How we deliver</h2>
          <ol className="steps">
            {STEPS.map((step) => (
              <li key={step.code}>
                <span className="step-code" aria-hidden="true">{step.code}</span>
                <h3>{step.name}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="section section-plaster cta" data-tone="light">
        <div className="grid">
          <h2 className="section-heading">Planning a rollout for next year?</h2>
          <p className="cta-text">Tell us about the brand, the stores and the opening month. A director replies within two working days.</p>
          <RollLink href="/start?step=1" label="Start a project" />
        </div>
      </section>
    </>
  );
}
