import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Architecture } from "./Architecture";
import { Film } from "./Film";
import { MarketingLayout } from "./Chrome";
import { Tabs, TabPanel } from "../components/ui";
import { Icon } from "../components/Icon";
import { useReducedMotion, useReveal } from "../lib/hooks";

const WORDMARKS = [
  "Northwind",
  "Helio Logistics",
  "Brightline",
  "Kestrel Bank",
  "Fernwood Retail",
  "Orbit Health",
  "Cobalt Mobility",
  "Larkspur Media",
];

const METRICS: { figure: number; suffix: string; label: string; format: (value: number) => string }[] = [
  { figure: 300, suffix: "+", label: "connectors", format: (value) => `${Math.round(value)}+` },
  { figure: 9000, suffix: "+", label: "teams", format: (value) => `${Math.round(value).toLocaleString("en-US")}+` },
  { figure: 4, suffix: "B", label: "records moved daily", format: (value) => `${Math.round(value)}B` },
  { figure: 15, suffix: "%", label: "of the Global 2000", format: (value) => `${Math.round(value)}%` },
];

const PROBLEM_CARDS = [
  {
    heading: "Connector upkeep",
    copy: "Every API change lands on your team. Wayline keeps the connectors and absorbs the churn.",
  },
  {
    heading: "Split versions of the truth",
    copy: "Agents read one layer, dashboards read another. One pipeline feeds both.",
  },
  {
    heading: "Control versus ease",
    copy: "Run the data plane yourself, or let Wayline run it. The same pipelines either way.",
  },
];

const STORY_TABS = [
  {
    id: "copy",
    label: "01 Copy",
    caption: "Copy records from 300+ systems into your warehouse, incrementally and exactly once.",
    rows: ["shop_orders", "shop_customers", "crm_accounts"],
  },
  {
    id: "query",
    label: "02 Query",
    caption: "Query the copied records by meaning, so an agent finds the right table without a schema tour.",
    rows: ["semantic index", "column meanings", "lineage"],
  },
  {
    id: "act",
    label: "03 Act",
    caption: "Let agents act across the company: write back, open tickets, trigger syncs.",
    rows: ["write back", "open ticket", "start sync"],
  },
];

function HeroCanvas(): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const context = node.getContext("2d");
    if (!context) return;
    let frame = 0;
    let running = true;
    const draw = (time: number) => {
      const width = (node.width = node.clientWidth);
      const height = (node.height = node.clientHeight);
      context.clearRect(0, 0, width, height);
      const step = 22;
      for (let x = 0; x < width; x += step) {
        for (let y = 0; y < height; y += step) {
          const shimmer = reduced ? 0.25 : 0.2 + 0.18 * Math.sin(time / 900 + (x + y) / 90);
          context.fillStyle = `rgba(124, 108, 245, ${shimmer})`;
          context.beginPath();
          context.arc(x, y, 1.4, 0, Math.PI * 2);
          context.fill();
        }
      }
      if (!reduced && running) frame = window.requestAnimationFrame(draw);
    };
    draw(0);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
  }, [reduced]);
  return <canvas className="hero-canvas" ref={canvas} aria-hidden="true" />;
}

function Metrics(): JSX.Element {
  const [frame, shown] = useReveal<HTMLDivElement>();
  const reduced = useReducedMotion();
  const [values, setValues] = useState(METRICS.map(() => 0));
  useEffect(() => {
    if (!shown) return;
    if (reduced) {
      setValues(METRICS.map((metric) => metric.figure));
      return;
    }
    const started = performance.now();
    let handle = 0;
    const run = (time: number) => {
      const share = Math.min(1, (time - started) / 1500);
      setValues(METRICS.map((metric) => metric.figure * share));
      if (share < 1) handle = window.requestAnimationFrame(run);
    };
    handle = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(handle);
  }, [shown, reduced]);
  return (
    <div className="band">
      <div className="metrics" ref={frame}>
        {METRICS.map((metric, index) => (
          <div key={metric.label}>
            <p className="metric-figure gradient-line">{metric.format(values[index])}</p>
            <p className="eyebrow">{metric.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }): JSX.Element {
  const [frame, shown] = useReveal<HTMLDivElement>();
  return (
    <div className={`band reveal ${shown ? "shown" : ""}`} ref={frame}>
      {children}
    </div>
  );
}

export function Home(): JSX.Element {
  const [tab, setTab] = useState(STORY_TABS[0].id);
  const story = STORY_TABS.find((entry) => entry.id === tab) ?? STORY_TABS[0];
  return (
    <MarketingLayout>
      <section className="band hero dotted">
        <HeroCanvas />
        <p className="stars-badge">14.8K STARS</p>
        <h1>
          Keep every system in step <span className="gradient-line">with your AI.</span>
        </h1>
        <p className="lede">
          Link 300+ business systems to your analytics and model layers. Copy data, query it by meaning,
          and let agents act across the whole company. Run it in your warehouse, private cloud, or your
          own servers.
        </p>
        <div className="hero-actions">
          <Link to="/login" className="button">
            Try it free
          </Link>
          <Link to="/compare" className="button outline">
            Talk to sales
          </Link>
        </div>
      </section>

      <div className="wordmark-row" aria-hidden="true">
        <div className="wordmark-track">
          {[...WORDMARKS, ...WORDMARKS].map((mark, index) => (
            <span key={`${mark}-${index}`}>{mark}</span>
          ))}
        </div>
      </div>

      <Architecture />
      <Metrics />

      <Section>
        <h2>Old pipeline problems follow you into the agent era.</h2>
        <div className="story-grid" style={{ marginTop: "1.5rem" }}>
          {PROBLEM_CARDS.map((card) => (
            <article className="card" key={card.heading}>
              <h3>{card.heading}</h3>
              <p>{card.copy}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <h2>One layer between your systems and everything built on them.</h2>
        <Tabs
          name="One layer"
          tabs={STORY_TABS.map((entry) => ({ id: entry.id, label: entry.label }))}
          selected={tab}
          onSelect={setTab}
        />
        <TabPanel id={story.id} hidden={false}>
          <div className="two-column">
            <div>
              <p>{story.caption}</p>
              <ul>
                {story.rows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </div>
            <div className="terminal">
              <div className="terminal-dots" aria-hidden="true">
                <i style={{ background: "var(--status-succeeded)" }} />
                <i style={{ background: "var(--status-running)" }} />
                <i style={{ background: "var(--status-failed)" }} />
              </div>
              {story.rows.map((row) => (
                <div key={row}>
                  <span style={{ color: "#8b7bf0" }}>wayline</span> {story.id} {row}
                </div>
              ))}
            </div>
          </div>
        </TabPanel>
      </Section>

      <Section>
        <h2>Private by design, not by promise.</h2>
        <div className="two-column">
          <div className="mock">
            <p className="eyebrow">Your cloud</p>
            <p>
              <Icon name="database" /> Records never leave your data plane.
            </p>
          </div>
          <div className="mock">
            <p className="eyebrow">Wayline cloud</p>
            <p>Schedules, catalog and audit only.</p>
          </div>
        </div>
        <p className="eyebrow" style={{ marginTop: "1rem" }}>
          Bridge: Metadata only
        </p>
      </Section>

      <Film />
    </MarketingLayout>
  );
}
