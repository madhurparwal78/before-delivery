/**
 * The browser's entry point. It reads which screen the server rendered and
 * hands over to it, then keeps the router and the refresh loop running.
 */
import { startRouter, watchHeaderScroll } from './router.ts';
import { find } from './ui/dom.ts';
import { onReducedMotionChange } from './ui/motion.ts';
import {
  setRefresher,
  startRefreshLoop,
  wireMenu,
  wirePasswordAndSignOut,
  wireSearch,
} from './screens/deskShell.ts';
import {
  wireAccessForms,
  wireEnquiryForm,
  wireSectionRail,
  wireWorkPage,
  wireWorkPanel,
} from './screens/publicSite.ts';
import { startPieces } from './screens/pieces.ts';
import { startCondition } from './screens/condition.ts';
import { startHide } from './screens/hide.ts';
import { startEstimate } from './screens/estimate.ts';
import { startLibrary } from './screens/library.ts';
import { startBench } from './screens/bench.ts';
import { startClient, startClients, startPiece } from './screens/pieceAndClients.ts';
import {
  startCollection,
  startDossier,
  startPhotographs,
  startRates,
  startWorkbook,
} from './screens/filesAndRest.ts';
import { startClientPage } from './screens/clientPage.ts';

type Start = () => void | Promise<void>;

const DESK_SCREENS: Record<string, Start> = {
  pieces: startPieces,
  piece: startPiece,
  condition: startCondition,
  photographs: startPhotographs,
  hide: startHide,
  estimate: startEstimate,
  collection: startCollection,
  dossier: startDossier,
  clients: startClients,
  client: startClient,
  library: startLibrary,
  bench: startBench,
  workbook: startWorkbook,
  rates: startRates,
};

let deskWired = false;

function wireDeskShellOnce(): void {
  if (deskWired) return;
  if (!find('#desk-header')) return;
  deskWired = true;
  wireSearch();
  wirePasswordAndSignOut();
  wireMenu();
  startRefreshLoop();
}

function startScreen(screen: string): void {
  setRefresher(null);
  wireWorkPanel();
  watchHeaderScroll();

  switch (screen) {
    case 'home':
      return;
    case 'work':
      wireWorkPage();
      return;
    case 'case':
      wireSectionRail();
      return;
    case 'enquire':
      wireEnquiryForm();
      return;
    case 'sign-in':
    case 'sign-up':
      wireAccessForms();
      find<HTMLElement>('#page-heading')?.focus();
      return;
    case 'client-page':
      startClientPage();
      return;
    case 'client-page-ended':
    case 'not-found':
      return;
    default:
      break;
  }

  const start = DESK_SCREENS[screen];
  if (!start) return;
  wireDeskShellOnce();
  void Promise.resolve(start()).catch((error: unknown) => {
    console.error('screen failed', error);
  });
}

startRouter(startScreen);
// Turning reduced motion on or off applies from the next animation.
onReducedMotionChange(() => undefined);
startScreen(document.body.dataset.screen ?? '');
