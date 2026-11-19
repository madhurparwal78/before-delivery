/**
 * The desk's screens. Each publishes its level-one heading and its page title
 * in the server's first response; the data behind it comes from the API.
 */
import { escapeHtml } from '../domain/markup.ts';
import { F } from '../../shared/feedback.ts';
import { deskHeader, renderDocument } from './shell.ts';

const DESK_SUFFIX = ' \u2014 Semenza Desk';

export interface DeskScreen {
  /** The route pattern, with `:id` for a captured part. */
  pattern: string;
  screen: string;
  /** The nav link this screen belongs to. */
  nav: string;
  heading: (names: ScreenNames) => string;
  /** The main action's label, or null where the screen lists none. */
  mainAction: string | null;
}

export interface ScreenNames {
  pieceTitle: string;
  clientName: string;
}

export const DESK_SCREENS: readonly DeskScreen[] = [
  { pattern: '/pieces', screen: 'pieces', nav: '/pieces', heading: () => 'Pieces', mainAction: 'New piece' },
  { pattern: '/pieces/:id', screen: 'piece', nav: '/pieces', heading: (n) => n.pieceTitle, mainAction: 'Send client page' },
  { pattern: '/pieces/:id/condition', screen: 'condition', nav: '/pieces', heading: (n) => `Condition of ${n.pieceTitle}`, mainAction: 'Add a pin' },
  { pattern: '/pieces/:id/photographs', screen: 'photographs', nav: '/pieces', heading: (n) => `Photographs of ${n.pieceTitle}`, mainAction: 'Add photographs' },
  { pattern: '/pieces/:id/hide', screen: 'hide', nav: '/pieces', heading: (n) => `Hide for ${n.pieceTitle}`, mainAction: null },
  { pattern: '/pieces/:id/estimate', screen: 'estimate', nav: '/pieces', heading: (n) => `Estimate for ${n.pieceTitle}`, mainAction: 'Edit estimate' },
  { pattern: '/pieces/:id/collection', screen: 'collection', nav: '/pieces', heading: (n) => `Collection of ${n.pieceTitle}`, mainAction: 'Book a collection' },
  { pattern: '/pieces/:id/dossier', screen: 'dossier', nav: '/pieces', heading: (n) => `Dossier for ${n.pieceTitle}`, mainAction: 'Make dossier' },
  { pattern: '/clients', screen: 'clients', nav: '/clients', heading: () => 'Clients', mainAction: 'New client' },
  { pattern: '/clients/:id', screen: 'client', nav: '/clients', heading: (n) => n.clientName, mainAction: 'Rename client' },
  { pattern: '/library', screen: 'library', nav: '/library', heading: () => 'Material library', mainAction: 'Hold a dye lot' },
  { pattern: '/bench', screen: 'bench', nav: '/bench', heading: () => 'Bench', mainAction: 'Add job' },
  { pattern: '/workbook', screen: 'workbook', nav: '/workbook', heading: () => 'Old workbook', mainAction: 'Save' },
  { pattern: '/rates', screen: 'rates', nav: '/rates', heading: () => 'Labour rates', mainAction: 'New rate' },
];

export function matchDeskScreen(path: string): { screen: DeskScreen; id: string | null } | null {
  const parts = path.split('/');
  for (const screen of DESK_SCREENS) {
    const expected = screen.pattern.split('/');
    if (expected.length !== parts.length) continue;
    let id: string | null = null;
    let ok = true;
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i] === ':id') {
        if (!/^\d+$/.test(parts[i]!)) {
          ok = false;
          break;
        }
        id = parts[i]!;
      } else if (expected[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { screen, id };
  }
  return null;
}

/** The hide's bar is its own toolbar, not the screen's main action. */
function bottomBar(screen: DeskScreen): string {
  if (screen.screen === 'hide') {
    return `<div class="bottom-bar" role="toolbar" aria-label="Hide controls" id="hide-controls"></div>`;
  }
  if (!screen.mainAction) return '';
  return `<div class="bottom-bar" role="toolbar" aria-label="Main action">
    <button type="button" class="button-primary" data-main-action>${escapeHtml(screen.mainAction)}</button>
  </div>`;
}

export function renderDeskScreen(screen: DeskScreen, names: ScreenNames, id: string | null): string {
  const heading = screen.heading(names);
  const main = `<section class="bento screen-${screen.screen}" data-piece="${escapeHtml(id ?? '')}">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">${escapeHtml(heading)}</h1>
  <div role="region" aria-label="Problems" id="problems" hidden><h2>Problems</h2><ul></ul></div>
  <div id="screen-body" class="screen-body"><p class="tile tile-loading">${escapeHtml(F.loading)}</p></div>
  ${bottomBar(screen)}
</section>`;

  return renderDocument({
    title: `${heading}${DESK_SUFFIX}`,
    lang: 'en',
    dir: 'ltr',
    header: deskHeader(screen.nav),
    main,
    screen: screen.screen,
    bodyClass: 'desk',
  });
}
