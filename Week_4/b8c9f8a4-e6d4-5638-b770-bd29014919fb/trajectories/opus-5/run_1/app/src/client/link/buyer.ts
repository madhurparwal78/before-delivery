import {
  BUYER_POLL_LINES,
  EMPTY,
  ERRORS,
  LAPSED_OFFER,
  LISTING_WORD,
  ODOMETER_FLAG,
  OFFER_WORD,
  OUTAGE,
  PENDING,
  REREAD,
  SEVERITY_WORD,
  SUCCESS,
  findingAnnouncement,
  removedPlaceholder,
  seenOn,
  viewingHeldFor,
} from '../../shared/copy';
import { formatDateTime, formatOdometer, formatPounds, formatTimeLeft } from '../../shared/format';
import { PANELS } from '../../shared/panels';
import type { LinkView, LinkViewFindingDto, OfferDto, SlotDto, VersionDto } from '../../shared/types';
import { ApiRefusal, ApiUnreachable, newIdempotencyKey, request } from '../shared/api';
import { carFileFooter, clearNotice, serviceNotice, showNotice, statusRegion, walkroundHeader } from '../shared/chrome';
import { el, focusTarget, goToSection, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { markEntrance, playEntrances, prefersReducedMotion } from '../shared/motion';
import { anyOverlayOpen, focusFirstControl, openOverlay, type Overlay } from '../shared/overlay';
import { PollAnnouncer } from '../shared/pollAnnounce';
import { ReplyOrder, startPolling } from '../shared/poll';
import { bindTimeLeft } from '../shared/timeleft';
import { gaugeText, onUnitsChange, unitsBar } from '../shared/units';
import { Stage } from '../stage/stage';
import type { StageFinding } from '../stage/camera';
import { BEAT_SCROLL } from '../stage/camera';
import { roadTerrain, storyBackdrop } from './terrain';
import { endedLinkPage } from './endedPage';

type PollLine = 'published' | 'listing' | 'offer' | 'slots';

const HAND_OFF_FRACTION = 0.6;

export const renderBuyer = (root: HTMLElement, token: string, first: LinkView): void => {
  let view = first;
  const order = new ReplyOrder();

  const walkroundStatus = statusRegion('Walkround status');
  const notice = serviceNotice();
  notice.hidden = true;

  const stage = new Stage({
    kind: 'walkround',
    carName: view.car.name,
    onMarkerChosen: (finding, position) => {
      goToFinding(finding.id, position, true);
    },
  });

  const announcer = new PollAnnouncer<PollLine>(() => walkroundStatus, ['published', 'listing', 'offer', 'slots']);

  // Sections
  const statements = el('div', { class: 'stage-statements' }, [
    el('h1', { class: 'statement-main', text: 'WALK ROUND IT FIRST' }),
    el('p', { class: 'statement-second', text: 'THEN MAKE YOUR OFFER' }),
  ]);
  const askingSummary = el('div', { class: 'asking-summary', role: 'region', 'aria-label': 'Asking summary' });
  // The page holds exactly one Seen count at any width; it moves between the stage
  // and the walkround dock as the viewport crosses 768 pixels.
  const seenCount = el('div', {
    class: 'seen-count',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Seen count',
  });
  const seenCountStageSlot = el('div', { class: 'seen-count-stage-slot' });
  const seenCountDockSlot = el('div', { class: 'seen-count-dock-slot' });

  const chapterIntro = markEntrance(
    el('section', { class: 'chapter-intro' }, [
      el('h2', { class: 'chapter-heading', text: 'Every mark on this car, in the order you would walk it' }),
      el('p', {
        class: 'chapter-lead',
        text: 'Scroll, or use the read pills. Each finding you reach becomes a dated card in your own record of what you were shown.',
      }),
    ]),
  );

  const cardList = el('ol', { class: 'staircase', role: 'list', 'aria-label': 'Your walkround record' });
  const rereadPrompt = el('div', { class: 'notice-panel reread-prompt', role: 'region', 'aria-label': 'Re-read prompt' });
  rereadPrompt.hidden = true;

  const recordSection = el('section', { class: 'record-section', role: 'region', 'aria-label': 'Test record' });
  const gaugeSection = el('section', { class: 'gauge-section', role: 'region', 'aria-label': 'Gauge readings' });

  const viewingsHeading = el('h2', { class: 'section-heading', text: 'Viewings' });
  const slotList = el('ul', { class: 'slot-list', role: 'list', 'aria-label': 'Viewing slots' });
  const viewingsSection = el('section', { class: 'viewings-section' }, [viewingsHeading, slotList]);

  const offerHeading = el('h2', { class: 'offer-heading', text: 'Your offer' });
  const offerBody = el('div', { class: 'offer-body' });
  const offerStatusStage = el('div', {
    class: 'offer-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Offer status',
  });
  const offerBand = el('section', { class: 'offer-band', role: 'region', 'aria-label': 'Offer' }, [
    offerHeading,
    offerBody,
  ]);

  const storyPanel = el('section', { class: 'story-panel', role: 'region', 'aria-label': 'Owner story' });
  const terrainBand = el('section', { class: 'terrain-band' });

  const dockLine = el('div', { class: 'dock-line' });
  const dockButton = el('button', { type: 'button', class: 'pill-solid dock-button' });
  const dock = el('div', { class: 'walkround-dock', role: 'region', 'aria-label': 'Walkround dock' }, [
    el('div', { class: 'dock-left' }, [seenCountDockSlot, dockLine]),
    dockButton,
  ]);

  const header = walkroundHeader({
    sections: [
      { label: 'Walkround', go: () => goToSectionJump(chapterIntro, chapterIntro.firstElementChild as HTMLElement) },
      { label: 'Record', go: () => goToSectionJump(recordSection, recordTitle) },
      { label: 'Viewings', go: () => goToSectionJump(viewingsSection, viewingsHeading) },
      { label: 'Offer', go: () => goToSectionJump(offerBand, offerHeading) },
    ],
    onMenuOpened: () => undefined,
  });

  const recordTitle = el('h2', { class: 'plate-card-title', text: 'Test record' });
  const gaugeTitle = el('h2', { class: 'plate-card-title', text: 'Gauge readings' });

  const stageTrack = el('div', { class: 'stage-track' }, [
    el('div', { class: 'stage-sticky' }, [stage.region, statements, askingSummary, seenCountStageSlot]),
  ]);

  const main = el('main', { class: 'buyer-main' }, [
    stageTrack,
    chapterIntro,
    el('section', { class: 'staircase-section' }, [rereadPrompt, cardList]),
    el('section', { class: 'plate-records' }, [recordSection, gaugeSection]),
    viewingsSection,
    offerBand,
    storyPanel,
    terrainBand,
  ]);

  // The header sits over the stage, inside a frame that starts below the units bar.
  const shell = el('div', { class: 'buyer-shell' }, [header, notice, walkroundStatus, main]);
  root.replaceChildren(unitsBar(), shell, dock, carFileFooter());

  // The page opens at scroll 0, whatever the browser remembers.
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  let lastScroll = 0;
  let suppressScrollWrites = true;
  window.setTimeout(() => {
    suppressScrollWrites = false;
    lastScroll = window.scrollY;
  }, 0);

  /** Holds off scroll writes while a deliberate move settles. */
  const holdScrollWrites = (): void => {
    suppressScrollWrites = true;
    window.setTimeout(() => {
      lastScroll = window.scrollY;
      suppressScrollWrites = false;
    }, 160);
  };

  // Focus moving to a card pill brings the card into view, and that writes nothing.
  document.addEventListener('focusin', holdScrollWrites);

  const goToSectionJump = (section: HTMLElement, heading: HTMLElement): void => {
    suppressScrollWrites = true;
    goToSection(section, heading);
    window.setTimeout(() => {
      lastScroll = window.scrollY;
      suppressScrollWrites = false;
    }, 120);
  };

  // --- Cards ---------------------------------------------------------------

  interface CardParts {
    item: HTMLLIElement;
    article: HTMLElement;
    pillHolder: HTMLElement;
    wording: HTMLElement;
    band: HTMLElement;
    severity: HTMLElement;
    changed: HTMLElement;
    title: HTMLElement;
    photo: HTMLElement;
  }

  const cards = new Map<string, CardParts>();
  const seenWritesInFlight = new Set<string>();
  const retryQueue = new Set<string>();

  const photoFor = (finding: LinkViewFindingDto): HTMLElement => {
    if (finding.photoId === null) {
      return el('div', { class: 'card-photo card-photo-missing', 'aria-hidden': 'true' });
    }
    const image = el('img', {
      class: 'card-photo',
      src: `/api/link/${token}/photos/${finding.photoId}`,
      alt: `${finding.title} on the ${finding.panelLabel}`,
      loading: 'lazy',
    });
    image.addEventListener('error', () => {
      showNotice(notice, OUTAGE.buyerPhotos);
      image.replaceWith(el('div', { class: 'card-photo card-photo-missing', 'aria-hidden': 'true' }));
    });
    return image;
  };

  const buildCard = (finding: LinkViewFindingDto): CardParts => {
    const title = el('h3', { class: 'card-title', text: finding.title });
    const band = el('p', { class: 'card-band' });
    const severity = el('p', { class: 'card-severity' });
    const wording = el('p', { class: 'card-wording' });
    const changed = el('p', { class: 'card-changed', text: REREAD.changedCard });
    const pillHolder = el('div', { class: 'card-pill' });
    const photo = el('div', { class: 'card-photo-holder' });
    const article = el('article', { class: 'finding-card' }, [photo, title, band, severity, wording, changed, pillHolder]);
    const item = el('li', { class: 'staircase-item' }, [article]) as HTMLLIElement;
    markEntrance(article);
    return { item, article, pillHolder, wording, band, severity, changed, title, photo };
  };

  const writeSeen = async (findingId: string, fromPill: HTMLElement | null): Promise<void> => {
    if (seenWritesInFlight.has(findingId)) return;
    seenWritesInFlight.add(findingId);
    if (fromPill !== null) {
      setPending(fromPill, true);
      announce(walkroundStatus, PENDING.readThis);
    }
    try {
      await request(`/api/link/${token}/seen`, { method: 'POST', body: { findingId } });
      retryQueue.delete(findingId);
      await refresh(['published']);
    } catch (error) {
      if (error instanceof ApiRefusal && (error.code === 'link_revoked' || error.code === 'link_expired')) {
        replaceWithEnded();
        return;
      }
      announce(walkroundStatus, ERRORS.seenFailed);
      retryQueue.add(findingId);
    } finally {
      seenWritesInFlight.delete(findingId);
      if (fromPill !== null && fromPill.isConnected) setPending(fromPill, false);
    }
  };

  const nextUnseenPill = (afterPosition: number): HTMLElement | null => {
    for (const finding of view.findings ?? []) {
      if (finding.position <= afterPosition || finding.seen) continue;
      const pill = cards.get(finding.id)?.pillHolder.querySelector<HTMLElement>('button');
      if (pill !== null && pill !== undefined) return pill;
    }
    return null;
  };

  const paintCards = (): void => {
    const findings = view.findings ?? [];
    const wanted = new Set(findings.map((finding) => finding.id));
    for (const [id, parts] of cards) {
      if (!wanted.has(id)) {
        parts.item.remove();
        cards.delete(id);
      }
    }

    findings.forEach((finding, index) => {
      let parts = cards.get(finding.id);
      if (parts === undefined) {
        parts = buildCard(finding);
        cards.set(finding.id, parts);
      }
      parts.article.setAttribute('aria-label', `Finding ${finding.position}: ${finding.title}`);
      parts.article.dataset.seen = finding.seen ? 'true' : 'false';
      parts.article.dataset.position = String(finding.position);
      parts.article.classList.toggle('finding-card-seen', finding.seen);
      parts.item.style.setProperty('--stair-step', String(index % 3));
      parts.title.textContent = finding.title;
      parts.band.textContent = finding.band;
      parts.severity.textContent = SEVERITY_WORD[finding.severity];
      parts.wording.textContent = finding.wording;
      parts.changed.hidden = !finding.changedSinceSeen;

      if (parts.photo.childElementCount === 0 || parts.photo.dataset.photoId !== (finding.photoId ?? '')) {
        parts.photo.dataset.photoId = finding.photoId ?? '';
        parts.photo.replaceChildren(photoFor(finding));
      }

      if (finding.seen && finding.seenAt !== null) {
        parts.pillHolder.replaceChildren(
          el('p', { class: 'card-seen-line', text: seenOn(formatDateTime(finding.seenAt)) }),
        );
      } else if (parts.pillHolder.querySelector('button') === null) {
        const pill = el('button', { type: 'button', class: 'pill-solid read-pill', text: "I've read this" });
        onPress(pill, () => {
          const position = finding.position;
          void writeSeen(finding.id, pill).then(() => {
            const next = nextUnseenPill(position);
            if (next !== null) focusTarget(next);
            else {
              const makeOffer = offerBody.querySelector<HTMLElement>('.make-offer');
              focusTarget(makeOffer ?? offerHeading);
            }
          });
        });
        parts.pillHolder.replaceChildren(pill);
      }
    });

    const items = findings.map((finding) => cards.get(finding.id)?.item).filter((item): item is HTMLLIElement => item !== undefined);
    const removed = (view.removedFindings ?? []).map((entry) =>
      el('li', { class: 'staircase-item staircase-placeholder' }, [
        el('article', { class: 'finding-card finding-card-removed', 'aria-label': `Finding removed: ${entry.title}` }, [
          el('h3', { class: 'card-title', text: entry.title }),
          el('p', { class: 'card-wording', text: removedPlaceholder(entry.removedInVersion) }),
        ]),
      ]),
    );
    if (items.length === 0 && removed.length === 0) {
      cardList.replaceChildren(el('li', { class: 'empty-line', text: EMPTY.findings }));
    } else {
      cardList.replaceChildren(...items, ...removed);
    }
    playEntrances(cardList);
  };

  // --- Seen count, dock, re-read ------------------------------------------

  const paintCounts = (): void => {
    const progress = view.progress ?? { seen: 0, total: 0, materialUnseen: 0 };
    seenCount.textContent = `${progress.seen} of ${progress.total} seen`;
    seenCount.dataset.complete = progress.seen === progress.total ? 'true' : 'false';
  };

  /** Crossing 768 pixels on an open tab keeps exactly one Seen count and one Offer status. */
  const placeChrome = (): void => {
    const slot = window.innerWidth <= 767 ? seenCountDockSlot : seenCountStageSlot;
    if (seenCount.parentElement !== slot) slot.append(seenCount);
  };

  const firstUnseen = (): LinkViewFindingDto | null =>
    (view.findings ?? []).find((finding) => !finding.seen) ?? null;

  const goToFinding = (findingId: string, position: number, announceIt: boolean): void => {
    suppressScrollWrites = true;
    const total = (view.findings ?? []).length;
    if (!stage.stillMode) {
      window.scrollTo({ top: position * BEAT_SCROLL, behavior: 'auto' });
    } else {
      const parts = cards.get(findingId);
      if (parts !== undefined) {
        parts.article.scrollIntoView({ behavior: 'auto', block: 'center' });
        const pill = parts.pillHolder.querySelector<HTMLElement>('button');
        focusTarget(pill ?? parts.article);
      }
    }
    if (announceIt) announce(walkroundStatus, findingAnnouncement(position, total));
    window.setTimeout(() => {
      lastScroll = window.scrollY;
      suppressScrollWrites = false;
    }, 120);
  };

  const paintDock = (): void => {
    const unseen = firstUnseen();
    const offer = view.offer ?? null;
    if (unseen !== null) {
      dockButton.textContent = 'Next unread';
      dockButton.setAttribute('aria-label', 'Next unread');
    } else {
      dockButton.textContent = 'To the offer';
      dockButton.setAttribute('aria-label', 'To the offer');
    }

    // The dock holds the Offer status only below 768 pixels, and with no offer it
    // shows the held viewing's label instead.
    if (offer !== null && window.innerWidth <= 767) {
      dockLine.replaceChildren(offerStatusLine());
      return;
    }
    const held = (view.slots ?? []).find((slot) => slot.heldByYou);
    dockLine.replaceChildren(
      held === undefined ? el('span') : el('span', { class: 'dock-viewing', text: `Viewing ${held.label}` }),
    );
  };

  onPress(dockButton, () => {
    const unseen = firstUnseen();
    if (unseen !== null) {
      goToFinding(unseen.id, unseen.position, true);
      return;
    }
    suppressScrollWrites = true;
    offerBand.scrollIntoView({ behavior: 'auto', block: 'start' });
    const makeOffer = offerBody.querySelector<HTMLElement>('.make-offer');
    focusTarget(makeOffer ?? offerHeading);
    window.setTimeout(() => {
      lastScroll = window.scrollY;
      suppressScrollWrites = false;
    }, 120);
  });

  const paintReread = (): void => {
    const current = view.version?.number ?? null;
    const older = (view.versionsRead ?? []).filter((number) => current !== null && number < current);
    const changedCount = (view.findings ?? []).filter((finding) => finding.changedSinceSeen).length;
    if (older.length === 0) {
      rereadPrompt.hidden = true;
      rereadPrompt.replaceChildren();
      return;
    }
    const newest = Math.max(...older);
    const link = el('a', { href: '#', class: 'underline-link', text: 'See the version you read' });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void openVersionDialog(newest, link);
    });
    rereadPrompt.hidden = false;
    rereadPrompt.replaceChildren(
      el('h3', { class: 'notice-heading', text: REREAD.heading }),
      el('p', { class: 'notice-line', text: REREAD.line(changedCount) }),
      link,
    );
  };

  let versionDialog: Overlay | null = null;
  const openVersionDialog = async (number: number, opener: HTMLElement): Promise<void> => {
    if (versionDialog !== null && versionDialog.exiting) versionDialog.cancelExit();
    const overlay = openOverlay({
      name: `Version ${number}`,
      variant: 'version',
      opener,
      scrimCloses: false,
      onClosed: () => {
        versionDialog = null;
        flushAnnouncements();
      },
    });
    versionDialog = overlay;
    const close = el('button', { type: 'button', class: 'pill-outline', text: 'Close' });
    onPress(close, () => overlay.close());
    overlay.body.append(el('h2', { class: 'dialog-heading', text: `Version ${number}` }), close);
    focusFirstControl(overlay);
    try {
      const version = await request<VersionDto>(`/api/link/${token}/versions/${number}`);
      const list = el(
        'ol',
        { class: 'version-findings' },
        version.findings.map((finding) =>
          el('li', {}, [
            el('h3', { class: 'card-title', text: finding.title }),
            el('p', { class: 'card-wording', text: finding.wording }),
          ]),
        ),
      );
      overlay.body.replaceChildren(el('h2', { class: 'dialog-heading', text: `Version ${number}` }), list, close);
      if (!overlay.dialog.contains(document.activeElement)) focusFirstControl(overlay);
    } catch {
      announce(overlay.status, OUTAGE.sendFailed);
    }
  };

  // --- Record and readings -------------------------------------------------

  const paintRecord = (): void => {
    const record = view.record ?? null;
    recordSection.replaceChildren(
      el('div', { class: 'plate-mark', 'aria-hidden': 'true' }),
      recordTitle,
      el('p', {
        class: 'plate-card-body',
        text:
          record === null
            ? 'The roadworthiness record has not been pulled for this car yet.'
            : `Pulled ${formatDateTime(record.pulledAt)}. First used ${record.firstUsedDate ?? 'not recorded'}.`,
      }),
      el('div', { class: 'tape' }, [
        el('h3', { class: 'sub-heading', text: 'Odometer tape' }),
        el(
          'ol',
          { class: 'tape-steps' },
          (record?.tape ?? []).map((step) =>
            el('li', { class: `tape-step tape-${step.status}` }, [
              el('span', { class: 'tape-date figures', text: step.completedDate.slice(0, 10) }),
              el('span', { class: 'tape-result', text: step.testResult }),
              el('span', { class: 'tape-odo figures', text: formatOdometer(step.odometerValue, step.odometerUnit) }),
              el('span', { class: 'tape-flag', text: step.flag === null ? '' : ODOMETER_FLAG[step.flag] }),
            ]),
          ),
        ),
      ]),
      el('div', { class: 'advisories' }, [
        el('h3', { class: 'sub-heading', text: 'Advisories' }),
        el('p', { class: 'advisory-tally', text: `Open advisories: ${record?.openAdvisories ?? 0}` }),
        el(
          'ul',
          { class: 'advisory-list' },
          (record?.advisories ?? []).map((advisory) =>
            el('li', { class: 'advisory-row' }, [
              el('span', { class: 'advisory-text', text: advisory.text }),
              el('span', { class: 'advisory-stance', text: advisory.stance ?? '' }),
              el('span', { class: 'advisory-note', text: advisory.note ?? '' }),
              ...(advisory.recurred ? [el('span', { class: 'advisory-flag', text: ERRORS.recurredFlag })] : []),
            ]),
          ),
        ),
      ]),
      el('a', { class: 'underline-link', href: `/api/link/${token}/report`, text: 'Download condition report' }),
    );
  };

  const paintGauges = (): void => {
    const rows = PANELS.map((panel) => {
      const dto = view.panels.find((candidate) => candidate.id === panel.id);
      const owner = dto?.owner ?? null;
      const inspector = dto?.inspector ?? [];
      return el('tr', { class: 'gauge-row', role: 'row' }, [
        el('td', { role: 'cell', text: panel.label }),
        el('td', {
          role: 'cell',
          class: 'figures',
          text: owner === null ? (panel.substrate === 'plastic' ? 'Not gauged' : 'No reading') : gaugeText(owner.microns, owner.mils),
        }),
        el('td', { role: 'cell', text: owner?.band ?? (panel.substrate === 'plastic' ? 'Not gauged' : 'No reading') }),
        el('td', {
          role: 'cell',
          class: 'figures',
          text: inspector.map((reading) => `${gaugeText(reading.microns, reading.mils)} (${reading.band})`).join(', '),
        }),
      ]);
    });

    gaugeSection.replaceChildren(
      el('div', { class: 'plate-mark', 'aria-hidden': 'true' }),
      gaugeTitle,
      el('p', {
        class: 'plate-card-body',
        text: 'Paint thickness on every panel, banded against this car\u2019s own median on the same substrate.',
      }),
      el('table', { class: 'gauge-table', role: 'table', 'aria-label': 'Gauge readings' }, [
        el('thead', { role: 'rowgroup' }, [
          el('tr', { role: 'row' }, [
            el('th', { role: 'columnheader', text: 'Panel' }),
            el('th', { role: 'columnheader', text: 'Owner' }),
            el('th', { role: 'columnheader', text: 'Band' }),
            el('th', { role: 'columnheader', text: 'Inspector' }),
          ]),
        ]),
        el('tbody', { role: 'rowgroup' }, rows),
      ]),
    );
  };

  onUnitsChange(() => {
    paintGauges();
  });

  // --- Viewings ------------------------------------------------------------

  interface ClaimAttempt {
    key: string;
    slotId: string;
  }
  let claimAttempt: ClaimAttempt | null = null;
  let claimDialog: Overlay | null = null;

  const openClaimDialog = (slot: SlotDto, opener: HTMLElement): void => {
    if (claimDialog !== null && claimDialog.exiting) claimDialog.cancelExit();
    if (claimAttempt === null || claimAttempt.slotId !== slot.id) {
      claimAttempt = { key: newIdempotencyKey(), slotId: slot.id };
    }
    const overlay = openOverlay({
      name: 'Claim viewing',
      variant: 'claim',
      opener,
      scrimCloses: false,
      onClosed: () => {
        claimDialog = null;
        flushAnnouncements();
      },
    });
    claimDialog = overlay;

    const confirm = el('button', { type: 'button', class: 'pill-solid', text: 'Confirm viewing' });
    const cancel = el('button', { type: 'button', class: 'pill-outline', text: 'Cancel' });
    overlay.body.append(
      el('h2', { class: 'dialog-heading', text: 'Claim viewing' }),
      el('p', { class: 'dialog-line', text: slot.label }),
      el('div', { class: 'dialog-actions' }, [confirm, cancel]),
    );

    onPress(cancel, () => {
      const claimed = (view.slots ?? []).find((candidate) => candidate.id === slot.id);
      const home =
        claimed !== undefined && !claimed.held
          ? slotList.querySelector<HTMLElement>(`[data-slot-id="${slot.id}"] button`)
          : null;
      overlay.close(home ?? (opener.isConnected ? opener : viewingsHeading));
    });

    onPress(confirm, () => {
      void sendClaim(slot, confirm, overlay);
    });

    focusFirstControl(overlay);
  };

  const sendClaim = async (slot: SlotDto, confirm: HTMLElement, overlay: Overlay): Promise<void> => {
    if (claimAttempt === null) return;
    setPending(confirm, true);
    announce(overlay.status, PENDING.claim);
    try {
      await request<SlotDto>(`/api/link/${token}/slots/${slot.id}/claim`, {
        method: 'POST',
        idempotencyKey: claimAttempt.key,
      });
      claimAttempt = null;
      await refresh(['slots']);
      announce(walkroundStatus, viewingHeldFor(slot.label));
      const release = slotList.querySelector<HTMLElement>(`[data-slot-id="${slot.id}"] button`);
      overlay.close(release ?? viewingsHeading);
    } catch (error) {
      if (error instanceof ApiUnreachable) {
        announce(overlay.status, OUTAGE.sendFailed);
        return;
      }
      if (error instanceof ApiRefusal) {
        if (error.code === 'link_revoked' || error.code === 'link_expired') {
          replaceWithEnded();
          return;
        }
        if (error.status >= 500) {
          announce(overlay.status, OUTAGE.sendFailed);
          return;
        }
        announce(overlay.status, claimRefusalCopy(error));
        confirm.remove();
        await refresh(['slots']);
        return;
      }
      announce(overlay.status, OUTAGE.sendFailed);
    } finally {
      if (confirm.isConnected) setPending(confirm, false);
    }
  };

  const claimRefusalCopy = (error: ApiRefusal): string => {
    if (error.code === 'slot_taken' || error.code === 'slot_past') return ERRORS.slotGone;
    if (error.code === 'already_holding_slot') return ERRORS.alreadyHoldingSlot;
    if (error.code === 'listing_closed') return ERRORS.listingClosed;
    return error.body.message;
  };

  const paintSlots = (): void => {
    const slots = view.slots ?? [];
    if (slots.length === 0) {
      slotList.replaceChildren(el('li', { class: 'empty-line', text: EMPTY.viewings }));
      return;
    }
    slotList.replaceChildren(
      ...slots.map((slot) => {
        const item = el('li', { class: 'slot-item', 'data-slot-id': slot.id }, [
          el('span', { class: 'slot-label figures', text: slot.label }),
        ]);
        if (slot.heldByYou) {
          const release = el('button', { type: 'button', class: 'pill-outline', text: `Release ${slot.label}` });
          onPress(release, () => {
            void releaseSlot(slot, release);
          });
          item.append(release);
        } else if (slot.held) {
          item.append(el('span', { class: 'slot-held', text: 'Held' }));
        } else if (view.car.listingStatus === 'live') {
          const claim = el('button', { type: 'button', class: 'pill-solid', text: `Claim ${slot.label}` });
          onPress(claim, () => openClaimDialog(slot, claim));
          item.append(claim);
        }
        return item;
      }),
    );
  };

  const releaseSlot = async (slot: SlotDto, control: HTMLElement): Promise<void> => {
    setPending(control, true);
    announce(walkroundStatus, PENDING.release);
    try {
      await request(`/api/link/${token}/slots/${slot.id}/release`, { method: 'POST' });
      await refresh(['slots']);
      announce(walkroundStatus, SUCCESS.release);
      const claim = slotList.querySelector<HTMLElement>(`[data-slot-id="${slot.id}"] button`);
      if (claim !== null) focusTarget(claim);
      else focusTarget(viewingsHeading);
    } catch (error) {
      if (error instanceof ApiRefusal) announce(walkroundStatus, error.body.message);
      else announce(walkroundStatus, OUTAGE.sendFailed);
    } finally {
      if (control.isConnected) setPending(control, false);
    }
  };

  // --- Offer ---------------------------------------------------------------

  const offerStatusLine = (): HTMLElement => {
    const offer = view.offer;
    if (offer === null || offer === undefined) return el('span');
    offerStatusStage.replaceChildren();
    const word = OFFER_WORD[offer.status];
    if (offer.status === 'open' || offer.status === 'needs_reread') {
      const time = el('span', { class: 'figures' });
      bindTimeLeft(time, offer.secondsRemaining);
      offerStatusStage.append(el('span', { text: `${word} ` }), time);
    } else {
      offerStatusStage.textContent = word;
    }
    return offerStatusStage;
  };

  interface OfferAttempt {
    key: string;
    amount: number;
  }
  let offerAttempt: OfferAttempt | null = null;
  let offerDialog: Overlay | null = null;

  const openOfferDialog = (opener: HTMLElement): void => {
    if (offerDialog !== null && offerDialog.exiting) {
      offerDialog.cancelExit();
      offerAttempt = null;
    }
    const overlay = openOverlay({
      name: 'Make an offer',
      variant: 'offer',
      opener,
      scrimCloses: false,
      onClosed: () => {
        offerDialog = null;
        flushAnnouncements();
      },
    });
    offerDialog = overlay;

    const amount = el('input', {
      type: 'number',
      class: 'spin-input figures',
      id: 'offer-amount',
      min: '1',
      max: '10000000',
      step: '1',
    }) as HTMLInputElement;
    amount.setAttribute('aria-label', 'Offer in pounds');
    const send = el('button', { type: 'button', class: 'pill-solid', text: 'Send offer' });
    const cancel = el('button', { type: 'button', class: 'pill-outline', text: 'Cancel' });
    const fieldError = el('p', { class: 'field-error' });
    fieldError.hidden = true;

    amount.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (send.dataset.pending === 'true') return;
      void sendOffer(amount, send, overlay, fieldError);
    });

    onPress(send, () => {
      void sendOffer(amount, send, overlay, fieldError);
    });
    onPress(cancel, () => overlay.close());

    overlay.body.append(
      el('h2', { class: 'dialog-heading', text: 'Make an offer' }),
      el('label', { class: 'field-label', for: 'offer-amount', text: 'Offer in pounds' }),
      amount,
      fieldError,
      el('div', { class: 'dialog-actions' }, [send, cancel]),
    );
    focusFirstControl(overlay);
  };

  const sendOffer = async (
    amountField: HTMLInputElement,
    send: HTMLElement,
    overlay: Overlay,
    fieldError: HTMLElement,
  ): Promise<void> => {
    const amount = Number(amountField.value);
    if (offerAttempt === null || offerAttempt.amount !== amount) {
      offerAttempt = { key: newIdempotencyKey(), amount };
    }
    setPending(send, true);
    announce(overlay.status, PENDING.sendOffer);
    try {
      await request<OfferDto>(`/api/link/${token}/offers`, {
        method: 'POST',
        body: { amountPounds: Number.isInteger(amount) ? amount : amountField.value },
        idempotencyKey: offerAttempt.key,
      });
      offerAttempt = null;
      await refresh(['offer']);
      announce(walkroundStatus, SUCCESS.sendOffer);
      overlay.close(offerHeading);
    } catch (error) {
      if (error instanceof ApiUnreachable) {
        announce(overlay.status, OUTAGE.sendFailed);
        return;
      }
      if (error instanceof ApiRefusal) {
        if (error.code === 'link_revoked' || error.code === 'link_expired') {
          replaceWithEnded();
          return;
        }
        if (error.status >= 500) {
          announce(overlay.status, OUTAGE.sendFailed);
          return;
        }
        const field = error.fieldError('amountPounds');
        if (field !== undefined) {
          fieldError.hidden = false;
          fieldError.textContent = field;
          announce(overlay.status, field);
          return;
        }
        announce(overlay.status, offerRefusalCopy(error));
        return;
      }
      announce(overlay.status, OUTAGE.sendFailed);
    } finally {
      if (send.isConnected) setPending(send, false);
    }
  };

  const offerRefusalCopy = (error: ApiRefusal): string => {
    if (error.code === 'material_findings_unseen') return ERRORS.materialFindingsUnseen;
    if (error.code === 'offer_exists') return ERRORS.offerExists;
    if (error.code === 'listing_closed') return ERRORS.listingClosed;
    return error.body.message;
  };

  const paintOffer = (): void => {
    const offer = view.offer ?? null;
    const parts: Node[] = [];

    if (offer !== null && (offer.status === 'open' || offer.status === 'needs_reread')) {
      parts.push(el('p', { class: 'offer-amount figures', text: formatPounds(offer.amountPounds) }));
      if (offer.status === 'needs_reread') {
        parts.push(el('p', { class: 'offer-waiting', text: REREAD.offerWaiting }));
      }
    }
    if (offer !== null && offer.status === 'lapsed') {
      parts.push(
        el('div', { class: 'notice-panel' }, [
          el('h3', { class: 'notice-heading', text: LAPSED_OFFER.heading }),
          el('p', { class: 'notice-line', text: LAPSED_OFFER.body }),
        ]),
      );
    }
    if (offer !== null && (offer.status === 'accepted' || offer.status === 'declined' || offer.status === 'closed_by_acceptance')) {
      parts.push(el('p', { class: 'offer-amount figures', text: formatPounds(offer.amountPounds) }));
    }

    const canOffer =
      view.car.listingStatus === 'live' &&
      (offer === null || (offer.status !== 'open' && offer.status !== 'needs_reread'));
    if (canOffer) {
      const button = el('button', { type: 'button', class: 'pill-solid make-offer', text: 'Make an offer' });
      onPress(button, () => openOfferDialog(button));
      parts.push(button);
    }

    if (view.car.listingStatus === 'sold' && offer !== null && offer.status === 'accepted') {
      parts.push(
        el('a', { class: 'underline-link', href: `/api/link/${token}/handover`, text: 'Download handover record' }),
      );
    }

    const onDock = window.innerWidth <= 767;
    if (offer !== null && !onDock) parts.push(offerStatusLine());

    offerBody.replaceChildren(...parts);
  };

  // --- Story and terrain ---------------------------------------------------

  const paintStory = (): void => {
    const goToOffer = el('a', { href: '#', class: 'pill-outline', text: 'Go to the offer' });
    goToOffer.addEventListener('click', (event) => {
      event.preventDefault();
      goToSectionJump(offerBand, offerHeading);
    });
    storyPanel.replaceChildren(
      storyBackdrop(),
      el('div', { class: 'story-inner' }, [
        el('p', { class: 'story-eyebrow', text: 'From the owner' }),
        el('p', { class: 'story-statement', text: view.car.story }),
        goToOffer,
      ]),
    );
    terrainBand.replaceChildren(roadTerrain(view.car.viewingArea));
  };

  const paintSummary = (): void => {
    const total = (view.findings ?? []).length;
    const lines: Node[] = [
      el('p', { class: 'asking-car', text: view.car.name }),
      el('p', { class: 'asking-findings', text: `${total} findings` }),
      el('p', { class: 'asking-price figures', text: formatPounds(view.car.askingPounds) }),
    ];
    if (view.car.listingStatus !== 'live') {
      lines.push(el('p', { class: 'asking-status', text: LISTING_WORD[view.car.listingStatus] }));
    }
    askingSummary.replaceChildren(...lines);
  };

  // --- Poll ----------------------------------------------------------------

  const lineValues = (): Readonly<Record<PollLine, string>> => ({
    published: view.version === null || view.version === undefined ? '' : BUYER_POLL_LINES.published(view.version.number),
    listing: BUYER_POLL_LINES.listing(LISTING_WORD[view.car.listingStatus]),
    offer: view.offer === null || view.offer === undefined ? '' : BUYER_POLL_LINES.offer(OFFER_WORD[view.offer.status]),
    slots: BUYER_POLL_LINES.slotsFree((view.slots ?? []).filter((slot) => !slot.held).length),
  });

  const flushAnnouncements = (): void => {
    if (anyOverlayOpen()) return;
    announcer.flush(lineValues());
  };

  let poller: ReturnType<typeof startPolling> | null = null;

  const replaceWithEnded = (): void => {
    poller?.stop();
    stage.dispose();
    endedLinkPage(root, 'ended');
  };

  const paintAll = (): void => {
    paintSummary();
    paintCards();
    paintCounts();
    paintReread();
    paintRecord();
    paintGauges();
    paintSlots();
    paintOffer();
    paintDock();
    paintStory();
    stage.setTrack(stageFindings(), view.heroFindingId ?? null);
    stage.setSeen(new Map((view.findings ?? []).map((finding) => [finding.id, finding.seen])));
    stage.setListing(view.car.listingStatus);
    stageTrack.style.setProperty('--track-length', `${stage.trackScrollLength}px`);
  };

  const stageFindings = (): StageFinding[] =>
    (view.findings ?? []).map((finding) => ({
      id: finding.id,
      panelId: finding.panelId,
      u: finding.u,
      v: finding.v,
    }));

  /** Refetches the link view for the page's own action, moving the baseline it changed. */
  const refresh = async (changed: readonly PollLine[]): Promise<void> => {
    const ticket = order.next();
    const next = await request<LinkView>(`/api/link/${token}`);
    if (!order.accept(ticket)) return;
    const previousTrack = (view.findings ?? []).length;
    view = next;
    paintAll();
    if (previousTrack !== (view.findings ?? []).length) suppressScrollWrites = true;
    announcer.refresh(changed, lineValues());
  };

  const pollOnce = async (): Promise<void> => {
    const ticket = order.next();
    let next: LinkView;
    try {
      next = await request<LinkView>(`/api/link/${token}`);
    } catch (error) {
      if (error instanceof ApiRefusal && (error.status === 404 || error.status === 410)) replaceWithEnded();
      return;
    }
    if (!order.accept(ticket)) return;
    const previousTrack = (view.findings ?? []).length;
    view = next;
    paintAll();
    if (previousTrack !== (view.findings ?? []).length) suppressScrollWrites = true;
    announcer.check(lineValues(), anyOverlayOpen());
    for (const findingId of retryQueue) {
      void writeSeen(findingId, null);
      break;
    }
  };

  // --- Scroll-driven seen writes ------------------------------------------

  const handOffFor = (position: number): number => BEAT_SCROLL * (position + HAND_OFF_FRACTION);

  window.addEventListener(
    'scroll',
    () => {
      if (prefersReducedMotion() || stage.stillMode) {
        lastScroll = window.scrollY;
        return;
      }
      const current = window.scrollY;
      if (suppressScrollWrites || anyOverlayOpen()) {
        lastScroll = current;
        return;
      }
      const from = lastScroll;
      lastScroll = current;
      if (current <= from) return;
      for (const finding of view.findings ?? []) {
        const point = handOffFor(finding.position);
        if (point <= from || point > current) continue;
        if (finding.seen) continue;
        void writeSeen(finding.id, null);
      }
    },
    { passive: true },
  );

  placeChrome();
  announcer.prime(lineValues());
  paintAll();
  playEntrances(main);
  clearNotice(notice);
  window.addEventListener('resize', () => {
    placeChrome();
    paintOffer();
    paintDock();
  });

  poller = startPolling(pollOnce);
  void poller;

  void formatTimeLeft;
};
