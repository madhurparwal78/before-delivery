// A chapter page (brief: Screens and layout › Chapter page): the sightline scene, the text with
// plates and narration, the exhibit once entered, the chapter's events and the threshold band.

import { useEffect, useRef, useState } from "react";
import type { ChapterDetail, TimelineEvent } from "../api.js";
import { useApi, useBookmarks, useChapters } from "../hooks.js";
import { useApp } from "../state.js";
import { Link } from "../router.js";
import { ChapterRail } from "../components/ChapterRail.js";
import { EmptyMark, Icon, MuseumCard } from "../components/ui.js";
import { SightlineScene } from "../scene/SightlineScene.js";
import { SpringExhibit } from "../exhibits/Spring.js";
import { RulesExhibit } from "../exhibits/Rules.js";
import { ClassifierExhibit } from "../exhibits/Classifier.js";
import { NeighboursExhibit } from "../exhibits/Neighbours.js";
import { NotFound } from "./NotFound.js";
import { EventCard, useCitations } from "./Timeline.js";
import { COPY } from "../../shared/copy.js";
import type { ClassifierSeed, ExhibitKey, ExhibitSeed, NeighboursSeed, RulesSeed, SpringSeed } from "../../shared/exhibits.js";

const PLATE_HOLD_MS = 7000;

const EXHIBIT_TITLES: Record<ExhibitKey, { title: string; text: string }> = {
  spring: { title: "The spring sculpture", text: "Change the stiffness and damping, then pluck the chain. The discriminant c² − 4k names how it returns to rest." },
  rules: { title: "The rule engine", text: "Rules run from top to bottom and the first match labels each specimen. Edit, add or remove a rule and watch the collection re-sort." },
  classifier: { title: "The perceptron", text: "Select a training point and move it, or drag it on the plot. The perceptron retrains and is judged only on the held-out diamonds." },
  neighbours: { title: "Words near words", text: "Pick a word and a context. Neighbours are ranked by the cosine of the angle between their vectors and the query." },
};

function Plates({ plates, reducedMotion }: { plates: ChapterDetail["plates"]; reducedMotion: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = !reducedMotion && !paused && !hovered && plates.length > 1;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % plates.length), PLATE_HOLD_MS);
    return () => window.clearInterval(timer);
  }, [running, plates.length]);
  useEffect(() => {
    if (reducedMotion) setIndex(0);
  }, [reducedMotion]);
  if (!plates.length) return null;
  return (
    <section
      aria-label="Plates"
      className="plates"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHovered(false)}
    >
      <figure className="plate-figure">
        <div className="plate-stack">
          {failed ? (
            <p className="media-unavailable">{COPY.mediaUnavailable}</p>
          ) : (
            plates.map((p, i) => <img key={p.media_url} src={p.media_url} alt={p.caption} className={i === index ? "is-current" : undefined} onError={() => setFailed(true)} />)
          )}
        </div>
        <figcaption>
          <span className="figure">
            {index + 1} / {plates.length}
          </span>{" "}
          {plates[index].caption}
        </figcaption>
      </figure>
      <div className="plate-controls">
        {reducedMotion ? (
          <>
            <button type="button" className="button button-quiet" onClick={() => setIndex((i) => (i + plates.length - 1) % plates.length)}>
              <Icon name="chevronLeft" />
              Previous plate
            </button>
            <button type="button" className="button button-quiet" onClick={() => setIndex((i) => (i + 1) % plates.length)}>
              Next plate
              <Icon name="chevronRight" />
            </button>
          </>
        ) : (
          <button type="button" className="button button-quiet" onClick={() => setPaused((p) => !p)}>
            <Icon name={paused ? "play" : "pause"} />
            {paused ? "Play plates" : "Pause plates"}
          </button>
        )}
      </div>
    </section>
  );
}

function Narration({ narration }: { narration: NonNullable<ChapterDetail["narration"]> }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="narration">
      <audio ref={audio} src={narration.media_url} preload="none" onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onPlay={() => setPlaying(true)} onError={() => setFailed(true)} />
      <div className="narration-controls">
        <button
          type="button"
          className="button"
          onClick={() => {
            const element = audio.current as HTMLAudioElement;
            if (playing) element.pause();
            else {
              setPlaying(true);
              element.play().catch(() => setPlaying(false));
            }
          }}
        >
          <Icon name={playing ? "pause" : "play"} />
          {playing ? "Pause narration" : "Play narration"}
        </button>
        <button type="button" className="button button-quiet" aria-expanded={open} aria-controls="narration-transcript" onClick={() => setOpen((o) => !o)}>
          Transcript
        </button>
      </div>
      {failed && <p className="media-unavailable">{COPY.mediaUnavailable}</p>}
      <div id="narration-transcript" className="transcript" hidden={!open}>
        <p>{narration.transcript}</p>
      </div>
    </div>
  );
}

function Threshold({ next, reducedMotion }: { next: { number: number; numeral: string; title: string } | null; reducedMotion: boolean }) {
  const band = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    const measure = () => {
      const box = (band.current as HTMLDivElement).getBoundingClientRect();
      setProgress(Math.min(1, Math.max(0, (window.innerHeight - box.top) / box.height)));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [reducedMotion]);
  const title = next ? next.title : "Back to the eight rooms";
  const scatter = 1 - progress;
  return (
    <div ref={band} className="threshold">
      <p className="eyebrow">{next ? `Next room · ${next.numeral}` : "The end of the walk"}</p>
      <Link href={next ? `/chapters/${next.number}` : "/"} className="threshold-link" aria-label={next ? `Next room: Chapter ${next.numeral}, ${next.title}` : "Back to the eight rooms"}>
        <span className="threshold-title" aria-hidden="true">
          {[...title].map((letter, i) => {
            const seed = Math.sin(i * 12.9898 + title.length) * 43758.5453;
            const r = seed - Math.floor(seed);
            const style = scatter ? { transform: `translate(${(r - 0.5) * 260 * scatter}px, ${((r * 7) % 1 - 0.5) * 180 * scatter}px) rotate(${(r - 0.5) * 70 * scatter}deg)`, opacity: 1 - scatter * 0.6 } : undefined;
            return (
              <span key={i} className="threshold-letter" style={style}>
                {letter === " " ? " " : letter}
              </span>
            );
          })}
        </span>
      </Link>
    </div>
  );
}

export function ChapterPage({ number }: { number: number }) {
  const app = useApp();
  const detail = useApi<{ chapter: ChapterDetail }>(`/api/chapters/${number}?for=${app.user?.id ?? ""}`);
  const chapters = useChapters(app.user?.id ?? null, app.pathVersion);
  const bookmarks = useBookmarks();
  const citations = useCitations();
  const [entered, setEntered] = useState(false);
  const used = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const exhibitKey = detail.data?.chapter.exhibit ?? null;
  const seed = useApi<ExhibitSeed>(entered && exhibitKey ? `/api/exhibits/${exhibitKey}` : null);

  useEffect(() => {
    if (entered) heading.current?.focus();
  }, [entered]);

  if (detail.failure?.status === 404) return <NotFound />;
  const chapter = detail.data?.chapter;
  if (!chapter) return <div className="page chapter-page scene-placeholder" aria-busy="true" />;

  const enter = () => {
    setEntered(true);
    heading.current?.focus();
    if (app.user) app.savePath({ resolved: chapter.number, position: { chapter: chapter.number, exhibit: "" } });
  };

  const useExhibit = () => {
    if (used.current || !app.user || !exhibitKey) return;
    used.current = true;
    app.savePath({ position: { chapter: chapter.number, exhibit: exhibitKey } });
  };

  const index = chapters?.findIndex((c) => c.number === chapter.number) ?? -1;
  const next = chapters && index >= 0 && index + 1 < chapters.length ? chapters[index + 1] : null;
  const seedFor = <T extends ExhibitSeed>(key: T["key"]) => (seed.data?.key === key ? (seed.data as T) : null);
  const spring = seedFor<SpringSeed>("spring");
  const rules = seedFor<RulesSeed>("rules");
  const classifier = seedFor<ClassifierSeed>("classifier");
  const neighbours = seedFor<NeighboursSeed>("neighbours");

  return (
    <div className="page chapter-page">
      {chapters && <ChapterRail chapters={chapters} current={chapter.number} />}
      <SightlineScene
        chapter={chapter}
        startResolved={chapter.resolved}
        reducedMotion={app.reducedMotion}
        sound={app.preferences.sound}
        onEnter={enter}
        headingRef={heading}
        headerExtra={
          <button
            type="button"
            className="icon-button"
            aria-label="Bookmark chapter"
            aria-pressed={bookmarks.marked(chapter.id)}
            onClick={(e) => void bookmarks.toggle("chapter", chapter.id, chapter.title, e.currentTarget)}
          >
            <Icon name="bookmark" filled={bookmarks.marked(chapter.id)} />
          </button>
        }
      />
      <section className="band chapter-text" aria-label="Chapter text">
        <div className="chapter-copy">
          <p className="catalogue">{chapter.catalogue_number} · {chapter.era}</p>
          {chapter.body.split("\n\n").map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
          {chapter.narration && <Narration narration={chapter.narration} />}
        </div>
        <Plates plates={chapter.plates} reducedMotion={app.reducedMotion} />
      </section>
      {entered && exhibitKey && (
        <section className="band exhibit-band" aria-label="Exhibit">
          <MuseumCard catalogue={`${chapter.catalogue_number}-01`} title={EXHIBIT_TITLES[exhibitKey].title} className="exhibit-card">
            <p className="card-text">{EXHIBIT_TITLES[exhibitKey].text}</p>
            {spring && <SpringExhibit seed={spring} reducedMotion={app.reducedMotion} onUse={useExhibit} />}
            {rules && <RulesExhibit seed={rules} onUse={useExhibit} />}
            {classifier && <ClassifierExhibit seed={classifier} reducedMotion={app.reducedMotion} onUse={useExhibit} />}
            {neighbours && <NeighboursExhibit seed={neighbours} onUse={useExhibit} />}
          </MuseumCard>
        </section>
      )}
      <section className="band chapter-events" aria-label="Timeline events">
        <h2>From the timeline</h2>
        {chapter.events.length ? (
          <ol className="card-grid event-grid">
            {chapter.events.map((e: TimelineEvent) => (
              <li key={e.id}>
                <EventCard event={e} numeral={chapter.numeral} citations={citations} bookmarks={bookmarks} />
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state museum-card">
            <EmptyMark />
            <p>{COPY.emptyEvents}</p>
            <Link href="/timeline">Browse the whole timeline</Link>
          </div>
        )}
      </section>
      <Threshold next={next} reducedMotion={app.reducedMotion} />
    </div>
  );
}
