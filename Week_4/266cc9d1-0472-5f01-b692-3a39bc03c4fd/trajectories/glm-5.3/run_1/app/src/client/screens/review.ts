import { api, ApiRequestError, type Corridor, type FlightAnswer, type Finding, type SetRecord, type Tower } from '../api.js';
import { dueLine, expiryLine, metres2, chainage1 } from '../format.js';
import { formatViewUrl, nearFindings, parseViewParams, spanFor, towerStep, uncoveredRanges, valueText } from '../state.js';
import { SpanRibbon } from './ribbon.js';
import { Readout, spanText } from './readout.js';
import { Globe } from '../globe/globe.js';

type ReviewData = {
  set: SetRecord;
  corridor: Corridor;
  towers: Tower[];
  coverage: Array<{ from_m: number; to_m: number }>;
  findings: Finding[];
  contractorName: string;
  expiresAt: string;
  readOnly: boolean;
};

export async function renderReview(app: HTMLElement, token: string): Promise<void> {
  app.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'workspace review';
  app.append(shell);

  let data: ReviewData;
  try {
    const r = await api<{
      set: SetRecord; corridor: Corridor; towers: Tower[];
      coverage: Array<{ from_m: number; to_m: number }>; findings: Finding[];
      contractor: { name: string }; expires_at: string; read_only: boolean;
    }>(`/api/review/${token}`);
    data = {
      set: r.set,
      corridor: r.corridor,
      towers: r.towers,
      coverage: r.coverage ?? [],
      findings: r.findings,
      contractorName: r.contractor.name,
      expiresAt: r.expires_at,
      readOnly: r.read_only,
    };
  } catch (err) {
    renderLinkProblem(shell, err);
    return;
  }

  const corridor = data.corridor;
  const length = corridor.length_m;

  const header = document.createElement('header');
  header.className = 'ws-header';
  const h1 = document.createElement('h1');
  h1.textContent = `${corridor.name}, revision ${data.set.revision}`;
  const meta = document.createElement('p');
  meta.className = 'header-meta mono';
  meta.textContent = `${data.contractorName} · ${corridor.utility.name} · ${dueLine(corridor.inspection_due, corridor.utility.time_zone)}`;
  const expiry = document.createElement('p');
  expiry.className = 'header-meta mono';
  expiry.textContent = expiryLine(data.expiresAt, corridor.utility.time_zone);
  header.append(h1, meta, expiry);
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
  shell.append(ribbonHost);

  const statusHost = document.createElement('div');
  statusHost.className = 'statuses';
  statusHost.innerHTML = `
    <p id="review-status" role="status" class="status-line"></p>
    <p id="view-status" role="status" class="status-line"></p>`;
  shell.append(statusHost);

  const initial = parseViewParams(new URLSearchParams(location.search));
  let chainage = initial.ch ?? 0;
  let selectedFinding: string | null = initial.f ?? null;
  let scrubTime: string | null = null;
  let flightSeq = 0;

  const uncovered = uncoveredRanges(data.coverage, length);
  const ribbon = new SpanRibbon(ribbonHost, (c) => valueText(data.findings, c, spanFor(data.towers, c), length), {
    onScrubInput: (c) => applyScrub(c, false),
    onScrubCommit: (c) => {
      applyScrub(c, true);
      writeUrl('replace');
    },
    onStep: (dir) => {
      const target = towerStep(data.towers, chainage, dir);
      if (target === null) return;
      applyScrub(target, true);
      writeUrl('replace');
    },
  });
  ribbon.setGeometry(data.towers, data.coverage, uncovered, length);

  const globe = new Globe(globeCanvas, {
    onCameraChange: () => { /* review camera readout handled through scrub */ },
    onPick: () => { /* no picking in review */ },
  }, initial.cam);

  if (!globe.webglAvailable) {
    const fallback = document.createElement('p');
    fallback.className = 'globe-fallback';
    fallback.textContent = '3D view needs WebGL. The span ribbon and findings rail still work.';
    globeWrap.append(fallback);
  }
  const centreline = data.towers.map((t) => [t.lon_deg, t.lat_deg, t.base_height_m + 24] as [number, number, number]);
  globe.setCorridor(data.towers, data.findings, centreline, data.coverage);

  if (initial.cam) {
    readout.setCamera(Math.max(0, initial.cam.height - (data.towers[0]?.base_height_m ?? 0)), initial.cam.heading, initial.cam.pitch);
  }
  const groundAt = (c: number): number => {
    const towers = data.towers;
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

  function applyScrub(c: number, commit: boolean): void {
    chainage = Math.max(0, Math.min(length, c));
    const span = spanFor(data.towers, chainage);
    readout.setChainage(chainage, data.towers);
    ribbon.setPlayhead(chainage, commit);
    ribbon.setSliderValueText(valueText(data.findings, chainage, span, length));
    const near = nearFindings(data.findings, chainage);
    globe.setNearRings(near.map((f) => f.id));
    const nearIds = new Set(near.map((f) => f.id));
    for (const li of list.querySelectorAll<HTMLElement>('.review-item')) {
      const tag = li.querySelector<HTMLElement>('.near-tag');
      if (tag) tag.textContent = nearIds.has(String(li.dataset.findingId)) ? 'Near playhead' : '';
    }
    requestFlight(chainage);
  }

  async function requestFlight(c: number): Promise<void> {
    const seq = ++flightSeq;
    readout.setFlightPending();
    globe.setDrone(null);
    let answer: FlightAnswer;
    try {
      answer = await api<FlightAnswer>(`/api/review/${token}/flight?chainage_m=${c.toFixed(1)}`);
    } catch {
      if (seq !== flightSeq) return;
      readout.setFlight({ chainage_m: c, time: null, covered: false, label: 'No flight coverage' });
      return;
    }
    if (seq !== flightSeq) return;
    readout.setFlight(answer);
    scrubTime = answer.covered && answer.time ? answer.time : null;
    if (answer.covered && answer.position) {
      globe.setDrone({ lon: answer.position.lon_deg, lat: answer.position.lat_deg, height: answer.position.height_m });
      const p = centreAt(Math.max(0, chainage - 150));
      globe.moveCamera({ lon: p.lon, lat: p.lat, height: answer.position.height_m + 80, heading: 90, pitch: -30 }, 320);
    } else {
      const p = centreAt(chainage);
      globe.moveCamera({ lon: p.lon, lat: p.lat, height: groundAt(chainage) + 60, heading: 90, pitch: -30 }, 320);
    }
    writeUrl('replace');
  }

  function writeUrl(mode: 'replace' | 'push'): void {
    const view = {
      ch: chainage,
      ...(scrubTime ? { t: scrubTime } : {}),
      ...(selectedFinding ? { f: selectedFinding } : {}),
    };
    const url = formatViewUrl(`/review/${token}`, view);
    if (mode === 'replace') history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }

  // Phone sheet.
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
    if (sheetOpen) sheetBody.querySelector<HTMLElement>('button, a, input')?.focus();
    else sheetToggle.focus();
  });

  const summaryEl = document.createElement('p');
  summaryEl.className = 'rail-summary mono';
  const violations = data.findings.filter((f) => f.status === 'violation').length;
  summaryEl.textContent = `${data.findings.length} ${data.findings.length === 1 ? 'finding' : 'findings'} · ${violations} ${violations === 1 ? 'violation' : 'violations'}`;

  const list = document.createElement('ul');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Findings for review');
  list.className = 'review-list';

  const finalState = document.createElement('div');
  finalState.className = 'review-final';
  finalState.hidden = true;

  const sendWrap = document.createElement('div');
  sendWrap.className = 'rail-actions';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.textContent = 'Send decisions';
  sendWrap.append(sendBtn);

  const sorted = (): Finding[] => [...data.findings].sort((a, b) => a.chainage_m - b.chainage_m || a.label.localeCompare(b.label));

  const noteFor = (f: Finding): string => data.set.decisions[f.id]?.note ?? '';

  function nearestTower(f: Finding): Tower {
    let best = data.towers[0];
    let bestD = Infinity;
    for (const t of data.towers) {
      const d = Math.abs(t.chainage_m - f.chainage_m);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  function renderDecisions(): void {
    list.replaceChildren();
    finalState.replaceChildren();
    finalState.hidden = !data.readOnly;
    list.hidden = data.readOnly;
    sendWrap.hidden = data.readOnly;
    const decisions = data.set.decisions;
    const countAccepted = Object.values(decisions).filter((d) => d.decision === 'accept').length;
    const countDisputed = Object.values(decisions).filter((d) => d.decision === 'dispute').length;

    if (data.readOnly) {
      const line = document.createElement('p');
      line.className = 'final-line';
      line.textContent = 'Decisions for this revision are final.';
      finalState.append(line);
      for (const f of sorted()) {
        const item = document.createElement('div');
        item.className = 'review-item-final';
        const decisionLine = document.createElement('p');
        const d = decisions[f.id];
        decisionLine.textContent = d ? (d.decision === 'accept' ? `${f.label} Accepted` : `${f.label} Disputed: ${d.note}`) : `${f.label} not decided`;
        const spanLine = document.createElement('p');
        const tower = nearestTower(f);
        spanLine.textContent = `${f.span.label} · nearest tower ${tower.label} · chainage ${f.chainage_m.toFixed(1)} m`;
        const fly = document.createElement('button');
        fly.type = 'button';
        fly.textContent = `Fly to ${f.label}`;
        fly.addEventListener('click', () => {
          applyScrub(f.chainage_m, true);
          const p = centreAt(Math.max(0, f.chainage_m - 150));
          globe.moveCamera({ lon: p.lon, lat: p.lat, height: f.canopy_top_height_m + 80, heading: 90, pitch: -30 }, 1000);
        });
        item.append(decisionLine, spanLine, fly);
        finalState.append(item);
      }
    }

    for (const f of sorted()) {
      const li = document.createElement('li');
      li.className = 'review-item';
      li.dataset.findingId = f.id;
      li.setAttribute('aria-current', f.id === selectedFinding ? 'true' : 'false');
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'review-select';
      main.textContent = `${f.label} ${f.status === 'violation' ? '▲ Violation' : '✓ Clear'} clearance ${f.clearance_m.toFixed(2)} m`;
      main.addEventListener('click', () => selectFinding(f.id));
      const sub = document.createElement('p');
      sub.className = 'mono dim';
      sub.textContent = `${f.span.label} · chainage ${f.chainage_m.toFixed(1)} m`;
      li.append(main, sub);
      const nearTag = document.createElement('span');
      nearTag.className = 'near-tag';
      li.append(nearTag);
      const comment = document.createElement('p');
      comment.className = 'review-comment';
      comment.append(...renderComment(f.comment, token));
      li.append(comment);

      if (!data.readOnly) {
        const btns = document.createElement('div');
        btns.className = 'decision-buttons';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.textContent = `Accept ${f.label}`;
        accept.setAttribute('aria-pressed', decisions[f.id]?.decision === 'accept' ? 'true' : 'false');
        const dispute = document.createElement('button');
        dispute.type = 'button';
        dispute.textContent = `Dispute ${f.label}`;
        dispute.setAttribute('aria-pressed', decisions[f.id]?.decision === 'dispute' ? 'true' : 'false');
        const stored = decisions[f.id];
        accept.addEventListener('click', async () => {
          if (accept.getAttribute('aria-pressed') === 'true') return;
          accept.setAttribute('aria-disabled', 'true');
          try {
            await api(`/api/review/${token}/findings/${f.id}/decision`, {
              method: 'PUT',
              body: JSON.stringify({ decision: 'accept', note: '' }),
            });
            data.set.decisions[f.id] = { decision: 'accept', note: '' };
            accept.setAttribute('aria-pressed', 'true');
            dispute.setAttribute('aria-pressed', 'false');
            noteBox.hidden = true;
            noteBox.value = '';
            const status = document.getElementById('review-status');
            if (status) status.textContent = `${f.label} marked accepted.`;
          } catch (err) {
            handleDecisionError(err, f.label);
          } finally {
            accept.removeAttribute('aria-disabled');
          }
        });
        const noteBox = document.createElement('textarea');
        noteBox.className = 'dispute-note';
        noteBox.setAttribute('aria-label', `Dispute note for ${f.label}`);
        noteBox.value = stored?.decision === 'dispute' ? stored.note : '';
        noteBox.hidden = !(stored?.decision === 'dispute');
        const noteHint = document.createElement('span');
        noteHint.className = 'field-error';
        const sendDispute = async (): Promise<void> => {
          const text = noteBox.value;
          if (text.trim() === '') {
            noteHint.textContent = 'Add a note explaining the dispute.';
            return;
          }
          try {
            await api(`/api/review/${token}/findings/${f.id}/decision`, {
              method: 'PUT',
              body: JSON.stringify({ decision: 'dispute', note: text }),
            });
            data.set.decisions[f.id] = { decision: 'dispute', note: text };
            dispute.setAttribute('aria-pressed', 'true');
            accept.setAttribute('aria-pressed', 'false');
            const status = document.getElementById('review-status');
            if (status) status.textContent = `${f.label} marked disputed.`;
          } catch (err) {
            handleDecisionError(err, f.label);
          }
        };
        noteBox.addEventListener('blur', () => {
          if (noteBox.hidden) return;
          const storedNow = data.set.decisions[f.id];
          if (noteBox.value.trim() === '') return;
          if (storedNow?.decision === 'dispute' && storedNow.note === noteBox.value) return;
          void sendDispute();
        });
        dispute.addEventListener('click', () => {
          if (dispute.getAttribute('aria-pressed') === 'true') {
            noteBox.focus();
            return;
          }
          noteBox.hidden = false;
          noteBox.focus();
        });
        btns.append(accept, dispute, noteBox, noteHint);
        li.append(btns);
      }
      list.append(li);
    }
    sendBtn.textContent = 'Send decisions';
    sendBtn.setAttribute('aria-disabled', 'false');
    void countAccepted; void countDisputed;
  }

  let sendPending = false;
  const idemKey = `complete-${token}-${Date.now()}`;
  sendBtn.addEventListener('click', async () => {
    if (sendPending) return;
    sendPending = true;
    sendBtn.setAttribute('aria-disabled', 'true');
    const status = document.getElementById('review-status');
    try {
      const r = await api<{ set: SetRecord; summary: { accepted: number; disputed: number } }>(`/api/review/${token}/complete`, {
        method: 'POST',
        body: '{}',
        idempotencyKey: idemKey,
      });
      data.set = r.set;
      data.readOnly = true;
      renderDecisions();
      if (status) status.textContent = `Decisions sent: ${r.summary.accepted} accepted, ${r.summary.disputed} disputed.`;
    } catch (err) {
      sendPending = false;
      sendBtn.setAttribute('aria-disabled', 'false');
      handleDecisionError(err, null);
    }
  });

  function handleDecisionError(err: unknown, label: string | null): void {
    const status = document.getElementById('review-status');
    if (err instanceof ApiRequestError) {
      if (err.code === 'review_closed') {
        data.readOnly = true;
        renderDecisions();
        return;
      }
      if (err.code === 'link_revoked' || err.code === 'link_expired') {
        renderLinkProblem(shell, err);
        return;
      }
      if (status) {
        if (label) status.textContent = `Could not save the decision for ${label}. Try again.`;
        else status.textContent = 'Could not send the decisions. Try again.';
      }
    } else if (status && label) {
      status.textContent = `Could not save the decision for ${label}. Try again.`;
    }
  }

  function selectFinding(id: string): void {
    const f = data.findings.find((x) => x.id === id);
    if (!f) return;
    selectedFinding = id;
    for (const li of list.querySelectorAll<HTMLElement>('.review-item')) {
      li.setAttribute('aria-current', li.dataset.findingId === id ? 'true' : 'false');
    }
    const span = spanFor(data.towers, f.chainage_m);
    const status = document.getElementById('view-status');
    if (status) status.textContent = `Selected ${f.label}, ${span.label}, chainage ${chainage1(f.chainage_m)}.`;
    applyScrub(f.chainage_m, true);
    writeUrl('push');
  }

  const findNext = (dir: 1 | -1): string | null => {
    const listAll = sorted();
    if (listAll.length === 0) return null;
    if (!selectedFinding) return dir === 1 ? listAll[0].id : listAll[listAll.length - 1].id;
    const idx = listAll.findIndex((f) => f.id === selectedFinding);
    const next = idx + dir;
    if (next < 0 || next >= listAll.length) return null;
    return listAll[next].id;
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
    const key = e.key.toLowerCase();
    if (key === 'j' || key === 'k') {
      const next = findNext(key === 'j' ? 1 : -1);
      if (next) {
        e.preventDefault();
        selectFinding(next);
      }
    }
  });

  // Phone layout.
  const layoutReadout = (): void => {
    if (window.innerWidth >= 768 && window.innerWidth < 1024) {
      if (readoutHost.parentElement !== rail) rail.prepend(readoutHost);
    } else if (readoutHost.parentElement !== globeWrap) {
      globeWrap.append(readoutHost);
    }
  };
  const layoutRail = (): void => {
    layoutReadout();
    if (window.innerWidth < 768) {
      rail.classList.add('as-sheet');
      rail.prepend(sheetToggle, summaryEl, sheetBody);
      sheetBody.append(list, finalState, sendWrap);
    } else {
      rail.classList.remove('as-sheet');
      if (sheetToggle.parentElement) sheetToggle.remove();
      if (summaryEl.parentElement) summaryEl.remove();
      rail.append(summaryEl, list, finalState, sendWrap);
    }
  };
  layoutRail();
  window.addEventListener('resize', layoutRail);
  layoutReadout();

  renderDecisions();
  applyScrub(chainage, true);
  if (initial.f) selectFinding(initial.f);
  if (initial.t) {
    void api<FlightAnswer>(`/api/review/${token}/flight?time=${encodeURIComponent(initial.t)}`).then((a) => {
      if (a.covered) readout.setFlight(a);
    }).catch(() => { /* no coverage */ });
  }

  // Status checks keep the banner honest without touching decisions.
  let outageShown = false;
  const outageHost = document.createElement('div');
  shell.prepend(outageHost);
  const checkStatus = async (): Promise<void> => {
    try {
      const s = await api<{ storage: 'ok' | 'unreachable' }>('/api/status');
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
      }
    } catch { /* keep the last state */ }
  };
  void checkStatus();
  setInterval(() => { void checkStatus(); }, 10_000);
}

/** View links in comments become Open this view links. */
function renderComment(comment: string, token: string): Node[] {
  const out: Node[] = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(comment)) !== null) {
    if (m.index > last) out.push(document.createTextNode(comment.slice(last, m.index)));
    const url = m[0];
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { parsed = null; }
    const isAppView = parsed !== null && parsed.origin === location.origin &&
      (/^\/corridors\/[^/]+/.test(parsed.pathname) || /^\/review\/[^/]+/.test(parsed.pathname));
    if (isAppView && parsed) {
      const a = document.createElement('a');
      a.textContent = 'Open this view';
      a.href = `/review/${token}${parsed.search}`;
      a.className = 'view-link';
      out.push(a);
    } else {
      out.push(document.createTextNode(url));
    }
    last = m.index + url.length;
  }
  if (last < comment.length) out.push(document.createTextNode(comment.slice(last)));
  return out;
}

function renderLinkProblem(shell: HTMLElement, err: unknown): void {
  shell.replaceChildren();
  const card = document.createElement('div');
  card.className = 'link-problem';
  const mark = document.createElement('p');
  mark.className = 'wordmark';
  mark.textContent = 'Spanwise';
  const msg = document.createElement('p');
  if (err instanceof ApiRequestError) {
    if (err.code === 'link_expired') msg.textContent = 'This review link has expired. Ask your survey contractor for a new one.';
    else if (err.code === 'link_revoked') msg.textContent = 'This review link has been withdrawn. Ask your survey contractor for a new one.';
    else msg.textContent = 'This review link does not exist.';
  } else {
    msg.textContent = 'This review link does not exist.';
  }
  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = msg.textContent;
  card.append(mark, msg, alert);
  shell.append(card);
}
