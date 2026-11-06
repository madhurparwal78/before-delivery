import { REPORT_PENDING_COPY, UNKNOWN_VESSEL_COPY } from '../../shared/copy.js';
import { fixed } from '../../shared/numbers.js';
import type { CoverageGrid, Holiday, Line, Mission, Track } from '../../shared/types.js';
import { ApiFailure, isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { createChartRegion } from '../components/chartRegion.js';
import { button, clear, el, setText, trapFocus } from '../dom.js';

const COMMENT_LIMIT = 500;

/** The client's survey: coverage, crossline agreement, vessels and line files. */
export const surveyScreen: ScreenFactory = (shell, context): Mounted => {
  const missionId = context.screen.kind === 'survey' ? context.screen.missionId : '';

  const title = el('h1', {});
  const statusWord = el('span', {});
  const coverageValue = el('span', { class: 'mono' }, ['—']);
  const holidaysValue = el('span', { class: 'mono' }, ['—']);
  const remainingValue = el('span', { class: 'mono' }, ['—']);
  const agreementValue = el('span', { class: 'mono' }, ['—']);
  const csvLink = el('a', { href: `/api/missions/${missionId}/coverage.csv` }, [
    'Download coverage CSV',
  ]);

  function group(name: string, value: HTMLElement): HTMLElement {
    return el('div', { role: 'group', 'aria-label': name, class: 'metric' }, [
      el('span', { class: 'metric-label' }, [name]),
      value,
    ]);
  }

  const header = el(
    'section',
    { role: 'region', 'aria-label': 'Mission header', class: 'mission-header' },
    [
      title,
      statusWord,
      group('Coverage', coverageValue),
      group('Open holidays', holidaysValue),
      group('Lines remaining', remainingValue),
      group('Crossline agreement', agreementValue),
      csvLink,
    ],
  );

  const chartRegion = createChartRegion({ lens: false });
  const vesselList = el('ul', { 'aria-label': 'Vessels', class: 'vessel-list' });
  const filterHost = el('div', { class: 'filter-host' });
  const filterNote = el('span', { class: 'filter-note' });
  const filesBody = el('tbody', {});
  const filesTable = el('table', { 'aria-label': 'Line files', class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Line']),
        el('th', { scope: 'col' }, ['Vessel']),
        el('th', { scope: 'col' }, ['Status']),
        el('th', { scope: 'col' }, ['File']),
        el('th', { scope: 'col' }, ['Size']),
        el('th', { scope: 'col' }, ['SHA-256']),
        el('th', { scope: 'col' }, ['Download']),
      ]),
    ]),
    filesBody,
  ]);
  const reportHost = el('div', { class: 'report-host' });
  const flagStatus = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Flags status',
    class: 'live-region',
  });
  shell.registerRegion('Flags status', flagStatus);

  const node = el('section', { class: 'survey' }, [
    header,
    chartRegion.node,
    vesselList,
    filterHost,
    filterNote,
    filesTable,
    reportHost,
    flagStatus,
  ]);

  let mission: Mission | null = null;
  let lines: Line[] = [];
  let vesselFilter = context.query.get('vessel');
  const flagged = new Set<string>();
  let disposed = false;

  function paintFilter(): void {
    clear(filterHost);
    const select = el('select', { 'aria-label': 'Vessel', id: 'vessel-filter' });
    select.append(el('option', { value: '' }, ['All vessels']));
    for (const vessel of mission?.vessels ?? []) {
      select.append(el('option', { value: vessel.id }, [vessel.name]));
    }
    const known = (mission?.vessels ?? []).some((vessel) => vessel.id === vesselFilter);
    select.value = vesselFilter && known ? vesselFilter : '';
    setText(filterNote, vesselFilter && !known ? UNKNOWN_VESSEL_COPY : '');
    select.addEventListener('change', () => {
      vesselFilter = select.value === '' ? null : select.value;
      const params = new URLSearchParams();
      if (vesselFilter) params.set('vessel', vesselFilter);
      window.history.replaceState(
        null,
        '',
        `/surveys/${missionId}${params.toString() ? `?${params.toString()}` : ''}`,
      );
      paintFiles();
      setText(filterNote, '');
    });
    filterHost.append(el('label', { for: 'vessel-filter' }, ['Vessel']), select);
  }

  function paintFiles(): void {
    clear(filesBody);
    const known = (mission?.vessels ?? []).some((vessel) => vessel.id === vesselFilter);
    const visible = lines.filter((line) => {
      if (!['Surveyed', 'Delivered', 'Superseded'].includes(line.status)) return false;
      if (vesselFilter && known) return line.vessel_id === vesselFilter;
      return true;
    });
    for (const line of visible) {
      const row = el('tr', {}, [
        el('td', { class: 'mono' }, [line.label]),
        el('td', {}, [line.vessel_name ?? '']),
        el('td', {}, [line.status]),
        el('td', {}, [line.file ? line.file.state : '']),
        el('td', { class: 'mono' }, [line.file?.size_bytes ? String(line.file.size_bytes) : '']),
        el('td', { class: 'mono sha' }, [line.file?.sha256 ? `SHA-256 ${line.file.sha256}` : '']),
      ]);
      const actions = el('td', {});
      if (line.file?.state === 'Stored') actions.append(downloadControl(line));
      if (line.status === 'Delivered') {
        const flag = button(`Flag ${line.label}`, { class: 'small' });
        flag.addEventListener('click', () => openFlagDialog(line, flag));
        actions.append(flag);
        if (flagged.has(line.id)) actions.append(el('span', {}, ['Flagged']));
      }
      row.append(actions);
      filesBody.append(row);
    }
  }

  /** While storage is reported down, each download control is a disabled button. */
  function downloadControl(line: Line): HTMLElement {
    if (shell.status().storage === 'down') {
      const disabled = button(`Download ${line.label}`, { disabled: true });
      setText(disabled, 'Storage unavailable');
      disabled.setAttribute('aria-label', `Download ${line.label}`);
      return disabled;
    }
    return el('a', { href: `/api/lines/${line.id}/file` }, [`Download ${line.label}`]);
  }

  function paintReport(): void {
    clear(reportHost);
    if (!mission) return;
    if (mission.report.state === 'Pending') {
      reportHost.append(el('p', {}, [REPORT_PENDING_COPY]));
      return;
    }
    if (mission.report.state !== 'Ready') return;
    if (shell.status().storage === 'down') {
      const disabled = button('Download coverage report', { disabled: true });
      setText(disabled, 'Storage unavailable');
      disabled.setAttribute('aria-label', 'Download coverage report');
      reportHost.append(disabled);
      return;
    }
    reportHost.append(
      el('a', { href: `/api/missions/${missionId}/report` }, ['Download coverage report']),
    );
  }

  function openFlagDialog(line: Line, opener: HTMLButtonElement): void {
    const comment = el('textarea', { id: 'flag-comment', rows: '4' });
    const length = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Comment length',
      class: 'live-region',
    }, [`0/${COMMENT_LIMIT}`]);
    const message = el('p', { class: 'field-error' });
    const send = button('Send flag', { class: 'primary' });
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Flag line', class: 'dialog' },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, ['Flag line']),
          el('div', { class: 'field' }, [
            el('label', { for: 'flag-comment' }, ['Comment']),
            comment,
            message,
          ]),
          length,
          send,
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
    // The counter announces only at 450, 490 and 500 characters.
    comment.addEventListener('input', () => {
      const count = comment.value.length;
      if (count === 450 || count === 490 || count === COMMENT_LIMIT) {
        setText(length, `${count}/${COMMENT_LIMIT}`);
      } else {
        length.textContent = `${count}/${COMMENT_LIMIT}`;
      }
    });
    send.addEventListener('click', () => {
      const at = shell.generation;
      void request(`/api/missions/${missionId}/lines/${line.id}/flags`, {
        method: 'POST',
        body: { comment: comment.value },
      })
        .then(() => {
          if (!isCurrent(at) || disposed) return;
          flagged.add(line.id);
          setText(flagStatus, `Flag sent for ${line.label}`);
          close();
          paintFiles();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) {
            setText(message, error.body.errors?.comment ?? error.message);
          }
        });
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    comment.focus();
  }

  async function load(): Promise<void> {
    const at = shell.generation;
    try {
      const [missionRecord, lineRecords, holidayRecords, coverageRecord, trackRecords] =
        await Promise.all([
          request<Mission>(`/api/missions/${missionId}`),
          request<Line[]>(`/api/missions/${missionId}/lines`),
          request<Holiday[]>(`/api/missions/${missionId}/holidays`),
          request<CoverageGrid>(`/api/missions/${missionId}/coverage`),
          request<{ tracks: Track[] }>(`/api/missions/${missionId}/tracks`),
        ]);
      if (!isCurrent(at) || disposed) return;
      mission = missionRecord;
      lines = lineRecords;

      setText(title, mission.name);
      setText(statusWord, mission.status);
      setText(coverageValue, `${fixed(mission.counters.coverage_pct, 1)}%`);
      setText(holidaysValue, String(mission.counters.open_holidays));
      setText(remainingValue, String(mission.counters.lines_remaining));
      const agreement = mission.crossline_agreement;
      setText(
        agreementValue,
        agreement.pct === null ? '—' : `${fixed(agreement.pct, 1)}% of ${agreement.compared}`,
      );

      clear(vesselList);
      for (const vessel of mission.vessels) {
        vesselList.append(
          el('li', {}, [
            el('span', {}, [vessel.name]),
            el('span', {}, [vessel.link_state ?? 'Off survey']),
          ]),
        );
      }

      // The chart's tracks, swaths and holidays come only from this mission.
      chartRegion.setData({
        mission,
        lines,
        tracks: trackRecords.tracks,
        holidays: holidayRecords,
        coverage: coverageRecord,
        vessels: mission.vessels
          .map((entry) => {
            const track = trackRecords.tracks
              .filter((item) => item.vessel_id === entry.id)
              .flatMap((item) => item.points);
            const last = track[track.length - 1];
            if (!last) return null;
            return {
              vessel: {
                id: entry.id,
                name: entry.name,
                last_fix: {
                  t: last.t,
                  position: { easting: last.easting, northing: last.northing },
                  heading_deg: 0,
                  speed_mps: 0,
                  battery_pct: 0,
                  depth_m: last.depth_m,
                },
              } as never,
              label: entry.name,
            };
          })
          .filter((entry): entry is { vessel: never; label: string } => entry !== null),
      });

      paintFilter();
      paintFiles();
      paintReport();
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      if (error instanceof ApiFailure && error.status === 404) shell.notFound();
    }
  }

  shell.onStatus(() => {
    paintFiles();
    paintReport();
  });

  void load();

  return {
    node,
    dispose: () => {
      disposed = true;
      shell.unregisterRegion('Flags status');
    },
  };
};
