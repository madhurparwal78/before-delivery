import { reviewCountLine } from '../../shared/reference';
import { get } from '../core/api';
import { el, on } from '../core/dom';
import type { Cleanup } from '../core/router';
import { splitStage } from '../widgets/layout';
import { specimenTile, type PayRow } from '../widgets/tile';

interface Company {
  slug: string;
  name: string;
  city_name: string;
  viewer_unlocked: boolean;
  rating: { review_count: number };
  pay_rows: PayRow[];
}

const SAMPLE_SLUGS = ['fernhollow-assay-labs', 'thistlecombe-biologics', 'larkspur-core-facility'];

export async function renderLanding(container: HTMLElement): Promise<Cleanup> {
  const companies: Company[] = [];
  for (const slug of SAMPLE_SLUGS) {
    companies.push(await get<Company>(`/api/companies/${slug}`));
  }

  const reading = el('div', {}, [
    el('div', { class: 'hero-copy' }, [
      el('h1', { text: 'Know the bench before you take the job.' }),
      el('p', {
        class: 'muted hero-sentence',
        text: 'Pay ranges open only once enough people have shared theirs, so no one can be picked out.',
      }),
      el('a', { href: '/jobs', class: 'solid-button', text: 'Search lab jobs' }),
    ]),
  ]);

  const sections: HTMLElement[] = [];
  for (const company of companies) {
    const section = el('section', { class: 'reading-section lab-section', 'data-slug': company.slug }, [
      el('h2', { text: company.name }),
      el('p', { text: company.city_name }),
      el('a', { href: `/companies/${company.slug}`, text: `See ${company.name}` }),
    ]);
    sections.push(section);
    reading.append(section);
  }

  const tile = specimenTile();
  const first = companies[0];
  if (first) {
    tile.showGlassware(first.name, `${first.name}, ${first.city_name}. ${reviewCountLine(first.rating.review_count)}`);
  }

  const field = el('div', {}, [
    el('a', { href: '/employer', class: 'field-corner-link', text: 'For employers' }),
    tile.element,
  ]);

  container.append(splitStage(reading, field));

  const showFor = (company: Company): void => {
    const row = company.pay_rows[0];
    if (!row) {
      tile.showGlassware(
        company.name,
        `${company.name}, ${company.city_name}. ${reviewCountLine(company.rating.review_count)}`,
      );
      return;
    }
    tile.showPayRow(row, company.viewer_unlocked);
  };

  /** As the reading column passes each sample lab, the tile changes. */
  const update = (): void => {
    const middle = window.innerHeight / 2;
    let visible: Company | null = null;
    for (const [index, section] of sections.entries()) {
      const box = section.getBoundingClientRect();
      if (box.top <= middle) visible = companies[index] ?? null;
    }
    if (visible) showFor(visible);
    else if (first) {
      tile.showGlassware(
        first.name,
        `${first.name}, ${first.city_name}. ${reviewCountLine(first.rating.review_count)}`,
      );
    }
  };
  const stop = on(window, 'scroll', update, { passive: true });
  requestAnimationFrame(update);
  return stop;
}
