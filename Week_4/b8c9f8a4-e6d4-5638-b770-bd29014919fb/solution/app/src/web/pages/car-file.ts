// The owner's car file: one long page of titled sections, with the section navigation inline on
// a wide screen and inside the sections sheet on a phone.

import { api, Refused } from '../api.js';
import { all, el, find, isPhone, on, setText } from '../dom.js';
import { LISTING_WORD, MESSAGE, SECTIONS } from '../../shared/copy.js';
import { carFileFooter } from '../parts/footer.js';
import { ownerChrome } from '../parts/owner-chrome.js';
import { Overlay } from '../ui/overlay.js';
import { Announcer } from '../ui/announce.js';
import { announce, announceSteps, statusRegion } from '../ui/status.js';
import { pressable } from '../ui/pending.js';
import { Stage } from '../stage/stage.js';
import { buildTrack } from '../stage/model.js';
import { buildSections, type CarFileContext, type CarData } from './car-sections.js';
import type {
  AlertRow, CarView, LinkRow, OwnerFinding, OwnerOffer, PanelView, RecordView, UploadView,
} from '../types.js';
import type { LinkSlot } from '../types.js';

const POLL_MS = 15000;

const STANDING_LINES: { key: string; line: (car: CarView) => string }[] = [
  { key: 'panels', line: (car) => `Read: ${car.standing.panelsRead} of ${car.standing.panelsGaugeable}` },
  { key: 'findings', line: (car) => `Findings: ${car.standing.findings}` },
  { key: 'evidence', line: (car) => `Files: ${car.standing.files}` },
  { key: 'record', line: (car) => `Open advisories: ${car.workingOpenAdvisories}` },
  { key: 'publish', line: (car) => `Blockers: ${car.publishBlockers.length}` },
  { key: 'people', line: (car) => `Active links: ${car.standing.activeLinks}` },
  { key: 'viewings', line: (car) => `Slots held: ${car.standing.slotsHeld} of ${car.standing.slots}` },
  { key: 'offers', line: (car) => `Live offers: ${car.standing.liveOffers}` },
  { key: 'alerts', line: (car) => `Failed alerts: ${car.standing.failedAlerts}` },
];

export function carFilePage(root: HTMLElement, car: CarView): void {
  void new CarFilePage(root, car).mount();
}

class CarFilePage {
  private readonly root: HTMLElement;
  private data: CarData;
  private readonly chrome = ownerChrome('Car file');
  private readonly nav = el('nav', { 'aria-label': 'Car file sections', class: 'section-nav' });
  private readonly sheetNav = el('nav', { 'aria-label': 'Car file sections', class: 'section-nav' });
  private readonly bar = el('div', { role: 'region', 'aria-label': 'Car file bar', class: 'car-file-bar' });
  private readonly preview: Stage;
  private sheet: Overlay | null = null;
  private sheetStatus = statusRegion('Dialog status');
  private readonly announcer: Announcer;
  private readsAsked = 0;
  private readApplied = 0;
  private ownReads = 0;
  private sections: ReturnType<typeof buildSections> | null = null;
  private previewAdvisories = 0;

  constructor(root: HTMLElement, car: CarView) {
    this.root = root;
    this.data = {
      car,
      panels: [],
      medians: { steel: null, aluminium: null },
      findings: [],
      uploads: [],
      record: null,
      links: [],
      slots: [],
      offers: [],
      alerts: [],
    };
    this.preview = new Stage({ label: 'Stage preview', carName: () => this.data.car.name, preview: true });
    this.announcer = new Announcer(() => this.chrome.status, STANDING_LINES.map((item) => item.key));
  }

  private context(): CarFileContext {
    return {
      carId: this.data.car.id,
      data: () => this.data,
      status: () => this.chrome.status,
      notice: () => this.chrome.notice,
      preview: this.preview,
      act: (options) => this.act(options),
      refresh: (keys) => this.refresh(keys),
      hold: (held) => this.announcer.setHeld(held, this.lines()),
      release: () => this.announcer.setHeld(false, this.lines()),
      setPreviewPin: (pin) => this.drawPreview(pin),
    };
  }

  async mount(): Promise<void> {
    this.data = await this.load();
    this.sections = buildSections(this.context());
    this.root.replaceChildren(this.build());
    this.paint();
    this.layout();
    this.announcer.start(this.lines());
    on(window, 'resize', () => this.layout());
    window.setInterval(() => void this.poll(), POLL_MS);
    on(window, 'focus', () => void this.poll());
    this.openFragment();
  }

  private build(): HTMLElement {
    const sections = this.sections;
    const body = el('div', { class: 'car-file-body' },
      SECTIONS.map((section) => sections?.byFragment[section.fragment] ?? el('section', {})));
    return el('div', { class: 'owner-page car-file-page' }, [
      this.chrome.bar,
      this.chrome.header,
      this.chrome.notice,
      el('main', { id: 'main', class: 'car-file-main' }, [
        el('h1', { class: 'car-file-title' }, [this.data.car.name]),
        this.nav,
        body,
        this.chrome.status,
      ]),
      carFileFooter(),
      this.bar,
    ]);
  }

  private navList(inSheet: boolean): HTMLElement {
    const list = el('ul', { role: 'list', class: 'section-list' }, SECTIONS.map((section) => {
      const link = el('a', { href: `#${section.fragment}` }, [section.heading]);
      on(link, 'click', (event) => {
        event.preventDefault();
        if (inSheet) this.sheet?.close();
        this.goToSection(section.fragment);
      });
      const line = el('p', { class: 'standing-line', 'data-standing': section.fragment }, ['']);
      const item = el('li', {}, [link, line]);
      if (inSheet && section.fragment === 'alerts') item.append(this.sheetRetryHolder);
      return item;
    }));
    return list;
  }

  private readonly sheetRetryHolder = el('span', { class: 'sheet-retry' });

  private goToSection(fragment: string): void {
    window.history.replaceState(null, '', `#${fragment}`);
    const heading = find<HTMLElement>(this.root, `#${fragment} h2`);
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
    heading?.focus({ preventScroll: true });
    this.keepClear(heading);
  }

  private keepClear(node: HTMLElement | null): void {
    if (!node || !isPhone()) return;
    const rect = node.getBoundingClientRect();
    const barRect = this.bar.getBoundingClientRect();
    if (rect.bottom > barRect.top) window.scrollBy({ top: rect.bottom - barRect.top + 12, behavior: 'instant' });
  }

  private openFragment(): void {
    const fragment = window.location.hash.replace('#', '');
    if (!SECTIONS.some((section) => section.fragment === fragment)) return;
    const heading = find<HTMLElement>(this.root, `#${fragment} h2`);
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (fragment === 'panels') heading?.focus({ preventScroll: true });
  }

  // ---------- data ----------

  private async load(): Promise<CarData> {
    const id = this.data.car.id;
    const [car, panels, findings, uploads, links, slots, offers, alerts] = await Promise.all([
      api.get<CarView>(`/api/owner/cars/${id}`),
      api.get<{ panels: PanelView[]; medians: { steel: number | null; aluminium: number | null } }>(
        `/api/owner/cars/${id}/panels`),
      api.get<{ findings: OwnerFinding[] }>(`/api/owner/cars/${id}/findings`),
      api.get<{ uploads: UploadView[] }>(`/api/owner/cars/${id}/uploads`),
      api.get<{ links: LinkRow[] }>(`/api/owner/cars/${id}/links`),
      api.get<{ slots: LinkSlot[] }>(`/api/owner/cars/${id}/slots`),
      api.get<{ offers: OwnerOffer[] }>(`/api/owner/cars/${id}/offers`),
      api.get<{ alerts: AlertRow[] }>('/api/owner/alerts'),
    ]);
    let record: RecordView | null = null;
    try {
      record = await api.get<RecordView>(`/api/owner/cars/${id}/record`);
    } catch {
      record = null;
    }
    return {
      car,
      panels: panels.panels,
      medians: panels.medians,
      findings: findings.findings,
      uploads: uploads.uploads,
      record,
      links: links.links,
      slots: slots.slots,
      offers: offers.offers,
      alerts: alerts.alerts.filter((alert) => alert.carId === id),
    };
  }

  private lines(): Map<string, string> {
    const map = new Map<string, string>();
    for (const item of STANDING_LINES) map.set(item.key, item.line(this.data.car));
    return map;
  }

  private async refresh(ownKeys: string[]): Promise<void> {
    this.readsAsked += 1;
    const read = this.readsAsked;
    this.ownReads += 1;
    let data: CarData;
    try {
      data = await this.load();
    } finally {
      this.ownReads -= 1;
    }
    if (read > this.readApplied) {
      this.readApplied = read;
      this.data = data;
      this.paint();
    }
    this.announcer.own(this.lines(), ownKeys);
  }

  private async poll(): Promise<void> {
    this.readsAsked += 1;
    const read = this.readsAsked;
    let data: CarData;
    try {
      data = await this.load();
    } catch {
      return;
    }
    // A newer read is out, so this reply may be older than the page's own action: it is dropped.
    if (read !== this.readsAsked || this.ownReads > 0) return;
    this.readApplied = read;
    this.data = data;
    this.paint();
    this.announcer.found(this.lines());
  }

  // ---------- painting ----------

  private paint(): void {
    this.sections?.paint(this.data);
    // the sheet lives at the end of the document, so its lines are kept up to date too
    for (const holder of all<HTMLElement>(document, '[data-standing]')) {
      const key = holder.getAttribute('data-standing') ?? '';
      const row = STANDING_LINES.find((item) => item.key === key);
      if (row) setText(holder, row.line(this.data.car));
    }
    setText(find<HTMLElement>(this.bar, '.bar-status'), LISTING_WORD[this.data.car.listingStatus]);
    this.paintSheetRetry();
    this.drawPreview(null);
  }

  private drawPreview(pin: { panelId: string; u: number; v: number } | null): void {
    const findings = this.data.findings;
    if (!pin && findings.length === 0) {
      this.preview.setTrack(buildTrack([], null));
      this.preview.setOpenAdvisories(this.data.car.workingOpenAdvisories);
      this.preview.showEmpty(MESSAGE.noFindings);
      return;
    }
    const resting = pin
      ? [{ id: 'pin', position: 1, panelId: pin.panelId, u: pin.u, v: pin.v, seen: false, title: 'Unsaved pin' }]
      : [];
    const asStage = findings.map((finding) => ({
      id: finding.id,
      position: finding.position,
      panelId: finding.panelId,
      u: finding.u,
      v: finding.v,
      seen: false,
      title: finding.title,
    }));
    const hero = pin
      ? resting[0]
      : [...asStage].sort((a, b) => {
        const rank: Record<string, number> = { cosmetic: 0, moderate: 1, serious: 2 };
        // asStage was mapped from findings, so each id is there
        const bySeverity = rank[(findings.find((item) => item.id === b.id) as OwnerFinding).severity]
          - rank[(findings.find((item) => item.id === a.id) as OwnerFinding).severity];
        return bySeverity !== 0 ? bySeverity : a.position - b.position;
      })[0];
    // the early return above leaves at least one pin or finding
    const track = buildTrack(pin ? resting : asStage, hero.id);
    this.preview.setTrack(track);
    this.preview.setMarkers(pin ? [] : asStage);
    this.previewAdvisories = this.data.car.workingOpenAdvisories;
    this.preview.setOpenAdvisories(this.previewAdvisories);
    this.preview.draw({
      state: this.preview.stateFor(0, 'still'),
      mode: 'still',
      listing: this.data.car.listingStatus,
      dim: 1,
    });
  }

  private layout(): void {
    const phone = isPhone();
    this.bar.hidden = !phone;
    this.nav.hidden = phone;
    if (phone) {
      this.nav.replaceChildren();
      if (!find(this.bar, '.bar-status')) {
        const sections = el('button', { type: 'button', class: 'pill pill-solid' }, ['Sections']);
        on(sections, 'click', () => this.openSheet(sections));
        this.bar.replaceChildren(
          el('p', { class: 'bar-status' }, [LISTING_WORD[this.data.car.listingStatus]]),
          sections,
        );
      }
    } else {
      this.sheet?.destroy();
      this.sheet = null;
      if (!this.nav.firstElementChild) this.nav.replaceChildren(this.navList(false));
    }
    this.paint();
  }

  private openSheet(opener: HTMLElement): void {
    this.sheetStatus = statusRegion('Dialog status');
    this.sheetNav.replaceChildren(this.navList(true));
    const close = (): void => this.sheet?.close();
    this.sheet = new Overlay({
      name: 'Car file sections',
      scrimCloses: true,
      sheet: true,
      onClose: () => {
        this.announcer.setHeld(false, this.lines());
        const last = this.sheetStatus.textContent ?? '';
        if (last.length > 0) announce(this.chrome.status, last);
      },
    }, () => [
      el('div', { class: 'overlay-head' }, [
        el('h2', {}, ['Car file sections']),
        (() => {
          const button = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Close']);
          on(button, 'click', close);
          return button;
        })(),
      ]),
      this.sheetNav,
      this.sheetStatus,
    ]);
    this.announcer.setHeld(true, this.lines());
    this.sheet.show(opener);
    this.paint();
  }

  private paintSheetRetry(): void {
    const failed = this.data.alerts.filter((alert) => alert.state === 'failed');
    if (!this.sheet || failed.length === 0) {
      this.sheetRetryHolder.replaceChildren();
      return;
    }
    const newest = failed[0];
    if (find(this.sheetRetryHolder, `[data-alert="${newest.id}"]`)) return;
    const retry = el('button', { type: 'button', class: 'pill pill-solid sheet-retry-button', 'data-alert': newest.id },
      ['Retry']);
    pressable(retry, async () => {
      await announceSteps(this.sheetStatus, ['Sending alert']);
      try {
        await api.post(`/api/owner/alerts/${newest.id}/retry`);
        await this.refresh(['alerts']);
        await announceSteps(this.sheetStatus, ['Alert delivered']);
        const stillFailing = this.data.alerts.filter((alert) => alert.state === 'failed');
        if (stillFailing.length === 0) {
          find<HTMLElement>(this.sheetNav, 'a[href="#alerts"]')?.focus();
        } else {
          this.paintSheetRetry();
          find<HTMLElement>(this.sheetRetryHolder, 'button')?.focus();
        }
      } catch (error) {
        const message = error instanceof Refused
          ? (error.status === 409 ? MESSAGE.alertInProgress : MESSAGE.alertFailed)
          : MESSAGE.alertFailed;
        retry.focus();
        // the control is free again as soon as the step is announced, so the owner can try again
        void this.refresh(['alerts']);
        await announceSteps(this.sheetStatus, [message]);
      }
    });
    this.sheetRetryHolder.replaceChildren(retry);
  }

  // ---------- actions ----------

  private async act<T>(options: {
    pending: string;
    run: () => Promise<T>;
    success?: string | ((value: T) => string);
    region?: HTMLElement;
    onRefused?: (error: Refused) => boolean;
    ownKeys?: string[];
    focusHome?: () => void;
  }): Promise<T | null> {
    const region = options.region ?? this.chrome.status;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await announceSteps(region, [options.pending]);
      try {
        const value = await options.run();
        await this.refresh(options.ownKeys ?? []);
        if (options.success) {
          const text = typeof options.success === 'string' ? options.success : options.success(value);
          await announceSteps(region, [text]);
        }
        options.focusHome?.();
        return value;
      } catch (error) {
        if (error instanceof Refused && error.status === 401 && error.body.error === 'not_signed_in' && attempt === 0) {
          await this.askToSignIn();
          continue;
        }
        if (error instanceof Refused) {
          if (!options.onRefused?.(error)) {
            await announceSteps(region, [error.body.message]);
          }
        } else {
          announce(this.chrome.notice, MESSAGE.sendFailed);
        }
        return null;
      }
    }
    return null;
  }

  /** An action refused for an ended session opens the sign-in dialog over the page. */
  private askToSignIn(): Promise<void> {
    return new Promise((done) => {
      const status = statusRegion('Dialog status');
      const field = el('input', { type: 'password', 'aria-label': 'Passphrase', class: 'field-input' });
      const button = el('button', { type: 'button', class: 'pill pill-solid' }, ['Sign in']);
      const dialog = new Overlay({ name: 'Sign in again', locked: () => true }, () => [
        el('div', { class: 'overlay-head' }, [el('h2', {}, ['Sign in again'])]),
        el('p', {}, [MESSAGE.sessionEnded]),
        el('label', { class: 'field' }, [el('span', {}, ['Passphrase']), field]),
        status,
        el('div', { class: 'overlay-actions' }, [button]),
      ]);
      const submit = async (): Promise<void> => {
        announce(status, 'Checking passphrase');
        try {
          await api.post('/api/owner/session', { passphrase: field.value });
          dialog.destroy();
          done();
        } catch {
          announce(status, MESSAGE.passphraseWrong);
        }
      };
      pressable(button, submit);
      on(field, 'keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault();
          button.click();
        }
      });
      dialog.show(document.activeElement as HTMLElement);
    });
  }
}
