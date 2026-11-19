// The buyer's walkround: the stage, the staircase of dated cards, the record, the viewings and
// the offer band. Everything the page shows about what the buyer has seen comes from the server.

import { api, Attempt, NoReply, Refused } from '../api.js';
import { all, el, find, isPhone, keyedList, on, prefersReducedMotion, setAttr, setText, svg, syncChildren } from '../dom.js';
import { bandClass, Countdown, money, showDate, timeLeft } from '../format.js';
import { MESSAGE, OFFER_WORD, LISTING_WORD, ODOMETER_FLAG } from '../../shared/copy.js';
import { carFileFooter } from '../parts/footer.js';
import { onUnitsChange, showMicrons, unitsBar, unitsButton } from '../parts/units.js';
import { Stage } from '../stage/stage.js';
import { BEAT, buildTrack, crossings, trackLength, type StageFinding, type StageState } from '../stage/model.js';
import { Announcer } from '../ui/announce.js';
import { entrance } from '../ui/entrance.js';
import { Overlay } from '../ui/overlay.js';
import { pressable } from '../ui/pending.js';
import { alertRegion, announce, statusRegion } from '../ui/status.js';
import { terrainCanvas } from '../parts/terrain.js';
import { storyPanel } from '../parts/story.js';
import { plateCard } from '../parts/plate.js';
import { emptyState, endedPage } from './ended.js';
import type { BuyerView, LinkFinding, LinkSlot } from '../types.js';
import { fillFindingMeta } from '../parts/finding-meta.js';

/** Shown where a row has no figure, so an empty cell never reads as a missing one. */
const NO_FIGURE = '—';
/** How far the staircase's third column starts below the first, in pixels. */
const THIRD_COLUMN_START = 280;
/** How far the last card's foot passes the foot of the record and viewings beside it. */
const OVERHANG = 200;
/** The staircase's row gap: the third column's cards never stand closer than this. */
const ROW_GAP = 40;

const POLL_MS = 15000;

export function buyerPage(root: HTMLElement, token: string, view: BuyerView): void {
  new BuyerPage(root, token, view).mount();
}

class BuyerPage {
  private view: BuyerView;
  private readonly token: string;
  private readonly root: HTMLElement;
  private readonly stage: Stage;
  private readonly status = statusRegion('Walkround status', 'visually-hidden');
  private readonly notice = alertRegion();
  private readonly seenCount = statusRegion('Seen count', 'seen-count');
  private readonly offerStatus = statusRegion('Offer status', 'offer-status');
  private readonly dockLine = el('p', { class: 'dock-line' });
  private readonly dockLines = el('div', { class: 'dock-lines' }, [this.dockLine]);
  private readonly dockButton = el('button', { type: 'button', class: 'pill pill-outline dock-button' });
  private readonly cards = el('ul', { class: 'staircase', role: 'list', 'aria-label': 'Your walkround record' });
  private readonly slotList = el('ul', { class: 'slot-list', role: 'list', 'aria-label': 'Viewing slots' });
  private readonly offerBand = el('section', { role: 'region', 'aria-label': 'Offer', class: 'offer-band', id: 'offer' });
  private readonly offerHeading = el('h2', { tabindex: '-1' }, ['Your offer']);
  private readonly offerLapsed = el('div', { class: 'notice-panel' }, [
    el('h3', {}, [MESSAGE.lapsedHeading]),
    el('p', {}, [MESSAGE.lapsedBody]),
  ]);
  private readonly offerReread = el('p', { class: 'offer-reread' }, [MESSAGE.offerNeedsReread]);
  private readonly offerAmount = el('p', { class: 'offer-amount figures' });
  private readonly makeOffer = el('button', { type: 'button', class: 'pill pill-outline make-offer' }, ['Make an offer']);
  private readonly handoverLink = el('a', { class: 'text-link' }, ['Download handover record']);
  private readonly offerInner = el('div', { class: 'offer-inner' }, [this.offerHeading]);
  private readonly rereadHolder = el('div', { class: 'reread-holder' });
  private readonly rereadLine = el('p');
  private readonly rereadLink = el('a', { href: '#', class: 'text-link' }, ['See the version you read']);
  private readonly rereadPrompt = el('div', {
    role: 'region',
    'aria-label': 'Re-read prompt',
    class: 'notice-panel reread',
  }, [el('h3', {}, [MESSAGE.rereadHeading]), this.rereadLine, this.rereadLink]);
  private rereadVersion = 0;
  private readonly dock = el('div', { role: 'region', 'aria-label': 'Walkround dock', class: 'dock' });
  private readonly askingName = el('p', { class: 'asking-name' });
  private readonly askingCount = el('p', { class: 'asking-count' });
  private readonly askingPrice = el('p', { class: 'asking-price' });
  private readonly askingStatus = el('p', { class: 'asking-status' });
  private readonly asking = el('div', { role: 'region', 'aria-label': 'Asking summary', class: 'asking-card' }, [
    this.askingName, this.askingCount, this.askingPrice,
  ]);
  private readonly stageOverlay = el('div', { class: 'stage-overlay' }, [
    el('div', { class: 'statements' }, [
      el('p', { class: 'statement-small' }, ['THEN MAKE YOUR OFFER']),
      el('h1', { class: 'statement-big' }, ['WALK ROUND IT FIRST']),
    ]),
    this.asking,
  ]);
  /**
   * The hand-off itself: from 60% of a beat the pin leaves the vertex and travels down to the
   * card's docking place in the lower stage, arriving as the card with its photo, band and
   * wording. It is the staircase card's double, so it carries no role and takes no pointer
   * input; the card the buyer reads and presses is the one in `list "Your walkround record"`.
   */
  private readonly handoff = el('div', { class: 'handoff', 'aria-hidden': 'true' }, [
    el('div', { class: 'handoff-photo-slot' }),
    el('div', { class: 'handoff-body' }, [
      el('p', { class: 'handoff-title' }),
      el('p', { class: 'handoff-meta' }),
      el('p', { class: 'handoff-wording' }),
    ]),
  ]);
  private handoffKey = '';
  private readonly gaugeBody = el('tbody');
  private readonly tapeHolder = el('div', { class: 'tape' });
  private readonly advisoryHolder = el('div', { class: 'advisory-list' });
  private readonly countdown = new Countdown();
  private readonly announcer: Announcer;
  private track = buildTrack([], null);
  private lastScroll = 0;
  private jumping = false;
  private jumpToken = 0;
  private writing = new Set<string>();
  private failedWrites: string[] = [];
  private offerDialog: Overlay | null = null;
  private claimDialog: Overlay | null = null;
  private menu: Overlay | null = null;
  private versionDialog: Overlay | null = null;
  private offerAttempt = new Attempt();
  private claimAttempt = new Attempt();
  private readsAsked = 0;
  private readApplied = 0;
  private ownReads = 0;
  private ended = false;
  private stageTrackEl = el('div', { class: 'stage-track' });

  constructor(root: HTMLElement, token: string, view: BuyerView) {
    this.root = root;
    this.token = token;
    this.view = view;
    this.handoverLink.setAttribute('href', `/api/link/${token}/handover`);
    this.stage = new Stage({ label: 'Walkround stage', carName: () => this.view.car.name });
    this.announcer = new Announcer(() => this.status, ['version', 'listing', 'offer', 'slots']);
  }

  private findings(): LinkFinding[] {
    return this.view.findings;
  }

  private stageFindings(): StageFinding[] {
    return this.findings().map((finding) => ({
      id: finding.id,
      position: finding.position,
      panelId: finding.panelId,
      u: finding.u,
      v: finding.v,
      seen: finding.seen,
      title: finding.title,
    }));
  }

  private mode(): 'scroll' | 'still' {
    return prefersReducedMotion() || !this.stage.usesWebgl ? 'still' : 'scroll';
  }

  private dim(): number {
    const closed = ['under_offer', 'sold', 'withdrawn'].includes(this.view.car.listingStatus);
    return closed ? 0.42 : 1;
  }

  mount(): void {
    this.root.replaceChildren(this.build());
    this.track = buildTrack(this.stageFindings(), this.view.heroFindingId);
    this.stage.setTrack(this.track);
    this.stage.setMarkers(this.stageFindings());
    this.stage.onMarkerPick((finding) => this.goToFinding(finding.position, true));
    this.paint();
    this.layout();
    this.watchTrail();
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.lastScroll = 0;
    this.render();

    on(window, 'scroll', () => this.render(), { passive: true });
    // Seen records are decided once per frame, from where the scroll moved since the last frame.
    // A jump in the same frame takes that movement with it, so it never reads as the buyer's own.
    const watch = (): void => {
      if (!this.root.isConnected) return;
      // The next frame is asked for first, so the walkround keeps deciding for the whole visit.
      window.requestAnimationFrame(watch);
      if (window.scrollY !== this.lastScroll) this.settleScroll();
    };
    window.requestAnimationFrame(watch);
    on(window, 'resize', () => {
      this.layout();
      this.render();
    });
    this.stage.onStillDrop(() => this.layout());
    on(document, 'focusin', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest && target.closest('.overlay')) return;
      // Focus moving to a control brings it into view, and that movement writes nothing.
      this.markJump();
      this.keepClear(event.target as HTMLElement);
      this.catchUp();
    });
    onUnitsChange(() => this.paintUnits());
    this.announcer.start(this.lines());
    window.setInterval(() => void this.poll(), POLL_MS);
    on(window, 'focus', () => void this.poll());
    // An address with a fragment opens the walkround at the top, like any other open.
    on(window, 'hashchange', () => {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      this.markJump();
      window.scrollTo({ top: 0, behavior: 'instant' });
      this.catchUp();
    });
  }

  // ---------- building ----------

  private build(): HTMLElement {
    const page = el('div', { class: 'buyer-page' });
    const header = this.buildHeader();
    const sticky = this.stage.element;
    sticky.classList.add('stage-sticky');
    sticky.append(this.stageOverlay, this.handoff);
    this.stageTrackEl.append(sticky);

    const intro = el('section', { class: 'band band-pale chapter', id: 'walkround' }, [
      entrance(el('h2', { class: 'chapter-heading', tabindex: '-1' }, ['Every mark on the car, in the order you would walk round it'])),
      entrance(el('p', { class: 'lead' }, [
        'The owner placed each finding on the panel it belongs to. Read them all and your record of this car fills in as you go.',
      ])),
    ]);

    const detail = (label: string, body: HTMLElement): HTMLElement => el('div', { class: 'record-fold' }, [
      entrance(el('h3', { tabindex: '-1' }, [label])),
      body,
    ]);

    const recordBlock = el('section', { class: 'record-block' }, [
      el('div', { class: 'plate-cards' }, [
        plateCard({
          id: 'record',
          title: 'Test record',
          body: 'Every roadworthiness test on file, with the odometer tape and the advisories the owner has answered.',
          linkLabel: 'Download condition report',
          href: `/api/link/${this.token}/report`,
          mark: 'certificate',
          onJump: (href) => this.goToSection(href),
        }),
        plateCard({
          id: 'gauge',
          title: 'Gauge readings',
          body: 'Paint depth on every gaugeable panel, banded against this car’s own median on the same substrate.',
          linkLabel: 'Read the panel readings',
          href: '#gauge-readings',
          mark: 'gauge',
          onJump: (href) => this.goToSection(href),
        }),
      ]),
      el('div', { class: 'record-detail', id: 'gauge-readings' }, [
        detail('Gauge readings', el('table', { 'aria-label': 'Gauge readings', class: 'readings-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { scope: 'col' }, ['Panel']),
            el('th', { scope: 'col', class: 'figure-head' }, ['Owner']),
            el('th', { scope: 'col' }, ['Band']),
            el('th', { scope: 'col', class: 'figure-head' }, ['Inspector']),
          ])]),
          this.gaugeBody,
        ])),
        detail('Odometer tape', el('div', { role: 'region', 'aria-label': 'Odometer tape' }, [this.tapeHolder])),
        detail('Advisories', el('div', { role: 'region', 'aria-label': 'Advisories' }, [this.advisoryHolder])),
      ]),
    ]);

    const viewings = el('section', { class: 'viewings', id: 'viewings' }, [
      entrance(el('h2', { tabindex: '-1' }, ['Viewings'])),
      el('p', { class: 'lead' }, ['Pick a slot and the owner will keep the car ready for you.']),
      this.slotList,
    ]);

    const story = storyPanel(this.view.car.story, this.view.car.viewingArea, (href) => this.goToSection(href));
    const terrain = terrainCanvas(this.view.car.viewingArea);

    // The staircase trails down the right while the record and the viewings fill the space it
    // leaves on the left, so the last cards cross the hard edge of the offer band.
    const main = el('main', { id: 'main' }, [
      this.stageTrackEl,
      intro,
      el('section', { class: 'band band-pale walkround-body' }, [
        this.rereadHolder,
        this.cards,
        el('div', { class: 'lower-stack' }, [recordBlock, viewings]),
      ]),
      this.offerBand,
      story,
      terrain,
    ]);

    on(this.makeOffer, 'click', () => this.openOffer(this.makeOffer));
    this.offerBand.append(this.offerInner);
    on(this.rereadLink, 'click', (event) => {
      event.preventDefault();
      void this.openVersion(this.rereadVersion, this.rereadLink);
    });
    on(this.dockButton, 'click', () => this.pressDock());
    this.dock.append(this.dockLines, this.dockButton);

    page.append(unitsBar(), header, this.notice, main, carFileFooter(), this.dock, this.status);
    return page;
  }

  private buildHeader(): HTMLElement {
    const links = el('nav', { 'aria-label': 'Car file', class: 'header-nav' }, [
      el('a', { href: '#walkround' }, ['Walkround']),
      el('a', { href: '#record' }, ['Record']),
      el('a', { href: '#viewings' }, ['Viewings']),
      el('a', { href: '#offer' }, ['Offer']),
    ]);
    for (const link of all<HTMLAnchorElement>(links, 'a')) {
      on(link, 'click', (event) => {
        event.preventDefault();
        this.goToSection(link.getAttribute('href') ?? '#walkround');
      });
    }
    const menuButton = el('button', { type: 'button', class: 'menu-button' }, [
      el('span', { class: 'menu-bar', 'aria-hidden': 'true' }),
      el('span', { class: 'menu-bar', 'aria-hidden': 'true' }),
      el('span', { class: 'visually-hidden' }, ['Menu']),
    ]);
    menuButton.setAttribute('aria-label', 'Menu');
    on(menuButton, 'click', () => this.openMenu(menuButton));

    return el('header', { class: 'overlay-header' }, [
      el('div', { class: 'header-row' }, [
        el('span', { class: 'wordmark' }, ['Ostler Lane']),
        links,
        openBonnetMark(),
        menuButton,
      ]),
    ]);
  }

  private openMenu(opener: HTMLElement): void {
    const close = (): void => this.menu?.close();
    this.menu = new Overlay(
      { name: 'Menu', scrimCloses: true, sheet: true },
      () => [
        el('div', { class: 'overlay-head' }, [
          el('h2', {}, ['Menu']),
          closeButton(close),
        ]),
        el('nav', { 'aria-label': 'Car file', class: 'menu-nav' }, [
          ...['#walkround', '#record', '#viewings', '#offer'].map((href, index) => {
            const label = ['Walkround', 'Record', 'Viewings', 'Offer'][index];
            const link = el('a', { href }, [label]);
            on(link, 'click', (event) => {
              event.preventDefault();
              close();
              this.goToSection(href);
            });
            return link;
          }),
        ]),
        el('div', { class: 'menu-units' }, [el('span', {}, ['Units']), unitsButton()]),
      ],
    );
    this.menu.show(opener);
  }

  // ---------- painting ----------

  private paint(): void {
    this.paintStageOverlay();
    this.paintCards();
    this.paintRecord();
    this.paintSlots();
    this.paintOffer();
    this.paintDock();
    this.paintUnits();
  }

  private paintStageOverlay(): void {
    const closed = this.view.car.listingStatus !== 'live';
    setText(this.askingName, this.view.car.name);
    setText(this.askingCount, `${this.findings().length} findings`);
    setText(this.askingPrice, money(this.view.car.askingPounds));
    setText(this.askingStatus, closed ? LISTING_WORD[this.view.car.listingStatus] : '');
    syncChildren(this.asking, [
      this.askingName, this.askingCount, this.askingPrice, ...(closed ? [this.askingStatus] : []),
    ]);
    this.placeSeenCount();
  }

  /**
   * The staircase is patched in place: a poll must not replace a card, because that would take
   * the focus, the pending state and the hover with it.
   */
  private paintCards(): void {
    type Row =
      | { kind: 'finding'; key: string; finding: LinkFinding }
      | { kind: 'removed'; key: string; title: string; version: number };
    const rows: Row[] = [
      ...this.findings().map((finding): Row => ({ kind: 'finding', key: finding.id, finding })),
      ...this.view.removedFindings.map((removed): Row => ({
        kind: 'removed', key: `removed:${removed.id}`, title: removed.title, version: removed.removedInVersion,
      })),
    ];
    keyedList(this.cards, rows, (row) => row.key, () => entrance(el('li', { class: 'card-item' })), (item, row) => {
      if (row.kind === 'removed') {
        if (item.firstElementChild?.getAttribute('data-removed') !== row.key) {
          item.replaceChildren(el('article', {
            'aria-label': row.title, class: 'finding-card is-removed', 'data-removed': row.key,
          }, [
            el('h3', {}, [row.title]),
            el('p', {}, [`Removed by the owner in version ${row.version}`]),
          ]));
        }
        return;
      }
      this.fillCard(item, row.finding);
    });
    this.paintReread();
    setText(this.seenCount, `${this.view.progress.seen} of ${this.view.progress.total} seen`);
  }

  /** Builds a card once, then keeps only the parts the server has changed up to date. */
  private fillCard(item: HTMLElement, finding: LinkFinding): void {
    let article = find<HTMLElement>(item, 'article');
    if (!article) {
      article = el('article', { class: 'finding-card', 'data-finding': finding.id }, [
        el('div', { class: 'card-photo-slot' }),
        el('div', { class: 'card-body' }, [
          el('h3', { class: 'card-title' }),
          el('p', { class: 'card-meta' }),
          el('p', { class: 'card-wording' }),
          el('p', { class: 'card-changed', hidden: true }, [MESSAGE.changedCard]),
          el('div', { class: 'card-seen-slot' }),
        ]),
      ]);
      item.replaceChildren(article);
    }
    setAttr(article, 'aria-label', `Finding ${finding.position}: ${finding.title}`);
    setAttr(article, 'data-seen', finding.seen ? 'true' : 'false');
    article.classList.toggle('is-seen', finding.seen);
    article.classList.toggle('is-changed', finding.changedSinceSeen);
    setText(find(article, '.card-title'), finding.title);
    fillFindingMeta(find<HTMLElement>(article, '.card-meta') as HTMLElement, finding);
    setText(find(article, '.card-wording'), finding.wording);
    const changed = find<HTMLElement>(article, '.card-changed');
    if (changed) changed.hidden = !finding.changedSinceSeen;

    const photoSlot = find<HTMLElement>(article, '.card-photo-slot');
    const photoKey = finding.photoId ?? 'none';
    if (photoSlot && photoSlot.dataset.photo !== photoKey) {
      photoSlot.dataset.photo = photoKey;
      photoSlot.replaceChildren(this.cardPhoto(finding));
    }

    const seenSlot = find<HTMLElement>(article, '.card-seen-slot');
    const seenKey = finding.seen ? `seen:${finding.seenAt}` : 'pill';
    if (seenSlot && seenSlot.dataset.state !== seenKey) {
      seenSlot.dataset.state = seenKey;
      // a seen finding always carries its seenAt
      seenSlot.replaceChildren(finding.seen
        ? el('p', { class: 'card-seen' }, [`Seen ${showDate(finding.seenAt as string)}`])
        : this.readPill(finding));
    }
  }

  private cardPhoto(finding: LinkFinding): HTMLElement {
    if (!finding.photoId) {
      return el('div', { class: 'card-photo card-photo-drawn', 'aria-hidden': 'true' }, [svg(cardStill())]);
    }
    const photo = el('img', {
      class: 'card-photo',
      src: `/api/link/${this.token}/photos/${finding.photoId}`,
      alt: finding.title,
      loading: 'lazy',
    });
    on(photo, 'error', () => announce(this.notice, MESSAGE.photosDown));
    return photo;
  }

  private readPill(finding: LinkFinding): HTMLElement {
    const pill = el('button', { type: 'button', class: 'pill pill-read' }, ["I've read this"]);
    pressable(pill, async () => {
      announce(this.status, 'Saving');
      const done = await this.writeSeen(finding.id, true);
      if (done) this.focusNextPill(finding.position);
    });
    return pill;
  }

  private focusNextPill(position: number): void {
    const next = this.findings().find((item) => !item.seen && item.position > position)
      ?? this.findings().find((item) => !item.seen);
    if (next) {
      const pill = find<HTMLButtonElement>(this.cards, `[data-finding="${next.id}"] .pill-read`);
      if (pill) {
        pill.focus();
        return;
      }
    }
    const offer = find<HTMLButtonElement>(this.offerBand, '.make-offer');
    if (offer) offer.focus();
    else find<HTMLElement>(this.offerBand, 'h2')?.focus();
  }

  private paintReread(): void {
    const current = this.view.version.number;
    const older = this.view.versionsRead.filter((number) => number < current);
    if (older.length === 0) {
      this.rereadPrompt.remove();
      return;
    }
    this.rereadVersion = Math.max(...older);
    const changed = this.findings().filter((finding) => finding.changedSinceSeen).length;
    setText(this.rereadLine, `Findings changed since you read them: ${changed}`);
    if (!this.rereadPrompt.isConnected) this.rereadHolder.append(this.rereadPrompt);
  }

  private async openVersion(number: number, opener: HTMLElement): Promise<void> {
    try {
      const version = await api.get<{ number: number; findings: LinkFinding[] }>(
        `/api/link/${this.token}/versions/${number}`,
      );
      const close = (): void => this.versionDialog?.close();
      this.versionDialog = new Overlay({ name: `Version ${number}` }, () => [
        el('div', { class: 'overlay-head' }, [
          el('h2', {}, [`Version ${number}`]),
          closeButton(close),
        ]),
        el('div', { class: 'version-body' }, version.findings.map((finding) => el('div', { class: 'version-finding' }, [
          el('h3', {}, [`${finding.position}. ${finding.title}`]),
          el('p', {}, [finding.wording]),
        ]))),
      ]);
      this.versionDialog.show(opener);
    } catch {
      announce(this.status, MESSAGE.sendFailed);
    }
  }

  private paintRecord(): void {
    const record = this.view.record;
    this.gaugeBody.replaceChildren(...this.view.panels.map((panel) => el('tr', {}, [
      el('th', { scope: 'row' }, [panel.label]),
      // The band column says why a panel has no figure.
      el('td', { class: 'figures owner-figure' }, [
        panel.owner.microns == null ? NO_FIGURE : showMicrons(panel.owner.microns),
      ]),
      el('td', {}, [el('span', { class: bandClass(panel.owner.band) }, [panel.owner.band])]),
      el('td', { class: 'figures inspector-figure' }, [
        panel.inspector.map((row) => showMicrons(row.microns)).join(', ') || NO_FIGURE,
      ]),
    ])));

    this.tapeHolder.replaceChildren(...record.tape.map((step) => el('div', { class: 'tape-step' }, [
      el('p', { class: 'tape-date' }, [showDate(step.completedDate)]),
      el('p', { class: 'tape-reading figures' }, [
        step.odometerValue === null
          ? '—'
          : `${Number(step.odometerValue).toLocaleString('en-GB')} ${step.odometerUnit ?? ''}`,
      ]),
      el('p', { class: step.flag ? 'tape-flag' : `tape-flag tape-result-${step.testResult.toLowerCase()}` }, [
        step.flag ? ODOMETER_FLAG[step.flag] : step.testResult,
      ]),
    ])));

    this.advisoryHolder.replaceChildren(
      el('p', { class: 'advisory-tally' }, [`Open advisories: ${record.openAdvisories}`]),
      ...record.advisories.map((advisory) => el('div', { class: 'advisory-step' }, [
        el('p', { class: 'advisory-text' }, [advisory.text]),
        el('p', { class: 'advisory-stance' }, [advisory.stance ?? 'Not answered']),
        ...(advisory.note ? [el('p', { class: 'advisory-note' }, [advisory.note])] : []),
      ])),
    );
  }

  private paintUnits(): void {
    this.paintRecord();
  }

  private paintSlots(): void {
    const slots = this.view.slots;
    if (slots.length === 0) {
      this.slotList.replaceChildren(el('li', {}, [emptyState(MESSAGE.noViewings)]));
      return;
    }
    keyedList(this.slotList, slots, (slot) => slot.id, () => el('li', { class: 'slot-row' }, [
      el('span', { class: 'slot-label' }),
      el('span', { class: 'slot-length' }),
      el('span', { class: 'slot-action' }),
    ]), (row, slot) => {
      setText(find(row, '.slot-label'), slot.label);
      setText(find(row, '.slot-length'), `${slot.durationMinutes} minutes`);
      const action = find<HTMLElement>(row, '.slot-action');
      if (!action) return;
      const state = slot.heldByYou ? 'mine' : slot.held ? 'held' : this.view.car.listingStatus;
      if (action.dataset.state === state) return;
      action.dataset.state = state;
      if (slot.heldByYou) {
        const release = el('button', { type: 'button', class: 'pill' }, [`Release ${slot.label}`]);
        pressable(release, () => this.releaseSlot(slot));
        action.replaceChildren(release);
      } else if (slot.held) {
        action.replaceChildren(el('span', { class: 'slot-held' }, ['Held']));
      } else if (this.view.car.listingStatus === 'live') {
        const claim = el('button', { type: 'button', class: 'pill' }, [`Claim ${slot.label}`]);
        on(claim, 'click', () => this.openClaim(slot, claim));
        action.replaceChildren(claim);
      } else {
        action.replaceChildren();
      }
    });
  }

  /** Patched in place: a reply must not replace the heading or the button holding focus. */
  private paintOffer(): void {
    const offer = this.view.offer;
    const live = offer && (offer.status === 'open' || offer.status === 'needs_reread');
    const makeHadFocus = document.activeElement === this.makeOffer;
    if (offer) setText(this.offerAmount, `You offered ${money(offer.amountPounds)}`);
    syncChildren(this.offerInner, [
      this.offerHeading,
      ...(offer?.status === 'lapsed' ? [this.offerLapsed] : []),
      ...(offer?.status === 'needs_reread' ? [this.offerReread] : []),
      ...(offer ? [this.offerAmount] : []),
      ...(this.view.car.listingStatus === 'live' && !live ? [this.makeOffer] : []),
      ...(this.view.car.listingStatus === 'sold' ? [this.handoverLink] : []),
      ...(this.offerStatus.parentElement === this.offerInner ? [this.offerStatus] : []),
    ]);
    if (makeHadFocus && !this.makeOffer.isConnected) this.offerHeading.focus();
    if (offer) {
      this.countdown.reset(offer.secondsRemaining);
      this.paintOfferStatus();
    }
    this.placeOfferStatus();
  }

  private paintOfferStatus(): void {
    const offer = this.view.offer;
    if (!offer) return;
    const word = OFFER_WORD[offer.status];
    const live = offer.status === 'open' || offer.status === 'needs_reread';
    setText(this.offerStatus, live ? `${word} ${timeLeft(this.countdown.left())}` : word);
  }

  /** The page holds exactly one seen count: on the stage at 768 and above, in the dock below. */
  private placeSeenCount(): void {
    const home = isPhone() ? this.dockLines : this.stageOverlay;
    if (this.seenCount.parentElement !== home) home.prepend(this.seenCount);
  }

  private placeOfferStatus(): void {
    const offer = this.view.offer;
    if (!offer) {
      this.offerStatus.remove();
      return;
    }
    // On a phone the standing line sits under the seen count in the dock's text column, so the
    // dock stays two columns: the lines on the left, the one control on the right.
    const home = isPhone() ? this.dockLines : this.offerInner;
    if (this.offerStatus.parentElement !== home) home.append(this.offerStatus);
  }

  private paintDock(): void {
    setText(this.dockButton, this.findings().some((finding) => !finding.seen) ? 'Next unread' : 'To the offer');
    const held = this.view.slots.find((slot) => slot.heldByYou);
    setText(this.dockLine, !this.view.offer && held ? `Viewing ${held.label}` : '');
    this.placeSeenCount();
    this.placeOfferStatus();
  }

  private pressDock(): void {
    const unseen = this.findings().find((finding) => !finding.seen);
    if (unseen) {
      this.goToFinding(unseen.position, true);
      return;
    }
    this.goToSection('#offer');
    find<HTMLButtonElement>(this.offerBand, '.make-offer')?.focus({ preventScroll: true });
  }

  private watchTrail(): void {
    const lower = find<HTMLElement>(this.root, '.lower-stack');
    const watcher = new ResizeObserver(() => this.measureTrail());
    watcher.observe(this.cards);
    if (lower) watcher.observe(lower);
  }

  private layout(): void {
    this.dock.hidden = !isPhone();
    this.placeSeenCount();
    this.placeOfferStatus();
    this.measureTrail();
    this.stageTrackEl.style.height = this.mode() === 'scroll'
      ? `${trackLength(this.findings().length) + window.innerHeight}px`
      : '';
    this.stageTrackEl.classList.toggle('is-still', this.mode() === 'still');
  }

  /**
   * At the wide staircase the first two rows stand in three columns, and the third column carries
   * on down past the record and viewings beside it: its cards spread over that height, never
   * closer than the row gap, and the last one crosses the band's hard edge.
   */
  private measureTrail(): void {
    const items = [...this.cards.children] as HTMLElement[];
    const third = items.filter((_, index) => (index < 6 ? index % 3 === 2 : true));
    for (const item of third) item.style.removeProperty('--top');
    const lower = find<HTMLElement>(this.root, '.lower-stack');
    if (!lower || window.innerWidth < 1200 || third.length === 0) return;
    const origin = this.cards.getBoundingClientRect().top;
    const heights = third.map((item) => item.offsetHeight);
    const last = third.length - 1;
    const end = lower.getBoundingClientRect().bottom - origin - heights[last] + OVERHANG;
    let reached = -Infinity;
    third.forEach((item, row) => {
      const even = last === 0 ? end : THIRD_COLUMN_START + ((end - THIRD_COLUMN_START) * row) / last;
      const top = Math.max(even, reached);
      reached = top + heights[row] + ROW_GAP;
      item.style.setProperty('--top', `${Math.round(top)}px`);
    });
  }

  // ---------- the stage ----------

  private render(): void {
    const mode = this.mode();
    const state = this.stage.stateFor(window.scrollY, mode);
    this.stageOverlay.classList.toggle('is-handed-off', state.beat > 0);
    this.paintHandoff(state);
    this.stage.draw({
      state,
      mode,
      listing: this.view.car.listingStatus,
      dim: this.dim(),
    });
  }

  /** The travelling card, from the vertex at 60% of a beat to its docking place at the end. */
  private paintHandoff(state: StageState): void {
    const travelling = state.travel > 0 && state.finding !== null;
    this.handoff.classList.toggle('is-travelling', travelling);
    if (!travelling || !state.finding) {
      this.handoffKey = '';
      return;
    }
    const finding = this.findings().find((item) => item.id === state.finding?.id);
    if (!finding) return;
    const key = `${finding.id}:${finding.photoId ?? 'none'}:${finding.band}:${finding.wording}`;
    if (key !== this.handoffKey) {
      this.handoffKey = key;
      setText(find(this.handoff, '.handoff-title'), finding.title);
      fillFindingMeta(find<HTMLElement>(this.handoff, '.handoff-meta') as HTMLElement, finding);
      setText(find(this.handoff, '.handoff-wording'), finding.wording);
      find<HTMLElement>(this.handoff, '.handoff-photo-slot')?.replaceChildren(this.cardPhoto(finding));
    }
    this.handoff.style.setProperty('--travel', state.travel.toFixed(3));
  }

  private settleScroll(): void {
    // A jump is settling: its message below takes the position, and it writes nothing.
    if (this.jumping) return;
    const y = window.scrollY;
    if (this.mode() === 'scroll') {
      for (const finding of crossings(this.track, this.lastScroll, y)) {
        // A crossing of a finding already seen sends nothing.
        if (this.findings().find((item) => item.id === finding.id)?.seen) continue;
        void this.writeSeen(finding.id, false);
      }
    }
    this.lastScroll = y;
    this.render();
  }

  /** Marks the movement about to happen as a jump: the scroll it causes writes nothing. */
  private markJump(): void {
    this.jumping = true;
    this.jumpToken += 1;
    const token = this.jumpToken;
    // The next task, whichever the page's timers are doing: the jump's own movement has happened by
    // then, so the buyer's next scroll counts even if the jump's scroll event has not fired yet.
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      if (this.jumpToken !== token || !this.jumping) return;
      this.jumping = false;
      this.lastScroll = window.scrollY;
      // Moving focus can scroll the page without a scroll event, so the stage catches up here.
      this.render();
    };
    port2.postMessage(null);
  }

  private jumpTo(y: number): void {
    this.markJump();
    window.scrollTo({ top: y, behavior: 'instant' });
    this.catchUp();
  }

  /** The stage takes the scroll position it has just been moved to, without waiting for a frame. */
  private catchUp(): void {
    this.lastScroll = window.scrollY;
    this.render();
  }

  private goToFinding(position: number, announcePosition: boolean): void {
    const finding = this.findings().find((item) => item.position === position);
    if (!finding) return;
    if (announcePosition) {
      announce(this.status, `Finding ${position} of ${this.findings().length}`);
    }
    if (this.mode() === 'scroll') {
      this.jumpTo(BEAT * position);
      return;
    }
    const card = find<HTMLElement>(this.cards, `[data-finding="${finding.id}"]`);
    if (!card) return;
    this.markJump();
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    this.catchUp();
    const pill = find<HTMLButtonElement>(card, '.pill-read');
    if (pill) pill.focus();
    else card.focus();
  }

  private goToSection(href: string): void {
    const targets: Record<string, () => HTMLElement | null> = {
      '#walkround': () => find<HTMLElement>(this.root, '.chapter-heading'),
      '#record': () => find<HTMLElement>(this.root, '#record .plate-title'),
      '#viewings': () => find<HTMLElement>(this.root, '.viewings h2'),
      '#offer': () => find<HTMLElement>(this.offerBand, 'h2'),
      '#gauge-readings': () => find<HTMLElement>(this.root, '#gauge-readings .record-fold h3'),
    };
    const node = targets[href]?.() ?? null;
    if (!node) return;
    this.markJump();
    node.scrollIntoView({ block: 'start', behavior: 'instant' });
    this.catchUp();
    node.focus({ preventScroll: true });
    this.keepClear(node);
  }

  /** No fixed bar ever covers a focused control or heading. */
  private keepClear(node: HTMLElement | null): void {
    if (!node || !isPhone() || this.dock.hidden) return;
    // a control that lives in the fixed chrome is never covered by it
    if (node.closest('.overlay, .dock, .overlay-header')) return;
    const rect = node.getBoundingClientRect();
    const dockRect = this.dock.getBoundingClientRect();
    const header = find<HTMLElement>(this.root, '.overlay-header')?.getBoundingClientRect();
    let shift = 0;
    if (rect.bottom > dockRect.top) shift = rect.bottom - dockRect.top + 12;
    else if (header && rect.top < header.bottom) shift = rect.top - header.bottom - 12;
    if (shift === 0) return;
    this.markJump();
    window.scrollBy({ top: shift, behavior: 'instant' });
    this.catchUp();
  }

  // ---------- writes ----------

  private async writeSeen(findingId: string, fromPill: boolean): Promise<boolean> {
    if (this.writing.has(findingId)) return false;
    this.writing.add(findingId);
    this.failedWrites = this.failedWrites.filter((id) => id !== findingId);
    try {
      await api.post(`/api/link/${this.token}/seen`, { findingId });
      await this.refresh(['version']);
      return true;
    } catch (error) {
      if (error instanceof Refused && (error.status === 404 || error.status === 410)) {
        await this.refresh([]);
        return false;
      }
      announce(this.status, MESSAGE.seenFailed);
      if (!fromPill) this.failedWrites.push(findingId);
      return false;
    } finally {
      this.writing.delete(findingId);
    }
  }

  private openClaim(slot: LinkSlot, opener: HTMLElement): void {
    this.claimAttempt.reopen();
    let gone = false;
    let claimed = false;
    const status = statusRegion('Dialog status');
    const confirm = el('button', { type: 'button', class: 'pill pill-solid' }, ['Confirm viewing']);
    const cancel = el('button', { type: 'button', class: 'pill' }, ['Cancel']);
    const dialog = new Overlay({
      name: 'Claim viewing',
      locked: () => confirm.isConnected && confirm.getAttribute('aria-disabled') === 'true',
      focusHome: () => {
        const heading = find<HTMLElement>(this.root, '.viewings h2');
        if (gone) return heading;
        const stillThere = all<HTMLButtonElement>(this.slotList, 'button')
          .find((button) => button.textContent === `Claim ${slot.label}`);
        return stillThere ?? heading;
      },
      onClose: () => {
        this.claimDialog = null;
        if (!claimed) this.announcer.setHeld(false, this.lines());
      },
    }, () => [
      el('div', { class: 'overlay-head' }, [el('h2', {}, ['Claim viewing'])]),
      el('p', {}, [`Hold ${slot.label} for ${slot.durationMinutes} minutes.`]),
      status,
      el('div', { class: 'overlay-actions' }, [confirm, cancel]),
    ]);
    on(cancel, 'click', () => dialog.close());
    pressable(confirm, async () => {
      announce(status, 'Claiming viewing');
      const key = this.claimAttempt.keyFor({ slot: slot.id });
      try {
        await api.post(`/api/link/${this.token}/slots/${slot.id}/claim`, {}, { 'Idempotency-Key': key });
        claimed = true;
        dialog.close();
        await this.refresh(['slots']);
        announce(this.status, `Viewing held for ${slot.label}`);
        const release = all<HTMLButtonElement>(this.slotList, 'button')
          .find((button) => button.textContent === `Release ${slot.label}`);
        release?.focus();
        this.announcer.setHeld(false, this.lines());
      } catch (error) {
        if (error instanceof NoReply || (error instanceof Refused && error.status >= 500)) {
          announce(status, MESSAGE.sendFailed);
          return;
        }
        const refusal = error as Refused;
        const copy: Record<string, string> = {
          slot_taken: MESSAGE.slotTaken,
          slot_past: MESSAGE.slotTaken,
          already_holding_slot: MESSAGE.alreadyHolding,
          listing_closed: MESSAGE.listingClosed,
        };
        gone = refusal.body.error === 'slot_taken' || refusal.body.error === 'slot_past';
        announce(status, copy[refusal.body.error] ?? refusal.body.message);
        confirm.remove();
        cancel.focus();
        await this.refresh([]);
      }
    });
    this.announcer.setHeld(true, this.lines());
    dialog.show(opener);
    this.claimDialog = dialog;
  }

  private async releaseSlot(slot: LinkSlot): Promise<void> {
    announce(this.status, 'Releasing viewing');
    try {
      await api.post(`/api/link/${this.token}/slots/${slot.id}/release`, {});
      await this.refresh(['slots']);
      announce(this.status, 'Viewing released');
      const claim = all<HTMLButtonElement>(this.slotList, 'button')
        .find((button) => button.textContent === `Claim ${slot.label}`);
      claim?.focus();
    } catch (error) {
      announce(this.status, error instanceof Refused ? error.body.message : MESSAGE.sendFailed);
    }
  }

  private openOffer(opener: HTMLElement): void {
    this.offerAttempt.reopen();
    let sent = false;
    const status = statusRegion('Dialog status');
    const field = el('input', {
      type: 'number',
      min: '1',
      max: '10000000',
      step: '1',
      'aria-label': 'Offer in pounds',
      class: 'field-input figures',
    });
    const send = el('button', { type: 'button', class: 'pill pill-solid' }, ['Send offer']);
    const cancel = el('button', { type: 'button', class: 'pill' }, ['Cancel']);
    const dialog = new Overlay({
      name: 'Make an offer',
      locked: () => send.isConnected && send.getAttribute('aria-disabled') === 'true',
      focusHome: () => find<HTMLElement>(this.offerBand, '.make-offer') ?? find<HTMLElement>(this.offerBand, 'h2'),
      onClose: () => {
        this.offerDialog = null;
        if (!sent) this.announcer.setHeld(false, this.lines());
      },
    }, () => [
      el('div', { class: 'overlay-head' }, [el('h2', {}, ['Make an offer'])]),
      el('p', {}, [`The owner is asking ${money(this.view.car.askingPounds)}.`]),
      el('label', { class: 'field' }, [el('span', {}, ['Offer in pounds']), field]),
      status,
      el('div', { class: 'overlay-actions' }, [send, cancel]),
    ]);
    on(cancel, 'click', () => dialog.close());
    on(field, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        send.click();
      }
    });
    pressable(send, async () => {
      const amount = Number(field.value);
      announce(status, 'Sending offer');
      const key = this.offerAttempt.keyFor({ amountPounds: amount });
      try {
        await api.post(`/api/link/${this.token}/offers`, { amountPounds: amount }, { 'Idempotency-Key': key });
        sent = true;
        dialog.close();
        await this.refresh(['offer']);
        announce(this.status, 'Offer sent');
        find<HTMLElement>(this.offerBand, 'h2')?.focus();
        this.announcer.setHeld(false, this.lines());
      } catch (error) {
        if (error instanceof NoReply || (error instanceof Refused && error.status >= 500)) {
          announce(status, MESSAGE.sendFailed);
          return;
        }
        const refusal = error as Refused;
        const copy: Record<string, string> = {
          material_findings_unseen: MESSAGE.materialUnseen,
          offer_exists: MESSAGE.offerExists,
          listing_closed: MESSAGE.listingClosed,
        };
        const field_error = refusal.body.errors?.amountPounds;
        announce(status, field_error ?? copy[refusal.body.error] ?? refusal.body.message);
      }
    });
    this.announcer.setHeld(true, this.lines());
    dialog.show(opener);
    this.offerDialog = dialog;
  }

  // ---------- polling ----------

  private lines(): Map<string, string> {
    const slotsFree = this.view.slots.filter((slot) => !slot.held).length;
    const map = new Map<string, string>();
    map.set('version', `The owner has published version ${this.view.version.number}`);
    map.set('listing', `This car is now ${LISTING_WORD[this.view.car.listingStatus]}`);
    map.set('offer', this.view.offer
      ? `Your offer is now ${OFFER_WORD[this.view.offer.status]}`
      : 'Your offer is now none');
    map.set('slots', `Viewing slots free: ${slotsFree}`);
    return map;
  }

  /** Re-reads the link view after this page's own action; those lines never announce. */
  private async refresh(ownKeys: string[]): Promise<void> {
    this.readsAsked += 1;
    const read = this.readsAsked;
    this.ownReads += 1;
    let view: BuyerView;
    try {
      view = await api.get<BuyerView>(`/api/link/${this.token}`);
    } finally {
      this.ownReads -= 1;
    }
    if (read > this.readApplied) {
      this.readApplied = read;
      this.apply(view);
    }
    this.announcer.own(this.lines(), ['version', 'listing', 'offer', 'slots'].filter(
      (key) => ownKeys.includes(key) || key === 'version',
    ));
  }

  private async poll(): Promise<void> {
    if (this.ended) return;
    this.readsAsked += 1;
    const read = this.readsAsked;
    let view: BuyerView;
    try {
      view = await api.get<BuyerView>(`/api/link/${this.token}`);
    } catch (error) {
      if (error instanceof Refused && (error.status === 404 || error.status === 410)) {
        this.endPage();
        return;
      }
      await this.retryFailedWrites();
      return;
    }
    // A newer read is out, so this reply may be older than the page's own action: it is dropped.
    if (read === this.readsAsked && this.ownReads === 0) {
      this.readApplied = read;
      this.apply(view);
      this.announcer.found(this.lines());
    }
    await this.retryFailedWrites();
  }

  private async retryFailedWrites(): Promise<void> {
    const waiting = [...this.failedWrites];
    this.failedWrites = [];
    for (const id of waiting) {
      await this.writeSeen(id, false);
    }
  }

  private endPage(): void {
    this.ended = true;
    this.offerDialog?.destroy();
    this.claimDialog?.destroy();
    this.menu?.destroy();
    this.versionDialog?.destroy();
    endedPage(this.root, MESSAGE.linkEndedHeading, MESSAGE.linkEndedBody);
  }

  private apply(view: BuyerView): void {
    const countBefore = this.findings().length;
    this.view = view;
    this.track = buildTrack(this.stageFindings(), view.heroFindingId);
    this.stage.setTrack(this.track);
    this.stage.setMarkers(this.stageFindings());
    this.paintStageOverlay();
    this.paintCards();
    this.paintRecord();
    this.paintSlots();
    this.paintOffer();
    this.paintDock();
    if (countBefore !== this.findings().length) {
      this.layout();
      this.lastScroll = window.scrollY;
    } else {
      this.placeSeenCount();
      this.placeOfferStatus();
    }
    this.render();
  }
}

function closeButton(close: () => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Close']);
  on(button, 'click', close);
  return button;
}

function openBonnetMark(): SVGElement {
  return svg(`<svg viewBox="0 0 48 32" width="48" height="32" aria-hidden="true" class="brand-mark">
    <path d="M4 24 C12 10 24 6 44 8" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M8 26 L40 26" stroke="#8FB8F0" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M26 6 L34 2" stroke="#8FB8F0" stroke-width="2" stroke-linecap="round"/>
  </svg>`);
}

function cardStill(): string {
  return `<svg viewBox="0 0 320 180" role="presentation" class="card-still">
    <defs><linearGradient id="ob-card" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#4A52C8"/><stop offset="1" stop-color="#140A3F"/>
    </linearGradient></defs>
    <rect width="320" height="180" fill="url(#ob-card)"/>
    <path d="M0 120 L320 86 L320 180 L0 180 Z" fill="#0E0339" opacity="0.85"/>
    <path d="M40 104 L300 70" stroke="#FFF2DB" stroke-width="2" opacity="0.5"/>
  </svg>`;
}
