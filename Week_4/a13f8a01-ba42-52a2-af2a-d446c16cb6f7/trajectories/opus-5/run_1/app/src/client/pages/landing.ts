import { copy } from '../../shared/copy';
import { starters } from '../../shared/starters';
import { siteHeader } from '../components/shell';
import { h } from '../dom';
import { mountPage } from '../layout';
import { PreviewHost } from '../preview';

const SECTIONS: readonly { heading: string; line: string }[] = [
  {
    heading: 'Pinned libraries',
    line: 'Pens load libraries only from a small pinned shelf that Ashlar serves itself, so nothing rots when a CDN moves a file.',
  },
  {
    heading: 'Every save is a version',
    line: 'Each save keeps the exact bytes you wrote. Walk the Core sample down, compare two versions line by line, and restore the one that worked.',
  },
  {
    heading: 'Embeds that keep working',
    line: 'Share a pen as an embed that opens on the tab you chose, and keeps running wherever you put it.',
  },
];

export const landingPage = (): void => {
  const region = h('div', {
    role: 'region',
    'aria-label': 'Starter pen',
    class: 'starter-region',
    'data-starter': '1',
  });

  const sections = SECTIONS.map((section) =>
    h('section', { class: 'hero-section' }, [
      h('h2', { text: section.heading }),
      h('p', { text: section.line }),
    ]),
  );

  const root = h('div', { class: 'shell landing' }, [
    siteHeader(),
    h('div', { class: 'hero' }, [
      h('div', { class: 'hero-inset' }, [region]),
      h('h1', { class: 'wordmark', text: 'ashlar' }),
      h('div', { class: 'hero-text' }, [h('p', { class: 'tagline', text: copy.tagline }), ...sections]),
    ]),
  ]);
  mountPage(root);

  const preview = new PreviewHost({ region, crossfade: true });
  let showing = 0;

  const paint = (index: number): void => {
    if (index === showing) return;
    showing = index;
    region.dataset.starter = String(index + 1);
    const starter = starters[index]!;
    void preview.show({ files: starter.files, libraries: starter.libraries }).catch(() => undefined);
  };

  region.dataset.starter = '1';
  void preview
    .show({ files: starters[0]!.files, libraries: starters[0]!.libraries })
    .catch(() => undefined);

  /** A starter arrives when its section's heading crosses the middle of the viewport. */
  const onScroll = (): void => {
    const middle = window.innerHeight / 2;
    let passed = 0;
    for (const section of sections) {
      const heading = section.querySelector('h2')!;
      if (heading.getBoundingClientRect().top < middle) passed += 1;
    }
    paint(Math.min(passed, starters.length - 1));
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
};
