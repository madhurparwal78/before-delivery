/**
 * The browser entry point. It wires only the screen it is on.
 */

import { deskData, find, wireLanguageSwitch } from './dom';
import { FittingFan } from './fan';
import { wireClaimForm, wireConfirmPage, wireFindPage, wireSentPage } from './owner';
import { wireDisclosures, wireEditions, wireImports, wireSignIn, wireWorkspace } from './operator';
import { wireSharePage } from './share';

function start(): void {
  wireLanguageSwitch();
  wireDisclosures();

  if (find('#claim-form') !== null) wireClaimForm();
  if (find('.sent-page') !== null) wireSentPage();
  if (find('.confirm-page') !== null) wireConfirmPage();
  if (find('#find-form') !== null) wireFindPage();
  if (find('#sign-in-form') !== null) wireSignIn();
  if (find('#edition-form') !== null) wireEditions();
  if (find('#import-file') !== null) wireImports();

  const share = find<HTMLElement>('.share-page');
  if (share !== null) {
    // The share page's fan is read-only, so it only needs the slider.
    FittingFan.mountAll();
    wireSharePage(share.dataset['shareToken'] ?? '');
  }

  const workspace = find<HTMLElement>('.workspace');
  if (workspace !== null) wireWorkspace(workspace.dataset['reference'] ?? deskData().reference ?? '');

  // Markup the server re-rendered in place brings a fresh fan and disclosures.
  window.addEventListener('desk:remount', () => {
    FittingFan.mountAll();
    wireDisclosures();
  });
}

start();
