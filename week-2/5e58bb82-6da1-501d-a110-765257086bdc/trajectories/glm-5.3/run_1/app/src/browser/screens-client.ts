/* Client reviewer screens: surveys list and survey detail. */
import { Mission, Line, Vessel, Holiday } from './app.js';
import { apiFetch, ApiError } from './api.js';
import { h, clear, focusSafe, openModal } from './dom.js';
import { store } from './state.js';
import { fmtPct, fmtPos } from './app.js';
import { Chart, ChartData } from './chart.js';

export function renderSurveys(root: HTMLElement): void {
  clear(root);
  const statusEl = h('div', { id: 'survey-list', role: 'status', 'aria-live': 'polite', 'aria-label': 'Survey list', class: 'banner' });
  const missions = store.missions;
  const shown = missions.slice(0, SURVEYS_PAGE);
  const countLine = h('p', { class: 'mono count-line' }, `Showing ${shown.length} of ${missions.length} surveys`);
  const tbody = h('tbody', {});
  const renderRows = (list: Mission[]): void => {
    clear(tbody);
    for (const m of list) {
      tbody.append(h('tr', {},
        h('td', {}, h('a', { href: `/surveys/${m.id}` }, m.name)),
        h('td', { class: 'mono' }, m.survey_date),
        h('td', {}, m.status),
        h('td', { class: 'mono' }, fmtPct(m.counters.coverage_pct)),
      ));
    }
  };
  renderRows(shown);
  const moreBtn = h('button', { class: 'btn' }, 'Load more surveys');
  let currentShown = shown.length;
  moreBtn.addEventListener('click', () => {
    const next = missions.slice(currentShown, currentShown + SURVEYS_PAGE);
    currentShown += next.length;
    for (const m of next) {
      tbody.append(h('tr', {},
        h('td', {}, h('a', { href: `/surveys/${m.id}` }, m.name)),
        h('td', { class: 'mono' }, m.survey_date),
        h('td', {}, m.status),
        h('td', { class: 'mono' }, fmtPct(m.counters.coverage_pct)),
      ));
    }
    countLine.textContent = `Showing ${currentShown} of ${missions.length} surveys`;
    statusEl.textContent = `Showing ${currentShown} of ${missions.length} surveys`;
    if (currentShown >= missions.length) moreBtn.remove();
    const firstNew = tbody.children[Math.max(0, currentShown - next.length)] as HTMLElement | null;
    const link = firstNew?.querySelector('a') as HTMLElement | null;
    focusSafe(link);
  });
  if (missions.length <= SURVEYS_PAGE) moreBtn.remove();
  statusEl.textContent = `Showing ${shown.length} of ${missions.length} surveys`;
  root.append(
    h('h1', {}, 'Your surveys'),
    countLine,
    statusEl,
    h('table', { class: 'table surveys-table', 'aria-label': 'Surveys' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Name'), h('th', {}, 'Survey date'), h('th', {}, 'Status'), h('th', {}, 'Coverage'))),
      tbody),
    moreBtn,
  );
}

const SURVEYS_PAGE = 20;

export async function renderSurvey(root: HTMLElement, missionId: string, vesselFilter: string | null): Promise<boolean> {
  const [mission, lines, holidays, coverage, tracks] = await Promise.all([
    apiFetch<Mission>('GET', `/api/missions/${missionId}`).catch(() => null),
    apiFetch<Line[]>('GET', `/api/missions/${missionId}/lines`).catch(() => [] as Line[]),
    apiFetch<Holiday[]>('GET', `/api/missions/${missionId}/holidays`).catch(() => [] as Holiday[]),
    apiFetch<{ origin: { easting: number; northing: number }; cols: number; rows: number; overlap: number[][] }>('GET', `/api/missions/${missionId}/coverage`).catch(() => null),
    apiFetch<{ tracks: { line_id: string; points: { t: string; easting: number; northing: number; depth_m: number; swath_m: number }[] }[] }>('GET', `/api/missions/${missionId}/tracks`).catch(() => ({ tracks: [] })),
  ]);
  if (!mission) return false;
  clear(root);
  const agreement = mission.crossline_agreement;
  const agreementText = agreement.compared === 0 ? '—' : `${agreement.pct}% of ${agreement.compared}`;

  const storageDown = store.status.storage === 'down';
  const downloadBtn = (label: string, href: string, ariaLabel: string): HTMLElement => {
    if (storageDown) {
      return h('button', { class: 'btn subtle', disabled: true, 'aria-label': ariaLabel }, 'Storage unavailable');
    }
    return h('a', { class: 'btn subtle', href, 'aria-label': ariaLabel }, label);
  };

  root.append(h('section', { class: 'mission-header', 'aria-label': 'Mission header' },
    h('div', { class: 'mh-top' }, h('h1', {}, mission.name), h('span', { class: 'status-word mono' }, mission.status)),
    h('div', { class: 'mh-groups' },
      h('div', { role: 'group', 'aria-label': 'Coverage', class: 'counter' },
        h('span', { class: 'counter-label' }, 'Coverage'), h('span', { class: 'counter-value mono' }, fmtPct(mission.counters.coverage_pct))),
      h('div', { role: 'group', 'aria-label': 'Open holidays', class: 'counter' },
        h('span', { class: 'counter-label' }, 'Open holidays'), h('span', { class: 'counter-value mono' }, String(mission.counters.open_holidays))),
      h('div', { role: 'group', 'aria-label': 'Lines remaining', class: 'counter' },
        h('span', { class: 'counter-label' }, 'Lines remaining'), h('span', { class: 'counter-value mono' }, String(mission.counters.lines_remaining))),
      h('div', { role: 'group', 'aria-label': 'Crossline agreement', class: 'counter' },
        h('span', { class: 'counter-label' }, 'Crossline agreement'), h('span', { class: 'counter-value mono' }, agreementText)),
    ),
    h('div', { class: 'mh-actions' },
      downloadBtn('Download coverage CSV', `/api/missions/${mission.id}/coverage.csv`, 'Download coverage CSV'),
      mission.report.state === 'Ready'
        ? downloadBtn('Download coverage report', `/api/missions/${mission.id}/report`, 'Download coverage report')
        : h('span', { class: 'mono' }, 'Coverage report is being prepared'),
    ),
  ));

  // chart
  const canvasHolder = h('div', { class: 'chart-holder', 'aria-label': 'Survey chart' });
  const canvas = h('canvas', { class: 'chart-canvas' }) as HTMLCanvasElement;
  canvasHolder.append(canvas);
  canvasHolder.append(h('div', { class: 'chart-tools' },
    h('button', { class: 'btn subtle', 'aria-label': 'Zoom in' }, 'Zoom in'),
    h('button', { class: 'btn subtle', 'aria-label': 'Zoom out' }, 'Zoom out'),
    h('button', { class: 'btn subtle', 'aria-label': 'Fit survey area' }, 'Fit survey area')));
  const chart = new Chart(canvas);
  const byId = new Map(lines.map(l => [l.id, l]));
  const tracksMap: Record<string, { t: string; easting: number; northing: number; depth_m: number; swath_m: number }[]> = {};
  for (const t of tracks.tracks) if (byId.has(t.line_id)) tracksMap[t.line_id] = t.points;
  const vesselsOnMission: Vessel[] = mission.vessels.map(mv => store.vessels.find(v => v.id === mv.id)).filter((v): v is Vessel => !!v);
  const chartData: ChartData = {
    mission, lines, holidays,
    coverage, tracks: tracksMap,
    vessels: vesselsOnMission,
    clientMode: true,
  };
  chart.setData(chartData);
  const zoomIn = canvasHolder.querySelector('[aria-label="Zoom in"]') as HTMLElement;
  zoomIn.addEventListener('click', () => chart.zoom(1.25));
  (canvasHolder.querySelector('[aria-label="Zoom out"]') as HTMLElement).addEventListener('click', () => chart.zoom(0.8));
  (canvasHolder.querySelector('[aria-label="Fit survey area"]') as HTMLElement).addEventListener('click', () => chart.fit(mission.survey_area));
  // arrow keys pan the chart on the survey screen (no lens)
  canvas.addEventListener('keydown', (e: KeyboardEvent) => {
    const step = e.shiftKey ? 50 : 20;
    const d: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    if (d[e.key]) { e.preventDefault(); chart.pan(d[e.key]![0], d[e.key]![1]); }
  });
  root.append(canvasHolder);

  // vessels list
  const vesselsList = h('ul', { class: 'vessels-list', 'aria-label': 'Vessels' });
  for (const mv of mission.vessels) {
    const v = store.vessels.find(vv => vv.id === mv.id);
    const link = mv.link_state ?? (v?.link_state ?? null);
    vesselsList.append(h('li', { class: 'mono' }, `${mv.name} — ${link ?? 'Off survey'}`));
  }
  root.append(h('section', { class: 'survey-vessels' }, h('h2', { class: 'region-heading' }, 'Vessels'), vesselsList));

  // vessel filter
  const combo = h('select', { 'aria-label': 'Vessel', class: 'mono' }) as HTMLSelectElement;
  combo.append(h('option', { value: '' }, 'All vessels'));
  for (const mv of mission.vessels) combo.append(h('option', { value: mv.id }, mv.name));
  const unknownNote = h('p', { class: 'mono unknown-vessel' });
  let filterId = vesselFilter;
  const known = mission.vessels.some(mv => mv.id === vesselFilter);
  if (vesselFilter && !known) { combo.value = ''; filterId = null; unknownNote.textContent = 'No such vessel on this survey'; }
  else if (vesselFilter) combo.value = vesselFilter;
  combo.addEventListener('change', () => {
    const p = new URLSearchParams(location.search);
    if (combo.value) p.set('vessel', combo.value); else p.delete('vessel');
    window.history.replaceState({}, '', location.pathname + (p.toString() ? `?${p}` : ''));
    renderLineFiles();
  });
  root.append(h('section', { class: 'vessel-filter' }, h('label', { for: 'vessel-combo' }, 'Vessel'), combo, unknownNote));
  combo.id = 'vessel-combo';

  // line files table
  const filesBody = h('tbody', {});
  const renderLineFiles = (): void => {
    clear(filesBody);
    const shown = lines.filter(l => ['Surveyed', 'Delivered', 'Superseded'].includes(l.status));
    const filtered = combo.value ? shown.filter(l => l.vessel_id === combo.value) : shown;
    for (const l of filtered) {
      const dl = l.file?.state === 'Stored'
        ? downloadBtn(`Download ${l.label}`, `/api/lines/${l.id}/file`, `Download ${l.label}`)
        : h('span', {});
      const flagBtn = l.status === 'Delivered'
        ? h('button', { class: 'btn subtle', 'aria-label': `Flag ${l.label}` }, `Flag ${l.label}`) : null;
      if (flagBtn) {
        flagBtn.addEventListener('click', () => {
          openModal({ label: 'Flag line' }, (root2, close) => {
            const comment = h('textarea', { 'aria-label': 'Comment', rows: '3' }) as HTMLTextAreaElement;
            const lenStatus = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Comment length', class: 'mono' }, '0/500');
            comment.addEventListener('input', () => {
              const n = comment.value.length;
              if (n === 450 || n === 490 || n === 500) lenStatus.textContent = `${n}/500`;
            });
            const send = h('button', { class: 'btn primary' }, 'Send flag');
            send.addEventListener('click', async () => {
              try {
                await apiFetch('POST', `/api/missions/${missionId}/lines/${l.id}/flags`, { comment: comment.value });
                close();
                const ann = document.getElementById('fleet-announcements');
                if (ann) ann.textContent = `Flag sent for ${l.label}`;
                flagBtn.replaceWith(h('span', { class: 'mono' }, 'Flagged'));
              } catch (err) {
                const e2 = err as ApiError;
                const er = root2.querySelector('.dialog-error') as HTMLElement;
                if (er) er.textContent = e2.body?.errors?.comment ?? e2.body?.message ?? 'Could not send the flag';
              }
            });
            root2.append(h('h2', {}, 'Flag line'),
              h('p', { class: 'mono' }, l.label),
              h('label', {}, 'Comment'), comment, lenStatus,
              h('p', { class: 'dialog-error field-error' }),
              h('div', { class: 'dialog-actions' }, send, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')));
            comment.focus();
          });
        });
      }
      filesBody.append(h('tr', { 'data-line-id': l.id },
        h('td', { class: 'mono' }, l.label),
        h('td', {}, l.vessel_name ?? ''),
        h('td', { class: 'mono' }, l.status === 'Superseded' ? 'Superseded' : l.status),
        h('td', { class: 'mono' }, l.file?.state === 'Stored' ? 'Stored' : 'Awaiting upload'),
        h('td', { class: 'mono' }, l.file?.size_bytes !== null && l.file?.size_bytes !== undefined ? String(l.file.size_bytes) : ''),
        h('td', { class: 'mono sha-cell' }, l.file?.sha256 ? `SHA-256 ${l.file.sha256}` : ''),
        h('td', {}, dl, flagBtn ?? ''),
      ));
    }
  };
  renderLineFiles();
  root.append(h('section', { class: 'line-files' },
    h('h2', { class: 'region-heading' }, 'Line files'),
    h('table', { class: 'table files-table', 'aria-label': 'Line files' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Line'), h('th', {}, 'Vessel'), h('th', {}, 'Status'), h('th', {}, 'File'),
        h('th', {}, 'Bytes'), h('th', {}, 'Checksum'))),
      filesBody)));

  setTimeout(() => chart.draw(), 0);
  void fmtPos;
  return true;
}
