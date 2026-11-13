import { useEffect, useRef, useState } from "react";
import type { LimitsConfig, User } from "../../shared/types.ts";
import { api, formatModified } from "../api.ts";
import { WorkspaceHeader } from "../ui.tsx";

const RECENT = [
  { title: "Tide gauge warm-up", date: "Oct 28.", summary: "Hourly heights from an invented gauge, plotted against the spring and neap cycle." },
  { title: "Rubric totals checker", date: "Oct 21.", summary: "A teacher's notebook that totals rubric rows and flags missing marks." },
  { title: "Moth counts by lamp night", date: "Oct 14.", summary: "Three volunteers compare weekly trap counts without emailing a single copy." },
];

const WORDMARKS = [
  "Fernhollow Primary", "Saltmarsh Survey Co-op", "Quillon Labs", "Larchgate College", "Okapi & Thistle",
  "Brimstone Allotments", "Northcott Readers", "Ember Valley Stats", "Pell & Rook", "Harrowgate Moth Group",
  "Tamsin Weir Studio", "Ledgerfield", "Corvid Analytics", "Mossbank Tutors", "Kestrel Row", "Wickham Fen Trust",
];

function HeroGlyphCloud() {
  const glyphs = ["{ }", "Σ", "λ", "❦", "⬡", "◼", "⚙", "▬", "ƒ", "∴", "√", "π", "≠", "⊆", "∞", "∫", "≈", "±", "Ω", "θ", "∇", "∀", "∈", "→", "⊞", "⊙", "⊤", "↯", "∿", "✦"];
  return (
    <div style={{ position: "relative", maxWidth: 880, margin: "0 auto", aspectRatio: "880 / 300" }} aria-hidden="true">
      <svg viewBox="0 0 880 300" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <ellipse cx="440" cy="150" rx="410" ry="120" fill="none" stroke="#e8e8e4" strokeWidth="1.5" />
        <text x="330" y="163" fontFamily="'Source Sans 3', sans-serif" fontWeight="600" fontSize="52" fill="#2b2b28">brackenpad</text>
        <rect x="238" y="98" width="12" height="118" rx="3" fill="#d9700a" />
        <rect x="556" y="98" width="12" height="118" rx="3" fill="#d9700a" />
        <circle cx="230" cy="140" r="4" fill="#8a8a84" />
        <circle cx="620" cy="175" r="3" fill="#8a8a84" />
        <circle cx="612" cy="120" r="2.2" fill="#8a8a84" />
        {glyphs.map((glyph, index) => {
          const angle = (index / glyphs.length) * Math.PI * 2;
          const rx = 405;
          const ry = 118;
          const x = 440 + rx * Math.cos(angle) - 8;
          const y = 150 + ry * Math.sin(angle) + 6;
          const opacity = 0.45 + ((index % 3) * 0.18);
          return (
            <text key={`${glyph}-${index}`} x={x} y={y} fontSize={index % 4 === 0 ? 20 : 15} fill="#8a8a84" opacity={opacity} fontFamily="'Inter', sans-serif">
              {glyph}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function MockWindow({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="cascade-window__bar">
        <span className="cascade-window__dot" />
        <span className="cascade-window__dot" />
        <span className="cascade-window__dot" />
        <span className="cascade-window__title" style={{ marginLeft: 8 }}>{title}</span>
      </div>
      <div style={{ padding: "10px 12px", fontFamily: "var(--font-code)", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.7 }}>
        {rows.map((row, index) => (
          <div key={index} style={{ whiteSpace: "pre" }}>{row}</div>
        ))}
        <svg viewBox="0 0 120 28" style={{ width: "100%", height: 28, marginTop: 6 }} aria-hidden="true">
          <polyline points="0,24 15,14 30,20 45,6 60,16 75,4 90,14 105,9 120,12" fill="none" stroke="#8a8a84" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

function LineIcon({ d }: { d: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function LandingPage({ user, config, onAuthChange }: { user: User | null; config: LimitsConfig | null; onAuthChange: () => void }) {
  const [signUpState, setSignUpState] = useState<"idle" | "sending" | "sent">("idle");
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = heroRef.current;
    if (node === null) return;
    node.classList.add("hero--enter");
  }, []);

  const limitsLine = config === null
    ? "Runs in your browser, one free plan, no seats."
    : `One notebook format in and out, ${config.checkpoints_kept} checkpoints kept, unlimited notebooks on one free plan.`;

  return (
    <>
      <WorkspaceHeader user={user} onSignOut={onAuthChange} />
      <main>
        {/* Band 2: the Brackenpad mark with glyph cloud */}
        <section className="hero" ref={heroRef}>
          <img
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3C/svg%3E"
            alt="Brackenpad"
            className="hero__svg"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          />
          <HeroGlyphCloud />
        </section>

        {/* Band 3: the landing tagline */}
        <section className="band" style={{ paddingTop: 0 }}>
          <div className="container">
            <p className="tagline">Notebooks for people who think in code, with room for one or two more at the table.</p>
          </div>
        </section>

        {/* Band 4-5: accent-tail heading and recent cards */}
        <section className="band band--grey" aria-labelledby="recent-heading">
          <div className="container">
            <h2 className="section-heading" id="recent-heading">
              Recent from the <span className="accent-tail">notebook log</span>
            </h2>
            <div className="recent-grid" style={{ marginTop: 24 }}>
              {RECENT.map((entry) => (
                <a key={entry.title} href="#signup-form" className="card notebook-card" style={{ display: "block" }}>
                  <h3 className="card__title">{entry.title}</h3>
                  <span className="card__date">{entry.date}</span>
                  <p className="card__text">{entry.summary}</p>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Band 6: the checkpoint cascade row */}
        <section className="band">
          <div className="container">
            <div className="product-row">
              <div className="product-row__art">
                <MockWindow
                  title="Tide gauge warm-up — checkpoint 4"
                  rows={["let heights = [1.2, 1.9, 2.6]", "[3] 1.8", "Math.max(...heights)"]}
                />
              </div>
              <div>
                <h2 className="product-row__heading" id="checkpoints-heading">Checkpoints: every version, side by side</h2>
                <p className="product-row__lead">
                  Save a checkpoint with one key, compare any version cell by cell, and put back exactly what was there.
                </p>
                <div className="product-row__buttons">
                  <a className="button--accent" href="#signup-form" style={{ textDecoration: "none", display: "inline-block" }}>Create account</a>
                  <a className="button--plain" href="#open-format" style={{ textDecoration: "none", display: "inline-block" }}>Read the format</a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Band 7: the notebook feature line-icon grid */}
        <section className="band band--grey" aria-labelledby="features-heading">
          <div className="container">
            <h2 className="section-heading" id="features-heading">
              Everything a small notebook needs, <span className="accent-tail">nothing it does not</span>
            </h2>
            <div className="feature-grid" style={{ marginTop: 24 }} id="features">
              <div className="card">
                <LineIcon d="M4 10l4-4 6 6 6-6 4 4M4 20h20" />
                <h3 className="card__title" style={{ fontSize: "1.02rem" }}>Runs in your browser</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>Your code runs in a private worker in your own tab. Nothing runs on our server.</p>
              </div>
              <div className="card">
                <LineIcon d="M10 8a4 4 0 100 8 4 4 0 000-8zM18 8a4 4 0 100 8 4 4 0 000-8zM2 12h4M22 12h4" />
                <h3 className="card__title" style={{ fontSize: "1.02rem" }}>Edit together</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>See who is here, which cell they are in, and every run as it lands.</p>
              </div>
              <div className="card">
                <LineIcon d="M6 6h16v14H6zM6 12h16M12 6v14" />
                <h3 className="card__title" style={{ fontSize: "1.02rem" }}>Open format in and out</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>Import and export the open notebook format version 4. Your original file stays byte for byte.</p>
              </div>
              <div className="card">
                <LineIcon d="M12 4a6 6 0 106 6h-6zM12 24a6 6 0 01-6-6h6z" />
                <h3 className="card__title" style={{ fontSize: "1.02rem" }}>Find anything</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>Search every notebook you can open by its title, its cells and its headings.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Band 8: the cell lifecycle disc arc */}
        <section className="band">
          <div className="container">
            <h2 className="section-heading">From first keystroke to <span className="accent-tail">saved checkpoint</span></h2>
            <div className="disc-arc">
              <svg className="disc-arc__line" viewBox="0 0 700 60" aria-hidden="true">
                <path d="M10 54 Q350 -18 690 54" fill="none" stroke="#8a8a84" strokeWidth="1.5" />
              </svg>
              <div className="disc-row">
                <div className="disc">Write</div>
                <div className="disc">Queue</div>
                <div className="disc">Run</div>
                <div className="disc">Checkpoint</div>
              </div>
              <div className="disc-labels">
                <div>Cells in, types switched with one key.</div>
                <div>Runs line up for the shared counter.</div>
                <div>Results and outputs land for everyone.</div>
                <div>Any version, compared and restored.</div>
              </div>
            </div>
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <a className="button--accent" href="#signup-form" style={{ textDecoration: "none", display: "inline-block" }}>Start a notebook</a>
            </div>
          </div>
        </section>

        {/* Band 9: the wordmark wall */}
        <section className="band band--grey">
          <div className="container">
            <h2 className="section-heading" style={{ fontSize: "1.15rem" }}>Notebooks kept at</h2>
            <div className="wordmark-wall">
              {WORDMARKS.map((mark) => (
                <span key={mark} className="wordmark">{mark}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Band 10: the format and plan cards */}
        <section className="band">
          <div className="container">
            <div className="plan-cards">
              <div className="card plan-card">
                <LineIcon d="M7 3h10l4 4v14H7zM14 3v5h7" />
                <h3 className="card__title">Open notebook format</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>Version 4 in and out.</p>
              </div>
              <div className="card plan-card" id="limits">
                <LineIcon d="M12 4v16M4 8h16" />
                <h3 className="card__title">One free plan</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>{limitsLine}</p>
              </div>
              <div className="card plan-card" id="open-format">
                <LineIcon d="M12 4v12M6 10l6 6 6-6M4 24h16" />
                <h3 className="card__title">Your file leaves with you</h3>
                <p className="card__text" style={{ color: "var(--muted)" }}>Download the original import at any time.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Band 11: two-tone footer with the sign-up form */}
      <footer className="footer">
        <div className="footer--mid">
          <div className="container">
            <div className="footer__grid">
              <div>
                <p className="footer__head">Product</p>
                <ul className="footer__links">
                  <li><a href="#features">Features</a></li>
                  <li><a href="#limits">Limits</a></li>
                  <li><a href="#open-format">Open format</a></li>
                </ul>
              </div>
              <div>
                <p className="footer__head">Wrenmoor Software</p>
                <ul className="footer__links">
                  <li><a href="/">About</a></li>
                  <li><a href="/">Contact</a></li>
                </ul>
              </div>
              <div>
                <p className="footer__head">Policies</p>
                <ul className="footer__links">
                  <li><a href="/">Privacy</a></li>
                  <li><a href="/">Terms</a></li>
                </ul>
              </div>
            </div>
            <form
              className="footer__form"
              id="signup-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                setSignUpState("sending");
                setSignUpError(null);
                const result = await api.signup({
                  display_name: String(form.get("display_name") ?? ""),
                  email: String(form.get("email") ?? ""),
                  password: String(form.get("password") ?? ""),
                  use: String(form.get("use") ?? ""),
                });
                if (result.ok) {
                  setSignUpState("sent");
                } else {
                  setSignUpState("idle");
                  setSignUpError(result.error.message);
                }
              }}
            >
              <h3 className="footer__heading">Make your first notebook</h3>
              <div className="footer__fields">
                <label className="field footer__field">
                  <span className="field__label">Display name</span>
                  <input className="field__input" name="display_name" required placeholder="Display name *" autoComplete="name" />
                </label>
                <label className="field footer__field">
                  <span className="field__label">Email</span>
                  <input className="field__input" name="email" type="email" required placeholder="Email *" autoComplete="email" />
                </label>
                <label className="field footer__field">
                  <span className="field__label">Password</span>
                  <input className="field__input" name="password" type="password" required minLength={10} placeholder="Password *" autoComplete="new-password" />
                </label>
                <label className="field footer__field">
                  <span className="field__label">I mostly use notebooks for</span>
                  <select className="field__select" name="use" defaultValue="">
                    <option value="" disabled>I mostly use notebooks for *</option>
                    <option value="teaching">Teaching</option>
                    <option value="research">Research</option>
                    <option value="analysis">Analysis</option>
                    <option value="tinkering">Tinkering</option>
                  </select>
                </label>
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="footer__submit" type="submit" disabled={signUpState === "sending"}>
                  Create account
                </button>
              </div>
              {signUpError !== null ? (
                <div className="alert" style={{ marginTop: 12, marginBottom: 0 }} role="alert">
                  <p className="alert__title">{signUpError}</p>
                </div>
              ) : null}
              {signUpState === "sent" ? (
                <p style={{ color: "#fff", marginTop: 12 }}>Check your inbox to verify your email.</p>
              ) : null}
              <p className="footer__footnote">© 2026 Wrenmoor Software</p>
            </form>
          </div>
        </div>
        <div className="footer--deep" style={{ padding: "16px 0" }}>
          <div className="container">
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.85rem", margin: 0 }}>Brackenpad is a notebook service from Wrenmoor Software.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
