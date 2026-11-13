import { DEMO_STOPS } from '../../generated/demo.js';
import { LANDING_COPY } from '../../shared/copy.js';
import { element } from '../dom.js';
import type { Stop } from '../field.js';
import type { Screen, ScreenContext } from './screen.js';

/**
 * Landing always plays the three bundled demo stops, with no help from the database or the
 * object store, and in millimetres whatever unit is saved in Settings.
 */
export function renderLanding({ shell }: ScreenContext): Screen {
  const stops: Stop[] = DEMO_STOPS.map((demo) => ({
    key: demo.slug,
    title: demo.title,
    maker: demo.maker,
    year: demo.year,
    sizeLine: demo.size_line,
    swatch: demo.swatch,
    photoUrl: demo.photo_url,
  }));

  const hero = element('section', { class: 'hero' }, [
    element('p', { class: 'wordmark' }, [LANDING_COPY.wordmark]),
    element('div', { class: 'hero-copy' }, [
      element('h1', {}, [LANDING_COPY.headline]),
      element('p', { class: 'hero-sentence' }, [LANDING_COPY.sentence]),
      element('a', { class: 'action primary', href: '/library' }, [LANDING_COPY.action]),
    ]),
  ]);

  const sections = DEMO_STOPS.map((demo) =>
    element('section', { class: 'demo-section' }, [
      element('h2', {}, [demo.title]),
      element('p', { class: 'demo-facts' }, [`${demo.maker} ${demo.year}`]),
      element('p', { class: 'demo-size' }, [demo.size_line]),
      element('p', { class: 'demo-blurb' }, [demo.blurb]),
    ]),
  );

  shell.main.append(hero, ...sections);
  shell.field.showReel(stops, {
    initialIndex: 0,
    rowFor: (index) => sections[index] ?? null,
    onChange: () => undefined,
  });
  shell.field.setStandIn(LANDING_COPY.standIn);

  return {
    destroy() {
      shell.field.setStandIn(null);
    },
  };
}
