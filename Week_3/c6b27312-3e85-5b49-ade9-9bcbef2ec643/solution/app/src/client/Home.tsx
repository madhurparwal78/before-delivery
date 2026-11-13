// Home (DP-55, DP-56): the hero that measures its own headline, the statement column and the gallery.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ManifestEntry, PartJson } from "../shared/api";
import { NNBSP, display, roundHalfEven, volumeText } from "../shared/numbers";
import { poseOfSolid, type Pose } from "../shared/tine";
import { get } from "./api";
import { PageHeading } from "./chrome";
import { Spin } from "./controls";
import { useEvaluation } from "./evalMachine";
import { Gallery } from "./Gallery";
import { useMedia } from "./hooks";
import { Icon, SeverityIcon } from "./icons";
import { useSession } from "./session";
import { AccountLinks, Link } from "./shell";
import { Viewport } from "./viewport/Viewport";

const MM_PER_PX = 0.2645833;
const STILL_MS = 200;
const HEADLINE = "Parts that fit the thing you measured.";

export function Home() {
  return (
    <>
      <Hero />
      <Statements />
      <Gallery />
    </>
  );
}

/** The hero frames the clip closer than a part page does: the fragment is small. */
function closer(pose: Pose): Pose {
  const [tx, ty, tz] = pose.target;
  const pull = (v: number, t: number) => t + (v - t) * 0.7;
  return { ...pose, position: [pull(pose.position[0], tx), pull(pose.position[1], ty), pull(pose.position[2], tz)] };
}

function Hero() {
  const { config, ready } = useSession();
  const wide = useMedia("(min-width: 1024px)");
  const headline = useRef<HTMLHeadingElement>(null);
  const [entry, setEntry] = useState<ManifestEntry | null>(null);
  const [span, setSpan] = useState<number | null>(null);
  const [mode, setMode] = useState<"headline" | "hand">("headline");
  const defaultPose = useRef<Pose | null>(null);
  const started = useRef(false);
  const viewerId = useMemo(() => crypto.randomUUID(), []);
  const evaluation = useEvaluation({
    partSlug: "hero-cable-clip",
    viewerId,
    debounceMs: config?.evalDebounceMs ?? 0,
    slowMs: config?.slowEvalNoticeMs ?? 0,
  });

  useEffect(() => {
    void get<PartJson>("/api/parts/hero-cable-clip").then((reply) => reply.ok && setEntry(reply.data.manifest.find((m) => m.name === "span") ?? null));
  }, []);

  useEffect(() => {
    if (!entry) return;
    const lo = entry.min ?? 0;
    const hi = entry.max ?? Number.POSITIVE_INFINITY;
    const measure = () => {
      const width = headline.current?.getBoundingClientRect().width ?? 0;
      const next = Math.min(hi, Math.max(lo, roundHalfEven(width * MM_PER_PX, 3)));
      setSpan(next);
      setMode("headline");
      if (started.current) evaluation.commit({ span: next });
      else {
        started.current = true;
        evaluation.start({ span: next });
      }
    };
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive && headline.current) measure();
    });
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, STILL_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
    // The measurement reads the headline and the evaluation controller, both stable for this page.
  }, [entry]);

  const drawn = evaluation.view.drawn;
  if (drawn && !defaultPose.current) defaultPose.current = closer(poseOfSolid(drawn.solid));
  const scene = useMemo(() => (drawn ? { key: `hero:${drawn.digest}`, solid: drawn.solid } : null), [drawn]);

  return (
    <section className="hero" aria-label="Gimbrel Works">
      <div className="hero-left">
        <Link to="/" className="brand">
          <Icon name="mark" size={22} />
          <span>Gimbrel Works</span>
        </Link>
        <div className="hero-copy">
          <PageHeading className="hero-headline">
            <span ref={headline} className="headline-text">
              {HEADLINE}
            </span>
          </PageHeading>
          <p className="lede muted">Open a shared part, set it to your measurements and check it against your printer or mill before you spend filament.</p>
          <a
            className="button light"
            href="#gallery"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("gallery")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Open the gallery
          </a>
        </div>
      </div>
      <div className="hero-right">
        {/* Right-anchored: mounted once the session is known, so it never changes width under the reader (CLS). */}
        {ready ? (
          <nav className="hero-account" aria-label="Account">
            <AccountLinks />
          </nav>
        ) : null}
        <div className="hero-fragment">
          <div data-ui="hero-viewport" className="hero-viewport">
            <Viewport attrs={{}} scene={scene} defaultPose={defaultPose.current} toolbar={false} dot={wide ? 14 : 10} onFadeEnd={evaluation.fadeEnd} />
          </div>
          {/* The row keeps its height before the part loads, so its arrival moves nothing (CLS). */}
          <div className="dimension-row">
            {entry && span !== null && ready ? (
              <>
              <Spin
                entry={entry}
                value={span}
                units="mm"
                modified={false}
                bare
                onCommit={(value) => {
                  setSpan(value);
                  setMode("hand");
                  evaluation.commit({ span: value });
                }}
              />
              <p className="hero-readout muted" data-ui="hero-readout">
                {`span ${display(span, 2)}${NNBSP}mm · ${mode === "headline" ? "measured from the headline" : "set by hand"}`}
              </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- statements

const FINDINGS = [
  ["Blocking", "Blocking", "Hole 1 is 8× deeper than its diameter; Three-axis mill allows at most 6×."],
  ["Advisory", "Advisory", `Wall beside Hole 2 is 1.2${NNBSP}mm; Three-axis mill needs at least 1.5${NNBSP}mm.`],
  ["Pass", "Pass", "Every check passed for FDM print."],
] as const;

function FindingRows({ count }: { count: number }) {
  return (
    <ul className="frag-findings">
      {FINDINGS.slice(0, count).map(([icon, word, text]) => (
        <li key={word} className={`finding sev-${word.toLowerCase()}`}>
          <span className="sev-icon">
            <SeverityIcon severity={icon} />
          </span>
          <span className="sev-word">{word}</span>
          <span className="sev-text">{text}</span>
        </li>
      ))}
    </ul>
  );
}

function TapeStrip({ at }: { at: number }) {
  return (
    <div className="frag-tape" aria-hidden="true">
      <span className="tape-rail" />
      {Array.from({ length: 13 }, (_, i) => (
        <span key={i} className={`tick${i <= at ? " tick-done" : ""}`} style={{ left: `calc(10px + (100% - 20px) * ${i / 12})` }} />
      ))}
      <span className="playhead" style={{ left: `calc(10px + (100% - 20px) * ${at / 12})` }} />
    </div>
  );
}

function ClipDrawing({ span, step }: { span: number; step: number }) {
  const w = 40 + (span - 40) * 0.55;
  return (
    <svg className="clip-drawing" viewBox="0 0 320 150" role="img" aria-label="Cable clip drawing">
      <g transform="translate(160 78)" fill="none" stroke="var(--accent)" strokeWidth="1.5">
        <path d={`M${-w / 2} 8 l14 -18 h${w} l-14 18z`} fill="color-mix(in srgb, var(--accent) 16%, transparent)" />
        <path d={`M${-w / 2} 8 h${w} v14 h${-w}z M${w / 2} 8 l14 -18 v14 l-14 18`} />
        <ellipse cx={-w / 2 + 14} cy="15" rx="4" ry="2.6" />
        <ellipse cx={w / 2 - 14} cy="15" rx="4" ry="2.6" />
      </g>
      <g stroke="var(--muted)" strokeWidth="1" fill="none">
        <path d={`M${160 - w / 2} 118h${w}M${160 - w / 2} 112v12M${160 + w / 2} 112v12`} />
      </g>
      {step >= 2 ? <circle cx="150" cy="88" r="5" fill="none" stroke="var(--blocking)" strokeWidth="1.5" /> : null}
    </svg>
  );
}

function Fragment({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="fragment" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function Statements() {
  const wide = useMedia("(min-width: 1024px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const pinned = wide && !reduced;
  const section = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!pinned) return;
    const update = () => {
      const el = section.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, -rect.top / travel)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pinned]);

  const step = progress < 1 / 3 ? 1 : progress < 2 / 3 ? 2 : 3;
  const local = Math.min(1, Math.max(0, progress * 3 - (step - 1)));
  const span = step === 1 ? 84.67 + (96 - 84.67) * local : 96;
  const playhead = step === 3 ? Math.round(local * 12) : 0;
  const end = !pinned && wide;

  const first = (
    <>
      <Statement title="Change a dimension." line="The solid rebuilds where you are looking." active={step === 1} />
      <Statement title="Run pre-flight." line="Thin walls and deep holes show before you print." active={step === 2} />
      <Statement title="Scrub the tape." line="See which operation made each wall." active={step === 3} />
    </>
  );

  return (
    <div className="statements">
      {pinned ? (
        <section ref={section} className="pin-section" aria-label="How Tinework works">
          <div className="pin-stage">
            <div className="pin-copy">{first}</div>
            <div className="pin-fragment" data-ui="pinned-fragment" data-step={step}>
              <ClipDrawing span={span} step={step} />
              <div className="frag-field">
                <span>Span</span>
                <strong>{`${display(span, 2)}${NNBSP}mm`}</strong>
              </div>
              <div className={step >= 2 ? "frag-reveal on" : "frag-reveal"}>
                <FindingRows count={3} />
              </div>
              <TapeStrip at={playhead} />
            </div>
          </div>
        </section>
      ) : (
        <>
          <Row title="Change a dimension." line="The solid rebuilds where you are looking.">
            <Fragment label="Dimension field">
              <div className="frag-field">
                <span>Width</span>
                <strong>{`72.5${NNBSP}mm`}</strong>
                <span className="unit-toggle">
                  <b>mm</b>
                  <i>in</i>
                </span>
              </div>
              <span className="was">{`was 60.0${NNBSP}mm`}</span>
            </Fragment>
          </Row>
          <Row title="Run pre-flight." line="Thin walls and deep holes show before you print.">
            <Fragment label="Pre-flight findings">
              <FindingRows count={3} />
            </Fragment>
          </Row>
          <Row title="Scrub the tape." line="See which operation made each wall.">
            <Fragment label="Build tape">
              <TapeStrip at={end ? 12 : 8} />
            </Fragment>
          </Row>
        </>
      )}
      <Row title="Compare revisions." line="Added material lit, removed material ghosted.">
        <Fragment label="Revision compare">
          <svg viewBox="0 0 200 70" className="swatch" role="img" aria-label="Compare swatch">
            <rect x="10" y="14" width="120" height="40" className="swatch-base" />
            <rect x="130" y="14" width="40" height="40" className="swatch-added" />
            <rect x="10" y="14" width="26" height="40" className="swatch-ghost" />
          </svg>
          <p className="muted small">{`Added ${volumeText(320)} · Removed ${volumeText(0)}`}</p>
        </Fragment>
      </Row>
      <Row title="Pin a comment." line="Talk about the exact view, not a screenshot.">
        <Fragment label="Pinned comment">
          <div className="frag-comment">
            <span className="pin pin-comment pin-static" aria-hidden="true" />
            <p>The wall beside Hole 1 looks thin.</p>
            <p className="muted small">Anchored to this view of r2</p>
          </div>
        </Fragment>
      </Row>
    </div>
  );
}

function Statement({ title, line, active = true }: { title: string; line: string; active?: boolean }) {
  return (
    <p className={active ? "statement" : "statement dormant"}>
      <strong>{title}</strong>
      <span>{` ${line}`}</span>
    </p>
  );
}

function Row({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <article className="statement-row">
      <Statement title={title} line={line} />
      {children}
    </article>
  );
}
