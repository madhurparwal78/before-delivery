import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { CHAPTER_TITLES, MATCHBOX, STORY_COPY } from "../../../shared/copy.js";
import { CHAPTER_EDGES, CHAPTERS, STRIKE_CHAPTERS, type Chapter } from "../../../shared/domain.js";
import { StillChapter, type MatchKind } from "../scene/index.js";
import { holds } from "../state/hold.js";
import { passagesOf, SENTENCES, sentenceAt } from "../state/reading.js";
import { followScroll, goToProgress, progress, SHELF_LANDING } from "../state/scroll.js";
import { narrate, sound } from "../state/sound.js";
import { isDiscrete, story, useChapter, useLitMatches } from "../state/story.js";
import { useStore } from "../state/store.js";
import { Button, Status } from "../ui.js";
import { chapterLine, LABELS } from "./copy.js";
import { MatchIcon } from "./icons.js";
import { useExtent } from "./layout.js";
import { ShelfGrid } from "./ShelfGrid.js";
import "../styles/story.css";

/** The distance of a drag along the matchbox that strikes it. */
const DRAG_PX = 80;

const neighbour = (chapter: Chapter, step: number): Chapter | null => CHAPTERS[CHAPTERS.indexOf(chapter) + step] ?? null;

const Captions = ({ chapter, discrete }: { chapter: Chapter; discrete: boolean }) => {
  const index = useSyncExternalStore(progress.subscribe, () => sentenceAt(progress.get()));
  if (discrete) {
    return (
      <section aria-label={LABELS.story.captions} className="captions captions--passage" tabIndex={0}>
        {passagesOf(chapter).map((text) => <p key={text}>{text}</p>)}
      </section>
    );
  }
  return (
    <section aria-label={LABELS.story.captions} className="captions">
      <p key={index} className="captions__line">{SENTENCES[index]?.text}</p>
    </section>
  );
};

const Matchbox = ({ chapter, burning, onStrike }: { chapter: Chapter; burning: boolean; onStrike: () => void }) => {
  const origin = useRef<number | null>(null);
  return (
    <div className="story__dock">
      <Button
        variant="primary"
        className={`matchbox${burning ? " matchbox--burning" : ""}`}
        disabled={!STRIKE_CHAPTERS.includes(chapter)}
        onClick={onStrike}
        onPointerDown={(event) => {
          origin.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (origin.current !== null && Math.abs(event.clientX - origin.current) >= DRAG_PX) onStrike();
          origin.current = null;
        }}
        onPointerCancel={() => {
          origin.current = null;
        }}
      >
        <MatchIcon />
        {MATCHBOX.strike}
      </Button>
    </div>
  );
};

/** The story: one column of type over the scene, the matchbox, and the shelf grid; the page scroll is the story's progress. */
export const StoryView = ({ shelfRoute }: { shelfRoute: boolean }) => {
  const controller = story();
  const discrete = isDiscrete();
  const chapter = useChapter();
  const lit = useLitMatches();
  const choice = useStore(sound);
  const holdLive = useStore(holds).live;
  const band = useExtent("band");
  const [out, setOut] = useState<{ kind: MatchKind; chapter: Chapter } | null>(null);

  useEffect(() => {
    if (discrete) return undefined;
    window.addEventListener("scroll", followScroll, { passive: true });
    window.addEventListener("resize", followScroll);
    return () => {
      window.removeEventListener("scroll", followScroll);
      window.removeEventListener("resize", followScroll);
    };
  }, [discrete]);

  useLayoutEffect(() => {
    if (discrete) {
      if (shelfRoute) controller.stepToChapter("shelf");
      return;
    }
    const at = progress.get();
    if (shelfRoute) goToProgress(at >= CHAPTER_EDGES.shelf ? at : SHELF_LANDING);
    else if (at > 0) goToProgress(at);
    else followScroll();
  }, [controller, discrete, shelfRoute]);

  useEffect(() => controller.onMatchOut((kind) => setOut({ kind, chapter: controller.chapter })), [controller]);

  useEffect(() => {
    narrate(choice === "on" ? chapter : null);
    return () => narrate(null);
  }, [choice, chapter]);

  const strike = (): void => {
    setOut(null);
    controller.strike();
  };

  const previous = neighbour(chapter, -1);
  const following = neighbour(chapter, 1);
  const line =
    out?.chapter === chapter ? (out.kind === "bundle" ? STORY_COPY.bundleOut : STORY_COPY.matchOut) : chapterLine(CHAPTERS.indexOf(chapter), CHAPTERS.length, chapter);

  return (
    <>
      {controller.mode === "still" && chapter !== "shelf" ? (
        <div className="still">
          <StillChapter chapter={chapter} lit={lit > 0} />
        </div>
      ) : null}
      {discrete ? null : <div className="story-scroll" aria-hidden="true" />}
      <main className="story" data-chapter={chapter} data-focus={holdLive || undefined}>
        <div className="story__column" ref={chapter === "shelf" ? band : undefined}>
          <h1 className="story__title">{CHAPTER_TITLES[chapter]}</h1>
          <Captions chapter={chapter} discrete={discrete} />
          <Status label={LABELS.story.status} className="story__status">{line}</Status>
          {discrete ? (
            <div className="story__steps">
              <Button variant="ghost" disabled={previous === null} onClick={() => previous && controller.stepToChapter(previous)}>{MATCHBOX.previous}</Button>
              <Button variant="ghost" disabled={following === null} onClick={() => following && controller.stepToChapter(following)}>{MATCHBOX.next}</Button>
            </div>
          ) : null}
        </div>
        <Matchbox chapter={chapter} burning={lit > 0} onStrike={strike} />
        <ShelfGrid />
      </main>
    </>
  );
};
