// The pilot's phone screen: the next job, its clearances, the Keel Section,
// status actions, the waypoint sheet and the ladder report entry.

import { el, clear, announce } from './dom.js';
import { get, post, newKey, uploadPhoto, type ApiResult } from './http.js';
import { renderSection } from './section.js';
import { refreshServices, topStrip, openDialog, type AppCtx } from './chrome.js';
import {
  clearanceCell, LADDER_DEFECT_CHECKBOXES, marginMetres, money, type Move, type Plan,
  type PortInfo, type User,
} from './domain.js';

export async function renderPilot(container: HTMLElement, user: User): Promise<void> {
  const portResult = await get<PortInfo>('/api/port');
  const info = portResult.ok ? portResult.value : fallbackPort();
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };

  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  void refreshServices(ctx);

  const moveAnnouncements = el('div', { role: 'status', 'aria-label': 'Move announcements', class: 'live-region' });
  const reportAnnouncements = el('div', { role: 'status', 'aria-label': 'Report announcements', class: 'live-region' });

  const layout = el('div', { class: 'pilot-layout' });
  container.append(layout);

  const jobPane = el('div', { class: 'pilot-pane' });
  layout.append(jobPane);

  const sectionRegion = el('section', { role: 'region', 'aria-label': 'Keel Section', class: 'keel-section pilot-section' });
  layout.append(sectionRegion);

  const jobsButton = el('button', { class: 'drawer-open' }, 'Jobs');
  const waypointsButton = el('button', { class: 'drawer-open' }, 'Waypoints');
  const bottomBar = el('div', { class: 'pilot-bottom' }, jobsButton, waypointsButton);
  container.append(bottomBar);
  container.append(moveAnnouncements);
  container.append(reportAnnouncements);

  let currentMove: Move | null = null;
  let currentPlan: Plan | null = null;

  async function refresh(): Promise<void> {
    const result = await get<{ move: Move | null; plan: Plan | null }>('/api/me/next-job');
    currentMove = result.ok ? result.value.move : null;
    currentPlan = result.ok ? result.value.plan : null;
    paint();
    void refreshServices(ctx);
  }

  function paint(): void {
    clear(jobPane);
    if (!currentMove) {
      jobPane.append(el('h1', {}, 'No next job'));
      jobPane.append(el('p', {}, 'You have no current assignment.'));
      clear(sectionRegion);
      return;
    }
    const move = currentMove;
    jobPane.append(el('h1', {}, `${move.vessel.name}`));
    jobPane.append(el('div', { class: 'num job-meta' }, `${move.ref} ${move.boarding_at.replace('T', ' ')} ${move.status}${move.detained ? ' - detained' : ''}`));

    const clearances = el('div', { class: 'pilot-clearances' });
    if (currentPlan) {
      for (const wp of currentPlan.waypoints) {
        clearances.append(el('div', { class: 'clearance-row' },
          el('span', { class: 'clearance-name' }, wp.name),
          el('span', { class: `num ${wp.margin_mm < 0 ? 'neg' : 'pos'}` }, `${clearanceCell(wp.clearance_mm)} / ${marginMetres(wp.margin_mm)}`),
        ));
      }
      if (currentPlan.estimate.total_cents > 0) {
        clearances.append(el('div', { class: 'num' }, `Estimate ${money(currentPlan.estimate.total_cents)} CAD`));
      }
    }
    jobPane.append(clearances);

    // Status actions, present only when the last confirmed status permits them.
    const actions = el('div', { class: 'pilot-actions' });
    const canAct = move.pilot !== null && move.pilot.id === user.id;
    if (canAct && move.status === 'Pilot assigned') {
      actions.append(actionButton('Confirm pilot away', async (key) => {
        return post<Move>(`/api/moves/${move.ref}/transitions`, { to: 'Pilot away' }, { key });
      }));
    }
    if (canAct && move.status === 'Pilot away') {
      actions.append(actionButton('Confirm boarding', async (key) => {
        return post<Move>(`/api/moves/${move.ref}/transitions`, { to: 'On board' }, { key });
      }));
    }
    if (canAct && move.status === 'On board') {
      actions.append(actionButton('Start detention', async (key) => {
        return post<Move>(`/api/moves/${move.ref}/detention`, { action: 'start' }, { key });
      }));
    }
    if (canAct && move.status === 'On board' && move.detained) {
      actions.append(actionButton('Stop detention', async (key) => {
        return post<Move>(`/api/moves/${move.ref}/detention`, { action: 'stop' }, { key });
      }));
    }
    if (canAct && (move.status === 'Pilot away' || move.status === 'On board')) {
      actions.append(el('button', { class: 'primary' }, 'Complete move').tap((b) => b.addEventListener('click', async () => {
        const key = newKey();
        const result = await post<Move>(`/api/moves/${move.ref}/transitions`, { to: 'Completed' }, { key });
        await handleActionResult(result, 'Move completed. Charges post when the billing provider confirms.');
      })));
      actions.append(el('button', { class: 'primary' }, 'File ladder report').tap((b) => b.addEventListener('click', () => {
        void openReport(move);
      })));
    }
    jobPane.append(actions);

    if (move.status === 'Refused at ladder') {
      jobPane.append(el('h2', {}, 'Boarding refused at ladder'));
    }

    // Section with the touch handle.
    if (currentPlan) {
      clear(sectionRegion);
      const holder = el('div', { class: 'section-drawing' });
      renderSection(holder, info, currentPlan, { plan: currentPlan, hullProgress: 0, animated: true });
      sectionRegion.append(holder);
      const slider = el('input', {
        type: 'range', min: '0', max: '1435', step: '5',
        'aria-label': 'Boarding time',
        class: 'time-handle',
        value: minutesOf(move.boarding_at),
      });
      slider.addEventListener('input', () => {
        const minutes = Number((slider as HTMLInputElement).value);
        void reloadPlan(minutes);
      });
      sectionRegion.append(el('div', { class: 'section-controls' }, slider));
    }
  }

  async function reloadPlan(minutes: number): Promise<void> {
    if (!currentMove) return;
    const day = currentMove.boarding_at.slice(0, 10);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    const result = await get<Plan>(`/api/moves/${currentMove.ref}/plan?boarding_at=${day}T${hh}:${mm}`);
    if (result.ok) {
      currentPlan = result.value;
      paint();
    }
  }

  function actionButton(label: string, run: (key: string) => Promise<ApiResult<Move>>): HTMLElement {
    return el('button', { class: 'primary' }, label).tap((b) => b.addEventListener('click', async () => {
      const key = newKey();
      const result = await run(key);
      await handleActionResult(result, `Status now ${label.replace('Confirm ', '')}`);
    }));
  }

  async function handleActionResult(result: ApiResult<Move>, successText: string): Promise<void> {
    if (result.ok) {
      announce(moveAnnouncements, successText);
      await refresh();
    } else if ('noReply' in result && result.noReply) {
      announce(moveAnnouncements, 'No reply from the server. Showing the last confirmed state.');
    } else {
      announce(moveAnnouncements, 'This action is not available for the move\'s current status.');
    }
  }

  async function openReport(move: Move): Promise<void> {
    const dialog = openDialog('Ladder report', document.activeElement as HTMLElement | null);
    const formErrors = el('div', { role: 'alert', 'aria-label': 'Form errors', class: 'form-errors' });

    const stateGroup = el('div', { role: 'radiogroup', 'aria-label': 'Ladder state', class: 'radiogroup' });
    const compliant = el('input', { type: 'radio', name: 'ladder-state', id: 'ls-compliant', value: 'compliant' }) as HTMLInputElement;
    const nonCompliant = el('input', { type: 'radio', name: 'ladder-state', id: 'ls-non', value: 'non-compliant' }) as HTMLInputElement;
    stateGroup.append(el('label', { for: 'ls-compliant' }, compliant, 'Compliant'));
    stateGroup.append(el('label', { for: 'ls-non' }, nonCompliant, 'Non-compliant'));

    const fromGroup = el('div', { role: 'radiogroup', 'aria-label': 'Filed from', class: 'radiogroup' });
    const fromDeck = el('input', { type: 'radio', name: 'filed-from', id: 'ff-deck', value: 'deck', checked: '' }) as HTMLInputElement;
    const fromBoat = el('input', { type: 'radio', name: 'filed-from', id: 'ff-boat', value: 'pilot_boat' }) as HTMLInputElement;
    fromGroup.append(el('label', { for: 'ff-deck' }, fromDeck, 'Deck'));
    fromGroup.append(el('label', { for: 'ff-boat' }, fromBoat, 'Pilot boat'));

    const defectsGroup = el('fieldset', { role: 'group', 'aria-label': 'Defects', class: 'defects' });
    const defectChecks: { code: string; input: HTMLInputElement }[] = [];
    for (const defect of LADDER_DEFECT_CHECKBOXES) {
      const input = el('input', { type: 'checkbox', id: `def-${defect.code}` }) as HTMLInputElement;
      defectsGroup.append(el('label', { for: `def-${defect.code}` }, input, defect.name));
      defectChecks.push({ code: defect.code, input });
    }

    const refuse = el('input', { type: 'checkbox', id: 'refuse-boarding' }) as HTMLInputElement;
    const note = el('input', { type: 'text', 'aria-label': 'Report note', class: 'text' }) as HTMLInputElement;

    const photoInput = el('input', { type: 'file', 'aria-label': 'Ladder photo', accept: 'image/jpeg,image/png,image/webp' }) as HTMLInputElement;
    const photoList = el('div', { class: 'photo-list' });
    const storedPhotos: { photo_id: string; sha256: string; size_bytes: number }[] = [];
    let unstoredPhoto: { bytes: Uint8Array; type: string } | null = null;
    let unstoredRow: HTMLElement | null = null;

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (file.size > 5_000_000) {
        announce(reportAnnouncements, 'Photo is over 5,000,000 bytes.');
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (unstoredRow) {
        unstoredRow.remove();
        unstoredRow = null;
        unstoredPhoto = null;
      }
      announce(reportAnnouncements, 'Uploading photo...');
      const result = await uploadPhoto(move.ref, bytes, file.type);
      if (result.ok) {
        storedPhotos.push(result.value);
        const row = el('div', { class: 'photo-row' }, el('span', { class: 'num' }, `Photo stored. SHA-256 ${result.value.sha256}`));
        photoList.append(row);
        announce(reportAnnouncements, `Photo stored. SHA-256 ${result.value.sha256}`);
      } else {
        unstoredPhoto = { bytes, type: file.type };
        unstoredRow = el('div', { class: 'photo-row' },
          el('span', {}, 'Photo not stored'),
          el('button', { class: 'link' }, 'Retry photo upload').tap((b) => b.addEventListener('click', async () => {
            if (!unstoredPhoto) return;
            announce(reportAnnouncements, 'Uploading photo...');
            const retry = await uploadPhoto(move.ref, unstoredPhoto.bytes, unstoredPhoto.type);
            if (retry.ok) {
              storedPhotos.push(retry.value);
              unstoredRow?.remove();
              unstoredRow = null;
              unstoredPhoto = null;
              photoList.append(el('div', { class: 'photo-row' }, el('span', { class: 'num' }, `Photo stored. SHA-256 ${retry.value.sha256}`)));
              announce(reportAnnouncements, `Photo stored. SHA-256 ${retry.value.sha256}`);
            } else if (retry.ok === false && 'failure' in retry && retry.failure.code === 'payload_too_large') {
              announce(reportAnnouncements, 'Photo is over 5,000,000 bytes.');
            } else if (retry.ok === false && 'failure' in retry && retry.failure.code === 'unsupported_media_type') {
              announce(reportAnnouncements, 'Photo is not a JPEG, PNG or WebP image.');
            } else if (retry.ok === false && 'failure' in retry && retry.failure.code === 'storage_unavailable') {
              announce(reportAnnouncements, 'Evidence store unreachable - photo kept on this device, retry when it returns.');
            }
          })),
        );
        photoList.append(unstoredRow);
        if (result.ok === false && 'failure' in result && result.failure.code === 'storage_unavailable') {
          announce(reportAnnouncements, 'Evidence store unreachable - photo kept on this device, retry when it returns.');
        } else if (result.ok === false && 'failure' in result && result.failure.code === 'payload_too_large') {
          announce(reportAnnouncements, 'Photo is over 5,000,000 bytes.');
        } else if (result.ok === false && 'failure' in result && result.failure.code === 'unsupported_media_type') {
          announce(reportAnnouncements, 'Photo is not a JPEG, PNG or WebP image.');
        }
      }
    });

    const file = el('button', { class: 'primary' }, 'File report');
    let fileKey: string | null = null;
    file.addEventListener('click', async () => {
      announce(reportAnnouncements, 'Filing report...');
      const key = fileKey ?? newKey();
      fileKey = key;
      const body: Record<string, unknown> = {
        compliant: compliant.checked,
        defects: defectChecks.filter((d) => d.input.checked).map((d) => d.code),
        refuse_boarding: refuse.checked,
        location: fromBoat.checked ? 'pilot_boat' : 'deck',
        note: note.value,
        photo_ids: storedPhotos.map((p) => p.photo_id),
      };
      const result = await post<{ id: string }>(`/api/moves/${move.ref}/ladder-reports`, body, { key });
      if (result.ok) {
        fileKey = null;
        announce(reportAnnouncements, `Report ${result.value.id} filed`);
        dialog.close();
        await refresh();
      } else if ('noReply' in result && result.noReply) {
        announce(reportAnnouncements, 'No reply from the server. Showing the last confirmed state.');
      } else {
        fileKey = null;
        clear(formErrors);
        const errors = (result.ok === false && 'failure' in result) ? result.failure.errors ?? {} : {};
        for (const [field, message] of Object.entries(errors)) {
          formErrors.append(el('div', { class: 'error-row' }, `${field}: ${message}`));
        }
        const count = Object.keys(errors).length;
        if (count > 0) announce(reportAnnouncements, `${count} fields need attention`);
        else announce(reportAnnouncements, 'This action is not available for the move\'s current status.');
      }
    });

    dialog.dialog.append(
      el('h2', {}, 'Ladder report'),
      stateGroup,
      fromGroup,
      defectsGroup,
      el('label', { for: 'refuse-boarding' }, refuse, 'Refuse boarding'),
      note,
      photoInput,
      photoList,
      file,
      el('button', { class: 'secondary' }, 'Close report').tap((b) => b.addEventListener('click', () => dialog.close())),
      formErrors,
    );
  }

  // Phone drawer: the pilot's current assignments.
  jobsButton.addEventListener('click', () => {
    const dialog = openDialog('Jobs', jobsButton);
    const inner = el('div', { class: 'drawer-content' });
    inner.append(el('h2', {}, 'Your assignments'));
    if (currentMove) {
      inner.append(el('div', { class: 'move-row' }, el('span', { class: 'num' }, `${currentMove.ref} ${currentMove.vessel.name} ${currentMove.status}`)));
      inner.append(el('a', { class: 'link', href: `/moves/${currentMove.ref}` }, `Open ${currentMove.ref}`));
    } else {
      inner.append(el('div', { class: 'empty' }, 'No assignments'));
    }
    inner.append(el('button', { class: 'primary' }, 'Close jobs').tap((b) => b.addEventListener('click', () => dialog.close())));
    dialog.dialog.append(inner);
  });

  // Waypoints bottom sheet.
  waypointsButton.addEventListener('click', () => {
    const dialog = openDialog('Waypoints', waypointsButton);
    const inner = el('div', { class: 'drawer-content' });
    inner.append(el('h2', {}, 'Waypoints'));
    if (currentPlan && info) {
      const table = el('table', { 'aria-label': 'Waypoints', class: 'waypoints-table' });
      table.append(el('thead', {}, el('tr', {},
        el('th', {}, 'Waypoint'), el('th', {}, 'Arrives'), el('th', {}, 'Leg speed'),
        el('th', {}, 'Squat'), el('th', {}, 'Water'), el('th', {}, 'Clearance'),
        el('th', {}, 'Required'), el('th', {}, 'Margin'))));
      const body = el('tbody', {});
      for (let i = 0; i < currentPlan.waypoints.length; i++) {
        const wp = currentPlan.waypoints[i]!;
        const water = info.waypoints[i]!.sounded_depth_mm + wp.tide_mm;
        body.append(el('tr', {},
          el('td', {}, wp.name),
          el('td', { class: 'num' }, `${wp.arrival_at.slice(0, 5)} ${wp.arrival_utc_offset === '-03:00' ? 'ADT' : 'AST'}`),
          el('td', { class: 'num' }, `${wp.leg_speed_kn} kn`),
          el('td', { class: 'num' }, `${(wp.squat_mm / 1000).toFixed(2)} m`),
          el('td', { class: 'num' }, `${(water / 1000).toFixed(2)} m`),
          el('td', { class: 'num' }, clearanceCell(wp.clearance_mm)),
          el('td', { class: 'num' }, `${(wp.required_mm / 1000).toFixed(2)} m`),
          el('td', { class: `num ${wp.margin_mm < 0 ? 'neg' : 'pos'}` }, marginMetres(wp.margin_mm)),
        ));
      }
      table.append(body);
      inner.append(table);
    } else {
      inner.append(el('div', { class: 'empty' }, 'No waypoints'));
    }
    inner.append(el('button', { class: 'primary' }, 'Close waypoints').tap((b) => b.addEventListener('click', () => dialog.close())));
    dialog.dialog.append(inner);
  });

  await refresh();
  window.setInterval(() => {
    void refresh();
  }, 30_000);
}

function minutesOf(boardingAt: string): string {
  const [h, m] = boardingAt.slice(11, 16).split(':').map(Number);
  return String(h! * 60 + m!);
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
