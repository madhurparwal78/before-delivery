import type { Chapter } from '../../shared/copy.js';
import { passages, sentencesOf } from '../../shared/tale.js';
import { chapterRanges } from '../scene/chapters.js';
import { el } from './dom.js';

export interface StoryView {
  element: HTMLElement;
  litSentence(): string;
  scrollToChapter(chapter: Chapter): void;
  showChapter(chapter: Chapter): void;
  highlight(): void;
}

/** A single narrow column of type scrolling past the scene, one sentence lit. */
export function buildStory(discrete: boolean): StoryView {
  const sections = new Map<Chapter, HTMLElement>();
  const column = el('div', { class: 'story' });

  for (const range of chapterRanges) {
    const section = el('section', { class: 'story-chapter', 'data-chapter': range.chapter }, [
      el('h2', { text: range.title }),
    ]);
    for (const passage of passages.filter((item) => item.chapter === range.chapter)) {
      for (const sentence of sentencesOf(passage.text)) {
        section.append(el('p', { class: 'story-line', text: sentence }));
      }
    }
    sections.set(range.chapter, section);
    column.append(section);
  }

  let lit = '';

  function highlight(): void {
    const middle = window.innerHeight / 2;
    let closest: HTMLElement | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const line of column.querySelectorAll<HTMLElement>('.story-line')) {
      if (line.offsetParent === null) continue;
      const box = line.getBoundingClientRect();
      const distance = Math.abs(box.top + box.height / 2 - middle);
      if (distance < best) {
        best = distance;
        closest = line;
      }
    }
    for (const line of column.querySelectorAll('.story-line')) line.classList.remove('lit');
    if (closest === null) return;
    closest.classList.add('lit');
    lit = closest.textContent ?? '';
  }

  function showChapter(chapter: Chapter): void {
    if (!discrete) return;
    for (const [name, section] of sections) section.hidden = name !== chapter;
    highlight();
  }

  if (discrete) showChapter('alley');

  return {
    element: column,
    litSentence: () => lit,
    scrollToChapter(chapter) {
      const section = sections.get(chapter);
      if (section === undefined) return;
      if (discrete) {
        showChapter(chapter);
        return;
      }
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
    },
    showChapter,
    highlight,
  };
}
