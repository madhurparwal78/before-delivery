import { staleVersionCopy } from '../../shared/copy.js';
import { fixed, intervalText } from '../../shared/numbers.js';
import type { Line, RecentFix, Units, Vessel } from '../../shared/types.js';
import { hoursText, lengthText, positionText, speedText } from '../../shared/units.js';
import { ApiFailure, request } from '../api.js';
import { button, el, reconcile, setText } from '../dom.js';
import type { Shell } from '../shell.js';

const REPLAY_WINDOW_S = 600;

export interface VesselDetail {
  node: HTMLElement;
  update(data: {
    vessel: Vessel;
    fixes: RecentFix[];
    replaySet: RecentFix[];
    line: Line | null;
    missionName: string | null;
    coveragePct: number | null;
    units: Units;
  }): void;
}

function utcTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

/**
 * The selected vessel's detail. Position, speed, battery, coverage and the
 * recent-fixes list change in place, keeping focus and the list's scroll position.
 */
export function createVesselDetail(shell: Shell, editable: boolean): VesselDetail {
  const linkState = el('p', {});
  const position = el('p', {});
  const speed = el('p', {});
  const battery = el('p', {});
  const depth = el('p', {});
  const currentLine = el('p', {});
  const missionName = el('p', {});
  const coverage = el('p', {});
  const service = el('p', {});
  const afloat = el('p', {});

  const intervalInput = el('input', {
    type: 'number',
    id: 'service-interval',
    step: '0.1',
    min: '50',
    max: '1000',
  });
  const intervalCurrent = el('span', { class: 'interval-current' });
  const intervalMessage = el('p', { class: 'field-error', id: 'service-interval-error' });
  const saveInterval = button('Save interval');
  const intervalText_ = el('p', {});

  const replay = el('input', {
    type: 'range',
    id: 'track-replay',
    min: String(-REPLAY_WINDOW_S),
    max: '0',
    step: '10',
    value: '0',
    'aria-label': 'Track replay',
  });
  const replayValue = el('span', { class: 'replay-value' }, ['Now']);

  const fixList = el('ul', { 'aria-label': 'Recent fixes', class: 'fix-list' });

  const fields = el('div', { class: 'detail-fields' }, [
    linkState,
    position,
    speed,
    battery,
    depth,
    currentLine,
    missionName,
    coverage,
    service,
    afloat,
  ]);

  const intervalBlock = editable
    ? el('div', { class: 'field' }, [
        el('label', { for: 'service-interval' }, ['Service interval']),
        intervalInput,
        el('span', { class: 'unit' }, ['h']),
        intervalCurrent,
        saveInterval,
        intervalMessage,
      ])
    : el('div', { class: 'field' }, [intervalText_]);

  const node = el('div', { class: 'detail-body' }, [
    fields,
    intervalBlock,
    el('div', { class: 'field' }, [
      el('label', { for: 'track-replay' }, ['Track replay']),
      replay,
      replayValue,
    ]),
    fixList,
  ]);

  /** The version the detail showed when the surveyor first typed since the last save. */
  let typedVersion: number | null = null;
  let currentVessel: Vessel | null = null;
  let replaySeconds = 0;
  let replaySet: RecentFix[] = [];
  let latestFixT: string | null = null;
  let unitsNow: Units = 'metric';

  intervalInput.addEventListener('input', () => {
    if (typedVersion === null && currentVessel) typedVersion = currentVessel.version;
  });
  intervalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  });
  saveInterval.addEventListener('click', () => {
    void save();
  });

  replay.addEventListener('input', () => {
    replaySeconds = Number(replay.value);
    paintReplay();
  });

  function paintReplay(): void {
    const label = replaySeconds === 0 ? 'Now' : `${Math.abs(replaySeconds)} s ago`;
    setText(replayValue, label);
    replay.setAttribute('aria-valuetext', label);
    if (!currentVessel) return;
    if (replaySeconds === 0) {
      paintLivePosition(currentVessel);
      return;
    }
    const base = latestFixT ? new Date(latestFixT).getTime() : Date.now();
    const target = base + replaySeconds * 1000;
    const ordered = [...replaySet].sort((a, b) => +new Date(a.t) - +new Date(b.t));
    const at = ordered.filter((fix) => +new Date(fix.t) <= target).pop() ?? ordered[0];
    if (!at) return;
    setText(
      position,
      `Replay ${positionText(at.position.easting, at.position.northing, unitsNow)} · ${utcTime(at.t)} UTC`,
    );
  }

  function paintLivePosition(vessel: Vessel): void {
    setText(
      position,
      vessel.last_fix
        ? positionText(vessel.last_fix.position.easting, vessel.last_fix.position.northing, unitsNow)
        : '—',
    );
  }

  async function save(): Promise<void> {
    if (!currentVessel) return;
    const vessel = currentVessel;
    const value = Number(intervalInput.value);
    shell.announce('Fleet announcements', 'Saving interval');
    const at = shell.generation;
    try {
      await request<Vessel>(`/api/vessels/${vessel.id}`, {
        method: 'PATCH',
        body: { service_interval_h: value, version: typedVersion ?? vessel.version },
      });
      if (at !== shell.generation) return;
      typedVersion = null;
      setText(intervalCurrent, '');
      setText(intervalMessage, '');
      shell.announce('Fleet announcements', `Service interval saved for ${vessel.name}`);
    } catch (error) {
      if (at !== shell.generation) return;
      if (error instanceof ApiFailure && error.code === 'stale_version') {
        const current = error.body.current as Vessel | undefined;
        if (current) {
          typedVersion = current.version;
          setText(intervalCurrent, `Current: ${intervalText(current.service_interval_h)} h`);
        }
        shell.announce('Fleet announcements', staleVersionCopy(vessel.name));
        return;
      }
      if (error instanceof ApiFailure && error.body.errors?.service_interval_h) {
        setText(intervalMessage, error.body.errors.service_interval_h);
        return;
      }
      setText(intervalMessage, error instanceof ApiFailure ? error.message : '');
    }
  }

  return {
    node,
    update(data) {
      currentVessel = data.vessel;
      unitsNow = data.units;
      replaySet = data.replaySet;
      latestFixT = data.vessel.last_fix ? data.vessel.last_fix.t : null;

      setText(linkState, data.vessel.link_state);
      setText(speed, data.vessel.last_fix ? speedText(data.vessel.last_fix.speed_mps, data.units) : '—');
      setText(
        battery,
        data.vessel.last_fix ? `${fixed(data.vessel.last_fix.battery_pct, 0)} %` : '—',
      );
      setText(depth, data.vessel.last_fix ? lengthText(data.vessel.last_fix.depth_m, data.units) : '—');
      setText(currentLine, data.line ? data.line.label : '—');
      setText(missionName, data.missionName ?? '—');
      setText(coverage, data.coveragePct === null ? '—' : `${fixed(data.coveragePct, 1)}%`);
      setText(
        service,
        `${hoursText(data.vessel.hours_since_service)} / ${intervalText(data.vessel.service_interval_h)} h`,
      );
      setText(afloat, data.vessel.afloat ? 'Afloat' : 'Ashore');

      if (editable) {
        // Live updates never clear a value being typed.
        if (document.activeElement !== intervalInput && typedVersion === null) {
          intervalInput.value = intervalText(data.vessel.service_interval_h);
        }
      } else {
        setText(intervalText_, `${intervalText(data.vessel.service_interval_h)} h`);
      }

      paintReplay();

      reconcile(
        fixList,
        data.fixes,
        (fix) => fix.t,
        () => el('li', { tabindex: '0' }),
        (row, fix) =>
          setText(
            row,
            `${utcTime(fix.t)} UTC · ${positionText(fix.position.easting, fix.position.northing, data.units)} · ${speedText(fix.speed_mps, data.units)}`,
          ),
      );
    },
  };
}

/** Up and Down move focus between recent-fix rows. */
export function wireFixListKeys(list: HTMLElement): void {
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('li[tabindex]'));
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
  });
}
