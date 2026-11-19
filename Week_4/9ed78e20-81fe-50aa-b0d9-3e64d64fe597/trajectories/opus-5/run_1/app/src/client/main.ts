import { startConsoleActions, startServiceStatus } from './consoleapp.js';
import { startContinuity } from './continuity.js';
import { all, formatDateTime } from './dom.js';
import {
  startApplicationForm,
  startCareersFilters,
  startResendForm,
  startSearchPage,
  startSignIn,
  startTracking,
} from './forms.js';
import { startGallery } from './gallery.js';
import {
  startChartEntry,
  startGalleryEntry,
  startReveals,
  startThesisProgress,
} from './motion.js';
import { startConsoleDialogs, startDisclosures } from './nav.js';
import { startClaimTether } from './tether.js';

function localisePublishedTimes(): void {
  for (const element of all('.published[data-instant]')) {
    const instant = new Date(element.dataset.instant ?? '');
    if (Number.isNaN(instant.getTime())) continue;
    element.textContent = `Published ${formatDateTime(instant)} your time (${formatDateTime(
      instant,
      'Europe/London',
    )} London)`;
  }
}

function start(): void {
  document.documentElement.classList.add('js');
  localisePublishedTimes();
  startDisclosures();
  startReveals();
  startThesisProgress();
  startChartEntry();
  startGalleryEntry();
  startGallery();
  startClaimTether();
  startContinuity();
  startApplicationForm();
  startResendForm();
  startTracking();
  startSignIn();
  startSearchPage();
  startCareersFilters();
  startConsoleDialogs();
  startConsoleActions();
  startServiceStatus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
