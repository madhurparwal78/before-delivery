// The landing page: the split stage hero and the three sample labs.
import { h } from '../dom.js';
import { api } from '../api.js';
import { tileFigure } from '../glassware.js';
import { monthYear, reviewCountText, rupees, rangeText } from '../format.js';
import type { PageContext } from '../app.js';
import type { Company } from '../types.js';

const SAMPLES = ['fernhollow-assay-labs', 'thistlecombe-biologics', 'larkspur-core-facility'];

export function landingPage(_ctx: PageContext): HTMLElement {
  const main = h('main', {});
  void build(main);
  return main;
}

async function build(main: HTMLElement): Promise<void> {
  const field = h('div', { class: 'field' });
  const reading = h('div', { class: 'reading-column' });
  const split = h('div', { class: 'split' }, reading, field);
  main.appendChild(split);

  const headline = h('h1', {}, 'Know the bench before you take the job.');
  const paySentence = h('p', { class: 'muted' }, 'Pay ranges open only once enough people have shared theirs, so no one can be picked out.');
  const searchLink = h('a', { class: 'solid-button', href: '/jobs' }, 'Search lab jobs');
  const employersLink = h('a', { class: 'text-button', href: '/employer' }, 'For employers');
  reading.appendChild(headline);
  reading.appendChild(paySentence);
  reading.appendChild(searchLink);

  let tileSeed = 'Candour Bench';
  const figure = tileFigure('Candour Bench', 'Every lab here is invented.', tileSeed);
  field.appendChild(figure);
  const employersHost = h('div', { class: 'field-top' });
  field.appendChild(employersHost);
  employersHost.appendChild(employersLink);

  const sections: HTMLElement[] = [];
  for (const slug of SAMPLES) {
    const section = h('section', { class: 'lab-section' });
    sections.push(section);
    reading.appendChild(section);
  }

  for (const [index, slug] of SAMPLES.entries()) {
    const company = await api.get<Company>(`/api/companies/${slug}`);
    const section = sections[index];
    section.appendChild(h('h2', {}, h('a', { href: `/companies/${company.slug}` }, company.name)));
    section.appendChild(h('p', {}, `${company.city_name}`));
    const firstRow = company.pay_rows[0];
    if (firstRow) {
      const fact =
        firstRow.band !== null
          ? `Pay range from ${firstRow.report_count} reports`
          : `${firstRow.report_count} of ${firstRow.threshold} reports so far`;
      section.appendChild(h('p', { class: 'figures' }, `${firstRow.role_name}, ${firstRow.city_name}. ${fact}`));
      if (firstRow.band) {
        section.appendChild(h('p', { class: 'figures' }, `${rangeText(firstRow.band.low, firstRow.band.high)} · Median ${rupees(firstRow.band.median)}`));
      }
    } else {
      section.appendChild(h('p', { class: 'muted' }, 'No pay reports yet.'));
    }
  }

  // The tile crossfades as each sample lab passes.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slug = (entry.target as HTMLElement).dataset.slug;
        if (!slug) continue;
        const section = sections.find((item) => item.dataset.slug === slug);
        void section;
      }
    },
    { root: reading, threshold: 0.5 },
  );
  sections.forEach((section, index) => {
    section.dataset.slug = SAMPLES[index];
    observer.observe(section);
  });

  // A simple scroll listener updates the tile as sections pass the middle.
  reading.addEventListener('scroll', () => {
    const middle = reading.clientHeight / 2;
    let current = -1;
    sections.forEach((section, index) => {
      const top = section.offsetTop - reading.scrollTop;
      if (top <= middle) current = index;
    });
    const target = current >= 0 ? SAMPLES[current] : 'Candour Bench';
    if (target !== tileSeed) {
      tileSeed = target;
      void api.get<Company>(`/api/companies/${target}`).then((company) => {
        const firstRow = company.pay_rows[0];
        const fact = firstRow
          ? firstRow.band !== null
            ? `Pay range from ${firstRow.report_count} reports`
            : `${firstRow.report_count} of ${firstRow.threshold} reports so far`
          : `${reviewCountText(company.rating.review_count)}`;
        const caption = `${company.name}, ${company.city_name}. ${firstRow ? '' : reviewCountText(company.rating.review_count)}`;
        const next = tileFigure(company.name, fact, company.slug);
        next.querySelector('figcaption')!.textContent = `${caption}`;
        field.replaceChild(next, figure);
      });
    }
  });
}
