import { api, qs, qsa } from './core';
import { initTheme } from './theme';

initTheme();

interface SiteData { id: string; slug: string; title: string; versions: { id: string; slug: string; title: string; default: boolean; publishedAt: string | null }[] }

async function load(): Promise<void> {
  const res = await api<SiteData[]>('GET', '/api/sites');
  if (!res.data) return;
  const list = qs('[data-sites-list]');
  if (!list) return;
  list.textContent = '';
  for (const site of res.data) {
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = site.title;
    section.append(h2);
    const ul = document.createElement('ul');
    for (const v of site.versions) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/app/sites/${site.slug}/${v.slug}/pages`;
      a.textContent = v.title;
      li.append(a);
      ul.append(li);
    }
    const analytics = document.createElement('a');
    analytics.href = `/app/sites/${site.slug}/analytics`;
    analytics.textContent = 'Analytics';
    section.append(ul, analytics);
    list.append(section);
  }
}

void load();
