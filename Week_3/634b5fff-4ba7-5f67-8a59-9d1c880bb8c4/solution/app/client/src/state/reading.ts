import { CHAPTER_EDGES, chapterOf, type Chapter } from "../../../shared/domain.js";
import { TALE } from "../../../shared/tale.js";
import { upperEdge } from "./scroll.js";

/** The tale cut into its sentences: one of them is lit at a time. */

interface Sentence {
  chapter: Chapter;
  text: string;
}

const BREAK = /(?<=[.!?])\s+(?=["A-Z])/;

export const SENTENCES: readonly Sentence[] = TALE.flatMap((passage) =>
  passage.text.split(BREAK).map((text) => ({ chapter: passage.chapter, text })),
);

/** The index into SENTENCES of the sentence lit at a progress. */
export const sentenceAt = (progressNow: number): number => {
  const chapter = chapterOf(progressNow);
  const first = SENTENCES.findIndex((sentence) => sentence.chapter === chapter);
  const count = SENTENCES.filter((sentence) => sentence.chapter === chapter).length;
  const low = CHAPTER_EDGES[chapter];
  const share = (progressNow - low) / (upperEdge(chapter) - low);
  return first + Math.min(count - 1, Math.max(0, Math.floor(share * count)));
};

/** The whole text of a chapter, passage by passage, for the discrete modes. */
export const passagesOf = (chapter: Chapter): readonly string[] =>
  TALE.filter((passage) => passage.chapter === chapter).map((passage) => passage.text);
