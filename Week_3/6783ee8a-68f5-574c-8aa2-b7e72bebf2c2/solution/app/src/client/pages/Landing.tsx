import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FileDown, FileJson, ListOrdered, Pencil, Play, Search, Ticket, Users, Braces, Flag } from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { SignupForm } from "./Forms";

// ---- the hero: the mark, three satellite dots and a cloud of generic pictograms ----

type Glyph = (props: { size: number }) => ReactNode;

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const text = (value: string): Glyph =>
  function TextGlyph({ size }) {
    return <text x={0} y={size * 0.35} fontFamily="Fira Code, monospace" fontSize={size * 1.1} textAnchor="middle" fill="currentColor">{value}</text>;
  };

const GLYPHS: Glyph[] = [
  text("{ }"),
  text("Σ"),
  text("λ"),
  text("π"),
  text("∫"),
  text("∞"),
  text("#"),
  text("</>"),
  text("[ ]"),
  text("( )"),
  text("≈"),
  text("∂"),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M12 3 20 8v8l-8 5-8-5V8z" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z M12 12 20 7.5 M12 12 4 7.5 M12 12v9" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M5 20C5 11 11 5 20 4c0 9-5 15-14 16 M5 20c3-5 6-8 11-11" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M5 20V12M10 20V6M15 20v-9M20 20V9" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M3 12c3-6 6-6 9 0s6 6 9 0" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M12 4 21 19H3z" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
    </g>
  ),
  ({ size }) => (
    <g {...stroke} transform={`scale(${size / 24}) translate(-12 -12)`}>
      <path d="M12 3 21 12 12 21 3 12z" />
    </g>
  ),
];

/** A small deterministic generator, so the cloud is the same on every load. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function GlyphCloud(): ReactNode {
  const next = sequence(7);
  const cloud = Array.from({ length: 30 }, (_, i) => {
    const angle = (i / 30) * Math.PI * 2 + (next() - 0.5) * 0.14;
    const spread = 1 + (next() - 0.5) * 0.34;
    return {
      Glyph: GLYPHS[i % GLYPHS.length] as Glyph,
      x: 340 + Math.cos(angle) * 300 * spread,
      y: 165 + Math.sin(angle) * 132 * spread,
      size: 18 + Math.round(next() * 16),
      opacity: 0.5 + next() * 0.3,
    };
  });
  return (
    <g color="#9e9e9e">
      {cloud.map(({ Glyph, x, y, size, opacity }, i) => (
        <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={opacity.toFixed(2)}>
          <Glyph size={size} />
        </g>
      ))}
    </g>
  );
}

function HeroMark(): ReactNode {
  const art = useRef<SVGSVGElement>(null);
  useEffect(() => {
    // The one entrance on the page: a single fade from invisible, with no fill so the end state is the plain page.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) art.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, easing: "ease-in" });
  }, []);
  return (
    <svg ref={art} className="hero-art" role="img" aria-label="Brackenpad" viewBox="0 0 680 330" width="680" height="330">
      <GlyphCloud />
      <g>
        <path d="M196 118h-32v94h32M484 118h32v94h-32" fill="none" stroke="#b84a14" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
        <text x="340" y="184" textAnchor="middle" fontFamily="Source Sans 3, Helvetica Neue, Arial, sans-serif" fontWeight="600" fontSize="46" fill="#333">brackenpad</text>
        <circle cx="540" cy="100" r="11" fill="#737373" />
        <circle cx="140" cy="240" r="16" fill="#9e9e9e" />
        <circle cx="580" cy="240" r="22" fill="#b5b5b5" />
      </g>
    </svg>
  );
}

// ---- mock notebook windows: title bar with three dots, code cells, a drawn chart ----

function Chart({ phase }: { phase: number }): ReactNode {
  const points = Array.from({ length: 28 }, (_, i) => {
    const t = (i / 27) * Math.PI * 4 + phase;
    return `${(8 + (i / 27) * 224).toFixed(1)},${(46 - (Math.sin(t) * 0.7 + Math.sin(t * 2.1 + 1) * 0.3) * 30).toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 240 92" className="mock-chart" aria-hidden="true">
      <path d="M8 8v78h224" fill="none" stroke="#9e9e9e" strokeWidth="1" />
      <polyline points={points} fill="none" stroke="#b84a14" strokeWidth="2" strokeLinejoin="round" />
      <polyline points={points.replace(/,(\d+\.\d)/g, (_, y: string) => `,${(Number(y) * 0.8 + 14).toFixed(1)}`)} fill="none" stroke="#737373" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  );
}

function MockWindow({ title, lines, phase, className }: { title: string; lines: string[]; phase: number; className: string }): ReactNode {
  return (
    <div className={`mock-window ${className}`} aria-hidden="true">
      <div className="mock-bar"><span className="dots"><i /><i /><i /></span><span className="mock-title">{title}</span></div>
      <div className="mock-cell"><span className="mock-count">[1]</span><pre>{lines.join("\n")}</pre></div>
      <div className="mock-cell chart"><span className="mock-count">[2]</span><Chart phase={phase} /></div>
    </div>
  );
}

function Cascade(): ReactNode {
  return (
    <div className="mock-cascade">
      <MockWindow className="back" title="Tide gauge · #1" phase={0.2} lines={["const heights = [1.2, 1.9, 2.6];", "heights.length"]} />
      <MockWindow className="mid" title="Tide gauge · #2" phase={1.4} lines={["const spring = heights.map(", "  (h) => h * 1.15", ");"]} />
      <MockWindow className="front" title="Tide gauge · now" phase={2.6} lines={["const range = Math.max(...heights)", "  - Math.min(...heights);", "display(range);"]} />
    </div>
  );
}

// ---- content ----

const CARDS = [
  { title: "Tide gauge warm-up", date: "Oct 28.", summary: "Hourly heights from an invented gauge, plotted against the spring and neap cycle." },
  { title: "Rubric totals checker", date: "Oct 21.", summary: "A teacher's notebook that totals rubric rows and flags missing marks." },
  { title: "Moth counts by lamp night", date: "Oct 14.", summary: "Three volunteers compare weekly trap counts without emailing a single copy." },
];

const FEATURES = [
  { Icon: Braces, title: "Runs in your browser", blurb: "Your code runs in a private worker in your own tab. Nothing runs on our server." },
  { Icon: Users, title: "Edit together", blurb: "See who is here, which cell they are in, and every run as it lands." },
  { Icon: FileJson, title: "Open format in and out", blurb: "Import and export the open notebook format version 4. Your original file stays byte for byte." },
  { Icon: Search, title: "Find anything", blurb: "Search every notebook you can open by its title, its cells and its headings." },
];

const DISCS = [
  { Icon: Pencil, title: "Write", blurb: "Type code and prose cells from the keyboard." },
  { Icon: ListOrdered, title: "Queue", blurb: "Runs line up on one counter everyone shares." },
  { Icon: Play, title: "Run", blurb: "Each tab runs its cells in a private worker." },
  { Icon: Flag, title: "Checkpoint", blurb: "Save the whole notebook and compare any version." },
];

const PLANS = [
  { Icon: FileJson, title: "Open notebook format", blurb: "Version 4 in and out." },
  { Icon: Ticket, title: "One free plan", blurb: "The published limits, no seats." },
  { Icon: FileDown, title: "Your file leaves with you", blurb: "Download original." },
];

type Mark = { name: string; style: CSSProperties; weight: number; family: string; size: number; spacing?: number; italic?: boolean };

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'Fira Code', monospace";
const WORDMARKS: Mark[] = [
  { name: "Fernhollow Primary", family: SERIF, weight: 700, size: 20, style: {} },
  { name: "Saltmarsh Survey Co-op", family: SANS, weight: 600, size: 17, spacing: 1.2, style: {} },
  { name: "Quillon Labs", family: MONO, weight: 400, size: 19, style: {} },
  { name: "Larchgate College", family: SERIF, weight: 400, size: 21, italic: true, style: {} },
  { name: "Okapi & Thistle", family: SANS, weight: 700, size: 20, style: {} },
  { name: "Brimstone Allotments", family: SERIF, weight: 700, size: 17, spacing: 0.6, style: {} },
  { name: "Northcott Readers", family: SANS, weight: 600, size: 20, style: {} },
  { name: "Ember Valley Stats", family: MONO, weight: 400, size: 16, style: {} },
  { name: "Pell & Rook", family: SERIF, weight: 400, size: 24, italic: true, style: {} },
  { name: "Harrowgate Moth Group", family: SANS, weight: 700, size: 16, spacing: 1, style: {} },
  { name: "Tamsin Weir Studio", family: SERIF, weight: 400, size: 20, style: {} },
  { name: "Ledgerfield", family: SANS, weight: 600, size: 24, style: {} },
  { name: "Corvid Analytics", family: MONO, weight: 400, size: 18, style: {} },
  { name: "Mossbank Tutors", family: SERIF, weight: 700, size: 19, style: {} },
  { name: "Kestrel Row", family: SANS, weight: 700, size: 24, spacing: 1.5, style: {} },
  { name: "Wickham Fen Trust", family: SERIF, weight: 400, size: 20, italic: true, style: {} },
];

function Wordmark({ mark }: { mark: Mark }): ReactNode {
  return (
    <svg className="wordmark" role="img" aria-label={mark.name} viewBox="0 0 220 50" width="220" height="50">
      <text
        x="110"
        y="31"
        textAnchor="middle"
        fill="#6f6f6f"
        fontFamily={mark.family}
        fontWeight={mark.weight}
        fontSize={mark.size}
        fontStyle={mark.italic ? "italic" : "normal"}
        letterSpacing={mark.spacing ?? 0}
        textLength={mark.name.length * mark.size * 0.5 > 200 ? 200 : undefined}
        lengthAdjust="spacingAndGlyphs"
      >
        {mark.name}
      </text>
    </svg>
  );
}

const FOOTER = [
  { head: "Product", links: [["Features", "#features"], ["Limits", "#plans"], ["Open format", "#plans"]] },
  { head: "Wrenmoor Software", links: [["About", "#features"], ["Contact", "mailto:hello@brackenpad.test"]] },
  { head: "Policies", links: [["Privacy", "#plans"], ["Terms", "#plans"]] },
];

export function Landing(): ReactNode {
  return (
    <>
      <SiteHeader landing />
      <main>
        <section className="band hero-band" aria-label="Brackenpad">
          <div className="container hero">
            <HeroMark />
            <p className="tagline">Notebooks for people who think in code, with room for one or two more at the table.</p>
          </div>
        </section>

        <section className="band grey recent-band">
          <div className="container">
            <h2 className="section-title">
              Recent from the <span className="tail">notebook log</span>
            </h2>
            <ul className="cards3">
              {CARDS.map((card) => (
                <li key={card.title}>
                  <a className="landing-card" href="#signup" aria-describedby={`card-text-${card.date}`}>
                    <span className="card-title">{card.title}</span>
                    <span className="card-text" id={`card-text-${card.date}`} aria-hidden="true">
                      <span className="italic muted">{card.date}</span> {card.summary}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band product-band" id="checkpoints">
          <div className="container product-row">
            <Cascade />
            <div className="product-text">
              <h2>Checkpoints: every version, side by side</h2>
              <p className="lead">Save a checkpoint with one key, compare any version cell by cell, and put back exactly what was there.</p>
              <div className="button-row">
                <a className="btn btn-accent" href="#signup">Create account</a>
                <a className="btn btn-accent" href="#plans">Read the format</a>
              </div>
            </div>
          </div>
        </section>

        <section className="band grey" id="features">
          <div className="container">
            <ul className="features">
              {FEATURES.map(({ Icon, title, blurb }) => (
                <li key={title}>
                  <Icon size={64} strokeWidth={1.25} color="#9e9e9e" aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{blurb}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band disc-band" aria-label="Cell lifecycle">
          <div className="container">
            <div className="discs">
              <svg className="disc-arc" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
                <path d="M125 40 Q500 130 875 40" fill="none" stroke="#9e9e9e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <ol>
                {DISCS.map(({ Icon, title, blurb }) => (
                  <li key={title}>
                    <span className="disc"><Icon size={34} strokeWidth={1.75} color="#fff" aria-hidden="true" /></span>
                    <h3>{title}</h3>
                    <p>{blurb}</p>
                  </li>
                ))}
              </ol>
            </div>
            <p className="center"><a className="btn btn-accent" href="#signup">Start a notebook</a></p>
          </div>
        </section>

        <section className="band grey wall-band" aria-label="Where notebooks are kept">
          <div className="container">
            <p className="small-heading">Notebooks kept at</p>
            <ul className="wall">
              {WORDMARKS.map((mark) => (
                <li key={mark.name}><Wordmark mark={mark} /></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band" id="plans">
          <div className="container">
            <h2 className="section-title">Open format, one free plan</h2>
            <ul className="plans">
              {PLANS.map(({ Icon, title, blurb }) => (
                <li key={title} className="plan-card">
                  <Icon size={52} strokeWidth={1.25} color="#9e9e9e" aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{blurb}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-upper">
          <div className="container footer-cols">
            {FOOTER.map((column) => (
              <div key={column.head}>
                <p className="footer-head">{column.head}</p>
                <ul>
                  {column.links.map(([label, href]) => (
                    <li key={label}><a href={href}>{label}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="footer-lower" id="signup">
          <div className="container">
            <h2 className="footer-title">Make your first notebook</h2>
            <SignupForm onDark />
            <p className="footnote">© 2026 Wrenmoor Software</p>
          </div>
        </div>
      </footer>
    </>
  );
}
