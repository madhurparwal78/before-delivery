/**
 * The landing page: the tower camera descends from roof to podium as the five
 * band sections scroll over the fixed stage, and the field colour swaps at each
 * band boundary.
 */

import { get } from '../api';
import { Header } from '../chrome';
import { el, noticesNode, prefersReducedMotion } from '../dom';
import { loadSession } from '../session';
import { TowerScene } from '../tower/scene';
import { drawStillTower } from '../tower/still';
import { FLOOR_BANDS, HIGHEST_FLOOR } from '../../shared/units';
import type { TowerResponse } from '../../shared/types';
import type { Page } from '../router';

const DESCENT_PIXELS = 4800;
const SECTION_PIXELS = 960;
const FLOOR_SPAN = 35;

/** The bands, roof first, with the giant cropped storey number each one carries. */
const BAND_SECTIONS = [...FLOOR_BANDS].reverse().map((band) => ({ band, numeral: String(band.high) }));

const GROUND: [number, number, number] = [0.129, 0.157, 0.588];
const INK: [number, number, number] = [1, 1, 1];

export function createLandingPage(): Page {
  const header = new Header();
  const canvas = el('canvas', {
    class: 'landing-canvas',
    role: 'img',
    'aria-label': `Highwater tower at floor ${HIGHEST_FLOOR}`,
  }) as HTMLCanvasElement;
  const readout = el('p', { class: 'floor-readout tabular', text: `Floor ${HIGHEST_FLOOR}` });
  const stage = el('div', { class: 'landing-stage' }, [canvas]);
  const tally = el('section', { class: 'tally-field', role: 'region', 'aria-label': 'Available now' }, [
    el('h2', { text: 'Available now' }),
    el('p', { class: 'tally-line tabular', text: 'Counting homes...' }),
  ]);

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'hero-field' }, [
      el('h1', { class: 'hero-title', text: 'HIGHWATER' }),
      el('p', { class: 'hero-line', text: 'Look out of the window before you buy it.' }),
      el('a', { class: 'action action-accent hero-link', href: '/finder', text: 'Find your floor' }),
    ]),
    stage,
  ]);

  const sections = BAND_SECTIONS.map((entry, index) =>
    el('section', { class: `band-section band-${index % 2 === 0 ? 'ground' : 'ink'}`, 'data-band': entry.band.id }, [
      el('p', { class: 'giant-crop band-numeral', 'aria-hidden': 'true', text: entry.numeral }),
      el('h2', { class: 'band-title', text: `Floors ${entry.band.low}-${entry.band.high}` }),
      el('p', {
        class: 'band-copy',
        text:
          entry.band.id === '36-38'
            ? 'The roof band, where the harbour opens out.'
            : 'Sweep the Window Lens across this band to see the view from every window.',
      }),
    ]),
  );

  const main = el('main', { class: 'landing' }, [hero, ...sections, tally, el('footer', { class: 'landing-footer' }, [
    el('p', { text: 'Orrin & Vale Developments · Highwater, built 2029' }),
  ])]);
  const node = el('div', { class: 'page page-landing' }, [header.node, main, readout, noticesNode()]);

  let scene: TowerScene | null = null;
  let still = false;

  const setFloor = (floor: number): void => {
    readout.textContent = `Floor ${floor}`;
    canvas.setAttribute('aria-label', `Highwater tower at floor ${floor}`);
  };

  const bandIndexForScroll = (scrollY: number): number => {
    const index = Math.floor(scrollY / SECTION_PIXELS);
    return Math.max(0, Math.min(BAND_SECTIONS.length - 1, index));
  };

  /** Each field's giant numeral slides sideways by at most 8% of the window, then stops. */
  const slideNumerals = (): void => {
    sections.forEach((section, index) => {
      const numeral = section.querySelector<HTMLElement>('.band-numeral');
      if (!numeral) return;
      const progress = Math.min(1, Math.max(0, window.scrollY / SECTION_PIXELS - index));
      numeral.style.transform = `translateX(${(progress * 8).toFixed(2)}vw)`;
    });
  };

  const paintColours = (bandIndex: number): void => {
    const inverted = bandIndex % 2 === 1;
    stage.classList.toggle('stage-ink', inverted);
    if (scene) scene.setColours(inverted ? GROUND : INK, inverted ? INK : GROUND);
    if (still) drawStillTower(canvas, inverted ? GROUND : INK, inverted ? INK : GROUND);
  };

  /** The camera's height is tied to the first 4,800 pixels of scroll. */
  const onScroll = (): void => {
    const scrollY = window.scrollY;
    const bandIndex = bandIndexForScroll(scrollY);
    if (!prefersReducedMotion()) slideNumerals();
    if (prefersReducedMotion() || still) {
      const band = BAND_SECTIONS[bandIndex].band;
      setFloor(band.high);
      scene?.setCameraFloor(band.high);
      paintColours(bandIndex);
      return;
    }
    const progress = Math.min(1, scrollY / DESCENT_PIXELS);
    const floor = HIGHEST_FLOOR - Math.round(FLOOR_SPAN * progress);
    setFloor(floor);
    scene?.setCameraFloor(floor);
    paintColours(bandIndex);
  };

  void (async () => {
    await loadSession();
    const tower = await get<TowerResponse>('/api/tower');
    if (tower.ok && tower.data) {
      const available = tower.data.units.filter((unit) => unit.status === 'available').length;
      tally.querySelector('.tally-line')!.textContent = `${available} homes available now`;
      const created = TowerScene.create(canvas, () => {
        scene = null;
        still = true;
        drawStillTower(canvas, INK, GROUND);
      });
      if (created) {
        scene = created;
        try {
          await created.loadShell(tower.data.assets.shell);
        } catch {
          scene = null;
          still = true;
        }
      } else {
        still = true;
      }
      if (still) drawStillTower(canvas, INK, GROUND);
      onScroll();
    }
  })();

  window.addEventListener('scroll', onScroll, { passive: true });
  const onResize = (): void => {
    scene?.resize();
    if (still) drawStillTower(canvas, INK, GROUND);
    onScroll();
  };
  window.addEventListener('resize', onResize);

  return {
    node,
    destroy: () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    },
  };
}
