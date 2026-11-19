/** Owner screens: sign-in, garage, car file with its nine sections. */
import { api, announce, dialogFocusTrap, isLostReply, londonStamp, pounds, randomKey, timeLeft, viewportWidth, prefersReducedMotion } from './lib.js';
import { PANELS, PANEL_BY_ID, PANEL_FRAMES, diagramRects, type PanelId } from './panels.js';

interface Car {
  id: string; name: string; registration: string; askingPounds: number; viewingArea: string;
  homeAddress: string; story: string; listingStatus: string; currentVersion: number | null;
  pulledAt: string | null; publishedOpenAdvisories: number; workingOpenAdvisories: number;
  publishBlockers: string[];
  standing: { panelsRead: number; panelsGaugeable: number; findings: number; files: number; activeLinks: number; slotsHeld: number; slots: number; liveOffers: number; failedAlerts: number };
}
interface Panel { id: PanelId; label: string; substrate: string; owner: { microns: number; mils: string; band: string } | null; inspector: { name?: string; microns: number; band: string }[]; inspectorFindings: { name?: string; u: number; v: number; wording: string }[] }
interface Finding { id: string; revision: number; position: number; panelId: PanelId; panelLabel: string; u: number; v: number; title: string; wording: string; severity: string; material: boolean; band: string; photoId: string | null }
interface Advisory { id: string; motTestNumber: string; text: string; stance: string | null; note: string | null; answeredAt: string | null; recurred: boolean }
interface TapeStep { motTestNumber: string; completedDate: string; testResult: string; status: string; odometerValue: string | null; odometerUnit: string | null; normalisedKm: number | null; flag: string | null }
interface LinkRow { id: string; role: string; name: string; status: string; expiresAt: string; secondsRemaining: number; seen: number; total: number; materialUnseen: number; lastSeenAt: string | null; offerStatus: string | null }
interface Slot { id: string; label: string; startsAt: string; durationMinutes: number; held: boolean; holderName: string | null }
interface Offer { id: string; amountPounds: number; status: string; secondsRemaining: number; linkId: string; buyerName: string; seen: number; total: number }
interface Upload { id: string; kind: string; fileName: string; sha256: string; bytes: number; contentType: string; derivativeSha256: string | null; locationRemoved: boolean; label: string | null }
interface AlertRow { id: string; carId: string; kind: string; state: string; attempts: number; createdAt: string; deliveredAt: string | null }

const SECTIONS = [
  { id: 'panels', heading: 'Panels and readings' },
  { id: 'findings', heading: 'Findings' },
  { id: 'evidence', heading: 'Evidence' },
  { id: 'record', heading: 'Test record' },
  { id: 'publish', heading: 'Publish' },
  { id: 'people', heading: 'People' },
  { id: 'viewings', heading: 'Viewings' },
  { id: 'offers', heading: 'Offers' },
  { id: 'alerts', heading: 'Alerts' },
] as const;

const LISTING_WORD: Record<string, string> = {
  draft: 'Draft', rendering: 'Rendering', live: 'Live', under_offer: 'Under offer', sold: 'Sold', withdrawn: 'Withdrawn',
};
const OFFER_WORD: Record<string, string> = {
  open: 'Open', needs_reread: 'Needs re-read', accepted: 'Accepted', declined: 'Declined',
  lapsed: 'Lapsed', closed_by_acceptance: 'Closed by another acceptance',
};
const BLOCKER_COPY: Record<string, string> = {
  no_findings: 'Add at least one finding',
  no_record_pull: 'Pull the test record',
  record_stale: 'The test record is too old. Pull it again.',
  advisories_unanswered: 'Answer every advisory from the latest pull',
  advisory_recurred: 'Change the stance on each advisory seen again at a later test',
};
const SEVERITY_WORD: Record<string, string> = { cosmetic: 'Cosmetic', moderate: 'Moderate', serious: 'Serious' };

export function mountOwner(root: HTMLElement): void {
  root.innerHTML = `
    <div class="units-bar"><span class="units-label">Units</span><button data-units></button></div>
    <main id="owner-main"></main>
  `;
  const main = root.querySelector('#owner-main') as HTMLElement;

  const state = {
    car: null as Car | null,
    panels: [] as Panel[],
    medians: { steel: null as number | null, aluminium: null as number | null },
    findings: [] as Finding[],
    uploads: [] as Upload[],
    record: null as { pulledAt: string; firstUsedDate: string; tape: TapeStep[]; advisories: Advisory[]; openAdvisories: number } | null,
    links: [] as LinkRow[],
    newLink: null as { address: string } | null,
    slots: [] as Slot[],
    offers: [] as Offer[],
    alerts: [] as AlertRow[],
    units: (localStorage.getItem('ob-units') === 'mils' ? 'mils' : 'microns') as 'microns' | 'mils',
    pollTimer: 0,
    overlayOpen: false,
    pendingRetry: null as string | null,
    baseline: null as Record<string, string> | null,
  };

  const statusEl = (): HTMLElement | null => main.querySelector('[data-role="owner-status"]');
  const dialogStatus = (dialog: HTMLDialogElement): HTMLElement | null => dialog.querySelector('[data-role="dialog-status"]');

  function route(): string {
    return window.location.pathname;
  }

  async function boot(): Promise<void> {
    if (route() === '/owner') {
      renderSignIn();
      return;
    }
    const signedIn = await api<{ signedIn?: boolean } | null>('/api/owner/session-check').catch(() => null);
    void signedIn;
    if (route() === '/owner/cars') { await renderGarage(); return; }
    const match = /^\/owner\/cars\/([^/]+)$/.exec(route());
    if (match) { await renderCarFile(match[1]); return; }
    window.location.replace('/owner/cars');
  }

  function guard401(err: unknown): boolean {
    if ((err as { status?: number }).status !== 401) return false;
    openSignInAgain();
    return true;
  }

  function renderSignIn(): void {
    main.innerHTML = `
      <div style="min-height:60vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,var(--surface),var(--ground) 40%);padding:24px">
        <form class="notice-panel" style="width:min(440px,100%);padding:34px" data-role="sign-in">
          <h1 style="margin:0 0 8px">Ostler Lane Open Bonnet</h1>
          <p style="margin:0 0 22px;color:#4a4370">Sign in to build your car file.</p>
          <div class="field">
            <label for="passphrase">Passphrase</label>
            <input id="passphrase" type="password" autocomplete="current-password" />
            <span class="field-error" data-role="field-error"></span>
          </div>
          <button class="pill pill-solid" type="submit" data-role="sign-in-button">Sign in</button>
          <p class="status-line" style="margin-top:14px" role="status" aria-label="Owner status" data-role="owner-status"></p>
        </form>
      </div>`;
    const form = main.querySelector('[data-role="sign-in"]') as HTMLFormElement;
    const input = main.querySelector('#passphrase') as HTMLInputElement;
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('[data-role="sign-in-button"]') as HTMLButtonElement;
      button.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Checking passphrase');
      try {
        await api('/api/owner/session', { method: 'POST', body: JSON.stringify({ passphrase: input.value }) });
        const params = new URLSearchParams(window.location.search);
        const target = params.get('return');
        const safe = target && target.startsWith('/owner/') && !target.startsWith('//') ? target : '/owner/cars';
        window.location.replace(safe);
      } catch (err) {
        button.removeAttribute('aria-disabled');
        const fieldError = form.querySelector('[data-role="field-error"]') as HTMLElement;
        fieldError.textContent = 'That passphrase is not right';
        announce(statusEl(), 'That passphrase is not right');
        void button.focus();
      }
    });
  }

  async function renderGarage(): Promise<void> {
    const cars = await api<{ cars: Car[] }>('/api/owner/cars');
    main.innerHTML = `
      <div class="content-column" style="padding-top:40px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <h1 tabindex="-1">Your garage</h1>
          <button class="pill pill-light" data-role="sign-out">Sign out</button>
        </div>
        <list aria-label="Garage" data-role="garage" style="list-style:none;padding:0;display:grid;gap:18px;margin-top:26px"></list>
        <section class="notice-panel" style="margin-top:50px" aria-labelledby="new-car-heading">
          <h2 id="new-car-heading" style="margin-top:0">New car file</h2>
          <form data-role="new-car" style="display:grid;gap:12px;max-width:560px">
            <div class="field"><label for="car-name">Car name</label><input id="car-name" data-field="name" /><span class="field-error" data-error="name"></span></div>
            <div class="field"><label for="car-reg">Registration</label><input id="car-reg" data-field="registration" /><span class="field-error" data-error="registration"></span></div>
            <div class="field"><label for="car-asking">Asking price in pounds</label><input id="car-asking" data-field="askingPounds" type="number" min="1" step="1" role="spinbutton" /><span class="field-error" data-error="askingPounds"></span></div>
            <div class="field"><label for="car-area">Viewing area</label><input id="car-area" data-field="viewingArea" /><span class="field-error" data-error="viewingArea"></span></div>
            <div class="field"><label for="car-address">Home address</label><input id="car-address" data-field="homeAddress" /><span class="field-error" data-error="homeAddress"></span></div>
            <div class="field"><label for="car-story">Owner story</label><textarea id="car-story" data-field="story" rows="3"></textarea><span class="field-error" data-error="story"></span></div>
            <button class="pill pill-solid" type="submit">Create car file</button>
            <p class="status-line" role="status" aria-label="Owner status" data-role="owner-status"></p>
          </form>
        </section>
      </div>`;
    const list = main.querySelector('[data-role="garage"]') as HTMLElement;
    list.replaceChildren(...cars.cars.map(car => {
      const li = document.createElement('li');
      li.innerHTML = `<article class="card" style="padding:22px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center">
        <div><strong style="font-size:1.15rem"></strong>
          <div style="font-size:.85rem;color:#4a4370"></div></div>
        <span></span></article>`;
      const nameLink = document.createElement('a');
      nameLink.href = `/owner/cars/${car.id}`;
      nameLink.textContent = car.name;
      li.querySelector('strong')!.replaceWith(nameLink);
      li.querySelector('div > div')!.textContent = `${LISTING_WORD[car.listingStatus]} · version ${car.currentVersion ?? 0} · open advisories ${car.workingOpenAdvisories}`;
      li.querySelector('span')!.textContent = pounds(car.askingPounds);
      return li;
    }));
    main.querySelector('[data-role="sign-out"]')?.addEventListener('click', async () => {
      await api('/api/owner/session', { method: 'DELETE' });
      window.location.replace('/owner');
    });
    const form = main.querySelector('[data-role="new-car"]') as HTMLFormElement;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      announce(statusEl(), 'Creating car file');
      const fields: Record<string, string> = {};
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach(el => { fields[el.dataset.field!] = el.value; });
      try {
        const created = await api<Car>('/api/owner/cars', { method: 'POST', body: JSON.stringify({
          name: fields.name, registration: fields.registration, askingPounds: Number(fields.askingPounds),
          viewingArea: fields.viewingArea, homeAddress: fields.homeAddress, story: fields.story,
        }) });
        window.location.replace(`/owner/cars/${created.id}#panels`);
      } catch (err) {
        if (guard401(err)) return;
        const errors = (err as { body?: { errors?: Record<string, string> } }).body?.errors ?? {};
        form.querySelectorAll('[data-error]').forEach(span => { span.textContent = errors[span.dataset.error!] ?? ''; });
        announce(statusEl(), Object.values(errors)[0] ?? (err as Error).message);
      }
    });
  }

  async function renderCarFile(carId: string): Promise<void> {
    try {
      state.car = await api<Car>(`/api/owner/cars/${carId}`);
    } catch (err) {
      main.innerHTML = `<div class="notice-panel" style="margin:60px auto;max-width:520px"><h1>We could not find that car file</h1></div>`;
      return;
    }
    main.innerHTML = `
      <div class="content-column" style="padding-top:30px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
          <h1 tabindex="-1"></h1>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span data-role="listing-word" style="font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.8rem"></span>
            <button class="pill pill-light" data-role="sign-out">Sign out</button>
          </div>
        </div>
        <navigation aria-label="Car file sections" data-role="section-nav" style="display:flex;flex-wrap:wrap;gap:8px 26px;margin:26px 0"></navigation>
        <p class="status-line" role="status" aria-label="Owner status" data-role="owner-status"></p>
        <div data-role="service-notice" role="alert" aria-label="Service notice"></div>

        <section id="panels" aria-labelledby="panels-heading" style="margin-top:36px">
          <h2 id="panels-heading" tabindex="-1">Panels and readings</h2>
          <div style="display:grid;gap:22px;grid-template-columns:1fr" data-role="panels-layout">
            <div class="card" style="padding:20px" data-role="panel-list"></div>
            <div class="card" style="padding:20px" data-role="panel-diagram"></div>
          </div>
        </section>

        <section id="findings" aria-labelledby="findings-heading" style="margin-top:60px">
          <h2 id="findings-heading" tabindex="-1">Findings</h2>
          <div class="card" data-role="stage-preview-holder" style="padding:10px;min-height:240px">
            <region aria-label="Stage preview" data-role="stage-preview" style="position:relative;height:260px;background:var(--deep);border-radius:16px;overflow:hidden"></region>
          </div>
          <form class="notice-panel" data-role="finding-form" style="margin-top:26px;display:grid;gap:12px;max-width:720px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="field"><label for="finding-panel">Panels</label><select id="finding-panel" data-role="panel-select"></select></div>
              <div class="field"><label for="finding-severity">Severity</label><select id="finding-severity" data-role="severity">
                <option value="cosmetic">Cosmetic</option><option value="moderate">Moderate</option><option value="serious">Serious</option></select></div>
            </div>
            <div data-role="finding-diagram"></div>
            <div class="field"><label for="finding-title">Finding title</label><input id="finding-title" /><span class="field-error" data-error="title"></span></div>
            <div class="field"><label for="finding-wording">Finding wording</label><textarea id="finding-wording" rows="3"></textarea><span class="field-error" data-error="wording"></span></div>
            <div class="field"><label for="finding-photo">Finding photo</label><select id="finding-photo" data-role="photo-select"><option value="">None</option></select></div>
            <button class="pill pill-solid" type="submit" data-role="save-finding">Save finding</button>
          </form>
          <list aria-label="Findings" data-role="finding-list" style="list-style:none;padding:0;display:grid;gap:14px;margin-top:26px"></list>
        </section>

        <section id="evidence" aria-labelledby="evidence-heading" style="margin-top:60px">
          <h2 id="evidence-heading" tabindex="-1">Evidence</h2>
          <div class="notice-panel" style="display:grid;gap:16px;margin-top:20px">
            <div style="display:grid;gap:12px;max-width:640px">
              <div class="card" style="padding:16px;display:grid;gap:10px">
                <strong>Photos</strong>
                <button class="pill pill-light" data-role="add-photo">Add photo</button>
                <input type="file" accept="image/jpeg,image/png" hidden data-role="photo-file" />
                <img data-role="photo-preview" alt="Photo preview" style="max-width:100%;max-height:280px;border-radius:12px;display:none" />
                <group data-role="plate-mask" aria-label="Plate mask" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
                  <div class="field"><label for="mask-left">Mask left</label><input id="mask-left" data-role="mask-x" type="number" step="0.1" min="0" max="100" role="spinbutton" /></div>
                  <div class="field"><label for="mask-top">Mask top</label><input id="mask-top" data-role="mask-y" type="number" step="0.1" min="0" max="100" role="spinbutton" /></div>
                  <div class="field"><label for="mask-width">Mask width</label><input id="mask-width" data-role="mask-w" type="number" step="0.1" min="0" max="100" role="spinbutton" /></div>
                  <div class="field"><label for="mask-height">Mask height</label><input id="mask-height" data-role="mask-h" type="number" step="0.1" min="0" max="100" role="spinbutton" /></div>
                  <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" data-role="no-plate" role="checkbox" /> No plate in this photo</label>
                </group>
                <button class="pill pill-light" data-role="store-photo">Store photo</button>
              </div>
              <div class="card" style="padding:16px;display:grid;gap:10px">
                <strong>Invoices</strong>
                <div class="field"><label for="invoice-label">Invoice label</label><input id="invoice-label" data-role="invoice-label" /></div>
                <button class="pill pill-light" data-role="add-invoice">Add invoice</button>
                <input type="file" accept="image/jpeg,image/png,application/pdf" hidden data-role="invoice-file" />
              </div>
            </div>
            <list aria-label="Evidence" data-role="evidence-list" style="list-style:none;padding:0;display:grid;gap:8px"></list>
          </div>
        </section>

        <section id="record" aria-labelledby="record-heading" style="margin-top:60px">
          <h2 id="record-heading" tabindex="-1">Test record</h2>
          <button class="pill pill-light" data-role="pull-record">Pull test record</button>
          <div data-role="tape-region" style="margin-top:22px"></div>
          <div data-role="advisories-region"></div>
        </section>

        <section id="publish" aria-labelledby="publish-heading" style="margin-top:60px">
          <h2 id="publish-heading" tabindex="-1">Publish</h2>
          <list aria-label="Publish blockers" data-role="blockers" style="list-style:none;padding:0"></list>
          <p data-role="blockers-line"></p>
          <button class="pill pill-solid" data-role="publish">Publish</button>
          <button class="pill pill-light" data-role="withdraw">Withdraw listing</button>
          <p data-role="version-line"></p>
          <button class="pill pill-light" data-role="complete" hidden>Complete sale</button>
          <a data-role="handover-link" hidden>Download handover record</a>
          <a data-role="report-link" hidden>Download condition report</a>
        </section>

        <section id="people" aria-labelledby="people-heading" style="margin-top:60px">
          <h2 id="people-heading" tabindex="-1">People</h2>
          <form class="notice-panel" style="display:grid;gap:12px;max-width:560px;margin-top:18px" data-role="link-form">
            <div class="field"><label for="person-name">Person's name</label><input id="person-name" data-role="person-name" /></div>
            <radiogroup aria-label="Link type" data-role="link-type" style="display:flex;gap:18px">
              <label style="display:flex;gap:6px;font-weight:400"><input type="radio" name="link-type" value="buyer" checked role="radio" /> Buyer</label>
              <label style="display:flex;gap:6px;font-weight:400"><input type="radio" name="link-type" value="inspector" role="radio" /> Inspector</label>
            </radiogroup>
            <button class="pill pill-solid" type="submit">Create link</button>
          </form>
          <region aria-label="New link" data-role="new-link" class="notice-panel" style="margin-top:18px;display:none;word-break:break-all"></region>
          <div style="overflow-x:auto"><table aria-label="People" data-role="people-table"></table></div>
        </section>

        <section id="viewings" aria-labelledby="viewings-heading" style="margin-top:60px">
          <h2 id="viewings-heading" tabindex="-1">Viewings</h2>
          <form class="notice-panel" style="display:grid;gap:12px;max-width:560px;margin-top:18px" data-role="slot-form">
            <div class="field"><label for="slot-start">Viewing date and time</label><input id="slot-start" data-role="slot-start" placeholder="YYYY-MM-DDTHH:mm" /><span class="field-error" data-error="localStart"></span></div>
            <div class="field"><label for="slot-length">Viewing length in minutes</label><input id="slot-length" data-role="slot-length" type="number" min="15" max="240" role="spinbutton" /><span class="field-error" data-error="durationMinutes"></span></div>
            <button class="pill pill-solid" type="submit">Add viewing slot</button>
          </form>
          <ul data-role="slot-list" style="list-style:none;padding:0"></ul>
        </section>

        <section id="offers" aria-labelledby="offers-heading" style="margin-top:60px">
          <h2 id="offers-heading" tabindex="-1">Offers</h2>
          <div style="overflow-x:auto"><table aria-label="Offers" data-role="offers-table"></table></div>
        </section>

        <section id="alerts" aria-labelledby="alerts-heading" style="margin-top:60px">
          <h2 id="alerts-heading" tabindex="-1">Alerts</h2>
          <list aria-label="Alerts" data-role="alerts-list" style="list-style:none;padding:0"></list>
        </section>
      </div>

      <dialog aria-label="Accept offer" data-role="accept-dialog">
        <div class="dialog-inner">
          <h2>Accept an offer</h2>
          <p data-role="accept-line-1"></p>
          <p data-role="accept-line-2"></p>
          <div class="dialog-row">
            <button class="pill pill-light" data-close data-cancel>Cancel</button>
            <button class="pill pill-solid" data-role="confirm-accept">Confirm acceptance</button>
          </div>
          <p class="status-line" role="status" aria-label="Dialog status" data-role="dialog-status"></p>
        </div>
      </dialog>

      <dialog aria-label="Sign in again" data-role="signin-dialog">
        <div class="dialog-inner">
          <h2>Sign in again</h2>
          <p>Your session has ended. Sign in to carry on.</p>
          <div class="field">
            <label for="signin-pass">Passphrase</label>
            <input id="signin-pass" type="password" data-role="signin-pass" />
          </div>
          <div class="dialog-row"><button class="pill pill-solid" data-role="signin-submit">Sign in</button></div>
          <p class="status-line" role="status" aria-label="Dialog status" data-role="dialog-status"></p>
        </div>
      </dialog>

      <dialog aria-label="Car file sections" data-role="sections-dialog">
        <div class="dialog-inner">
          <h2>Car file sections</h2>
          <div class="units-inline"><span>Units</span><button data-units></button></div>
          <nav data-role="sheet-nav" style="display:flex;flex-direction:column;gap:10px"></nav>
          <div class="dialog-row"><button class="pill pill-light" data-close>Close</button></div>
          <p class="status-line" role="status" aria-label="Dialog status" data-role="dialog-status"></p>
        </div>
      </dialog>

      <div class="carfile-bar" data-role="carfile-bar" aria-label="Car file bar">
        <span class="listing-word" data-role="bar-word"></span>
        <button data-role="open-sections">Sections</button>
      </div>`;

    main.querySelector('h1')!.textContent = state.car.name;
    main.querySelector('[data-role="sign-out"]')?.addEventListener('click', async () => {
      await api('/api/owner/session', { method: 'DELETE' });
      window.location.replace('/owner');
    });
    await Promise.all([refreshPanels(), refreshFindings(), refreshUploads(), refreshRecord(), refreshLinks(), refreshSlots(), refreshOffers(), refreshAlerts()]);
    renderSectionNav();
    renderBar();
    bindCarEvents(carId);
    applyFragment();
    state.pollTimer = window.setInterval(() => void pollCar(carId), 15_000);
  }

  function standingLine(car: Car, section: string): string {
    const s = car.standing;
    switch (section) {
      case 'panels': return `Read: ${s.panelsRead} of ${s.panelsGaugeable}`;
      case 'findings': return `Findings: ${s.findings}`;
      case 'evidence': return `Files: ${s.files}`;
      case 'record': return `Open advisories: ${car.workingOpenAdvisories}`;
      case 'publish': return `Blockers: ${car.publishBlockers.length}`;
      case 'people': return `Active links: ${s.activeLinks}`;
      case 'viewings': return `Slots held: ${s.slotsHeld} of ${s.slots}`;
      case 'offers': return `Live offers: ${s.liveOffers}`;
      case 'alerts': return `Failed alerts: ${s.failedAlerts}`;
      default: return '';
    }
  }

  function renderSectionNav(): void {
    const nav = main.querySelector('[data-role="section-nav"]') as HTMLElement;
    const sheetNav = main.querySelector('[data-role="sheet-nav"]') as HTMLElement;
    const build = (host: HTMLElement, withRetry: boolean): void => {
      host.replaceChildren(...SECTIONS.map(section => {
        const li = document.createElement('li');
        li.style.cssText = 'list-style:none;padding:4px 0';
        const link = document.createElement('a');
        link.href = `/owner/cars/${state.car!.id}#${section.id}`;
        link.textContent = section.heading;
        const line = document.createElement('div');
        line.style.cssText = 'font-size:.78rem;color:#4a4370';
        line.textContent = standingLine(state.car!, section.id);
        li.append(link, line);
        if (withRetry && section.id === 'alerts') {
          const failed = state.alerts.filter(a => a.state === 'failed');
          if (failed.length > 0) {
            const retry = document.createElement('button');
            retry.className = 'pill pill-light';
            retry.style.minHeight = '44px';
            retry.textContent = 'Retry';
            retry.addEventListener('click', () => void retryAlert(failed[0].id, retry, true));
            li.appendChild(retry);
          }
        }
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const target = main.querySelector(`#${section.id} h2`) as HTMLElement;
          target.scrollIntoView();
          target.focus();
          history.replaceState(null, '', `#${section.id}`);
          const dialog = main.querySelector('[data-role="sections-dialog"]') as HTMLDialogElement;
          if (dialog.open) dialog.close();
        });
        return li;
      }));
    };
    build(nav, false);
    build(sheetNav, true);
  }

  function renderBar(): void {
    const bar = main.querySelector('[data-role="carfile-bar"]') as HTMLElement;
    const word = main.querySelector('[data-role="bar-word"]') as HTMLElement;
    const listingWord = main.querySelector('[data-role="listing-word"]') as HTMLElement;
    const word2 = LISTING_WORD[state.car?.listingStatus ?? 'draft'];
    word.textContent = word2;
    listingWord.textContent = word2;
    if (viewportWidth() <= 767) { bar.style.display = 'flex'; document.body.classList.add('has-carfile-bar'); }
    else { bar.style.display = 'none'; document.body.classList.remove('has-carfile-bar'); }
  }

  function applyFragment(): void {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const heading = main.querySelector(`#${hash} h2`) as HTMLElement | null;
    if (heading) { heading.scrollIntoView(); heading.focus(); }
  }

  async function refreshPanels(): Promise<void> {
    const reply = await api<{ panels: Panel[]; medians: { steel: number | null; aluminium: number | null } }>(`/api/owner/cars/${state.car!.id}/panels`);
    state.panels = reply.panels;
    state.medians = reply.medians;
    renderPanelList();
    renderPanelDiagram();
  }

  function renderPanelList(): void {
    const host = main.querySelector('[data-role="panel-list"]') as HTMLElement;
    const form = document.createElement('form');
    form.dataset.role = 'readings-form';
    const rows = state.panels.map(panel => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 110px 100px;gap:8px;align-items:center;padding:6px 0';
      const label = document.createElement('span');
      label.textContent = panel.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '2000';
      input.step = '1';
      input.setAttribute('role', 'spinbutton');
      input.setAttribute('aria-label', `Microns for ${panel.label}`);
      input.dataset.panelId = panel.id;
      input.value = panel.owner ? String(panel.owner.microns) : '';
      const band = document.createElement('span');
      band.textContent = panel.substrate === 'plastic' ? 'Not gauged' : panel.owner ? panel.owner.band : 'No reading';
      if (panel.substrate === 'plastic') {
        row.append(label, Object.assign(document.createElement('span'), { textContent: 'Not gauged' }), band);
        row.querySelectorAll('span')[1].textContent = 'Not gauged';
      } else {
        row.append(label, input, band);
      }
      return row;
    });
    const save = document.createElement('button');
    save.className = 'pill pill-solid';
    save.type = 'submit';
    save.textContent = 'Save readings';
    form.replaceChildren(...rows, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      announce(statusEl(), 'Saving readings');
      const readings: { panelId: string; microns: number }[] = [];
      form.querySelectorAll<HTMLInputElement>('input[data-panel-id]').forEach(input => {
        if (input.value.trim() !== '') readings.push({ panelId: input.dataset.panelId!, microns: Number(input.value) });
      });
      try {
        const reply = await api(`/api/owner/cars/${state.car!.id}/readings`, { method: 'PUT', body: JSON.stringify({ readings }) });
        state.panels = (reply as { panels: Panel[] }).panels;
        state.medians = (reply as { medians: typeof state.medians }).medians;
        renderPanelList();
        await refreshCar();
        announce(statusEl(), 'Readings saved');
      } catch (err) {
        if (guard401(err)) return;
        announce(statusEl(), (err as Error).message);
      }
    });
    host.replaceChildren(form);
  }

  function renderPanelDiagram(): void {
    const host = main.querySelector('[data-role="panel-diagram"]') as HTMLElement;
    host.innerHTML = '<h3 style="margin-top:0">Panel diagram</h3>';
    const svgHost = document.createElement('div');
    host.appendChild(svgHost);
    drawDiagram(svgHost, [], null);
  }

  function drawDiagram(host: HTMLElement, pins: { panelId: PanelId; u: number; v: number }[], activePanel: PanelId | null): void {
    const size = 380;
    const rects = diagramRects(size);
    const height = size * 0.92;
    host.innerHTML = `
      <svg viewBox="0 0 ${size} ${height}" width="100%" style="max-width:${size}px" role="img" aria-label="Panel diagram">
        ${rects.map(r => `<rect data-panel-id="${r.id}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.id === activePanel ? '#cfd8ff' : '#e8e3f7'}" stroke="#7a74a8" stroke-width="1.5" style="cursor:pointer" />`).join('')}
        ${pins.filter(p => p.panelId === activePanel).map(p => {
          const rect = rects.find(r => r.id === p.panelId)!;
          return `<circle cx="${rect.x + p.u * rect.w}" cy="${rect.y + p.v * rect.h}" r="6" fill="#c04a4a" />`;
        }).join('')}
      </svg>`;
    host.querySelectorAll<SVGRectElement>('rect[data-panel-id]').forEach(rect => {
      rect.addEventListener('click', () => {
        const panelId = rect.getAttribute('data-panel-id') as PanelId;
        onPanelPick(panelId, 0.5, 0.5);
      });
    });
  }

  function onPanelPick(panelId: PanelId, u: number, v: number): void {
    const select = main.querySelector('[data-role="panel-select"]') as HTMLSelectElement;
    select.value = panelId;
    findingPin.u = u;
    findingPin.v = v;
    findingPin.panelId = panelId;
    renderFindingDiagram();
  }

  const findingPin = { panelId: null as PanelId | null, u: 0.5, v: 0.5 };

  function renderFindingDiagram(): void {
    const host = main.querySelector('[data-role="finding-diagram"]') as HTMLElement;
    host.innerHTML = '';
    const svgHost = document.createElement('div');
    host.appendChild(svgHost);
    drawDiagram(svgHost, findingPin.panelId ? [{ panelId: findingPin.panelId, u: findingPin.u, v: findingPin.v }] : [], findingPin.panelId);
    const pinButton = document.createElement('button');
    pinButton.className = 'pill pill-light';
    pinButton.textContent = 'Finding pin';
    pinButton.setAttribute('aria-label', 'Finding pin');
    pinButton.dataset.role = 'finding-pin';
    pinButton.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      if (!findingPin.panelId) return;
      if (e.key === 'ArrowLeft') { findingPin.u = clamp01(findingPin.u - step); e.preventDefault(); announceMove(); }
      else if (e.key === 'ArrowRight') { findingPin.u = clamp01(findingPin.u + step); e.preventDefault(); announceMove(); }
      else if (e.key === 'ArrowUp') { findingPin.v = clamp01(findingPin.v - step); e.preventDefault(); announceMove(); }
      else if (e.key === 'ArrowDown') { findingPin.v = clamp01(findingPin.v + step); e.preventDefault(); announceMove(); }
    });
    host.appendChild(pinButton);
  }

  function announceMove(): void {
    announce(statusEl(), `Pin at ${(findingPin.u * 100).toFixed(0)}, ${(findingPin.v * 100).toFixed(0)} percent of the panel`);
    renderFindingDiagram();
    renderStagePreview();
  }

  function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function renderStagePreview(): void {
    void import('./preview.js').then(({ mountPreview }) => {
      mountPreview(main.querySelector('[data-role="stage-preview"]') as HTMLElement, {
        findings: () => state.findings.map(f => ({ id: f.id, panelId: f.panelId, u: f.u, v: f.v, position: f.position, severity: f.severity, seen: true })),
        heroId: () => workingHeroId(),
        unsavedPin: () => findingPin.panelId ? { panelId: findingPin.panelId, u: findingPin.u, v: findingPin.v } : null,
        openAdvisories: () => state.car?.workingOpenAdvisories ?? 0,
      });
    });
  }

  function workingHeroId(): string | null {
    const order = (s: string) => (s === 'serious' ? 2 : s === 'moderate' ? 1 : 0);
    let best: Finding | null = null;
    for (const f of state.findings) {
      if (!best || order(f.severity) > order(best.severity) || (order(f.severity) === order(best.severity) && f.position < best.position)) best = f;
    }
    return best?.id ?? null;
  }

  async function refreshFindings(): Promise<void> {
    const reply = await api<{ findings: Finding[] }>(`/api/owner/cars/${state.car!.id}/findings`);
    state.findings = reply.findings;
    renderFindingList();
    renderFindingDiagram();
    renderStagePreview();
    const photoSelect = main.querySelector('[data-role="photo-select"]') as HTMLSelectElement;
    const stored = state.uploads.filter(u => u.kind === 'photo');
    photoSelect.replaceChildren(new Option('None', ''), ...stored.map(u => new Option(u.fileName, u.id)));
    photoSelect.value = selectedPhotoId ?? '';
  }

  let selectedPhotoId: string | null = null;

  function renderFindingList(): void {
    const list = main.querySelector('[data-role="finding-list"]') as HTMLElement;
    if (state.findings.length === 0) {
      list.innerHTML = '<li class="notice-panel">No findings yet</li>';
      return;
    }
    list.replaceChildren(...state.findings.map(f => {
      const li = document.createElement('li');
      li.innerHTML = `<article class="card" style="padding:16px;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center">
        <div><strong></strong><div style="font-size:.85rem;color:#4a4370"></div></div>
        <div style="display:flex;gap:8px"><button class="pill pill-light" data-role="edit">Edit</button><button class="pill pill-light" data-role="remove">Remove</button></div>
      </article>`;
      li.querySelector('strong')!.textContent = `${f.position}. ${f.title}`;
      li.querySelector('div div')!.textContent = `${f.panelLabel} · ${SEVERITY_WORD[f.severity]} · ${f.band}`;
      const [edit, remove] = li.querySelectorAll('button');
      edit.setAttribute('aria-label', `Edit ${f.title}`);
      remove.setAttribute('aria-label', `Remove ${f.title}`);
      edit.addEventListener('click', () => {
        const form = main.querySelector('[data-role="finding-form"]') as HTMLFormElement;
        (form.querySelector('[data-role="panel-select"]') as HTMLSelectElement).value = f.panelId;
        (form.querySelector('#finding-title') as HTMLInputElement).value = f.title;
        (form.querySelector('#finding-wording') as HTMLTextAreaElement).value = f.wording;
        (form.querySelector('[data-role="severity"]') as HTMLSelectElement).value = f.severity;
        selectedPhotoId = f.photoId;
        (main.querySelector('[data-role="photo-select"]') as HTMLSelectElement).value = f.photoId ?? '';
        findingPin.panelId = f.panelId;
        findingPin.u = f.u;
        findingPin.v = f.v;
        editingFindingId = f.id;
        editingRevision = f.revision;
        renderFindingDiagram();
      });
      remove.addEventListener('click', () => void removeFinding(f));
      return li;
    }));
  }

  let editingFindingId: string | null = null;
  let editingRevision = 0;

  async function removeFinding(f: Finding): Promise<void> {
    announce(statusEl(), 'Removing finding');
    try {
      await api(`/api/owner/cars/${state.car!.id}/findings/${f.id}`, { method: 'DELETE', headers: { 'If-Match': String(f.revision) } });
      await refreshCar();
      await refreshFindings();
      announce(statusEl(), 'Finding removed');
    } catch (err) {
      if (guard401(err)) return;
      announce(statusEl(), 'This finding has changed. Reload it before saving.');
    }
  }

  async function refreshUploads(): Promise<void> {
    const reply = await api<{ uploads: Upload[] }>(`/api/owner/cars/${state.car!.id}/uploads`);
    state.uploads = reply.uploads;
    renderEvidence();
    const photoSelect = main.querySelector('[data-role="photo-select"]') as HTMLSelectElement;
    const stored = state.uploads.filter(u => u.kind === 'photo');
    photoSelect.replaceChildren(new Option('None', ''), ...stored.map(u => new Option(u.fileName, u.id)));
  }

  function renderEvidence(): void {
    const list = main.querySelector('[data-role="evidence-list"]') as HTMLElement;
    list.replaceChildren(...state.uploads.map(u => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap';
      const name = document.createElement('span');
      name.textContent = u.label ?? u.fileName;
      const link = document.createElement('a');
      link.href = `/api/owner/uploads/${u.id}/original`;
      link.textContent = 'Download original';
      li.append(name, link);
      return li;
    }));
  }

  async function refreshRecord(): Promise<void> {
    const record = await api<typeof state.record>(`/api/owner/cars/${state.car!.id}/record`).catch(() => null);
    state.record = record;
    renderTape();
    renderAdvisories();
  }

  function renderTape(): void {
    const region = main.querySelector('[data-role="tape-region"]') as HTMLElement;
    if (!state.record) { region.innerHTML = ''; return; }
    const tape = state.record.tape;
    const flags: Record<string, string> = { unit_change: 'Unit changed, not a drop', drop: 'Mileage drop', no_odometer: 'No odometer reading', unreadable: 'Odometer unreadable' };
    region.innerHTML = `
      <region aria-label="Odometer tape">
        <h3 style="margin:0 0 10px">Odometer tape</h3>
        <table aria-label="Odometer tape"><thead><tr><th>Date</th><th>Result</th><th>Odometer</th><th>Unit</th><th>Flag</th></tr></thead>
        <tbody>${tape.map(t => `<tr><td class="tabular">${t.completedDate.slice(0, 10)}</td><td>${t.testResult}</td><td class="tabular">${t.odometerValue ?? '—'}</td><td>${t.odometerUnit ?? '—'}</td><td>${t.flag ? flags[t.flag] : ''}</td></tr>`).join('')}</tbody></table>
      </region>`;
  }

  function renderAdvisories(): void {
    const region = main.querySelector('[data-role="advisories-region"]') as HTMLElement;
    if (!state.record) { region.innerHTML = ''; return; }
    region.innerHTML = `
      <region aria-label="Advisories" style="margin-top:26px">
        <p>Open advisories: ${state.car!.workingOpenAdvisories}</p>
        <div data-role="advisory-rows" style="display:grid;gap:16px"></div>
      </region>`;
    const rows = region.querySelector('[data-role="advisory-rows"]') as HTMLElement;
    rows.replaceChildren(...state.record.advisories.map(a => {
      const row = document.createElement('div');
      row.className = 'notice-panel';
      row.innerHTML = `
        <strong></strong> ${a.recurred ? '<em>Seen again at a later test</em>' : ''}
        <form style="display:grid;gap:8px;margin-top:8px;max-width:560px">
          <div class="field"><label>Response to ${a.text}</label><select data-role="stance">
            <option value="">Choose a stance</option>
            <option value="repaired">Repaired</option>
            <option value="monitoring">Monitoring</option>
            <option value="not_repaired">Not repaired</option>
          </select><span class="field-error" data-error="stance"></span></div>
          <div class="field"><label>Note on ${a.text}</label><textarea rows="2" data-role="note"></textarea><span class="field-error" data-error="note"></span></div>
          <button class="pill pill-light" type="submit">Save response</button>
        </form>`;
      row.querySelector('strong')!.textContent = a.text;
      const stance = row.querySelector('[data-role="stance"]') as HTMLSelectElement;
      const note = row.querySelector('[data-role="note"]') as HTMLTextAreaElement;
      stance.value = a.stance ?? '';
      note.value = a.note ?? '';
      if (a.recurred) stance.dataset.recurred = 'true';
      stance.addEventListener('change', () => { void unsavedResponse(a.id, stance.value, note.value); });
      note.addEventListener('input', () => { void unsavedResponse(a.id, stance.value, note.value); });
      const form = row.querySelector('form') as HTMLFormElement;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        announce(statusEl(), 'Saving response');
        try {
          await api(`/api/owner/cars/${state.car!.id}/advisories/${encodeURIComponent(a.id)}`, { method: 'PUT', body: JSON.stringify({ stance: stance.value, note: note.value }) });
          await refreshCar();
          await refreshRecord();
          announce(statusEl(), 'Response saved');
        } catch (err) {
          if (guard401(err)) return;
          const errors = (err as { body?: { errors?: Record<string, string> } }).body?.errors ?? {};
          row.querySelector('[data-error="stance"]')!.textContent = errors.stance ?? '';
          row.querySelector('[data-error="note"]')!.textContent = errors.note ?? '';
          announce(statusEl(), Object.values(errors)[0] ?? (err as Error).message);
        }
      });
      return row;
    }));
  }

  const unsavedResponses = new Map<string, { stance: string; note: string }>();

  function unsavedResponse(id: string, stance: string, note: string): void {
    unsavedResponses.set(id, { stance, note });
  }

  async function refreshCar(): Promise<void> {
    state.car = await api<Car>(`/api/owner/cars/${state.car!.id}`);
    renderPublish();
    renderSectionNav();
    renderBar();
  }

  function renderPublish(): void {
    const list = main.querySelector('[data-role="blockers"]') as HTMLElement;
    const car = state.car!;
    list.replaceChildren(...car.publishBlockers.map(code => {
      const li = document.createElement('li');
      li.textContent = BLOCKER_COPY[code] ?? code;
      return li;
    }));
    const line = main.querySelector('[data-role="blockers-line"]') as HTMLElement;
    line.textContent = car.publishBlockers.length === 0 ? 'Nothing is blocking publish' : '';
    main.querySelector('[data-role="version-line"]')!.textContent = car.currentVersion !== null ? `Current version: ${car.currentVersion}` : 'Not published yet';
    const complete = main.querySelector('[data-role="complete"]') as HTMLButtonElement;
    const handover = main.querySelector('[data-role="handover-link"]') as HTMLAnchorElement;
    const report = main.querySelector('[data-role="report-link"]') as HTMLAnchorElement;
    complete.style.display = car.listingStatus === 'under_offer' || car.listingStatus === 'sold' ? '' : 'none';
    handover.style.display = car.listingStatus === 'sold' ? '' : 'none';
    handover.href = `/api/owner/cars/${car.id}/handover`;
    report.style.display = car.currentVersion !== null ? '' : 'none';
    report.href = `/api/owner/cars/${car.id}/report/${car.currentVersion}`;
  }

  async function refreshLinks(): Promise<void> {
    const reply = await api<{ links: LinkRow[] }>(`/api/owner/cars/${state.car!.id}/links`);
    state.links = reply.links;
    renderPeople();
  }

  function renderPeople(): void {
    const table = main.querySelector('[data-role="people-table"]') as HTMLTableElement;
    if (state.links.length === 0) { table.innerHTML = '<caption>No links yet</caption>'; return; }
    table.innerHTML = `<thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Seen</th><th>Last seen</th><th>Offer</th><th>Time left</th><th>Actions</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    state.links.forEach(link => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td></td><td></td><td class="tabular"></td><td class="tabular"></td><td></td><td class="tabular"></td><td></td>`;
      const cells = tr.querySelectorAll('td');
      cells[0].textContent = link.name;
      cells[1].textContent = link.role;
      cells[2].textContent = link.status === 'active' ? 'Active' : link.status === 'revoked' ? 'Revoked' : 'Expired';
      cells[3].textContent = link.role === 'buyer' ? `${link.seen} of ${link.total}` : '0';
      cells[4].textContent = link.lastSeenAt ? londonStamp(link.lastSeenAt) : '—';
      cells[5].textContent = link.offerStatus ? OFFER_WORD[link.offerStatus] ?? link.offerStatus : '—';
      cells[6].textContent = link.status === 'active' ? timeLeft(link.secondsRemaining) : '';
      const actions = cells[7];
      if (link.status === 'active') {
        const revoke = button('Revoke');
        revoke.addEventListener('click', () => void linkAction(link.id, 'revoke'));
        const renew = button('Renew');
        renew.addEventListener('click', () => void linkAction(link.id, 'renew'));
        actions.append(revoke, renew);
      }
      if (link.status === 'active' || link.status === 'expired') {
        const replace = button('Replace');
        replace.addEventListener('click', () => void linkAction(link.id, 'replace'));
        actions.appendChild(replace);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    function button(label: string): HTMLButtonElement {
      const el = document.createElement('button');
      el.className = 'pill pill-light';
      el.style.minHeight = '44px';
      el.textContent = label;
      return el;
    }
  }

  async function linkAction(linkId: string, action: 'revoke' | 'renew' | 'replace'): Promise<void> {
    announce(statusEl(), 'Updating link');
    try {
      const reply = await api<LinkRow & { token?: string; path?: string }>(`/api/owner/links/${linkId}/${action}`, { method: 'POST', body: '{}' });
      await refreshLinks();
      await refreshCar();
      if (action === 'revoke') announce(statusEl(), 'Link revoked');
      if (action === 'renew') announce(statusEl(), 'Link renewed');
      if (action === 'replace' && reply.path) {
        state.newLink = { address: window.location.origin + reply.path };
        renderNewLink();
        announce(statusEl(), `Link replaced`);
      }
    } catch (err) {
      if (guard401(err)) return;
      announce(statusEl(), (err as Error).message);
    }
  }

  function renderNewLink(): void {
    const region = main.querySelector('[data-role="new-link"]') as HTMLElement;
    if (!state.newLink) { region.style.display = 'none'; region.replaceChildren(); return; }
    region.style.display = '';
    region.replaceChildren();
    const link = document.createElement('a');
    link.href = state.newLink.address;
    link.textContent = state.newLink.address;
    const copy = document.createElement('button');
    copy.className = 'pill pill-light';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.newLink!.address);
      announce(statusEl(), 'Link copied');
    });
    region.append(link, copy);
    copy.focus();
  }

  async function refreshSlots(): Promise<void> {
    const reply = await api<{ slots: Slot[] }>(`/api/owner/cars/${state.car!.id}/slots`);
    state.slots = reply.slots;
    renderSlots();
  }

  function renderSlots(): void {
    const ul = main.querySelector('[data-role="slot-list"]') as HTMLElement;
    if (state.slots.length === 0) { ul.innerHTML = '<li class="notice-panel" style="display:inline-block">No viewings offered yet</li>'; return; }
    ul.replaceChildren(...state.slots.map(slot => {
      const li = document.createElement('li');
      li.style.cssText = 'border-bottom:1px solid var(--surface);padding:12px 0;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center';
      const label = document.createElement('span');
      label.className = 'tabular';
      label.textContent = slot.holderName ? `${slot.label} — held by ${slot.holderName}` : slot.label;
      li.appendChild(label);
      if (!slot.held) {
        const del = document.createElement('button');
        del.className = 'pill pill-light';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          try {
            await api(`/api/owner/cars/${state.car!.id}/slots/${slot.id}`, { method: 'DELETE' });
            await refreshSlots();
            await refreshCar();
          } catch (err) { if (guard401(err)) return; announce(statusEl(), (err as Error).message); }
        });
        li.appendChild(del);
      }
      return li;
    }));
  }

  async function refreshOffers(): Promise<void> {
    const reply = await api<{ offers: Offer[] }>(`/api/owner/cars/${state.car!.id}/offers`);
    state.offers = reply.offers;
    renderOffers();
  }

  function renderOffers(): void {
    const table = main.querySelector('[data-role="offers-table"]') as HTMLTableElement;
    if (state.offers.length === 0) { table.innerHTML = '<caption>No offers yet</caption>'; return; }
    table.innerHTML = '<thead><tr><th>Buyer</th><th>Amount</th><th>Status</th><th>Seen</th><th>Time left</th><th>Actions</th></tr></thead>';
    const tbody = document.createElement('tbody');
    state.offers.forEach(offer => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td class="tabular"></td><td></td><td class="tabular"></td><td class="tabular"></td><td></td>';
      const cells = tr.querySelectorAll('td');
      cells[0].textContent = offer.buyerName;
      cells[1].textContent = pounds(offer.amountPounds);
      cells[2].textContent = OFFER_WORD[offer.status] ?? offer.status;
      cells[3].textContent = `${offer.seen} of ${offer.total}`;
      cells[4].textContent = offer.status === 'open' || offer.status === 'needs_reread' ? timeLeft(offer.secondsRemaining) : '';
      const actions = cells[5];
      if (offer.status === 'open') {
        const accept = document.createElement('button');
        accept.className = 'pill pill-solid';
        accept.textContent = 'Accept';
        accept.addEventListener('click', () => openAcceptDialog(offer));
        actions.appendChild(accept);
      }
      if (offer.status === 'open' || offer.status === 'needs_reread') {
        const decline = document.createElement('button');
        decline.className = 'pill pill-light';
        decline.textContent = 'Decline';
        decline.addEventListener('click', async () => {
          announce(statusEl(), 'Declining offer');
          try {
            await api(`/api/owner/offers/${offer.id}/decline`, { method: 'POST', body: '{}' });
            await refreshOffers();
            await refreshCar();
            announce(statusEl(), 'Offer declined');
            const heading = main.querySelector('#offers-heading') as HTMLElement;
            heading.focus();
          } catch (err) {
            if (guard401(err)) return;
            announce(statusEl(), (err as Error).message);
          }
        });
        actions.appendChild(decline);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function openAcceptDialog(offer: Offer): void {
    const dialog = main.querySelector('[data-role="accept-dialog"]') as HTMLDialogElement;
    const confirm = dialog.querySelector('[data-role="confirm-accept"]') as HTMLButtonElement;
    const others = state.offers.filter(o => o.id !== offer.id && (o.status === 'open' || o.status === 'needs_reread')).length;
    dialog.querySelector('[data-role="accept-line-1"]')!.textContent = `Accept £${offer.amountPounds.toLocaleString('en-GB')} from ${offer.buyerName}?`;
    dialog.querySelector('[data-role="accept-line-2"]')!.textContent = `Other open offers closed: ${others}`;
    confirm.style.display = '';
    confirm.removeAttribute('aria-disabled');
    const key = randomKey();
    const requestHash = `${offer.id}`;
    void requestHash;
    let closing = false;
    dialog.showModal();
    (dialog.querySelector('[data-role="confirm-accept"]') as HTMLElement).focus();
    const finish = (): void => {
      dialog.close();
      state.overlayOpen = false;
      document.body.classList.remove('ob-overlay-open');
      const heading = main.querySelector('#offers-heading') as HTMLElement;
      heading.focus();
    };
    const close = (): void => {
      if (closing) return;
      closing = true;
      if (prefersReducedMotion()) finish();
      else void dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.then(finish);
    };
    const keydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button')).filter(b => b.getAttribute('aria-disabled') !== 'true' && b.style.display !== 'none');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    dialog.querySelector('[data-cancel]')?.addEventListener('click', close);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    const onConfirm = async (): Promise<void> => {
      if (confirm.getAttribute('aria-disabled') === 'true') return;
      confirm.setAttribute('aria-disabled', 'true');
      announce(dialogStatus(dialog)!, 'Accepting offer');
      try {
        await api(`/api/owner/offers/${offer.id}/accept`, { method: 'POST', idempotencyKey: key, body: '{}' });
        await refreshCar();
        await refreshOffers();
        await refreshLinks();
        close();
        announce(statusEl(), 'Offer accepted. Other open offers are closed.');
      } catch (err) {
        if (guard401(err)) return;
        const code = (err as { body?: { error?: string } }).body?.error;
        confirm.style.display = 'none';
        if (code === 'offer_already_accepted') announce(dialogStatus(dialog)!, 'Another offer has already been accepted');
        else if (code === 'offer_lapsed') announce(dialogStatus(dialog)!, 'This offer has lapsed');
        else if (code === 'offer_needs_reread') announce(dialogStatus(dialog)!, 'This offer is waiting for the buyer to re-read the changes');
        else if (code === 'offer_not_open') announce(dialogStatus(dialog)!, 'This offer is no longer open');
        else if (isLostReply(err)) { announce(dialogStatus(dialog)!, 'That could not be sent. Try again.'); confirm.style.display = ''; confirm.removeAttribute('aria-disabled'); void confirm.focus(); return; }
        else announce(dialogStatus(dialog)!, (err as Error).message);
      }
    };
    confirm.addEventListener('click', () => void onConfirm());
  }

  async function refreshAlerts(): Promise<void> {
    const reply = await api<{ alerts: AlertRow[] }>('/api/owner/alerts');
    state.alerts = reply.alerts.filter(a => a.carId === state.car!.id);
    renderAlerts();
    renderSectionNav();
  }

  function renderAlerts(): void {
    const list = main.querySelector('[data-role="alerts-list"]') as HTMLElement;
    if (state.alerts.length === 0) { list.innerHTML = '<li>No alerts yet</li>'; return; }
    list.replaceChildren(...state.alerts.map(alert => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--surface);padding:10px 0;flex-wrap:wrap';
      const word = alert.state === 'delivered' ? 'Delivered' : alert.state === 'waiting' ? 'Waiting' : 'Failed';
      const span = document.createElement('span');
      span.textContent = `${word} · ${alert.kind.replace('_', ' ')}`;
      li.appendChild(span);
      if (alert.state === 'failed') {
        const retry = document.createElement('button');
        retry.className = 'pill pill-light';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => void retryAlert(alert.id, retry, false));
        li.appendChild(retry);
      }
      return li;
    }));
  }

  async function retryAlert(alertId: string, buttonEl: HTMLElement, inSheet: boolean): Promise<void> {
    const region = inSheet ? dialogStatus(main.querySelector('[data-role="sections-dialog"]') as HTMLDialogElement)! : statusEl()!;
    if (state.pendingRetry) { announce(region, 'This alert is already being sent'); void buttonEl.focus(); return; }
    state.pendingRetry = alertId;
    buttonEl.setAttribute('aria-disabled', 'true');
    announce(region, 'Sending alert');
    try {
      await api(`/api/owner/alerts/${alertId}/retry`, { method: 'POST', body: '{}' });
      await refreshAlerts();
      await refreshCar();
      announce(region, 'Alert delivered');
      const listitem = buttonEl.closest('li') as HTMLElement | null;
      if (listitem && !inSheet) listitem.focus();
      else if (inSheet) { renderSectionNav(); const nextRetry = main.querySelector('[data-role="sheet-nav"] [data-role="sheet-retry"]') as HTMLElement | null; (nextRetry ?? main.querySelector('[data-role="sheet-nav"] a[href$="#alerts"]') as HTMLElement).focus(); }
    } catch (err) {
      if (guard401(err)) { state.pendingRetry = null; return; }
      const code = (err as { body?: { error?: string } }).body?.error;
      if (code === 'alert_retry_in_progress' || code === 'alert_already_delivered') announce(region, 'This alert is already being sent');
      else announce(region, 'Phone alert failed. It stays in your alert list.');
      void buttonEl.focus();
    } finally {
      state.pendingRetry = null;
      buttonEl.removeAttribute('aria-disabled');
    }
  }

  function bindCarEvents(carId: string): void {
    const form = main.querySelector('[data-role="finding-form"]') as HTMLFormElement;
    const panelSelect = form.querySelector('[data-role="panel-select"]') as HTMLSelectElement;
    panelSelect.replaceChildren(...PANELS.map(p => new Option(p.label, p.id)));
    panelSelect.addEventListener('change', () => {
      findingPin.panelId = panelSelect.value as PanelId;
      findingPin.u = 0.5;
      findingPin.v = 0.5;
      renderFindingDiagram();
      renderStagePreview();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const save = form.querySelector('[data-role="save-finding"]') as HTMLButtonElement;
      save.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Saving finding');
      const body = {
        panelId: panelSelect.value,
        u: Math.round(findingPin.u * 1000) / 1000,
        v: Math.round(findingPin.v * 1000) / 1000,
        title: (form.querySelector('#finding-title') as HTMLInputElement).value,
        wording: (form.querySelector('#finding-wording') as HTMLTextAreaElement).value,
        severity: (form.querySelector('[data-role="severity"]') as HTMLSelectElement).value,
        photoId: (form.querySelector('[data-role="photo-select"]') as HTMLSelectElement).value || null,
      };
      try {
        if (editingFindingId) {
          await api(`/api/owner/cars/${carId}/findings/${editingFindingId}`, { method: 'PATCH', headers: { 'If-Match': String(editingRevision) }, body: JSON.stringify(body) });
        } else {
          await api(`/api/owner/cars/${carId}/findings`, { method: 'POST', body: JSON.stringify(body) });
        }
        editingFindingId = null;
        form.reset();
        await refreshCar();
        await refreshFindings();
        announce(statusEl(), 'Finding saved');
      } catch (err) {
        if (guard401(err)) return;
        const errors = (err as { body?: { errors?: Record<string, string> } }).body?.errors ?? {};
        form.querySelectorAll('[data-error]').forEach(span => { span.textContent = errors[span.dataset.error!] ?? ''; });
        if ((err as { body?: { error?: string } }).body?.error === 'stale_finding') announce(statusEl(), 'This finding has changed. Reload it before saving.');
        else announce(statusEl(), Object.values(errors)[0] ?? (err as Error).message);
      } finally {
        save.removeAttribute('aria-disabled');
      }
    });

    main.querySelector('[data-role="pull-record"]')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Pulling the test record');
      try {
        await api(`/api/owner/cars/${carId}/record/pull`, { method: 'POST', body: '{}' });
        await refreshCar();
        await refreshRecord();
        announce(statusEl(), 'Test record pulled');
      } catch (err) {
        if (guard401(err)) return;
        const code = (err as { body?: { error?: string; retryAfterSeconds?: number } }).body?.error;
        if (code === 'record_not_found') announce(statusEl(), 'No test record was found for this registration.');
        else if (code === 'record_throttled') announce(statusEl(), `The record service is busy. Try again in ${(err as { body: { retryAfterSeconds: number } }).body.retryAfterSeconds} seconds.`);
        else if (code === 'record_unreachable') announce(statusEl(), 'The roadworthiness record service is not answering. Your last pull is still shown.');
        else announce(statusEl(), (err as Error).message);
      } finally {
        button.removeAttribute('aria-disabled');
      }
    });

    main.querySelector('[data-role="publish"]')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Rendering the report');
      try {
        const reply = await api<{ version: number }>(`/api/owner/cars/${carId}/publish`, { method: 'POST', body: '{}' });
        await refreshCar();
        await refreshFindings();
        await refreshLinks();
        announce(statusEl(), `Published as version ${reply.version}`);
      } catch (err) {
        if (guard401(err)) return;
        const body = (err as { body?: { error?: string; reasons?: string[] } }).body;
        if (body?.reasons) announce(statusEl(), body.reasons.map(r => BLOCKER_COPY[r] ?? r).join('. ') + '.');
        else if (body?.error === 'no_changes') announce(statusEl(), 'Nothing has changed since the last version');
        else if (body?.error === 'report_render_failed') announce(statusEl(), 'The report could not be rendered, so nothing was published.');
        else if (body?.error === 'report_store_failed') announce(statusEl(), 'The report could not be stored, so nothing was published.');
        else announce(statusEl(), (err as Error).message);
        await refreshCar();
      } finally {
        button.removeAttribute('aria-disabled');
      }
    });

    main.querySelector('[data-role="withdraw"]')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Withdrawing listing');
      try {
        await api(`/api/owner/cars/${carId}/withdraw`, { method: 'POST', body: '{}' });
        await refreshCar();
        announce(statusEl(), 'Listing withdrawn');
      } catch (err) {
        if (guard401(err)) return;
        announce(statusEl(), (err as Error).message);
        await refreshCar();
      } finally {
        button.removeAttribute('aria-disabled');
      }
    });

    main.querySelector('[data-role="complete"]')?.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Rendering the handover record');
      try {
        await api(`/api/owner/cars/${carId}/complete`, { method: 'POST', body: '{}' });
        await refreshCar();
        announce(statusEl(), 'Sale complete');
      } catch (err) {
        if (guard401(err)) return;
        announce(statusEl(), 'The handover record could not be made, so the sale is not complete.');
        void button.focus();
      } finally {
        button.removeAttribute('aria-disabled');
      }
    });

    main.querySelector('[data-role="link-form"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      announce(statusEl(), 'Creating link');
      const role = (main.querySelector('input[name="link-type"]:checked') as HTMLInputElement).value;
      const name = (main.querySelector('[data-role="person-name"]') as HTMLInputElement).value;
      try {
        const reply = await api<{ path: string; name: string }>(`/api/owner/cars/${carId}/links`, { method: 'POST', body: JSON.stringify({ role, name }) });
        state.newLink = { address: window.location.origin + reply.path };
        renderNewLink();
        await refreshLinks();
        await refreshCar();
        announce(statusEl(), `Link ready for ${reply.name}`);
      } catch (err) {
        if (guard401(err)) return;
        announce(statusEl(), (err as Error).message);
      }
    });

    main.querySelector('[data-role="slot-form"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      announce(statusEl(), 'Adding viewing slot');
      const start = (form.querySelector('[data-role="slot-start"]') as HTMLInputElement).value;
      const length = Number((form.querySelector('[data-role="slot-length"]') as HTMLInputElement).value);
      try {
        await api(`/api/owner/cars/${carId}/slots`, { method: 'POST', body: JSON.stringify({ localStart: start, durationMinutes: length }) });
        await refreshSlots();
        await refreshCar();
        announce(statusEl(), 'Viewing slot added');
      } catch (err) {
        if (guard401(err)) return;
        const errors = (err as { body?: { errors?: Record<string, string> } }).body?.errors ?? {};
        form.querySelectorAll('[data-error]').forEach(span => { span.textContent = errors[span.dataset.error!] ?? ''; });
        announce(statusEl(), Object.values(errors)[0] ?? (err as Error).message);
      }
    });

    const addPhoto = main.querySelector('[data-role="add-photo"]') as HTMLButtonElement;
    const photoFile = main.querySelector('[data-role="photo-file"]') as HTMLInputElement;
    const preview = main.querySelector('[data-role="photo-preview"]') as HTMLImageElement;
    const maskFields = {
      x: main.querySelector('[data-role="mask-x"]') as HTMLInputElement,
      y: main.querySelector('[data-role="mask-y"]') as HTMLInputElement,
      w: main.querySelector('[data-role="mask-w"]') as HTMLInputElement,
      h: main.querySelector('[data-role="mask-h"]') as HTMLInputElement,
    };
    let chosenFile: File | null = null;
    addPhoto.addEventListener('click', () => photoFile.click());
    photoFile.addEventListener('change', () => {
      chosenFile = photoFile.files?.[0] ?? null;
      if (!chosenFile) return;
      const url = URL.createObjectURL(chosenFile);
      preview.src = url;
      preview.style.display = '';
      maskFields.x.value = ''; maskFields.y.value = ''; maskFields.w.value = ''; maskFields.h.value = '';
      (main.querySelector('[data-role="no-plate"]') as HTMLInputElement).checked = false;
    });
    preview.addEventListener('pointerdown', (e) => {
      if (!preview.src) return;
      const rect = preview.getBoundingClientRect();
      let startX = (e.clientX - rect.left) / rect.width;
      let startY = (e.clientY - rect.top) / rect.height;
      const move = (ev: PointerEvent): void => {
        const cx = clamp01((ev.clientX - rect.left) / rect.width);
        const cy = clamp01((ev.clientY - rect.top) / rect.height);
        maskFields.x.value = (Math.min(startX, cx) * 100).toFixed(1);
        maskFields.y.value = (Math.min(startY, cy) * 100).toFixed(1);
        maskFields.w.value = (Math.abs(cx - startX) * 100).toFixed(1);
        maskFields.h.value = (Math.abs(cy - startY) * 100).toFixed(1);
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    });
    const storePhoto = main.querySelector('[data-role="store-photo"]') as HTMLButtonElement;
    storePhoto.addEventListener('click', async () => {
      if (!chosenFile) return;
      const noPlate = (main.querySelector('[data-role="no-plate"]') as HTMLInputElement).checked;
      const hasMask = maskFields.x.value && maskFields.y.value && maskFields.w.value && maskFields.h.value;
      if (!noPlate && !hasMask) {
        announce(statusEl(), 'Mark the plate or tick No plate in this photo');
        return;
      }
      storePhoto.setAttribute('aria-disabled', 'true');
      announce(statusEl(), 'Storing file');
      const form = new FormData();
      form.append('kind', 'photo');
      form.append('file', chosenFile);
      form.append('plateMask', noPlate ? 'null' : JSON.stringify({
        x: Number(maskFields.x.value) / 100,
        y: Number(maskFields.y.value) / 100,
        w: Number(maskFields.w.value) / 100,
        h: Number(maskFields.h.value) / 100,
      }));
      try {
        const reply = await fetch(`/api/owner/cars/${carId}/uploads`, { method: 'POST', body: form });
        const body = await reply.json() as { locationRemoved?: boolean };
        if (!reply.ok) {
          if (body?.error === 'file_too_large') announce(statusEl(), 'This file is over the size limit');
          else if (body?.error === 'unsupported_file') announce(statusEl(), 'This file type is not accepted');
          else if ((body as { errors?: Record<string, string> }).errors?.file) announce(statusEl(), (body as { errors: Record<string, string> }).errors.file);
          else if ((body as { errors?: Record<string, string> }).errors?.plateMask) announce(statusEl(), (body as { errors: Record<string, string> }).errors.plateMask);
          else announce(statusEl(), (body as { message?: string }).message ?? 'The photo could not be stored');
          return;
        }
        announce(statusEl(), 'File stored');
        if (body.locationRemoved) announce(statusEl(), 'Location removed from the buyer copy');
        await refreshUploads();
        await refreshFindings();
        await refreshCar();
        preview.style.display = 'none';
        preview.removeAttribute('src');
        chosenFile = null;
        photoFile.value = '';
        addPhoto.focus();
      } catch {
        announce(statusEl(), 'Photo storage is not answering. Nothing was saved. Try again shortly.');
      } finally {
        storePhoto.removeAttribute('aria-disabled');
      }
    });

    const addInvoice = main.querySelector('[data-role="add-invoice"]') as HTMLButtonElement;
    const invoiceFile = main.querySelector('[data-role="invoice-file"]') as HTMLInputElement;
    addInvoice.addEventListener('click', () => invoiceFile.click());
    invoiceFile.addEventListener('change', async () => {
      const file = invoiceFile.files?.[0];
      if (!file) return;
      const label = (main.querySelector('[data-role="invoice-label"]') as HTMLInputElement).value;
      announce(statusEl(), 'Storing file');
      const form = new FormData();
      form.append('kind', 'invoice');
      form.append('file', file);
      form.append('label', label);
      const reply = await fetch(`/api/owner/cars/${carId}/uploads`, { method: 'POST', body: form });
      const body = await reply.json();
      if (!reply.ok) {
        if (body?.error === 'file_too_large') announce(statusEl(), 'This file is over the size limit');
        else if (body?.error === 'unsupported_file') announce(statusEl(), 'This file type is not accepted');
        else announce(statusEl(), body?.message ?? 'The invoice could not be stored');
        return;
      }
      announce(statusEl(), 'File stored');
      await refreshUploads();
      await refreshCar();
    });

    main.querySelectorAll('[data-units]').forEach(button => {
      button.addEventListener('click', () => {
        state.units = state.units === 'microns' ? 'mils' : 'microns';
        localStorage.setItem('ob-units', state.units);
        main.querySelectorAll('[data-units]').forEach(b => { b.textContent = state.units === 'microns' ? 'Units: microns' : 'Units: mils'; });
        renderPanelList();
      });
    });
    main.querySelectorAll('[data-units]').forEach(b => { b.textContent = state.units === 'microns' ? 'Units: microns' : 'Units: mils'; });

    main.querySelector('[data-role="open-sections"]')?.addEventListener('click', () => {
      const dialog = main.querySelector('[data-role="sections-dialog"]') as HTMLDialogElement;
      dialog.dataset.scrimClose = 'true';
      dialog.showModal();
      state.overlayOpen = true;
      (dialog.querySelector('button, a') as HTMLElement).focus();
      dialog.querySelector('[data-close]')?.addEventListener('click', () => { dialog.close(); state.overlayOpen = false; });
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); dialog.close(); state.overlayOpen = false; });
      dialog.addEventListener('click', (e) => {
        const rect = dialog.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) { dialog.close(); state.overlayOpen = false; }
      });
    });

    window.addEventListener('resize', () => renderBar());
  }

  function openSignInAgain(): void {
    const dialog = main.querySelector('[data-role="signin-dialog"]') as HTMLDialogElement | null;
    if (!dialog) {
      window.location.replace(`/owner?return=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    dialog.showModal();
    (dialog.querySelector('[data-role="signin-pass"]') as HTMLElement).focus();
    const submit = dialog.querySelector('[data-role="signin-submit"]') as HTMLButtonElement;
    submit.addEventListener('click', async () => {
      submit.setAttribute('aria-disabled', 'true');
      announce(dialogStatus(dialog)!, 'Checking passphrase');
      const pass = (dialog.querySelector('[data-role="signin-pass"]') as HTMLInputElement).value;
      try {
        await api('/api/owner/session', { method: 'POST', body: JSON.stringify({ passphrase: pass }) });
        dialog.close();
        window.location.reload();
      } catch {
        submit.removeAttribute('aria-disabled');
        announce(dialogStatus(dialog)!, 'That passphrase is not right');
        void submit.focus();
      }
    });
  }

  async function pollCar(carId: string): Promise<void> {
    try {
      await refreshCar();
      await refreshLinks();
      await refreshSlots();
      await refreshOffers();
      await refreshAlerts();
      const record = await api<typeof state.record>(`/api/owner/cars/${carId}/record`).catch(() => null);
      if (record) { state.record = record; renderTape(); renderAdvisories(); }
    } catch (err) {
      if ((err as { status?: number }).status === 401) return;
    }
  }

  void boot().catch((err) => {
    if ((err as { status?: number }).status === 401) {
      window.location.replace(`/owner?return=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    main.innerHTML = `<div class="notice-panel" style="margin:60px auto;max-width:520px">The page could not load. Try again shortly.</div>`;
  });
}
