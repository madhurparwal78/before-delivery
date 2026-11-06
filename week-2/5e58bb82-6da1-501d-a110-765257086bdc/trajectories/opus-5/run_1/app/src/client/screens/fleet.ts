import type {
  Alert,
  Line,
  Mission,
  MissionSummary,
  RecentFix,
  StaffFlag,
  Vessel,
} from '../../shared/types.js';
import { isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { button, el, setText, trapFocus } from '../dom.js';
import { createAlertsRegion } from '../components/alerts.js';
import { createChartRegion } from '../components/chartRegion.js';
import { createFleetRail } from '../components/fleetRail.js';
import { createVesselDetail, wireFixListKeys } from '../components/vesselDetail.js';

const REFRESH_MS = 2000;

type Layout = 'wide' | 'medium' | 'narrow';

function layoutOf(): Layout {
  const width = window.innerWidth;
  if (width >= 1024) return 'wide';
  if (width >= 768) return 'medium';
  return 'narrow';
}

/** The three-pane fleet board, with its own announcements region. */
export const fleetScreen: ScreenFactory = (shell, context): Mounted => {
  const selectedId =
    context.screen.kind === 'fleetVessel' ? context.screen.vesselId : null;
  let selected = selectedId;

  const announcements = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Fleet announcements',
    class: 'live-region',
  });
  shell.registerRegion('Fleet announcements', announcements);

  const alerts = createAlertsRegion(shell);
  const rail = createFleetRail(shell, (vesselId) => {
    selected = vesselId;
    shell.navigate(`/fleet/${vesselId}`);
  });
  const chartRegion = createChartRegion({ lens: false });

  const flagsLink = el('a', { href: '/flags', class: 'navlink' }, ['Client flags (0)']);
  flagsLink.addEventListener('click', (event) => {
    event.preventDefault();
    shell.navigate('/flags');
  });

  const detail = createVesselDetail(shell, shell.user?.role === 'principal_surveyor');
  const detailPane = el('aside', { role: 'region', 'aria-label': 'Detail', class: 'detail-pane' }, [
    el('p', { 'data-empty': '' }, ['Select a vessel']),
  ]);
  let sheet: HTMLElement | null = null;
  let openerButton: HTMLElement | null = null;

  const railColumn = el('div', { class: 'rail-column' }, [alerts.node, rail.node]);
  const narrowList = el('div', { class: 'narrow-list' });

  const node = el('div', { class: 'console fleet-board' });

  function closeSheet(): void {
    if (!sheet) return;
    shell.openDialogs.delete(sheet);
    sheet.remove();
    sheet = null;
    if (openerButton && document.contains(openerButton)) openerButton.focus();
    openerButton = null;
  }

  /** A closed sheet is absent from the accessibility tree and holds no focusable element. */
  function ensureSheet(vesselName: string): void {
    if (sheet) {
      const heading = sheet.querySelector('[data-sheet-title]');
      if (heading) setText(heading, `${vesselName} detail`);
      sheet.setAttribute('aria-label', `${vesselName} detail`);
      return;
    }
    const close = button('Close');
    close.addEventListener('click', () => {
      selected = null;
      shell.navigate('/fleet');
    });
    sheet = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': `${vesselName} detail`,
        class: 'sheet',
      },
      [
        el('div', { class: 'sheet-card' }, [
          el('h2', { 'data-sheet-title': '' }, [`${vesselName} detail`]),
          close,
          detail.node,
        ]),
      ],
    );
    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        selected = null;
        shell.navigate('/fleet');
        return;
      }
      trapFocus(sheet!, event);
    });
    openerButton =
      rail.node.querySelector<HTMLElement>(`[data-key="${selected}"] [data-open]`) ?? null;
    shell.openDialogs.add(sheet);
    node.append(sheet);
    close.focus();
  }

  function buildLayout(): void {
    const layout = layoutOf();
    node.dataset.layout = layout;
    node.replaceChildren();
    if (layout === 'narrow') {
      narrowList.replaceChildren(alerts.node, rail.node);
      node.append(flagsLink, announcements, chartRegion.node, narrowList);
    } else if (layout === 'medium') {
      railColumn.replaceChildren(alerts.node, rail.node);
      node.append(flagsLink, announcements, railColumn, chartRegion.node);
    } else {
      railColumn.replaceChildren(alerts.node, rail.node);
      node.append(flagsLink, announcements, railColumn, chartRegion.node, detailPane);
    }
    if (layout !== 'wide' && sheet) node.append(sheet);
  }

  const missionCache = new Map<string, Mission>();
  let lines: Line[] = [];
  let timer: number | null = null;
  let disposed = false;

  async function missionFor(id: string): Promise<Mission | null> {
    const cached = missionCache.get(id);
    if (cached) return cached;
    try {
      const mission = await request<Mission>(`/api/missions/${id}`);
      missionCache.set(id, mission);
      return mission;
    } catch {
      return null;
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const at = shell.generation;
    try {
      const [vessels, alertList, summaries, flags] = await Promise.all([
        request<Vessel[]>('/api/vessels'),
        request<Alert[]>('/api/alerts?status=open'),
        request<MissionSummary[]>('/api/missions'),
        request<StaffFlag[]>('/api/flags?state=open').catch(() => [] as StaffFlag[]),
      ]);
      if (!isCurrent(at) || disposed) return;

      const coverageByMission = new Map(
        summaries.map((mission) => [mission.id, mission.counters.coverage_pct]),
      );
      rail.update(vessels, coverageByMission, shell.units);
      alerts.update(alertList, shell.units);
      setText(flagsLink, `Client flags (${flags.length})`);

      const openMissions = summaries.filter((mission) =>
        ['Planned', 'Launched', 'Surveying', 'Recovering'].includes(mission.status),
      );
      const records = (
        await Promise.all(openMissions.map((mission) => missionFor(mission.id)))
      ).filter((mission): mission is Mission => mission !== null);
      if (!isCurrent(at) || disposed) return;

      if (records.length > 0) {
        const [first, ...rest] = records;
        chartRegion.setData({
          mission: first!,
          lines,
          tracks: [],
          holidays: [],
          coverage: null,
          vessels: vessels
            .filter((vessel) => vessel.last_fix !== null)
            .map((vessel) => ({ vessel, label: vessel.name })),
          extraAreas: rest.map((mission) => mission.survey_area),
          extraFences: rest.map((mission) => mission.geofence),
        });
      }

      await paintDetail(vessels, summaries, at);
    } catch {
      // A failed refresh leaves the board as it is; the next one tries again.
    }
  }

  async function paintDetail(
    vessels: Vessel[],
    summaries: MissionSummary[],
    at: number,
  ): Promise<void> {
    const layout = layoutOf();
    const vessel = selected ? vessels.find((item) => item.id === selected) : undefined;
    if (!vessel) {
      if (layout === 'wide') detailPane.replaceChildren(el('p', {}, ['Select a vessel']));
      closeSheet();
      return;
    }

    const [fixes, replaySet] = await Promise.all([
      request<RecentFix[]>(`/api/vessels/${vessel.id}/fixes`),
      request<RecentFix[]>(`/api/vessels/${vessel.id}/fixes?window_s=600`),
    ]);
    if (!isCurrent(at) || disposed) return;

    let line: Line | null = null;
    if (vessel.mission_id) {
      const mission = await missionFor(vessel.mission_id);
      if (mission && vessel.running_line_id) {
        lines = await request<Line[]>(`/api/missions/${mission.id}/lines`);
        line = lines.find((item) => item.id === vessel.running_line_id) ?? null;
      }
    }
    if (!isCurrent(at) || disposed) return;

    const summary = summaries.find((item) => item.id === vessel.mission_id);
    detail.update({
      vessel,
      fixes,
      replaySet,
      line,
      missionName: summary ? summary.name : null,
      coveragePct: summary ? summary.counters.coverage_pct : null,
      units: shell.units,
    });

    if (layout === 'wide') {
      if (!detailPane.contains(detail.node)) detailPane.replaceChildren(detail.node);
    } else {
      ensureSheet(vessel.name);
    }
  }

  buildLayout();
  wireFixListKeys(detail.node);
  window.addEventListener('resize', buildLayout);
  void refresh();
  timer = window.setInterval(() => void refresh(), REFRESH_MS);

  return {
    node,
    dispose: () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('resize', buildLayout);
      closeSheet();
      shell.unregisterRegion('Fleet announcements');
    },
  };
};
