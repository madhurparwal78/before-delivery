import { getJson } from '../api.js';
import { el } from '../dom.js';
import { onLive } from '../live.js';
import { registerCleanup, notFoundPage } from '../main.js';
import { displayDate } from '../shell.js';
import { paletteFigure } from '../figures/palette.js';
import { curveFigure, timelineFigure } from '../figures/motion.js';
import { weightFigure } from '../figures/weight.js';
import type { ChapterDetail } from '../../shared/types.js';

export interface ChapterOptions {
  slug: string;
  focusIdentifier: string | null;
}

function figuresFor(slug: string): HTMLElement[] {
  if (slug === 'typography') return [weightFigure()];
  if (slug === 'colour') return [paletteFigure()];
  if (slug === 'motion') return [timelineFigure(), curveFigure()];
  return [];
}

export async function renderChapter(
  main: HTMLElement,
  options: ChapterOptions,
  navigate: (path: string) => void,
): Promise<void> {
  let chapter: ChapterDetail;
  try {
    chapter = await getJson<ChapterDetail>(`/api/chapters/${encodeURIComponent(options.slug)}`);
  } catch {
    notFoundPage(main);
    return;
  }

  const statements = el(
    'ul',
    { class: 'statement-list', 'aria-label': 'Rules' },
    ...chapter.statements.map((statement) =>
      el(
        'li',
        { id: statement.identifier, tabindex: '-1' },
        el('span', { class: 'identifier' }, statement.identifier),
        el('span', { class: 'statement-text' }, statement.text),
      ),
    ),
  );

  const figures = figuresFor(chapter.slug);

  main.append(
    el(
      'div',
      { class: 'cell chapter-head' },
      el('h1', {}, chapter.title),
      el(
        'p',
        { class: 'chapter-version' },
        `Version ${chapter.version}, published ${displayDate(chapter.publishedAt)}`,
      ),
      el('p', { class: 'chapter-intro' }, chapter.intro),
      el(
        'p',
        {},
        el(
          'a',
          {
            href: '/rules',
            onclick: (event: Event) => {
              event.preventDefault();
              navigate('/rules');
            },
          },
          'Rule index',
        ),
      ),
    ),
    el(
      'div',
      { class: 'chapter-body' },
      el('div', { class: 'cell statements-cell' }, statements),
      figures.length > 0 ? el('div', { class: 'cell figures-cell' }, ...figures) : null,
    ),
  );

  if (options.focusIdentifier) {
    const target = main.querySelector<HTMLElement>(`[id="${CSS.escape(options.focusIdentifier)}"]`);
    if (target) {
      target.classList.add('focused-statement');
      target.scrollIntoView({ block: 'center' });
      target.focus();
    }
  }

  registerCleanup(
    onLive((event) => {
      if (event.type === 'chapter.updated' && event.slug === chapter.slug) {
        window.location.reload();
      }
    }),
  );
}
