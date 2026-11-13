// Home: Hero, Work (grid, or the card deck below 768), Services, Process, Studio (team, client marquee), Insights.
import { useEffect, useRef, useState } from "preact/hooks";
import type { CaseStudy, Content, Service } from "../api";
import { Shell } from "../components/Shell";
import { HeroScene, isReturning, ProcessScene, ShotObject, startHandoff, StationStill, SubjectView } from "../components/Scenes";
import { cachedContent, loadContent } from "../content";
import { easeOutLong, reducedMotion, useMedia } from "../motion";
import { formatMoney } from "../../shared/money";

const STAGES = ["01 Quote", "02 Deposit", "03 Look-dev review", "04 Final review", "05 Delivered"];
const STAGE_NOTES = [
  "Pick shots on your own model; the quote updates as you go.",
  "Forty percent locks the rate, the shot list and the schedule.",
  "Look-dev stills for every shot, with two revision rounds included.",
  "Final stills once the look-dev invoice is paid.",
  "Delivery, with the last invoice closing the quote exactly.",
];

function Hero() {
  const region = useRef<HTMLElement>(null);
  return (
    <section class="hero" aria-label="Hero" ref={region} data-scrub-progress="0.000">
      <div class="hero-track">
        <div class="hero-pin wrap">
          <div class="hero-copy">
            <span class="eyebrow">Gloamwork CGI studio</span>
            <h1>Your CAD, lit like a launch.</h1>
            <p>Stills, turntables and exploded views rendered from your own CAD, checked for scale before a single light is placed.</p>
            <a class="button primary" href="/start">
              Start a project
            </a>
          </div>
          <HeroScene region={region} />
        </div>
      </div>
    </section>
  );
}

function Tile({ study }: { study: CaseStudy }) {
  return (
    <li class="case-tile">
      <a
        href={`/work/${study.slug}`}
        onClick={(event) => {
          const subject = (event.currentTarget as HTMLElement).querySelector("[data-scene]");
          if (subject) startHandoff(study.slug, subject.getBoundingClientRect());
        }}
      >
        <SubjectView study={study} kind="tile" class="tile-scene" />
        <h3>{study.title}</h3>
        <p>{study.client}</p>
      </a>
    </li>
  );
}

const DECK_MS = 450;
const FLING = 0.5;
const LONG_DRAG = 120;

/** Below 768: published case studies as a 3D card deck; only the front card is exposed. */
function Deck({ studies }: { studies: CaseStudy[] }) {
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moves: { x: number; t: number }[]; horizontal: boolean | null } | null>(null);
  const offset = useRef(0);
  const anim = useRef<{ from: number; at: number } | null>(null);

  const go = (next: number, focus: boolean): void => {
    const clamped = Math.max(0, Math.min(studies.length - 1, next));
    anim.current = { from: offset.current + (clamped - index) * 340, at: performance.now() };
    if (clamped === index) anim.current = { from: offset.current, at: performance.now() };
    offset.current = 0;
    setIndex(clamped);
    if (focus) requestAnimationFrame(() => list.current?.querySelector<HTMLAnchorElement>("a")?.focus());
  };

  useEffect(() => {
    const reduced = reducedMotion();
    let frame = 0;
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const cards = list.current?.querySelectorAll<HTMLElement>(".deck-card");
      if (!cards) return;
      let shift = offset.current;
      if (anim.current && !reduced) {
        const t = (performance.now() - anim.current.at) / DECK_MS;
        shift = t >= 1 ? 0 : anim.current.from * (1 - easeOutLong(t));
        if (t >= 1) anim.current = null;
      } else if (reduced) anim.current = null;
      cards.forEach((card) => {
        const depth = Number(card.dataset.depth);
        const x = depth === 0 ? shift : depth * 14;
        card.style.transform = `translate3d(${x}px, ${depth * 10}px, ${-depth * 40}px) rotateY(${depth === 0 ? shift / 30 : 0}deg)`;
        card.style.zIndex = String(10 - depth);
      });
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  const onDown = (event: PointerEvent): void => {
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moves: [{ x: event.clientX, t: performance.now() }], horizontal: null };
  };
  const onMove = (event: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (d.horizontal === null && Math.hypot(dx, dy) > 6) d.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!d.horizontal) return;
    d.moves.push({ x: event.clientX, t: performance.now() });
    offset.current = dx;
    anim.current = null;
  };
  const onUp = (event: PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== event.pointerId || !d.horizontal) return;
    const now = performance.now();
    const recent = d.moves.filter((m) => now - m.t <= 100);
    const first = recent[0] ?? d.moves[d.moves.length - 2] ?? d.moves[0];
    const last = d.moves[d.moves.length - 1];
    const speed = first && last ? Math.abs(last.x - first.x) / Math.max(1, last.t - first.t) : 0;
    const travel = (last?.x ?? d.x) - d.x;
    const advance = speed > FLING || Math.abs(travel) >= LONG_DRAG;
    if (advance) go(index + (travel < 0 ? 1 : -1), false);
    else go(index, false);
  };

  return (
    <>
      <ul class="deck" aria-label="Case studies" data-deck-index={String(index + 1)} ref={list} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => go(index, false)}>
        {studies.slice(index, index + 3).map((study, depth) => (
          <li key={study.slug} class="deck-card" data-depth={depth} aria-hidden={depth ? "true" : undefined} inert={depth > 0}>
            {depth === 0 ? (
              <a
                href={`/work/${study.slug}`}
                draggable={false}
                onClick={(event) => {
                  const subject = (event.currentTarget as HTMLElement).querySelector("[data-scene]");
                  if (subject) startHandoff(study.slug, subject.getBoundingClientRect());
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    go(index + 1, true);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    go(index - 1, true);
                  }
                }}
              >
                <SubjectView study={study} kind="tile" class="tile-scene" />
                <h3>{study.title}</h3>
                <p class="muted">{study.client}</p>
              </a>
            ) : (
              <div>
                <h3>{study.title}</h3>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p class="deck-hint">
        {index + 1} of {studies.length}. Swipe or use the arrow keys.
      </p>
    </>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const row = useRef<HTMLTableRowElement>(null);
  return (
    <tr ref={row}>
      <td>
        <div class="shot-cell">
          <ShotObject code={service.code} row={row} />
          <a href="/start">{service.title}</a>
        </div>
      </td>
      <td class="num">{formatMoney(service.list_price_pence, "GBP")}</td>
    </tr>
  );
}

function Process() {
  const region = useRef<HTMLElement>(null);
  const reduced = reducedMotion();
  const [step, setStep] = useState(1);
  const progress = (): number => {
    const box = region.current?.getBoundingClientRect();
    if (!box) return 0;
    const span = box.height - window.innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, -box.top / span)) : 0;
  };
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const update = (): void => {
      const next = Math.min(5, 1 + Math.floor(progress() * 5));
      if (region.current && region.current.dataset.processStep !== String(next)) {
        region.current.dataset.processStep = String(next);
        setStep(next);
      }
    };
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      update();
    };
    tick();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, []);
  if (reduced) {
    return (
      <section class="home-section process wrap" aria-label="Process" data-process-step="all" ref={region}>
        <span class="eyebrow">How it works</span>
        <h2 class="display-2">How a commission runs</h2>
        <ol class="process-list" aria-label="Process stages">
          {STAGES.map((stage, i) => (
            <li key={stage}>
              <StationStill index={i} label={stage} />
              <h3>{stage}</h3>
              <p class="muted">{STAGE_NOTES[i]}</p>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <section class="home-section process" aria-label="Process" data-process-step="1" ref={region} style={{ height: "500vh" }}>
      <div class="process-pin wrap">
        <div class="process-copy">
          <span class="eyebrow">How it works</span>
          <h2>How a commission runs</h2>
          <ol class="stages" aria-label="Process stages">
            {STAGES.map((stage, i) => (
              <li key={stage} aria-current={step === i + 1 ? "step" : undefined}>
                {stage}
              </li>
            ))}
          </ol>
          <p class="muted">{STAGE_NOTES[step - 1]}</p>
        </div>
        <ProcessScene progress={progress} />
      </div>
    </section>
  );
}

function Clients({ names }: { names: string[] }) {
  const [paused, setPaused] = useState(false);
  return (
    <section class="clients" aria-label="Clients" data-paused={String(paused)}>
      <button type="button" class="button" aria-pressed={paused ? "true" : "false"} onClick={() => setPaused(!paused)}>
        {paused ? "Play client names" : "Pause client names"}
      </button>
      <div class="marquee-viewport">
        <div class="marquee-track">
          {names.map((name) => (
            <span key={name}>{name}</span>
          ))}
          {names.map((name) => (
            <span key={`again-${name}`} aria-hidden="true">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Home({ hash }: { hash: string }) {
  const [content, setContent] = useState<Content | null>(cachedContent());
  const [failure, setFailure] = useState("");
  const phone = useMedia("(max-width: 767.98px)");
  const returning = useRef(isReturning());
  useEffect(() => {
    void loadContent().then((result) => ("case_studies" in result ? setContent(result) : setFailure(result.message)));
  }, []);
  useEffect(() => {
    if (!content) return;
    const target = returning.current ? "work" : hash ? decodeURIComponent(hash.slice(1)) : "";
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [content, hash]);
  return (
    <Shell search>
      <Hero />
      {failure && (
        <p class="wrap notice" role="status">
          {failure}
        </p>
      )}
      {content && (
        <>
          <section id="work" class="home-section wrap" aria-labelledby="work-title">
            <div class="section-grid">
              <div class="section-head">
                <span class="eyebrow">01 Work</span>
                <h2 id="work-title" class="display-2">
                  Recent work
                </h2>
              </div>
              <div class="section-body">
                {phone ? (
                  <Deck studies={content.case_studies} />
                ) : (
                  <ul class="case-grid" aria-label="Case studies">
                    {content.case_studies.map((study) => (
                      <Tile key={study.slug} study={study} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
          <section id="services" class="home-section wrap" aria-labelledby="services-title">
            <div class="section-grid">
              <div class="section-head">
                <span class="eyebrow">02 Services</span>
                <h2 id="services-title" class="display-2">
                  Shots and prices
                </h2>
              </div>
              <div class="section-body">
                <table class="price-table" aria-label="Shot prices">
                  <thead>
                    <tr>
                      <th scope="col">Shot</th>
                      <th scope="col" class="num">
                        Price per colourway
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {content.services.map((service) => (
                      <ServiceRow key={service.code} service={service} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          <Process />
          <section id="studio" class="home-section wrap" aria-labelledby="studio-title">
            <div class="section-grid">
              <div class="section-head">
                <span class="eyebrow">03 Studio</span>
                <h2 id="studio-title" class="display-2">
                  One studio, one artist
                </h2>
              </div>
              <div class="section-body">
                {content.team.map((member) => (
                  <article key={member.name} class="team-card">
                    <h3>{member.name}</h3>
                    <p class="muted">{member.role}</p>
                    <p>{member.bio}</p>
                  </article>
                ))}
              </div>
            </div>
            <Clients names={content.marquee} />
          </section>
          <section id="insights" class="home-section wrap" aria-labelledby="insights-title">
            <div class="section-grid">
              <div class="section-head">
                <span class="eyebrow">04 Insights</span>
                <h2 id="insights-title" class="display-2">
                  Notes from the studio
                </h2>
              </div>
              <div class="section-body">
                <ul class="insight-grid">
                  {content.insights.map((insight) => (
                    <li key={insight.slug} id={`insight-${insight.slug}`}>
                      <h3>{insight.title}</h3>
                      <p>{insight.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
          <section class="home-section wrap">
            <div class="section-grid">
              <div class="section-head">
                <span class="eyebrow">05 Start a project</span>
              </div>
              <div class="section-body">
                <h2 class="display-2">Send us your CAD.</h2>
                <p>Upload a GLB, check its scale on the plinth, choose your shots and see the quote as you go.</p>
                <a class="button primary" href="/start">
                  Start your project
                </a>
              </div>
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}
