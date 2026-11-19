import { api, clearSession, currentSession, isRoleHome, loadSession, readCookie, roleHome, serverNowMs, gapCellText, ticketStatusWord, type ApiOutcome } from './api.js';
import { SVG_SIZE, dialTicks, sectorLabel, SECTOR_CLASS, sectorPath, stationFilterMatches, earliestOpenStep } from './dial.js';
import { formatHoursTwo, formatMinutesCountdown, formatMinutesWhole, formatMoney, movementLabel, documentTypeLabel, serviceLabel } from '../labels.js';
import { minutesToWall, parseWall, wallMinutesToDeg, datePlusDays, weekdayName } from '../sitetime.js';
import type { Balances, Booking, DocumentRecord, LedgerMovement, MeBody, VisitRecord } from '../shapes.js';
import type { Json } from '../types.js';

const root = document.getElementById('app') as HTMLElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type ElementOf<T extends string> =
  T extends 'input' ? HTMLInputElement
  : T extends 'select' ? HTMLSelectElement
  : T extends 'button' ? HTMLButtonElement
  : T extends 'a' ? HTMLAnchorElement
  : T extends 'form' ? HTMLFormElement
  : T extends 'label' ? HTMLLabelElement
  : T extends 'textarea' ? HTMLTextAreaElement
  : HTMLElement;

function el<T extends string>(tag: T, className?: string, text?: string): ElementOf<T> {
  const node = document.createElement(tag) as ElementOf<T>;
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Status regions: each write replaces the whole text in one DOM update. */
function writeStatus(node: HTMLElement | null, copy: string): void {
  if (node === null) return;
  if (node.textContent === copy) {
    node.textContent = '';
    requestAnimationFrame(() => {
      node.textContent = copy;
    });
    return;
  }
  node.textContent = copy;
}

function setFieldError(field: HTMLElement, message: string): void {
  field.setAttribute('aria-invalid', 'true');
  const wrap = el('span', 'field-error');
  wrap.id = `${field.id}-error`;
  wrap.textContent = message;
  field.setAttribute('aria-describedby', wrap.id);
  field.insertAdjacentElement('afterend', wrap);
}

function clearFieldError(field: HTMLElement): void {
  field.removeAttribute('aria-invalid');
  field.removeAttribute('aria-describedby');
  field.parentElement?.querySelectorAll('.field-error').forEach((node) => node.remove());
}

interface SitesResponse {
  sites: Array<{ id: string; name: string; time_zone: string; address: string; local_now: string; local_date: string }>;
}

let sitesCache: SitesResponse | null = null;

async function loadSites(): Promise<SitesResponse> {
  if (sitesCache !== null) return sitesCache;
  const outcome = await api<SitesResponse>('GET', '/api/sites');
  sitesCache = outcome.body ?? { sites: [] };
  return sitesCache;
}

function siteById(id: string): SitesResponse['sites'][number] | null {
  return sitesCache?.sites.find((site) => site.id === id) ?? null;
}

function currentPath(): string {
  return window.location.pathname.replace(/\/$/, '') || '/';
}

function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  void render();
}

window.addEventListener('popstate', () => {
  void render();
});

// ---------------------------------------------------------------- sign in

function renderSignIn(sessionEnded: boolean): void {
  root.replaceChildren();
  const wrap = el('div', 'login-wrap');
  const panel = el('div', 'panel');
  const title = el('h1', 'app-title', 'Pilotlight');
  const sub = el('p', 'muted small', 'Shared-kitchen booking and compliance ledger');
  sub.className = 'muted small center';
  const form = el('form', 'mt');

  const emailField = el('input');
  emailField.id = 'sign-in-email';
  emailField.autocomplete = 'username';
  const emailLabel = el('label', undefined, 'Email');
  emailLabel.htmlFor = emailField.id;
  const emailWrap = el('div', 'mt');
  emailWrap.append(emailLabel, emailField);

  const passField = el('input');
  passField.id = 'sign-in-password';
  passField.type = 'password';
  passField.autocomplete = 'current-password';
  const passLabel = el('label', undefined, 'Password');
  passLabel.htmlFor = passField.id;
  const passWrap = el('div', 'mt');
  passWrap.append(passLabel, passField);

  const status = el('div', 'status-line mt');
  status.id = 'sign-in-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  const button = el('button', 'btn is-solid mt', 'Sign in');
  button.type = 'submit';
  button.classList.add('is-block');

  form.append(emailWrap, passWrap, status, button);
  panel.append(title, sub, form);
  wrap.append(panel);
  root.append(wrap);

  if (sessionEnded) writeStatus(status, 'Your session has ended. Sign in again.');

  for (const field of [emailField, passField]) {
    field.addEventListener('input', () => clearFieldError(field));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    writeStatus(status, 'Signing in…');
    button.setAttribute('aria-disabled', 'true');
    const outcome = await api<MeBody>('POST', '/api/session', {
      email: emailField.value,
      password: passField.value,
    });
    button.setAttribute('aria-disabled', 'false');
    if (outcome.status !== 200) {
      const code = outcome.error?.code ?? 'unknown';
      const fields = outcome.error?.fields ?? {};
      if (code === 'invalid_credentials') {
        writeStatus(status, "That email and password don't match.");
      } else if (code === 'too_many_attempts') {
        writeStatus(status, 'Too many sign-in attempts. Try again in a few minutes.');
      } else {
        if (fields.email !== undefined) {
          clearFieldError(emailField);
          setFieldError(emailField, fields.email);
        }
        if (fields.password !== undefined) {
          clearFieldError(passField);
          setFieldError(passField, fields.password);
        }
        writeStatus(status, fields.email !== undefined ? fields.email : 'Enter your password.');
      }
      return;
    }
    sitesCache = null;
    const body = outcome.body;
    if (body === null) return;
    if (currentPath() === '/' || !isRoleHome(currentPath(), body.user.role)) {
      navigate(roleHome(body.user.role), true);
      return;
    }
    await render();
  });

  emailField.focus();
}

// ---------------------------------------------------------------- shell

const NAV_LINKS: Record<string, Array<{ href: string; label: string }>> = {
  member: [
    { href: '/book', label: 'Book' },
    { href: '/packs', label: 'Packs' },
    { href: '/documents', label: 'Documents' },
  ],
  kitchen_manager: [
    { href: '/site', label: 'Site day' },
    { href: '/compliance', label: 'Compliance' },
    { href: '/trucks', label: 'Trucks' },
  ],
  finance_lead: [
    { href: '/rates', label: 'Rates' },
    { href: '/reports', label: 'Reports' },
  ],
};

function renderShell(me: MeBody, main: HTMLElement): void {
  root.replaceChildren();
  const header = el('header', 'app-header');
  const brand = el('a', 'brand', 'Pilotlight');
  brand.href = '/';

  const nav = el('nav', 'main-nav');
  nav.id = 'main-nav';
  nav.setAttribute('aria-label', 'Main');
  const links = [...(NAV_LINKS[me.user.role] ?? [])];
  if (me.user.role === 'member' && me.member?.truck !== null) {
    links.push({ href: '/truck', label: 'Truck log' });
  }
  const path = currentPath();
  for (const link of links) {
    const anchor = el('a', undefined, link.label);
    anchor.href = link.href;
    if (path === link.href) anchor.setAttribute('aria-current', 'page');
    nav.append(anchor);
  }
  const phoneBand = window.innerWidth < 640;
  nav.dataset.collapsed = phoneBand ? 'true' : 'false';

  const menuBtn = el('button', 'btn menu-btn', 'Menu');
  menuBtn.setAttribute('aria-expanded', phoneBand ? 'false' : 'true');
  menuBtn.setAttribute('aria-controls', 'main-nav');
  menuBtn.addEventListener('click', () => {
    const collapsed = nav.dataset.collapsed === 'true';
    nav.dataset.collapsed = collapsed ? 'false' : 'true';
    menuBtn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    if (collapsed) {
      (nav.querySelector('a') as HTMLElement | null)?.focus();
    } else {
      menuBtn.focus();
    }
  });

  const actions = el('div', 'header-actions');
  const signOut = el('button', 'btn', 'Sign out');
  signOut.addEventListener('click', async () => {
    await api('DELETE', '/api/session');
    clearSession();
    sitesCache = null;
    navigate('/', true);
  });
  actions.append(signOut);

  header.append(brand, menuBtn, nav, actions);
  main.className = 'content';
  root.append(header, main);

  window.addEventListener('resize', () => {
    const band = window.innerWidth < 640;
    nav.dataset.collapsed = band ? 'true' : 'false';
    menuBtn.setAttribute('aria-expanded', band ? 'false' : 'true');
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && window.innerWidth < 640 && nav.dataset.collapsed === 'false') {
      nav.dataset.collapsed = 'true';
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.focus();
    }
  });
}

function panel(title: string): { panel: HTMLElement; body: HTMLElement } {
  const outer = el('section', 'panel');
  const heading = el('h3', undefined, title);
  const body = el('div');
  outer.append(heading, body);
  return { panel: outer, body };
}

function ticketCard(booking: Booking): HTMLElement {
  const card = el('article', 'ticket');
  card.tabIndex = 0;
  card.dataset.bookingId = booking.id;
  const ref = el('div', 'ref', booking.reference);
  const head = el('div', 'head', booking.station_name);
  const detail = el('div', 'small muted', `${booking.date} ${booking.start}–${booking.end}`);
  const hours = el('div', 'hours', `${formatHoursTwo(booking.hours)} h`);
  const stamp = el('span', `stamp is-${booking.status}`, ticketStatusWord(booking));
  card.append(ref, head, detail, hours, stamp);
  if (booking.cancelled_by !== null) {
    card.append(el('div', 'by-line', `Cancelled by ${booking.cancelled_by.name}`));
  }
  return card;
}

const bookingRefs = new Map<string, string>();

function movementRow(movement: LedgerMovement): HTMLTableRowElement {
  const row = document.createElement('tr');
  const available = movement.entries.find((entry) => entry.account === 'available')?.hours ?? null;
  const committed = movement.entries.find((entry) => entry.account === 'committed')?.hours ?? null;
  const cells = [
    new Date(movement.created_at).toISOString().replace('T', ' ').slice(0, 16),
    movementLabel(movement.kind),
    movement.booking_id === null ? '—' : bookingRefs.get(movement.booking_id) ?? '—',
    movement.actor === null ? 'Pilotlight' : movement.actor.name,
    available === null ? '' : formatHoursTwo(available),
    committed === null ? '' : formatHoursTwo(committed),
  ];
  for (const value of cells) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  return row;
}

// ---------------------------------------------------------------- Book screen

interface BookState {
  siteId: string;
  date: string;
  filter: string;
}

function nextOpenDate(site: SitesResponse['sites'][number]): string {
  const cutoffPassed = site.local_now.slice(11) >= '18:00:00';
  return datePlusDays(site.local_date, cutoffPassed ? 2 : 1);
}

async function renderBook(me: MeBody, main: HTMLElement): Promise<void> {
  const rail = el('div', 'rail');
  const grid = el('div', 'grid cols-12 mt');
  const dialColumn = el('div', 'span-8');
  const spike = el('div', 'span-4');
  grid.append(dialColumn, spike);
  main.append(rail, grid);

  const sites = await loadSites();
  const state: BookState = {
    siteId: me.user.site_id ?? sites.sites[0]?.id ?? '',
    date: '',
    filter: 'all',
  };
  const initialSite = siteById(state.siteId) ?? sites.sites[0] ?? null;
  state.date = initialSite !== null ? nextOpenDate(initialSite) : new Date().toISOString().slice(0, 10);

  const siteField = el('select');
  siteField.id = 'rail-site';
  siteField.setAttribute('aria-label', 'Site');
  for (const candidate of sites.sites) {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = candidate.name;
    option.selected = candidate.id === state.siteId;
    siteField.append(option);
  }
  const siteWrap = el('div', 'field');
  const siteLabel = el('label', undefined, 'Site');
  siteLabel.htmlFor = siteField.id;
  siteWrap.append(siteLabel, siteField);

  const prev = el('button', 'btn', 'Previous day');
  const next = el('button', 'btn', 'Next day');

  const dateField = el('input');
  dateField.type = 'date';
  dateField.id = 'rail-date';
  const dateLabel = el('label', undefined, 'Date');
  dateLabel.htmlFor = dateField.id;
  const dateWrap = el('div', 'field');
  dateWrap.append(dateLabel, dateField);
  dateField.value = state.date;

  const timeReadout = el('div', 'site-time mono', `Site time ${initialSite?.local_now.slice(11, 16) ?? '--:--'}`);

  const radios = el('div', 'radio-group');
  radios.setAttribute('role', 'radiogroup');
  radios.setAttribute('aria-label', 'Station type');
  for (const value of ['all', 'ovens', 'mixers', 'blast chillers', 'prep tables']) {
    const pill = el('label', 'radio-pill');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'station-type';
    input.value = value;
    input.checked = value === 'all';
    pill.append(input, el('span', undefined, value === 'all' ? 'All' : value.replace(/^./, (char) => char.toUpperCase())));
    radios.append(pill);
  }
  const filterWrap = el('div', 'field');
  filterWrap.append(el('label', undefined, 'Station type'), radios);

  rail.append(siteWrap, prev, dateWrap, next, filterWrap, timeReadout);

  const bookingStatus = el('div', 'status-line');
  bookingStatus.id = 'booking-status';
  bookingStatus.setAttribute('role', 'status');
  bookingStatus.setAttribute('aria-live', 'polite');
  bookingStatus.setAttribute('aria-atomic', 'true');
  dialColumn.append(bookingStatus);

  const spikeHeading = el('h3', undefined, 'Tickets');
  const ticketsList = el('ul', 'list-plain');
  ticketsList.setAttribute('aria-label', 'Tickets');
  spike.append(spikeHeading, ticketsList);

  type Station = { id: string; name: string; kind: string; sectors: Array<{ kind: string; start: string; end: string; booking_id: string | null }> };
  interface AvailabilityResponse { site_id: string; date: string; stations: Station[] }

  let requestSeq = 0;
  let busy = false;
  let stationsShown: Station[] = [];
  let holdBooking: Booking | null = null;
  let countdownTimer = 0;

  const dialState = { startMin: 0, endMin: 0, buffer: 30, available: me.member?.available_hours ?? 0, stationName: '' };

  const claimPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const sectorsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const centre = el('div', 'dial-centre');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const holdInfo = el('div', 'countdown mt');
  const confirmBtn = el('button', 'btn is-solid', 'Confirm booking');
  const releaseBtn = el('button', 'btn', 'Release hold');
  const holdBtn = el('button', 'btn', 'Hold window');
  const repeatBtn = el('button', 'btn', 'Repeat weekly');
  const startSpin = document.createElement('input');
  const endSpin = document.createElement('input');

  const clock = window.setInterval(() => {
    const site = siteById(state.siteId);
    if (site !== null) timeReadout.textContent = `Site time ${site.local_now.slice(11, 16)}`;
  }, 60000);

  const teardown = (): void => {
    window.clearInterval(clock);
    window.clearInterval(countdownTimer);
    window.clearInterval(reloadTimer);
  };
  const observer = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      teardown();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const redrawClaim = (): void => {
    const start = dialState.startMin;
    const end = dialState.endMin;
    const hasLength = start !== end;
    claimPath.setAttribute('d', hasLength ? sectorPath(start, end) : '');
    claimPath.setAttribute('data-start-deg', String(wallMinutesToDeg(start)));
    claimPath.setAttribute('data-end-deg', String(wallMinutesToDeg(end)));
    claimPath.setAttribute('aria-label', `Claim ${minutesToWall(start)} to ${minutesToWall(end)}`);
    const hours = (end - start) / 60;
    const after = Math.max(0, dialState.available - hours);
    if (hasLength) {
      centre.innerHTML = `<div>${minutesToWall(start)}–${minutesToWall(end)}</div><div class="big numeral" data-pack-hours="${after}">${formatHoursTwo(after)}</div><div class="small muted">Pack hours after this claim ${formatHoursTwo(after)}</div>`;
    } else {
      centre.innerHTML = `<div>Drag to claim</div><div class="big numeral" data-pack-hours="${dialState.available}">${formatHoursTwo(dialState.available)}</div><div class="small muted">Pack hours ${formatHoursTwo(dialState.available)}</div>`;
    }
    startSpin.value = minutesToWall(start);
    endSpin.value = minutesToWall(end);
    holdBtn.setAttribute('aria-disabled', hasLength ? 'false' : 'true');
    repeatBtn.setAttribute('aria-disabled', hasLength ? 'false' : 'true');
  };

  const drawSectors = (sectors: Station['sectors']): void => {
    sectorsLayer.replaceChildren();
    for (const sector of sectors) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const startMin = parseWall(sector.start);
      const endMin = parseWall(sector.end);
      path.setAttribute('d', sectorPath(startMin, endMin));
      path.setAttribute('class', SECTOR_CLASS[sector.kind] ?? 'sector-booked');
      path.setAttribute('role', 'img');
      path.setAttribute('aria-label', `${sectorAria(sector.kind)} ${sector.start} to ${sector.end}`);
      path.setAttribute('data-start-deg', String(wallMinutesToDeg(startMin)));
      path.setAttribute('data-end-deg', String(wallMinutesToDeg(endMin)));
      sectorsLayer.append(path);
    }
    if (holdBooking === null && dialState.startMin === dialState.endMin) {
      const step = earliestOpenStep(sectors);
      dialState.startMin = step;
      dialState.endMin = step;
    }
    redrawClaim();
  };

  const footprintBlocked = (start: number, end: number, sectors: Station['sectors']): boolean => {
    const ranges = sectors.map((sector) => ({ kind: sector.kind, start: parseWall(sector.start), end: parseWall(sector.end) }));
    const windowOverlap = ranges.some((range) => start < range.end && range.start < end);
    if (windowOverlap) return true;
    const bufferStart = Math.max(start, end === start ? start : end);
    const bufferEnd = end + dialState.buffer;
    return ranges.some((range) => range.kind !== 'nonexistent' && bufferStart < range.end && range.start < bufferEnd);
  };

  const loadAvailability = async (): Promise<void> => {
    const seq = ++requestSeq;
    busy = true;
    document.querySelectorAll('.dial-group').forEach((node) => node.setAttribute('aria-busy', 'true'));
    const outcome = await api<AvailabilityResponse>('GET', `/api/sites/${state.siteId}/availability?date=${state.date}`);
    if (seq !== requestSeq) return;
    busy = false;
    if (outcome.status !== 200 || outcome.body === null) {
      document.querySelectorAll('.dial-group').forEach((node) => node.setAttribute('aria-busy', 'false'));
      return;
    }
    const stations = outcome.body.stations.filter((station) => stationFilterMatches(station.kind, state.filter));
    stationsShown = stations;
    const primary = stations[0];
    if (primary !== undefined) {
      dialState.buffer = primary.kind === 'blast_chiller' ? 45 : primary.kind === 'prep_table' ? 15 : 30;
      dialState.stationName = primary.name;
      const stationNameEl = document.getElementById('dial-station-name');
      if (stationNameEl !== null) stationNameEl.textContent = primary.name;
      drawSectors(primary.sectors);
    }
    document.querySelectorAll('.dial-group').forEach((node) => node.setAttribute('aria-busy', 'false'));
  };

  const reloadTimer = window.setInterval(() => {
    void loadAvailability();
  }, 15000);

  const refreshTickets = async (): Promise<void> => {
    const outcome = await api<{ bookings: Booking[] }>('GET', '/api/bookings');
    if (outcome.status !== 200 || outcome.body === null) return;
    bookingRefs.clear();
    ticketsList.replaceChildren();
    for (const booking of outcome.body.bookings.slice(0, 12)) {
      bookingRefs.set(booking.id, booking.reference);
      const item = el('li');
      const card = ticketCard(booking);
      if (booking.status === 'held' || booking.status === 'confirmed') {
        const cancel = el('button', 'btn is-quiet mt', 'Cancel booking');
        cancel.addEventListener('click', () => {
          openCancelDialog(booking, () => {
            void refreshTickets();
            void loadAvailability();
          });
        });
        card.append(cancel);
      }
      item.append(card);
      ticketsList.append(item);
    }
  };

  // Pointer drag on the ring
  svg.setAttribute('width', String(SVG_SIZE));
  svg.setAttribute('height', String(SVG_SIZE));
  svg.setAttribute('viewBox', `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <pattern id="hatchSteel" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#d7dcdf" />
      <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa4aa" stroke-width="2" />
    </pattern>
    <pattern id="dotsSteel" width="7" height="7" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill="#ffffff" />
      <circle cx="2" cy="2" r="1.3" fill="#7a8288" />
    </pattern>
    <pattern id="crossHatch" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#e6e9ea" />
      <path d="M0 0 L6 6 M6 0 L0 6" stroke="#9aa4aa" stroke-width="1" />
    </pattern>`;
  svg.append(defs);
  svg.insertAdjacentHTML('beforeend', dialTicks());
  svg.append(sectorsLayer, claimPath);
  const hitRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hitRing.setAttribute('cx', String(SVG_SIZE / 2));
  hitRing.setAttribute('cy', String(SVG_SIZE / 2));
  hitRing.setAttribute('r', '108');
  hitRing.setAttribute('fill', 'none');
  hitRing.setAttribute('stroke', 'transparent');
  hitRing.setAttribute('stroke-width', '26');
  hitRing.setAttribute('class', 'dial-hit');
  svg.append(hitRing);

  const group = el('div', 'dial-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Station dial');
  group.setAttribute('aria-busy', 'false');

  const row = el('div', 'dial-row');
  const svgWrap = el('div', 'dial-svg');
  svgWrap.append(svg);
  row.append(svgWrap);

  const info = el('div', 'dial-info');
  const stationName = el('div', 'station-name');
  stationName.id = 'dial-station-name';
  info.append(stationName, centre);
  const spins = el('div', 'spinbutton-row');
  startSpin.className = 'time-spin';
  startSpin.setAttribute('role', 'spinbutton');
  startSpin.setAttribute('aria-label', 'Start time');
  endSpin.className = 'time-spin';
  endSpin.setAttribute('role', 'spinbutton');
  endSpin.setAttribute('aria-label', 'End time');
  const startLabel = el('label', undefined, 'Start time');
  const endLabel = el('label', undefined, 'End time');
  const startWrap = el('div');
  startWrap.append(startLabel, startSpin);
  const endWrap = el('div');
  endWrap.append(endLabel, endSpin);
  spins.append(startWrap, endWrap);
  info.append(spins);
  const actions = el('div', 'btn-row mt');
  holdBtn.setAttribute('aria-disabled', 'true');
  repeatBtn.setAttribute('aria-disabled', 'true');
  actions.append(holdBtn, repeatBtn);
  const holdActions = el('div', 'btn-row mt');
  holdActions.setAttribute('hidden', '');
  holdActions.append(confirmBtn, releaseBtn);
  info.append(actions, holdActions, holdInfo);
  const legend = el('div', 'dial-legend mt');
  legend.innerHTML = `
    <span class="legend-chip"><span class="legend-swatch legend-satch"></span>Booked</span>
    <span class="legend-chip"><span class="legend-swatch legend-sdots"></span>Sanitation</span>
    <span class="legend-chip"><span class="legend-swatch legend-sgreen"></span>Your booking</span>
    <span class="legend-chip"><span class="legend-swatch legend-snone"></span>Not on the clock</span>
    <span class="legend-chip"><span class="legend-swatch legend-sflame"></span>Your claim</span>`;
  info.append(legend);
  row.append(info);
  group.append(row);
  dialColumn.append(group);

  const pointToMinutes = (event: PointerEvent): number => {
    const rect = svg.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 720) % 360;
    const minutes = Math.round((angle / 0.25) / 15) * 15;
    return ((minutes % 1440) + 1440) % 1440;
  };

  let dragging = false;
  
  svg.addEventListener('pointerdown', (event) => {
    if (busy || holdBooking !== null) return;
    const step = pointToMinutes(event as PointerEvent);
    if (footprintBlocked(step, step + 15, stationsShown[0]?.sectors ?? [])) return;
    dialState.startMin = step;
    dialState.endMin = step;
    dragging = true;
    svg.setPointerCapture((event as PointerEvent).pointerId);
    redrawClaim();
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const minutes = pointToMinutes(event as PointerEvent);
    if (minutes <= dialState.startMin) {
      dialState.endMin = dialState.startMin;
      redrawClaim();
      return;
    }
    let end = minutes;
    const sectors = stationsShown[0]?.sectors ?? [];
    while (end > dialState.startMin && (footprintBlocked(dialState.startMin, end, sectors) || (end - dialState.startMin) / 60 > dialState.available)) {
      end -= 15;
    }
    dialState.endMin = Math.min(end, 1440);
    redrawClaim();
  });
  const finishDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    if (dialState.endMin > dialState.startMin) {
      void placeHold();
    }
  };
  svg.addEventListener('pointerup', finishDrag);
  svg.addEventListener('pointercancel', finishDrag);

  const spinKeys = (isStart: boolean, event: KeyboardEvent): void => {
    if (busy || holdBooking !== null) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const step = (event.shiftKey ? 60 : 15) * (event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1);
    const sectors = stationsShown[0]?.sectors ?? [];
    if (isStart) {
      const newStart = dialState.startMin + step;
      const newEnd = dialState.endMin + step;
      if (newStart < 0 || newEnd > 1440) return;
      if (footprintBlocked(newStart, newEnd, sectors)) return;
      if ((newEnd - newStart) / 60 > dialState.available) return;
      dialState.startMin = newStart;
      dialState.endMin = newEnd;
    } else {
      const newEnd = dialState.endMin + step;
      if (newEnd < dialState.startMin || newEnd > 1440) return;
      if (footprintBlocked(dialState.startMin, newEnd, sectors)) return;
      if ((newEnd - dialState.startMin) / 60 > dialState.available) return;
      dialState.endMin = newEnd;
    }
    redrawClaim();
    event.preventDefault();
  };
  startSpin.addEventListener('keydown', (event) => spinKeys(true, event));
  endSpin.addEventListener('keydown', (event) => spinKeys(false, event));

  let idempotencyKey = '';
  let attemptPending = false;

  const placeHold = async (): Promise<void> => {
    if (attemptPending) return;
    if (idempotencyKey === '') idempotencyKey = randomKey();
    attemptPending = true;
    writeStatus(bookingStatus, `Holding ${minutesToWall(dialState.startMin)}–${minutesToWall(dialState.endMin)}…`);
    const outcome = await api<{ booking: Booking; balances: Balances }>(
      'POST',
      '/api/bookings',
      { station_id: stationsShown[0]?.id ?? '', date: state.date, start: minutesToWall(dialState.startMin), end: minutesToWall(dialState.endMin) },
      { idempotencyKey },
    );
    attemptPending = false;
    if (outcome.status === 201 && outcome.body !== null) {
      idempotencyKey = '';
      holdBooking = outcome.body.booking;
      dialState.available = outcome.body.balances.available_hours;
      const expiry = Date.parse(outcome.body.booking.hold_expires_at ?? '');
      holdInfo.removeAttribute('hidden');
      holdActions.removeAttribute('hidden');
      const tick = (): void => {
        const remaining = expiry - serverNowMs();
        if (remaining <= 0) {
          holdBooking = null;
          holdInfo.setAttribute('hidden', '');
          holdActions.setAttribute('hidden', '');
          writeStatus(bookingStatus, 'Your hold expired and the window was released.');
          void loadAvailability();
          return;
        }
        holdInfo.textContent = `Held · ${reducedMotion ? `${formatMinutesWhole(remaining)} min left` : `${formatMinutesCountdown(remaining)} left`}`;
        countdownTimer = window.setTimeout(tick, reducedMotion ? 60000 : 1000);
      };
      tick();
      const site = siteById(state.siteId);
      void site;
      writeStatus(bookingStatus, `Held ${dialState.stationName} ${minutesToWall(dialState.startMin)}–${minutesToWall(dialState.endMin)}. Confirm before ${minutesToWall(dialState.startMin)} site time.`);
      await refreshTickets();
      confirmBtn.focus();
      return;
    }
    writeStatus(bookingStatus, copyForHoldError(outcome));
    const step = earliestOpenStep(stationsShown[0]?.sectors ?? []);
    dialState.startMin = step;
    dialState.endMin = step;
    redrawClaim();
  };

  holdBtn.addEventListener('click', () => {
    if (dialState.startMin === dialState.endMin) return;
    void placeHold();
  });

  confirmBtn.addEventListener('click', async () => {
    const booking = holdBooking;
    if (booking === null) return;
    writeStatus(bookingStatus, 'Confirming…');
    const outcome = await api<{ booking: Booking; balances: Balances }>('POST', `/api/bookings/${booking.id}/confirm`, {});
    if (outcome.status === 200 && outcome.body !== null) {
      holdBooking = null;
      holdInfo.setAttribute('hidden', '');
      holdActions.setAttribute('hidden', '');
      claimPath.classList.add('is-confirmed');
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      check.setAttribute('d', `M ${SVG_SIZE / 2 - 18} ${SVG_SIZE / 2} L ${SVG_SIZE / 2 - 6} ${SVG_SIZE / 2 + 12} L ${SVG_SIZE / 2 + 20} ${SVG_SIZE / 2 - 16}`);
      check.setAttribute('stroke', 'var(--green)');
      check.setAttribute('stroke-width', '6');
      check.setAttribute('fill', 'none');
      svg.append(check);
      dialState.available = outcome.body.balances.available_hours;
      centre.innerHTML = `<div>✓ Confirmed</div><div class="big numeral" data-pack-hours="${dialState.available}">${formatHoursTwo(dialState.available)}</div><div class="small muted">Pack hours ${formatHoursTwo(dialState.available)}</div>`;
      writeStatus(bookingStatus, `Confirmed ${dialState.stationName} ${state.date} ${minutesToWall(dialState.startMin)}–${minutesToWall(dialState.endMin)}. ${formatHoursTwo(dialState.available)} pack hours left.`);
      await refreshTickets();
      void loadAvailability();
      const ticket = ticketsList.querySelector(`[data-booking-id="${booking.id}"]`) as HTMLElement | null;
      ticket?.focus();
    } else {
      writeStatus(bookingStatus, copyForConfirmError(outcome));
    }
  });

  releaseBtn.addEventListener('click', async () => {
    const booking = holdBooking;
    if (booking === null) return;
    writeStatus(bookingStatus, 'Releasing…');
    const outcome = await api<{ booking: Booking; balances: Balances }>('POST', `/api/bookings/${booking.id}/cancel`, {});
    if (outcome.status === 200 && outcome.body !== null) {
      holdBooking = null;
      holdInfo.setAttribute('hidden', '');
      holdActions.setAttribute('hidden', '');
      dialState.available = outcome.body.balances.available_hours;
      const step = earliestOpenStep(stationsShown[0]?.sectors ?? []);
      dialState.startMin = step;
      dialState.endMin = step;
      redrawClaim();
      writeStatus(bookingStatus, `Hold released. ${formatHoursTwo(outcome.body.balances.available_hours)} pack hours returned.`);
      await refreshTickets();
    }
  });

  repeatBtn.addEventListener('click', () => {
    if (dialState.startMin === dialState.endMin) return;
    openRepeatDialog(stationsShown[0] ?? null, state, dialState);
  });

  siteField.addEventListener('change', () => {
    state.siteId = siteField.value;
    const site = siteById(state.siteId);
    if (site !== null) state.date = nextOpenDate(site);
    dateField.value = state.date;
    void loadAvailability();
  });
  dateField.addEventListener('change', () => {
    if (dateField.value !== '') {
      state.date = dateField.value;
      void loadAvailability();
    }
  });
  prev.addEventListener('click', () => {
    state.date = datePlusDays(state.date, -1);
    dateField.value = state.date;
    void loadAvailability();
  });
  next.addEventListener('click', () => {
    state.date = datePlusDays(state.date, 1);
    dateField.value = state.date;
    void loadAvailability();
  });
  radios.addEventListener('change', () => {
    const checked = radios.querySelector('input:checked') as HTMLInputElement | null;
    state.filter = checked?.value ?? 'all';
    void loadAvailability();
  });

  await refreshTickets();
  await loadAvailability();
}

function sectorAria(kind: string): string {
  switch (kind) {
    case 'booked': return 'Booked';
    case 'buffer': return 'Sanitation';
    case 'own_held': return 'Your hold';
    case 'own_confirmed': return 'Your booking';
    case 'nonexistent': return 'Not on the clock';
  }
  return kind;
}

function copyForHoldError(outcome: ApiOutcome<unknown>): string {
  switch (outcome.error?.code ?? '') {
    case 'slot_taken': return 'Someone else just claimed that window. Your pack hours are unchanged.';
    case 'certificate_expired': return "Your certificate of insurance doesn't cover that date. Upload a current one to book.";
    case 'cutoff': return 'That date is closed for booking. Bookings for tomorrow close at 18:00 site time.';
    case 'hold_limit': return 'You already hold 3 windows. Confirm or release one first.';
    case 'insufficient_hours': return 'Not enough pack hours for this window. Buy a pack to continue.';
    case 'idempotency_in_progress': return 'Your hold is still being placed. Wait a moment.';
    case 'idempotency_conflict': return 'That hold request was already used for another window. Drag the window again.';
    default: return 'Something went wrong. Refresh to see the current state.';
  }
}

function copyForConfirmError(outcome: ApiOutcome<unknown>): string {
  const code = outcome.error?.code ?? '';
  if (code === 'hold_expired') return 'Your hold expired and the window was released.';
  if (code === 'invalid_transition') return 'This booking changed elsewhere. Its ticket now shows the current state.';
  return 'Something went wrong. Refresh to see the current state.';
}

function randomKey(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

function openCancelDialog(booking: Booking, onChanged: () => void): void {
  const backdrop = el('div', 'dialog-backdrop');
  const dialog = el('div', 'dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `Cancel booking ${booking.reference}`);
  dialog.setAttribute('aria-modal', 'true');
  const heading = el('h2', undefined, `Cancel booking ${booking.reference}`);
  const outcome = el('div', 'status-line');
  outcome.setAttribute('role', 'status');
  outcome.setAttribute('aria-live', 'polite');

  const computeOutcome = (): void => {
    const noticeMs = Date.parse(booking.start_at) - serverNowMs();
    if (noticeMs >= 72 * 3600000) {
      writeStatus(outcome, `Cancelling refunds ${formatHoursTwo(booking.hours)} pack hours.`);
    } else if (noticeMs >= 48 * 3600000) {
      const forfeited = Math.ceil((booking.hours * 4) / 2) / 4;
      writeStatus(outcome, `Cancelling now refunds ${formatHoursTwo(booking.hours - forfeited)} pack hours and forfeits ${formatHoursTwo(forfeited)} pack hours.`);
    } else {
      writeStatus(outcome, `Cancelling now forfeits ${formatHoursTwo(booking.hours)} pack hours.`);
    }
  };
  computeOutcome();
  const timer = window.setInterval(computeOutcome, 1000);

  const actions = el('div', 'dialog-actions');
  const confirm = el('button', 'btn is-danger', 'Confirm cancellation');
  const keep = el('button', 'btn', 'Keep booking');
  actions.append(confirm, keep);
  dialog.append(heading, outcome, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  confirm.focus();

  const close = (): void => {
    window.clearInterval(timer);
    backdrop.remove();
  };
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  keep.addEventListener('click', close);
  confirm.addEventListener('click', async () => {
    writeStatus(outcome, 'Cancelling…');
    const response = await api<{ booking: Booking }>('POST', `/api/bookings/${booking.id}/cancel`, {});
    if (response.status === 200) {
      close();
      onChanged();
    } else {
      writeStatus(outcome, 'This booking changed elsewhere. Its ticket now shows the current state.');
      window.setTimeout(() => {
        close();
        onChanged();
      }, 1400);
    }
  });
}

function openRepeatDialog(
  station: { id: string; name: string; kind: string } | null,
  state: { date: string },
  dialState: { startMin: number; endMin: number },
): void {
  if (station === null) return;
  const backdrop = el('div', 'dialog-backdrop');
  const dialog = el('div', 'dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Repeat weekly');
  dialog.setAttribute('aria-modal', 'true');
  const heading = el('h2', undefined, 'Repeat weekly');
  const summary = el('p', undefined, `Every ${weekdayName(state.date)} ${minutesToWall(dialState.startMin)}–${minutesToWall(dialState.endMin)}`);

  const weeksField = el('input');
  weeksField.type = 'number';
  weeksField.min = '2';
  weeksField.max = '12';
  weeksField.value = '4';
  weeksField.id = 'repeat-weeks';
  weeksField.setAttribute('role', 'spinbutton');
  weeksField.setAttribute('aria-label', 'Number of weeks');
  const weeksLabel = el('label', undefined, 'Number of weeks');
  weeksLabel.htmlFor = weeksField.id;

  const occurrences = el('ul', 'list-plain');
  occurrences.setAttribute('aria-label', 'Occurrences');
  const total = el('div', 'status-line');
  total.setAttribute('role', 'status');
  total.setAttribute('aria-live', 'polite');

  const renderPreview = (): void => {
    let weeks = Number(weeksField.value);
    if (!Number.isInteger(weeks)) weeks = 4;
    weeks = Math.min(12, Math.max(2, weeks));
    weeksField.value = String(weeks);
    const lines: string[] = [];
    let totalQh = 0;
    for (let i = 0; i < weeks; i += 1) {
      const date = datePlusDays(state.date, i * 7);
      const hours = (dialState.endMin - dialState.startMin) / 60;
      totalQh += hours * 4;
      lines.push(`${date} ${minutesToWall(dialState.startMin)}–${minutesToWall(dialState.endMin)} · ${formatHoursTwo(hours)} h`);
    }
    occurrences.replaceChildren(...lines.map((line) => el('li', undefined, line)));
    const hours = totalQh / 4;
    const available = currentSession()?.me.member?.available_hours ?? 0;
    if (hours > available) {
      writeStatus(total, `Uses ${formatHoursTwo(hours)} pack hours — Not enough pack hours for ${weeks} weeks.`);
    } else {
      writeStatus(total, `Uses ${formatHoursTwo(hours)} pack hours — Pack hours after this series ${formatHoursTwo(available - hours)}`);
    }
  };
  weeksField.addEventListener('input', renderPreview);
  renderPreview();

  const actions = el('div', 'dialog-actions');
  const book = el('button', 'btn is-solid', 'Book series');
  const close = el('button', 'btn', 'Close');
  actions.append(book, close);
  dialog.append(heading, summary, weeksLabel, weeksField, occurrences, total, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  weeksField.focus();

  const shut = (): void => backdrop.remove();
  close.addEventListener('click', shut);
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      shut();
    }
  });
  book.addEventListener('click', async () => {
    const outcome = await api<{ bookings: Booking[] }>('POST', '/api/recurring-series', {
      station_id: station.id,
      first_date: state.date,
      start: minutesToWall(dialState.startMin),
      end: minutesToWall(dialState.endMin),
      weeks: Number(weeksField.value),
    });
    if (outcome.status === 201) {
      shut();
      void render();
      return;
    }
    const dates = (outcome.error as unknown as { dates?: string[] } | null)?.dates ?? [];
    const line = el('p', 'small mt', dates.length > 0 ? `Some weeks are taken: ${dates.join(', ')}. Nothing was booked.` : 'Nothing was booked. Check your pack hours and certificate.');
    dialog.append(line);
  });
}

// ---------------------------------------------------------------- Packs

async function renderPacks(me: MeBody, main: HTMLElement): Promise<void> {
  const grid = el('div', 'grid cols-12');
  const left = el('div', 'span-8');
  const right = el('div', 'span-4');
  grid.append(left, right);

  const numerals = el('div', 'panel');
  const availableLine = el('div', 'numeral');
  availableLine.classList.add('numeral-hero');
  const committedLine = el('div', 'numeral');
  committedLine.classList.add('numeral-hero');
  numerals.append(availableLine, committedLine);

  const lotsPanel = panel('Pack hours by expiry');
  const lotsList = el('ul', 'list-plain');
  lotsList.setAttribute('aria-label', 'Pack hours by expiry');
  lotsPanel.body.append(lotsList);

  const status = el('div', 'status-line');
  status.id = 'pack-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const ledgerSection = el('section', 'mt');
  ledgerSection.classList.add('grid-full');
  const ledgerHeading = el('h2', undefined, 'Hour ledger');
  const ledger = el('table', 'data');
  ledger.setAttribute('aria-label', 'Hour ledger');
  ledger.innerHTML = '<thead><tr><th>When</th><th>Movement</th><th>Booking</th><th>By</th><th class="num">Available</th><th class="num">Committed</th></tr></thead>';
  const ledgerBody = document.createElement('tbody');
  ledger.append(ledgerBody);
  ledgerSection.append(ledgerHeading, ledger);

  left.append(numerals, lotsPanel.panel);
  right.append(status);
  grid.append(ledgerSection);
  main.append(grid);

  const refresh = async (): Promise<void> => {
    const outcome = await api<{ balances: Balances; movements: LedgerMovement[] }>('GET', '/api/me/ledger');
    if (outcome.status !== 200 || outcome.body === null) return;
    const balances = outcome.body.balances;
    availableLine.textContent = `Available pack hours ${formatHoursTwo(balances.available_hours)}`;
    committedLine.textContent = `Committed pack hours ${formatHoursTwo(balances.committed_hours)}`;
    lotsList.replaceChildren(...balances.lots.map((lot) => {
      const item = el('li');
      if (lot.expiring_soon) {
        const marker = el('span', 'flame-marker');
        marker.setAttribute('role', 'img');
        marker.setAttribute('aria-label', 'Expiring soon');
        item.append(marker);
      }
      const line = el('span', undefined, lot.valid_through === null
        ? `Opening balance: ${formatHoursTwo(lot.hours)} h, no expiry`
        : `${lot.pack_name}: ${formatHoursTwo(lot.hours)} h, valid through ${lot.valid_through}`);
      item.append(line);
      return item;
    }));
    ledgerBody.replaceChildren(...outcome.body.movements.map((movement) => movementRow(movement)));
  };

  const timer = window.setInterval(refresh, 60000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const packsPanel = panel('Packs');
  const packsOutcome = await api<{ packs: Array<{ id: string; name: string; hours: number; price_cents: number }> }>('GET', '/api/packs');
  for (const pack of packsOutcome.body?.packs ?? []) {
    const card = el('div', 'pack-card mt');
    const name = el('h3', undefined, pack.name);
    const hours = el('div', 'numeral', `${formatHoursTwo(pack.hours)} h`);
    const price = el('div', 'price', `$${formatMoney(pack.price_cents)}`);
    const buy = el('button', 'btn', `Buy ${pack.name}`);
    buy.addEventListener('click', () => openBuyDialog(pack, () => { void refresh(); }));
    card.append(name, hours, price, buy);
    packsPanel.body.append(card);
  }
  right.append(packsPanel.panel);

  await refresh();
}

function openBuyDialog(pack: { id: string; name: string; hours: number; price_cents: number }, onChanged: () => void): void {
  const backdrop = el('div', 'dialog-backdrop');
  const dialog = el('div', 'dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `Buy ${pack.name}`);
  dialog.setAttribute('aria-modal', 'true');
  const heading = el('h2', undefined, `Buy ${pack.name}`);
  const detail = el('p', undefined, `${formatHoursTwo(pack.hours)} pack hours for $${formatMoney(pack.price_cents)}`);
  const status = el('div', 'status-line');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = el('div', 'dialog-actions');
  const pay = el('button', 'btn is-solid', 'Pay and add hours');
  const close = el('button', 'btn', 'Close');
  actions.append(pay, close);
  dialog.append(heading, detail, status, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  pay.focus();

  let idempotencyKey = randomKey();
  let pending = false;
  const attempt = async (): Promise<void> => {
    if (pending) return;
    pending = true;
    writeStatus(status, `Charging $${formatMoney(pack.price_cents)}…`);
    const outcome = await api<{ purchase: { valid_through: string }; balances: Balances }>(
      'POST',
      '/api/pack-purchases',
      { pack_id: pack.id },
      { idempotencyKey },
    );
    pending = false;
    if (outcome.status === 201 && outcome.body !== null) {
      idempotencyKey = randomKey();
      backdrop.remove();
      onChanged();
      return;
    }
    const code = outcome.error?.code ?? '';
    if (code === 'billing_unavailable') writeStatus(status, 'Billing is unreachable right now. You have not been charged and no hours were added.');
    else if (code === 'idempotency_in_progress') writeStatus(status, 'Your payment is still being processed. Wait a moment.');
    else if (code === 'idempotency_conflict') writeStatus(status, 'This purchase was already used for a different pack. Close the dialog and try again.');
    else writeStatus(status, 'Something went wrong. Refresh to see the current state.');
  };
  pay.addEventListener('click', () => { void attempt(); });
  close.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      backdrop.remove();
    }
  });
}

// ---------------------------------------------------------------- Documents

async function renderDocuments(me: MeBody, main: HTMLElement): Promise<void> {
  const grid = el('div', 'grid cols-12');
  const left = el('div', 'span-8');
  const right = el('div', 'span-4');
  grid.append(left, right);

  const coveragePanel = panel('Coverage');
  const coverage = el('ul', 'list-plain');
  coverage.setAttribute('aria-label', 'Coverage');
  const types: Array<[string, string | null]> = [
    ['certificate_of_insurance', me.member?.valid_through.certificate_of_insurance ?? null],
    ['food_handler_certificate', me.member?.valid_through.food_handler_certificate ?? null],
    ['business_licence', me.member?.valid_through.business_licence ?? null],
  ];
  for (const [type, validThrough] of types) {
    coverage.append(el('li', undefined, validThrough === null
      ? `${documentTypeLabel(type)}: none on file`
      : `${documentTypeLabel(type)}: valid through ${validThrough}`));
  }
  coveragePanel.body.append(coverage);

  const docsPanel = panel('Your documents');
  const table = el('table', 'data');
  table.setAttribute('aria-label', 'Your documents');
  table.innerHTML = '<thead><tr><th>Type</th><th>Expiry</th><th>Status</th><th>File</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.append(tbody);
  docsPanel.body.append(table);

  const status = el('div', 'status-line');
  status.id = 'document-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const form = el('form');
  const typeField = el('select');
  typeField.id = 'doc-type';
  for (const type of ['certificate_of_insurance', 'food_handler_certificate', 'business_licence']) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = documentTypeLabel(type);
    typeField.append(option);
  }
  const typeLabel = el('label', undefined, 'Document type');
  typeLabel.htmlFor = typeField.id;

  const expiryField = el('input');
  expiryField.type = 'date';
  expiryField.id = 'doc-expiry';
  const expiryLabel = el('label', undefined, 'Expiry date');
  expiryLabel.htmlFor = expiryField.id;

  const coverageLimit = el('input');
  coverageLimit.type = 'number';
  coverageLimit.min = '1000000';
  coverageLimit.id = 'doc-limit';
  const limitLabel = el('label', undefined, 'Coverage per occurrence (USD)');
  limitLabel.htmlFor = coverageLimit.id;

  const insured = el('input');
  insured.type = 'checkbox';
  insured.id = 'doc-insured';
  const insuredLabel = el('label', undefined, `Names ${me.user.tenant.legal_name} as additional insured`);
  insuredLabel.htmlFor = insured.id;

  const fileField = el('input');
  fileField.type = 'file';
  fileField.id = 'doc-file';
  fileField.accept = '.pdf,.png,.jpeg,.jpg';
  const fileLabel = el('label', undefined, 'File');
  fileLabel.htmlFor = fileField.id;
  const hint = el('span', 'small muted', 'PDF, PNG or JPEG, up to 5,000,000 bytes');

  const coiWrap = el('div', 'mt');
  coiWrap.append(limitLabel, coverageLimit, insuredLabel);
  const syncCoi = (): void => {
    if (typeField.value === 'certificate_of_insurance') coiWrap.removeAttribute('hidden'); else coiWrap.setAttribute('hidden', '');
  };
  typeField.addEventListener('change', syncCoi);
  syncCoi();

  const upload = el('button', 'btn is-solid mt', 'Upload document');
  upload.type = 'submit';
  form.append(typeLabel, typeField, expiryLabel, expiryField, coiWrap, fileLabel, fileField, hint, status, upload);

  const formPanel = panel('Upload');
  formPanel.body.append(form);

  left.append(coveragePanel.panel, docsPanel.panel);
  right.append(formPanel.panel);
  main.append(grid);

  const refresh = async (): Promise<void> => {
    const outcome = await api<{ documents: Array<DocumentRecord> }>('GET', '/api/documents');
    if (outcome.status !== 200 || outcome.body === null) return;
    tbody.replaceChildren(...outcome.body.documents.map((doc) => {
      const row = document.createElement('tr');
      const cells = [
        documentTypeLabel(doc.type),
        doc.expiry_date,
        doc.status === 'rejected' ? `Rejected: ${doc.rejection_reason}` : doc.status === 'verified' ? 'Verified' : 'Pending review',
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const fileCell = document.createElement('td');
      const link = el('a', undefined, 'Open');
      link.href = `/api/documents/${doc.id}/file`;
      fileCell.append(link);
      row.append(fileCell);
      return row;
    }));
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    writeStatus(status, 'Uploading…');
    const data = new FormData();
    data.append('type', typeField.value);
    data.append('expiry_date', expiryField.value);
    if (typeField.value === 'certificate_of_insurance') {
      data.append('per_occurrence_limit', coverageLimit.value);
      data.append('names_additional_insured', insured.checked ? 'true' : 'false');
    }
    const file = fileField.files?.[0];
    if (file !== undefined) data.append('file', file);
    const outcome = await api<{ document: DocumentRecord }>('POST', '/api/documents', data);
    if (outcome.status === 201) {
      writeStatus(status, `Uploaded ${documentTypeLabel(typeField.value)}. It is waiting for review.`);
      form.reset();
      syncCoi();
      await refresh();
      return;
    }
    const code = outcome.error?.code ?? '';
    if (code === 'unsupported_type') writeStatus(status, 'Upload a PDF, PNG or JPEG file.');
    else if (code === 'file_too_large') writeStatus(status, 'Files can be at most 5,000,000 bytes.');
    else if (code === 'storage_unavailable') writeStatus(status, 'Document storage is unreachable. Nothing was uploaded; try again shortly.');
    else writeStatus(status, 'Something went wrong. Refresh to see the current state.');
  });

  await refresh();
}

// ---------------------------------------------------------------- Truck log

async function renderTruckLog(me: MeBody, main: HTMLElement): Promise<void> {
  const truck = me.member?.truck ?? null;
  if (truck === null) {
    main.append(el('p', 'muted', 'No truck on file.'));
    return;
  }
  const visitsPanel = panel(`${truck.name} visit log`);
  const overdue = el('div', 'overdue-note mt');
  overdue.setAttribute('hidden', '');
  const table = el('table', 'data');
  table.setAttribute('aria-label', 'Visit log');
  table.innerHTML = '<thead><tr><th>Arrived</th><th>Departed</th><th>Services</th><th>Operator signature</th><th>Manager</th><th>Gap</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.append(tbody);
  visitsPanel.body.append(overdue, table);
  main.append(visitsPanel.panel);

  const refresh = async (): Promise<void> => {
    const outcome = await api<{
      visits: VisitRecord[];
      last_departed_at: string | null;
      overdue: boolean;
    }>('GET', `/api/trucks/${truck.id}/visits`);
    if (outcome.status !== 200 || outcome.body === null) return;
    if (outcome.body.overdue) overdue.removeAttribute('hidden'); else overdue.setAttribute('hidden', '');
    if (outcome.body.overdue && outcome.body.last_departed_at !== null) {
      overdue.textContent = `Overdue: last return ${outcome.body.last_departed_at.slice(0, 10)} ${outcome.body.last_departed_at.slice(11, 16)}`;
    }
    tbody.replaceChildren(...outcome.body.visits.map((visit) => {
      const row = document.createElement('tr');
      const cells = [
        visit.arrived_at.replace('T', ' ').slice(0, 16),
        visit.departed_at === null ? '—' : visit.departed_at.replace('T', ' ').slice(0, 16),
        visit.services.map((service) => serviceLabel(service)).join(', '),
        visit.operator_signature,
        visit.manager_name,
        gapCellText(visit),
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
  };
  const timer = window.setInterval(refresh, 60000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await refresh();
}

// ---------------------------------------------------------------- Site day

async function renderSiteDay(me: MeBody, main: HTMLElement): Promise<void> {
  const sites = await loadSites();
  const site = sites.sites[0] ?? null;
  if (site === null) {
    main.append(el('p', 'muted', 'No site.'));
    return;
  }
  const rail = el('div', 'rail');
  const siteLine = el('div', undefined, `Site: ${site.name}`);
  siteLine.classList.add('site-name');
  const prev = el('button', 'btn', 'Previous day');
  const dateField = el('input');
  dateField.type = 'date';
  dateField.id = 'site-date';
  const dateLabel = el('label', undefined, 'Date');
  dateLabel.htmlFor = dateField.id;
  const dateWrap = el('div', 'field');
  dateWrap.append(dateLabel, dateField);
  const next = el('button', 'btn', 'Next day');
  const timeReadout = el('div', 'site-time mono', `Site time ${site.local_now.slice(11, 16)}`);
  rail.append(siteLine, prev, dateWrap, next, timeReadout);
  main.append(rail);

  const status = el('div', 'status-line mt');
  status.id = 'site-day-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  main.append(status);

  const table = el('table', 'data');
  table.setAttribute('aria-label', 'Bookings');
  table.innerHTML = '<thead><tr><th>Time</th><th>Station</th><th>Member</th><th>Status</th><th>Actions</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.append(tbody);
  main.append(table);

  const state = { date: site.local_date };
  dateField.value = state.date;

  const refresh = async (): Promise<void> => {
    const outcome = await api<{ bookings: Booking[] }>('GET', `/api/sites/${site.id}/bookings?date=${state.date}`);
    if (outcome.status !== 200 || outcome.body === null) return;
    tbody.replaceChildren(...outcome.body.bookings.map((booking) => {
      const row = document.createElement('tr');
      row.dataset.bookingId = booking.id;
      const timeCell = document.createElement('td');
      timeCell.textContent = `${booking.start}–${booking.end}`;
      const stationCell = document.createElement('td');
      stationCell.textContent = booking.station_name;
      const memberCell = document.createElement('td');
      memberCell.textContent = booking.business_name;
      const statusCell = document.createElement('td');
      statusCell.tabIndex = -1;
      if (booking.status === 'checked_out') {
        const lateQh = booking.late_quarter_hours ?? 0;
        statusCell.textContent = lateQh === 0
          ? `On time · by ${booking.checked_out_by?.name ?? ''}`
          : `Late ${formatHoursTwo(lateQh * 0.25)} h · ${formatHoursTwo(booking.pack_hours_applied ?? 0)} pack h · Overage $${formatMoney(booking.overage?.total_cents ?? 0)} · by ${booking.checked_out_by?.name ?? ''}`;
      } else if (booking.status === 'cancelled' && booking.cancelled_by !== null) {
        statusCell.textContent = `Cancelled — Cancelled by ${booking.cancelled_by.name}`;
      } else {
        statusCell.textContent = ticketStatusWord(booking);
      }
      const actionCell = document.createElement('td');
      const wrap = el('div', 'row-stack');
      if (booking.status === 'confirmed') {
        const checkIn = el('button', 'btn', 'Check in');
        const noShow = el('button', 'btn', 'Mark no-show');
        const cancel = el('button', 'btn is-quiet', 'Cancel booking');
        checkIn.addEventListener('click', () => void act(checkIn, `/api/bookings/${booking.id}/check-in`, 'Checking in…', `Checked in ${booking.business_name} on ${booking.station_name}.`, statusCell));
        noShow.addEventListener('click', () => void act(noShow, `/api/bookings/${booking.id}/no-show`, 'Saving…', `Marked ${booking.business_name} as a no-show. ${formatHoursTwo(booking.hours)} pack hours forfeited.`, statusCell));
        cancel.addEventListener('click', () => openManagerCancel(booking, () => { void refresh(); }));
        wrap.append(checkIn, noShow, cancel);
      } else if (booking.status === 'checked_in') {
        const checkOut = el('button', 'btn', 'Check out');
        checkOut.addEventListener('click', () => openCheckOutDialog(booking, () => { void refresh(); }));
        wrap.append(checkOut);
      }
      actionCell.append(wrap);
      row.append(timeCell, stationCell, memberCell, statusCell, actionCell);
      return row;
    }));
  };

  const act = async (
    button: HTMLButtonElement,
    path: string,
    pendingCopy: string,
    successCopy: string,
    statusCell: HTMLElement,
  ): Promise<void> => {
    writeStatus(status, pendingCopy);
    button.setAttribute('aria-disabled', 'true');
    const outcome = await api<Json>('POST', path);
    button.setAttribute('aria-disabled', 'false');
    if (outcome.status === 200) {
      writeStatus(status, successCopy);
      await refresh();
      statusCell.focus();
      return;
    }
    const code = outcome.error?.code ?? '';
    if (code === 'too_early') writeStatus(status, 'Too early to check in. Check-in opens 15 minutes before the start.');
    else if (code === 'too_late') writeStatus(status, 'This booking has ended and can no longer be checked in.');
    else if (code === 'certificate_expired') writeStatus(status, `${''}Their certificate of insurance has expired. They can't use the kitchen until a current one is verified.`);
    else if (code === 'invalid_transition') {
      writeStatus(status, 'This booking changed elsewhere. Its row now shows the current state.');
      await refresh();
      statusCell.focus();
    } else writeStatus(status, 'Something went wrong. Refresh to see the current state.');
  };

  const openManagerCancel = (booking: Booking, onChanged: () => void): void => {
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', `Cancel booking ${booking.reference}`);
    dialog.setAttribute('aria-modal', 'true');
    const heading = el('h2', undefined, `Cancel booking ${booking.reference}`);
    const outcome = el('div', 'status-line');
    outcome.setAttribute('role', 'status');
    outcome.setAttribute('aria-live', 'polite');
    const reason = el('input');
    reason.id = 'cancel-reason';
    const reasonLabel = el('label', undefined, 'Reason');
    reasonLabel.htmlFor = reason.id;
    const timer = window.setInterval(() => {
      const noticeMs = Date.parse(booking.start_at) - serverNowMs();
      if (noticeMs >= 72 * 3600000) {
        writeStatus(outcome, `Cancelling refunds ${formatHoursTwo(booking.hours)} pack hours.`);
      } else if (noticeMs >= 48 * 3600000) {
        const forfeited = Math.ceil((booking.hours * 4) / 2) / 4;
        writeStatus(outcome, `Cancelling now refunds ${formatHoursTwo(booking.hours - forfeited)} pack hours and forfeits ${formatHoursTwo(forfeited)} pack hours.`);
      } else {
        writeStatus(outcome, `Cancelling now forfeits ${formatHoursTwo(booking.hours)} pack hours.`);
      }
    }, 1000);

    const actions = el('div', 'dialog-actions');
    const confirm = el('button', 'btn is-danger', 'Confirm cancellation');
    const keep = el('button', 'btn', 'Keep booking');
    actions.append(confirm, keep);
    dialog.append(heading, outcome, reasonLabel, reason, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    reason.focus();

    const close = (): void => {
      window.clearInterval(timer);
      backdrop.remove();
    };
    keep.addEventListener('click', close);
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    confirm.addEventListener('click', async () => {
      writeStatus(status, 'Cancelling…');
      const response = await api<Json>('POST', `/api/bookings/${booking.id}/cancel`, { reason: reason.value });
      if (response.status === 200) {
        close();
        writeStatus(status, `Cancelled ${booking.reference} for ${booking.business_name}. ${formatHoursTwo(booking.hours)} pack hours refunded.`);
        onChanged();
      } else if (response.error?.code === 'validation') {
        clearFieldError(reason);
        setFieldError(reason, 'Give a reason the member can act on.');
      } else {
        close();
        writeStatus(status, 'This booking changed elsewhere. Its row now shows the current state.');
        onChanged();
      }
    });
  };

  const openCheckOutDialog = (booking: Booking, onChanged: () => void): void => {
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', `Check out ${booking.business_name}`);
    dialog.setAttribute('aria-modal', 'true');
    const heading = el('h2', undefined, `Check out ${booking.business_name}`);
    const lateness = el('p');
    const computeLateness = (): void => {
      const minutes = Math.max(0, Math.floor((serverNowMs() - Date.parse(booking.end_at)) / 60000));
      lateness.textContent = `Booked until ${booking.end}. Late by ${minutes} min.`;
    };
    computeLateness();
    const timer = window.setInterval(computeLateness, 60000);
    const actions = el('div', 'dialog-actions');
    const confirm = el('button', 'btn is-solid', 'Confirm check-out');
    const keep = el('button', 'btn', 'Keep checked in');
    actions.append(confirm, keep);
    dialog.append(heading, lateness, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    confirm.focus();

    let idempotencyKey = randomKey();
    const close = (): void => {
      window.clearInterval(timer);
      backdrop.remove();
    };
    keep.addEventListener('click', close);
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    confirm.addEventListener('click', async () => {
      writeStatus(status, 'Checking out…');
      const response = await api<{ booking: Booking }>('POST', `/api/bookings/${booking.id}/check-out`, undefined, { idempotencyKey });
      if (response.status === 200 && response.body !== null) {
        idempotencyKey = randomKey();
        close();
        const late = response.body.booking.late_quarter_hours ?? 0;
        const overage = response.body.booking.overage?.total_cents ?? 0;
        writeStatus(status, late === 0
          ? `Checked out ${booking.business_name} on time.`
          : `Checked out ${booking.business_name}. Late ${formatHoursTwo(late * 0.25)} h; ${formatHoursTwo(response.body.booking.pack_hours_applied ?? 0)} pack h applied; overage $${formatMoney(overage)}.`);
        onChanged();
      } else if (response.error?.code === 'billing_unavailable') {
        writeStatus(status, 'Billing is unreachable, so this check-out was not recorded. Try again in a moment.');
      } else if (response.error?.code === 'invalid_transition') {
        close();
        writeStatus(status, 'This booking changed elsewhere. Its row now shows the current state.');
        onChanged();
      } else {
        writeStatus(status, 'Something went wrong. Refresh to see the current state.');
      }
    });
  };

  prev.addEventListener('click', () => {
    state.date = datePlusDays(state.date, -1);
    dateField.value = state.date;
    void refresh();
  });
  next.addEventListener('click', () => {
    state.date = datePlusDays(state.date, 1);
    dateField.value = state.date;
    void refresh();
  });
  dateField.addEventListener('change', () => {
    if (dateField.value !== '') {
      state.date = dateField.value;
      void refresh();
    }
  });

  const timer = window.setInterval(refresh, 30000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await refresh();
}

// ---------------------------------------------------------------- Compliance

async function renderCompliance(main: HTMLElement): Promise<void> {
  const status = el('div', 'status-line');
  status.id = 'compliance-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  main.append(status);

  const table = el('table', 'data');
  table.setAttribute('aria-label', 'Documents awaiting review');
  table.innerHTML = '<thead><tr><th>Member</th><th>Type</th><th>Expiry</th><th>Uploaded</th><th>Actions</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.append(tbody);
  main.append(table);

  const refresh = async (): Promise<void> => {
    const outcome = await api<{ documents: Array<DocumentRecord & { business_name: string }> }>('GET', '/api/documents?status=pending');
    if (outcome.status !== 200 || outcome.body === null) return;
    tbody.replaceChildren(...outcome.body.documents.map((doc) => {
      const row = document.createElement('tr');
      const cells = [
        doc.business_name,
        documentTypeLabel(doc.type),
        doc.expiry_date,
        doc.created_at.replace('T', ' ').slice(0, 16),
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const actionCell = document.createElement('td');
      const wrap = el('div', 'row-stack');
      const openLink = el('a', undefined, 'Open file');
      openLink.href = `/api/documents/${doc.id}/file`;
      const verify = el('button', 'btn', 'Verify');
      const reject = el('button', 'btn is-quiet', 'Reject');
      verify.addEventListener('click', async () => {
        writeStatus(status, 'Saving…');
        const response = await api<Json>('POST', `/api/documents/${doc.id}/verify`);
        if (response.status === 200) {
          writeStatus(status, `Verified. ${doc.business_name} is covered.`);
          await refresh();
        } else if (response.error?.code === 'document_expired') {
          writeStatus(status, "This document's expiry date has passed. Reject it instead.");
        } else {
          writeStatus(status, 'This document was already reviewed.');
        }
      });
      reject.addEventListener('click', () => {
        const backdrop = el('div', 'dialog-backdrop');
        const dialog = el('div', 'dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', 'Reject document');
        dialog.setAttribute('aria-modal', 'true');
        const heading = el('h2', undefined, 'Reject document');
        const reason = el('input');
        reason.id = 'reject-reason';
        const reasonLabel = el('label', undefined, 'Reason');
        reasonLabel.htmlFor = reason.id;
        const actions = el('div', 'dialog-actions');
        const confirm = el('button', 'btn is-danger', 'Reject document');
        const close = el('button', 'btn', 'Close');
        actions.append(confirm, close);
        dialog.append(heading, reasonLabel, reason, actions);
        backdrop.append(dialog);
        document.body.append(backdrop);
        reason.focus();
        close.addEventListener('click', () => backdrop.remove());
        backdrop.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            backdrop.remove();
          }
        });
        confirm.addEventListener('click', async () => {
          writeStatus(status, 'Saving…');
          const response = await api<Json>('POST', `/api/documents/${doc.id}/reject`, { reason: reason.value });
          if (response.status === 200) {
            backdrop.remove();
            writeStatus(status, `Rejected ${documentTypeLabel(doc.type)} for ${doc.business_name}.`);
            await refresh();
          } else {
            clearFieldError(reason);
            setFieldError(reason, 'Give a reason the member can act on.');
          }
        });
      });
      wrap.append(openLink, verify, reject);
      actionCell.append(wrap);
      row.append(actionCell);
      return row;
    }));
  };
  await refresh();
}

// ---------------------------------------------------------------- Trucks

async function renderTrucks(main: HTMLElement): Promise<void> {
  const grid = el('div', 'grid cols-12');
  const left = el('div', 'span-8');
  const right = el('div', 'span-4');
  grid.append(left, right);
  main.append(grid);

  const status = el('div', 'status-line');
  status.id = 'visit-log-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const findPanel = panel('Find a member');
  const findField = el('input');
  findField.id = 'find-member';
  findField.setAttribute('aria-label', 'Find a member');
  const matches = el('ul', 'list-plain mt');
  let truck: { id: string; name: string; permit_number?: string } | null = null;
  let memberChoices: Array<{ id: string; business_name: string; truck: { id: string; name: string } | null }> = [];

  const refreshMatches = async (): Promise<void> => {
    const query = findField.value;
    if (query.length < 2) {
      matches.replaceChildren();
      return;
    }
    const outcome = await api<{ members: Array<{ id: string; business_name: string; truck: { id: string; name: string } | null }> }>('GET', `/api/members?q=${encodeURIComponent(query)}`);
    memberChoices = outcome.body?.members ?? [];
    matches.replaceChildren(...memberChoices.map((member) => {
      const item = el('li');
      const button = el('button', 'btn is-quiet', member.business_name);
      button.addEventListener('click', () => {
        truck = member.truck;
        findPanel.body.querySelector('output')?.remove();
        const chosen = el('output', undefined, `Truck: ${member.truck?.name ?? 'none'}`);
        findPanel.body.append(chosen);
        void refreshVisits();
      });
      item.append(button);
      return item;
    }));
  };
  findField.addEventListener('input', () => { void refreshMatches(); });
  findPanel.body.append(findField, matches);
  right.append(findPanel.panel, status);

  const visitsPanel = panel('Visit log');
  const overdue = el('div', 'overdue-note mt');
  overdue.setAttribute('hidden', '');
  const visitsTable = el('table', 'data');
  visitsTable.setAttribute('aria-label', 'Visit log');
  visitsTable.innerHTML = '<thead><tr><th>Arrived</th><th>Departed</th><th>Services</th><th>Operator signature</th><th>Manager</th><th>Gap</th></tr></thead>';
  const visitsBody = document.createElement('tbody');
  visitsTable.append(visitsBody);
  visitsPanel.body.append(overdue, visitsTable);

  const actions = el('div', 'btn-row mt');
  const arrive = el('button', 'btn', 'Truck arrived');
  const depart = el('button', 'btn', 'Truck departed');
  actions.append(arrive, depart);
  visitsPanel.body.append(actions);

  const linksPanel = panel('Inspector access');
  const emailField = el('input');
  emailField.id = 'inspector-email';
  emailField.placeholder = 'inspector@county.example';
  const emailLabel = el('label', undefined, 'Inspector email');
  emailLabel.htmlFor = emailField.id;
  const issue = el('button', 'btn mt', 'Issue inspector link');
  const linksList = el('ul', 'list-plain mt');
  linksList.setAttribute('aria-label', 'Inspector links');
  linksPanel.body.append(emailLabel, emailField, issue, linksList);

  const refreshVisits = async (): Promise<void> => {
    if (truck === null) return;
    const outcome = await api<{
      truck: { id: string; name: string; permit_number: string };
      visits: VisitRecord[];
      last_departed_at: string | null;
      overdue: boolean;
    }>('GET', `/api/trucks/${truck.id}/visits`);
    if (outcome.status !== 200 || outcome.body === null) return;
    truck = outcome.body.truck;
    if (outcome.body.overdue) overdue.removeAttribute('hidden'); else overdue.setAttribute('hidden', '');
    if (outcome.body.overdue && outcome.body.last_departed_at !== null) {
      overdue.textContent = `Overdue: last return ${outcome.body.last_departed_at.slice(0, 10)} ${outcome.body.last_departed_at.slice(11, 16)}`;
    }
    visitsBody.replaceChildren(...outcome.body.visits.map((visit) => {
      const row = document.createElement('tr');
      const cells = [
        visit.arrived_at.replace('T', ' ').slice(0, 16),
        visit.departed_at === null ? '—' : visit.departed_at.replace('T', ' ').slice(0, 16),
        visit.services.map((service) => serviceLabel(service)).join(', '),
        visit.operator_signature,
        visit.manager_name,
        gapCellText(visit),
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    const open = outcome.body.visits.find((visit) => visit.departed_at === null);
    if (open === undefined) arrive.removeAttribute('hidden'); else arrive.setAttribute('hidden', '');
    if (open === undefined) depart.setAttribute('hidden', ''); else depart.removeAttribute('hidden');
    const linksOutcome = await api<{ links: Array<{ id: string; inspector_email: string; url: string; expires_at: string; state: string }> }>('GET', `/api/trucks/${truck.id}/inspector-links`);
    linksList.replaceChildren(...(linksOutcome.body?.links ?? []).map((link) => {
      const item = el('li');
      const line = el('span', undefined, `${link.inspector_email} · ${link.expires_at.replace('T', ' ').slice(0, 16)} · ${link.state}`);
      item.append(line);
      if (link.state === 'live') {
        const revoke = el('button', 'btn is-quiet small', 'Revoke');
        const reissue = el('button', 'btn is-quiet small', 'Reissue');
        revoke.addEventListener('click', async () => {
          writeStatus(status, 'Revoking…');
          const response = await api<Json>('POST', `/api/inspector-links/${link.id}/revoke`);
          writeStatus(status, response.status === 200 ? 'Link revoked. It stops working now.' : 'This link is no longer live.');
          void refreshVisits();
        });
        reissue.addEventListener('click', async () => {
          writeStatus(status, 'Reissuing…');
          const response = await api<Json>('POST', `/api/inspector-links/${link.id}/reissue`);
          writeStatus(status, response.status === 201 ? `New link sent to ${link.inspector_email}. The old link no longer works.` : 'This link is no longer live.');
          void refreshVisits();
        });
        item.append(revoke, reissue);
      }
      return item;
    }));
  };

  arrive.addEventListener('click', async () => {
    if (truck === null) return;
    writeStatus(status, 'Saving…');
    const response = await api<Json>('POST', `/api/trucks/${truck.id}/visits`, {});
    if (response.status === 201) {
      writeStatus(status, 'Truck arrived.');
      await refreshVisits();
    } else {
      writeStatus(status, 'This truck is already checked in. Record its departure first.');
    }
  });

  depart.addEventListener('click', () => {
    if (truck === null) return;
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Record departure');
    dialog.setAttribute('aria-modal', 'true');
    const heading = el('h2', undefined, 'Record departure');
    const servicesGroup = el('fieldset', 'mt');
    servicesGroup.setAttribute('role', 'group');
    servicesGroup.setAttribute('aria-label', 'Services');
    for (const service of ['potable_water', 'grey_water', 'grease', 'food_storage', 'cleaning', 'restock']) {
      const check = el('input');
      check.type = 'checkbox';
      check.id = `svc-${service}`;
      const label = el('label', undefined, serviceLabel(service));
      label.htmlFor = check.id;
      const wrap = el('div');
      wrap.append(check, label);
      servicesGroup.append(wrap);
    }
    const signature = el('input');
    signature.id = 'operator-signature';
    const signatureLabel = el('label', undefined, 'Operator signature');
    signatureLabel.htmlFor = signature.id;
    const actions = el('div', 'dialog-actions');
    const save = el('button', 'btn is-solid', 'Save departure');
    const close = el('button', 'btn', 'Close');
    actions.append(save, close);
    dialog.append(heading, servicesGroup, signatureLabel, signature, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    signature.focus();
    close.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        backdrop.remove();
      }
    });
    save.addEventListener('click', async () => {
      if (truck === null) return;
      const chosen: string[] = [];
      servicesGroup.querySelectorAll('input:checked').forEach((input) => chosen.push((input as HTMLInputElement).id.replace('svc-', '')));
      writeStatus(status, 'Saving…');
      const openOutcome = await api<{ visits: VisitRecord[] }>('GET', `/api/trucks/${truck.id}/visits`);
      const openVisit = openOutcome.body?.visits.find((visit) => visit.departed_at === null);
      if (openVisit === undefined) return;
      const result = await api<Json>('POST', `/api/visits/${openVisit.id}/depart`, { services: chosen, operator_signature: signature.value });
      if (result.status === 200) {
        backdrop.remove();
        writeStatus(status, 'Departure recorded.');
        await refreshVisits();
      } else {
        const fields = result.error?.fields ?? {};
        if (fields.services !== undefined) {
          writeStatus(status, 'Choose at least one service.');
        } else if (fields.operator_signature !== undefined) {
          writeStatus(status, "Type the operator's name to sign.");
        }
      }
    });
  });

  issue.addEventListener('click', async () => {
    if (truck === null) return;
    writeStatus(status, 'Issuing link…');
    const response = await api<Json>('POST', `/api/trucks/${truck.id}/inspector-links`, { inspector_email: emailField.value });
    if (response.status === 201) {
      writeStatus(status, `Link sent to ${emailField.value}.`);
      await refreshVisits();
    } else if (response.error?.code === 'storage_unavailable') {
      writeStatus(status, 'Document storage is unreachable, so no link was issued.');
    } else {
      writeStatus(status, 'Enter a valid email address.');
    }
  });

  left.append(visitsPanel.panel, linksPanel.panel);

  const timer = window.setInterval(refreshVisits, 60000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------- Rates

async function renderRates(main: HTMLElement): Promise<void> {
  const rail = el('div', 'rail');
  const siteField = el('select');
  siteField.id = 'rates-site';
  siteField.setAttribute('aria-label', 'Site');
  const sites = await loadSites();
  for (const site of sites.sites) {
    const option = document.createElement('option');
    option.value = site.id;
    option.textContent = site.name;
    siteField.append(option);
  }
  const siteWrap = el('div', 'field');
  const siteLabel = el('label', undefined, 'Site');
  siteLabel.htmlFor = siteField.id;
  siteWrap.append(siteLabel, siteField);
  rail.append(siteWrap);
  main.append(rail);

  const status = el('div', 'status-line');
  status.id = 'rates-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  main.append(status);

  const grid = el('div', 'grid cols-12 mt');
  const left = el('div', 'span-8');
  const right = el('div', 'span-4');
  grid.append(left, right);
  main.append(grid);

  const schedulePanel = panel('Rate schedule');
  const table = el('table', 'data');
  table.setAttribute('aria-label', 'Rate schedule');
  table.innerHTML = '<thead><tr><th>Effective from</th><th class="num">Hourly rate</th><th>Sales tax</th><th>State</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.append(tbody);
  schedulePanel.body.append(table);

  const formPanel = panel('Schedule rate');
  const effectiveField = el('input');
  effectiveField.type = 'date';
  effectiveField.id = 'rate-effective';
  const effectiveLabel = el('label', undefined, 'Effective from');
  effectiveLabel.htmlFor = effectiveField.id;
  const rateField = el('input');
  rateField.type = 'text';
  rateField.id = 'rate-amount';
  const rateLabel = el('label', undefined, 'Hourly rate (USD)');
  rateLabel.htmlFor = rateField.id;
  const taxField = el('input');
  taxField.type = 'text';
  taxField.id = 'rate-tax';
  const taxLabel = el('label', undefined, 'Sales tax (%)');
  taxLabel.htmlFor = taxField.id;
  const submit = el('button', 'btn is-solid mt', 'Schedule rate');
  formPanel.body.append(effectiveLabel, effectiveField, rateLabel, rateField, taxLabel, taxField, submit);

  left.append(schedulePanel.panel);
  right.append(formPanel.panel);

  let requestSeq = 0;
  let chosenSite = sites.sites[0]?.id ?? '';

  const refreshSchedule = async (): Promise<void> => {
    const seq = ++requestSeq;
    const outcome = await api<{ rates: Array<{ id: string; effective_from: string; hourly_rate_cents: number; tax_rate_percent: string; state: string }> }>('GET', `/api/sites/${chosenSite}/rates`);
    if (seq !== requestSeq) return;
    if (outcome.status !== 200 || outcome.body === null) return;
    tbody.replaceChildren(...outcome.body.rates.map((rate) => {
      const row = document.createElement('tr');
      const cells = [rate.effective_from, `$${formatMoney(rate.hourly_rate_cents)}`, `${rate.tax_rate_percent}%`, rate.state[0].toUpperCase() + rate.state.slice(1)];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    const site = siteById(chosenSite);
    if (site !== null) effectiveField.value = datePlusDays(site.local_date, 1);
  };

  siteField.addEventListener('change', () => {
    chosenSite = siteField.value;
    void refreshSchedule();
  });

  for (const field of [effectiveField, rateField, taxField]) {
    field.addEventListener('input', () => clearFieldError(field));
  }

  submit.addEventListener('click', async () => {
    writeStatus(status, 'Saving…');
    const cents = Math.round(Number(rateField.value) * 100);
    const response = await api<Json>('POST', `/api/sites/${chosenSite}/rates`, {
      effective_from: effectiveField.value,
      hourly_rate_cents: cents,
      tax_rate_percent: taxField.value,
    });
    if (response.status === 201) {
      writeStatus(status, `Rate scheduled from ${effectiveField.value}.`);
      await refreshSchedule();
      return;
    }
    const fields = response.error?.fields ?? {};
    if (response.error?.code === 'rate_exists') {
      writeStatus(status, `A rate already starts on ${effectiveField.value}.`);
      clearFieldError(effectiveField);
      setFieldError(effectiveField, `A rate already starts on ${effectiveField.value}.`);
      return;
    }
    if (fields.effective_from !== undefined) {
      clearFieldError(effectiveField);
      setFieldError(effectiveField, fields.effective_from);
      writeStatus(status, 'The effective date must be after today in site time.');
    } else if (fields.hourly_rate_cents !== undefined) {
      clearFieldError(rateField);
      setFieldError(rateField, fields.hourly_rate_cents);
      writeStatus(status, 'Enter an hourly rate between $0.01 and $1,000.00.');
    } else if (fields.tax_rate_percent !== undefined) {
      clearFieldError(taxField);
      setFieldError(taxField, fields.tax_rate_percent);
      writeStatus(status, 'Enter a tax rate between 0 and 25 percent with up to three decimals.');
    }
  });

  await refreshSchedule();
}

// ---------------------------------------------------------------- Reports

async function renderReports(main: HTMLElement): Promise<void> {
  const url = new URL(window.location.href);
  const month = url.searchParams.get('month') ?? '';
  const memberId = url.searchParams.get('member') ?? '';

  const grid = el('div', 'grid cols-12');
  const left = el('div', 'span-8');
  const right = el('div', 'span-4');
  grid.append(left, right);
  main.append(grid);

  const form = el('form');
  const monthField = el('input');
  monthField.id = 'report-month';
  monthField.placeholder = 'YYYY-MM';
  monthField.value = month;
  const monthLabel = el('label', undefined, 'Month');
  monthLabel.htmlFor = monthField.id;
  const memberField = el('input');
  memberField.id = 'report-member';
  memberField.placeholder = 'Optional member filter';
  const memberLabel = el('label', undefined, 'Member');
  memberLabel.htmlFor = memberField.id;
  const memberChoices = el('ul', 'list-plain');
  const show = el('button', 'btn is-solid mt', 'Show report');
  show.type = 'submit';
  form.append(monthLabel, monthField, memberLabel, memberField, memberChoices, show);

  const status = el('div', 'status-line');
  status.id = 'report-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const table = el('table', 'data');
  table.setAttribute('aria-label', 'Utilisation by site');
  table.innerHTML = '<thead><tr><th>Site</th><th class="num">Scheduled hours</th><th class="num">Used hours</th><th class="num">Forfeited hours</th><th class="num">Overage</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.append(tbody);

  const csvLink = el('a', 'btn mt', 'Download CSV');

  const panelTable = panel('Utilisation by site');
  panelTable.body.append(table, csvLink);
  left.append(panelTable.panel);
  right.append(el('h3', undefined, 'Filter'), form, status);

  let loadSeq = 0;
  let chosenMember = memberId;

  const loadReport = async (targetMonth: string, targetMember: string): Promise<void> => {
    const seq = ++loadSeq;
    if (targetMonth === '') {
      tbody.replaceChildren();
      writeStatus(status, '');
      return;
    }
    writeStatus(status, 'Loading report…');
    const query = new URLSearchParams({ month: targetMonth });
    if (targetMember !== '') query.set('member_id', targetMember);
    const outcome = await api<{
      month: string;
      member: { id: string; business_name: string } | null;
      sites: Array<{ site_id: string; site_name: string; scheduled_hours: number; used_hours: number; forfeited_hours: number; overage_cents: number }>;
      totals: { scheduled_hours: number; used_hours: number; forfeited_hours: number; overage_cents: number };
    }>('GET', `/api/reports/utilisation?${query.toString()}`);
    if (seq !== loadSeq) return;
    if (outcome.status !== 200 || outcome.body === null) {
      writeStatus(status, 'That member isn\'t in your incubator.');
      tbody.replaceChildren();
      csvLink.href = `/api/reports/utilisation.csv?month=${targetMonth}`;
      return;
    }
    writeStatus(status, `Showing ${outcome.body.month}.`);
    memberField.value = outcome.body.member?.business_name ?? '';
    chosenMember = outcome.body.member?.id ?? '';
    const rows = outcome.body.sites.map((site) => {
      const row = document.createElement('tr');
      const cells = [
        site.site_name,
        formatHoursTwo(site.scheduled_hours),
        formatHoursTwo(site.used_hours),
        formatHoursTwo(site.forfeited_hours),
        `$${formatMoney(site.overage_cents)}`,
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    });
    const total = document.createElement('tr');
    total.className = 'total';
    for (const value of ['Total', formatHoursTwo(outcome.body.totals.scheduled_hours), formatHoursTwo(outcome.body.totals.used_hours), formatHoursTwo(outcome.body.totals.forfeited_hours), `$${formatMoney(outcome.body.totals.overage_cents)}`]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      total.append(cell);
    }
    rows.push(total);
    tbody.replaceChildren(...rows);
    const csvQuery = new URLSearchParams({ month: targetMonth });
    if (chosenMember !== '') csvQuery.set('member_id', chosenMember);
    csvLink.href = `/api/reports/utilisation.csv?${csvQuery.toString()}`;
  };

  memberField.addEventListener('input', async () => {
    const query = memberField.value;
    if (query.length < 2) {
      memberChoices.replaceChildren();
      return;
    }
    const outcome = await api<{ members: Array<{ id: string; business_name: string }> }>('GET', `/api/members?q=${encodeURIComponent(query)}`);
    memberChoices.replaceChildren(...(outcome.body?.members ?? []).map((member) => {
      const item = el('li');
      const button = el('button', 'btn is-quiet small', member.business_name);
      button.addEventListener('click', () => {
        memberField.value = member.business_name;
        chosenMember = member.id;
        memberChoices.replaceChildren();
      });
      item.append(button);
      return item;
    }));
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = new URLSearchParams();
    if (monthField.value !== '') query.set('month', monthField.value);
    if (chosenMember !== '') query.set('member', chosenMember);
    const address = `/reports?${query.toString()}`;
    window.history.pushState({}, '', address);
    void loadReport(monthField.value, chosenMember);
  });

  await loadReport(month, memberId);
}

// ---------------------------------------------------------------- Inspector

async function renderInspect(token: string): Promise<void> {
  root.replaceChildren();
  const wrap = el('div', 'inspect-wrap content');
  const header = el('header', 'app-header');
  const brand = el('span', 'brand', 'Pilotlight');
  header.append(brand);
  root.append(header, wrap);

  const drawDead = (heading: string): void => {
    wrap.replaceChildren(el('h1', undefined, heading));
  };

  const refresh = async (): Promise<void> => {
    const outcome = await api<{
      truck: { name: string; permit_number: string };
      operator: { business_name: string };
      commissary: { site_name: string; address: string; time_zone: string };
      expires_at: string;
      overdue: boolean;
      last_departed_at: string | null;
      visits: Array<{ arrived_at: string; departed_at: string | null; services: string[]; operator_signature: string; manager_name: string; gap_hours: number | null; gap_flagged: boolean }>;
    }>('GET', `/api/inspect/${token}`);
    if (outcome.status === 404) {
      drawDead('Link not found');
      return;
    }
    if (outcome.status === 410) {
      drawDead(outcome.error?.code === 'link_revoked' ? 'This link was revoked' : 'This link has expired');
      return;
    }
    if (outcome.status !== 200 || outcome.body === null) {
      drawDead('Link not found');
      return;
    }
    const data = outcome.body;
    wrap.replaceChildren();
    const grid = el('div', 'grid cols-12');
    const head = el('div', 'span-8');
    const side = el('div', 'span-4');
    const heading = el('h1', undefined, `${data.truck.name} commissary visits`);
    const commissary = el('p', undefined, `Commissary: ${data.commissary.site_name}, ${data.commissary.address}`);
    const operator = el('p', undefined, `Operator: ${data.operator.business_name}`);
    head.append(heading, commissary, operator);
    const overdue = el('div', 'overdue-note');
    if (data.overdue) overdue.removeAttribute('hidden'); else overdue.setAttribute('hidden', '');
    if (data.overdue && data.last_departed_at !== null) {
      overdue.textContent = `Overdue: last return ${data.last_departed_at.slice(0, 10)} ${data.last_departed_at.slice(11, 16)}`;
    }
    const pdf = el('a', 'btn', 'Download PDF');
    pdf.href = `/api/inspect/${token}/log.pdf`;
    
    
    
    
    
    side.append(overdue, pdf);
    grid.append(head, side);
    const table = el('table', 'data mt');
    table.setAttribute('aria-label', 'Commissary visits');
    table.innerHTML = '<thead><tr><th>Arrived</th><th>Departed</th><th>Services</th><th>Operator signature</th><th>Manager</th><th>Gap</th></tr></thead>';
    const tbody = document.createElement('tbody');
    table.append(tbody);
    for (const visit of data.visits) {
      const row = document.createElement('tr');
      const cells = [
        visit.arrived_at,
        visit.departed_at ?? '—',
        visit.services.join(', '),
        visit.operator_signature,
        visit.manager_name,
        visit.gap_hours === null ? '—' : visit.gap_flagged ? `Gap ${formatHoursTwo(visit.gap_hours)} h — over 24 hours` : `${formatHoursTwo(visit.gap_hours)} h`,
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      tbody.append(row);
    }
    wrap.append(grid, table);
  };

  const timer = window.setInterval(refresh, 60000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await refresh();
}

// ---------------------------------------------------------------- router

async function render(): Promise<void> {
  const path = currentPath();
  if (path.startsWith('/inspect/')) {
    const token = path.slice('/inspect/'.length);
    await renderInspect(token);
    return;
  }

  const session = currentSession() ?? await loadSession();
  if (session === null) {
    renderSignIn(false);
    return;
  }

  const main = el('main');
  renderShell(session.me, main);
  const me = session.me;

  if (path === '/book' && me.user.role === 'member') await renderBook(me, main);
  else if (path === '/packs' && me.user.role === 'member') await renderPacks(me, main);
  else if (path === '/documents' && me.user.role === 'member') await renderDocuments(me, main);
  else if (path === '/truck' && me.user.role === 'member' && me.member?.truck !== null) await renderTruckLog(me, main);
  else if (path === '/site' && me.user.role === 'kitchen_manager') await renderSiteDay(me, main);
  else if (path === '/compliance' && me.user.role === 'kitchen_manager') await renderCompliance(main);
  else if (path === '/trucks' && me.user.role === 'kitchen_manager') await renderTrucks(main);
  else if (path === '/rates' && me.user.role === 'finance_lead') await renderRates(main);
  else if (path === '/reports' && me.user.role === 'finance_lead') await renderReports(main);
  else navigate(roleHome(me.user.role), true);
}

void render();
