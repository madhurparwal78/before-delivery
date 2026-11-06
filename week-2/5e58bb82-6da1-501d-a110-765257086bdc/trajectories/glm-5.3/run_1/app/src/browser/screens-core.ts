/* Shared screen pieces: top bar, sign-in, fleet board, missions table, not-found. */
import { User, Vessel, Mission, Alert, Units } from './app.js';
import { apiFetch, ApiError } from './api.js';
import { h, clear, byId, openModal, focusSafe } from './dom.js';
import { store, signOut, setUnitsForUser } from './state.js';
import { fmtPos, fmtSpeed, fmtPct, fmtHours, fmtTimeUTC } from './app.js';

export function topbar(): HTMLElement {
  const u = store.user as User;
  const role = u.role;
  const links: { label: string; href: string }[] = [];
  if (role === 'principal_surveyor') {
    links.push({ label: 'Fleet', href: '/fleet' });
    links.push({ label: 'Missions', href: '/missions' });
    links.push({ label: 'New mission', href: '/missions/new' });
  } else if (role === 'launch_technician') {
    links.push({ label: 'Fleet', href: '/fleet' });
    links.push({ label: 'Missions', href: '/missions' });
    links.push({ label: 'Launch list', href: '/launch' });
  } else {
    links.push({ label: 'Surveys', href: '/surveys' });
  }
  const nav = h('nav', { 'aria-label': 'Main', class: 'mainnav' },
    ...links.map(l => h('a', { href: l.href }, l.label)));
  const unitsRadio = (val: Units, label: string) => {
    const input = h('input', {
      type: 'radio', name: 'units', value: val,
      ...(store.units === val ? { checked: true } : {}),
      onchange: () => { void setUnitsForUser(val); },
    }) as HTMLInputElement;
    input.id = `units-${val}`;
    return h('label', { class: 'unitslabel' }, input, label);
  };
  const radios = h('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'units' },
    unitsRadio('metric', 'Metric'), unitsRadio('imperial', 'Imperial'));
  const out = h('button', {
    class: 'btn subtle',
    onclick: () => void signOut(),
  }, 'Sign out');
  return h('header', { class: 'topbar' },
    h('span', { class: 'brand' }, 'Swathdeck'),
    nav,
    h('div', { class: 'topright' }, radios, out,
      h('div', { class: 'statusrow' },
        h('div', { id: 'service-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Service status', class: 'banner' }),
        h('div', { id: 'session-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Session status', class: 'banner' }),
      )),
  );
}

// ---------- sign-in ----------

export interface SignInOptions {
  next?: string;
  idle?: boolean;
}

export function renderSignIn(root: HTMLElement, opts: SignInOptions): void {
  clear(root);
  const errorSummary = h('div', { class: 'error-summary hidden', role: 'alert', tabindex: '-1' });
  const email = h('input', { type: 'email', id: 'signin-email', autocomplete: 'username' }) as HTMLInputElement;
  const password = h('input', { type: 'password', id: 'signin-password', autocomplete: 'current-password' }) as HTMLInputElement;
  const status = h('div', { id: 'sign-in-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Sign-in status', class: 'banner' });
  const submit = h('button', { class: 'btn primary' }, 'Sign in');
  const form = h('form', {
    class: 'card sign-in-card',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      errorSummary.classList.add('hidden');
      clear(errorSummary);
      status.textContent = 'Signing in';
      try {
        const body: Record<string, unknown> = { email: email.value, password: password.value };
        if (opts.next) body.next = opts.next;
        const resp = await apiFetch<{ user: User; home: string }>('POST', '/api/session', body);
        window.location.href = resp.home;
      } catch (err) {
        const e2 = err as ApiError;
        let msg: string;
        if (e2.body && e2.body.message) msg = e2.body.message;
        else msg = 'Email or password is incorrect.';
        errorSummary.classList.remove('hidden');
        errorSummary.append(h('p', {}, msg));
        status.textContent = '';
        focusSafe(errorSummary);
        password.value = '';
      }
    },
  },
    h('h1', {}, 'Sign in to Swathdeck'),
    errorSummary,
    h('label', { for: 'signin-email' }, 'Email'),
    email,
    h('label', { for: 'signin-password' }, 'Password'),
    password,
    submit,
    status,
  );
  root.append(form);
  email.focus();
  if (opts.idle) {
    errorSummary.classList.remove('hidden');
    errorSummary.append(h('p', {}, 'You were signed out after 30 minutes without activity.'));
    focusSafe(errorSummary);
  }
}

// ---------- vessel cards & alerts region ----------

export function vesselCard(v: Vessel, opts: { coverage?: number; hrefBase?: string; onSelect?: () => void }): HTMLElement {
  const missionCoverage = opts.coverage !== undefined ? fmtPct(opts.coverage) : '—';
  const linkWord = v.link_state;
  const last = v.last_fix;
  const pos = last ? fmtPos(last.position, store.units) : 'E — N —';
  const speed = last ? fmtSpeed(last.speed_mps, store.units) : '—';
  const button = h('button', {
    class: 'vessel-name-btn',
    'aria-label': v.name,
    onclick: () => opts.onSelect?.(),
  }, v.name);
  return h('li', { class: 'vessel-card', 'data-vessel-id': v.id },
    button,
    h('div', { class: 'vessel-facts' },
      h('span', { class: 'mono', 'data-fact': 'link' }, linkWord),
      h('span', { class: 'mono', 'data-fact': 'pos' }, pos),
      h('span', { class: 'mono', 'data-fact': 'speed' }, speed),
      h('span', { class: 'mono', 'data-fact': 'battery' }, last ? `${Math.round(last.battery_pct)}%` : '—'),
      h('span', { class: 'mono', 'data-fact': 'coverage' }, missionCoverage),
      h('span', { class: 'mono', 'data-fact': 'hours' }, fmtHours(v.hours_since_service)),
      ...(v.service_overdue ? [h('span', { class: 'mono overdue', 'data-fact': 'overdue' }, 'Service overdue')] : []),
    ),
  );
}

// Patch alert cards in place: new cards append, changed cards keep their element.
export function patchAlertsInPlace(alerts: Alert[]): { changed: boolean } {
  let changed = false;
  const region = document.querySelector('.alerts-region') as HTMLElement | null;
  const list = region?.querySelector('.alert-cards') as HTMLElement | null;
  if (!region || !list) return { changed };
  const byId = new Map(alerts.map(a => [a.id, a]));
  for (const card of Array.from(list.querySelectorAll<HTMLElement>('.alert-card'))) {
    const a = byId.get(card.dataset.alertId ?? '');
    if (!a || a.state === 'Closed') {
      // Closed or vanished: keep the card if it holds focus, else drop it
      if (!card.contains(document.activeElement)) { card.remove(); changed = true; }
      continue;
    }
    const stateLine = card.querySelector('.state-line') as HTMLElement | null;
    if (stateLine) {
      const want = a.state === 'Acknowledged'
        ? `Acknowledged by ${a.acknowledged_by} at ${fmtTimeUTC(a.acknowledged_at).replace(' UTC', '')} UTC`
        : a.state === 'Rectified' ? `Rectified at ${fmtTimeUTC(a.rectified_at).replace(' UTC', '')} UTC` : a.state;
      if (stateLine.textContent !== want) { stateLine.textContent = want; changed = true; }
    }
    const ackBtn = card.querySelector('.ack-btn') as HTMLElement | null;
    const wantsBtn = a.state === 'Active' || a.state === 'Rectified';
    if (wantsBtn && !ackBtn) { changed = true; }
    if (!wantsBtn && ackBtn) { ackBtn.remove(); changed = true; }
    const emailEl = card.querySelectorAll('p.mono');
    const lastP = emailEl[emailEl.length - 1];
    if (lastP && lastP.textContent !== a.email) { lastP.textContent = a.email; changed = true; }
  }
  // new alerts append at the top of the list
  for (const a of alerts) {
    if (a.state === 'Closed') continue;
    if (!list.querySelector(`[data-alert-id="${a.id}"]`)) {
      list.prepend(buildAlertCard(a));
      changed = true;
    }
  }
  return { changed };
}

function buildAlertCard(a: Alert): HTMLElement {
  const article = h('article', { class: `alert-card alert-${a.state.toLowerCase()}`, 'data-alert-id': a.id },
    h('h3', { class: 'alert-heading' }, a.heading),
    h('p', { class: 'state-line', tabindex: '-1' },
      a.state === 'Acknowledged'
        ? `Acknowledged by ${a.acknowledged_by} at ${fmtTimeUTC(a.acknowledged_at).replace(' UTC', '')} UTC`
        : a.state === 'Rectified' ? `Rectified at ${fmtTimeUTC(a.rectified_at).replace(' UTC', '')} UTC` : a.state),
    h('p', { class: 'mono' }, `Raised ${fmtTimeUTC(a.raised_at)}`),
    a.position ? h('p', { class: 'mono' }, fmtPos(a.position, store.units)) : null,
    h('p', { class: 'mono' }, a.email === 'Emailed' ? 'Emailed' : 'Email queued'),
  );
  return article;
}

// Patch vessel card facts in place, keeping the DOM (and focus) where it is.
export function patchFleetInPlace(): void {
  const missionById = new Map(store.missions.map(m => [m.id, m]));
  document.querySelectorAll<HTMLElement>('.vessel-card').forEach(card => {
    const v = store.vessels.find(x => x.id === card.dataset.vesselId);
    if (!v) return;
    const set = (fact: string, text: string): void => {
      const el = card.querySelector(`[data-fact="${fact}"]`) as HTMLElement | null;
      if (el && el.textContent !== text) el.textContent = text;
    };
    const last = v.last_fix;
    set('link', v.link_state);
    set('pos', last ? fmtPos(last.position, store.units) : 'E — N —');
    set('speed', last ? fmtSpeed(last.speed_mps, store.units) : '—');
    set('battery', last ? `${Math.round(last.battery_pct)}%` : '—');
    const m = v.mission_id ? missionById.get(v.mission_id) : undefined;
    set('coverage', m ? fmtPct(m.counters.coverage_pct) : '—');
    set('hours', fmtHours(v.hours_since_service));
    const overdueEl = card.querySelector('[data-fact="overdue"]') as HTMLElement | null;
    if (v.service_overdue && !overdueEl) {
      card.querySelector('.vessel-facts')?.append(h('span', { class: 'mono overdue', 'data-fact': 'overdue' }, 'Service overdue'));
    } else if (!v.service_overdue && overdueEl) {
      overdueEl.remove();
    }
  });
}

export function alertsRegion(alerts: Alert[], onAcknowledge: (alert: Alert) => void): HTMLElement {
  const list = h('ul', { 'aria-label': 'Alert cards', class: 'alert-cards' });
  for (const a of alerts) {
    if (a.state === 'Closed') continue;
    const card = buildAlertCard(a);
    if (a.state === 'Active' || a.state === 'Rectified') {
      card.append(h('button', {
        class: 'btn subtle ack-btn',
        'aria-label': `Acknowledge ${a.heading}`,
        onclick: () => onAcknowledge(a),
      }, 'Acknowledge'));
    }
    list.append(card);
  }
  return h('section', { class: 'alerts-region', 'aria-label': 'Alerts', tabindex: '-1' },
    h('h2', { class: 'region-heading' }, 'Alerts'),
    list,
  );
}

// ---------- fleet board ----------

export interface FleetBoardOpts {
  selectedVesselId: string | null;
  onSelect: (id: string | null) => void;
  onSaveInterval: (vesselId: string, hours: number, version: number, noteEl: HTMLElement) => Promise<void>;
}

export async function renderFleetBoard(root: HTMLElement, opts: FleetBoardOpts): Promise<void> {
  const user = store.user!;
  const vessels = store.vessels;
  const alerts = store.alerts;
  const missionById = new Map(store.missions.map(m => [m.id, m]));

  const vesselList = h('ul', { 'aria-label': 'Vessels', class: 'vessel-list' });
  for (const v of vessels) {
    let cov: number | undefined;
    if (v.mission_id) {
      const m = missionById.get(v.mission_id);
      cov = m?.counters?.coverage_pct;
    }
    vesselList.append(vesselCard(v, {
      coverage: cov,
      onSelect: () => opts.onSelect(v.id),
    }));
  }

  const ack = async (a: Alert): Promise<void> => {
    try {
      const updated = await apiFetch<Alert>('POST', `/api/alerts/${a.id}/ack`, {});
      byId('fleet-announcements').textContent = 'Alert acknowledged';
      patchAlertsInPlace([updated, ...store.alerts.filter(x => x.id !== a.id)]);
      // Focus rules: next alert with a button below, else previous, else state line, else region.
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.alert-card'));
      const idx = cards.findIndex(c => c.dataset.alertId === a.id);
      const nextWith = cards.slice(idx + 1).find(c => c.querySelector('.ack-btn'));
      const prevWith = cards.slice(0, idx).reverse().find(c => c.querySelector('.ack-btn'));
      const card = cards[idx];
      if (nextWith) focusSafe(nextWith.querySelector('.ack-btn') as HTMLElement);
      else if (prevWith) focusSafe(prevWith.querySelector('.ack-btn') as HTMLElement);
      else if (card?.isConnected) focusSafe(card.querySelector('.state-line') as HTMLElement);
      else focusSafe(document.querySelector('.alerts-region') as HTMLElement);
      const i = store.alerts.findIndex(x => x.id === a.id);
      if (i >= 0) store.alerts[i] = updated;
    } catch {
      // offline: keep the card
    }
  };

  const alertsEl = alertsRegion(alerts, (a) => void ack(a));

  // detail pane
  const detail = h('section', { class: 'detail-pane', 'aria-label': 'Detail' });
  const sel = vessels.find(v => v.id === opts.selectedVesselId) ?? null;
  renderVesselDetail(detail, sel, user, opts.onSaveInterval, opts.selectedVesselId);

  const flagsLink = h('a', { class: 'flags-link', href: '/flags', 'aria-label': 'Client flags (0)' }, 'Client flags (0)');
  root.append(
    h('div', { class: 'console-grid fleet' },
      h('aside', { class: 'fleet-rail' },
        alertsEl,
        flagsLink,
        h('section', { 'aria-label': 'Fleet', class: 'fleet-region' },
          h('ul', { 'aria-label': 'Vessels', class: 'vessel-list' }, ...Array.from(vesselList.children)),
        ),
      ),
      h('main', { class: 'chart-pane', 'aria-label': 'Survey chart' },
        h('div', { class: 'chart-holder' },
          h('canvas', { class: 'chart-canvas', 'aria-hidden': 'true' }),
          h('div', { class: 'chart-tools' },
            h('button', { class: 'btn subtle', 'aria-label': 'Zoom in' }, 'Zoom in'),
            h('button', { class: 'btn subtle', 'aria-label': 'Zoom out' }, 'Zoom out'),
            h('button', { class: 'btn subtle', 'aria-label': 'Fit survey area' }, 'Fit survey area'),
          ),
        ),
      ),
      h('section', { class: 'detail-col', 'aria-label': 'Detail' }, detail),
    ),
  );
  // The flags count fills in once it is known; the board itself is already painted.
  void apiFetch<unknown[]>('GET', '/api/flags?state=open')
    .then(f => f.length)
    .then(count => {
      flagsLink.setAttribute('aria-label', `Client flags (${count})`);
      flagsLink.textContent = `Client flags (${count})`;
    })
    .catch(() => undefined);
}

export function renderVesselDetail(
  container: HTMLElement, v: Vessel | null, user: User,
  onSaveInterval: (vesselId: string, hours: number, version: number, noteEl: HTMLElement) => Promise<void>,
  selectedId: string | null,
): void {
  clear(container);
  if (!v && !selectedId) {
    container.append(h('p', {}, 'Select a vessel'));
    return;
  }
  if (!v) {
    container.append(h('p', {}, 'Select a vessel'));
    return;
  }
  const last = v.last_fix;
  const mission = store.missions.find(m => m.id === v.mission_id);
  const facts = h('dl', { class: 'detail-facts' },
    h('div', {}, h('dt', {}, 'Link state'), h('dd', { class: 'mono' }, v.link_state)),
    h('div', {}, h('dt', {}, 'Position'), h('dd', { class: 'mono' }, last ? fmtPos(last.position, store.units) : '—')),
    h('div', {}, h('dt', {}, 'Speed'), h('dd', { class: 'mono' }, last ? fmtSpeed(last.speed_mps, store.units) : '—')),
    h('div', {}, h('dt', {}, 'Battery'), h('dd', { class: 'mono' }, last ? `${Math.round(last.battery_pct)}%` : '—')),
    h('div', {}, h('dt', {}, 'Depth'), h('dd', { class: 'mono' }, last ? `${last.depth_m.toFixed(1)} m` : '—')),
    h('div', {}, h('dt', {}, 'Current line'), h('dd', { class: 'mono' }, v.running_line_id ?? '—')),
    h('div', {}, h('dt', {}, 'Mission'), h('dd', {}, mission ? mission.name : '—')),
    h('div', {}, h('dt', {}, 'Coverage'), h('dd', { class: 'mono' }, mission ? fmtPct(mission.counters.coverage_pct) : '—')),
    h('div', {}, h('dt', {}, 'Hours since service'), h('dd', { class: 'mono' }, fmtHours(v.hours_since_service))),
    h('div', {}, h('dt', {}, 'Service interval'), h('dd', { class: 'mono' }, fmtHours(v.service_interval_h))),
    h('div', {}, h('dt', {}, 'Status'), h('dd', { class: 'mono' }, v.afloat ? 'Afloat' : 'Ashore')),
  );
  container.append(h('h2', { class: 'region-heading' }, `${v.name} detail`), facts);

  if (user.role === 'principal_surveyor') {
    const input = h('input', {
      type: 'number', step: '0.1', min: '50', max: '1000',
      value: String(v.service_interval_h),
      'aria-label': 'Service interval',
      id: 'service-interval-input',
      class: 'mono interval-input',
      dataset: { vesselId: v.id },
    }) as HTMLInputElement;
    let versionRead = v.version;
    input.addEventListener('focus', () => { versionRead = (store.vessels.find(x => x.id === v.id)?.version) ?? versionRead; });
    const currentNote = h('span', { class: 'current-note mono' });
    const save = h('button', {
      class: 'btn primary',
      'aria-label': 'Save interval',
      onclick: () => void onSaveInterval(v.id, Number(input.value), versionRead, currentNote),
    }, 'Save interval');
    const row = h('div', { class: 'interval-row' },
      input, h('span', { class: 'unit' }, 'h'), save, currentNote);
    container.append(h('h3', {}, 'Service interval'), row);
  } else {
    container.append(h('p', { class: 'mono' }, `Service interval ${fmtHours(v.service_interval_h)}`));
  }

  // track replay: scrubs the last ten minutes of fixes
  const replayPosLine = h('p', { class: 'mono replay-line' });
  const slider = h('input', {
    type: 'range', min: '-600', max: '0', step: '10', value: '0',
    'aria-label': 'Track replay', class: 'replay-slider',
  }) as HTMLInputElement;
  const replayValue = (): string => (slider.value === '0' ? 'Now' : `${Math.abs(Number(slider.value))} s ago`);
  slider.setAttribute('aria-valuetext', 'Now');
  const windowFixes: { t: string; position: { easting: number; northing: number }; speed_mps: number }[] = [];
  const applyReplay = (): void => {
    slider.setAttribute('aria-valuetext', replayValue());
    if (slider.value === '0' || windowFixes.length === 0) {
      replayPosLine.textContent = '';
      return;
    }
    const latestT = windowFixes.length ? Date.parse(windowFixes[0]!.t) : 0;
    const replayTime = latestT + Number(slider.value) * 1000;
    let chosen = windowFixes[windowFixes.length - 1]!;
    for (const f of windowFixes) {
      if (Date.parse(f.t) <= replayTime) { chosen = f; break; }
    }
    replayPosLine.textContent = `Replay ${fmtPos(chosen.position, store.units)} · ${fmtTimeUTC(chosen.t)}`;
  };
  slider.addEventListener('input', applyReplay);
  slider.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'PageDown') { e.preventDefault(); slider.value = String(Math.max(-600, Number(slider.value) - 60)); applyReplay(); }
    else if (e.key === 'PageUp') { e.preventDefault(); slider.value = String(Math.min(0, Number(slider.value) + 60)); applyReplay(); }
    else if (e.key === 'Home') { e.preventDefault(); slider.value = '-600'; applyReplay(); }
    else if (e.key === 'End') { e.preventDefault(); slider.value = '0'; applyReplay(); }
  });
  container.append(h('h3', {}, 'Track replay'), replayPosLine, slider);

  // recent fixes
  const fixesList = h('ul', { 'aria-label': 'Recent fixes', class: 'fixes-list', tabindex: '0' });
  container.append(h('h3', {}, 'Recent fixes'), fixesList);
  void apiFetch<{ t: string; position: { easting: number; northing: number }; speed_mps: number }[]>('GET', `/api/vessels/${v.id}/fixes?window_s=600`).then((rows) => {
    windowFixes.push(...rows);
    applyReplay();
    if (!fixesList.isConnected) return;
    clear(fixesList);
    rows.forEach((f, i) => {
      const li = h('li', { class: 'mono fix-row', tabindex: i === 0 ? '0' : '-1' },
        `${fmtTimeUTC(f.t).replace(' UTC', '')} UTC · ${fmtPos(f.position, store.units)} · ${fmtSpeed(f.speed_mps, store.units)}`);
      fixesList.append(li);
    });
  }).catch(() => undefined);
}

// ---------- missions table ----------

export function renderMissionsTable(missions: Mission[]): HTMLElement {
  const rows: HTMLElement[] = [];
  for (const m of missions) {
    rows.push(h('tr', {},
      h('td', {}, h('a', { href: `/missions/${m.id}` }, m.name)),
      h('td', {}, m.client_name ?? ''),
      h('td', { class: 'mono' }, m.survey_date),
      h('td', {}, m.status),
      h('td', { class: 'mono' }, fmtPct(m.counters.coverage_pct)),
    ));
  }
  return h('table', { class: 'table missions-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Client'), h('th', {}, 'Survey date'), h('th', {}, 'Status'), h('th', {}, 'Coverage'))),
    h('tbody', {}, ...rows),
  );
}

// ---------- not found ----------

export function renderNotFound(root: HTMLElement): void {
  clear(root);
  root.append(
    h('div', { class: 'card notfound' },
      h('h1', {}, 'Page not found'),
      h('p', {}, 'That page does not exist or is not shared with you.'),
      h('a', { class: 'btn primary', href: '/' }, 'Go to your home screen'),
    ),
  );
}
