import { CHAPTER_EDGES, CHAPTERS, chapterOf, type Chapter } from "../../../shared/domain.js";
import { Store } from "./store.js";
import { isDiscrete, story } from "./story.js";

/** Scroll progress of the story: the document scroll in continuous mode, the chapter's middle in the discrete modes. */

/** Where the scroll lands when the shelf is opened. */
export const SHELF_LANDING = 0.97;

/** The last progress the reader was at; it survives the sheets, which have no story scroll. */
export const progress = new Store(0);

export const upperEdge = (chapter: Chapter): number => {
  const next = CHAPTERS[CHAPTERS.indexOf(chapter) + 1];
  return next === undefined ? 1 : CHAPTER_EDGES[next];
};

const chapterMid = (chapter: Chapter): number => (CHAPTER_EDGES[chapter] + upperEdge(chapter)) / 2;

const scrollRange = (): number => document.documentElement.scrollHeight - window.innerHeight;

/** Reads the document scroll into the story and returns the progress. */
export const followScroll = (): number => {
  const range = scrollRange();
  const next = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
  progress.set(next);
  story().setProgress(next);
  return next;
};

/** Moves the story to a progress: scrolls the document, or steps to the chapter when the story is discrete. */
export const goToProgress = (target: number): void => {
  if (isDiscrete()) {
    story().stepToChapter(chapterOf(target));
    return;
  }
  window.scrollTo(0, target * scrollRange());
  followScroll();
};

export const goToChapter = (chapter: Chapter): void => goToProgress(chapterMid(chapter));
