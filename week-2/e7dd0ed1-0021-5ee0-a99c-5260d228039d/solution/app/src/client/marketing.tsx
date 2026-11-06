// Marketing page `/` (brief: Screens and layout, Marketing page; Seed data, Regions and Plans).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { PLANS } from "../shared/plans";
import { formatCount } from "../shared/format";
import { type Region, loadRegions } from "./api";
import { FINE_DOTS, LandDots, WORLD, project, viewBox } from "./worldmap";

const FEATURES = [
  {
    title: "One endpoint",
    text: "Point a current AWS SDK at one address with its default settings. Checksummed and chunked uploads simply work.",
  },
  {
    title: "Replica state for every object",
    text: "Each bucket names the regions that hold it. Every object shows which of them hold its current version and how long each copy took to arrive.",
  },
  {
    title: "Versions that expire on your rules",
    text: "Old versions leave after the days you choose. A version under retention or legal hold stays exactly where it is.",
  },
  {
    title: "The bill before the invoice",
    text: "Month-to-date storage, egress and request units sit beside your plan, with an honest line on what billing has confirmed.",
  },
];

// Rates wrap only between words, so "GB-hour" never splits at its hyphen.
function Rate({ text }: { text: string }): JSX.Element {
  return <>{text.split(/(\S*-\S*)/).map((part, i) => (i % 2 ? <span key={i} class="nobreak">{part}</span> : part))}</>;
}

const PRICING_COLUMNS = [
  "Monthly price",
  "Included storage",
  "Included egress",
  "Storage overage",
  "Egress overage",
  "Request units",
] as const;

function WorldStrip(): JSX.Element {
  const [regions, setRegions] = useState<Region[]>([]);
  useEffect(() => {
    void loadRegions().then(setRegions);
  }, []);
  const width = WORLD.east - WORLD.west;
  const height = WORLD.north - WORLD.south;
  return (
    <div class="strip" role="img" aria-label="Farshore regions">
      <svg class="strip__map" viewBox={viewBox(WORLD)} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <LandDots frame={WORLD} grid={FINE_DOTS} />
        {regions.map((region) => {
          const { x, y } = project(WORLD, region.lon, region.lat);
          return <circle key={region.id} class="strip__pin" cx={x} cy={y} r="1.5" />;
        })}
      </svg>
      {regions.map((region) => {
        const { x, y } = project(WORLD, region.lon, region.lat);
        const flip = x / width > 0.7;
        return (
          <span
            key={region.id}
            class={flip ? "strip__label strip__label--left" : "strip__label"}
            style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }}
          >
            <span class="strip__name">{region.name}</span>
            <span class="strip__continent">{region.continent}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Marketing(): JSX.Element {
  return (
    <div class="marketing">
      <header class="topbar">
        <span class="wordmark">
          <span class="wordmark__dot" aria-hidden="true" />
          Farshore
        </span>
        <nav class="topbar__links" aria-label="Site">
          <a class="topbar__link" href="#pricing">
            Pricing
          </a>
          <a class="topbar__link" href="/signin">
            Sign in
          </a>
        </nav>
      </header>
      <main>
        <section class="hero grid12">
          <h1 class="hero__title">Every region you pick holds the bytes you shipped.</h1>
          <p class="hero__lead">
            Farshore Buckets lets each bucket choose the regions that keep its objects, and shows which of them hold every
            object's current version right now. Old versions expire on your rules, your bots hear about every change, and
            the bill shows up before the invoice does.
          </p>
          <a class="button button--primary hero__cta" href="/signin">
            Open the console
          </a>
        </section>
        <WorldStrip />
        <section class="features grid12" aria-labelledby="features-title">
          <h2 id="features-title" class="section-title">
            Built for small studios with players everywhere
          </h2>
          <ul class="features__list">
            {FEATURES.map((feature) => (
              <li key={feature.title} class="features__row">
                <h3 class="features__name">{feature.title}</h3>
                <p class="features__text">{feature.text}</p>
              </li>
            ))}
          </ul>
        </section>
        <section id="pricing" class="pricing grid12" aria-labelledby="pricing-title">
          <h2 id="pricing-title" class="section-title">
            Pricing
          </h2>
          <div class="pricing__frame">
            <table class="pricing__table" aria-labelledby="pricing-title">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  {PRICING_COLUMNS.map((column, i) => (
                    <th key={column} scope="col" class={i < 3 ? "pricing__figure" : undefined}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLANS.map((plan) => {
                  const values = [
                    plan.monthlyPrice,
                    `${formatCount(plan.includedStorageBytes)} bytes`,
                    `${formatCount(plan.includedEgressBytes)} bytes`,
                    plan.storageOverage,
                    plan.egressOverage,
                    plan.requestUnits,
                  ];
                  return (
                    <tr key={plan.id}>
                      <th scope="row" class="pricing__plan">
                        {plan.name}
                      </th>
                      {values.map((value, i) => (
                        <td key={PRICING_COLUMNS[i]} class={i < 3 ? "num pricing__figure" : "num pricing__rate"} data-label={PRICING_COLUMNS[i]}>
                          <span class="pricing__value">{i < 3 ? value : <Rate text={value} />}</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <footer class="footer">
        <span class="wordmark wordmark--small">
          <span class="wordmark__dot" aria-hidden="true" />
          Farshore
        </span>
        <p>Object storage that tells you where your bytes live.</p>
      </footer>
    </div>
  );
}
