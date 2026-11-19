/** The quick-look dialog: six preview frames for one project. */

import { FRAMES_PER_PROJECT, projectBySlug, type DisciplineId } from '../shared/seed.js';
import { frameKey } from '../shared/media.js';
import { projectHref } from '../shared/rules.js';
import { frameAltText } from '../shared/text.js';
import { need, queryAll, reducedMotion } from './dom.js';
import { currentUrl, replaceAddress } from './jumps.js';
import { createModal } from './modal.js';
import { showFrame, watchSlot } from './media.js';

export const setUpQuickLook = (pressed: () => readonly DisciplineId[]): void => {
  const layer = need<HTMLElement>('[data-dialog-layer="quicklook"]');
  const dialog = need<HTMLElement>('[data-quicklook]');
  const backdrop = need<HTMLElement>('[data-quicklook-backdrop]');
  const stage = need<HTMLElement>('[data-preview-frame]', dialog);
  const status = need<HTMLElement>('[data-quicklook-status]', dialog);
  const previousButton = need<HTMLButtonElement>('[data-quicklook-prev]', dialog);
  const nextButton = need<HTMLButtonElement>('[data-quicklook-next]', dialog);
  const caseLink = need<HTMLAnchorElement>('[data-quicklook-case]', dialog);
  const closeButton = need<HTMLButtonElement>('[data-quicklook-close]', dialog);

  let slug = '';
  let frame = 1;

  watchSlot(stage);
  const modal = createModal({ layer, dialog, backdrop });

  const paint = (next: number, crossfade: boolean): void => {
    frame = next;
    const project = projectBySlug(slug);
    if (project === undefined) return;
    showFrame(
      stage,
      frameKey(slug, frame),
      frameAltText(project.title, frame),
      frame,
      crossfade && !reducedMotion(),
    );
    status.textContent = `Frame ${frame} of ${FRAMES_PER_PROJECT}`;
    // Disabling the focused button blurs it, so its identity is read first.
    const wasFocused = document.activeElement;
    previousButton.disabled = frame === 1;
    nextButton.disabled = frame === FRAMES_PER_PROJECT;
    if (previousButton.disabled && wasFocused === previousButton) {
      nextButton.focus({ preventScroll: true });
    }
    if (nextButton.disabled && wasFocused === nextButton) {
      previousButton.focus({ preventScroll: true });
    }
  };

  const step = (delta: number): void => {
    const next = frame + delta;
    if (next < 1 || next > FRAMES_PER_PROJECT) return;
    paint(next, true);
  };

  previousButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  closeButton.addEventListener('click', () => modal.close());
  caseLink.addEventListener('click', () => {
    replaceAddress(currentUrl(), { returnSlug: slug });
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
  });

  for (const button of queryAll<HTMLButtonElement>('[data-preview-open]')) {
    button.addEventListener('click', () => {
      slug = button.dataset.previewOpen ?? '';
      const project = projectBySlug(slug);
      if (project === undefined) return;
      dialog.setAttribute('aria-label', `${project.title} preview`);
      caseLink.href = projectHref(slug, pressed());
      paint(1, false);
      modal.open(button, nextButton);
    });
  }
};
