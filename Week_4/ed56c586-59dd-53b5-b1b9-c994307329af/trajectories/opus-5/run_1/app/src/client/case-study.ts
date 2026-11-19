/** A case study: the Callout Thread, the frames and the `On this page` marking. */

import { frameKey } from '../shared/media.js';
import {
  CALLOUT_STEP_MS,
  CURRENT_SECTION_LINE,
  NO_CALLOUT_READOUT,
  calloutFrameAt,
  calloutReadout,
  lastTargetAboveLine,
} from '../shared/rules.js';
import { CASE_STUDY_SECTIONS, projectBySlug, type Callout } from '../shared/seed.js';
import { CALLOUT_CLEARED, calloutAnnouncement, frameAltText } from '../shared/text.js';
import { announce, need, onScrollOrResize, queryAll, reducedMotion } from './dom.js';
import { currentUrl, replaceAddress } from './jumps.js';
import { showFrame } from './media.js';

const markCurrentTocLink = (): void => {
  const targets = CASE_STUDY_SECTIONS.map((section) => {
    const element = need<HTMLElement>(`#${section.id}`);
    return { id: section.id, top: element.getBoundingClientRect().top };
  });
  const current = lastTargetAboveLine(targets, window.innerHeight, CURRENT_SECTION_LINE);
  for (const link of queryAll<HTMLElement>('[data-toc-link]')) {
    if (link.dataset.tocLink === current) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
};

export const setUpCaseStudy = (slug: string): void => {
  const project = projectBySlug(slug);
  if (project === undefined) return;
  const figure = need<HTMLElement>('[data-preview]');
  const stage = need<HTMLElement>('[data-preview-frame]', figure);
  const region = need<HTMLElement>('[data-callout-region]', figure);
  const readout = need<HTMLElement>('[data-readout]', figure);
  const buttons = queryAll<HTMLButtonElement>('[data-callout-button]');

  let selected: Callout | null = null;
  let stepTimer: number | null = null;

  const stopStepping = (): void => {
    if (stepTimer !== null) window.clearInterval(stepTimer);
    stepTimer = null;
  };

  const setFrame = (frame: number, crossfade: boolean): void => {
    showFrame(
      stage,
      frameKey(slug, frame),
      frameAltText(project.title, frame),
      frame,
      crossfade && !reducedMotion(),
    );
  };

  const writeAddress = (): void => {
    const url = currentUrl();
    if (selected === null) url.searchParams.delete('callout');
    else url.searchParams.set('callout', String(selected.n));
    replaceAddress(url);
  };

  const paintRegion = (callout: Callout | null, draw: boolean): void => {
    if (callout === null) {
      region.hidden = true;
      region.removeAttribute('style');
      return;
    }
    region.hidden = false;
    region.style.setProperty('--region-left', `${callout.region.left}%`);
    region.style.setProperty('--region-top', `${callout.region.top}%`);
    region.style.setProperty('--region-width', `${callout.region.width}%`);
    region.style.setProperty('--region-height', `${callout.region.height}%`);
    if (draw && !reducedMotion()) {
      region.getAnimations().forEach((animation) => animation.cancel());
      region.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], {
        duration: 300,
        easing: 'ease',
      });
    }
  };

  const paintButtons = (): void => {
    for (const button of buttons) {
      const isSelected = selected !== null && button.dataset.calloutButton === String(selected.n);
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  };

  const step = (callout: Callout): void => {
    stopStepping();
    if (reducedMotion()) {
      setFrame(callout.to, false);
      return;
    }
    setFrame(callout.from, false);
    if (callout.from === callout.to) return;
    const startedAt = Date.now();
    stepTimer = window.setInterval(() => {
      const frame = calloutFrameAt(callout.from, callout.to, Date.now() - startedAt);
      setFrame(frame, true);
      if (frame >= callout.to) stopStepping();
    }, CALLOUT_STEP_MS);
  };

  const select = (callout: Callout, options: { readonly stepping: boolean }): void => {
    selected = callout;
    figure.dataset.callout = String(callout.n);
    paintButtons();
    paintRegion(callout, options.stepping);
    readout.textContent = calloutReadout(callout);
    if (options.stepping) {
      step(callout);
      announce(calloutAnnouncement(callout.n, callout.label));
    } else {
      stopStepping();
      setFrame(callout.to, false);
    }
    writeAddress();
  };

  const clear = (withAnnouncement: boolean): void => {
    selected = null;
    delete figure.dataset.callout;
    stopStepping();
    paintButtons();
    paintRegion(null, false);
    readout.textContent = NO_CALLOUT_READOUT;
    setFrame(1, false);
    if (withAnnouncement) announce(CALLOUT_CLEARED);
    writeAddress();
  };

  const calloutAt = (index: number): Callout | undefined => project.callouts[index];

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const callout = calloutAt(index);
      if (callout === undefined) return;
      if (selected !== null && selected.n === callout.n) clear(true);
      else select(callout, { stepping: true });
    });
    button.addEventListener('keydown', (event) => {
      let next: number | null = null;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index + 1;
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index - 1;
      if (next === null) return;
      event.preventDefault();
      const callout = calloutAt(next);
      if (callout === undefined) return;
      buttons[next]?.focus({ preventScroll: true });
      select(callout, { stepping: true });
    });
  });

  const parameter = currentUrl().searchParams.get('callout');
  if (parameter !== null) {
    const callout = project.callouts.find((item) => String(item.n) === parameter);
    if (callout === undefined) {
      const url = currentUrl();
      url.searchParams.delete('callout');
      replaceAddress(url);
    } else {
      select(callout, { stepping: false });
    }
  }

  onScrollOrResize(markCurrentTocLink);
};
