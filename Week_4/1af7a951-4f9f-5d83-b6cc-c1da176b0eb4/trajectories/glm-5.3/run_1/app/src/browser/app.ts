// The browser app: routing, screens and interactions. The server publishes
// every value the screens show; the browser renders what it receives.

import { api, el, clear, formatMoney, seatsCopy, phaseLabel, rosterNight, addDays, uuid, trapFocus, type SessionInfo, type NightInfo, type EntryInfo, type CohortInfo, type EnrolmentInfo, type RosterRowInfo, type ConstellationInfo, type ApiErrorBody } from './api.js';
import { loadKept, saveKept, loadMemos, saveMemos, loadRememberedId, rememberId, clearRememberedId, pendingSignOut, setPendingSignOut, newKeptEntry, type KeptEntry, type KeptMemo } from './device.js';
import { Dreamscape, CATEGORY_LABELS, reducedMotionWanted } from './dreamscape.js';

const app = document.getElementById('app') as HTMLElement;

// ---------------- copy ----------------

const COPY = {
  offline: "You're offline. New entries are kept on this device until you reconnect.",
  emptyNight: 'No dreams logged for this night yet. Write down whatever you remember, even a single image.',
  windowOpen: 'Morning capture window open until 14:00.',
  windowClosed: 'Capture window closed. New entries are marked late recall.',
  beforeNight1: (first: string) => `Your first night is ${first}.`,
  techniqueLocked: 'Technique practice unlocks on night 8.',
  noSelection: 'Select a phrase in this entry first.',
  overlap: 'That phrase overlaps a sign you already tagged.',
  refused: "That sign wasn't saved. Try again.",
  syncLine: (saved: number, kept: number) => `Synced: ${saved}. Kept on this device: ${kept}.`,
  keptLabel: 'Kept on this device',
  savedLabel: 'Saved',
  lateBadge: 'Late recall',
  notSaved: (reason: string) => `Not saved: ${reason}`,
  idConflict: 'This entry conflicts with one already saved.',
  cohortNotOpen: 'This cohort is not open for entries.',
  signResult: (cat: string, n: number) => `${cat} signs: ${n}.`,
  drillDone: (n: number) => `Reality check logged. Checks this night: ${n}.`,
  drillNoTarget: 'Tag a dream sign first to set your drill target.',
  settingsSaved: 'Night settings saved. They apply to new entries.',
  settingsHeld: (n: number) => `Night settings saved. You're still on night ${n} until your next bedtime.`,
  shared: 'Shared with your coach.',
  unshared: 'No longer shared.',
  notFoundTitle: 'Page not found',
  notFoundBody: "We couldn't find that page.",
  cohortNotFoundTitle: 'Cohort not found',
  cohortNotFoundBody: "We couldn't find that cohort.",
  pendingHint: 'Your seat is not reserved until payment is confirmed.',
  payPending: 'Confirming payment with the billing provider.',
  payOutage: 'Payments are unreachable right now. Your seat is not reserved and you have not been charged.',
  payDeclined: 'Your payment was declined. Your seat is not reserved.',
  payFull: 'This cohort just filled up. You have not been charged.',
  enrolledLine: (email: string) => `A receipt is on its way to ${email}.`,
  firstNightLine: (first: string, bedtime: string, alarm: string) => `Your first night: ${first} – bedtime ${bedtime}, wake alarm ${alarm}.`,
  invalidCode: "That access code didn't work.",
  pendingCode: 'This enrollment is waiting for payment.',
  refundedCode: 'This seat was refunded, so this code no longer opens a logbook.',
  offlineSignin: "You're offline. Connect to the internet to sign in.",
  enrollClosed: 'Enrollment for this cohort is closed.',
  alreadyEnrolled: 'You already have a seat request for this cohort.',
  cohortUnavailable: "That cohort isn't available.",
  cohortCreated: 'Cohort created as a draft.',
  nameTaken: 'You already have a cohort with that name.',
  published: 'Cohort published.',
  closedCohort: 'Cohort closed.',
  illegalPhase: "That change isn't allowed in this phase.",
  digestPending: 'Sending digest.',
  digestSent: (email: string) => `Digest sent to ${email}.`,
  digestReplay: (email: string) => `This week's digest was already sent to ${email}.`,
  mailOutage: 'Mail is unreachable. The digest was not sent.',
  refunded: (name: string) => `Refunded ${name}.`,
  refundWindow: 'Refunds close when the technique weeks start.',
  refundComped: 'This seat was not paid through checkout.',
  refundBilling: 'Billing is unreachable. No refund was made.',
  refundAgain: 'That seat was already refunded.',
  withdrawn: 'That entry is no longer shared.',
  uploadMemo: 'Uploading voice memo.',
  memoSaved: 'Voice memo saved.',
  memoKept: 'Voice memo kept on this device. It will upload when storage is back.',
  memoExists: 'This entry already has a different voice memo.',
  memoFailed: 'Voice memo unavailable right now.',
  priceMessage: 'Enter a dollar amount with at most two decimals.',
} as const;

// ---------------- router ----------------

let sessionInfo: SessionInfo | null = null;
let zonesCache: string[] | null = null;

function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  void render();
}

window.addEventListener('popstate', () => void render());

export async function boot(): Promise<void> {
  if (pendingSignOut()) {
    await api('/api/session', { method: 'DELETE' }).catch(() => undefined);
    setPendingSignOut(false);
  }
  void render();
}


async function zones(): Promise<string[]> {
  if (zonesCache !== null) return zonesCache;
  const res = await api<{ zones: string[] }>('/api/time-zones');
  zonesCache = res.body.zones ?? [];
  return zonesCache;
}

async function ensureSession(): Promise<SessionInfo | null> {
  if (sessionInfo !== null) return sessionInfo;
  const res = await api<SessionInfo>('/api/session');
  if (res.ok) {
    sessionInfo = res.body;
    rememberId(res.body.id);
    return sessionInfo;
  }
  return null;
}

async function render(): Promise<void> {
  const path = location.pathname;
  const params = new URLSearchParams(location.search);
  clear(app);

  if (path === '/' || path === '/index.html') {
    await renderCohorts();
    return;
  }
  if (path === '/signin') {
    await renderSignIn(params.get('next'));
    return;
  }
  if (path === '/logbook') {
    const s = await ensureSession();
    if (s === null || s.role !== 'dreamer') {
      navigate(`/signin?next=${encodeURIComponent(path)}`, true);
      return;
    }
    await renderLogbook();
    return;
  }
  if (path === '/coach') {
    const s = await ensureSession();
    if (s === null || s.role !== 'coach') {
      navigate(`/signin?next=${encodeURIComponent(path + location.search)}`, true);
      return;
    }
    await renderCoach(params.get('cohort'));
    return;
  }
  if (path.startsWith('/enroll/')) {
    await renderEnroll(path.slice('/enroll/'.length));
    return;
  }
  if (path.startsWith('/enrollments/')) {
    await renderEnrolment(path.slice('/enrollments/'.length));
    return;
  }
  renderNotFound();
}

// ---------------- shared layout ----------------

function header(signedIn: SessionInfo | null): HTMLElement {
  const nav = el('header', { class: 'top' },
    el('a', { class: 'wordmark', href: '/', 'aria-label': 'Lanternfish' }, 'Lanternfish'),
  );
  if (signedIn !== null) {
    nav.append(
      el('span', { class: 'who', text: signedIn.name }),
      el('button', { class: 'btn ghost', 'aria-label': 'Sign out', onclick: () => void signOut() }, 'Sign out'),
    );
  } else {
    nav.append(el('a', { class: 'signin-link', href: '/signin' }, 'Sign in'));
  }
  return nav;
}

async function signOut(): Promise<void> {
  if (!navigator.onLine) {
    clearRememberedId();
    setPendingSignOut(true);
    sessionInfo = null;
    navigate('/signin', true);
    return;
  }
  await api('/api/session', { method: 'DELETE' }).catch(() => undefined);
  clearRememberedId();
  sessionInfo = null;
  navigate('/signin', true);
}

function renderNotFound(): void {
  clear(app);
  app.append(
    header(sessionInfo),
    el('main', { class: 'page' },
      el('h1', { text: COPY.notFoundTitle }),
      el('p', { text: COPY.notFoundBody }),
    ),
  );
}

// ---------------- Cohorts ----------------

async function renderCohorts(): Promise<void> {
  const s = sessionInfo;
  const res = await api<{ cohorts: CohortInfo[] }>('/api/cohorts');
  const cohorts = res.body.cohorts ?? [];
  const grid = el('div', { class: 'cards' });
  for (const c of cohorts) {
    const full = c.seats_left <= 0;
    grid.append(
      el('article', { 'aria-label': c.name, class: 'card' },
        el('h2', { class: 'card-name', text: c.name }),
        el('p', { class: 'muted', text: c.coach_name }),
        el('p', { class: 'muted', text: phaseLabel(c.phase, c.week) }),
        el('p', { class: 'muted', text: `Nights ${c.starts_on} – ${addDays(c.starts_on, 27)}` }),
        el('p', { class: 'muted', text: formatMoney(c.price_cents) }),
        el('p', { class: full ? 'muted strong' : 'muted', text: seatsCopy(c.seats_left) }),
        el('button', {
          class: 'btn primary',
          'aria-label': `Enroll in ${c.name}`,
          disabled: full ? 'true' : null,
          onclick: () => navigate(`/enroll/${c.id}`),
        }, 'Enroll'),
      ),
    );
  }
  clear(app);
  app.append(
    header(s),
    el('main', { class: 'page' },
      el('h1', { text: 'Open cohorts' }),
      grid,
    ),
  );
}

// ---------------- Enroll ----------------

async function renderEnroll(cohortId: string): Promise<void> {
  const res = await api<{ cohort: CohortInfo }>(`/api/cohorts/${cohortId}`);
  if (!res.ok) {
    clear(app);
    app.append(
      header(sessionInfo),
      el('main', { class: 'page narrow' },
        el('h1', { text: COPY.cohortNotFoundTitle }),
        el('p', { text: COPY.cohortNotFoundBody }),
      ),
    );
    return;
  }
  const cohort = res.body.cohort;
  const zoneList = await zones();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const preselect = zoneList.includes(browserZone) ? browserZone : 'UTC';

  const nameInput = el('input', { class: 'input', 'aria-label': 'Your name', autocomplete: 'name' });
  const emailInput = el('input', { class: 'input', 'aria-label': 'Email', type: 'email', autocomplete: 'email' });
  const zoneSelect = el('select', { class: 'input', 'aria-label': 'Home time zone' });
  for (const z of zoneList) zoneSelect.append(el('option', { value: z, text: z }));
  zoneSelect.value = preselect;
  const bedtimeInput = el('input', { class: 'input', 'aria-label': 'Usual bedtime', type: 'time', value: '23:00' });
  const status = el('div', { class: 'status', role: 'status', 'aria-label': 'Enrollment', text: '' });
  const submit = el('button', { class: 'btn primary', type: 'submit', text: 'Continue to payment' });
  const form = el('form', { 'aria-label': `Enroll in ${cohort.name}`, class: 'form' },
    el('h1', { text: cohort.name }),
    el('label', { text: 'Your name' }, nameInput),
    el('label', { text: 'Email' }, emailInput),
    el('label', { text: 'Home time zone' }, zoneSelect),
    el('label', { text: 'Usual bedtime' }, bedtimeInput),
    submit,
    status,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const payload = {
      cohort_id: cohort.id,
      name: nameInput.value,
      email: emailInput.value,
      home_tz: zoneSelect.value,
      bedtime: bedtimeInput.value,
    };
    const post = await api<{ enrollment: EnrolmentInfo; access_code: string }>('/api/enrollments', { method: 'POST', body: JSON.stringify(payload) });
    if (post.status === 201) {
      sessionStorage.setItem(`lf_access_code_${post.body.enrollment.id}`, post.body.access_code);
      navigate(`/enrollments/${post.body.enrollment.id}`);
      return;
    }
    submit.disabled = false;
    if (post.body.error === 'enrollment_closed') status.textContent = COPY.enrollClosed;
    else if (post.body.error === 'already_enrolled') status.textContent = COPY.alreadyEnrolled;
    else if (post.body.errors !== undefined) {
      const errors = post.body.errors;
      status.textContent = '';
      for (const [field, message] of Object.entries(errors)) {
        status.append(el('p', { class: 'field-error', 'data-field': field, text: message }));
      }
    } else status.textContent = 'Something went wrong.';
  });
  clear(app);
  app.append(header(sessionInfo), el('main', { class: 'page narrow' }, form));
}

// ---------------- Enrolment status ----------------

async function renderEnrolment(id: string): Promise<void> {
  const res = await api<{ enrollment: EnrolmentInfo }>(`/api/enrollments/${id}`);
  if (!res.ok) {
    renderNotFound();
    return;
  }
  const e = res.body.enrollment;
  const status = el('div', { class: 'status', role: 'status', 'aria-label': 'Enrollment' });
  const alertBox = el('div', { class: 'alert', role: 'alert', 'aria-label': 'Payment' });
  const container = el('main', { class: 'page narrow' });

  const draw = (enr: EnrolmentInfo): void => {
    clear(container);
    if (enr.status === 'pending_payment') {
      const code = sessionStorage.getItem(`lf_access_code_${enr.id}`);
      container.append(el('h1', { text: 'Payment pending' }));
      if (code !== null) {
        container.append(el('p', { class: 'access', role: 'group', 'aria-label': 'Access code' }, `Your access code: ${code}`));
      }
      container.append(el('p', { class: 'muted', text: COPY.pendingHint }));
      const payBtn = el('button', { class: 'btn primary', text: `Pay ${formatMoney(enr.price_cents)}` });
      payBtn.addEventListener('click', async () => {
        payBtn.disabled = true;
        status.textContent = COPY.payPending;
        alertBox.textContent = '';
        const pay = await api<{ enrollment: EnrolmentInfo }>(`/api/enrollments/${enr.id}/pay`, { method: 'POST' });
        if (pay.ok) {
          draw(pay.body.enrollment);
          status.textContent = '';
          return;
        }
        payBtn.disabled = false;
        if (pay.status === 503) alertBox.textContent = COPY.payOutage;
        else if (pay.status === 402) alertBox.textContent = COPY.payDeclined;
        else if (pay.body.error === 'cohort_full') alertBox.textContent = COPY.payFull;
        else if (pay.body.error === 'enrollment_closed') status.textContent = COPY.enrollClosed;
        status.textContent = '';
      });
      container.append(payBtn);
    } else {
      container.append(el('h1', { text: 'Enrolled' }));
      container.append(el('p', { text: COPY.enrolledLine(enr.email) }));
      if (enr.first_night !== null) {
        container.append(el('p', { text: COPY.firstNightLine(enr.first_night, enr.bedtime, enr.wake_alarm) }));
      }
      container.append(el('button', { class: 'btn primary', text: 'Open my logbook', onclick: () => navigate('/logbook') }));
    }
  };
  draw(e);
  clear(app);
  app.append(header(sessionInfo), container, status, alertBox);
}

// ---------------- Sign in ----------------

async function renderSignIn(next: string | null): Promise<void> {
  const codeInput = el('input', { class: 'input', 'aria-label': 'Access code', autocomplete: 'off' });
  const status = el('div', { class: 'status', role: 'status', 'aria-label': 'Sign in' });
  const submit = el('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
  const form = el('form', { 'aria-label': 'Sign in', class: 'form' },
    el('h1', { text: 'Sign in' }),
    el('label', { text: 'Access code' }, codeInput),
    submit,
    status,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!navigator.onLine) {
      status.textContent = COPY.offlineSignin;
      return;
    }
    submit.disabled = true;
    const res = await api<SessionInfo>('/api/session', { method: 'POST', body: JSON.stringify({ access_code: codeInput.value }) });
    if (res.ok) {
      sessionInfo = res.body;
      rememberId(res.body.id);
      const landing = await api<{ landing: string }>(`/api/landing?next=${encodeURIComponent(next ?? '')}`);
      navigate(landing.ok ? landing.body.landing : (sessionInfo.role === 'coach' ? '/coach' : '/logbook'), true);
      return;
    }
    submit.disabled = false;
    if (res.status === 401) status.textContent = COPY.invalidCode;
    else if (res.status === 403) {
      const state = res.body['status'];
      status.textContent = state === 'pending_payment' ? COPY.pendingCode : COPY.refundedCode;
    } else status.textContent = COPY.invalidCode;
  });
  clear(app);
  app.append(header(null), el('main', { class: 'page narrow' }, form));
}

// ---------------- Logbook ----------------

let sky: Dreamscape | null = null;
let nightTimer: number | null = null;

interface LogbookState {
  night: NightInfo | null;
  entries: EntryInfo[];
  constellations: ConstellationInfo[];
  target: string | null;
}

async function renderLogbook(): Promise<void> {
  const session = sessionInfo as SessionInfo;
  const state: LogbookState = { night: null, entries: [], constellations: [], target: null };

  const fetchNight = async (): Promise<void> => {
    const res = await api<NightInfo>('/api/me/night');
    if (res.status === 401) {
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) {
      state.night = res.body;
      drawTonight();
      drawJournal();
    }
  };
  const fetchEntries = async (): Promise<void> => {
    const res = await api<{ entries: EntryInfo[] }>('/api/me/entries');
    if (res.status === 401) {
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) state.entries = res.body.entries ?? [];
  };
  const fetchDreamscape = async (): Promise<void> => {
    const res = await api<{ constellations: ConstellationInfo[]; target_category: string | null }>('/api/me/dreamscape');
    if (res.ok) {
      state.constellations = res.body.constellations ?? [];
      state.target = res.body.target_category ?? null;
      drawLegend();
    }
  };

  // live regions
  const connectionStatus = el('div', { class: 'status', role: 'status', 'aria-label': 'Connection' });
  const syncStatus = el('div', { class: 'status', role: 'status', 'aria-label': 'Sync' });
  const practiceStatus = el('div', { class: 'status', role: 'status', 'aria-label': 'Practice' });
  const signsStatus = el('div', { class: 'status', role: 'status', 'aria-label': 'Dream signs' });

  const settingsBtn = el('button', { class: 'btn ghost', 'aria-label': 'Night settings', text: 'Night settings' });
  const tonightRegion = el('section', { class: 'tonight', role: 'region', 'aria-label': 'Tonight' });
  const journalRegion = el('section', { class: 'journal', role: 'region', 'aria-label': 'Journal' });
  const canvas = el('canvas', { class: 'sky-canvas', 'aria-label': 'Dream-sign sky', tabindex: '0', role: 'img' });
  const legendList = el('ul', { class: 'legend', role: 'list', 'aria-label': 'Dream-sign legend' });
  const drillBtn = el('button', { class: 'btn ghost', 'aria-label': 'Reality check drill', text: 'Reality check drill' });
  const skyWrap = el('div', { class: 'sky-wrap' }, canvas);
  const openSheetBtn = el('button', { class: 'btn ghost open-dreamscape', 'aria-label': 'Open dreamscape', text: 'Open dreamscape' });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Dreamscape', hidden: 'hidden' });
  const drillNote = el('p', { class: 'drill-target-note', text: COPY.drillNoTarget, hidden: 'hidden' });
  const skyHome = el('div', { class: 'sky-home' }, skyWrap, legendList, drillBtn, drillNote);
  const dreamscapeRegion = el('section', { class: 'dreamscape-region', role: 'region', 'aria-label': 'Dreamscape', 'data-phase': 'idle' },
    openSheetBtn, skyHome, signsStatus, sheet,
  );

  sky = new Dreamscape(canvas, reducedMotionWanted());

  // pan controls
  const setupPan = (): void => {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (x: number, y: number): void => {
      dragging = true;
      lastX = x;
      lastY = y;
    };
    const move = (x: number, y: number): void => {
      if (!dragging || sky === null) return;
      sky.panBy(lastX - x, lastY - y);
      lastX = x;
      lastY = y;
    };
    canvas.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) down(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { dragging = false; });
    canvas.addEventListener('keydown', (e) => {
      if (sky === null) return;
      if (e.key === 'ArrowLeft') { sky.panBy(-40, 0); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { sky.panBy(40, 0); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sky.panBy(0, -40); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { sky.panBy(0, 40); e.preventDefault(); }
      else if (e.key === 'Home') { sky.recenter(); e.preventDefault(); }
    });
  };
  setupPan();

  const resizeSky = (): void => {
    if (sky === null) return;
    const rect = skyWrap.getBoundingClientRect();
    sky.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  };

  const drawTonight = (): void => {
    clear(tonightRegion);
    const n = state.night;
    if (n === null) return;
    if (n.night_number < 1 && n.first_night !== null) {
      tonightRegion.append(el('p', { class: 'night-line', text: COPY.beforeNight1(n.first_night) }));
    } else {
      tonightRegion.append(el('p', { class: 'night-line', text: `Night ${n.night_number} of 28 – ${n.night_key}` }));
      tonightRegion.append(el('p', { class: 'muted', text: `Bedtime ${n.bedtime}` }));
      tonightRegion.append(el('p', { class: 'muted', text: `Wake alarm ${n.wake_alarm}` }));
    }
    tonightRegion.append(el('p', { class: 'muted', text: n.capture_window === 'open' ? COPY.windowOpen : COPY.windowClosed }));
    tonightRegion.append(settingsBtn);
  };

  settingsBtn.addEventListener('click', () => {
    void openNightSettings(state, practiceStatus, fetchNight);
  });

  const drawLegend = (): void => {
    clear(legendList);
    for (const c of state.constellations) {
      const label = CATEGORY_LABELS[c.category];
      const text = state.target === c.category ? `${label}: ${c.stars} (drill target)` : `${label}: ${c.stars}`;
      legendList.append(el('li', { text }));
    }
    const counts = sky !== null ? sky.countsSnapshot() : { inner_awareness: 0, action: 0, form: 0, context: 0 };
    canvas.setAttribute('aria-description', `Stars: inner awareness ${counts.inner_awareness}, action ${counts.action}, form ${counts.form}, context ${counts.context}.`);
    drillBtn.disabled = state.target === null;
    drillNote.hidden = state.target !== null;
  };

  drillBtn.addEventListener('click', () => {
    if (state.target === null) return;
    void openDrill(state, practiceStatus);
  });

  setJournalRedraw(() => drawJournal());

  const drawJournal = (): void => {
    clear(journalRegion);
    const n = state.night;
    journalRegion.append(buildNewEntryForm(state, practiceStatus, syncStatus, fetchNight, fetchEntries, connectionStatus));
    // current night section
    const kept = entriesFor(session.id);
    const currentKey = n?.night_key ?? null;
    const savedCurrent = state.entries.filter((e) => currentKey !== null && e.night_key === currentKey);
    const keptCurrent = kept.filter((e) => e.state !== 'saved' && e.state !== 'rejected');
    const currentSection = el('section', { class: 'night-section' },
      el('h2', { text: `Night ${n?.night_number ?? 0}, ${currentKey ?? ''}` }),
    );
    if (savedCurrent.length === 0 && keptCurrent.length === 0) {
      currentSection.append(el('p', { class: 'empty', text: COPY.emptyNight }));
    }
    for (const e of keptCurrent) currentSection.append(renderKeptEntry(e, state, practiceStatus, syncStatus, signsStatus, fetchNight, fetchEntries, fetchDreamscape));
    for (const e of savedCurrent) currentSection.append(renderSavedEntry(e, state, practiceStatus, syncStatus, signsStatus, fetchNight, fetchEntries, fetchDreamscape));
    journalRegion.append(currentSection);
    // earlier nights with entries
    const earlier = new Map<string, EntryInfo[]>();
    for (const e of state.entries) {
      if (currentKey !== null && e.night_key === currentKey) continue;
      const list = earlier.get(e.night_key) ?? [];
      list.push(e);
      earlier.set(e.night_key, list);
    }
    const keptRejected = kept.filter((e) => e.state === 'rejected');
    const earlierKeys = [...earlier.keys()].sort((a, b) => (a < b ? 1 : -1));
    for (const key of earlierKeys) {
      const list = earlier.get(key) ?? [];
      const section = el('section', { class: 'night-section' },
        el('h2', { text: `Night ${list[0]?.night_number ?? 0}, ${key}` }),
      );
      for (const e of list) section.append(renderSavedEntry(e, state, practiceStatus, syncStatus, signsStatus, fetchNight, fetchEntries, fetchDreamscape));
      journalRegion.append(section);
    }
    for (const e of keptRejected) {
      const section = el('section', { class: 'night-section' }, renderRejectedEntry(e, practiceStatus, syncStatus, fetchNight, fetchEntries));
      journalRegion.append(section);
    }
  };

  // phone sheet
  const closeSheetBtn = el('button', { class: 'btn ghost', 'aria-label': 'Close dreamscape', text: 'Close dreamscape' });
  sheet.append(closeSheetBtn);
  // On a phone the sky, legend and drill live inside the full-screen sheet
  // while it is open, and back in the strip area while it is collapsed.
  const openSheet = (): void => {
    sheet.append(skyWrap, legendList, drillBtn, drillNote);
    sheet.insertBefore(closeSheetBtn, sheet.firstChild);
    sheet.removeAttribute('hidden');
    document.body.classList.add('sheet-open');
    resizeSky();
    closeSheetBtn.focus();
  };
  const closeSheet = (): void => {
    sheet.setAttribute('hidden', 'hidden');
    document.body.classList.remove('sheet-open');
    skyHome.append(skyWrap, legendList, drillBtn, drillNote);
    resizeSky();
    openSheetBtn.focus();
  };
  openSheetBtn.addEventListener('click', openSheet);
  closeSheetBtn.addEventListener('click', closeSheet);
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    trapFocus(sheet, e);
  });

  clear(app);
  app.append(
    header(session),
    el('div', { class: 'workspace' },
      el('div', { class: 'journal-col' }, tonightRegion, connectionStatus, journalRegion),
      dreamscapeRegion,
    ),
    syncStatus,
    practiceStatus,
  );
  signsStatus.className = 'status';

  await Promise.all([fetchNight(), fetchEntries(), fetchDreamscape()]);
  drawJournal();
  sky.start();
  resizeSky();
  window.addEventListener('resize', resizeSky);

  // offline banner + sync
  const updateConnection = (): void => {
    if (navigator.onLine) {
      if (connectionStatus.textContent !== '') connectionStatus.textContent = '';
      void syncNow(state, syncStatus, fetchNight, fetchEntries, fetchDreamscape);
    } else {
      connectionStatus.textContent = COPY.offline;
    }
  };
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  updateConnection();

  // timed refreshes
  if (nightTimer !== null) window.clearInterval(nightTimer);
  nightTimer = window.setInterval(() => {
    if (!document.hidden) void fetchNight();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void fetchNight();
  });
}

function entriesFor(enrollmentId: string): KeptEntry[] {
  return loadKept().filter((e) => e.enrollmentId === enrollmentId);
}

async function syncNow(state: LogbookState, syncStatus: HTMLElement, fetchNight: () => Promise<void>, fetchEntries: () => Promise<void>, fetchDreamscape: () => Promise<void>): Promise<void> {
  const session = sessionInfo;
  if (session === null) return;
  const mine = entriesFor(session.id);
  const kept = mine.filter((e) => e.state === 'kept').sort((a, b) => a.createdAt - b.createdAt);
  const memos = loadMemos().filter((m) => m.enrollmentId === session.id);
  const hasUnsent = kept.length > 0 || memos.length > 0;
  if (!hasUnsent) return;
  let savedCount = 0;
  const savedIds: string[] = [];
  // 1. entries in the order they were written
  for (const entry of kept) {
    const res = await api<{ entry: EntryInfo }>(`/api/me/entries/${entry.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: entry.title,
        text: entry.text,
        dreams_recalled: entry.dreams_recalled,
        lucid: entry.lucid,
        wbtb: entry.wbtb,
        technique: entry.technique,
        technique_minutes: entry.technique_minutes,
      }),
    });
    if (res.status === 401) {
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) {
      savedCount += 1;
      savedIds.push(entry.id);
      const all = loadKept();
      const idx = all.findIndex((k) => k.id === entry.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], state: 'saved' } as KeptEntry;
        saveKept(all);
      }
    } else if (res.status === 409 || res.status === 422) {
      const reason = res.body.error === 'entry_id_conflict'
        ? COPY.idConflict
        : res.body.error === 'cohort_not_started' || res.body.error === 'cohort_closed'
          ? COPY.cohortNotOpen
          : firstError(res.body);
      const all = loadKept();
      const idx = all.findIndex((k) => k.id === entry.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], state: 'rejected', rejection: reason } as KeptEntry;
        saveKept(all);
      }
    }
  }
  // 2. then the memos: those of entries saved by this attempt, and those of
  // entries already stored on the server from an earlier attempt
  const storedIds = new Set(mine.filter((e) => e.state === 'saved').map((e) => e.id));
  for (const memo of memos) {
    if (!savedIds.includes(memo.entryId) && !storedIds.has(memo.entryId)) continue;
    syncStatus.textContent = COPY.uploadMemo;
    const up = await api<{ memo: unknown }>(`/api/me/entries/${memo.entryId}/memo`, {
      method: 'PUT',
      headers: { 'Content-Type': memo.contentType, 'X-Memo-Duration-Ms': String(memo.durationMs) },
      body: new Blob([memo.blob]),
    });
    if (up.status === 401) {
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (up.ok) {
      saveMemos(loadMemos().filter((m) => m.entryId !== memo.entryId));
      syncStatus.textContent = COPY.memoSaved;
    } else if (up.status === 503) {
      syncStatus.textContent = COPY.memoKept;
    } else if (up.body.error === 'memo_exists') {
      syncStatus.textContent = COPY.notSaved(COPY.memoExists);
      saveMemos(loadMemos().filter((m) => m.entryId !== memo.entryId));
    } else {
      syncStatus.textContent = COPY.notSaved(String(up.body.errors?.memo ?? 'Try again.'));
    }
  }
  // 3. announce the attempt with the kept count including rejected entries
  const remaining = entriesFor(session.id).filter((e) => e.state !== 'saved');
  syncStatus.textContent = COPY.syncLine(savedCount, remaining.length);
  await Promise.all([fetchNight(), fetchEntries(), fetchDreamscape()]);
}

function firstError(body: ApiErrorBody): string {
  if (body.errors !== undefined) {
    const values = Object.values(body.errors);
    if (values.length > 0) return values[0] ?? '';
  }
  return '';
}

// ---------------- night settings dialog ----------------

async function openNightSettings(state: LogbookState, practiceStatus: HTMLElement, refresh: () => Promise<void>): Promise<void> {
  const zoneList = await zones();
  const n = state.night;
  const zoneSelect = el('select', { class: 'input', 'aria-label': 'Home time zone' });
  for (const z of zoneList) zoneSelect.append(el('option', { value: z, text: z }));
  if (n !== null) zoneSelect.value = n.home_tz;
  const bedtimeInput = el('input', { class: 'input', 'aria-label': 'Usual bedtime', type: 'time' });
  if (n !== null) bedtimeInput.value = n.bedtime;
  const cancel = el('button', { class: 'btn ghost', text: 'Cancel' });
  const save = el('button', { class: 'btn primary', text: 'Save settings' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Night settings' },
    el('h2', { text: 'Night settings' }),
    el('label', { text: 'Home time zone' }, zoneSelect),
    el('label', { text: 'Usual bedtime' }, bedtimeInput),
    el('div', { class: 'row' }, cancel, save),
  );
  const backdrop = el('div', { class: 'backdrop' });
  const opener = document.activeElement as HTMLElement | null;
  document.body.append(backdrop, dialog);
  zoneSelect.focus();
  const close = (): void => {
    dialog.remove();
    backdrop.remove();
    if (opener !== null) opener.focus();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    trapFocus(dialog, e);
  });
  backdrop.addEventListener('click', close);
  save.addEventListener('click', async () => {
    save.disabled = true;
    const res = await api<{ night_held: boolean; night_number: number }>('/api/me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ home_tz: zoneSelect.value, bedtime: bedtimeInput.value }),
    });
    if (res.status === 401) {
      close();
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) {
      close();
      practiceStatus.textContent = res.body.night_held ? COPY.settingsHeld(res.body.night_number) : COPY.settingsSaved;
      await refresh();
      return;
    }
    save.disabled = false;
    practiceStatus.textContent = firstError(res.body);
  });
}



// ---------------- new entry form ----------------

let memoRecorder: { recorder: MediaRecorder; chunks: Blob[]; started: number; contentType: string } | null = null;
let pendingMemoForNew: { blob: ArrayBuffer; contentType: string; durationMs: number } | null = null;

function buildNewEntryForm(state: LogbookState, practiceStatus: HTMLElement, syncStatus: HTMLElement, fetchNight: () => Promise<void>, fetchEntries: () => Promise<void>, connectionStatus: HTMLElement): HTMLElement {
  const session = sessionInfo as SessionInfo;
  const titleInput = el('input', { class: 'input', 'aria-label': 'Dream title' });
  const textInput = el('textarea', { class: 'input tall', 'aria-label': 'Dream text', rows: '5' });
  const recalledInput = el('input', { class: 'input', 'aria-label': 'Dreams recalled', type: 'number', value: '0', min: '0', max: '20' });
  const lucidInput = el('input', { type: 'checkbox', 'aria-label': 'Lucid' });
  const memoBtn = el('button', { class: 'btn ghost', type: 'button', text: 'Record voice memo' });
  const saveBtn = el('button', { class: 'btn primary', type: 'submit', text: 'Save entry' });
  const form = el('form', { 'aria-label': 'New entry', class: 'new-entry' },
    el('h2', { class: 'visually-hidden', text: 'New entry' }),
    el('label', { text: 'Dream title' }, titleInput),
    el('label', { text: 'Dream text' }, textInput),
    el('label', { text: 'Dreams recalled' }, recalledInput),
    el('label', { class: 'inline' }, lucidInput, ' Lucid'),
    memoBtn,
  );
  const unlock = state.night?.technique_unlocked === true;
  let wbtbInput: HTMLInputElement | null = null;
  let techniqueInputs: HTMLInputElement[] = [];
  let minutesInput: HTMLInputElement | null = null;
  if (unlock) {
    wbtbInput = el('input', { type: 'checkbox', 'aria-label': 'Woke for WBTB' });
    const none = el('input', { type: 'radio', name: 'technique', value: 'none', 'aria-label': 'None', checked: 'true' });
    const mild = el('input', { type: 'radio', name: 'technique', value: 'mild', 'aria-label': 'MILD' });
    const ssild = el('input', { type: 'radio', name: 'technique', value: 'ssild', 'aria-label': 'SSILD' });
    techniqueInputs = [none, mild, ssild];
    const group = el('div', { class: 'technique-group', role: 'radiogroup', 'aria-label': 'Technique' },
      el('label', { class: 'inline' }, none, ' None'),
      el('label', { class: 'inline' }, mild, ' MILD'),
      el('label', { class: 'inline' }, ssild, ' SSILD'),
    );
    minutesInput = el('input', { class: 'input small', 'aria-label': 'Technique minutes', type: 'number', value: '0', min: '0', max: '180' });
    form.append(
      el('label', { class: 'inline' }, wbtbInput, ' Woke for WBTB'),
      group,
      el('label', { text: 'Technique minutes' }, minutesInput),
    );
  } else {
    form.append(el('p', { class: 'muted unlock-note', text: COPY.techniqueLocked }));
  }
  form.append(saveBtn);

  memoBtn.addEventListener('click', async () => {
    if (memoRecorder !== null) {
      memoRecorder.recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const started = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const duration = Date.now() - started;
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' });
        void blob.arrayBuffer().then((buf) => {
          pendingMemoForNew = { blob: buf, contentType: blob.type, durationMs: duration };
        });
        memoRecorder = null;
        memoBtn.textContent = 'Record voice memo';
      };
      recorder.start();
      memoRecorder = { recorder, chunks, started, contentType: recorder.mimeType };
      memoBtn.textContent = 'Stop recording';
    } catch {
      practiceStatus.textContent = COPY.memoFailed;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const techniqueValue = techniqueInputs.find((t) => t.checked)?.value ?? 'none';
    const technique: 'none' | 'mild' | 'ssild' = techniqueValue === 'mild' || techniqueValue === 'ssild' ? techniqueValue : 'none';
    const kept = newKeptEntry(session.id, {
      title: titleInput.value,
      text: textInput.value,
      dreams_recalled: Number(recalledInput.value),
      lucid: lucidInput.checked,
      wbtb: wbtbInput !== null ? wbtbInput.checked : false,
      technique,
      technique_minutes: minutesInput !== null ? Number(minutesInput.value) : 0,
    });
    const all = loadKept();
    all.push(kept);
    saveKept(all);
    if (pendingMemoForNew !== null) {
      const memos = loadMemos();
      memos.push({ entryId: kept.id, enrollmentId: session.id, blob: pendingMemoForNew.blob, contentType: pendingMemoForNew.contentType, durationMs: pendingMemoForNew.durationMs });
      saveMemos(memos);
      pendingMemoForNew = null;
    }
    titleInput.value = '';
    textInput.value = '';
    recalledInput.value = '0';
    lucidInput.checked = false;
    if (wbtbInput !== null) wbtbInput.checked = false;
    if (minutesInput !== null) minutesInput.value = '0';
    drawJournalRef !== null && void drawJournalRef();
    const res = await api<{ entry: EntryInfo }>(`/api/me/entries/${kept.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: kept.title,
        text: kept.text,
        dreams_recalled: kept.dreams_recalled,
        lucid: kept.lucid,
        wbtb: kept.wbtb,
        technique: kept.technique,
        technique_minutes: kept.technique_minutes,
      }),
    });
    if (res.status === 401) {
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) {
      const updated = loadKept();
      const idx = updated.findIndex((k) => k.id === kept.id);
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], state: 'saved' } as KeptEntry;
        saveKept(updated);
      }
      const memo = loadMemos().find((m) => m.entryId === kept.id);
      if (memo !== undefined) {
        syncStatus.textContent = COPY.uploadMemo;
        const up = await api(`/api/me/entries/${kept.id}/memo`, {
          method: 'PUT',
          headers: { 'Content-Type': memo.contentType, 'X-Memo-Duration-Ms': String(memo.durationMs) },
          body: new Blob([memo.blob]),
        });
        if (up.ok) {
          saveMemos(loadMemos().filter((m) => m.entryId !== kept.id));
          syncStatus.textContent = COPY.memoSaved;
        } else if (up.status === 503) {
          syncStatus.textContent = COPY.memoKept;
        } else if (up.body.error === 'memo_exists') {
          syncStatus.textContent = COPY.notSaved(COPY.memoExists);
        } else {
          syncStatus.textContent = COPY.notSaved(String(up.body.errors?.memo ?? 'Try again.'));
        }
      }
      await Promise.all([fetchNight(), fetchEntries()]);
      if (drawJournalRef !== null) drawJournalRef();
      return;
    }
    if (res.status === 409 || res.status === 422) {
      const reason = res.body.error === 'entry_id_conflict'
        ? COPY.idConflict
        : res.body.error === 'cohort_not_started' || res.body.error === 'cohort_closed'
          ? COPY.cohortNotOpen
          : firstError(res.body);
      const updated = loadKept();
      const idx = updated.findIndex((k) => k.id === kept.id);
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], state: 'rejected', rejection: reason } as KeptEntry;
        saveKept(updated);
      }
      syncStatus.textContent = COPY.notSaved(reason);
      if (drawJournalRef !== null) drawJournalRef();
      return;
    }
    // no response or other status: stays kept
    syncStatus.textContent = COPY.keptLabel;
    void connectionStatus;
  });
  return form;
}

// journal redraw hook set by renderLogbook
let drawJournalRef: (() => void) | null = null;
function setJournalRedraw(fn: () => void): void {
  drawJournalRef = fn;
}

// ---------------- entry rendering ----------------

function renderSavedEntry(e: EntryInfo, state: LogbookState, practiceStatus: HTMLElement, syncStatus: HTMLElement, signsStatus: HTMLElement, fetchNight: () => Promise<void>, fetchEntries: () => Promise<void>, fetchDreamscape: () => Promise<void>): HTMLElement {
  const article = el('article', { 'aria-label': e.title === '' ? 'Untitled dream' : e.title, class: 'entry' });
  article.append(el('h3', { class: 'entry-title', text: e.title === '' ? 'Untitled dream' : e.title }));
  article.append(el('p', { class: 'state', text: COPY.savedLabel }));
  const logged = loggedTime(e.created_at, state);
  article.append(el('p', { class: 'muted', text: `Logged ${logged}` }));
  if (e.late_recall) article.append(el('p', { class: 'badge', text: COPY.lateBadge }));
  const textBox = el('div', { class: 'entry-text' });
  renderMarkedText(textBox, e.text, e.signs);
  textBox.setAttribute('role', 'textbox');
  textBox.setAttribute('aria-label', 'Entry text');
  textBox.setAttribute('aria-readonly', 'true');
  textBox.setAttribute('tabindex', '0');
  article.append(textBox);
  if (e.memo !== null) {
    const audio = el('audio', { controls: '', 'aria-label': 'Voice memo' });
    audio.preload = 'none';
    audio.src = `/api/me/entries/${e.id}/memo`;
    article.append(audio);
  }
  const tagBtn = el('button', { class: 'btn ghost', text: 'Tag as dream sign' });
  const shareBtn = el('button', { class: 'btn ghost', 'aria-pressed': e.shared ? 'true' : 'false', text: e.shared ? 'Shared with coach' : 'Share with coach' });
  article.append(tagBtn, shareBtn);

  const openTag = (start: number, end: number): void => {
    void openTagDialog(e, start, end, state, article, tagBtn, signsStatus, fetchEntries, fetchDreamscape);
  };
  const selectionOffsets = (): { start: number; end: number } | null => {
    const sel = window.getSelection();
    if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!textBox.contains(range.commonAncestorContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(textBox);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const len = range.toString().length;
    if (len === 0) return null;
    return { start, end: start + len };
  };
  tagBtn.addEventListener('click', () => {
    const off = selectionOffsets();
    if (off === null) {
      signsStatus.textContent = COPY.noSelection;
      return;
    }
    openTag(off.start, off.end);
  });
  article.addEventListener('keydown', (event) => {
    if (event.key === 't' || event.key === 'T') {
      const off = selectionOffsets();
      if (off === null) {
        signsStatus.textContent = COPY.noSelection;
        return;
      }
      openTag(off.start, off.end);
    }
  });
  shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    const res = await api<{ entry: EntryInfo }>(`/api/me/entries/${e.id}/share`, { method: 'PUT', body: JSON.stringify({ shared: !e.shared }) });
    shareBtn.disabled = false;
    if (res.status === 401) {
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) {
      practiceStatus.textContent = res.body.entry.shared ? COPY.shared : COPY.unshared;
      await fetchEntries();
      if (drawJournalRef !== null) drawJournalRef();
    }
  });
  return article;
}

function loggedTime(iso: string, state: LogbookState): string {
  // the entry's created_at converted to the dreamer's home time zone from the
  // night endpoint, as HH:MM. The browser cannot know the offset, so the
  // server publishes it through the night endpoint's home_tz; we approximate
  // with a fixed-offset lookup from the zone name using Intl.
  const tz = state.night?.home_tz ?? 'UTC';
  try {
    const dt = new Date(iso);
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    return fmt.format(dt);
  } catch {
    return iso.slice(11, 16);
  }
}

function renderMarkedText(container: HTMLElement, text: string, signs: { start: number; end: number }[]): void {
  const sorted = [...signs].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const s of sorted) {
    if (s.start < cursor) continue;
    if (s.start > cursor) container.append(document.createTextNode(text.slice(cursor, s.start)));
    const mark = el('mark', { class: 'dream-sign' }, text.slice(s.start, s.end));
    container.append(mark);
    cursor = s.end;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function renderKeptEntry(k: KeptEntry, state: LogbookState, practiceStatus: HTMLElement, syncStatus: HTMLElement, signsStatus: HTMLElement, fetchNight: () => Promise<void>, fetchEntries: () => Promise<void>, fetchDreamscape: () => Promise<void>): HTMLElement {
  const article = el('article', { 'aria-label': k.title === '' ? 'Untitled dream' : k.title, class: 'entry kept' });
  article.append(el('h3', { class: 'entry-title', text: k.title === '' ? 'Untitled dream' : k.title }));
  article.append(el('p', { class: 'state', text: COPY.keptLabel }));
  article.append(el('p', { class: 'entry-text kept-text', text: k.text }));
  return article;
}

function renderRejectedEntry(k: KeptEntry, practiceStatus: HTMLElement, syncStatus: HTMLElement, fetchNight: () => Promise<void>, fetchEntries: () => Promise<void>): HTMLElement {
  const article = el('article', { 'aria-label': k.title === '' ? 'Untitled dream' : k.title, class: 'entry rejected' });
  article.append(el('h3', { class: 'entry-title', text: k.title === '' ? 'Untitled dream' : k.title }));
  article.append(el('p', { class: 'state', text: COPY.keptLabel }));
  article.append(el('p', { class: 'rejection', text: COPY.notSaved(k.rejection ?? '') }));
  const editBtn = el('button', { class: 'btn ghost', text: 'Edit as new entry' });
  const discardBtn = el('button', { class: 'btn ghost', text: 'Discard' });
  article.append(editBtn, discardBtn);
  // Copy every field and any kept memo into the new-entry form under a new id.
  const copyIntoForm = (): void => {
    const form = document.querySelector('form[aria-label="New entry"]');
    if (form !== null) {
      const title = form.querySelector<HTMLInputElement>('input[aria-label="Dream title"]');
      const text = form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Dream text"]');
      const recalled = form.querySelector<HTMLInputElement>('input[aria-label="Dreams recalled"]');
      const lucid = form.querySelector<HTMLInputElement>('input[aria-label="Lucid"]');
      const wbtb = form.querySelector<HTMLInputElement>('input[aria-label="Woke for WBTB"]');
      const minutes = form.querySelector<HTMLInputElement>('input[aria-label="Technique minutes"]');
      if (title !== null) title.value = k.title;
      if (text !== null) text.value = k.text;
      if (recalled !== null) recalled.value = String(k.dreams_recalled);
      if (lucid !== null) lucid.checked = k.lucid;
      if (wbtb !== null) wbtb.checked = k.wbtb;
      if (minutes !== null) minutes.value = String(k.technique_minutes);
      const radio = form.querySelector<HTMLInputElement>(`input[name="technique"][value="${k.technique}"]`);
      if (radio !== null) radio.checked = true;
    }
    const memo = loadMemos().find((m) => m.entryId === k.id);
    if (memo !== undefined) pendingMemoForNew = { blob: memo.blob, contentType: memo.contentType, durationMs: memo.durationMs };
    removeKept(k.id);
    if (drawJournalRef !== null) drawJournalRef();
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Dream title"]');
    if (title !== null) title.focus();
  };
  editBtn.addEventListener('click', copyIntoForm);
  discardBtn.addEventListener('click', () => {
    removeKept(k.id);
    if (drawJournalRef !== null) drawJournalRef();
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Dream title"]');
    if (title !== null) title.focus();
  });
  void practiceStatus;
  void syncStatus;
  void fetchNight;
  void fetchEntries;
  return article;
}

function removeKept(entryId: string): void {
  saveKept(loadKept().filter((e) => e.id !== entryId));
  saveMemos(loadMemos().filter((m) => m.entryId !== entryId));
}

// ---------------- tag dialog ----------------

async function openTagDialog(e: EntryInfo, start: number, end: number, state: LogbookState, article: HTMLElement, tagBtn: HTMLElement, signsStatus: HTMLElement, fetchEntries: () => Promise<void>, fetchDreamscape: () => Promise<void>): Promise<void> {
  const phrase = e.text.slice(start, end);
  const radios = ['inner_awareness', 'action', 'form', 'context'].map((cat, i) => {
    const radio = el('input', { type: 'radio', name: 'tag-category', value: cat, 'aria-label': CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS], checked: i === 0 ? 'true' : null });
    return radio;
  });
  const confirmBtn = el('button', { class: 'btn primary', text: 'Confirm tag' });
  const cancelBtn = el('button', { class: 'btn ghost', text: 'Cancel' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Tag dream sign' },
    el('p', { class: 'phrase', text: `Phrase: "${phrase}"` }),
    el('div', { class: 'dialog-body', role: 'radiogroup', 'aria-label': 'Category' },
      ...radios.map((r, i) => el('label', { class: 'inline' }, r, ` ${CATEGORY_LABELS[(['inner_awareness', 'action', 'form', 'context'][i]) as keyof typeof CATEGORY_LABELS]}`)),
    ),
    el('div', { class: 'row' }, confirmBtn, cancelBtn),
  );
  const backdrop = el('div', { class: 'backdrop' });
  document.body.append(backdrop, dialog);
  const first = radios[0];
  if (first !== undefined) first.focus();
  const close = (focusTarget: HTMLElement): void => {
    dialog.remove();
    backdrop.remove();
    focusTarget.focus();
  };
  cancelBtn.addEventListener('click', () => close(tagBtn));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(tagBtn); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const idx = radios.findIndex((r) => r.checked);
      const next = (event.key === 'ArrowUp' || event.key === 'ArrowLeft') ? (idx + radios.length - 1) % radios.length : (idx + 1) % radios.length;
      for (const r of radios) r.checked = false;
      const target = radios[next];
      if (target !== undefined) { target.checked = true; target.focus(); }
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmBtn.click();
      return;
    }
    trapFocus(dialog, event);
  });
  const submitTag = async (): Promise<void> => {
    const category = radios.find((r) => r.checked)?.value;
    if (category === undefined) return;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    const region = article.closest('[data-phase]');
    const reduced = reducedMotionWanted();
    const startPhase = (): void => {
      if (region !== null) region.setAttribute('data-phase', 'underline');
      const marks = article.querySelectorAll('mark');
      void marks;
    };
    startPhase();
    const res = await api<{ sign: { id: string }; tallies: Record<string, number>; error?: string; errors?: Record<string, string> }>('/api/me/entries/' + e.id + '/signs', {
      method: 'POST',
      body: JSON.stringify({ start, end, category }),
    });
    if (res.status === 401) {
      close(tagBtn);
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (!res.ok) {
      if (region !== null) region.setAttribute('data-phase', 'refused');
      window.setTimeout(() => { if (region !== null) region.setAttribute('data-phase', 'idle'); }, reduced ? 0 : 350);
      signsStatus.textContent = res.body.error === 'sign_overlap' ? COPY.overlap : COPY.refused;
      close(tagBtn);
      return;
    }
    // condensation
    if (!reduced && region !== null) {
      region.setAttribute('data-phase', 'flight');
      window.setTimeout(() => region.setAttribute('data-phase', 'settle'), 640);
      window.setTimeout(() => region.setAttribute('data-phase', 'idle'), 1060);
    } else if (region !== null) {
      region.setAttribute('data-phase', 'idle');
    }
    if (sky !== null) sky.addStar(category);
    const label = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS];
    signsStatus.textContent = COPY.signResult(label, res.body.tallies?.[category] ?? 0);
    await Promise.all([fetchEntries(), fetchDreamscape()]);
    close(tagBtn);
    if (drawJournalRef !== null) drawJournalRef();
  };
  confirmBtn.addEventListener('click', () => void submitTag());
}

// ---------------- reality check drill ----------------

const DRILL_STEPS: Record<string, [string, string, string]> = {
  inner_awareness: ['Notice what you are feeling right now. Is it the kind of feeling your dreams bring?', 'Ask yourself, out loud or silently: am I dreaming?', 'Pinch your nose and try to breathe through it.'],
  action: ['Notice what you and others are doing. Could it happen awake?', 'Ask yourself, out loud or silently: am I dreaming?', 'Pinch your nose and try to breathe through it.'],
  form: ['Look at your hands. Count your fingers twice.', 'Ask yourself, out loud or silently: am I dreaming?', 'Pinch your nose and try to breathe through it.'],
  context: ['Look around. Does this place make sense for where you are?', 'Ask yourself, out loud or silently: am I dreaming?', 'Pinch your nose and try to breathe through it.'],
};

async function openDrill(state: LogbookState, practiceStatus: HTMLElement): Promise<void> {
  const target = state.target;
  if (target === null) return;
  const steps = DRILL_STEPS[target] ?? (DRILL_STEPS['form'] as [string, string, string]);
  let step = 1;
  const text = el('p', { class: 'drill-text', text: steps[0] });
  const counter = el('p', { class: 'muted', text: 'Step 1 of 3' });
  const nextBtn = el('button', { class: 'btn primary', text: 'Next' });
  const logBtn = el('button', { class: 'btn primary', text: 'Log reality check', hidden: 'hidden' });
  const closeBtn = el('button', { class: 'btn ghost', text: 'Close drill' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Reality check drill' },
    text, counter, el('div', { class: 'row' }, nextBtn, logBtn, closeBtn),
  );
  const backdrop = el('div', { class: 'backdrop' });
  const opener = document.activeElement as HTMLElement | null;
  document.body.append(backdrop, dialog);
  nextBtn.focus();
  const close = (): void => {
    dialog.remove();
    backdrop.remove();
    if (opener !== null) opener.focus();
  };
  const show = (): void => {
    text.textContent = steps[step - 1] ?? '';
    counter.textContent = `Step ${step} of 3`;
    if (step < 3) {
      nextBtn.removeAttribute('hidden');
      logBtn.setAttribute('hidden', 'hidden');
    } else {
      nextBtn.setAttribute('hidden', 'hidden');
      logBtn.removeAttribute('hidden');
    }
  };
  nextBtn.addEventListener('click', () => { step = Math.min(3, step + 1); show(); });
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    trapFocus(dialog, e);
  });
  logBtn.addEventListener('click', async () => {
    logBtn.disabled = true;
    const id = uuid();
    const res = await api<{ night_count: number }>('/api/me/reality-checks', {
      method: 'POST',
      body: JSON.stringify({ id, category: target }),
    });
    logBtn.disabled = false;
    if (res.status === 401) {
      close();
      navigate(`/signin?next=${encodeURIComponent('/logbook')}`, true);
      return;
    }
    if (res.ok) {
      practiceStatus.textContent = COPY.drillDone(res.body.night_count);
    } else {
      practiceStatus.textContent = firstError(res.body);
    }
    close();
  });
}

// ---------------- Coach ----------------

async function renderCoach(requestedCohort: string | null): Promise<void> {
  const session = sessionInfo as SessionInfo;
  const listRes = await api<{ cohorts: CohortInfo[] }>('/api/coach/cohorts');
  const cohorts = listRes.body.cohorts ?? [];
  const updates = el('div', { class: 'status', role: 'status', 'aria-label': 'Coach updates' });
  let selectedId: string | null = null;
  let fallbackShown = false;
  if (requestedCohort !== null && cohorts.some((c) => c.id === requestedCohort)) {
    selectedId = requestedCohort;
  } else {
    selectedId = cohorts.length > 0 ? (cohorts[0] as CohortInfo).id : null;
    if (requestedCohort !== null) {
      fallbackShown = true;
      history.replaceState({}, '', `/coach?cohort=${selectedId ?? ''}`);
    } else if (selectedId !== null) {
      history.replaceState({}, '', `/coach?cohort=${selectedId}`);
    }
  }

  const chooseCohort = (id: string): void => {
    navigate(`/coach?cohort=${id}`);
  };

  // header area
  const cohortList = el('nav', { class: 'cohort-list', role: 'navigation', 'aria-label': 'Cohort list' });
  const tablist = el('div', { class: 'cohort-tabs', role: 'tablist', 'aria-label': 'Cohort list' });
  const picker = el('select', { class: 'input cohort-picker', 'aria-label': 'Cohort' });
  const cohortHeader = el('div', { class: 'cohort-header' });
  const rosterArea = el('div', { class: 'roster-area' });

  const drawList = (): void => {
    cohortList.textContent = '';
    tablist.textContent = '';
    picker.textContent = '';
    for (const c of cohorts) {
      const label = c.name;
      const desc = phaseLabel(c.phase, c.week);
      const link = el('a', { href: `/coach?cohort=${c.id}`, class: c.id === selectedId ? 'cohort-link current' : 'cohort-link', 'aria-label': label, 'aria-description': desc, onclick: (e: Event) => { e.preventDefault(); chooseCohort(c.id); } },
        el('span', { class: 'link-name', text: label }),
        el('span', { class: 'muted', text: desc }),
      );
      cohortList.append(link);
      const tab = el('button', { role: 'tab', 'aria-label': label, 'aria-description': desc, 'aria-selected': c.id === selectedId ? 'true' : 'false', class: c.id === selectedId ? 'tab current' : 'tab', onclick: () => chooseCohort(c.id) },
        el('span', { class: 'link-name', text: label }),
        el('span', { class: 'muted', text: desc }),
      );
      tablist.append(tab);
      const option = el('option', { value: c.id, text: label });
      (option as HTMLOptionElement).setAttribute('aria-label', label);
      if (c.id === selectedId) (option as HTMLOptionElement).selected = true;
      picker.append(option);
    }
  };
  picker.addEventListener('change', () => {
    chooseCohort(picker.value);
  });

  // new cohort form
  const nameInput = el('input', { class: 'input', 'aria-label': 'Cohort name' });
  const dateInput = el('input', { class: 'input', 'aria-label': 'First night', type: 'date' });
  const priceInput = el('input', { class: 'input', 'aria-label': 'Seat price (USD)', type: 'text', inputmode: 'decimal', placeholder: '240' });
  const seatsInput = el('input', { class: 'input', 'aria-label': 'Seats', type: 'number', min: '1', max: '50', value: '12' });
  const createBtn = el('button', { class: 'btn primary', type: 'submit', text: 'Create cohort' });
  const newForm = el('form', { 'aria-label': 'New cohort', class: 'new-cohort', hidden: 'hidden' },
    el('h2', { text: 'New cohort' }),
    el('label', { text: 'Cohort name' }, nameInput),
    el('label', { text: 'First night' }, dateInput),
    el('label', { text: 'Seat price (USD)' }, priceInput),
    el('label', { text: 'Seats' }, seatsInput),
    createBtn,
  );
  newForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const priceText = priceInput.value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(priceText)) {
      showFieldError(newForm, 'price', COPY.priceMessage);
      return;
    }
    clearFieldErrors(newForm);
    createBtn.disabled = true;
    const cents = Math.round(Number(priceText) * 100);
    const res = await api<{ cohort: CohortInfo }>('/api/coach/cohorts', {
      method: 'POST',
      body: JSON.stringify({ name: nameInput.value, starts_on: dateInput.value, price_cents: cents, seats: Number(seatsInput.value) }),
    });
    createBtn.disabled = false;
    if (res.status === 201) {
      updates.textContent = COPY.cohortCreated;
      cohorts.push(res.body.cohort);
      drawList();
      navigate(`/coach?cohort=${res.body.cohort.id}`);
      return;
    }
    if (res.body.error === 'cohort_name_taken') updates.textContent = COPY.nameTaken;
    else if (res.body.errors !== undefined) {
      showFieldErrors(newForm, res.body.errors);
    }
  });

  const publishBtn = el('button', { class: 'btn ghost', text: 'Publish cohort' });
  const closeCohortBtn = el('button', { class: 'btn ghost', text: 'Close cohort' });
  const digestBtn = el('button', { class: 'btn ghost', text: 'Send weekly digest' });

  publishBtn.addEventListener('click', async () => {
    if (selectedId === null) return;
    publishBtn.disabled = true;
    const res = await api(`/api/coach/cohorts/${selectedId}/publish`, { method: 'POST' });
    publishBtn.disabled = false;
    if (res.ok) { updates.textContent = COPY.published; await reloadList(); return; }
    if (res.body.error === 'illegal_transition') updates.textContent = COPY.illegalPhase;
  });
  closeCohortBtn.addEventListener('click', async () => {
    if (selectedId === null) return;
    closeCohortBtn.disabled = true;
    const res = await api(`/api/coach/cohorts/${selectedId}/close`, { method: 'POST' });
    closeCohortBtn.disabled = false;
    if (res.ok) { updates.textContent = COPY.closedCohort; await reloadList(); return; }
    if (res.body.error === 'illegal_transition') updates.textContent = COPY.illegalPhase;
  });
  digestBtn.addEventListener('click', async () => {
    if (selectedId === null) return;
    digestBtn.disabled = true;
    updates.textContent = COPY.digestPending;
    const res = await api<{ digest: { to: string; replayed: boolean } }>(`/api/coach/cohorts/${selectedId}/digest`, { method: 'POST' });
    digestBtn.disabled = false;
    if (res.ok) {
      const to = res.body.digest?.to ?? '';
      updates.textContent = res.body.digest?.replayed ? COPY.digestReplay(to) : COPY.digestSent(to);
      return;
    }
    if (res.status === 503) updates.textContent = COPY.mailOutage;
    else if (res.body.error === 'cohort_not_running') updates.textContent = COPY.illegalPhase;
  });

  const reloadList = async (): Promise<void> => {
    const fresh = await api<{ cohorts: CohortInfo[] }>('/api/coach/cohorts');
    cohorts.length = 0;
    for (const c of fresh.body.cohorts ?? []) cohorts.push(c);
    drawList();
    await drawHeader();
    await drawRoster();
  };

  let currentCohort: CohortInfo | null = null;

  const drawHeader = async (): Promise<void> => {
    cohortHeader.textContent = '';
    const c = currentCohort;
    if (c === null) return;
    cohortHeader.append(
      el('h2', { class: 'cohort-title', text: c.name }),
      el('span', { class: 'muted phase', text: phaseLabel(c.phase, c.week) }),
    );
    publishBtn.toggleAttribute('hidden', c.phase !== 'draft');
    closeCohortBtn.toggleAttribute('hidden', c.phase !== 'technique');
    digestBtn.toggleAttribute('hidden', !(c.phase === 'baseline' || c.phase === 'technique'));
  };

  // The roster is built once and updated in place on each refresh, so focus,
  // open dialogs and scroll survive (DP-66).
  interface RosterCells {
    row: HTMLTableRowElement;
    card: HTMLElement;
    cardLines: HTMLElement[];
    fields: HTMLElement[]; // status, night, recall, technique, wbtb, checks, ia, action, form, context
    actions: HTMLElement;
    cardActions: HTMLElement;
    name: string;
  }
  const rosterCells = new Map<string, RosterCells>();

  const FIELD_LABELS = ['Status', 'Night', 'Recall', 'Technique minutes', 'WBTB nights', 'Reality checks', 'Inner awareness', 'Action', 'Form', 'Context'];

  const fieldValues = (d: RosterRowInfo): string[] => [
    d.status === 'active' ? 'Active' : 'Refunded',
    rosterNight(d.night_number),
    `${Math.round(d.recall_rate * 100)}%`,
    String(d.technique_minutes),
    String(d.wbtb_nights),
    String(d.reality_checks),
    String(d.sign_tallies.inner_awareness),
    String(d.sign_tallies.action),
    String(d.sign_tallies.form),
    String(d.sign_tallies.context),
  ];

  const buildRow = (d: RosterRowInfo): RosterCells => {
    const row = el('tr', {});
    const rowHeader = el('th', { class: 'pin-col', scope: 'row', text: d.display_name });
    row.append(rowHeader);
    const fields: HTMLElement[] = [];
    for (const value of fieldValues(d)) {
      const cell = el('td', { text: value });
      row.append(cell);
      fields.push(cell);
    }
    const actions = el('td', { class: 'actions' });
    row.append(actions);
    const card = el('article', { class: 'roster-card' });
    card.append(el('h3', { text: d.display_name }));
    const cardLines: HTMLElement[] = [];
    for (let i = 0; i < FIELD_LABELS.length; i += 1) {
      const line = el('p', { class: 'muted', text: `${FIELD_LABELS[i]}: ${fieldValues(d)[i]}` });
      card.append(line);
      cardLines.push(line);
    }
    const cardActions = el('div', { class: 'card-actions' });
    card.append(cardActions);
    const cells: RosterCells = { row, card, cardLines, fields, actions, cardActions, name: d.display_name };
    return cells;
  };

  const refreshRow = (cells: RosterCells, d: RosterRowInfo, tableBody: HTMLElement, cards: HTMLElement): void => {
    const values = fieldValues(d);
    cells.fields.forEach((cell, i) => {
      const value = values[i] ?? '';
      if (cell.textContent !== value) cell.textContent = value;
    });
    cells.cardLines.forEach((line, i) => {
      const value = `${FIELD_LABELS[i]}: ${values[i] ?? ''}`;
      if (line.textContent !== value) line.textContent = value;
    });
    // Rows are appended once and kept; cards mirror the same fields.
    if (cells.row.parentNode === null) tableBody.append(cells.row);
    if (cells.card.parentNode === null) cards.append(cells.card);
    syncRowActions(cells.actions, cells, d);
    syncRowActions(cells.cardActions, cells, d);
  };

  const syncRowActions = (container: HTMLElement, cells: RosterCells, d: RosterRowInfo): void => {
    const active = d.status === 'active';
    const refundButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Refund "]');
    if (active && refundButton === null) {
      const refundBtn = el('button', { class: 'btn ghost small', 'aria-label': `Refund ${d.display_name}`, text: 'Refund' });
      refundBtn.addEventListener('click', () => {
        void openRefundDialog(currentCohort, d, updates, reloadList);
      });
      container.insertBefore(refundBtn, container.firstChild);
    } else if (!active && refundButton !== null) {
      refundButton.remove();
    }
    for (const button of [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Read shared entry "]')]) {
      const label = button.getAttribute('aria-label') ?? '';
      const title = label.replace(/^Read shared entry /, '');
      const still = d.shared_entries.some((s) => (s.title === '' ? 'Untitled dream' : s.title) === title);
      if (!still) button.remove();
    }
    for (const shared of d.shared_entries) {
      const title = shared.title === '' ? 'Untitled dream' : shared.title;
      const existing = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Read shared entry "]')].find((b) => (b.getAttribute('aria-label') ?? '').endsWith(title));
      if (existing === undefined) {
        const readBtn = el('button', { class: 'btn ghost small', 'aria-label': `Read shared entry ${title}`, text: 'Read' });
        readBtn.addEventListener('click', () => {
          void openSharedEntry(currentCohort, d, shared, updates, rosterArea, refreshRosterOnce);
        });
        container.append(readBtn);
      }
    }
    void cells;
  };

  let rosterBuilt = false;
  let tableBody: HTMLElement = el('tbody', {});
  let cards: HTMLElement = el('div', { class: 'roster-cards' });
  const view = el('div', { class: 'roster-view', role: 'region', 'aria-label': 'Roster view', tabindex: '0' });
  view.append(el('table', { class: 'roster-table', 'aria-label': 'Roster' }));
  const rosterTable = view.querySelector('table') as HTMLTableElement;
  rosterTable.append(el('thead', {}, el('tr', {},
    el('th', { class: 'pin-col', scope: 'col', text: 'Dreamer' }),
    el('th', { scope: 'col', text: 'Status' }),
    el('th', { scope: 'col', text: 'Night' }),
    el('th', { scope: 'col', text: 'Recall' }),
    el('th', { scope: 'col', text: 'Technique minutes' }),
    el('th', { scope: 'col', text: 'WBTB nights' }),
    el('th', { scope: 'col', text: 'Reality checks' }),
    el('th', { scope: 'col', text: 'Inner awareness' }),
    el('th', { scope: 'col', text: 'Action' }),
    el('th', { scope: 'col', text: 'Form' }),
    el('th', { scope: 'col', text: 'Context' }),
    el('th', { scope: 'col', text: 'Actions' }),
  )));
  rosterTable.append(tableBody);

  const refreshRosterOnce = (): void => {
    void drawRoster();
  };

  const drawRoster = async (): Promise<void> => {
    if (selectedId === null) return;
    const res = await api<{ cohort: CohortInfo; dreamers: RosterRowInfo[] }>(`/api/coach/cohorts/${selectedId}/roster`);
    if (!res.ok) return;
    currentCohort = res.body.cohort;
    await drawHeader();
    const dreamers = res.body.dreamers ?? [];
    if (!rosterBuilt) {
      rosterArea.textContent = '';
      rosterArea.append(view, cards);
      rosterBuilt = true;
    }
    const seen = new Set<string>();
    for (const d of dreamers) {
      seen.add(d.enrollment_id);
      let cells = rosterCells.get(d.enrollment_id);
      if (cells === undefined) {
        cells = buildRow(d);
        rosterCells.set(d.enrollment_id, cells);
      }
      refreshRow(cells, d, tableBody, cards);
    }
    // rows of dreamers no longer listed leave the roster
    for (const [id, cells] of rosterCells) {
      if (!seen.has(id)) {
        cells.row.remove();
        cells.card.remove();
        rosterCells.delete(id);
      }
    }
    // close an open shared-entry dialog whose entry was withdrawn
    reconcileSharedDialogs(dreamers, updates);
  };

  const showFieldError = (form: HTMLElement, field: string, message: string): void => {
    clearFieldErrors(form);
    const p = el('p', { class: 'field-error', 'data-field': field, text: message });
    form.append(p);
  };
  const showFieldErrors = (form: HTMLElement, errors: Record<string, string>): void => {
    clearFieldErrors(form);
    for (const [field, message] of Object.entries(errors)) {
      form.append(el('p', { class: 'field-error', 'data-field': field, text: message }));
    }
  };
  const clearFieldErrors = (form: HTMLElement): void => {
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
  };

  clear(app);
  const newCohortBtn = el('button', { class: 'btn ghost new-cohort-toggle', 'aria-label': 'New cohort', text: 'New cohort' });
  newCohortBtn.addEventListener('click', () => {
    newForm.toggleAttribute('hidden');
  });
  app.append(
    header(session),
    el('div', { class: 'coach-layout' },
      el('aside', { class: 'coach-side' },
        el('h1', { text: 'Cohorts' }),
        newCohortBtn,
        cohortList,
        tablist,
        picker,
        newForm,
      ),
      el('section', { class: 'coach-main' },
        updates,
        cohortHeader,
        el('div', { class: 'cohort-actions' }, publishBtn, closeCohortBtn, digestBtn),
        rosterArea,
      ),
    ),
  );
  if (fallbackShown) updates.textContent = COPY.cohortUnavailable;

  drawList();
  await drawRoster();

  // live roster refresh
  const refreshRoster = async (): Promise<void> => {
    if (document.hidden) return;
    await drawRoster();
  };
  const timer = window.setInterval(() => void refreshRoster(), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshRoster();
  });
  window.addEventListener('lf:stop-coach-timers', () => window.clearInterval(timer), { once: true });
}

// ---------------- coach dialogs ----------------

async function openRefundDialog(cohort: CohortInfo | null, row: RosterRowInfo, updates: HTMLElement, onDone: () => Promise<void>): Promise<void> {
  if (cohort === null) return;
  const confirmBtn = el('button', { class: 'btn primary', text: 'Confirm refund' });
  const cancelBtn = el('button', { class: 'btn ghost', text: 'Cancel' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Refund seat' },
    el('p', { text: `Refund ${row.display_name}'s seat of ${formatMoney(cohort.price_cents)}?` }),
    el('div', { class: 'row' }, confirmBtn, cancelBtn),
  );
  const backdrop = el('div', { class: 'backdrop' });
  const opener = document.activeElement as HTMLElement | null;
  document.body.append(backdrop, dialog);
  confirmBtn.focus();
  const close = (): void => {
    dialog.remove();
    backdrop.remove();
    if (opener !== null) opener.focus();
  };
  cancelBtn.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    trapFocus(dialog, e);
  });
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    const res = await api(`/api/coach/enrollments/${row.enrollment_id}/refund`, { method: 'POST' });
    confirmBtn.disabled = false;
    if (res.ok) {
      close();
      updates.textContent = COPY.refunded(row.display_name);
      await onDone();
      return;
    }
    if (res.body.error === 'refund_window_closed') updates.textContent = COPY.refundWindow;
    else if (res.body.error === 'not_refundable') updates.textContent = COPY.refundComped;
    else if (res.status === 503) updates.textContent = COPY.refundBilling;
    else if (res.body.error === 'illegal_transition') updates.textContent = COPY.refundAgain;
  });
}

interface SharedEntryRef {
  entry_id: string;
  title: string;
  text: string;
  has_memo: boolean;
}

// The shared-entry dialog registers itself so the roster refresh can close it
// when its entry stops being shared (DP-66).
const openSharedDialogs: { entryId: string; ownerName: string; dialog: HTMLElement; close: (to: HTMLElement | null) => void }[] = [];

async function openSharedEntry(cohort: CohortInfo | null, row: RosterRowInfo, shared: SharedEntryRef, updates: HTMLElement, rosterArea: HTMLElement, onRefresh: () => void): Promise<void> {
  void rosterArea;
  if (cohort === null) return;
  const closeBtn = el('button', { class: 'btn ghost', text: 'Close' });
  const dialog = el('div', { class: 'dialog wide', role: 'dialog', 'aria-label': 'Shared entry' },
    el('h2', { text: shared.title === '' ? 'Untitled dream' : shared.title }),
    el('p', { class: 'shared-text', text: shared.text }),
  );
  if (shared.has_memo) {
    const audio = el('audio', { controls: '', 'aria-label': 'Voice memo' });
    audio.preload = 'none';
    audio.src = `/api/coach/cohorts/${cohort.id}/shared/${shared.entry_id}/memo`;
    dialog.append(audio);
  }
  dialog.append(closeBtn);
  const backdrop = el('div', { class: 'backdrop' });
  const opener = document.activeElement as HTMLElement | null;
  document.body.append(backdrop, dialog);
  closeBtn.focus();
  const record = { entryId: shared.entry_id, ownerName: row.display_name, dialog, close: (to: HTMLElement | null): void => {
    dialog.remove();
    backdrop.remove();
    openSharedDialogs.splice(openSharedDialogs.indexOf(record), 1);
    if (to !== null && to !== undefined) to.focus();
    else if (opener !== null) opener.focus();
  } };
  openSharedDialogs.push(record);
  closeBtn.addEventListener('click', () => record.close(null));
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); record.close(null); return; }
    trapFocus(dialog, e);
  });
  void onRefresh;
  void updates;
}

// Called by the roster refresh: closes and reports a dialog whose entry was
// withdrawn, moving focus to the dreamer's row header or card heading.
function reconcileSharedDialogs(dreamers: RosterRowInfo[], updates: HTMLElement): void {
  for (const record of [...openSharedDialogs]) {
    const owner = dreamers.find((d) => d.shared_entries.some((s) => s.entry_id === record.entryId));
    if (owner === undefined) {
      record.close(findRosterHeader(record.ownerName));
      updates.textContent = COPY.withdrawn;
    }
  }
}

function findRosterHeader(displayName: string): HTMLElement | null {
  const headers = document.querySelectorAll(`th[scope="row"]`);
  for (const header of headers) {
    if (header.textContent === displayName) return header as HTMLElement;
  }
  const cards = document.querySelectorAll('.roster-card h3');
  for (const heading of cards) {
    if (heading.textContent === displayName) return heading as HTMLElement;
  }
  return null;
}

void boot();
