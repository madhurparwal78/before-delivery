import { api, type ChapterSummary } from '../api.ts';
import { shell } from '../shell.ts';

export async function initIndexPage(): Promise<void> {
  const grid = document.querySelector<HTMLElement>('[data-role="chapter-grid"]');
  if (!grid) return;
  const data = await api.get<{ chapters: ChapterSummary[] }>('/api/chapters');
  grid.textContent = '';
  for (const chapter of data.chapters) {
    const link = document.createElement('a');
    link.className = 'chapter-card';
    link.href = `/chapters/${chapter.number}`;
    link.textContent = '';
    const numeral = document.createElement('div');
    numeral.className = 'numeral';
    numeral.textContent = chapter.numeral;
    const title = document.createElement('h2');
    title.textContent = chapter.title;
    const era = document.createElement('div');
    era.className = 'era';
    era.textContent = chapter.era;
    const cat = document.createElement('div');
    cat.className = 'cat-number';
    cat.textContent = `${chapter.catalogue_number}`;
    const mark = document.createElement('div');
    mark.className = 'resolved-mark';
    mark.textContent = chapter.resolved ? 'Resolved' : '';
    link.append(cat, numeral, title, era, mark);
    grid.appendChild(link);
  }

  // Continue link for a signed-in visitor with a last position.
  const continueSlot = document.querySelector<HTMLElement>('[data-role="continue"]');
  if (continueSlot && shell.user) {
    try {
      const path = await api.get<{ path: { resolved: number[]; last_chapter: number | null; last_exhibit: string } }>('/api/me/path');
      if (path.path.last_chapter) {
        const chapter = data.chapters.find((c) => c.number === path.path.last_chapter);
        if (chapter) {
          const a = document.createElement('a');
          a.href = `/chapters/${chapter.number}`;
          a.textContent = `Continue at chapter ${chapter.numeral}`;
          continueSlot.textContent = '';
          continueSlot.appendChild(a);
          continueSlot.hidden = false;
        }
      }
    } catch {
      /* accounts unavailable: no continue link */
    }
  }
}


