import { initChange, syncBatchLabels } from './change.js';
import { initForms } from './forms.js';
import { initHome } from './home.js';
import { initLayout } from './layout.js';
import { initLive } from './live.js';

function boot(): void {
  initLayout();
  initForms();
  initChange();
  initLive();
  initHome();
  syncBatchLabels();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
