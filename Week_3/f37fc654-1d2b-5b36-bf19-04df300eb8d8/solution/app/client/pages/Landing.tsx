// `/` — the stage pinned behind a five-viewport track: scrolling scrubs the camera through five
// keyframes while the captions pass; then three recent case studies open as sheets.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CueLine } from "../components/CueLine";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/icons";
import { AppLink } from "../components/Shell";
import { prefersReduced } from "../lib/motion";
import { stage } from "../stage/state";
import { useScene } from "./common";

const HEADLINE = "Light for dark rooms, made to commission.";

const SECTIONS: { caption: string; note: string }[] = [
  { caption: "A wall that sees the room.", note: "Each piece watches its venue through a camera and answers with light, built for the people standing in front of it." },
  { caption: "It answers the people in front of it.", note: "Faces, voices and footsteps become motion on the wall, quietly, with no app to download and nothing to wear." },
  { caption: "Built for one venue, by hand.", note: "You brief the piece one question at a time over a model of your room, then place it to the quarter metre." },
  { caption: "Up close, it's light.", note: "Projection, LEDs and generative software, fabricated in the studio and tuned on site by the crew." },
  { caption: "In your room, on your day.", note: "Hold an install day in your venue's own calendar, pay the deposit, and follow every milestone in one place." },
];

interface CaseStudy {
  title: string;
  text: string;
  venue: string;
  drawing: ReactNode;
}

const CASES: CaseStudy[] = [
  {
    title: "Tidewall",
    venue: "Halsted Works Hall, Chicago",
    text: "A camera-reactive wall at Halsted Works Hall that turns passers-by into slow tides of light.",
    drawing: (
      <>
        <rect width="320" height="200" fill="#060a16" />
        <path d="M0 170 L320 140 L320 200 L0 200Z" fill="#0b1224" />
        <rect x="70" y="40" width="180" height="104" fill="#081428" stroke="#ffffff" strokeOpacity="0.7" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M70 ${54 + i * 16} C 110 ${46 + i * 16}, 150 ${66 + i * 16}, 190 ${54 + i * 16} S 240 ${48 + i * 16}, 250 ${56 + i * 16}`} stroke={i % 2 ? "#2271e3" : "#a8e6ff"} strokeOpacity={i % 2 ? 0.9 : 0.55} strokeWidth="3" fill="none" />
        ))}
        <circle cx="120" cy="170" r="5" fill="#a0a4ae" /><path d="M120 175v14" stroke="#a0a4ae" strokeWidth="2" />
        <circle cx="200" cy="166" r="5" fill="#a0a4ae" /><path d="M200 171v14" stroke="#a0a4ae" strokeWidth="2" />
      </>
    ),
  },
  {
    title: "Second Face",
    venue: "Brightwater Atrium, New York",
    text: "A generative portrait kiosk at Brightwater Atrium that draws each visitor as the person beside them sees them.",
    drawing: (
      <>
        <rect width="320" height="200" fill="#060a16" />
        <path d="M0 160 L320 175 L320 200 L0 200Z" fill="#0b1224" />
        <rect x="118" y="34" width="84" height="140" fill="#0a1020" stroke="#ffffff" strokeOpacity="0.7" />
        <rect x="128" y="46" width="64" height="70" fill="#081428" stroke="#2271e3" />
        <path d="M160 58c-12 0-18 10-17 22 1 10 7 20 17 20s16-10 17-20c1-12-5-22-17-22z" fill="none" stroke="#a8e6ff" strokeWidth="1.6" />
        <path d="M152 78h4M164 78h4M155 90c3 2 7 2 10 0" stroke="#a8e6ff" strokeWidth="1.4" fill="none" />
        <path d="M143 76c-6-14 4-26 17-26s23 12 17 26" fill="none" stroke="#c9a2f0" strokeWidth="1.2" strokeDasharray="3 3" />
        <rect x="136" y="128" width="48" height="8" fill="#2271e3" />
      </>
    ),
  },
  {
    title: "Echo Vault",
    venue: "Lantern Court Museum Lobby, Denver",
    text: "A voice-driven projection room at Lantern Court Museum Lobby where spoken words become falling constellations.",
    drawing: (
      <>
        <rect width="320" height="200" fill="#060a16" />
        <path d="M40 40 L280 40 L320 200 L0 200Z" fill="#081022" stroke="#ffffff" strokeOpacity="0.25" />
        {[[80, 60], [120, 84], [150, 56], [190, 92], [230, 66], [104, 120], [170, 132], [214, 118], [250, 140], [136, 160]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 2 : 3.2} fill={i % 2 ? "#a8e6ff" : "#ffffff"} />
        ))}
        <path d="M80 60 L120 84 L150 56 L190 92 L230 66" stroke="#2271e3" strokeWidth="1.2" fill="none" />
        <path d="M104 120 L170 132 L214 118 L250 140" stroke="#2271e3" strokeWidth="1.2" fill="none" strokeOpacity="0.8" />
        <path d="M150 182 q10 -12 20 0" stroke="#c9a2f0" strokeWidth="1.5" fill="none" />
      </>
    ),
  },
];

function CaseSheet({ study, from, onClose }: { study: CaseStudy; from: DOMRect | null; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheet.current?.querySelector<HTMLElement>(".case-sheet");
    if (!el || !from || prefersReduced()) return;
    const box = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (box.left + box.width / 2);
    const dy = from.top + from.height / 2 - (box.top + box.height / 2);
    el.animate(
      [{ transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${from.width / box.width})`, opacity: 0.4 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 1 }],
      { duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }, [from]);
  const titleId = `case-${study.title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div ref={sheet}>
      <div className="sheet-scrim" onClick={onClose} />
      <Dialog label={study.title} labelledBy={titleId} className="case-sheet" onClose={onClose}>
        <svg viewBox="0 0 320 200" aria-hidden="true">{study.drawing}</svg>
        <div className="sheet-body">
          <p className="eyebrow">{study.venue}</p>
          <h2 id={titleId}>{study.title}</h2>
          <p>{study.text}</p>
        </div>
        <div className="close-row">
          <button type="button" className="button graphite" onClick={onClose}><Icon name="x" /> Close case study</button>
        </div>
      </Dialog>
    </div>
  );
}

export function Landing() {
  useScene("landing");
  const [open, setOpen] = useState<{ study: CaseStudy; from: DOMRect | null } | null>(null);

  useEffect(() => {
    const onScroll = (): void => stage.set({ scroll: Math.max(0, Math.min(4, scrollY / innerHeight)) });
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      stage.set({ scroll: 0 });
    };
  }, []);

  return (
    <main className="landing">
      <div className="track">
        {SECTIONS.map((section, i) => (
          <section key={section.caption} className="track-section">
            <div className="caption-box">
              {i === 0 && <CueLine text={HEADLINE} cursor className="hero-line" />}
              <h2 className="caption">{section.caption}</h2>
              <p className="caption-note">{section.note}</p>
              {i === 0 && (
                <div className="hero-actions">
                  <AppLink href="/brief/new?step=1" className="button primary">Start a commission <Icon name="arrowRight" /></AppLink>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="recent" aria-labelledby="recent-title">
        <h2 id="recent-title">Recent commissions</h2>
        <div className="cards">
          {CASES.map((study) => (
            <button key={study.title} type="button" className="card" onClick={(event) => setOpen({ study, from: event.currentTarget.getBoundingClientRect() })}>
              <svg viewBox="0 0 320 200" aria-hidden="true">{study.drawing}</svg>
              <span className="card-body">
                <span className="card-title">{study.title}</span>
                <span className="card-text">{study.text}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      {open && <CaseSheet study={open.study} from={open.from} onClose={() => setOpen(null)} />}
    </main>
  );
}
