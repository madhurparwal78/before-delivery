/** The browser entry point: it wires each page's behaviour. */

import { setUpCaseStudy } from './case-study.js';
import { setUpCursor, setUpFooterWave } from './chrome.js';
import { setUpCounters } from './counters.js';
import { watchFocus, watchScroll } from './dom.js';
import { setUpForm } from './form.js';
import { setUpGallery } from './gallery.js';
import { setUpHero } from './hero.js';
import {
  handleArrival,
  watchCurrentSection,
  watchHistory,
  watchJumpLinks,
  watchSkipLink,
  watchTopLinks,
} from './jumps.js';
import { setUpJourney } from './journey.js';
import { setUpMedia } from './media.js';
import { setUpMenu } from './menu.js';
import { setUpQuickLook } from './quicklook.js';
import { setUpReviews } from './reviews.js';
import { applyServiceParameter, setUpServices } from './services.js';
import { setUpSkills } from './skills.js';

const page = document.body.dataset.page ?? '';

/**
 * The browser's own fragment handling runs when loading finishes and moves both
 * the scroll position and focus, so the arrival is placed again after it.
 */
const arrive = (place: () => void): void => {
  place();
  if (document.readyState !== 'complete') window.addEventListener('load', place, { once: true });
};

// The page places every arrival itself, so the browser does not also restore one.
history.scrollRestoration = 'manual';

watchFocus();
watchSkipLink();
watchJumpLinks();
watchTopLinks();
setUpMenu();
setUpCursor();
setUpFooterWave();
setUpMedia();

if (page === 'home') {
  const gallery = setUpGallery();
  setUpHero();
  setUpJourney();
  setUpCounters();
  setUpServices();
  setUpSkills();
  setUpReviews();
  setUpForm();
  setUpQuickLook(gallery.pressed);
  watchCurrentSection();
  watchScroll();

  gallery.applyFromAddress({ rewrite: true });
  arrive(() => {
    if (!applyServiceParameter()) handleArrival({ handled: gallery.returnFocus });
  });
  watchHistory(() => gallery.applyFromAddress({ rewrite: false }));
} else {
  if (page === 'case-study') setUpCaseStudy(document.body.dataset.slug ?? '');
  watchScroll();
  arrive(() => handleArrival());
  watchHistory(() => undefined);
}
