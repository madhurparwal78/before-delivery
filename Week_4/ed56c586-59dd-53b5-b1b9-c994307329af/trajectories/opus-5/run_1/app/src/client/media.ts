/**
 * The media slots: loading, the fallback plate, the library notice and recovery.
 * Every object reaches the browser through the app's own `/media/<key>` route.
 */

import { MEDIA_RECHECK_MS } from '../shared/rules.js';
import { mediaHref } from '../shared/media.js';
import {
  COVER_UNAVAILABLE,
  FRAME_BACK,
  FRAME_STILL_UNAVAILABLE,
  FRAME_UNAVAILABLE,
  MEDIA_BACK,
  MEDIA_NOTICE,
} from '../shared/text.js';
import { announce, focusWithRule, need, query, queryAll } from './dom.js';

interface MediaReport {
  readonly status: 'available' | 'unavailable';
}

let libraryUnavailable = false;
let recheckTimer: number | null = null;
let pendingReport: Promise<MediaReport> | null = null;
let retryCount = 0;

const slotImage = (slot: HTMLElement): HTMLImageElement => need('[data-media-image]', slot);

const notice = (): HTMLElement => need<HTMLElement>('[data-media-notice]');

const askLibrary = (): Promise<MediaReport> => {
  pendingReport ??= fetch('/api/media')
    .then((response) => response.json() as Promise<MediaReport>)
    .catch(() => ({ status: 'unavailable' }) as MediaReport)
    .finally(() => {
      pendingReport = null;
    });
  return pendingReport;
};

const plateFor = (slot: HTMLElement): HTMLElement => {
  const image = slotImage(slot);
  const isFrame = slot.dataset.mediaKind === 'frame';
  const plate = document.createElement('div');
  plate.className = 'fallback-plate';
  plate.dataset.fallbackPlate = 'true';
  const art = document.createElement('span');
  art.className = 'plate-art';
  art.setAttribute('role', 'img');
  art.setAttribute('aria-label', image.alt);
  const caption = document.createElement('p');
  caption.className = 'plate-caption';
  caption.textContent = isFrame ? FRAME_UNAVAILABLE : COVER_UNAVAILABLE;
  plate.append(art, caption);
  if (isFrame) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.dataset.tryAgain = 'true';
    retry.addEventListener('click', () => {
      void retrySlot(slot);
    });
    plate.append(retry);
  }
  return plate;
};

const showPlate = (slot: HTMLElement): void => {
  if (slot.dataset.fallback === 'true') {
    const existing = query<HTMLElement>('[data-fallback-plate]', slot);
    if (existing !== null) {
      const art = need<HTMLElement>('.plate-art', existing);
      art.setAttribute('aria-label', slotImage(slot).alt);
      return;
    }
  }
  slot.dataset.fallback = 'true';
  slot.append(plateFor(slot));
};

const clearPlate = (slot: HTMLElement): void => {
  delete slot.dataset.fallback;
  query<HTMLElement>('[data-fallback-plate]', slot)?.remove();
};

/** Asks for a slot's object again and resolves with whether it arrived. */
const loadSlot = (slot: HTMLElement): Promise<boolean> => {
  const image = slotImage(slot);
  const key = slot.dataset.mediaKey ?? '';
  retryCount += 1;
  return new Promise((resolve) => {
    const settle = (arrived: boolean): void => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      resolve(arrived);
    };
    const onLoad = (): void => settle(true);
    const onError = (): void => settle(false);
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    image.src = `${mediaHref(key)}?retry=${retryCount}`;
  });
};

const retrySlot = async (slot: HTMLElement): Promise<void> => {
  const arrived = await loadSlot(slot);
  if (!arrived) {
    announce(FRAME_STILL_UNAVAILABLE);
    return;
  }
  clearPlate(slot);
  announce(FRAME_BACK);
  const figure = slot.closest<HTMLElement>('[data-preview]') ?? slot;
  focusWithRule(figure);
};

const everySlot = (): HTMLElement[] => queryAll<HTMLElement>('[data-media-slot]');

const stopRecheck = (): void => {
  if (recheckTimer !== null) window.clearInterval(recheckTimer);
  recheckTimer = null;
};

const libraryReturned = async (): Promise<void> => {
  libraryUnavailable = false;
  stopRecheck();
  const element = notice();
  element.textContent = '';
  element.hidden = true;
  await Promise.all(
    everySlot().map(async (slot) => {
      if (slot.dataset.mediaKey === undefined) return;
      const arrived = await loadSlot(slot);
      if (arrived) clearPlate(slot);
    }),
  );
  announce(MEDIA_BACK);
};

const startRecheck = (): void => {
  if (recheckTimer !== null) return;
  recheckTimer = window.setInterval(() => {
    void askLibrary().then((report) => {
      if (report.status === 'available') void libraryReturned();
    });
  }, MEDIA_RECHECK_MS);
};

const showLibraryNotice = (): void => {
  libraryUnavailable = true;
  const element = notice();
  element.hidden = false;
  element.textContent = MEDIA_NOTICE;
  for (const slot of everySlot()) {
    if (slot.dataset.mediaKey !== undefined) showPlate(slot);
  }
  startRecheck();
};

const handleFailure = async (slot: HTMLElement): Promise<void> => {
  if (libraryUnavailable) {
    showPlate(slot);
    return;
  }
  const report = await askLibrary();
  if (report.status === 'unavailable') {
    showLibraryNotice();
    return;
  }
  showPlate(slot);
};

/** Watches a slot's image, so a failed request becomes a fallback plate. */
export const watchSlot = (slot: HTMLElement): void => {
  const image = slotImage(slot);
  image.addEventListener('error', () => {
    if (image.getAttribute('src') === '') return;
    void handleFailure(slot);
  });
  if (image.complete && image.naturalWidth === 0 && image.getAttribute('src') !== '') {
    void handleFailure(slot);
  }
};

export const setUpMedia = (): void => {
  for (const slot of everySlot()) watchSlot(slot);
};

/** Points a frame slot at another frame, crossfading from the one it shows. */
export const showFrame = (
  slot: HTMLElement,
  key: string,
  altText: string,
  frame: number,
  crossfade: boolean,
): void => {
  const image = slotImage(slot);
  const previous = image.getAttribute('src');
  slot.dataset.frame = String(frame);
  slot.dataset.mediaKey = key;
  if (crossfade && previous !== null && previous !== '' && slot.dataset.fallback !== 'true') {
    slot.style.backgroundImage = `url("${previous}")`;
    image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
  } else {
    slot.style.backgroundImage = '';
  }
  clearPlate(slot);
  image.alt = altText;
  image.src = mediaHref(key);
  if (libraryUnavailable) showPlate(slot);
};
