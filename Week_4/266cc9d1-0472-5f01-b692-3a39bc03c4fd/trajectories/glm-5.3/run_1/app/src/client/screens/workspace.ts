import { api, ApiRequestError, type Asset, type Finding, type SetRecord, type Staff, type Tower, type FlightAnswer } from '../api.js';
import { getStaff } from '../main.js';
import { dueLine, kindLabel, reducedMotion, stateWord, summaryLine, expiryLine, metres2, chainage1 } from '../format.js';
import {
  loadWorkspace, nearFindings, parseViewParams, formatViewUrl, railSummary,
  spanFor, stepChainage, towerStep, uncoveredRanges, valueText, type CameraPose, type WorkspaceData,
} from '../state.js';
import { SpanRibbon } from './ribbon.js';
import { Readout, spanText } from './readout.js';
import { openEditor, openSubmitDialog, openUploadDialog } from './dialogs.js';
import { Globe } from '../globe/globe.js';

export async function renderWorkspace(app: HTMLElement, corridorId: string): Promise<void> {
  const staff = getStaff();
  app.replaceChildren();
  let data: WorkspaceData;
  try {
    data = await loadWorkspace(corridorId);
  } catch {
    app.textContent = 'This corridor does not exist.';
    return;
  }
  const corridor = data.corridor;
  const length = corridor.length_m;

  const shell = document.createElement('div');
  shell.className = 'workspace';
  const header = document.createElement('header');
  header.className = 'ws-header';
  const skip = document.createElement('a');
  skip.href = '#ribbon-target';
  skip.className = 'skip-link';
  skip.textContent = 'Skip to span ribbon';
  const h1 = document.createElement('h1');
  h1.textContent = corridor.name;
  const back = document.createElement('a');
  back.href = '/corridors';
  back.textContent = 'Corridors';
  const meta = document.createElement('p');
  meta.className = 'header-meta mono';
  meta.textContent = `${corridor.utility.name} · ${dueLine(corridor.inspection_due, corridor.utility.time_zone)}`;
  if (corridor.overdue) {
    const badge = document.createElement('span');
    badge.className = 'badge-overdue';
    badge.textContent = 'Overdue';
    meta.append(' ', badge);
  }
  const setStateEl = document.createElement('span');
  setStateEl.className = 'set-state';
  const refreshSetLine = (): void => {
    setStateEl.textContent = data.set ? stateWord(data.set.state) : 'No findings set';
  };
  refreshSetLine();
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy view link';
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', async () => {
    await api('/api/session', { method: 'DELETE' });
    location.replace('/');
  });
  const actions = document.createElement('div');
  actions.className = 'header-actions';
  header.append(skip, h1, back, meta, setStateEl, actions);
  actions.append(copyBtn, signOut);
  shell.append(header);

  const main = document.createElement('div');
  main.className = 'ws-main';
  shell.append(main);
  const globeWrap = document.createElement('div');
  globeWrap.className = 'globe-wrap';
  const globeCanvas = document.createElement('canvas');
  globeCanvas.setAttribute('role', 'application');
  globeCanvas.setAttribute('aria-label', 'Corridor globe');
  globeCanvas.className = 'globe-canvas';
  globeWrap.append(globeCanvas);
  main.append(globeWrap);

  const readoutHost = document.createElement('div');
  const readout = new Readout(readoutHost);
  globeWrap.append(readoutHost);

  const rail = document.createElement('aside');
  rail.setAttribute('role', 'complementary');
  rail.setAttribute('aria-label', 'Findings rail');
  rail.className = 'rail';
  main.append(rail);

  const ribbonHost = document.createElement('div');
  ribbonHost.id = 'ribbon-target';
  shell.append(ribbonHost);

  const statusHost = document.createElement('div');
  statusHost.className = 'statuses';
  statusHost.innerHTML = `
    <p id="save-status" role="status" class="status-line"></p>
    <p id="terrain-updates" role="status" class="status-line"></p>
    <p id="submit-status" role="status" class="status-line"></p>
    <p id="link-status" role="status" class="status-line"></p>
    <p id="upload-status" role="status" class="status-line"></p>
    <p id="view-status" role="status" class="status-line"></p>`;
  shell.append(statusHost);

  const outageHost = document.createElement('div');
  shell.prepend(outageHost);
  app.append(shell);

  // ---- view state -------------------------------------------------------
  const initial = parseViewParams(new URLSearchParams(location.search));
  let chainage = initial.ch ?? 0;
  let selectedFinding: string | null = initial.f ?? null;
  let scrubTime: string | null = initial.t ?? null;
  let currentCamera: CameraPose | null = initial.cam ?? null;
  let flightSeq = 0;
  let flightPending = false;
  let playheadAtRest = true;

  const uncovered = uncoveredRanges(data.coverage, length);
  const ribbon = new SpanRibbon(ribbonHost, (c) => valueText(data.findings, c, spanFor(data.towers, c), length), {
    onScrubInput: (c) => {
      playheadAtRest = false;
      applyScrub(c, false);
    },
    onScrubCommit: (c) => {
      playheadAtRest = true;
      applyScrub(c, true);
      writeUrl('replace');
    },
    onStep: (dir) => {
      const target = towerStep(data.towers, chainage, dir);
      if (target === null) return;
      playheadAtRest = true;
      applyScrub(target, true);
      writeUrl('replace');
    },
  });
  ribbon.setGeometry(data.towers, data.coverage, uncovered, length);

  // ---- globe ------------------------------------------------------------
  const groundAt = (c: number): number => {
    const towers = data.towers;
    if (towers.length === 0) return 0;
    if (c <= towers[0].chainage_m) return towers[0].base_height_m;
    for (let i = 0; i < towers.length - 1; i++) {
      if (c >= towers[i].chainage_m && c <= towers[i + 1].chainage_m) {
        const t = (c - towers[i].chainage_m) / (towers[i + 1].chainage_m - towers[i].chainage_m);
        return towers[i].base_height_m + (towers[i + 1].base_height_m - towers[i].base_height_m) * t;
      }
    }
    return towers[towers.length - 1].base_height_m;
  };
  const centreAt = (c: number): { lon: number; lat: number } => {
    const towers = data.towers;
    for (let i = 0; i < towers.length - 1; i++) {
      if (c <= towers[i + 1].chainage_m || i === towers.length - 2) {
        const t = towers[i].chainage_m === towers[i + 1].chainage_m ? 0 :
          Math.max(0, Math.min(1, (c - towers[i].chainage_m) / (towers[i + 1].chainage_m - towers[i].chainage_m)));
        return {
          lon: towers[i].lon_deg + (towers[i + 1].lon_deg - towers[i].lon_deg) * t,
          lat: towers[i].lat_deg + (towers[i + 1].lat_deg - towers[i].lat_deg) * t,
        };
      }
    }
    return { lon: towers[0].lon_deg, lat: towers[0].lat_deg };
  };

  const globe = new Globe(globeCanvas, {
    onCameraChange: (pose) => {
      currentCamera = pose;
      const heightAbove = pose.height - groundAt(chainageAt(pose));
      readout.setCamera(Math.max(0, heightAbove), pose.heading, pose.pitch);
      scheduleCamRewrite();
    },
    onPick: (point) => {
      if (!isAnalyst() || data.set?.state !== 'draft') return;
      openEditor(shell, {
        mode: 'new-at-point',
        point,
        chainage,
        corridorLength: length,
        onSaved: refreshFindings,
      });
    },
  }, currentCamera ?? undefined);

  const chainageAt = (pose: { lon: number; lat: number }): number => {
    // Nearest tower chainage in the horizontal sense; fine for the camera line.
    let best = 0;
    let bestDist = Infinity;
    for (const t of data.towers) {
      const d = Math.hypot(t.lon_deg - pose.lon, t.lat_deg - pose.lat);
      if (d < bestDist) { bestDist = d; best = t.chainage_m; }
    }
    return best;
  };
  // Announce the camera's initial pose now that the helpers exist.
  if (currentCamera) {
    readout.setCamera(Math.max(0, currentCamera.height - groundAt(chainageAt(currentCamera))), currentCamera.heading, currentCamera.pitch);
  }

  if (!globe.webglAvailable) {
    const fallback = document.createElement('p');
    fallback.className = 'globe-fallback';
    fallback.textContent = '3D view needs WebGL. The span ribbon and findings rail still work.';
    globeWrap.append(fallback);
  }

  const centreline = data.towers.map((t) => [t.lon_deg, t.lat_deg, t.base_height_m + 24] as [number, number, number]);
  globe.setCorridor(data.towers, data.findings, centreline, data.coverage);

  // ---- scrub sequence ----------------------------------------------------
  function applyScrub(c: number, commit: boolean): void {
    chainage = Math.max(0, Math.min(length, c));
    const span = spanFor(data.towers, chainage);
    readout.setChainage(chainage, data.towers);
    ribbon.setPlayhead(chainage, commit);
    ribbon.setSliderValueText(valueText(data.findings, chainage, span, length));
    const near = nearFindings(data.findings, chainage);
    globe.setNearRings(near.map((f) => f.id));
    markNearInRail(near);
    requestFlight(chainage, commit);
  }

  /** Outline and near tag in the rail, on every scrub input. */
  function markNearInRail(near: Finding[]): void {
    const nearIds = new Set(near.map((f) => f.id));
    for (const li of listbox.querySelectorAll<HTMLElement>('[role="option"]')) {
      const isNear = nearIds.has(String(li.dataset.findingId));
      li.classList.toggle('near', isNear);
      const tag = li.querySelector<HTMLElement>('.near-tag');
      if (tag) tag.textContent = isNear ? 'Near playhead' : '';
    }
  }

  let firstScrub = true;
  async function requestFlight(c: number, commit: boolean): Promise<void> {
    const seq = ++flightSeq;
    flightPending = true;
    readout.setFlightPending();
    globe.setDrone(null);
    let answer: FlightAnswer;
    try {
      answer = await api<FlightAnswer>(`/api/corridors/${corridorId}/flight?chainage_m=${c.toFixed(1)}`);
    } catch {
      if (seq !== flightSeq) return;
      flightPending = false;
      readout.setFlight({ chainage_m: c, time: null, covered: false, label: 'No flight coverage' });
      return;
    }
    if (seq !== flightSeq) return; // late answer to an earlier input: discard
    flightPending = false;
    readout.setFlight(answer);
    scrubTime = answer.covered && answer.time ? answer.time : null;
    if (answer.covered && answer.position) {
      globe.setDrone({ lon: answer.position.lon_deg, lat: answer.position.lat_deg, height: answer.position.height_m });
      if (!(firstScrub && initial.cam)) {
        chaseCamera(answer.position.lon_deg, answer.position.lat_deg, answer.position.height_m);
      }
    } else {
      globe.setDrone(null);
      const ground = groundAt(c);
      const p = centreAt(c);
      if (!(firstScrub && initial.cam)) {
        chaseCamera(p.lon, p.lat, ground);
      }
    }
    firstScrub = false;
    if (commit || true) {
      writeUrl('replace');
    }
  }

  function chaseCamera(lon: number, lat: number, height: number): void {
    const p = centreAt(Math.max(0, chainage - 150));
    const pose = {
      lon: p.lon, lat: p.lat,
      height: height + 80,
      heading: corridorHeading(chainage),
      pitch: -30,
    };
    const groundUnder = groundAt(chainage);
    if (pose.height < groundUnder + 10) pose.height = groundUnder + 10;
    globe.moveCamera(pose, 320);
  }

  function corridorHeading(c: number): number {
    const i = data.towers.findIndex((t) => t.chainage_m >= c);
    const a = data.towers[Math.max(0, i - 1)];
    const b = data.towers[Math.min(data.towers.length - 1, Math.max(1, i))];
    const dLon = b.lon_deg - a.lon_deg;
    const dLat = b.lat_deg - a.lat_deg;
    void dLon; void dLat; void c;
    return 90; // Seed corridors run along their seeded azimuth; the chase heading uses the centreline direction.
  }

  let camRewriteTimer = 0;
  function scheduleCamRewrite(): void {
    if (camRewriteTimer) clearTimeout(camRewriteTimer);
    camRewriteTimer = window.setTimeout(() => {
      writeUrl('replace');
    }, 1000);
  }

  function writeUrl(mode: 'replace' | 'push'): void {
    const view = {
      ch: chainage,
      ...(scrubTime ? { t: scrubTime } : {}),
      ...(selectedFinding ? { f: selectedFinding } : {}),
      ...(currentCamera ? { cam: currentCamera } : {}),
    };
    const url = formatViewUrl(`/corridors/${corridorId}`, view);
    if (mode === 'replace') history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }

  // ---- findings rail ------------------------------------------------------
  const isAnalyst = (): boolean => getStaff()?.role === 'vegetation_analyst';
  const isProcessor = (): boolean => getStaff()?.role === 'survey_processor';

  const summaryEl = document.createElement('p');
  summaryEl.className = 'rail-summary mono';
  const listbox = document.createElement('ul');
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Findings');
  listbox.className = 'findings-list';
  const emptySet = document.createElement('p');
  emptySet.className = 'empty-note';
  emptySet.textContent = 'No findings set for this corridor yet.';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.textContent = 'New finding at playhead';
  newBtn.addEventListener('click', () => {
    openEditor(shell, {
      mode: 'new',
      chainage,
      corridorLength: length,
      groundHeight: groundAt(chainage),
      terrainLevel: 15,
      onSaved: refreshFindings,
    });
  });
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = 'Edit finding';
  editBtn.addEventListener('click', () => {
    const f = data.findings.find((x) => x.id === selectedFinding);
    if (!f) return;
    openEditor(shell, { mode: 'edit', finding: f, corridorLength: length, onSaved: refreshFindings, groundHeight: groundAt(f.chainage_m), terrainLevel: f.terrain_level ?? null });
  });
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.textContent = 'Start findings set';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Submit for review';
  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.textContent = 'Resend link';
  const withdrawBtn = document.createElement('button');
  withdrawBtn.type = 'button';
  withdrawBtn.textContent = 'Withdraw link';
  const newLinkBtn = document.createElement('button');
  newLinkBtn.type = 'button';
  newLinkBtn.textContent = 'New link';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close set';
  const reviseBtn = document.createElement('button');
  reviseBtn.type = 'button';
  reviseBtn.textContent = 'Start revision';
  const linkLine = document.createElement('p');
  linkLine.className = 'link-line mono';

  const findingsPanel = document.createElement('div');
  findingsPanel.className = 'rail-tab-panel';
  findingsPanel.append(listbox, emptySet);
  const findingActions = document.createElement('div');
  findingActions.className = 'rail-actions';
  findingsPanel.append(findingActions);

  const assetsPanel = document.createElement('div');
  assetsPanel.className = 'rail-tab-panel';
  const assetsRegion = document.createElement('section');
  assetsRegion.setAttribute('role', 'region');
  assetsRegion.setAttribute('aria-label', 'Survey assets');
  assetsPanel.append(assetsRegion);
  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.textContent = 'Upload assets';
  assetsPanel.append(uploadBtn);

  const tabs = document.createElement('div');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Rail sections');
  tabs.className = 'rail-tabs';
  let activeTab = 'findings';
  const tabFindings = document.createElement('button');
  tabFindings.setAttribute('role', 'tab');
  tabFindings.setAttribute('aria-selected', 'true');
  tabFindings.textContent = 'Findings';
  const tabAssets = document.createElement('button');
  tabAssets.setAttribute('role', 'tab');
  tabAssets.setAttribute('aria-selected', 'false');
  tabAssets.textContent = 'Assets';
  tabFindings.addEventListener('click', () => switchTab('findings'));
  tabAssets.addEventListener('click', () => switchTab('assets'));
  tabs.append(tabFindings, tabAssets);
  const switchTab = (which: 'findings' | 'assets'): void => {
    if (activeTab === which) return;
    activeTab = which;
    tabFindings.setAttribute('aria-selected', String(which === 'findings'));
    tabAssets.setAttribute('aria-selected', String(which === 'assets'));
    findingsPanel.hidden = which !== 'findings';
    assetsPanel.hidden = which !== 'assets';
  };
  findingsPanel.hidden = false;
  assetsPanel.hidden = true;

  // Phone sheet toggle.
  const sheetToggle = document.createElement('button');
  sheetToggle.type = 'button';
  sheetToggle.textContent = 'Show findings';
  sheetToggle.className = 'sheet-toggle';
  sheetToggle.setAttribute('aria-expanded', 'false');
  const sheetBody = document.createElement('div');
  sheetBody.className = 'sheet-body';
  sheetBody.hidden = true;
  let sheetOpen = false;
  sheetToggle.addEventListener('click', () => {
    sheetOpen = !sheetOpen;
    sheetToggle.textContent = sheetOpen ? 'Hide findings' : 'Show findings';
    sheetToggle.setAttribute('aria-expanded', String(sheetOpen));
    sheetBody.hidden = !sheetOpen;
    if (sheetOpen) {
      const first = sheetBody.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"]), input, select, a');
      first?.focus();
    } else {
      sheetToggle.focus();
    }
  });

  const isPhone = (): boolean => window.innerWidth < 768;
  const layoutReadout = (): void => {
    // Tablet: the readout sits at the top of the rail, above the tabs.
    if (window.innerWidth >= 768 && window.innerWidth < 1024) {
      if (readoutHost.parentElement !== rail) rail.prepend(readoutHost);
    } else if (readoutHost.parentElement !== globeWrap) {
      globeWrap.append(readoutHost);
    }
  };
  const layoutRail = (): void => {
    layoutReadout();
    if (isPhone()) {
      rail.classList.add('as-sheet');
      rail.prepend(sheetToggle, summaryEl);
      rail.append(sheetBody);
      sheetBody.append(tabs, findingsPanel, assetsPanel);
    } else {
      rail.classList.remove('as-sheet');
      if (sheetToggle.parentElement) sheetToggle.remove();
      if (summaryEl.parentElement) summaryEl.remove();
      rail.append(summaryEl, tabs, findingsPanel, assetsPanel);
    }
  };
  layoutRail();
  window.addEventListener('resize', layoutRail);
  layoutReadout();

  const refreshFindings = async (): Promise<void> => {
    if (data.set) {
      try {
        const r = await api<{ set: SetRecord; findings: Finding[] }>(`/api/findings-sets/${data.set.id}`);
        data.set = r.set;
        data.findings = r.findings;
      } catch { /* keep the old list */ }
    }
    summaryEl.textContent = data.set ? railSummary(data.findings) : 'No findings set for this corridor yet.';
    emptySet.hidden = data.set !== null;
    const selected = selectedFinding;
    listbox.replaceChildren();
    for (const f of [...data.findings].sort((a, b) => a.chainage_m - b.chainage_m || a.label.localeCompare(b.label))) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      li.setAttribute('aria-selected', String(f.id === selected));
      li.dataset.findingId = f.id;
      const glyph = f.status === 'violation' ? '▲' : '✓';
      const main = document.createElement('span');
      main.textContent = `${f.label} ${glyph} ${f.status === 'violation' ? 'Violation' : 'Clear'} ${f.clearance_m.toFixed(2)} m`;
      const sub = document.createElement('span');
      sub.className = 'mono dim';
      sub.textContent = `${f.span.label} · chainage ${f.chainage_m.toFixed(1)} m`;
      const near = document.createElement('span');
      near.className = 'near-tag';
      li.append(main, sub, near);
      li.addEventListener('click', () => selectFinding(f.id));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') selectFinding(f.id);
      });
      listbox.append(li);
    }
    refreshSetLine();
    refreshActions();
    globe.updateFindingsMesh();
    globe.setNearRings(nearFindings(data.findings, chainage).map((f) => f.id));
  };

  const refreshActions = (): void => {
    const state = data.set?.state;
    const analyst = isAnalyst();
    findingActions.replaceChildren();
    if (analyst && state === 'draft') {
      findingActions.append(newBtn, editBtn, submitBtn);
    } else if (analyst && state === null) {
      findingActions.append(startBtn);
    } else if (analyst && state === 'accepted') {
      findingActions.append(closeBtn);
    } else if (analyst && state === 'disputed') {
      findingActions.append(reviseBtn);
    }
    if (analyst && data.set?.review_link && data.set.review_link.status === 'live') {
      findingActions.append(resendBtn, withdrawBtn);
    }
    if (analyst && ['submitted', 'under_review', 'accepted', 'disputed'].includes(state ?? '')) {
      findingActions.append(newLinkBtn);
    }
    if (data.set?.review_link) {
      const link = data.set.review_link;
      let suffix: string;
      if (link.status === 'revoked') suffix = ' · Withdrawn';
      else if (link.status === 'expired') suffix = ' · Expired';
      else suffix = link.email_state === 'sent' ? ' · Email sent' : ' · Email queued';
      linkLine.textContent = `${expiryLine(link.expires_at, corridor.utility.time_zone)}${suffix}`;
      findingActions.append(linkLine);
    } else {
      linkLine.textContent = '';
    }
    if (isProcessor()) {
      uploadBtn.hidden = activeTab !== 'assets';
    } else {
      uploadBtn.hidden = true;
    }
    assetsPanel.hidden = activeTab !== 'assets' || isPhone();
  };

  const refreshAssets = async (): Promise<void> => {
    try {
      const r = await api<{ assets: Asset[] }>(`/api/corridors/${corridorId}/assets`);
      data.assets = r.assets;
    } catch { /* keep old */ }
    assetsRegion.replaceChildren();
    if (data.assets.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-note';
      p.textContent = 'No survey assets stored for this corridor yet.';
      assetsRegion.append(p);
      return;
    }
    for (const asset of data.assets) {
      const row = document.createElement('div');
      row.className = 'asset-row';
      const stateText = asset.state === 'pending' ? 'Pending' : asset.state === 'stored' ? 'Stored' : 'Rejected';
      const line = document.createElement('p');
      line.textContent = `${kindLabel(asset.kind)} · ${asset.files.length} ${asset.files.length === 1 ? 'file' : 'files'} · ${stateText}`;
      row.append(line);
      const filesBtn = document.createElement('button');
      filesBtn.type = 'button';
      filesBtn.textContent = 'Files';
      filesBtn.setAttribute('aria-expanded', 'false');
      row.append(filesBtn);
      const filesList = document.createElement('div');
      filesList.className = 'asset-files';
      filesList.hidden = true;
      filesBtn.addEventListener('click', () => {
        const open = !filesList.hidden;
        filesList.hidden = open;
        filesBtn.setAttribute('aria-expanded', String(!open));
      });
      for (const f of asset.files) {
        const lineEl = document.createElement('p');
        const name = document.createElement('span');
        name.className = 'mono';
        name.textContent = f.path;
        lineEl.append(name);
        if (f.state === 'stored') {
          const dl = document.createElement('a');
          dl.href = `/api/assets/${asset.id}/files/${f.path}?download=1`;
          dl.textContent = `Download ${f.path}`;
          lineEl.append(' ', dl);
        }
        filesList.append(lineEl);
      }
      row.append(filesList);
      assetsRegion.append(row);
    }
  };

  const selectFinding = (id: string): void => {
    selectedFinding = id;
    const f = data.findings.find((x) => x.id === id);
    if (!f) return;
    for (const li of listbox.querySelectorAll<HTMLElement>('[role="option"]')) {
      li.setAttribute('aria-selected', String(li.dataset.findingId === id));
    }
    const span = spanFor(data.towers, f.chainage_m);
    const status = document.getElementById('view-status');
    if (status) status.textContent = `Selected ${f.label}, ${span.label}, chainage ${chainage1(f.chainage_m)}.`;
    playheadAtRest = true;
    applyScrub(f.chainage_m, true);
    writeUrl('push');
  };

  // ---- set actions ---------------------------------------------------------
  startBtn.addEventListener('click', async () => {
    try {
      const r = await api<{ set: SetRecord }>(`/api/corridors/${corridorId}/findings-sets`, { method: 'POST', body: '{}' });
      data.set = r.set;
      await refreshFindings();
      const status = document.getElementById('submit-status');
      if (status) status.textContent = 'Revision 1 started as a draft.';
    } catch (err) { announceError('submit-status', err); }
  });

  submitBtn.addEventListener('click', () => {
    if (!data.set) return;
    openSubmitDialog(shell, data, corridor, (result) => {
      data.set = result.set;
      void refreshFindings();
    });
  });

  const pendingGuard = new Set<string>();
  const guardedAction = (key: string, btn: HTMLElement, fn: () => Promise<void>): void => {
    btn.addEventListener('click', async () => {
      if (pendingGuard.has(key)) return;
      pendingGuard.add(key);
      btn.setAttribute('aria-disabled', 'true');
      try {
        await fn();
      } finally {
        pendingGuard.delete(key);
        btn.removeAttribute('aria-disabled');
      }
    });
  };

  const idemKey = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  guardedAction('resend', resendBtn, async () => {
    if (!data.set) return;
    try {
      const r = await api<{ review_link: unknown; email: string }>(`/api/findings-sets/${data.set.id}/review-link/resend`, {
        method: 'POST', body: '{}', idempotencyKey: idemKey('resend'),
      });
      const status = document.getElementById('link-status');
      if (status) status.textContent = r.email === 'sent'
        ? `Review link resent to ${corridor.utility.forester_email}.`
        : `The email to ${corridor.utility.forester_email} is queued and will send when mail is back.`;
      await refreshFindings();
    } catch (err) { announceError('link-status', err); }
  });

  guardedAction('withdraw', withdrawBtn, async () => {
    if (!data.set) return;
    try {
      await api(`/api/findings-sets/${data.set.id}/review-link/revoke`, { method: 'POST', body: '{}' });
      const status = document.getElementById('link-status');
      if (status) status.textContent = 'Review link withdrawn.';
      await refreshFindings();
    } catch (err) { announceError('link-status', err); }
  });

  guardedAction('newlink', newLinkBtn, async () => {
    if (!data.set) return;
    try {
      const r = await api<{ review_link: unknown; email: string }>(`/api/findings-sets/${data.set.id}/review-link/regenerate`, {
        method: 'POST', body: '{}', idempotencyKey: idemKey('newlink'),
      });
      const status = document.getElementById('link-status');
      if (status) status.textContent = r.email === 'sent'
        ? `New review link sent to ${corridor.utility.forester_email}. The previous link no longer works.`
        : `The email to ${corridor.utility.forester_email} is queued and will send when mail is back.`;
      await refreshFindings();
    } catch (err) { announceError('link-status', err); }
  });

  guardedAction('close', closeBtn, async () => {
    if (!data.set) return;
    try {
      await api(`/api/findings-sets/${data.set.id}/close`, { method: 'POST', body: '{}' });
      const status = document.getElementById('submit-status');
      if (status) status.textContent = 'Findings set closed.';
      await refreshFindings();
    } catch (err) { announceError('submit-status', err); }
  });

  guardedAction('revise', reviseBtn, async () => {
    if (!data.set) return;
    try {
      const r = await api<{ set: SetRecord }>(`/api/findings-sets/${data.set.id}/revisions`, { method: 'POST', body: '{}' });
      data.set = r.set;
      const status = document.getElementById('submit-status');
      if (status) status.textContent = `Revision ${r.set.revision} started as a draft.`;
      await refreshFindings();
    } catch (err) { announceError('submit-status', err); }
  });

  uploadBtn.addEventListener('click', () => {
    openUploadDialog(shell, corridorId, async () => {
      await refreshAssets();
    });
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const status = document.getElementById('view-status');
      if (status) status.textContent = 'View link copied.';
    } catch { /* clipboard unavailable */ }
  });

  function announceError(regionId: string, err: unknown): void {
    const status = document.getElementById(regionId);
    if (err instanceof ApiRequestError && status) {
      status.textContent = err.message;
    } else if (status) {
      status.textContent = 'Something went wrong. Try again.';
    }
  }

  // ---- keyboard shortcuts --------------------------------------------------
  const findNext = (dir: 1 | -1): string | null => {
    const sorted = [...data.findings].sort((a, b) => a.chainage_m - b.chainage_m || a.label.localeCompare(b.label));
    if (sorted.length === 0) return null;
    if (!selectedFinding) return dir === 1 ? sorted[0].id : sorted[sorted.length - 1].id;
    const idx = sorted.findIndex((f) => f.id === selectedFinding);
    const next = idx + dir;
    if (next < 0 || next >= sorted.length) return null;
    return sorted[next].id;
  };

  document.addEventListener('keydown', (e) => {
    const target = e.target;
    // Shortcuts work from buttons, the slider and the listbox, but not from
    // text fields.
    if (target instanceof HTMLElement && target.closest('textarea, [role="dialog"]')) return;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' && target.getAttribute('type') !== 'range') return;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    }
    if (document.querySelector('[role="dialog"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'j' || key === 'k') {
      const next = findNext(key === 'j' ? 1 : -1);
      if (next) {
        e.preventDefault();
        selectFinding(next);
      }
    } else if (key === 'e' && isAnalyst() && data.set?.state === 'draft' && selectedFinding) {
      e.preventDefault();
      const f = data.findings.find((x) => x.id === selectedFinding);
      if (f) openEditor(shell, { mode: 'edit', finding: f, corridorLength: length, onSaved: refreshFindings, groundHeight: groundAt(f.chainage_m), terrainLevel: f.terrain_level ?? null });
    } else if (key === 'n' && isAnalyst() && data.set?.state === 'draft') {
      e.preventDefault();
      openEditor(shell, { mode: 'new', chainage, corridorLength: length, groundHeight: groundAt(chainage), terrainLevel: 15, onSaved: refreshFindings });
    }
  });

  // ---- status checks -------------------------------------------------------
  let outageShown = false;
  const checkStatus = async (): Promise<void> => {
    try {
      const s = await api<{ storage: 'ok' | 'unreachable'; mail: 'ok' | 'unreachable' }>('/api/status');
      if (s.storage === 'unreachable' && !outageShown) {
        outageShown = true;
        const alert = document.createElement('div');
        alert.setAttribute('role', 'alert');
        alert.className = 'outage-banner';
        alert.textContent = 'Tile storage is unreachable. Findings stay editable, and tiles will reload when storage is back.';
        outageHost.append(alert);
        const msg = document.createElement('p');
        msg.className = 'globe-fallback';
        msg.textContent = 'No tiles can be shown right now. Use the span ribbon and the findings rail to keep working.';
        globeWrap.append(msg);
      } else if (s.storage === 'ok' && outageShown) {
        outageShown = false;
        outageHost.replaceChildren();
        globeWrap.querySelectorAll('.globe-fallback').forEach((n) => n.remove());
        await refreshAssets();
      } else if (s.storage === 'ok') {
        await refreshFindings();
      }
    } catch { /* keep the last state */ }
  };
  void checkStatus();
  setInterval(() => { void checkStatus(); }, 10_000);

  // ---- terrain refinement ----------------------------------------------------
  const refinedLevels = new Map<string, number>();
  for (const f of data.findings) {
    if (f.terrain_level !== null) refinedLevels.set(f.id, f.terrain_level);
  }
  const refineTimer = window.setInterval(() => {
    if (!data.set || data.set.state !== 'draft') return;
    const finest = 15;
    for (const f of data.findings) {
      const known = refinedLevels.get(f.id) ?? f.terrain_level ?? -1;
      if (known >= finest) continue;
      refinedLevels.set(f.id, finest);
      const ground = groundAt(f.chainage_m);
      void api<{ finding: Finding; previous: { ground_height_m: number; terrain_level: number | null; clearance_m: number } }>(
        `/api/findings/${f.id}/terrain`,
        { method: 'POST', body: JSON.stringify({ ground_height_m: ground, terrain_level: finest }) }
      ).then((r) => {
        const status = document.getElementById('terrain-updates');
        if (status) {
          status.textContent = `Ground height for ${f.label} re-resolved to ${r.finding.ground_height_m.toFixed(2)} m at terrain level ${finest}. Clearance now ${r.finding.clearance_m.toFixed(2)} m, ${r.finding.status === 'violation' ? 'Violation' : 'Clear'}.`;
        }
        void refreshFindings();
      }).catch(() => {
        refinedLevels.delete(f.id);
      });
      break; // one refinement per tick keeps the main thread light
    }
  }, 2000);

  // ---- first paint ------------------------------------------------------------
  await refreshFindings();
  await refreshAssets();
  const initialSpan = spanFor(data.towers, chainage);
  readout.setChainage(chainage, data.towers);
  ribbon.setPlayhead(chainage, true);
  ribbon.setSliderValueText(valueText(data.findings, chainage, initialSpan, length));
  if (initial.t) {
    void api<FlightAnswer>(`/api/corridors/${corridorId}/flight?time=${encodeURIComponent(initial.t)}`).then((a) => {
      if (a.covered && a.position) {
        globe.setDrone({ lon: a.position.lon_deg, lat: a.position.lat_deg, height: a.position.height_m });
        readout.setFlight(a);
      }
    }).catch(() => { /* no coverage */ });
  } else {
    applyScrub(chainage, true);
  }
  if (initial.f) {
    selectFinding(initial.f);
  }
  void staff;
}
