import { EMPTY_HOLIDAY_COPY, NO_HOLIDAY_UNDER_LENS } from '../../shared/copy.js';
import { fixed, roundHalfUp } from '../../shared/numbers.js';
import type {
  Alert,
  CoverageGrid,
  Holiday,
  Line,
  Mission,
  Position,
  Track,
  User,
  Vessel,
} from '../../shared/types.js';
import { areaText, lengthText } from '../../shared/units.js';
import { ApiFailure, isCurrent, NoResponse, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { createAlertsRegion } from '../components/alerts.js';
import { createChartRegion } from '../components/chartRegion.js';
import { createCombobox } from '../components/combobox.js';
import { createCoverageTable } from '../components/coverageGrid.js';
import { createFleetRail } from '../components/fleetRail.js';
import { button, clear, el, prefersReducedMotion, reconcile, setText, trapFocus } from '../dom.js';

const REFRESH_MS = 2000;

const KIND_WORD: Record<Line['kind'], string> = {
  planned: 'Planned',
  crossline: 'Crossline',
  infill: 'Infill',
};

type Layout = 'wide' | 'medium' | 'narrow';

function layoutOf(): Layout {
  const width = window.innerWidth;
  if (width >= 1024) return 'wide';
  if (width >= 768) return 'medium';
  return 'narrow';
}

export const missionConsoleScreen: ScreenFactory = (shell, context): Mounted => {
  const missionId = context.screen.kind === 'mission' ? context.screen.missionId : '';
  const user = shell.user as User;
  const isSurveyor = user.role === 'principal_surveyor';

  const announcements = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Fleet announcements',
    class: 'live-region',
  });
  shell.registerRegion('Fleet announcements', announcements);

  // ---- mission header ----
  const title = el('h1', {});
  const statusWord = el('span', { 'data-status': '' });
  const holdNote = el('p', { 'data-hold': '' });
  const coverageGroup = metric('Coverage');
  const holidaysGroup = metric('Open holidays');
  const remainingGroup = metric('Lines remaining');
  const agreementGroup = metric('Crossline agreement');
  const csvLink = el('a', { href: `/api/missions/${missionId}/coverage.csv` }, [
    'Download coverage CSV',
  ]);
  const launchButton = button('Launch mission');
  const abortButton = button('Abort mission');
  const holdButton = button('Hold for weather');
  const resumeButton = button('Resume survey');
  const handOverButton = button('Hand over');
  const geofenceButton = button('Edit geofence');
  const ownerNote = el('span', { 'data-owner': '' });
  const viewAsTable = button('View as table', { 'aria-pressed': 'false' });
  const missionDetailButton = button('Mission detail');

  const header = el(
    'section',
    { role: 'region', 'aria-label': 'Mission header', class: 'mission-header' },
    [
      title,
      statusWord,
      holdNote,
      coverageGroup.node,
      holidaysGroup.node,
      remainingGroup.node,
      agreementGroup.node,
      csvLink,
      viewAsTable,
    ],
  );

  function metric(name: string): { node: HTMLElement; value: HTMLElement } {
    const value = el('span', { class: 'mono' }, ['—']);
    return {
      node: el('div', { role: 'group', 'aria-label': name, class: 'metric' }, [
        el('span', { class: 'metric-label' }, [name]),
        value,
      ]),
      value,
    };
  }

  // ---- panes ----
  const alerts = createAlertsRegion(shell);
  const rail = createFleetRail(shell, (vesselId) => shell.navigate(`/fleet/${vesselId}`));

  const lensReadout = el('div', { role: 'group', 'aria-label': 'Lens readout', class: 'lens-readout' });
  const chartRegion = createChartRegion({
    lens: true,
    onLensMoved: () => paintReadout(),
    onQueueAtLens: () => void queueAtLens(),
  });
  const coverageTable = createCoverageTable(
    (centre, holiday) => paintReadoutFor(centre, holiday ? [holiday] : []),
    (holiday) => {
      if (!holiday) {
        shell.announce('Fleet announcements', NO_HOLIDAY_UNDER_LENS);
        return;
      }
      void queueInfill(holiday);
    },
  );

  const linesBody = el('tbody', {});
  const linesTable = el('table', { 'aria-label': 'Lines', class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Line']),
        el('th', { scope: 'col' }, ['Kind']),
        el('th', { scope: 'col' }, ['Vessel']),
        el('th', { scope: 'col' }, ['Status']),
        el('th', { scope: 'col' }, ['File']),
      ]),
    ]),
    linesBody,
  ]);
  const planSummary = el('div', { role: 'group', 'aria-label': 'Plan summary', class: 'plan-summary' });
  const infillQueues = el('div', { class: 'infill-queues' });
  const holidaysList = el('ul', { 'aria-label': 'Holidays', class: 'holiday-list' });

  const detailContent = el('div', { class: 'detail-content' }, [
    linesTable,
    infillQueues,
    planSummary,
  ]);
  const detailPane = el('aside', { role: 'region', 'aria-label': 'Detail', class: 'detail-pane' });
  const railColumn = el('div', { class: 'rail-column' });
  const narrowList = el('div', { class: 'narrow-list' });
  const node = el('div', { class: 'console mission-console' });

  let missionSheet: HTMLElement | null = null;

  function openMissionSheet(): void {
    if (missionSheet) return;
    const close = button('Close');
    missionSheet = el(
      'div',
      { role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Mission detail', class: 'sheet' },
      [el('div', { class: 'sheet-card' }, [el('h2', {}, ['Mission detail']), close, detailContent])],
    );
    close.addEventListener('click', closeMissionSheet);
    missionSheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMissionSheet();
        return;
      }
      trapFocus(missionSheet!, event);
    });
    shell.openDialogs.add(missionSheet);
    node.append(missionSheet);
    close.focus();
  }

  function closeMissionSheet(): void {
    if (!missionSheet) return;
    shell.openDialogs.delete(missionSheet);
    missionSheet.remove();
    missionSheet = null;
    if (document.contains(missionDetailButton)) missionDetailButton.focus();
  }

  missionDetailButton.addEventListener('click', () => {
    if (missionSheet) closeMissionSheet();
    else openMissionSheet();
  });

  function buildLayout(): void {
    const layout = layoutOf();
    const showHolidays = layout === 'narrow' || prefersReducedMotion();
    node.dataset.layout = layout;
    node.replaceChildren();
    railColumn.replaceChildren(alerts.node, rail.node);
    const chartArea = el('div', { class: 'chart-area' }, [
      chartRegion.node,
      coverageTable.node,
      lensReadout,
    ]);
    coverageTable.node.hidden = !tableView;
    chartRegion.node.hidden = tableView;

    if (layout === 'narrow') {
      narrowList.replaceChildren(
        holidaysList,
        linesTable,
        infillQueues,
        planSummary,
        alerts.node,
        rail.node,
      );
      node.append(header, actionsBar(), announcements, chartArea, narrowList);
    } else if (layout === 'medium') {
      node.append(header, actionsBar(), announcements, railColumn, chartArea);
      if (showHolidays) chartArea.append(holidaysList);
      detailPane.replaceChildren();
      if (!missionSheet) detailContent.remove();
    } else {
      detailPane.replaceChildren(detailContent);
      node.append(header, actionsBar(), announcements, railColumn, chartArea, detailPane);
      if (showHolidays) chartArea.append(holidaysList);
    }
    if (missionSheet) node.append(missionSheet);
  }

  function actionsBar(): HTMLElement {
    const bar = el('div', { class: 'mission-actions' });
    if (isSurveyor) {
      bar.append(launchButton, abortButton, holdButton, resumeButton, handOverButton, geofenceButton, ownerNote);
    }
    if (layoutOf() === 'medium') bar.append(missionDetailButton);
    return bar;
  }

  // ---- state ----
  let mission: Mission | null = null;
  let lines: Line[] = [];
  let holidays: Holiday[] = [];
  let coverage: CoverageGrid | null = null;
  let tracks: Track[] = [];
  let vessels: Vessel[] = [];
  let tableView = context.query.get('view') === 'table';
  let handoverOptions: { value: string; label: string }[] = [];
  const queueing = new Set<string>();
  const knownHolidayStatus = new Map<string, Holiday['status']>();
  let disposed = false;
  let timer: number | null = null;

  viewAsTable.setAttribute('aria-pressed', tableView ? 'true' : 'false');
  viewAsTable.addEventListener('click', () => {
    tableView = !tableView;
    viewAsTable.setAttribute('aria-pressed', tableView ? 'true' : 'false');
    const params = new URLSearchParams(window.location.search);
    if (tableView) params.set('view', 'table');
    else params.delete('view');
    window.history.replaceState(
      null,
      '',
      `/missions/${missionId}${params.toString() ? `?${params.toString()}` : ''}`,
    );
    buildLayout();
    paintAll();
  });

  // ---- lens readout ----
  function paintReadout(): void {
    const centre = chartRegion.chart.readoutPosition();
    const inside = chartRegion.chart.holidaysInLens().map((entry) => entry.holiday);
    paintReadoutFor(centre, inside);
  }

  function paintReadoutFor(centre: Position | null, inside: Holiday[]): void {
    clear(lensReadout);
    if (centre) {
      lensReadout.append(
        el('p', { class: 'mono' }, [chartRegion.chart.positionLabel(centre)]),
      );
    }
    const open = holidays.filter((holiday) => holiday.status !== 'Closed');
    if (open.length === 0) {
      lensReadout.append(el('p', {}, [EMPTY_HOLIDAY_COPY]));
      return;
    }
    for (const holiday of inside) {
      lensReadout.append(
        el('p', {}, [`${holiday.label} · ${areaText(holiday.area_m2, shell.units)}`]),
      );
    }
  }

  // ---- infill ----
  async function queueAtLens(): Promise<void> {
    const target =
      chartRegion.chart.holidayUnderCentre() ??
      chartRegion.chart.holidaysInLens()[0]?.holiday ??
      null;
    if (!target) {
      shell.announce('Fleet announcements', NO_HOLIDAY_UNDER_LENS);
      return;
    }
    await queueInfill(target);
  }

  /**
   * The overlay, Queued-to text and changed counters appear only after the server
   * confirms. Repeated input while pending sends nothing.
   */
  async function queueInfill(holiday: Holiday, control?: HTMLButtonElement): Promise<void> {
    if (queueing.has(holiday.id)) return;
    queueing.add(holiday.id);
    if (control) {
      setText(control, 'Queueing…');
      control.disabled = true;
    }
    shell.announce('Fleet announcements', `Queueing infill for ${holiday.label}`);
    const at = shell.generation;
    try {
      const result = await request<{ line: Line; counters: Mission['counters'] }>(
        `/api/missions/${missionId}/holidays/${holiday.id}/infill`,
        { method: 'POST', body: {} },
      );
      if (!isCurrent(at) || disposed) return;
      const vesselName = result.line.vessel_name ?? '';
      const already = holiday.status === 'Queued';
      shell.announce(
        'Fleet announcements',
        already
          ? `Infill ${result.line.label} is already queued to ${vesselName}`
          : `Infill ${result.line.label} queued to ${vesselName}`,
      );
      await refresh();
      focusNewInfillRow(result.line.id, control);
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      if (error instanceof NoResponse) {
        shell.announce(
          'Fleet announcements',
          `Could not reach Swathdeck — ${holiday.label} is not queued yet`,
        );
      } else if (error instanceof ApiFailure) {
        shell.announce('Fleet announcements', error.message);
      }
    } finally {
      queueing.delete(holiday.id);
      if (control) {
        setText(control, 'Queue infill');
        control.disabled = false;
        control.focus();
      }
    }
  }

  function focusNewInfillRow(lineId: string, control?: HTMLButtonElement): void {
    if (layoutOf() === 'medium' && !missionSheet) {
      control?.focus();
      return;
    }
    const row = linesBody.querySelector<HTMLElement>(`[data-line="${lineId}"]`);
    if (row) {
      row.focus();
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- painting ----
  function paintHeader(): void {
    if (!mission) return;
    setText(title, mission.name);
    setText(statusWord, mission.status);
    setText(
      holdNote,
      mission.hold ? `On hold: ${mission.hold.reason}` : '',
    );
    tint(coverageGroup.value, `${fixed(mission.counters.coverage_pct, 1)}%`);
    tint(holidaysGroup.value, String(mission.counters.open_holidays));
    tint(remainingGroup.value, String(mission.counters.lines_remaining));
    const agreement = mission.crossline_agreement;
    tint(
      agreementGroup.value,
      agreement.pct === null ? '—' : `${fixed(agreement.pct, 1)}% of ${agreement.compared}`,
    );

    const owned = mission.owner_id === user.id;
    for (const control of [launchButton, abortButton, handOverButton, geofenceButton, holdButton, resumeButton]) {
      control.disabled = !owned;
    }
    setText(ownerNote, owned ? '' : `Owned by ${mission.owner_name}`);
    launchButton.hidden = mission.status !== 'Planned';
    abortButton.hidden = !['Launched', 'Surveying', 'Recovering'].includes(mission.status);
    holdButton.hidden = mission.status !== 'Surveying' || mission.hold !== null;
    resumeButton.hidden = mission.hold === null;
  }

  function tint(node_: HTMLElement, value: string): void {
    if (node_.textContent === value) return;
    setText(node_, value);
    node_.classList.remove('counter-changed');
    void node_.offsetWidth;
    node_.classList.add('counter-changed');
  }

  function paintPlanSummary(): void {
    if (!mission) return;
    clear(planSummary);
    const order = mission.survey_order === 'special' ? 'Special Order' : 'Order 1a';
    for (const [label, value] of [
      ['Survey order', order],
      ['Lines', String(mission.line_count)],
      ['Crosslines', String(mission.crossline_count)],
      ['Estimated duration', `${roundHalfUp(mission.estimated_duration_s / 60)} min`],
      ['Swath width', lengthText(mission.swath_width_m, shell.units)],
      ['Line spacing', lengthText(mission.line_spacing_m, shell.units)],
    ]) {
      planSummary.append(
        el('p', {}, [el('span', {}, [`${label}: `]), el('span', { class: 'mono' }, [value!])]),
      );
    }
  }

  function paintLines(): void {
    reconcile(
      linesBody,
      lines,
      (line) => line.id,
      (line) =>
        el('tr', { tabindex: '-1', 'data-line': line.id }, [
          el('td', { class: 'mono' }, [line.label]),
          el('td', {}, [KIND_WORD[line.kind]]),
          el('td', {}, []),
          el('td', {}, []),
          el('td', {}, []),
          el('td', {}, []),
        ]),
      (row, line) => {
        const cells = row.children;
        setText(cells[0]!, line.label);
        setText(cells[1]!, KIND_WORD[line.kind]);
        setText(cells[2]!, line.vessel_name ?? '');
        setText(cells[3]!, line.status);
        setText(cells[4]!, line.file ? line.file.state : '');
        const actions = cells[5]!;
        const canRerun =
          isSurveyor && (line.status === 'Surveyed' || line.status === 'Delivered') && line.kind !== 'infill';
        const existing = actions.querySelector('button');
        if (canRerun && !existing) {
          const rerun = button(`Re-run ${line.label}`, { class: 'small' });
          rerun.addEventListener('click', () => openRerunDialog(line, rerun));
          actions.append(rerun);
        } else if (!canRerun && existing) {
          existing.remove();
        }
      },
    );
  }

  function paintHolidays(): void {
    const open = holidays.filter((holiday) => holiday.status !== 'Closed');
    if (open.length === 0) {
      clear(holidaysList);
      holidaysList.append(el('li', {}, [EMPTY_HOLIDAY_COPY]));
      return;
    }
    reconcile(
      holidaysList,
      open,
      (holiday) => holiday.id,
      () => el('li', {}, [el('span', { 'data-text': '' }), el('span', { 'data-queued': '' })]),
      (row, holiday) => {
        const nearest = holiday.nearest_vessel
          ? `nearest ${holiday.nearest_vessel.name}`
          : 'no eligible vessel';
        setText(
          row.querySelector('[data-text]')!,
          `${holiday.label} · ${areaText(holiday.area_m2, shell.units)} · ${nearest}`,
        );
        const queuedTo =
          holiday.status === 'Queued' && holiday.infill_line_id
            ? lines.find((line) => line.id === holiday.infill_line_id)?.vessel_name
            : null;
        setText(row.querySelector('[data-queued]')!, queuedTo ? `Queued to ${queuedTo}` : '');
        let control = row.querySelector<HTMLButtonElement>('button');
        if (!control && isSurveyor) {
          control = button('Queue infill', {
            'aria-label': `Queue infill ${holiday.label}`,
            class: 'small',
          });
          row.append(control);
        }
        if (control) {
          control.setAttribute('aria-label', `Queue infill ${holiday.label}`);
          control.onclick = () => void queueInfill(holiday, control!);
        }
      },
    );
  }

  /**
   * One infill queue list for each vessel that has queued infill lines. The lists
   * and their rows are updated in place, so a refresh never moves focus off the
   * row the surveyor is reordering.
   */
  function paintInfillQueues(): void {
    const byVessel = new Map<string, Line[]>();
    for (const line of lines) {
      if (line.kind !== 'infill' || line.status !== 'Assigned' || !line.vessel_id) continue;
      const list = byVessel.get(line.vessel_id);
      if (list) list.push(line);
      else byVessel.set(line.vessel_id, [line]);
    }
    const groups = [...byVessel.entries()].map(([vesselId, queued]) => ({
      vesselId,
      vesselName: queued[0]!.vessel_name ?? '',
      queued,
    }));

    reconcile(
      infillQueues,
      groups,
      (group) => group.vesselId,
      (group) =>
        el('ul', {
          'aria-label': `Infill queue for ${group.vesselName}`,
          class: 'infill-queue',
        }),
      (list, group) => {
        list.setAttribute('aria-label', `Infill queue for ${group.vesselName}`);
        reconcile(
          list,
          group.queued.map((line, index) => ({ line, index })),
          (entry) => entry.line.id,
          () => el('li', { tabindex: '0' }),
          (row, entry) => {
            row.dataset.line = entry.line.id;
            const holiday = holidays.find((item) => item.id === entry.line.holiday_id);
            setText(
              row,
              `${entry.index + 1}. ${entry.line.label} · ${holiday ? holiday.label : ''}`,
            );
            row.onkeydown = (event) => {
              if (!event.altKey) return;
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              void reorder(
                group.vesselId,
                group.queued.map((item) => item.id),
                entry.index,
                event.key === 'ArrowUp' ? -1 : 1,
                entry.line,
              );
            };
          },
        );
      },
    );
  }

  async function reorder(
    vesselId: string,
    order: string[],
    index: number,
    direction: number,
    line: Line,
  ): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    const at = shell.generation;
    try {
      await request<{ line_ids: string[] }>(
        `/api/missions/${missionId}/vessels/${vesselId}/infill-order`,
        { method: 'PUT', body: { line_ids: next } },
      );
      if (!isCurrent(at) || disposed) return;
      shell.announce(
        'Fleet announcements',
        `${line.label} moved to position ${target + 1} of ${next.length}`,
      );
      await refresh();
      const row = infillQueues.querySelector<HTMLElement>(`[data-line="${line.id}"]`);
      row?.focus();
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      if (error instanceof NoResponse) {
        shell.announce('Fleet announcements', 'Could not reach Swathdeck — the infill order is unchanged');
        return;
      }
      if (error instanceof ApiFailure) shell.announce('Fleet announcements', error.message);
    }
  }

  function paintInfillOverlays(): void {
    const open = lines.filter(
      (line) => line.kind === 'infill' && (line.status === 'Assigned' || line.status === 'Running'),
    );
    reconcile(
      chartRegion.overlayHost,
      open,
      (line) => line.id,
      (line) =>
        el('div', { role: 'img', 'aria-label': `Infill ${line.label}`, class: 'infill-overlay' }),
      (overlay, line) => overlay.setAttribute('aria-label', `Infill ${line.label}`),
    );
  }

  function announceHolidayClosings(): void {
    for (const holiday of holidays) {
      const previous = knownHolidayStatus.get(holiday.id);
      if (previous !== undefined && previous !== 'Closed' && holiday.status === 'Closed') {
        shell.announce('Fleet announcements', `${holiday.label} closed`);
      }
      knownHolidayStatus.set(holiday.id, holiday.status);
    }
  }

  function paintAll(): void {
    paintHeader();
    paintPlanSummary();
    paintLines();
    paintHolidays();
    paintInfillQueues();
    paintInfillOverlays();
    paintReadout();
    if (tableView) coverageTable.update(coverage, holidays);
  }

  // ---- mission actions ----
  function missionAction(to: string, pending: string, done: string): () => void {
    return () => {
      shell.announce('Fleet announcements', pending);
      const at = shell.generation;
      void request<Mission>(`/api/missions/${missionId}/transitions`, {
        method: 'POST',
        body: { to },
      })
        .then(() => {
          if (!isCurrent(at) || disposed) return;
          shell.announce('Fleet announcements', done);
          void refresh();
        })
        .catch((error: unknown) => {
          if (!isCurrent(at) || disposed) return;
          if (error instanceof ApiFailure) shell.announce('Fleet announcements', error.message);
        });
    };
  }

  launchButton.addEventListener('click', missionAction('Launched', 'Launching mission', 'Mission launched'));
  abortButton.addEventListener('click', () => openAbortDialog());

  function openAbortDialog(): void {
    const confirm = button('Abort mission', { class: 'primary' });
    const keep = button('Keep surveying');
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Abort mission', class: 'dialog' },
      [el('div', { class: 'dialog-card' }, [el('h2', {}, ['Abort mission']), confirm, keep])],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      abortButton.focus();
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    keep.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      close();
      missionAction('Aborted', 'Aborting mission', 'Mission aborted')();
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    confirm.focus();
  }

  function simpleDialog(
    label: string,
    fieldLabel: string,
    submitLabel: string,
    opener: HTMLButtonElement,
    send: (value: string, fail: (message: string) => void) => void,
  ): void {
    const input = el('textarea', { id: 'dialog-reason', rows: '3' });
    const message = el('p', { class: 'field-error' });
    const submit = button(submitLabel, { class: 'primary' });
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': label, class: 'dialog' },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, [label]),
          el('div', { class: 'field' }, [
            el('label', { for: 'dialog-reason' }, [fieldLabel]),
            input,
            message,
          ]),
          submit,
        ]),
      ],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      if (document.contains(opener)) opener.focus();
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    submit.addEventListener('click', () => {
      send(input.value, (text) => setText(message, text));
    });
    dialog.dataset.close = 'true';
    (dialog as HTMLElement & { closeDialog?: () => void }).closeDialog = close;
    shell.openDialogs.add(dialog);
    node.append(dialog);
    input.focus();
  }

  holdButton.addEventListener('click', () => {
    simpleDialog('Hold for weather', 'Reason', 'Hold survey', holdButton, (reason, fail) => {
      const at = shell.generation;
      void request<Mission>(`/api/missions/${missionId}/hold`, { method: 'POST', body: { reason } })
        .then(() => {
          if (!isCurrent(at) || disposed) return;
          shell.announce('Fleet announcements', 'Survey held');
          closeTopDialog();
          void refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) fail(error.body.errors?.reason ?? error.message);
        });
    });
  });

  resumeButton.addEventListener('click', () => {
    const at = shell.generation;
    void request<Mission>(`/api/missions/${missionId}/resume`, { method: 'POST', body: {} })
      .then(() => {
        if (!isCurrent(at) || disposed) return;
        shell.announce('Fleet announcements', 'Survey resumed');
        void refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) shell.announce('Fleet announcements', error.message);
      });
  });

  geofenceButton.addEventListener('click', () => {
    simpleDialog('Edit geofence', 'Geofence corners', 'Save geofence', geofenceButton, (text, fail) => {
      const corners = text
        .split('\n')
        .map((row) => row.trim())
        .filter((row) => row.length > 0)
        .map((row) => {
          const [easting, northing] = row.split(',').map((part) => Number(part.trim()));
          return { easting: easting ?? Number.NaN, northing: northing ?? Number.NaN };
        });
      const at = shell.generation;
      void request<Mission>(`/api/missions/${missionId}/geofence`, {
        method: 'PUT',
        body: { geofence: corners, version: mission?.version ?? 1 },
      })
        .then(() => {
          if (!isCurrent(at) || disposed) return;
          shell.announce('Fleet announcements', 'Geofence updated');
          closeTopDialog();
          void refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) fail(error.body.errors?.geofence ?? error.message);
        });
    });
  });

  handOverButton.addEventListener('click', () => {
    const options = handoverOptions.filter((option) => option.value !== user.id);
    const picker = createCombobox('Surveyor', options, options[0]?.value ?? '');
    const submit = button('Hand over', { class: 'primary' });
    const message = el('p', { class: 'field-error' });
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hand over mission', class: 'dialog' },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, ['Hand over mission']),
          picker.node,
          submit,
          message,
        ]),
      ],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      handOverButton.focus();
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    submit.addEventListener('click', () => {
      const at = shell.generation;
      void request<Mission>(`/api/missions/${missionId}/handover`, {
        method: 'POST',
        body: { to_user_id: picker.value(), version: mission?.version ?? 1 },
      })
        .then((updated) => {
          if (!isCurrent(at) || disposed) return;
          shell.announce('Fleet announcements', `Handed ${updated.name} to ${updated.owner_name}`);
          close();
          void refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) {
            setText(message, error.body.errors?.to_user_id ?? error.message);
          }
        });
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    picker.trigger.focus();
  });

  function openRerunDialog(line: Line, opener: HTMLButtonElement): void {
    simpleDialog('Re-run line', 'Reason', 'Create re-run', opener, (reason, fail) => {
      const at = shell.generation;
      void request<{ line: Line }>(`/api/missions/${missionId}/lines/${line.id}/rerun`, {
        method: 'POST',
        body: { reason },
      })
        .then(async (result) => {
          if (!isCurrent(at) || disposed) return;
          shell.announce(
            'Fleet announcements',
            `${result.line.label} added — assign a vessel to run it`,
          );
          closeTopDialog();
          await refresh();
          linesBody.querySelector<HTMLElement>(`[data-line="${result.line.id}"]`)?.focus();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) fail(error.body.errors?.reason ?? error.message);
        });
    });
  }

  function closeTopDialog(): void {
    const dialogs = Array.from(node.querySelectorAll<HTMLElement>('[data-close="true"]'));
    const last = dialogs[dialogs.length - 1];
    const closer = last as (HTMLElement & { closeDialog?: () => void }) | undefined;
    closer?.closeDialog?.();
  }

  // ---- refresh ----
  async function refresh(): Promise<void> {
    if (disposed) return;
    const at = shell.generation;
    try {
      const [missionRecord, lineRecords, holidayRecords, coverageRecord, trackRecords, vesselRecords, alertList] =
        await Promise.all([
          request<Mission>(`/api/missions/${missionId}`),
          request<Line[]>(`/api/missions/${missionId}/lines`),
          request<Holiday[]>(`/api/missions/${missionId}/holidays`),
          request<CoverageGrid>(`/api/missions/${missionId}/coverage`),
          request<{ tracks: Track[] }>(`/api/missions/${missionId}/tracks`),
          request<Vessel[]>('/api/vessels'),
          request<Alert[]>('/api/alerts?status=open'),
        ]);
      if (!isCurrent(at) || disposed) return;
      mission = missionRecord;
      lines = lineRecords;
      holidays = holidayRecords;
      coverage = coverageRecord;
      tracks = trackRecords.tracks;
      const onMission = new Set(mission.vessels.map((entry) => entry.id));
      vessels = vesselRecords.filter((vessel) => onMission.has(vessel.id));

      announceHolidayClosings();
      rail.update(vessels, new Map([[mission.id, mission.counters.coverage_pct]]), shell.units);
      alerts.update(
        alertList.filter((alert) => alert.mission_id === missionId),
        shell.units,
      );
      chartRegion.setData({
        mission,
        lines,
        tracks,
        holidays,
        coverage,
        vessels: vessels
          .filter((vessel) => vessel.last_fix !== null)
          .map((vessel) => ({ vessel, label: vessel.name })),
      });
      paintAll();
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      if (error instanceof ApiFailure && error.status === 404 && mission === null) {
        shell.notFound();
        return;
      }
      // Otherwise the board keeps what it shows and tries again on the next refresh.
    }
  }

  buildLayout();
  void refresh();
  timer = window.setInterval(() => void refresh(), REFRESH_MS);
  window.addEventListener('resize', buildLayout);

  void request<{ id: string; name: string }[]>('/api/principal-surveyors')
    .then((surveyors) => {
      handoverOptions = surveyors.map((surveyor) => ({
        value: surveyor.id,
        label: surveyor.name,
      }));
    })
    .catch(() => undefined);

  return {
    node,
    dispose: () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('resize', buildLayout);
      closeMissionSheet();
      shell.unregisterRegion('Fleet announcements');
    },
  };
};
