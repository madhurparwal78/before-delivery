import { LISTING_WORD, OUTAGE, SECTIONS, STANDING_LABEL, type SectionId } from '../../shared/copy';
import { ApiRefusal } from '../shared/api';
import { carFileFooter, serviceNotice, statusRegion, unitsBar } from '../shared/chrome';
import { el, focusTarget, goToSection, onPress } from '../shared/dom';
import { announce } from '../shared/live';
import { playEntrances } from '../shared/motion';
import { anyOverlayOpen, focusFirstControl, openOverlay, type Overlay } from '../shared/overlay';
import { ReplyOrder, startPolling } from '../shared/poll';
import { PollAnnouncer } from '../shared/pollAnnounce';
import { unitsToggle } from '../shared/units';
import { evidenceSection } from './sectionsEvidence';
import { findingsSection } from './sectionsFindings';
import { panelsSection } from './sectionsPanels';
import { peopleSection } from './sectionsPeople';
import { publishSection } from './sectionsPublish';
import { recordSection } from './sectionsRecord';
import { alertsSection, offersSection, retryAlert, viewingsSection } from './sectionsRest';
import type { SectionContext, SectionView } from './sectionKit';
import { pollQuietly } from './session';
import { signOutButton } from './signout';
import { loadCarFile, type CarFileState } from './state';

/** Every section's standing line, derived on the server. */
const standingLines = (state: CarFileState): Readonly<Record<SectionId, string>> => {
  const standing = state.car.standing;
  return {
    panels: STANDING_LABEL.panels(standing.panelsRead, standing.panelsGaugeable),
    findings: STANDING_LABEL.findings(standing.findings),
    evidence: STANDING_LABEL.evidence(standing.files),
    record: STANDING_LABEL.record(state.car.workingOpenAdvisories),
    publish: STANDING_LABEL.publish(state.car.publishBlockers.length),
    people: STANDING_LABEL.people(standing.activeLinks),
    viewings: STANDING_LABEL.viewings(standing.slotsHeld, standing.slots),
    offers: STANDING_LABEL.offers(standing.liveOffers),
    alerts: STANDING_LABEL.alerts(standing.failedAlerts),
  };
};

export const renderCarFile = async (root: HTMLElement, carId: string): Promise<void> => {
  const status = statusRegion('Owner status');
  const notice = serviceNotice();
  notice.hidden = true;
  const order = new ReplyOrder();
  const announcer = new PollAnnouncer<SectionId>(
    () => status,
    SECTIONS.map((section) => section.id),
  );

  let state: CarFileState;
  try {
    state = await loadCarFile(carId);
  } catch (error) {
    if (error instanceof ApiRefusal && error.status === 404) {
      root.replaceChildren(
        el('main', { class: 'unknown-car' }, [
          el('div', { class: 'notice-panel' }, [
            el('h1', { class: 'notice-heading', text: 'We could not find that car file' }),
          ]),
        ]),
        carFileFooter(),
      );
      return;
    }
    throw error;
  }

  const sections: SectionView[] = [];
  let sheet: Overlay | null = null;

  const context: SectionContext = {
    carId,
    status,
    notice,
    state: () => state,
    refresh: async (changed) => {
      const ticket = order.next();
      const next = await loadCarFile(carId);
      if (!order.accept(ticket)) return;
      state = next;
      paintAll();
      announcer.refresh(changed, standingLines(state));
    },
    goTo: (id) => {
      const section = sections.find((candidate) => candidate.id === id);
      if (section === undefined) return;
      window.history.replaceState(null, '', `#${id}`);
      goToSection(section.node, section.heading);
    },
    onOverlayClosed: () => {
      if (!anyOverlayOpen()) announcer.flush(standingLines(state));
    },
  };

  sections.push(
    panelsSection(context),
    findingsSection(context),
    evidenceSection(context),
    recordSection(context),
    publishSection(context),
    peopleSection(context),
    viewingsSection(context),
    offersSection(context),
    alertsSection(context),
  );

  // Section navigation, inline at 768 pixels and above.
  const navList = el('ul', { class: 'section-nav-list' });
  const navLines = new Map<SectionId, HTMLElement>();
  for (const section of SECTIONS) {
    const link = el('a', { class: 'section-nav-link', href: `#${section.id}`, text: section.heading });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      context.goTo(section.id);
    });
    const line = el('p', { class: 'standing-line' });
    navLines.set(section.id, line);
    navList.append(el('li', { class: 'section-nav-item' }, [link, line]));
  }
  const nav = el('nav', { class: 'section-nav', 'aria-label': 'Car file sections' }, [navList]);

  // The car file bar and sections sheet at 767 pixels and below.
  const barStatus = el('span', { class: 'bar-status' });
  const sectionsButton = el('button', { type: 'button', class: 'pill-solid', text: 'Sections' });
  const bar = el('div', { class: 'car-file-bar', role: 'region', 'aria-label': 'Car file bar' }, [
    barStatus,
    sectionsButton,
  ]);

  const openSheet = (): void => {
    if (sheet !== null && sheet.exiting) {
      sheet.cancelExit();
      sheet = null;
    }
    if (sheet !== null && sheet.open) return;
    const overlay = openOverlay({
      name: 'Car file sections',
      variant: 'sections',
      opener: sectionsButton,
      scrimCloses: true,
      onClosed: () => {
        sheet = null;
        context.onOverlayClosed?.();
      },
    });
    sheet = overlay;

    const close = el('button', { type: 'button', class: 'pill-outline', text: 'Close' });
    onPress(close, () => overlay.close());

    const sheetList = el('ul', { class: 'sheet-section-list' });
    const sheetLines = new Map<SectionId, HTMLElement>();
    const sheetItems = new Map<SectionId, HTMLElement>();

    for (const section of SECTIONS) {
      const link = el('a', { class: 'section-nav-link', href: `#${section.id}`, text: section.heading });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        overlay.close();
        context.goTo(section.id);
      });
      const line = el('p', { class: 'standing-line' });
      sheetLines.set(section.id, line);
      const item = el('li', { class: 'section-nav-item' }, [link, line]);
      sheetItems.set(section.id, item);
      sheetList.append(item);
    }

    const paintSheet = (): void => {
      const lines = standingLines(state);
      for (const [id, node] of sheetLines) node.textContent = lines[id];
      const alertsItem = sheetItems.get('alerts');
      const existing = alertsItem?.querySelector<HTMLElement>('button');
      const failed = state.alerts.filter((alert) => alert.state === 'failed');
      if (alertsItem === undefined) return;
      if (failed.length === 0) {
        if (existing !== null && existing !== undefined) {
          const hadFocus = document.activeElement === existing;
          existing.remove();
          if (hadFocus) {
            const link = alertsItem.querySelector<HTMLElement>('a');
            if (link !== null) focusTarget(link);
          }
        }
        return;
      }
      const newest = failed[0];
      if (existing !== null && existing !== undefined) {
        if (existing.dataset.pending === 'true') return;
        existing.dataset.alertId = newest.id;
        return;
      }
      const retry = el('button', { type: 'button', class: 'pill-outline sheet-retry', text: 'Retry' });
      retry.dataset.alertId = newest.id;
      onPress(retry, () => {
        const alert = state.alerts.find((candidate) => candidate.id === retry.dataset.alertId);
        if (alert === undefined) return;
        void retryAlert(
          context,
          alert,
          retry,
          alertsItem.querySelector<HTMLElement>('a') ?? retry,
          overlay.status,
          overlay.status,
        );
      });
      alertsItem.append(retry);
    };

    overlay.body.append(
      el('h2', { class: 'dialog-heading', text: 'Car file sections' }),
      el('div', { class: 'sheet-units' }, [el('span', { text: 'Units' }), unitsToggle()]),
      el('nav', { class: 'sheet-nav', 'aria-label': 'Car file sections' }, [sheetList]),
      close,
    );
    paintSheet();
    sheetRepaint = paintSheet;
    focusFirstControl(overlay);
  };

  let sheetRepaint: (() => void) | null = null;
  onPress(sectionsButton, openSheet);

  const paintAll = (): void => {
    for (const section of sections) section.paint(state);
    const lines = standingLines(state);
    for (const [id, node] of navLines) node.textContent = lines[id];
    barStatus.textContent = LISTING_WORD[state.car.listingStatus];
    if (sheet !== null && sheet.open) sheetRepaint?.();
  };

  root.replaceChildren(
    unitsBar(),
    el('header', { class: 'owner-header' }, [
      el('span', { class: 'wordmark', text: 'Ostler Lane' }),
      el('h1', { class: 'owner-heading', text: state.car.name }),
      el('p', { class: 'owner-registration figures', text: state.car.registration }),
      signOutButton(status),
    ]),
    notice,
    status,
    el('main', { class: 'car-file-main' }, [nav, ...sections.map((section) => section.node)]),
    bar,
    carFileFooter(),
  );

  // A failed alert raised while the car file is open gets the notice once.
  const reportedFailures = new Set(
    state.alerts.filter((alert) => alert.state === 'failed').map((alert) => alert.id),
  );

  announcer.prime(standingLines(state));
  paintAll();
  playEntrances(root);

  const fragment = window.location.hash.replace('#', '');
  const wanted = SECTIONS.find((section) => section.id === fragment);
  if (wanted !== undefined) context.goTo(wanted.id);
  else {
    const heading = root.querySelector<HTMLElement>('.owner-heading');
    if (heading !== null) focusTarget(heading);
  }

  startPolling(async () => {
    const ticket = order.next();
    const next = await pollQuietly(() => loadCarFile(carId));
    if (next === null) return;
    if (!order.accept(ticket)) return;
    state = next;
    paintAll();
    announcer.check(standingLines(state), anyOverlayOpen());
    for (const alert of state.alerts) {
      if (alert.state !== 'failed' || reportedFailures.has(alert.id)) continue;
      reportedFailures.add(alert.id);
      notice.hidden = false;
      announce(notice, OUTAGE.alert);
    }
  });
};
