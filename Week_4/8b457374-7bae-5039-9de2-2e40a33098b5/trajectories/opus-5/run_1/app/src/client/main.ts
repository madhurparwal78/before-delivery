import { el } from './dom.js';
import { startRouter, type NavigateOptions, type Route } from './router.js';
import { mountShell } from './ui/chrome.js';
import { renderCampaign } from './pages/campaign.js';
import { renderEditor } from './pages/editor.js';
import { renderFix } from './pages/fix.js';
import { renderHome } from './pages/home.js';
import { renderNotFound } from './pages/notFound.js';
import { renderPledges } from './pages/pledges.js';
import { renderStudio } from './pages/studio.js';

/** Full-bleed bands measure against the layout viewport, so no page scrolls sideways. */
function trackViewportWidth(): void {
  const apply = (): void => {
    document.documentElement.style.setProperty(
      '--viewport-width',
      `${document.documentElement.clientWidth}px`,
    );
  };
  apply();
  window.addEventListener('resize', apply, { passive: true });
}

function boot(): void {
  trackViewportWidth();
  const root = document.getElementById('app') ?? el('div', { id: 'app' });
  if (root.parentElement === null) document.body.appendChild(root);
  const shell = mountShell(root);

  let teardown: (() => void) | null = null;

  const show = (route: Route, options: NavigateOptions): void => {
    teardown?.();
    teardown = null;
    window.scrollTo({ top: 0 });
    switch (route.name) {
      case 'home':
        renderHome(shell.main);
        return;
      case 'campaign':
        teardown = renderCampaign(shell.main, route.id, options.focusChange === true);
        return;
      case 'studio':
        renderStudio(shell.main);
        return;
      case 'editor':
        renderEditor(shell.main, route.id);
        return;
      case 'pledges':
        teardown = renderPledges(shell.main);
        return;
      case 'fix':
        teardown = renderFix(shell.main, route.id);
        return;
      case 'notFound':
        renderNotFound(shell.main);
        return;
    }
  };

  startRouter(show);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
