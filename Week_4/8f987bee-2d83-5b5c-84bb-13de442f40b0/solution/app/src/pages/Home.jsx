import { useRef } from "react";
import { Link } from "react-router-dom";
import ArchitectureDiagram from "../components/ArchitectureDiagram.jsx";
import DotGrid from "../components/DotGrid.jsx";
import Film from "../components/Film.jsx";
import { Star, Tick } from "../components/Icons.jsx";
import { Tabs } from "../components/Tabs.jsx";
import { inView, useFrames } from "../lib/frames.js";

const WORDMARKS = ["Northwind Rail", "Bramble & Co", "Quanta Freight", "Larkspur Health", "Tidewater Bank",
  "Copperline", "Halcyon Labs", "Mosaic Retail", "Fernhill Energy", "Orbital Foods"];
const METRICS = [
  { value: 300, suffix: "+", label: "connectors" },
  { value: 9000, suffix: "+", label: "teams" },
  { value: 4, suffix: "B", label: "records moved daily" },
  { value: 15, suffix: "%", label: "of the Global 2000" },
];
const COUNT_MS = 1500;
const PROBLEMS = [
  { title: "Connector upkeep", body: "Every API change breaks a hand-written script. Teams spend their week patching extractors instead of shipping models." },
  { title: "Split versions of the truth", body: "Each agent and dashboard pulls its own copy, so the same customer has three answers depending on who asks." },
  { title: "Control versus ease", body: "Hosted tools are quick but take your data off-site; self-hosted tools keep it close but cost a team to run." },
];
const STORY = [
  { name: "01 Copy", title: "Copy every system into one place", caption: "Incremental syncs land each record once, with cursors that only move forward when the commit lands.", steps: ["Source", "Wayline", "Warehouse"] },
  { name: "02 Query", title: "Query it by meaning", caption: "Agents ask questions in plain language and Wayline answers from the copied tables, never from a stale export.", steps: ["Agent", "Context layer", "Tables"] },
  { name: "03 Act", title: "Let agents act across the company", caption: "Approved actions flow back to the systems they came from, every one recorded in a tamper-evident audit log.", steps: ["Agent", "Wayline", "Systems"] },
];

const format = (value, suffix) => `${Math.round(value).toLocaleString("en-US")}${suffix}`;

function Metrics() {
  const refs = useRef([]);
  const started = useRef(null);
  useFrames((now, reduced) => {
    const first = refs.current[0];
    if (!first) return true;
    if (reduced) return false;
    if (started.current === null && inView(first.parentElement.parentElement)) started.current = now;
    if (started.current === null) return true;
    const t = Math.min(1, (now - started.current) / COUNT_MS);
    const eased = 1 - (1 - t) ** 3;
    METRICS.forEach((metric, i) => {
      refs.current[i].textContent = format(metric.value * eased, metric.suffix);
    });
    return t < 1;
  });
  return (
    <div className="metrics">
      {METRICS.map((metric, i) => (
        <div className="metric" key={metric.label}>
          <strong className="grad-text" ref={(el) => { refs.current[i] = el; }}>{format(metric.value, metric.suffix)}</strong>
          <span>{metric.label}</span>
        </div>
      ))}
    </div>
  );
}

function StoryPanel({ story }) {
  return (
    <div className="two-col story-panel">
      <div className="mock">
        <div className="terminal-bar" aria-hidden="true"><i /><i /><i /></div>
        <ol className="story-steps" aria-label={`${story.name} flow`}>
          {story.steps.map((step, i) => (
            <li key={step}><span className="label">{String(i + 1).padStart(2, "0")}</span>{step}</li>
          ))}
        </ol>
      </div>
      <div className="story-copy">
        <h3>{story.title}</h3>
        <p>{story.caption}</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-canvas-fallback dots" aria-hidden="true" />
        <DotGrid />
        <div className="container hero-inner">
          <span className="badge label"><Star />14.8K STARS</span>
          <h1 className="display">
            <span className="line">Keep every system in step</span>{" "}
            <span className="line grad-text">with your AI.</span>
          </h1>
          <p className="lede">
            Link 300+ business systems to your analytics and model layers. Copy data, query it by meaning, and let agents
            act across the whole company. Run it in your warehouse, private cloud, or your own servers.
          </p>
          <div className="hero-actions">
            <Link to="/login" className="btn btn-primary">Try it free</Link>
            <Link to="/pricing" className="btn btn-outline">Talk to sales</Link>
          </div>
        </div>
        <div className="ticker">
          <div className="ticker-track" aria-hidden="true">
            {[...WORDMARKS, ...WORDMARKS].map((mark, i) => <span key={`${mark}-${i}`}>{mark}</span>)}
          </div>
          <ul className="sr-only" aria-label="Teams that run Wayline">{WORDMARKS.map((mark) => <li key={mark}>{mark}</li>)}</ul>
        </div>
      </section>

      <section className="section container" data-reveal>
        <div className="section-head center">
          <span className="label eyebrow">Architecture</span>
          <h2 className="h2">Every system flows through one hub</h2>
          <p className="lede">Connectors copy each source on its schedule; the hub serves the same records to your agents and your warehouse.</p>
        </div>
        <div className="architecture-frame"><ArchitectureDiagram /></div>
        <Metrics />
      </section>

      <section className="section container" data-reveal>
        <div className="section-head">
          <span className="label eyebrow">Why it breaks</span>
          <h2 className="h2">Old pipeline problems follow you into the agent era.</h2>
        </div>
        <div className="grid-3 problem-cards">
          {PROBLEMS.map((problem) => (
            <article className="card" key={problem.title}>
              <h3>{problem.title}</h3>
              <p>{problem.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section container" data-reveal>
        <div className="section-head">
          <span className="label eyebrow">How it works</span>
          <h2 className="h2">One layer between your systems and everything built on them.</h2>
        </div>
        <Tabs label="One layer" names={STORY.map((story) => story.name)} className="story"
          render={(index) => <StoryPanel story={STORY[index]} />} />
      </section>

      <section className="section container" data-reveal>
        <div className="section-head">
          <span className="label eyebrow">Hybrid</span>
          <h2 className="h2">Private by design, not by promise.</h2>
          <p className="lede">Your records stay on your servers. Only the settings and run history cross to the control plane.</p>
        </div>
        <div className="hybrid">
          <div className="hybrid-panel">
            <span className="label eyebrow">Your cloud</span>
            <h3>Data plane</h3>
            <ul><li>Connectors and syncs run here</li><li>Rows never leave your network</li><li>Your keys, your warehouse</li></ul>
          </div>
          <div className="bridge">
            <svg viewBox="0 0 120 24" aria-hidden="true"><path d="M2 12h116" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" /><circle cx="60" cy="12" r="5" fill="currentColor" /></svg>
            <span className="label">Metadata only</span>
          </div>
          <div className="hybrid-panel">
            <span className="label eyebrow">Wayline cloud</span>
            <h3>Control plane</h3>
            <ul><li>Schedules, versions and audit log</li><li>Live job status and logs</li><li><Tick width="14" height="14" style={{ display: "inline" }} /> No record contents</li></ul>
          </div>
        </div>
      </section>

      <Film />
    </>
  );
}
