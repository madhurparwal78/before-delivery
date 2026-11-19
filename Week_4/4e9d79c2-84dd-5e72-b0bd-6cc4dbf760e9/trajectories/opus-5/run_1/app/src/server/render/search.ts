import { FLEET_SIZES, OCCASION_PAGES, QUESTIONS, TERMS_PARAGRAPHS, HOME_PROMISES } from './content.js';

export type SearchResult = { title: string; path: string; excerpt: string };

type IndexedPage = { title: string; path: string; text: string };

/** Search runs on the server over the public pages only. */
const PAGES: IndexedPage[] = [
  {
    title: 'Coaches and minibuses with a driver',
    path: '/',
    text: [
      'Coaches and minibuses with a driver arranged for you from Coventry.',
      'One desk, one person, every detail checked.',
      ...HOME_PROMISES,
      ...OCCASION_PAGES.map((page) => `${page.heading}. ${page.panel}`),
    ].join(' '),
  },
  ...OCCASION_PAGES.map((page) => ({
    title: page.heading,
    path: page.path,
    text: [
      page.panel,
      ...page.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
      ...QUESTIONS.map((question) => `${question.question} ${question.answer}`),
    ].join(' '),
  })),
  {
    title: 'Our fleet',
    path: '/fleet',
    text: FLEET_SIZES.map((size) => `${size.name} ${size.seats} seats ${size.bags} bag units`).join(' '),
  },
  { title: 'Terms', path: '/terms', text: TERMS_PARAGRAPHS.join(' ') },
];

function excerptOf(text: string, at: number, length: number): string {
  const from = Math.max(0, at - 40);
  const to = Math.min(text.length, at + length + 60);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

export function searchPublicPages(q: string): SearchResult[] {
  const wanted = q.trim().toLowerCase();
  if (wanted === '') return [];
  const results: SearchResult[] = [];
  for (const page of PAGES) {
    const haystack = `${page.title} ${page.text}`;
    const at = haystack.toLowerCase().indexOf(wanted);
    if (at === -1) continue;
    results.push({ title: page.title, path: page.path, excerpt: excerptOf(haystack, at, wanted.length) });
  }
  return results;
}
