/** Buyer walkround page: stage, cards, viewings, offer, poll. */
import { api, announce, dialogFocusTrap, isLostReply, londonStamp, pounds, prefersReducedMotion, randomKey, timeLeft, viewportWidth } from './lib.js';
import { Walkround } from './walkround.js';
import type { StageFinding } from './stage.js';
import type { PanelId } from './panels.js';

interface LinkViewFinding {
  id: string; position: number; panelId: PanelId; panelLabel: string; u: number; v: number;
  title: string; wording: string; severity: string; material: boolean; band: string;
  photoId: string | null; seen: boolean; seenAt: string | null; changedSinceSeen: boolean;
}
interface Slot { id: string; label: string; startsAt: string; held: boolean; heldByYou: boolean; holderName?: string }
interface Offer { id: string; amountPounds: number; status: string; stampedAt: string; lapsesAt: string; secondsRemaining: number }
interface LinkView {
  role: string; name: string; status: string; expiresAt: string; serverNow: string;
  car: { name: string; maskedRegistration: string; askingPounds: number; viewingArea: string; story: string; listingStatus: string; firstUsedDate: string };
  version: { number: number; publishedAt: string } | null;
  heroFindingId: string | null;
  findings: LinkViewFinding[];
  removedFindings: { id: string; title: string; removedInVersion: number }[];
  progress: { seen: number; total: number; materialUnseen: number };
  panels: unknown[];
  record: { pulledAt: string; firstUsedDate: string; tape: unknown[]; advisories: unknown[]; openAdvisories: number };
  versionsRead: number[];
  slots: Slot[];
  invoices: { label: string }[];
  offer: Offer | null;
}

const OFFER_STATUS_WORD: Record<string, string> = {
  open: 'Open', needs_reread: 'Needs re-read', accepted: 'Accepted', declined: 'Declined',
  lapsed: 'Lapsed', closed_by_acceptance: 'Closed by another acceptance',
};
const LISTING_WORD: Record<string, string> = {
  draft: 'Draft', rendering: 'Rendering', live: 'Live', under_offer: 'Under offer', sold: 'Sold', withdrawn: 'Withdrawn',
};

export function mountBuyer(root: HTMLElement, token: string): void {
  root.innerHTML = `
    <div class="units-bar"><span class="units-label">Units</span><button data-units></button></div>
    <main id="buyer-main" aria-live="off"></main>
  `;
  const main = root.querySelector('#buyer-main') as HTMLElement;
  const state = {
    view: null as LinkView | null,
    units: (localStorage.getItem('ob-units') === 'mils' ? 'mils' : 'microns') as 'microns' | 'mils',
    pollTimer: 0,
    walkround: null as Walkround | null,
    pendingWrites: new Set<string>(),
    seenRetry: new Set<string>(),
    claimKey: null as string | null,
    offerKey: null as string | null,
    offerAmount: '' as string,
    baseline: null as Record<string, string> | null,
    overlayOpen: false,
    timers: [] as number[],
  };

  const statusEl = (): HTMLElement | null => main.querySelector('[data-role="walkround-status"]');
  const seenCountEl = (): HTMLElement | null => main.querySelector('[data-role="seen-count"]');

  async function load(): Promise<LinkView | null> {
    try {
      const view = await api<LinkView>(`/api/link/${token}`);
      return view;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 410) {
        window.location.replace(`/l/ended`);
        return null;
      }
      throw err;
    }
  }

  function renderShell(view: LinkView): void {
    const closedWord = ['under_offer', 'sold', 'withdrawn'].includes(view.car.listingStatus) ? `<div class="listing-word">${LISTING_WORD[view.car.listingStatus]}</div>` : '';
    main.innerHTML = `
      <div class="stage-wrap" data-role="stage-wrap">
        <div class="stage-inner" data-role="walkround-stage" aria-label="Walkround stage"></div>
        <header class="walkround-header">
          <div class="wordmark">OSTLER LANE <span>OPEN BONNET</span></div>
          <nav aria-label="Car file">
            <a href="#walkround" data-nav="walkround">WALKROUND</a>
            <a href="#record" data-nav="record">RECORD</a>
            <a href="#viewings" data-nav="viewings">VIEWINGS</a>
            <a href="#offer" data-nav="offer">OFFER</a>
          </nav>
          <svg class="bonnet-mark" viewBox="0 0 34 20" aria-hidden="true"><path d="M2 15 L10 4 L24 4 L32 15 Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <button class="pill pill-outline" data-menu hidden>Menu</button>
        </header>
        <div class="walkround-statements" data-role="statements">
          <h1 class="stat-walk" id="walkround" tabindex="-1">WALK ROUND IT FIRST</h1>
          <p class="stat-offer">THEN MAKE YOUR OFFER</p>
        </div>
        <div class="asking-summary" data-role="asking-summary" aria-label="Asking summary">
          <div class="car-name"></div>
          <div class="car-meta"><span data-role="finding-count"></span><span data-role="asking"></span></div>
          ${closedWord ? '<div class="listing-word" data-role="listing-word"></div>' : ''}
        </div>
        <p class="seen-count-desktop" data-role="seen-count" role="status" aria-label="Seen count"></p>
      </div>

      <section class="walkround-intro" aria-labelledby="intro-heading">
        <div class="content-column">
          <h2 id="intro-heading" tabindex="-1">The car, honestly told</h2>
          <p>Every finding on this car sits on the panel it belongs to. Walk round it, read each one, then decide.</p>
        </div>
      </section>

      <ol class="staircase" data-role="staircase" aria-label="Your walkround record"></ol>

      <section aria-labelledby="record-heading">
        <div class="content-column">
          <div class="record-cards">
            <div class="record-card">
              <div class="plate-inset">${view.car.maskedRegistration}</div>
              <div class="record-body">
                <h3 id="record-heading" tabindex="-1" data-role="record-title">Test record</h3>
                <p>The roadworthiness record for this car, pulled by the owner and shown as first issued.</p>
                <a class="text-link" href="#" data-role="download-report">Download condition report</a>
              </div>
            </div>
            <div class="record-card">
              <div class="plate-inset">${view.car.maskedRegistration}</div>
              <div class="record-body">
                <h3>Gauge readings</h3>
                <p>Paint thickness readings taken panel by panel with a gauge, shown beside the owner's figures.</p>
                <a class="text-link" href="#gauge-table">See the readings</a>
              </div>
            </div>
          </div>
          <div data-role="gauge-region"></div>
          <div data-role="tape-region"></div>
          <div data-role="advisories-region"></div>
        </div>
      </section>

      <section aria-labelledby="viewings-heading">
        <div class="content-column">
          <h2 id="viewings-heading" tabindex="-1">Viewings</h2>
          <ul data-role="slots" style="list-style:none;padding:0"></ul>
        </div>
      </section>

      <section class="offer-band" aria-labelledby="offer-heading">
        <div class="content-column">
          <h2 id="offer-heading" tabindex="-1">Your offer</h2>
          <div data-role="offer-region"></div>
        </div>
      </section>

      <section class="owner-story" aria-labelledby="story-heading">
        <div class="story-inner">
          <div class="story-scrim"></div>
          <img data-role="story-image" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />
          <div class="story-content">
            <p class="story-eyebrow" style="letter-spacing:.14em;text-transform:uppercase;font-size:.8rem;margin:0 0 8px">From the owner</p>
            <h2 id="story-heading" tabindex="-1" style="max-width:22ch"></h2>
            <button class="pill pill-outline" data-role="go-offer">Go to the offer</button>
          </div>
        </div>
      </section>

      <div class="terrain-band">
        <img data-role="terrain" alt="Road terrain" />
        <div class="terrain-label"></div>
      </div>

      <div data-role="re-read"></div>

      <dialog data-role="menu-dialog" aria-label="Menu">
        <div class="dialog-inner">
          <h2>Menu</h2>
          <div class="units-inline"><span>Units</span><button data-units></button></div>
          <nav style="display:flex;flex-direction:column;gap:12px">
            <a href="#walkround" data-nav="walkround">Walkround</a>
            <a href="#record" data-nav="record">Record</a>
            <a href="#viewings" data-nav="viewings">Viewings</a>
            <a href="#offer" data-nav="offer">Offer</a>
          </nav>
          <div class="dialog-row"><button class="pill pill-light" data-close>Close</button></div>
        </div>
      </dialog>

      <dialog data-role="claim-dialog" aria-label="Claim viewing">
        <div class="dialog-inner">
          <h2>Claim a viewing</h2>
          <p data-role="claim-slot"></p>
          <div class="dialog-row">
            <button class="pill pill-light" data-close data-cancel>Cancel</button>
            <button class="pill pill-solid" data-role="confirm-claim">Confirm viewing</button>
          </div>
          <p class="status-line" data-role="dialog-status" role="status" aria-label="Dialog status"></p>
        </div>
      </dialog>

      <dialog data-role="offer-dialog" aria-label="Make an offer">
        <div class="dialog-inner">
          <h2>Make an offer</h2>
          <div class="field">
            <label for="offer-amount">Offer in pounds</label>
            <input id="offer-amount" data-role="offer-amount" inputmode="numeric" type="number" min="1" step="1" />
            <span class="field-error" data-role="offer-error"></span>
          </div>
          <div class="dialog-row">
            <button class="pill pill-light" data-close data-cancel>Cancel</button>
            <button class="pill pill-solid" data-role="send-offer">Send offer</button>
          </div>
          <p class="status-line" data-role="dialog-status" role="status" aria-label="Dialog status"></p>
        </div>
      </dialog>

      <dialog data-role="version-dialog" aria-label="Version">
        <div class="dialog-inner">
          <h2 data-role="version-title"></h2>
          <div data-role="version-body"></div>
          <div class="dialog-row"><button class="pill pill-light" data-close>Close</button></div>
        </div>
      </dialog>

      <div class="walkround-dock" data-role="dock" aria-label="Walkround dock">
        <span class="dock-status" data-role="dock-status"></span>
        <span class="dock-status" data-role="dock-count"></span>
        <button data-role="dock-next"></button>
      </div>
    `;
    document.body.classList.add('has-dock');
  }

  function start(view: LinkView): void {
    renderShell(view);
    applyState(view);
    const stageEl = main.querySelector('[data-role="walkround-stage"]') as HTMLElement;
    state.walkround = new Walkround({
      container: stageEl,
      findings: () => (state.view?.findings ?? []).map(f => ({ id: f.id, panelId: f.panelId, u: f.u, v: f.v, position: f.position, severity: f.severity, seen: f.seen })),
      heroId: () => state.view?.heroFindingId ?? null,
      listing: () => state.view?.car.listingStatus ?? 'live',
      onScrollSeen: (findingId) => { void writeSeen(findingId); },
      onMarkerTap: (findingId, position) => {
        announce(statusEl(), `Finding ${position} of ${state.view?.findings.length ?? 0}`);
        goFinding(findingId);
      },
    });
    bindEvents();
    void refreshUnits();
    // Always open at scroll 0.
    window.scrollTo(0, 0);
    state.walkround.suppressNextWrite();
    schedulePoll();
    void poll(true);
  }

  async function writeSeen(findingId: string): Promise<void> {
    if (state.pendingWrites.has(findingId)) return;
    state.pendingWrites.add(findingId);
    try {
      await api(`/api/link/${token}/seen`, { method: 'POST', body: JSON.stringify({ findingId }) });
      state.seenRetry.delete(findingId);
      const view = await load();
      if (view) applyState(view, { keepScroll: true });
    } catch {
      state.seenRetry.add(findingId);
      announce(statusEl(), 'That could not be saved. Try again.');
    } finally {
      state.pendingWrites.delete(findingId);
    }
  }

  async function writeSeenFromPill(findingId: string, button: HTMLElement): Promise<void> {
    if (state.pendingWrites.has(findingId)) return;
    state.pendingWrites.add(findingId);
    announce(statusEl(), 'Saving');
    try {
      const reply = await api<{ seenAt: string }>(`/api/link/${token}/seen`, { method: 'POST', body: JSON.stringify({ findingId }) });
      state.seenRetry.delete(findingId);
      const view = await load();
      if (view) {
        applyState(view, { keepScroll: true });
        const card = main.querySelector(`[data-finding="${findingId}"]`);
        const line = card?.querySelector('[data-role="seen-line"]');
        if (line) line.textContent = `Seen ${londonStamp(reply.seenAt)}`;
      }
      moveFocusAfterPill(findingId);
    } catch {
      announce(statusEl(), 'That could not be saved. Try again.');
      void button.focus();
    } finally {
      state.pendingWrites.delete(findingId);
    }
  }

  function moveFocusAfterPill(findingId: string): void {
    const findings = state.view?.findings ?? [];
    const idx = findings.findIndex(f => f.id === findingId);
    for (let i = idx + 1; i < findings.length; i++) {
      if (!findings[i].seen) {
        const next = main.querySelector(`[data-finding="${findings[i].id}"] [data-role="read-pill"]`);
        if (next instanceof HTMLElement) { next.focus(); return; }
      }
    }
    const offer = main.querySelector('[data-role="make-offer"]');
    if (offer instanceof HTMLElement) { offer.focus(); return; }
    const heading = main.querySelector('#offer-heading');
    if (heading instanceof HTMLElement) heading.focus();
  }

  function goFinding(findingId: string): void {
    state.walkround?.suppressNextWrite();
    const findings = state.view?.findings ?? [];
    const idx = findings.findIndex(f => f.id === findingId);
    if (idx === -1) return;
    if (state.walkround && state.walkround['mode'] !== 'still' && !prefersReducedMotion()) {
      const y = 720 + idx * 720 + 10;
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    } else {
      const card = main.querySelector(`[data-finding="${findingId}"]`);
      if (card instanceof HTMLElement) {
        card.scrollIntoView({ block: 'center' });
        const pill = card.querySelector('[data-role="read-pill"]');
        (pill instanceof HTMLElement ? pill : card).focus();
      }
    }
  }

  function applyState(view: LinkView, opts: { keepScroll?: boolean } = {}): void {
    const previous = state.view;
    state.view = view;
    const stageEl = main.querySelector('[data-role="walkround-stage"]') as HTMLElement;
    stageEl.dataset.listing = view.car.listingStatus;
    main.querySelector('[data-role="asking-summary"] .car-name')!.textContent = view.car.name;
    main.querySelector('[data-role="finding-count"]')!.textContent = `${view.findings.length} findings`;
    main.querySelector('[data-role="asking"]')!.textContent = pounds(view.car.askingPounds);
    const listingWord = main.querySelector('[data-role="listing-word"]');
    if (listingWord) listingWord.textContent = ['under_offer', 'sold', 'withdrawn'].includes(view.car.listingStatus) ? LISTING_WORD[view.car.listingStatus] : '';
    main.querySelector('#story-heading')!.textContent = view.car.story.split('.')[0] + '.';
    (main.querySelector('[data-role="terrain"]') as HTMLImageElement).src = '/terrain.svg';
    (main.querySelector('[data-role="story-image"]') as HTMLImageElement).src = '/story.svg';
    (main.querySelector('.terrain-label') as HTMLElement).textContent = `Viewing in ${view.car.viewingArea}`;

    const staircase = main.querySelector('[data-role="staircase"]') as HTMLElement;
    staircase.replaceChildren(...view.findings.map(f => findingCard(f)), ...view.removedFindings.map(r => removedCard(r)));

    renderGauge(view);
    renderTape(view);
    renderAdvisories(view);
    renderSlots(view);
    renderOffer(view);
    renderReRead(view);
    updateSeenCount(view);
    state.walkround?.redraw();
    void previous;
    void opts;
  }

  function findingCard(f: LinkViewFinding): HTMLElement {
    const li = document.createElement('li');
    li.innerHTML = `
      <article class="finding-card card ${f.seen ? '' : 'dimmed'}" data-finding="${f.id}" data-seen="${f.seen}" aria-label="Finding ${f.position}: ${f.title}">
        ${f.photoId ? `<img class="photo" alt="" src="/api/link/${token}/photos/${f.photoId}" />` : `<img class="photo" alt="" src="/stage-still.svg" />`}
        <div class="card-body">
          <h3 class="card-title"></h3>
          <div class="meta-line"><span class="tabular"></span><span></span></div>
          <p class="wording"></p>
          ${f.changedSinceSeen && !f.seen ? '<p class="changed-line">Changed. Read it again.</p>' : ''}
          <p class="seen-line" data-role="seen-line"></p>
          <button class="pill pill-light" data-role="read-pill">I've read this</button>
        </div>
      </article>`;
    li.querySelector('.card-title')!.textContent = f.title;
    li.querySelector('.wording')!.textContent = f.wording;
    const meta = li.querySelectorAll('.meta-line span');
    meta[0].textContent = f.band;
    meta[1].textContent = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
    const seenLine = li.querySelector('[data-role="seen-line"]') as HTMLElement;
    const pill = li.querySelector('[data-role="read-pill"]') as HTMLElement;
    if (f.seen) {
      seenLine.textContent = `Seen ${f.seenAt ? londonStamp(f.seenAt) : ''}`;
      pill.remove();
    } else {
      seenLine.textContent = 'Not seen yet';
      pill.addEventListener('click', () => { void writeSeenFromPill(f.id, pill); });
    }
    return li;
  }

  function removedCard(r: { title: string; removedInVersion: number }): HTMLElement {
    const li = document.createElement('li');
    li.innerHTML = `
      <article class="finding-card card dimmed">
        <div class="card-body">
          <h3 class="card-title"></h3>
          <p class="wording">Removed by the owner in version ${r.removedInVersion}.</p>
        </div>
      </article>`;
    li.querySelector('.card-title')!.textContent = r.title;
    return li;
  }

  function renderGauge(view: LinkView): void {
    const region = main.querySelector('[data-role="gauge-region"]') as HTMLElement;
    const panels = view.panels as { id: string; label: string; substrate: string; owner: { microns: number } | null; inspector: { microns: number; name?: string; band: string }[] }[];
    const figures = (m: number) => state.units === 'mils' ? `${(Math.floor(m / 25.4 * 10 + 0.5) / 10).toFixed(1)} mils` : `${m} microns`;
    region.innerHTML = `
      <h3>Gauge readings</h3>
      <table aria-label="Gauge readings"><thead><tr><th>Panel</th><th>Owner</th><th>Inspector</th></tr></thead>
      <tbody>${panels.map(p => `<tr><td>${p.label}</td><td class="tabular">${p.owner ? figures(p.owner.microns) : 'No reading'}</td><td class="tabular">${p.inspector.map(i => figures(i.microns)).join('<br/>') || '—'}</td></tr>`).join('')}</tbody></table>
      <p id="gauge-table"></p>`;
  }

  function renderTape(view: LinkView): void {
    const region = main.querySelector('[data-role="tape-region"]') as HTMLElement;
    const tape = view.record.tape as { completedDate: string; testResult: string; odometerValue: string | null; odometerUnit: string | null; normalisedKm: number | null; flag: string | null; status: string }[];
    region.innerHTML = `
      <h3>Odometer tape</h3>
      <table aria-label="Odometer tape"><thead><tr><th>Date</th><th>Result</th><th>Odometer</th><th>Unit</th><th>Flag</th></tr></thead>
      <tbody>${tape.map(t => `<tr><td class="tabular">${t.completedDate.slice(0, 10)}</td><td>${t.testResult}</td><td class="tabular">${t.odometerValue ?? '—'}</td><td>${t.odometerUnit ?? '—'}</td><td>${t.flag ? tapeFlag(t.flag) : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  function tapeFlag(flag: string): string {
    return { unit_change: 'Unit changed, not a drop', drop: 'Mileage drop', no_odometer: 'No odometer reading', unreadable: 'Odometer unreadable' }[flag] ?? '';
  }

  function renderAdvisories(view: LinkView): void {
    const region = main.querySelector('[data-role="advisories-region"]') as HTMLElement;
    const advisories = view.record.advisories as { id: string; text: string; stance: string | null; note: string | null }[];
    region.innerHTML = `
      <h3>Advisories</h3>
      <p>Open advisories: ${view.record.openAdvisories}</p>
      <ul style="list-style:none;padding:0">${advisories.map(a => `<li style="border-bottom:1px solid var(--surface);padding:10px 0"><strong></strong> — <span></span></li>`).join('')}</ul>`;
    advisories.forEach((a, i) => {
      const li = region.querySelectorAll('li')[i];
      li.querySelector('strong')!.textContent = a.text;
      li.querySelector('span')!.textContent = a.stance ? `${a.stance.replace('_', ' ')}: ${a.note ?? ''}` : 'Unanswered';
    });
  }

  function renderSlots(view: LinkView): void {
    const ul = main.querySelector('[data-role="slots"]') as HTMLElement;
    if (view.slots.length === 0) {
      ul.innerHTML = '<li>No viewings offered yet</li>';
      return;
    }
    const live = view.car.listingStatus === 'live' || view.car.listingStatus === 'under_offer';
    ul.replaceChildren(...view.slots.map(slot => {
      const li = document.createElement('li');
      li.style.cssText = 'border-bottom:1px solid var(--surface);padding:12px 0;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap';
      const label = document.createElement('span');
      label.className = 'tabular';
      label.textContent = slot.label;
      li.appendChild(label);
      if (slot.heldByYou) {
        const release = document.createElement('button');
        release.className = 'pill pill-light';
        release.textContent = `Release ${slot.label}`;
        release.addEventListener('click', () => void releaseSlot(slot));
        li.appendChild(release);
      } else if (slot.held) {
        const held = document.createElement('span');
        held.textContent = 'Held';
        li.appendChild(held);
      } else if (live) {
        const claim = document.createElement('button');
        claim.className = 'pill pill-light';
        claim.textContent = `Claim ${slot.label}`;
        claim.addEventListener('click', () => openClaimDialog(slot, claim));
        li.appendChild(claim);
      }
      return li;
    }));
  }

  function renderOffer(view: LinkView): void {
    const region = main.querySelector('[data-role="offer-region"]') as HTMLElement;
    region.replaceChildren();
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-label', 'Offer status');
    status.dataset.role = 'offer-status';
    if (view.offer) {
      const word = OFFER_STATUS_WORD[view.offer.status] ?? view.offer.status;
      status.textContent = view.offer.status === 'open' || view.offer.status === 'needs_reread'
        ? `${word} ${timeLeft(view.offer.secondsRemaining)}`
        : word;
      region.appendChild(status);
      if (view.offer.status === 'lapsed') {
        const notice = document.createElement('div');
        notice.className = 'notice-panel';
        notice.innerHTML = '<h3>This offer has lapsed</h3><p>You can make a new offer while the car is still live.</p>';
        region.appendChild(notice);
      }
      if (view.offer.status === 'needs_reread') {
        const line = document.createElement('p');
        line.textContent = 'Your offer needs a re-read';
        region.appendChild(line);
      }
    }
    if (view.car.listingStatus === 'sold') {
      const link = document.createElement('a');
      link.href = `/api/link/${token}/handover`;
      link.textContent = 'Download handover record';
      region.appendChild(link);
      return;
    }
    const canOffer = view.car.listingStatus === 'live' && (!view.offer || !['open', 'needs_reread'].includes(view.offer.status));
    if (canOffer) {
      const button = document.createElement('button');
      button.className = 'pill pill-solid';
      button.textContent = 'Make an offer';
      button.dataset.role = 'make-offer';
      button.addEventListener('click', () => openOfferDialog());
      region.appendChild(button);
    }
  }

  function renderReRead(view: LinkView): void {
    const region = main.querySelector('[data-role="re-read"]') as HTMLElement;
    const current = view.version?.number ?? 0;
    const older = view.versionsRead.filter(v => v < current);
    const changed = view.findings.filter(f => f.changedSinceSeen && !f.seen).length;
    region.replaceChildren();
    if (older.length === 0 || changed === 0) return;
    const panel = document.createElement('div');
    panel.className = 'notice-panel';
    panel.style.cssText = 'margin:40px 22px;max-width:620px;margin-left:auto;margin-right:auto';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Re-read prompt');
    panel.innerHTML = `
      <h3>The owner has changed this car's file</h3>
      <p>Findings changed since you read them: ${changed}</p>
      <a class="text-link" data-role="see-version">See the version you read</a>`;
    panel.querySelector('[data-role="see-version"]')!.addEventListener('click', () => void openVersionDialog(Math.max(...older)));
    region.appendChild(panel);
  }

  function updateSeenCount(view: LinkView): void {
    const text = `${view.progress.seen} of ${view.progress.total} seen`;
    const desktop = main.querySelector('[data-role="seen-count"]');
    const dockCount = main.querySelector('[data-role="dock-count"]');
    if (viewportWidth() >= 768) {
      if (desktop) desktop.textContent = text;
      if (dockCount) dockCount.textContent = '';
    } else {
      if (desktop) desktop.textContent = '';
      if (dockCount) dockCount.textContent = text;
    }
    const dock = main.querySelector('[data-role="dock"]');
    const dockStatus = main.querySelector('[data-role="dock-status"]');
    if (dock instanceof HTMLElement && dockStatus) {
      let line = '';
      const held = view.slots.find(s => s.heldByYou);
      if (view.offer) {
        const word = OFFER_STATUS_WORD[view.offer.status] ?? view.offer.status;
        line = view.offer.status === 'open' || view.offer.status === 'needs_reread' ? `${word} ${timeLeft(view.offer.secondsRemaining)}` : word;
      } else if (held) {
        line = `Viewing ${held.label}`;
      }
      dockStatus.textContent = line;
      const button = main.querySelector('[data-role="dock-next"]') as HTMLButtonElement;
      const nextUnread = view.findings.find(f => !f.seen);
      if (nextUnread) {
        button.textContent = 'Next unread';
        button.dataset.action = 'next';
      } else {
        button.textContent = 'To the offer';
        button.dataset.action = 'offer';
      }
    }
  }

  function openClaimDialog(slot: Slot, opener: HTMLElement): void {
    const dialog = main.querySelector('[data-role="claim-dialog"]') as HTMLDialogElement;
    main.querySelector('[data-role="claim-slot"]')!.textContent = slot.label;
    const confirm = main.querySelector('[data-role="confirm-claim"]') as HTMLButtonElement;
    confirm.style.display = '';
    confirm.removeAttribute('aria-disabled');
    state.claimKey = randomKey();
    openDialog(dialog, opener, async (close) => {
      confirm.setAttribute('aria-disabled', 'true');
      announce(dialogStatus(), 'Claiming viewing');
      try {
        await api(`/api/link/${token}/slots/${slot.id}/claim`, { method: 'POST', idempotencyKey: state.claimKey!, body: '{}' });
        const view = await load();
        if (view) applyState(view, { keepScroll: true });
        close();
        const release = main.querySelector(`[data-role="slots"] button`);
        const target = Array.from(main.querySelectorAll('[data-role="slots"] button')).find(b => b.textContent?.startsWith('Release')) ?? null;
        if (target instanceof HTMLElement) target.focus();
        else if (view) { const h = main.querySelector('#viewings-heading'); if (h instanceof HTMLElement) h.focus(); }
        void release;
        announce(statusEl(), `Viewing held for ${slot.label}`);
      } catch (err) {
        confirm.style.display = 'none';
        const body = (err as { body?: { error?: string } }).body;
        const code = body?.error;
        if (isLostReply(err)) {
          announce(dialogStatus(), 'That could not be sent. Try again.');
          confirm.style.display = '';
          confirm.removeAttribute('aria-disabled');
          void confirm.focus();
          return;
        }
        if (code === 'slot_taken' || code === 'slot_past') announce(dialogStatus(), 'That slot has just gone');
        else if (code === 'already_holding_slot') announce(dialogStatus(), 'You already hold a viewing. Release it first.');
        else if (code === 'listing_closed') announce(dialogStatus(), 'This car is not taking viewings or offers right now');
        else announce(dialogStatus(), (err as Error).message);
        const view = await load().catch(() => null);
        if (view) { view.slots = view.slots; renderSlots(view); }
        confirm.style.display = 'none';
      }
    });
  }

  async function releaseSlot(slot: Slot): Promise<void> {
    try {
      await api(`/api/link/${token}/slots/${slot.id}/release`, { method: 'POST', body: '{}' });
      const view = await load();
      if (view) applyState(view, { keepScroll: true });
      const claimBtn = Array.from(main.querySelectorAll('[data-role="slots"] button')).find(b => b.textContent?.includes(slot.label));
      if (claimBtn instanceof HTMLElement) claimBtn.focus();
    } catch (err) {
      announce(statusEl(), (err as Error).message);
    }
  }

  function openOfferDialog(): void {
    const dialog = main.querySelector('[data-role="offer-dialog"]') as HTMLDialogElement;
    const amount = main.querySelector('[data-role="offer-amount"]') as HTMLInputElement;
    const send = main.querySelector('[data-role="send-offer"]') as HTMLButtonElement;
    amount.value = state.offerAmount;
    send.style.display = '';
    send.removeAttribute('aria-disabled');
    state.offerKey = randomKey();
    const error = main.querySelector('[data-role="offer-error"]') as HTMLElement;
    error.textContent = '';
    openDialog(dialog, main.querySelector('[data-role="make-offer"]'), async (close) => {
      const value = amount.value.trim();
      const parsed = Number(value);
      if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1 || parsed > 10_000_000) {
        error.textContent = 'Enter a whole number of pounds from 1 to 10000000';
        return;
      }
      state.offerAmount = value;
      const body = JSON.stringify({ amountPounds: parsed });
      send.setAttribute('aria-disabled', 'true');
      announce(dialogStatus(), 'Sending offer');
      try {
        await api(`/api/link/${token}/offers`, { method: 'POST', idempotencyKey: state.offerKey!, body });
        const view = await load();
        if (view) applyState(view, { keepScroll: true });
        close();
        const heading = main.querySelector('#offer-heading');
        if (heading instanceof HTMLElement) heading.focus();
        announce(statusEl(), 'Offer sent');
      } catch (err) {
        send.style.display = '';
        send.removeAttribute('aria-disabled');
        const code = (err as { body?: { error?: string } }).body?.error;
        if (isLostReply(err)) {
          announce(dialogStatus(), 'That could not be sent. Try again.');
          void send.focus();
          return;
        }
        if (code === 'material_findings_unseen') announce(dialogStatus(), 'Read every material finding before making an offer');
        else if (code === 'offer_exists') announce(dialogStatus(), 'You already have an offer on this car');
        else if (code === 'listing_closed') announce(dialogStatus(), 'This car is not taking viewings or offers right now');
        else if ((err as { body?: { errors?: Record<string, string> } }).body?.errors?.amountPounds) {
          error.textContent = (err as { body: { errors: Record<string, string> } }).body.errors.amountPounds;
        } else announce(dialogStatus(), (err as Error).message);
        void send.focus();
      }
    });
  }

  async function openVersionDialog(number: number): Promise<void> {
    const dialog = main.querySelector('[data-role="version-dialog"]') as HTMLDialogElement;
    main.querySelector('[data-role="version-title"]')!.textContent = `Version ${number}`;
    const body = main.querySelector('[data-role="version-body"]') as HTMLElement;
    body.textContent = 'Loading...';
    openDialog(dialog, main.querySelector('[data-role="see-version"]'), async (close) => { void close; });
    try {
      const version = await api<{ findings: { title: string; wording: string; seen: boolean }[] }>(`/api/link/${token}/versions/${number}`);
      body.replaceChildren(...version.findings.map(f => {
        const div = document.createElement('div');
        div.style.cssText = 'border-bottom:1px solid var(--surface);padding:10px 0';
        div.innerHTML = `<strong></strong><p></p><p class="seen-line"></p>`;
        div.querySelector('strong')!.textContent = f.title;
        div.querySelector('p')!.textContent = f.wording;
        div.querySelector('.seen-line')!.textContent = f.seen ? 'Seen in this version' : 'Not seen in this version';
        return div;
      }));
    } catch {
      body.textContent = 'That version could not be read.';
    }
  }

  function dialogStatus(): HTMLElement | null {
    return main.querySelector('[data-role="claim-dialog"] [data-role="dialog-status"], [data-role="offer-dialog"] [data-role="dialog-status"]');
  }

  function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, onConfirm: (close: () => void) => Promise<void>): void {
    state.overlayOpen = true;
    document.body.classList.add('ob-overlay-open');
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>('input, select, textarea, button:not([data-close]), a[href]');
    (first ?? dialog).focus();
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      cleanup();
      if (prefersReducedMotion()) { finish(); } else { void dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.then(finish); }
    };
    const finish = (): void => {
      dialog.close();
      state.overlayOpen = false;
      document.body.classList.remove('ob-overlay-open');
      if (opener && opener.isConnected) opener.focus();
    };
    const cleanup = (): void => {
      dialog.removeEventListener('keydown', keydown);
      dialog.querySelector('[data-close]')?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancelEvent);
      dialog.removeEventListener('click', onScrim);
    };
    const onCancel = (): void => close();
    const onCancelEvent = (e: Event): void => { e.preventDefault(); close(); };
    const onScrim = (e: MouseEvent): void => {
      if (!dialog.dataset.scrimClose) return;
      const rect = dialog.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) close();
    };
    const keydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      // Enter in the offer amount field sends the offer.
      if (e.key === 'Enter' && (e.target as HTMLElement)?.matches('[data-role="offer-amount"]')) {
        e.preventDefault();
        const confirmBtn = dialog.querySelector<HTMLElement>('[data-role="send-offer"]');
        if (confirmBtn && confirmBtn.getAttribute('aria-disabled') !== 'true') confirmBtn.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href]'))
        .filter(el => el.getAttribute('aria-disabled') !== 'true' && el.style.display !== 'none' && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    dialog.querySelector('[data-close]')?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancelEvent);
    dialog.addEventListener('click', onScrim);
    const confirm = dialog.querySelector<HTMLElement>('[data-role="confirm-claim"], [data-role="send-offer"]');
    if (confirm) confirm.addEventListener('click', () => { void onConfirm(close); });
  }

  function bindEvents(): void {
    main.querySelectorAll('[data-nav]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        state.walkround?.suppressNextWrite();
        const which = (link as HTMLElement).dataset.nav;
        const target = which === 'walkround' ? main.querySelector('#intro-heading')
          : which === 'record' ? main.querySelector('[data-role="record-title"]')
          : which === 'viewings' ? main.querySelector('#viewings-heading')
          : main.querySelector('#offer-heading');
        (target as HTMLElement)?.scrollIntoView({ block: 'start' });
        (target as HTMLElement)?.focus();
        const menu = main.querySelector('[data-role="menu-dialog"]') as HTMLDialogElement;
        if (menu.open) menu.close();
      });
    });
    main.querySelector('[data-role="go-offer"]')?.addEventListener('click', () => {
      state.walkround?.suppressNextWrite();
      const heading = main.querySelector('#offer-heading') as HTMLElement;
      heading.scrollIntoView();
      heading.focus();
    });
    const dockButton = main.querySelector('[data-role="dock-next"]') as HTMLButtonElement;
    dockButton.addEventListener('click', () => {
      state.walkround?.suppressNextWrite();
      if (dockButton.dataset.action === 'next') {
        const view = state.view;
        const next = view?.findings.find(f => !f.seen);
        if (next) {
          announce(statusEl(), `Finding ${next.position} of ${view?.findings.length}`);
          goFinding(next.id);
        }
      } else {
        const heading = main.querySelector('#offer-heading') as HTMLElement;
        heading.scrollIntoView();
        const offer = main.querySelector('[data-role="make-offer"]');
        if (offer instanceof HTMLElement) offer.focus(); else heading.focus();
      }
    });
    main.querySelector('[data-menu]')?.addEventListener('click', () => {
      const menu = main.querySelector('[data-role="menu-dialog"]') as HTMLDialogElement;
      menu.dataset.scrimClose = 'true';
      openDialog(menu, main.querySelector('[data-menu]'), async () => {});
    });
    main.querySelector('[data-role="download-report"]')?.addEventListener('click', (e) => {
      (e.target as HTMLAnchorElement).href = `/api/link/${token}/report`;
    });
    main.querySelectorAll('[data-units]').forEach(button => {
      button.addEventListener('click', () => {
        state.units = state.units === 'microns' ? 'mils' : 'microns';
        localStorage.setItem('ob-units', state.units);
        void refreshUnits();
      });
    });
    window.addEventListener('resize', () => { if (state.view) updateSeenCount(state.view); });
  }

  async function refreshUnits(): Promise<void> {
    main.querySelectorAll('[data-units]').forEach(button => {
      button.textContent = state.units === 'microns' ? 'Units: microns' : 'Units: mils';
    });
    if (state.view) renderGauge(state.view);
  }

  function schedulePoll(): void {
    state.pollTimer = window.setInterval(() => void poll(), 15_000);
    window.addEventListener('focus', () => void poll());
  }

  async function poll(first = false): Promise<void> {
    const view = await load().catch(() => null);
    if (!view) return;
    // Retry any waiting seen writes first.
    for (const findingId of [...state.seenRetry]) await writeSeen(findingId);
    applyState(view, { keepScroll: true });
    void first;
  }

  void load().then((view) => {
    if (view) start(view);
  }).catch(() => {
    main.innerHTML = `<div class="notice-panel" style="margin:60px auto;max-width:520px" role="alert" aria-label="Service notice">
      <p>The page could not load. Try again shortly.</p></div>`;
  });
}
