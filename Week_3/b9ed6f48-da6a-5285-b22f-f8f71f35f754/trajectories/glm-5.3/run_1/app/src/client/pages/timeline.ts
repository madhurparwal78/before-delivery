import { api, type TimelineEvent } from '../api.ts';
import { shell, notice, isApiFailure } from '../shell.ts';

/** Timeline: search and filter live in the page address; the latest input wins. */

interface SearchState {
  query: string;
  chapter: string;
}

export async function initTimelinePage(): Promise<void> {
  const searchBox = document.querySelector<HTMLInputElement>('[data-role="search-box"]');
  const chapterSelect = document.querySelector<HTMLSelectElement>('[data-role="chapter-filter"]');
  const resultsRegion = document.querySelector<HTMLElement>('[data-role="search-results"]');
  const statusRegion = document.querySelector<HTMLElement>('[data-role="search-status"]');

  // Restore from the address.
  const initial = readAddress();
  if (searchBox) searchBox.value = initial.query;
  if (chapterSelect) chapterSelect.value = initial.chapter;

  let sequence = 0;
  let debounceTimer: number | null = null;

  async function run(): Promise<void> {
    const token = ++sequence;
    const { query, chapter } = currentValues();
    writeAddress(query, chapter);
    let html: string;
    let statusText = '';
    if (query.length < 2) {
      const events = await fetchEvents(chapter);
      if (token !== sequence) return;
      html = renderEvents(events);
      statusText = '';
    } else {
      const results = await fetchSearch(query, chapter);
      if (token !== sequence) return;
      statusText = `${results.length === 1 ? '1 result' : `${results.length} results`} for "${query}".`;
      html = renderResults(results, query);
    }
    if (token !== sequence) return;
    if (resultsRegion) resultsRegion.innerHTML = html;
    if (statusRegion) statusRegion.textContent = statusText;
    wireBookmarks();
  }

  function currentValues(): SearchState {
    return {
      query: (searchBox?.value ?? '').trim(),
      chapter: chapterSelect?.value ?? '',
    };
  }

  function readAddress(): SearchState {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') ?? '';
    const chapter = params.get('chapter') ?? '';
    return { query: q, chapter };
  }

  function writeAddress(query: string, chapter: string): void {
    const params = new URLSearchParams();
    if (query.length >= 2) params.set('q', query);
    if (chapter) params.set('chapter', chapter);
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`;
    window.history.replaceState(null, '', next);
  }

  async function fetchEvents(chapter: string): Promise<TimelineEvent[]> {
    const suffix = chapter ? `?chapter=${encodeURIComponent(chapter)}` : '';
    const res = await api.get<{ events: TimelineEvent[] }>(`/api/timeline${suffix}`);
    return res.events;
  }

  async function fetchSearch(query: string, chapter: string): Promise<Array<{ type: string; id: string; title: string; chapter: number }>> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (chapter) params.set('chapter', chapter);
    const res = await api.get<{ results: Array<{ type: string; id: string; title: string; chapter: number }> }>(`/api/search?${params.toString()}`);
    return res.results;
  }

  function renderEvents(events: TimelineEvent[]): string {
    if (!events.length) return `<p class="muted">No timeline events in this chapter yet.</p>`;
    return events
      .map((event) => {
        const numeral = NUMERALS[event.chapter] ?? String(event.chapter);
        return `<article class="event-card" data-event="${event.id}">
          <div class="year">${event.year}</div>
          <h3>${escapeText(event.title)}</h3>
          <p>${escapeText(event.summary)}</p>
          <div class="row spread">
            <span class="muted mono">Chapter ${numeral}</span>
            <button data-bookmark="${event.id}" aria-pressed="false" aria-label="Bookmark ${escapeAttr(event.title)}">Bookmark</button>
          </div>
        </article>`;
      })
      .join('');
  }

  function renderResults(results: Array<{ type: string; id: string; title: string; chapter: number }>, query: string): string {
    if (!results.length) return `<p class="muted">Nothing in the archive matches "${escapeText(query)}".</p>`;
    return results
      .map((result) => {
        if (result.type === 'chapter') {
          const numeral = NUMERALS[result.chapter] ?? String(result.chapter);
          return `<article class="event-card">
            <div class="year">Chapter ${numeral}</div>
            <h3><a href="/chapters/${result.chapter}">${escapeText(result.title)}</a></h3>
          </article>`;
        }
        const numeral = NUMERALS[result.chapter] ?? String(result.chapter);
        return `<article class="event-card">
          <div class="year">${numeral}</div>
          <h3>${escapeText(result.title)}</h3>
          <div class="row spread">
            <a class="muted mono" href="/chapters/${result.chapter}">Chapter ${numeral}</a>
            <button data-bookmark="${result.id}" aria-pressed="false" aria-label="Bookmark ${escapeAttr(result.title)}">Bookmark</button>
          </div>
        </article>`;
      })
      .join('');
  }

  function wireBookmarks(): void {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bookmark]'))) {
      if (button.dataset['wired'] === '1') continue;
      button.dataset['wired'] = '1';
      button.addEventListener('click', async () => {
        if (!shell.user) {
          notice('Please sign in.');
          return;
        }
        const targetId = button.dataset['bookmark'] ?? '';
        try {
          if (button.getAttribute('aria-pressed') === 'true') {
            const list = await api.get<{ bookmarks: Array<{ id: string; target_id: string }> }>('/api/me/bookmarks');
            const found = list.bookmarks.find((b) => b.target_id === targetId);
            if (found) await api.delete(`/api/me/bookmarks/${found.id}`);
            button.setAttribute('aria-pressed', 'false');
            notice('Bookmark removed.');
          } else {
            await api.post('/api/me/bookmarks', { target_type: 'event', target_id: targetId });
            button.setAttribute('aria-pressed', 'true');
            const card = button.closest('.event-card');
            const title = card?.querySelector('h3')?.textContent ?? '';
            notice(`Bookmarked ${title}.`);
          }
        } catch (e) {
          notice(isApiFailure(e) ? e.message : 'Something went wrong.');
        }
      });
    }
  }

  // Typing updates the results within half a second, with no submit button.
  searchBox?.addEventListener('input', () => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void run(), 400);
  });
  chapterSelect?.addEventListener('change', () => void run());

  await run();
}

const NUMERALS: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII',
};

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(text: string): string {
  return escapeText(text);
}
