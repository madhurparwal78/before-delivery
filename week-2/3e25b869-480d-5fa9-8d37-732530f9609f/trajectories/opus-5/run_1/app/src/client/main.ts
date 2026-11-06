import { initLocale } from './i18n.js';
import { installPalette } from './palette.js';
import { addRoute, installHistory, renderCurrent, setNotFound } from './router.js';
import { installLinkInterception } from './shell.js';
import { renderAccount, renderOrder, renderSubscription } from './pages/account.js';
import { renderCheckout } from './pages/checkout.js';
import { renderContact } from './pages/contact.js';
import { renderDrop } from './pages/drop.js';
import { renderNotFound } from './pages/not-found.js';
import { renderPlaced } from './pages/placed.js';
import { renderSubscribe } from './pages/subscribe.js';
import { renderBatches } from './pages/studio/batches.js';
import { renderFinance } from './pages/studio/finance.js';
import { renderAudit, renderNotices, renderReconciliation } from './pages/studio/ledger.js';
import { renderPacking } from './pages/studio/packing.js';
import { renderStudio, type StudioPage, type StudioRenderer } from './pages/studio/shell.js';

const STUDIO_RENDERERS: Record<StudioPage, StudioRenderer> = {
  batches: renderBatches,
  packing: renderPacking,
  finance: renderFinance,
  reconciliation: renderReconciliation,
  audit: renderAudit,
  notices: renderNotices,
};

function studioRoute(page: StudioPage | null): (main: HTMLElement) => Promise<void> {
  return (main) => renderStudio(main, page, STUDIO_RENDERERS);
}

installPalette();
initLocale();

addRoute('/', (main) => renderDrop(main, new URLSearchParams(location.search)));
addRoute('/checkout', renderCheckout);
addRoute('/checkout/placed/:number', renderPlaced);
addRoute('/subscribe', renderSubscribe);
addRoute('/account', renderAccount);
addRoute('/account/orders/:number', renderOrder);
addRoute('/account/subscriptions/:number', renderSubscription);
addRoute('/contact', renderContact);
addRoute('/studio', studioRoute(null));
addRoute('/studio/batches', studioRoute('batches'));
addRoute('/studio/packing', studioRoute('packing'));
addRoute('/studio/finance', studioRoute('finance'));
addRoute('/studio/reconciliation', studioRoute('reconciliation'));
addRoute('/studio/audit', studioRoute('audit'));
addRoute('/studio/notices', studioRoute('notices'));
setNotFound(renderNotFound);

installLinkInterception();
installHistory();
void renderCurrent();
