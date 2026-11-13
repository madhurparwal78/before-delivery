import { useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { createLanding, type LandingScene } from "../stage/landing";

const SECTION = 1000;
const STORY = 3000;
const TOOLBAR_FROM = 0.8;
const TOOLBAR_FULL = 0.9;

const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scroll progress over the first 3000 px; under reduced motion it holds still at each section's key frame. */
function progressAt(scroll: number, still: boolean): number {
  if (still) return Math.min(Math.floor(Math.max(scroll, 0) / SECTION), 3) / 3;
  return Math.min(Math.max(scroll / STORY, 0), 1);
}

function StillPicture(): JSX.Element {
  return (
    <svg className="landing-still" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="1200" height="700" fill="#87ceeb" />
      <rect y="360" width="1200" height="340" fill="#3b8a36" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <path key={i} d={`M${i * 150 - 120} 700 L${540 + (i - 4) * 12} 360`} stroke="#1e1e2e" strokeOpacity="0.1" fill="none" />
      ))}
      {[400, 450, 520, 600, 690].map((y) => (
        <path key={y} d={`M0 ${y} H1200`} stroke="#1e1e2e" strokeOpacity="0.1" />
      ))}
      <path d="M180 560 L560 560 L180 300 Z" fill="#b98a55" stroke="#8d6238" strokeWidth="4" />
      <g transform="translate(240 330) rotate(34)">
        <rect x="-30" y="-26" width="60" height="22" rx="11" fill="#f28b5e" />
        <rect x="-26" y="-8" width="14" height="10" rx="5" fill="#4a4e5c" />
        <rect x="12" y="-8" width="14" height="10" rx="5" fill="#4a4e5c" />
      </g>
      <path d="M800 560 V300 M960 560 V300 M780 300 H980" stroke="#4a4e5c" strokeWidth="9" strokeLinecap="round" />
      <path d="M880 300 L820 470" stroke="#4a4e5c" strokeWidth="4" />
      <circle cx="816" cy="480" r="26" fill="#ef5f7a" />
    </svg>
  );
}

export function Landing(): JSX.Element {
  const stageBox = useRef<HTMLDivElement>(null);
  const scene = useRef<LandingScene | null>(null);
  const [progress, setProgress] = useState(0);
  const [webgl, setWebgl] = useState(true);
  const still = useRef(reduced());

  useEffect(() => {
    const created = createLanding(stageBox.current as HTMLDivElement);
    if (!created) setWebgl(false);
    scene.current = created;
    let raf = 0;
    let shown = -1;
    const read = (): void => {
      const next = progressAt(window.scrollY, still.current);
      if (next !== shown) {
        shown = next;
        setProgress(next);
        scene.current?.draw(next);
      }
    };
    const loop = (): void => {
      read();
      raf = requestAnimationFrame(loop);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", read);
      created?.dispose();
    };
  }, []);

  const toolbarOpacity = Math.min(Math.max((progress - TOOLBAR_FROM) / (TOOLBAR_FULL - TOOLBAR_FROM), 0), 1);
  return (
    <div className="landing">
      <div ref={stageBox} className="landing-stage" role="img" aria-label="Bench preview" data-progress={progress.toFixed(3)}>
        {!webgl ? <StillPicture /> : null}
      </div>
      <div className="landing-toolbar toolbar" role="toolbar" aria-label="Bench tools" style={{ opacity: toolbarOpacity, visibility: toolbarOpacity === 0 ? "hidden" : "visible" }}>
        <span className="chip run">Run</span>
        <span className="chip">Pause</span>
        <span className="chip">Step</span>
        <span className="divider" aria-hidden="true" />
        <span className="chip on">Move</span>
        <span className="chip">Rotate</span>
        <span className="chip">Scale</span>
        <span className="divider" aria-hidden="true" />
        <span className="chip">Snap</span>
        <span className="chip on">Grid</span>
        <span className="chip lilac">Publish</span>
        <span className="spacer" />
        <span className="wordmark">Rampwright</span>
      </div>
      <nav className="landing-nav" aria-label="Start">
        <Link href="/sign-in" className="chip">
          Sign in
        </Link>
        <Link href="/sign-up" className="chip primary">
          Start a bench
        </Link>
      </nav>
      <h1 className="landing-name">Rampwright</h1>
      <main className="landing-story">
        <section className="story-section" id="section-1">
          <div className="dock story-copy">
            <div className="dock-body">
              <p>A 3D physics bench for independent tutors: build ramps, pendulums and launchers, ask the what-if, and share a lab your students can play on a phone.</p>
            </div>
          </div>
        </section>
        <section className="story-section" id="section-2">
          <div className="dock story-copy">
            <div className="dock-head">
              <h2 className="dock-title story-title">Every number in metres, kilograms and seconds</h2>
            </div>
            <div className="dock-body">
              <p>Scenes are authored in real SI units. Type 2.5 kg, 250 cm or 30 deg and the readouts follow on every keystroke; imported models are measured through their own transforms.</p>
            </div>
          </div>
        </section>
        <section className="story-section" id="section-3">
          <div className="dock story-copy">
            <div className="dock-head">
              <h2 className="dock-title story-title">The same run on every student&apos;s screen</h2>
            </div>
            <div className="dock-body">
              <p>The bench steps at exactly 1/120 second whatever the frame rate, so a phone, a laptop and the server agree on the state hash after the same number of steps.</p>
            </div>
          </div>
        </section>
        <section className="story-section last" id="section-4">
          <div className="dock story-copy">
            <div className="dock-head">
              <h2 className="dock-title story-title">Stop, and the bench is exactly as you left it</h2>
            </div>
            <div className="dock-body">
              <p>A run never edits the scene. Stop returns every object and panel to where it was, and checkpoints keep a snapshot you can restore byte for byte.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
