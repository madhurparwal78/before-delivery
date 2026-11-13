import { api, qs } from './core';
import { initTheme } from './theme';

initTheme();

interface AnalyticsData {
  pageRatings: { pageId: string; title: string; versionSlug: string; yes: number; no: number; helpful: string }[];
  searchTerms: { term: string; searches: number; results: number }[];
}

const siteId = document.body.dataset.siteId ?? '';

function load(): void {
  void api<AnalyticsData>('GET', `/api/sites/${siteId}/analytics`).then((res) => {
    if (!res.data) return;
    render(res.data);
  });
}

function render(data: AnalyticsData): void {
  const ratingsBody = qs<HTMLElement>('[data-ratings-body]');
  if (ratingsBody) {
    ratingsBody.textContent = '';
    for (const r of data.pageRatings) {
      const tr = document.createElement('tr');
      for (const cell of [r.title, String(r.yes), String(r.no), r.helpful]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      ratingsBody.append(tr);
    }
  }
  const termsBody = qs<HTMLElement>('[data-terms-body]');
  if (termsBody) {
    termsBody.textContent = '';
    for (const t of data.searchTerms) {
      const tr = document.createElement('tr');
      for (const cell of [t.term, String(t.searches), String(t.results)]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      termsBody.append(tr);
    }
  }
}

load();

const es = new EventSource('/api/events');
es.addEventListener('analytics', (ev) => {
  try {
    const data = JSON.parse((ev as MessageEvent).data) as { siteId: string };
    if (data.siteId === siteId) load();
  } catch { /* ignore */ }
});
