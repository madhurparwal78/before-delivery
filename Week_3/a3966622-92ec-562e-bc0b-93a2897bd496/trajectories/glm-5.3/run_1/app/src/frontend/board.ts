// The dispatcher's board: the pinned Keel Section, the order queue, moves and
// the pilot turn list, with keyboard night planning.

import { el, clear, announce, labelledItem } from './dom.js';
import { get, post, newKey } from './http.js';
import { renderSection, animateHull, type SectionState } from './section.js';
import {
  filterMoves, moveSearch, openDialog, refreshServices, topStrip, type AppCtx,
} from './chrome.js';
import {
  marginMetres, type Eligibility, type Move, type Plan, type PortInfo, type User,
} from './domain.js';

interface BoardState {
  moves: Move[];
  loadedRef: string | null;
  plan: Plan | null;
  planningDay: string;
  handleMinutes: number;
  hullProgress: number;
  search: string;
  stripExpanded: boolean;
  lastAnnounced: { pinchId: string | null; gate: 'open' | 'closed' | null };
  pendingPlan: boolean;
  currentInputs: string | null;
  sectionEl: HTMLElement;
  windows: { from: string; to: string }[];
}

export async function renderBoard(
  container: HTMLElement,
  user: User,
  initial: { move: string | null; q: string },
): Promise<void> {
  const portResult = await get<PortInfo>('/api/port');
  const info = portResult.ok ? portResult.value : fallbackPort();
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user,
    services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container,
    portNow: nowResult.ok ? nowResult.value.now : '',
  };
  const movesResult = await get<{ moves: Move[] }>('/api/moves');
  const state: BoardState = {
    moves: movesResult.ok ? movesResult.value.moves : [],
    loadedRef: null,
    plan: null,
    planningDay: '',
    handleMinutes: 0,
    hullProgress: 0,
    search: initial.q,
    stripExpanded: true,
    lastAnnounced: { pinchId: null, gate: null },
    pendingPlan: false,
    currentInputs: null,
    sectionEl: el('div'),
    windows: [],
  };

  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  void refreshServices(ctx);

  const layout = el('div', { class: 'board-layout' });
  container.append(layout);

  const sectionRegion = el('section', { role: 'region', 'aria-label': 'Keel Section', class: 'keel-section' });
  layout.append(sectionRegion);
  state.sectionEl = sectionRegion;

  const sectionAnnouncements = el('div', { role: 'status', 'aria-label': 'Section announcements', class: 'live-region' });
  const boardAnnouncements = el('div', { role: 'status', 'aria-label': 'Board announcements', class: 'live-region' });

  const stripToggle = el('button', {
    'aria-expanded': 'true',
    class: 'strip-toggle',
  }, 'Waypoint table');
  const strip = el('div', { class: 'waypoint-strip' });
  const stripHolder = el('div', { class: 'strip-holder' }, stripToggle, strip);
  layout.append(stripHolder);

  stripToggle.addEventListener('click', () => {
    state.stripExpanded = !state.stripExpanded;
    stripToggle.setAttribute('aria-expanded', String(state.stripExpanded));
    strip.classList.toggle('hidden', !state.stripExpanded);
  });

  const queueRegion = el('section', { role: 'region', 'aria-label': 'Order queue', class: 'pane order-queue' });
  const movesRegion = el('section', { role: 'region', 'aria-label': 'Moves', class: 'pane moves-pane-wrap' });
  const turnRegion = el('section', { role: 'region', 'aria-label': 'Pilot turn list', class: 'pane pilot-turn-list' });

  const drawerHolder = el('div', { class: 'drawer-holder' });
  const jobsButton = el('button', { class: 'drawer-open' }, 'Jobs');
  const waypointsButton = el('button', { class: 'drawer-open' }, 'Waypoints');

  const moveList = el('div', { class: 'move-list' });
  const search = moveSearch('Search moves', state.moves, (filtered) => {
    renderMoveList(moveList, filtered, state, user);
  }, boardAnnouncements, (q) => {
    state.search = q;
    writeAddress(state);
  }, state.search);

  movesRegion.append(search);
  movesRegion.append(boardAnnouncements);
  movesRegion.append(moveList);

  const panes = el('div', { class: 'panes' }, queueRegion, movesRegion, turnRegion);
  layout.append(panes);
  layout.append(drawerHolder);

  // Below 768 the Jobs drawer holds the queue and turn list, and the
  // Waypoints sheet holds the table. The strip toggle stays for wider views.
  const bottomBar = el('div', { class: 'pilot-bottom board-bottom' }, jobsButton, waypointsButton);
  container.append(bottomBar);
  container.append(sectionAnnouncements);

  waypointsButton.addEventListener('click', () => {
    const sheet = openDialog('Waypoints', waypointsButton);
    const inner = el('div', { class: 'drawer-content' });
    inner.append(el('h2', {}, 'Waypoints'));
    const clone = strip.cloneNode(true) as HTMLElement;
    clone.classList.remove('hidden');
    inner.append(clone);
    inner.append(el('button', { class: 'primary' }, 'Close waypoints').tap((b) => b.addEventListener('click', () => sheet.close())));
    sheet.dialog.append(inner);
  });

  // Phone drawers.
  let jobsDialog: { dialog: HTMLElement; close: () => void } | null = null;
  jobsButton.addEventListener('click', () => {
    jobsDialog = openDialog('Jobs', jobsButton);
    const inner = el('div', { class: 'drawer-content' });
    inner.append(el('h2', {}, 'Order queue'));
    inner.append(queueRegion.cloneNode(true) as HTMLElement);
    inner.append(el('h2', {}, 'Pilot turn list'));
    inner.append(turnRegion.cloneNode(true) as HTMLElement);
    inner.append(el('button', { class: 'primary' }, 'Close jobs').tap((b) => b.addEventListener('click', () => jobsDialog?.close())));
    jobsDialog.dialog.append(inner);
  });

  async function refresh(): Promise<void> {
    const result = await get<{ moves: Move[] }>('/api/moves');
    if (result.ok) state.moves = result.value.moves;
    const pilots = await get<{ pilots: { id: string; name: string; licence_class: string; position: number }[] }>('/api/pilots');
    renderQueue(queueRegion, state, user, loadMove);
    renderMoveList(moveList, filterMoves(state.moves, state.search), state, user);
    renderPilots(turnRegion, pilots.ok ? pilots.value.pilots : []);
    void refreshServices(ctx);
    const stamp = new Date();
    const hh = String(stamp.getUTCHours() + 4).padStart(2, '0');
    const mm = String(stamp.getUTCMinutes()).padStart(2, '0');
    const ss = String(stamp.getUTCSeconds()).padStart(2, '0');
    const stampText = `${stamp.toISOString().slice(0, 10)} ${hh}:${mm}:${ss}`;
    const refreshItem = movesRegion.querySelector<HTMLElement>('.refresh-stamp');
    if (refreshItem) refreshItem.textContent = `Board refreshed ${hh}:${mm}:${ss} port time`;
    else movesRegion.prepend(el('div', { class: 'refresh-stamp num' }, `Board refreshed ${hh}:${mm}:${ss} port time`));
    void stampText;
  }

  async function loadMove(ref: string): Promise<void> {
    state.loadedRef = ref;
    writeAddress(state);
    const result = await get<Move>(`/api/moves/${ref}`);
    if (!result.ok) return;
    const move = result.value;
    const boarding = move.committed ? move.committed.boarding_at : move.boarding_at;
    state.planningDay = boarding.slice(0, 10);
    const [h, m] = boarding.slice(11, 16).split(':');
    state.handleMinutes = Number(h) * 60 + Number(m);
    state.lastAnnounced = { pinchId: null, gate: null };
    await refreshPlan(move, Number(h) * 60 + Number(m));
  }

  async function refreshPlan(move: Move, handleMinutes: number): Promise<void> {
    const day = state.planningDay;
    const hh = String(Math.floor(handleMinutes / 60)).padStart(2, '0');
    const mm = String(handleMinutes % 60).padStart(2, '0');
    const planResult = await get<Plan>(`/api/moves/${move.ref}/plan?boarding_at=${day}T${hh}:${mm}`);
    if (!planResult.ok) return;
    state.plan = planResult.value;
    state.handleMinutes = handleMinutes;
    paintSection(move, user, sectionAnnouncements, state, info);
    await refreshWindows(move, day);
  }

  async function refreshWindows(move: Move, day: string): Promise<void> {
    const result = await get<{ windows: { from: string; to: string }[] }>(`/api/moves/${move.ref}/windows?date=${day}`);
    if (result.ok) state.windows = result.value.windows;
    paintWindows(state);
  }

  void refresh();

  // The 10-second board refresh never moves focus, closes a panel, changes a
  // selection, clears typed text, moves the handle or changes the address.
  window.setInterval(() => {
    void refresh();
  }, 10_000);

  // Select the first queued order when no move parameter is present.
  if (initial.move) {
    await loadMove(initial.move);
  } else {
    const queued = state.moves
      .filter((m) => m.status === 'Ordered')
      .sort((a, b) => a.boarding_at === b.boarding_at ? (a.ref < b.ref ? -1 : 1) : a.boarding_at < b.boarding_at ? -1 : 1);
    if (queued.length > 0) await loadMove(queued[0]!.ref);
    else sectionRegion.append(el('div', { class: 'select-hint' }, 'Select a move to plan'));
  }

  // Board shortcuts work whichever control has focus, except while typing.
  document.addEventListener('keydown', (raw) => {
    const event = raw as KeyboardEvent;
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (event.key === 'n') {
      const queued = state.moves
        .filter((m) => m.status === 'Ordered')
        .sort((a, b) => a.boarding_at === b.boarding_at ? (a.ref < b.ref ? -1 : 1) : a.boarding_at < b.boarding_at ? -1 : 1);
      if (queued.length === 0) return;
      const index = queued.findIndex((m) => m.ref === state.loadedRef);
      const next = queued[(index + 1) % queued.length]!;
      void loadMove(next.ref);
    } else if (event.key === 'k') {
      const slider = sectionRegion.querySelector<HTMLElement>('[aria-label="Boarding time"]');
      if (slider) slider.focus();
    } else if (event.key === 'a') {
      if (state.loadedRef) void openAssignment(state.loadedRef, user);
    }
  });

  async function openAssignment(ref: string, user2: User): Promise<void> {
    void user2;
    const move = state.moves.find((m) => m.ref === ref);
    const button = document.querySelector<HTMLElement>(`[data-plan="${ref}"]`);
    const dialog = openDialog('Assign pilot', button);
    const eligibilityResult = await get<Eligibility>(`/api/moves/${ref}/eligibility`);
    const radio = el('div', { role: 'radiogroup', 'aria-label': 'Pilot', class: 'pilot-radiogroup' });
    let chosen: string | null = eligibilityResult.ok ? eligibilityResult.value.next_eligible : null;
    const note = el('input', { type: 'text', 'aria-label': 'Dispatcher note', class: 'text' });
    const overrideWrap = el('div', { class: 'override-wrap hidden' });
    const override = el('input', { type: 'text', 'aria-label': 'Rest override reason', class: 'text' });
    overrideWrap.append(override);
    if (eligibilityResult.ok) {
      for (const pilot of eligibilityResult.value.turn) {
        const id = `pilot-${pilot.pilot_id}`;
        const radioEl = el('input', { type: 'radio', name: 'pilot', id, value: pilot.pilot_id });
        if (pilot.pilot_id === chosen) radioEl.setAttribute('checked', '');
        radioEl.addEventListener('change', () => {
          chosen = pilot.pilot_id;
          const breaching = pilot.reasons.some((r) => r !== 'licence');
          overrideWrap.classList.toggle('hidden', !breaching);
        });
        radio.append(el('label', { for: id, class: 'pilot-row' },
          radioEl,
          el('span', { class: 'pilot-name' }, `${pilot.name}`),
          el('span', { class: 'pilot-verdict num' }, pilot.eligible ? 'eligible' : pilot.reasons.join(' ')),
        ));
      }
    }
    const close = dialog.close;
    const assign = el('button', { class: 'primary' }, 'Assign');
    let inFlight = false;
    let lastKey: string | null = null;
    assign.addEventListener('click', async () => {
      if (inFlight) return;
      inFlight = true;
      const key = lastKey ?? newKey();
      lastKey = key;
      const noteText = note.value;
      const overrideText = override.value;
      const body: Record<string, unknown> = { pilot_id: chosen };
      if (noteText !== '') body.note = noteText;
      if (!overrideWrap.classList.contains('hidden') && overrideText !== '') body.rest_override_reason = overrideText;
      const fresh = await get<Move>(`/api/moves/${ref}`);
      const version = fresh.ok ? fresh.value.version : move?.version ?? 1;
      const result = await post<Move>(`/api/moves/${ref}/assignment`, body, { key, ifMatch: `"${version}"` });
      inFlight = false;
      if (result.ok) {
        announce(boardAnnouncements, `Pilot ${result.value.pilot?.name ?? ''} assigned to ${ref}`);
        lastKey = null;
        close();
        void refresh();
      } else if ('noReply' in result && result.noReply) {
        announce(boardAnnouncements, 'No reply from the server. Showing the last confirmed state.');
      } else if (result.ok === false && 'failure' in result) {
        const failure = result.failure;
        if (failure.code === 'stale_version' || failure.code === 'illegal_transition') {
          announce(boardAnnouncements, 'Another dispatcher changed this move. Fresh data shown.');
        } else if (failure.code === 'licence_not_covering') {
          announce(boardAnnouncements, `Pilot ${chosen ?? ''} is not licensed for this vessel. Fresh turn list shown.`);
        } else if (failure.code === 'not_next_in_turn') {
          announce(boardAnnouncements, `Pilot ${chosen ?? ''} is not next eligible. Fresh turn list shown.`);
        } else if (failure.code === 'rest_breach') {
          announce(boardAnnouncements, 'Rest rules not met. Type an immediate-safety reason to override.');
        } else if (failure.errors?.rest_override_reason) {
          announce(boardAnnouncements, 'Override reason not accepted. Type 10 to 500 characters for a pilot breaching rest.');
        }
        void refresh();
      }
    });
    dialog.dialog.append(
      el('h2', {}, `Assign pilot to ${move?.vessel.name ?? ref}`),
      radio,
      el('label', { class: 'field-label' }, 'Dispatcher note'),
      note,
      overrideWrap,
      el('div', { class: 'dialog-actions' }, assign, el('button', { class: 'secondary' }, 'Close assignment').tap((b) => b.addEventListener('click', () => close()))),
    );
  }

  function paintSection(move: Move, user2: User, announcements: HTMLElement, state2: BoardState, portInfo: PortInfo): void {
    const plan = state2.plan;
    if (!plan) return;
    clear(state2.sectionEl);
    const holder = el('div', { class: 'section-drawing' });
    const sectionState: SectionState = { plan, hullProgress: state2.hullProgress, animated: true };
    renderSection(holder, portInfo, plan, sectionState);
    state2.sectionEl.append(holder);

    const pinchName = plan.waypoints.find((w) => w.id === plan.pinch.waypoint_id)?.name ?? '';
    const gateOpen = plan.window_state === 'open';

    // Handle: minutes after port midnight, wall-clock, 0 to 1435 in steps of 5.
    const slider = el('input', {
      type: 'range', min: '0', max: '1435', step: '5',
      'aria-label': 'Boarding time',
      'aria-valuetext': `${sliderText(state2.handleMinutes)} port time`,
      value: String(state2.handleMinutes),
      class: 'time-handle',
    });
    slider.addEventListener('input', () => {
      const minutes = Number((slider as HTMLInputElement).value);
      state2.handleMinutes = minutes;
      state2.hullProgress = 0;
      slider.setAttribute('aria-valuetext', `${sliderText(minutes)} port time`);
      void refreshPlan(move, minutes);
    });

    const day = el('input', {
      type: 'text', 'aria-label': 'Planning day', class: 'text num', value: state2.planningDay,
    });
    day.addEventListener('change', () => {
      state2.planningDay = (day as HTMLInputElement).value;
      void refreshPlan(move, state2.handleMinutes);
      void refreshWindows(move, state2.planningDay);
    });

    const windowsGroup = el('div', { role: 'group', 'aria-label': 'Open windows', class: 'open-windows' });
    const gateItem = labelledItem('Gate', gateOpen ? 'Gate open' : 'Gate closed');
    const pinchItem = labelledItem('Pinch', `Pinch ${pinchName} ${marginMetres(plan.pinch.margin_mm)} m`);
    const formula = labelledItem('Formula', 'Clearance = sounded depth + tide at arrival - draught - squat');
    const commit = el('button', { class: 'primary' }, 'Commit window');
    commit.disabled = !gateOpen;
    if (user2.role !== 'dispatcher') commit.classList.add('hidden');

    let commitInFlight = false;
    let commitKey: string | null = null;
    commit.addEventListener('click', async () => {
      if (commitInFlight || !gateOpen) return;
      commitInFlight = true;
      announce(announcements, 'Committing window...');
      const key = commitKey ?? newKey();
      commitKey = key;
      const hh = String(Math.floor(state2.handleMinutes / 60)).padStart(2, '0');
      const mm = String(state2.handleMinutes % 60).padStart(2, '0');
      const result = await post<Move>(`/api/moves/${move.ref}/commit`, {
        boarding_at: `${state2.planningDay}T${hh}:${mm}`,
        tide_version: plan.tide_version,
        draught_mm: plan.draught_mm,
      }, { key, ifMatch: `"${move.version}"` });
      commitInFlight = false;
      if (result.ok) {
        commitKey = null;
        announce(announcements, `Window committed at ${hh}:${mm} port time, pinch ${pinchName} ${marginMetres(result.value.committed?.margin_mm ?? 0)} m`);
        // The hull travels once from boarding ground to berth, then the
        // repaint keeps it resting there.
        state2.hullProgress = 100;
        void animateHull(holder, (progress) => {
          const hull = holder.querySelector('[data-testid="hull"]');
          if (hull) hull.setAttribute('data-progress', String(progress));
        });
        void refresh();
        await refreshPlan(move, state2.handleMinutes);
      } else if ('noReply' in result && result.noReply) {
        announce(announcements, 'No reply from the server. Showing the last confirmed state.');
      } else if (result.ok === false && 'failure' in result) {
        const failure = result.failure;
        commitKey = null;
        if (failure.code === 'stale_version') {
          announce(announcements, 'Commit refused: another dispatcher changed this move. Section redrawn from fresh data.');
        } else if (failure.code === 'stale_plan') {
          announce(announcements, 'Commit refused: the tide table or draught changed. Section redrawn from new values.');
        } else if (failure.code === 'window_closed') {
          const freshPlan = (failure.extra as { plan?: Plan } | undefined)?.plan;
          const name = freshPlan?.waypoints.find((w) => w.id === freshPlan.pinch.waypoint_id)?.name ?? pinchName;
          announce(announcements, `Commit refused: the window no longer clears at ${name}.`);
        } else if (failure.code === 'illegal_transition') {
          announce(announcements, 'Commit refused: that boarding time has passed.');
        } else if (failure.errors?.boarding_at === 'That time does not exist in port time on this date') {
          announce(announcements, 'Commit refused: that time does not exist in port time on this date.');
        }
        const fresh = await get<Move>(`/api/moves/${move.ref}`);
        if (fresh.ok) {
          state2.hullProgress = 0;
          await refreshPlan(fresh.value, state2.handleMinutes);
        }
      }
    });

    state2.sectionEl.append(
      el('div', { class: 'section-controls' },
        slider,
        day,
        pinchItem,
        gateItem,
        formula,
        commit,
      ),
    );
    state2.sectionEl.append(windowsGroup);
    paintWindows(state2);

    // Waypoint table.
    clear(strip);
    const table = el('table', { 'aria-label': 'Waypoints', class: 'waypoints-table' });
    const head = el('tr', {},
      el('th', {}, 'Waypoint'), el('th', {}, 'Arrives'), el('th', {}, 'Leg speed'),
      el('th', {}, 'Squat'), el('th', {}, 'Water'), el('th', {}, 'Clearance'),
      el('th', {}, 'Required'), el('th', {}, 'Margin'),
    );
    table.append(el('thead', {}, head));
    const body = el('tbody', {});
    for (let i = 0; i < plan.waypoints.length; i++) {
      const wp = plan.waypoints[i]!;
      const water = portInfo.waypoints[i]!.sounded_depth_mm + wp.tide_mm;
      body.append(el('tr', { class: wp.margin_mm < 0 ? 'negative' : '' },
        el('td', {}, wp.name),
        el('td', { class: 'num' }, `${wp.arrival_at.slice(0, 5)} ${wp.arrival_utc_offset === '-03:00' ? 'ADT' : 'AST'}`),
        el('td', { class: 'num' }, `${wp.leg_speed_kn} kn`),
        el('td', { class: 'num' }, `${(wp.squat_mm / 1000).toFixed(2)} m`),
        el('td', { class: 'num' }, `${(water / 1000).toFixed(2)} m`),
        el('td', { class: 'num' }, `${(wp.clearance_mm / 1000).toFixed(2)} m / ${feetInches(wp.clearance_mm)}`),
        el('td', { class: 'num' }, `${(wp.required_mm / 1000).toFixed(2)} m`),
        el('td', { class: `num ${wp.margin_mm < 0 ? 'neg' : 'pos'}` }, marginMetres(wp.margin_mm)),
      ));
    }
    table.append(body);
    strip.append(table);
  }

  function paintWindows(state2: BoardState): void {
    const group = state2.sectionEl.querySelector<HTMLElement>('[aria-label="Open windows"]');
    if (!group) return;
    clear(group);
    if (state2.windows.length === 0) {
      group.append(el('div', { class: 'no-windows' }, 'No open window on this day'));
      return;
    }
    for (const window_ of state2.windows) {
      group.append(el('button', { class: 'window-button num' }, `Open window ${window_.from} to ${window_.to}`).tap((b) => {
        b.addEventListener('click', () => {
          const [h, m] = window_.from.split(':').map(Number);
          state2.handleMinutes = h! * 60 + m!;
          const move = state2.moves.find((mv) => mv.ref === state2.loadedRef);
          if (move) void refreshPlan(move, h! * 60 + m!);
        });
      }));
    }
  }

  function renderQueue(node: HTMLElement, state2: BoardState, user2: User, load: (ref: string) => void): void {
    void user2;
    clear(node);
    node.append(el('h2', {}, 'Order queue'));
    const queued = state2.moves
      .filter((m) => m.status === 'Ordered')
      .sort((a, b) => a.boarding_at === b.boarding_at ? (a.ref < b.ref ? -1 : 1) : a.boarding_at < b.boarding_at ? -1 : 1);
    if (queued.length === 0) {
      node.append(el('div', { class: 'empty' }, 'No queued orders'));
      return;
    }
    for (const move of queued) {
      node.append(el('button', { class: 'queue-item', 'data-plan': move.ref },
        `Plan ${move.ref} ${move.vessel.name}`).tap((b) => b.addEventListener('click', () => load(move.ref))));
    }
  }

  function renderMoveList(node: HTMLElement, moves: readonly Move[], _state2: BoardState, user2: User): void {
    clear(node);
    for (const move of moves) {
      const row = el('div', { class: 'move-row' });
      row.append(el('span', { class: `status status-${move.status.replace(/\s+/g, '-')}` }, move.status));
      row.append(el('span', { class: 'num' }, `${move.ref} ${move.vessel.name} ${move.boarding_at.replace('T', ' ')}`));
      if (move.committed) {
        row.append(el('span', { class: 'num' }, `${move.committed.boarding_at.replace('T', ' ')} ${move.committed.pinch_waypoint} ${marginMetres(move.committed.margin_mm)}`));
      }
      row.append(el('button', { class: 'link' }, `Open ${move.ref}`).tap((b) => b.addEventListener('click', () => {
        window.location.href = `/moves/${move.ref}`;
      })));
      if (user2.role === 'dispatcher' && move.status === 'Window committed') {
        row.append(el('button', { class: 'link' }, `Assign pilot to ${move.ref}`).tap((b) => b.addEventListener('click', () => {
          void openAssignment(move.ref, user2);
        })));
      }
      node.append(row);
    }
    const empty = node.querySelector('.empty-list');
    if (!empty && moves.length === 0) node.append(el('div', { class: 'empty-list' }, 'No moves'));
  }

  // The board's turn list shows the rota; the eligibility verdicts come from the
  // assignment panel.
  function renderPilots(node: HTMLElement, pilots: { id: string; name: string; licence_class: string; position: number }[]): void {
    clear(node);
    node.append(el('h2', {}, 'Pilot turn list'));
    if (pilots.length === 0) {
      node.append(el('div', { class: 'empty' }, 'No turn list'));
      return;
    }
    for (const pilot of pilots) {
      node.append(el('div', { class: 'pilot-row' },
        el('span', { class: 'num' }, String(pilot.position)),
        el('span', { class: 'pilot-name' }, pilot.name),
        el('span', { class: 'num' }, pilot.licence_class),
      ));
    }
  }
}

function sliderText(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function feetInches(mm: number): string {
  const quarters = Math.round((Math.abs(mm) / 25.4) * 4);
  const inches = Math.floor(quarters / 4);
  const quarterPart = quarters % 4;
  const ft = Math.floor(inches / 12);
  const frac = quarterPart === 0 ? '' : quarterPart === 1 ? '.25' : quarterPart === 2 ? '.5' : '.75';
  return `${ft} ft ${inches % 12}${frac} in`;
}

function writeAddress(state: BoardState): void {
  const url = new URL(window.location.href);
  if (state.loadedRef) url.searchParams.set('move', state.loadedRef);
  else url.searchParams.delete('move');
  if (state.search !== '') url.searchParams.set('q', state.search);
  else url.searchParams.delete('q');
  window.history.replaceState(null, '', url.toString());
}

function fallbackPort(): PortInfo {
  return {
    port: 'Port Ansell', zone: 'America/Halifax', now: '', store_date: '',
    tide_version: 1, step_minutes: 5,
    waypoints: [
      { id: 'W1', name: 'Outer Bar', distance_nm: 3, sounded_depth_mm: 6200, confined: false, time_offset_minutes: 0, height_offset_mm: 0, speed_limit_kn: null },
      { id: 'W2', name: 'Gannet Shoal', distance_nm: 7.5, sounded_depth_mm: 5400, confined: false, time_offset_minutes: 10, height_offset_mm: -100, speed_limit_kn: null },
      { id: 'W3', name: 'Narrows Sill', distance_nm: 12, sounded_depth_mm: 5100, confined: true, time_offset_minutes: 25, height_offset_mm: -200, speed_limit_kn: 8 },
      { id: 'W4', name: 'Mid Reach', distance_nm: 16, sounded_depth_mm: 6800, confined: false, time_offset_minutes: 35, height_offset_mm: -300, speed_limit_kn: null },
      { id: 'W5', name: 'Kettle Bend', distance_nm: 19.5, sounded_depth_mm: 5700, confined: true, time_offset_minutes: 45, height_offset_mm: -400, speed_limit_kn: 7 },
      { id: 'W6', name: 'Inner Sill', distance_nm: 22, sounded_depth_mm: 5300, confined: true, time_offset_minutes: 55, height_offset_mm: -500, speed_limit_kn: 7 },
    ],
  };
}
