import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MarketingLayout } from "./marketing.jsx";
import { Tabs } from "./components.jsx";
import { prefersReducedMotion } from "./api.js";

const WORDMARKS = ["Northwind Retail", "Meridian Bank", "Corvus Health", "Lantern Media",
  "Anchor Logistics", "Peregrine Labs", "Solstice Energy", "Tidewater Freight"];

function HeroDots() {
  return <div className="hero-dots" aria-hidden="true" />;
}

function Wordmarks() {
  const row = [...WORDMARKS, ...WORDMARKS];
  return (
    <div className="wordmarks" aria-hidden="true">
      <div className="wordmarks-row">
        {row.map((mark, index) => <span className="wordmark" key={`${mark}-${index}`}>{mark}</span>)}
      </div>
    </div>
  );
}

function Metric({ figure, label }) {
  return (
    <div>
      <div className="metric-figure grad">{figure}</div>
      <p className="label-mono" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function Metrics() {
  const [start, setStart] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setStart(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setStart(true);
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const metrics = [
    { figure: "300+", label: "Connectors" },
    { figure: "9,000+", label: "Teams" },
    { figure: "4B", label: "Records moved daily" },
    { figure: "15%", label: "Of the Global 2000" },
  ];
  return (
    <div className="grid-4" ref={ref}>
      {metrics.map((m) => (
        <Metric key={m.label} figure={m.figure} label={m.label} />
      ))}
    </div>
  );
}

function Architecture() {
  const [drawn, setDrawn] = useState(prefersReducedMotion() ? 1 : 0);
  const ref = useRef(null);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setDrawn(1);
      return undefined;
    }
    let raf;
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const enter = vh - rect.top;
      const span = rect.height + vh * 0.5;
      const progress = Math.max(0, Math.min(1, enter / span));
      setDrawn(progress);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const tiles = [
    { name: "PostgreSQL", sub: "Databases" },
    { name: "Ticket Desk", sub: "Support" },
    { name: "Product Events", sub: "Product" },
  ];
  return (
    <div ref={ref}>
      <svg viewBox="0 0 900 320" width="100%" aria-hidden="true" focusable="false"
        style={{ maxWidth: "900px", display: "block", margin: "0 auto" }}>
        {tiles.map((tile, index) => {
          const y = 60 + index * 90;
          const d = `M 300 ${y + 30} C 380 ${y + 30}, 420 160, 470 160`;
          const len = 260;
          return (
            <g key={tile.name}>
              <path d={d} stroke="var(--violet)" strokeWidth="2" fill="none"
                strokeDasharray={prefersReducedMotion() ? "none" : `${len * drawn} ${len}`}
                opacity={0.25 + 0.75 * drawn} />
            </g>
          );
        })}
        <path d="M 530 160 C 590 160, 630 80, 700 80" stroke="var(--violet)" strokeWidth="2"
          fill="none" strokeDasharray={prefersReducedMotion() ? "none" : `${220 * Math.max(0, drawn * 1.6 - 0.6)} 220`} />
        <path d="M 530 160 C 590 160, 630 240, 700 240" stroke="var(--violet)" strokeWidth="2"
          fill="none" strokeDasharray={prefersReducedMotion() ? "none" : `${220 * Math.max(0, drawn * 1.6 - 0.6)} 220`} />
        {drawn > 0.98 && !prefersReducedMotion() && (
          <>
            <circle r="4" fill="var(--glow)">
              <animateMotion dur="3s" repeatCount="indefinite" path="M 300 90 C 380 90, 420 160, 470 160" />
            </circle>
            <circle r="4" fill="var(--glow)">
              <animateMotion dur="3s" begin="0.5s" repeatCount="indefinite" path="M 300 180 C 380 180, 420 160, 470 160" />
            </circle>
            <circle r="4" fill="var(--glow)">
              <animateMotion dur="3s" begin="1s" repeatCount="indefinite" path="M 300 270 C 380 270, 420 160, 470 160" />
            </circle>
          </>
        )}
        {tiles.map((tile, index) => (
          <g key={`tile-${tile.name}`} opacity={0.3 + 0.7 * Math.min(1, drawn * 1.4)}>
            <rect x="40" y={60 + index * 90} width="260" height="60" rx="10"
              fill="var(--page)" stroke="var(--line-2)" />
            <text x="60" y={60 + index * 90 + 25} fill="var(--ink)" fontSize="15"
              fontWeight="600">{tile.name}</text>
            <text x="60" y={60 + index * 90 + 44} fill="var(--muted)" fontSize="12">{tile.sub}</text>
          </g>
        ))}
        <g opacity={0.3 + 0.7 * Math.min(1, drawn * 1.6)}>
          <rect x="470" y="115" width="120" height="90" rx="14" fill="url(#hubGrad)" />
          <text x="530" y="150" textAnchor="middle" fill="#fff" fontSize="15"
            fontWeight="600">Wayline</text>
          <text x="530" y="170" textAnchor="middle" fill="#fff" fontSize="11" opacity="0.8">
            One layer
          </text>
          {!prefersReducedMotion() && (
            <animateTransform attributeName="transform" type="scale" values="1;1.03;1"
              dur="2s" repeatCount="indefinite" additive="sum" />
          )}
        </g>
        <defs>
          <linearGradient id="hubGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cdc2ff" />
            <stop offset="100%" stopColor="#2b2570" />
          </linearGradient>
        </defs>
        <g opacity={drawn > 0.6 ? 1 : 0.3}>
          <rect x="700" y="50" width="170" height="60" rx="10" fill="var(--page)"
            stroke="var(--line-2)" />
          <text x="720" y="75" fill="var(--ink)" fontSize="14" fontWeight="600">AI agents</text>
          <text x="720" y="95" fill="var(--muted)" fontSize="12">Query and act</text>
        </g>
        <g opacity={drawn > 0.6 ? 1 : 0.3}>
          <rect x="700" y="210" width="170" height="60" rx="10" fill="var(--page)"
            stroke="var(--line-2)" />
          <text x="720" y="235" fill="var(--ink)" fontSize="14" fontWeight="600">Warehouses</text>
          <text x="720" y="255" fill="var(--muted)" fontSize="12">Stored tables</text>
        </g>
      </svg>
    </div>
  );
}

function Film() {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [transcript, setTranscript] = useState(false);
  const reduced = prefersReducedMotion();
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (reduced) return undefined;
    video.muted = true;
    video.play().catch(() => {});
    return () => video.pause();
  }, [reduced]);
  const captions = [
    "Every record that moves makes a sound.",
    "Rising pitch means more rows are arriving.",
    "Quiet means the pipeline is caught up.",
    "Wayline turns your syncs into signal.",
  ];
  return (
    <div>
      <video ref={videoRef} controls width="100%" style={{ borderRadius: "16px", maxWidth: "820px", display: "block", margin: "0 auto" }}
        src="/media/data-in-sound.webm" muted={muted} loop={!reduced}>
        <track kind="captions" label="English" srclang="en"
          src="/media/data-in-sound.en.vtt" default />
        <track kind="chapters" label="Chapters" srclang="en"
          src="/media/data-in-sound.chapters.vtt" />
      </video>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="btn btn-outline btn-sm" aria-pressed={!muted}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (videoRef.current) videoRef.current.muted = next;
          }}>
          {muted ? "Unmute film" : "Mute film"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" aria-pressed={transcript}
          aria-expanded={transcript}
          onClick={() => setTranscript((value) => !value)}>
          Show transcript
        </button>
      </div>
      <ul aria-label="Chapters" className="section-tight" style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
        {[["Arrival", 0], ["Volume", 12], ["Caught up", 24]].map(([label, seconds]) => (
          <li key={label}>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => { if (videoRef.current) videoRef.current.currentTime = seconds; }}>
              {label}
            </button>
          </li>
        ))}
      </ul>
      {transcript && (
        <div className="card card-pad" style={{ maxWidth: "620px", margin: "0 auto" }}>
          <ol style={{ paddingLeft: "1.2rem", color: "var(--body)" }}>
            {captions.map((line) => <li key={line} style={{ marginBottom: "0.5rem" }}>{line}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const storyTabs = [
    { id: "copy", label: "01 Copy", content: (
      <div className="card card-pad">
        <h3>Copy</h3>
        <p>Move tables from the systems the business already runs into your warehouse, on a
        schedule you control. Streams are selected per connection, and each sync is one
        all-or-nothing step whose counts always match the stored rows.</p>
      </div>
    ) },
    { id: "query", label: "02 Query", content: (
      <div className="card card-pad">
        <h3>Query</h3>
        <p>The warehouse tables Wayline writes are plain tables, so every tool your team already
        uses can read them. Cursors and row counts are visible in the console next to the
        pipelines that produced them.</p>
      </div>
    ) },
    { id: "act", label: "03 Act", content: (
      <div className="card card-pad">
        <h3>Act</h3>
        <p>Agents read the same layer through the Wayline MCP server, so the copy your analysts
        see and the copy your agents act on are one and the same.</p>
      </div>
    ) },
  ];
  const [tab, setTab] = useState("copy");
  return (
    <MarketingLayout>
      <section className="hero wrap">
        <HeroDots />
        <span className="hero-badge">14.8K STARS</span>
        <h1 className="hero-h1">Keep every system in step <span className="grad">with your AI.</span></h1>
        <p className="hero-sub">Link 300+ business systems to your analytics and model layers. Copy
        data, query it by meaning, and let agents act across the whole company. Run it in your
        warehouse, private cloud, or your own servers.</p>
        <div className="hero-actions">
          <Link to="/login" className="btn btn-primary">Try it free</Link>
          <a href="#story" className="btn btn-outline">Talk to sales</a>
        </div>
      </section>
      <Wordmarks />
      <section className="section wrap" id="architecture">
        <span className="eyebrow">The one layer</span>
        <h2>Every connector runs through one layer</h2>
        <p style={{ maxWidth: "62ch" }}>Connector tiles feed the Wayline hub, which fans out to the
        warehouses and agents that read the result.</p>
        <Architecture />
      </section>
      <section className="section wrap">
        <Metrics />
      </section>
      <section className="section wrap" id="story">
        <h2>Old pipeline problems follow you into the agent era.</h2>
        <div className="grid-3" style={{ marginTop: "1.5rem" }}>
          {[
            ["Connector upkeep", "Hand-built connectors drift as the systems behind them change, and the breakage lands in the warehouse."],
            ["Split versions of the truth", "Every team copies its own slice, so the numbers stop agreeing by the time they matter."],
            ["Control versus ease", "Hosted tools move quickly but lock you out of the data plane you are meant to govern."],
          ].map(([title, copy]) => (
            <article className="card card-pad" key={title}>
              <h3>{title}</h3>
              <p style={{ marginBottom: 0 }}>{copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section wrap">
        <h2>One layer between your systems and everything built on them.</h2>
        <div style={{ marginTop: "1.5rem" }}>
          <Tabs name="One layer" idBase="one-layer" tabs={storyTabs} active={tab}
            onChange={setTab} />
        </div>
      </section>
      <section className="section wrap">
        <h2>Private by design, not by promise.</h2>
        <div className="grid-2" style={{ marginTop: "1.5rem" }}>
          <div className="card card-pad">
            <h3>Your data plane</h3>
            <p>Run Wayline where the data already lives. The console and the pipeline share one
            origin, and no third-party service sees a byte.</p>
          </div>
          <div className="card card-pad">
            <h3>Metadata only</h3>
            <p>The bridge between the two panels carries metadata only. Records stay inside your
            network the whole way.</p>
            <p className="label-mono" style={{ color: "var(--violet)", marginBottom: 0 }}>
              Metadata only
            </p>
          </div>
        </div>
      </section>
      <section className="section wrap">
        <h2>Hear your data move</h2>
        <Film />
      </section>
    </MarketingLayout>
  );
}
