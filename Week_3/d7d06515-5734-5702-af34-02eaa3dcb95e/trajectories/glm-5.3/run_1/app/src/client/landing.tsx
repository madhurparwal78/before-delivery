import { useEffect, useRef, useState } from "react";
import { copy } from "../shared/copy.js";

/** A wireframe path revealed from start to end, staggered. */
function WirePath(props: { d: string; index: number; reduced: boolean; stroke?: string }): JSX.Element {
  const ref = useRef<SVGPathElement | null>(null);
  const [grip, setGrip] = useState(false);
  useEffect(() => {
    const path = ref.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    if (props.reduced) {
      path.style.strokeDashoffset = "0";
      setGrip(true);
      return;
    }
    path.style.strokeDashoffset = `${length}`;
    const start = props.index * 40;
    const drawTimer = setTimeout(() => {
      path.style.transition = "stroke-dashoffset 0.9s cubic-bezier(0.2, 0.8, 0.3, 1)";
      path.style.strokeDashoffset = "0";
    }, start);
    const gripTimer = setTimeout(() => setGrip(true), start + 900);
    return () => {
      clearTimeout(drawTimer);
      clearTimeout(gripTimer);
    };
  }, [props.index, props.reduced]);
  const point = ref.current?.getPointAtLength(ref.current?.getTotalLength() ?? 0) ?? null;
  return (
    <>
      <path ref={ref} d={props.d} fill="none" stroke={props.stroke ?? "#5a6068"} strokeWidth="1" />
      {grip && point && <rect x={point.x - 4} y={point.y - 4} width="8" height="8" fill="#ff2f6d" />}
    </>
  );
}

function HeroWireframe(): JSX.Element {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paths = [
    "M 40 480 L 960 480",
    "M 960 480 L 960 80",
    "M 960 80 L 40 80",
    "M 40 80 L 40 480",
    "M 500 480 Q 750 340 960 300",
    "M 500 480 Q 660 400 820 360",
    "M 500 480 Q 580 440 660 415",
    "M 300 80 Q 500 10 700 60",
    "M 300 80 Q 480 20 640 55",
    "M 100 480 L 180 300 L 260 480",
    "M 150 480 L 210 360 L 270 480",
    "M 40 300 L 200 300",
    "M 200 300 L 200 480",
    "M 620 480 L 620 380",
    "M 620 380 L 760 380",
    "M 760 380 L 760 480",
  ];
  return (
    <svg className="wireframe" viewBox="0 0 1000 520" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      {paths.map((d, i) => (
        <WirePath key={i} d={d} index={i} reduced={reduced} />
      ))}
    </svg>
  );
}

function Constellation(props: { id: string }): JSX.Element {
  const [shown, setShown] = useState(false);
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lines = ["M 10 90 L 60 30", "M 60 30 L 130 70", "M 130 70 L 90 140", "M 10 90 L 90 140"];
  const nodes: Array<[number, number]> = [[10, 90], [60, 30], [130, 70], [90, 140]];
  return (
    <svg
      ref={ref}
      viewBox="0 0 150 160"
      aria-hidden="true"
      width="150"
      height="160"
      style={{ opacity: shown ? 1 : 0, transition: reduced ? "none" : "opacity 0.2s" }}
    >
      {lines.map((d, i) => (
        <g key={i} style={reduced || shown ? undefined : { opacity: 0 }}>
          <WirePath d={d} index={i} reduced={reduced || !shown} stroke="#a7adb5" />
        </g>
      ))}
      {shown &&
        nodes.map(([x, y], i) => <rect key={i} x={x - 4} y={y - 4} width="8" height="8" fill="#ff2f6d" />)}
    </svg>
  );
}

function StickyAccountHeader(props: { shown: boolean }): JSX.Element {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<"hidden" | "in" | "out">("hidden");
  const seenShown = useRef(props.shown);
  useEffect(() => {
    if (reduced) {
      setPhase(props.shown ? "in" : "hidden");
      seenShown.current = props.shown;
      return;
    }
    // A threshold, not scroll-scrubbed: only transition when the flag flips.
    if (props.shown === seenShown.current) return;
    seenShown.current = props.shown;
    setPhase(props.shown ? "in" : "out");
    if (!props.shown) {
      // Then it is hidden and inert.
      setTimeout(() => setPhase("hidden"), 200);
    }
  }, [props.shown, reduced]);
  if (phase === "hidden") {
    return <div className="sticky-header hidden" aria-hidden="true" />;
  }
  return (
    <div
      className={`sticky-header ${phase === "in" ? (reduced ? "" : "header-show") : reduced ? "hidden" : "header-hide"}`}
      aria-hidden={phase === "out" ? "true" : undefined}
    >
      <img src="/brand/corbel-works.svg" alt="Corbel Works" height="26" />
      <div style={{ display: "flex", gap: "10px" }}>
        <a className="btn btn-outline btn-small" href="/signup">
          Create account
        </a>
        <a className="btn btn-filled btn-small" href="/signin">
          Sign in
        </a>
      </div>
    </div>
  );
}

function DevicePreview(): JSX.Element {
  return (
    <img
      src="/brand/devices.svg"
      alt="Corbel Draft on a laptop, tablet and phone"
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}

export function Landing(props: { signedIn: boolean }): JSX.Element {
  const [headerShown, setHeaderShown] = useState(false);
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onScroll = (): void => {
      const node = buttonsRef.current;
      if (!node) return;
      const bottom = node.getBoundingClientRect().bottom;
      setHeaderShown(bottom < 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landing">
      <StickyAccountHeader shown={headerShown && !props.signedIn} />
      <section style={{ minHeight: "100vh", display: "flex", alignItems: "center" }}>
        <HeroWireframe />
        <div className="container">
          <div className="hero">
            <div className="hero-copy">
              <div className="word-mark">
                CORBEL<span className="wordmark-text">&nbsp;Works</span>
              </div>
              <h1>
                Draw the plan.
                <br />
                Review the live sheet.
              </h1>
              <p className="hero-sub">Command-line drafting and safe client markup in one browser tab.</p>
              <div ref={buttonsRef} className="hero-actions">
                <a className="btn btn-filled" href="/signup">
                  Start drafting
                </a>
                <a className="btn btn-outline" href="/open">
                  Open a shared drawing
                </a>
              </div>
              <p className="hero-fine">
                Free trial, no card needed. Already drafting with us? <a href="/signin">Sign in</a>
              </p>
            </div>
            <div className="device-preview">
              <DevicePreview />
            </div>
          </div>
        </div>
      </section>

      <section className="capability-band">
        <div className="container">
          <div className="capability">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5a6068" aria-hidden="true">
              <path d="M4 20 L4 4 M4 4 L20 4 M8 20 L8 10 M12 20 L12 14 M16 20 L16 8" />
            </svg>
            <div>
              <h3>Command line first</h3>
              <p>Every alias you already type, with object snaps and exact coordinates from the keyboard.</p>
            </div>
          </div>
          <div className="capability">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5a6068" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" />
              <path d="M7 12 C9 10 11 14 13 12 C15 10 17 14 19 12" />
            </svg>
            <div>
              <h3>Markup that can't move a wall</h3>
              <p>Reviewers circle and comment on a trace that never touches the base geometry.</p>
            </div>
          </div>
          <div className="capability">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5a6068" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12 L21 12 M12 3 A 14 14 0 0 1 12 21" />
            </svg>
            <div>
              <h3>The same sheet everywhere</h3>
              <p>One live version, on the studio desktop, a laptop and a phone in the field.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="split-section" style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: "20%", opacity: 0.9 }} aria-hidden="true">
          <Constellation id="demo-left" />
        </div>
        <div className="container" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", alignItems: "center", width: "80vw", margin: "0 auto" }}>
          <div className="media-frame">
            <svg viewBox="0 0 300 240" style={{ flex: 1, width: "100%" }} aria-hidden="true">
              <DemoPlan />
            </svg>
          </div>
          <div>
            <h2>
              Every stroke lands where you typed it.
              <br />
              Offsets, trims and dimensions land too.
              <br />
              Nothing redraws by hand.
              <br />
              Nothing drifts out of revision.
            </h2>
            <p>The plan draws, offsets and trims itself the way you would, in one pass.</p>
            <p style={{ fontSize: "13.5px", color: "#a7adb5" }}>Try it in the browser below.</p>
            <button className="btn btn-outline" type="button" onClick={() => undefined}>
              Play drafting demo
            </button>
            <img src="/brand/demo.svg" alt="Drafting demo" style={{ display: "block", maxWidth: "100%", marginTop: 16, visibility: "hidden" }} />
          </div>
        </div>
      </section>

      <section style={{ position: "relative", padding: "90px 0" }}>
        <div className="slab-backdrop" aria-hidden="true">
          <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
            <polygon points="0,600 300,200 500,600" fill="#121416" stroke="#2a2e33" />
            <polygon points="400,600 700,150 900,600" fill="#17191c" stroke="#2a2e33" />
            <polygon points="700,600 1000,250 1200,600" fill="#101215" stroke="#2a2e33" />
            <line x1="300" y1="200" x2="700" y2="150" stroke="#ffffff" strokeWidth="1" opacity="0.5" />
            <line x1="700" y1="150" x2="1000" y2="250" stroke="#ffffff" strokeWidth="1" opacity="0.4" />
            <line x1="0" y1="300" x2="1200" y2="120" stroke="#ff2f6d" strokeWidth="2" opacity="0.85" />
          </svg>
        </div>
        <div className="container" style={{ position: "relative", zIndex: 2 }}>
          <div style={{ position: "absolute", left: "-40px", top: "-60px" }} aria-hidden="true">
            <Constellation id="preview-tl" />
          </div>
          <h2>A full command set, in the browser you already have.</h2>
          <p>Draw, dimension and issue sheets from a keyboard, a mouse or a phone.</p>
          <img src="/brand/editor-preview.svg" alt="Corbel Draft editor preview" style={{ maxWidth: "100%", marginTop: 24, border: "1px solid #2a2e33", borderRadius: 3 }} />
        </div>
      </section>

      <section style={{ position: "relative", minHeight: "80vh", display: "flex", alignItems: "center" }}>
        <div className="wireframe" aria-hidden="true">
          <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
            <WirePath d="M 100 520 Q 500 400 900 520" index={0} reduced={false} />
            <WirePath d="M 100 480 Q 500 360 900 480" index={1} reduced={false} />
            <WirePath d="M 180 520 Q 500 410 820 520" index={2} reduced={false} />
            <WirePath d="M 260 520 Q 500 430 740 520" index={3} reduced={false} />
            <WirePath d="M 100 520 L 500 560 L 900 520" index={4} reduced={false} />
          </svg>
        </div>
        <div className="container">
          <div className="callout-card">
            <h2>
              Issue the sheet set.
              <br />
              Keep every markup on the right revision.
            </h2>
            <svg width="72" height="72" viewBox="0 0 72 72" style={{ position: "absolute", top: -28, right: -20 }} aria-hidden="true">
              <rect x="6" y="18" width="54" height="50" fill="#1b3f8f" />
              <path d="M 12 30 L 54 30 M 12 44 L 54 44 M 12 58 L 40 58" stroke="#ffffff" strokeWidth="1" fill="none" />
              <path d="M 60 18 L 60 68 L 34 68 Z" fill="#f2c230" />
              <path d="M 46 4 L 46 18 L 60 18" fill="none" stroke="#5a6068" strokeWidth="1" />
            </svg>
          </div>
        </div>
      </section>

      <footer className="studio-footer" style={{ position: "relative" }}>
        <div className="container">
          <div className="footer-links">
            <a href="/reference.html">Command reference</a>
            <a href="/open">Open a shared drawing</a>
            <div className="copyright">© 2026 Corbel Works</div>
          </div>
          <div aria-hidden="true">
            <Constellation id="footer" />
          </div>
        </div>
      </footer>
    </div>
  );
}

function DemoPlan(): JSX.Element {
  const [step, setStep] = useState(0);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (reduced) {
      setStep(3);
      return;
    }
    const timers = [300, 900, 1500].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [reduced]);
  const outer = "M 40 40 L 260 40 L 260 200 L 40 200 Z";
  const inner = "M 52 52 L 248 52 L 248 188 L 52 188 Z";
  return (
    <g stroke="#a7adb5" fill="none" strokeWidth="1">
      {step >= 0 && <path d="M 40 40 L 260 40" stroke="#7ad7e8" />}
      {step >= 1 && <path d="M 260 40 L 260 200 L 40 200 L 40 40" stroke="#7ad7e8" />}
      {step >= 2 && <path d={inner} />}
      {step >= 3 && <path d="M 52 52 L 248 188 M 248 52 L 52 188" strokeDasharray="4 4" />}
      <path d={outer} opacity={0.35} />
      {step >= 1 && <rect x={260 - 4} y={40 - 4} width="8" height="8" fill="#ff2f6d" stroke="none" />}
    </g>
  );
}
