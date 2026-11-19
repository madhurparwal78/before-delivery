import { useEffect, useRef, useState, type FormEvent } from "react";
import { seedHash, seedUniform } from "../../shared/rules";
import { api, type Gallery, type Piece } from "../api";
import { EditionStage } from "../components/EditionStage";
import { LiveCanvas } from "../components/LiveCanvas";
import { PieceCard } from "../components/PieceCard";
import { PlanList } from "../components/PlanList";
import { Icon, LiveStatus, PixelPanel, Reveal, useAnnouncer, type AssistantState } from "../components/ui";
import { copy } from "../copy";
import { Link, navigate, signInHref, useLocation } from "../router";
import { useReducedMotion, useSession } from "../session";

const VERBS = ["Describe.", "Tune.", "Keyframe.", "Number.", "Settle."];
const VERB_MS = 3000;
const TYPE_MS = 40;
const KEPT_PROMPT = "phosphene-yard:prompt";
const FEATURED_START = 14;

export function Landing() {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  useEffect(() => {
    void api<Gallery>("GET", "/api/gallery").then((result) => result.ok && setGallery(result.data));
  }, []);
  const featured = gallery?.featured ?? null;
  const runs = gallery?.sections.find((s) => s.id === "runs")?.pieces.slice(0, 3) ?? [];
  return (
    <>
      <Hero gallery={gallery} />
      <section className="landing-section" aria-labelledby="s01">
        <SectionIntro number="01" name="Gallery" id="s01" headline={["Pieces that", "keep running."]}
          text="Every card is the piece itself, playing live. Runs stay open until their last number settles."
          link={{ to: "/gallery", label: "Browse the gallery" }} />
        <div className="card-row">
          {runs.map((card, i) => (
            <Reveal key={card.slug} delay={i * 100}>
              <PieceCard card={card} />
            </Reveal>
          ))}
        </div>
      </section>
      <section className="landing-section" aria-labelledby="s02">
        <SectionIntro number="02" name="Studio" id="s02" headline={["Tune it by", "hand."]}
          text="The assistant drafts a shader from a sentence. Faders, keyframes and exports are yours." />
        <div className="studio-split">
          <div className="studio-panel">
            <AssistantOnLanding />
          </div>
          <Reveal delay={100}>
            <PlanList compact />
          </Reveal>
        </div>
      </section>
      <section className="landing-section" aria-labelledby="s03">
        <SectionIntro number="03" name="Editions" id="s03" headline={["Every number is", "its own frame."]}
          text="Each edition carries its own seed, so number 7 never looks like number 8. Collectors choose the frame they want."
          link={featured ? { to: `/pieces/${featured.slug}`, label: "How editions settle" } : { to: "/gallery", label: "How editions settle" }} />
        {featured ? <EditionFrames slug={featured.slug} count={featured.edition_count} /> : null}
      </section>
      <ClosingBand />
    </>
  );
}

function SectionIntro({ number, name, id, headline, text, link }: {
  number: string;
  name: string;
  id: string;
  headline: [string, string];
  text: string;
  link?: { to: string; label: string };
}) {
  return (
    <div className="split-intro">
      <div className="split-head">
        <p className="eyebrow">
          <span className="eyebrow-number">{number}</span>
          <span className="eyebrow-name">{name}</span>
        </p>
        <Reveal>
          <h2 id={id} className="display">
            {headline[0]} <br />
            {headline[1]}
          </h2>
        </Reveal>
      </div>
      <div className="split-aside">
        <p className="muted">{text}</p>
        {link ? (
          <Link to={link.to} className="arrow-link">
            {link.label}
            <Icon name="arrowRight" size={16} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Hero({ gallery }: { gallery: Gallery | null }) {
  const featured = gallery?.featured ?? null;
  const location = useLocation();
  const requested = Number(location.search.get("edition"));
  return (
    <section className="hero" aria-label="Featured edition">
      {featured ? (
        <EditionStage
          piece={{ slug: featured.slug, title: featured.title, editionCount: featured.edition_count, priceCents: featured.price_cents }}
          initial={Number.isInteger(requested) && requested > 0 ? requested : FEATURED_START}
          variant="hero"
        />
      ) : (
        <div className="edition-stage stage-hero">
          <div className="stage-surface stage-empty" />
        </div>
      )}
      <HeroOverlay featured={featured} />
    </section>
  );
}

function HeroOverlay({ featured }: { featured: Gallery["featured"] }) {
  return (
    <div className="hero-overlay">
      <VerbStack />
      <PromptBar />
      {featured ? (
        <section className="now-playing" aria-label="Now playing">
          <span className="progress-dash" aria-hidden="true" />
          <span className="np-title">{featured.title}</span>
          <span>{featured.creator_display_name}</span>
          <span>GLSL</span>
          <span className="tabular">{featured.editions_left} editions left</span>
          <Link to={`/pieces/${featured.slug}`} className="np-remix">
            Remix
            <Icon name="arrowUpRight" size={14} />
          </Link>
        </section>
      ) : null}
    </div>
  );
}

/** The five verbs: the active one advances every 3 seconds, holds while the hero is off screen, and stands still under reduced motion. */
function VerbStack() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (reduced) {
      setActive(0);
      return;
    }
    const timer = window.setInterval(() => {
      const hero = list.current?.closest(".hero")?.getBoundingClientRect();
      if (hero && (hero.bottom <= 0 || hero.top >= window.innerHeight)) return;
      setActive((i) => (i + 1) % VERBS.length);
    }, VERB_MS);
    return () => window.clearInterval(timer);
  }, [reduced]);
  return (
    <ol ref={list} className={`verb-stack ${reduced ? "" : "verbs-enter"}`} aria-label="Workflow">
      {VERBS.map((verb, i) => (
        <li key={verb} aria-current={i === active ? "step" : undefined} className={i === active ? "verb is-active" : "verb"} style={{ animationDelay: `${i * 100}ms` }}>
          {verb}
          <span className="verb-dot" aria-hidden="true" />
        </li>
      ))}
    </ol>
  );
}

const assistantBus = new Set<(state: AssistantState) => void>();
let assistantState: AssistantState = "idle";
function setAssistant(state: AssistantState) {
  assistantState = state;
  assistantBus.forEach((fn) => fn(state));
}

function AssistantOnLanding() {
  const [state, setState] = useState<AssistantState>(assistantState);
  useEffect(() => {
    assistantBus.add(setState);
    return () => {
      assistantBus.delete(setState);
    };
  }, []);
  return <PixelPanel state={state} />;
}

function PromptBar() {
  const reduced = useReducedMotion();
  const { me, loaded } = useSession();
  const [value, setValue] = useState("");
  const [typed, setTyped] = useState(reduced ? copy.promptExample.length : 0);
  const [typing, setTyping] = useState(!reduced);
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const announcer = useAnnouncer();
  const resumed = useRef(false);

  useEffect(() => {
    if (!typing || reduced) {
      setTyped(copy.promptExample.length);
      return;
    }
    const timer = window.setInterval(() => {
      setTyped((count) => {
        if (count >= copy.promptExample.length) {
          window.clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [typing, reduced]);

  const submit = async (prompt: string) => {
    const length = [...prompt.trim()].length;
    if (length < 3 || length > 500) {
      setFieldError(copy.promptLength);
      return;
    }
    setFieldError("");
    if (!loaded) return;
    if (!me) {
      sessionStorage.setItem(KEPT_PROMPT, prompt);
      window.location.assign(signInHref("/"));
      return;
    }
    setBusy(true);
    setAssistant("drafting");
    announcer.say(copy.drafting);
    const result = await api<{ piece: Piece }>("POST", "/api/pieces/describe", { prompt });
    setBusy(false);
    if (result.ok) {
      setAssistant("idle");
      navigate(`/studio/pieces/${result.data.piece.slug}`, { message: copy.draftReady });
      return;
    }
    if (result.status === 403) {
      setAssistant("idle");
      announcer.say(copy.creatorsOnly);
    } else if (result.status === 422) {
      setAssistant("idle");
      setFieldError(copy.promptLength);
    } else {
      setAssistant("error");
      announcer.say(result.status === 502 ? copy.assistantBad : copy.assistantDown);
    }
  };

  // a prompt kept through sign-in is submitted on return
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!loaded || !me || resumed.current) return;
    const kept = sessionStorage.getItem(KEPT_PROMPT);
    if (!kept) return;
    resumed.current = true;
    sessionStorage.removeItem(KEPT_PROMPT);
    setValue(kept);
    setTyping(false);
    void submitRef.current(kept);
  }, [loaded, me]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void submit(value);
  };

  return (
    <div className="prompt-area" id="describe">
      <form className="prompt-bar" aria-label="Describe a piece" onSubmit={onSubmit} noValidate>
        <span className="prompt-slash" aria-hidden="true">/</span>
        <input
          type="text"
          aria-label="Describe a piece"
          value={value}
          placeholder={copy.promptExample.slice(0, typed)}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? "prompt-error" : undefined}
          onFocus={() => setTyping(false)}
          onChange={(event) => {
            setTyping(false);
            setValue(event.target.value);
          }}
        />
        <button type="submit" className="button button-accent prompt-submit" disabled={busy}>
          <span className="prompt-submit-label">Describe</span>
          <Icon name="cornerDownLeft" size={16} />
        </button>
      </form>
      {fieldError ? (
        <p id="prompt-error" className="field-error prompt-error">
          {fieldError}
        </p>
      ) : null}
      <LiveStatus label="Studio status" announcer={announcer} className="prompt-status" />
    </div>
  );
}

function EditionFrames({ slug, count }: { slug: string; count: number }) {
  const reduced = useReducedMotion();
  const numbers = [...new Set([1, Math.min(FEATURED_START, count), Math.ceil((count * 2) / 3), count])].filter((n) => n >= 1);
  return (
    <ul className="edition-frames" aria-label="Editions of the featured run" tabIndex={0}>
      {numbers.map((n, i) => (
        <Reveal as="li" key={n} delay={i * 100} className="edition-frame">
          <LiveCanvas
            program={{ kind: "house", slug }}
            slug={slug}
            still={reduced}
            scale={0.6}
            className="frame-canvas"
            scene={() => ({ seed: seedUniform(seedHash(slug, n)), uniforms: {}, time: (t) => t })}
          />
          <p className="frame-label tabular">
            <span className="frame-number">{n}</span> of {count} · <span className="mono">{seedHash(slug, n)}</span>
          </p>
        </Reveal>
      ))}
    </ul>
  );
}

function ClosingBand() {
  return (
    <section className="closing-band" aria-label="Start a piece">
      <svg className="closing-chevron" viewBox="0 0 400 400" focusable="false" aria-hidden="true">
        <path d="M40 360 200 60l160 300h-70L200 190 110 360z" />
      </svg>
      <svg className="closing-stripe closing-stripe-wide" viewBox="0 0 300 600" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <polygon points="0,600 170,600 300,340 300,0" />
      </svg>
      <svg className="closing-stripe closing-stripe-narrow" viewBox="0 0 180 240" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <polygon points="0,240 96,240 180,72 180,0 144,0" />
      </svg>
      <div className="closing-inner">
        <h2 className="display display-xl">
          Start a <br />
          piece <br />
          <em>tonight.</em>
        </h2>
        <div className="closing-actions">
          <Link to="/#describe" className="button button-accent button-large">
            Start a piece
            <Icon name="arrowRight" />
          </Link>
          <p className="muted">One sentence becomes a running draft. Tune it, key it, render it, number it.</p>
        </div>
      </div>
    </section>
  );
}
