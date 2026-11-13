import { api, type StoredRun } from './api.js';
import { el, formatDuration, formatPercent, formatSpeed, utcDateTimeFull } from './dom.js';
import { COPY, NOT_COUNTED_REASONS } from './copy.js';
import type { PageContext } from './main.js';
import { buildCarbon, buildChart, errorsByKeyTable, figureRow, renderWordStates, speedOverTimeTable } from './words.js';
import { applyEntry, initialEngineState, type LogEntry } from '../shared/engine.js';
import { errorsByKeyRows, perSecondSpeeds, replayLog } from '../shared/scoring.js';
import { roundHalfUp } from './dom.js';

// /runs/<id>: the certificate of a stored run, rebuilt from its log.

export async function renderRun(context: PageContext, folder: HTMLElement, runId: string): Promise<void> {
  const { app } = context;
  const sheetEl = el('div', { class: 'sheet run-sheet' }, '');
  folder.appendChild(sheetEl);
  let run: StoredRun;
  try {
    run = await api<StoredRun>(`/api/runs/${encodeURIComponent(runId)}`, 'GET');
  } catch {
    const notFound = el('div', { class: 'not-found-sheet' }, '');
    notFound.appendChild(el('h2', { class: 'sheet-heading' }, COPY.noSuchRun));
    sheetEl.appendChild(notFound);
    return;
  }

  const region = el('section', { class: 'certificate-region', role: 'region', 'aria-label': 'Certificate' }, '');
  const card = el('div', { class: 'certificate-card' }, '');
  const speedEl = el('div', { class: 'certificate-speed', id: 'result-speed' }, formatSpeed(run.speed));
  const figuresColumn = el('div', { class: 'figures-column' }, '');
  figuresColumn.append(
    figureRow('Raw speed', 'result-raw', formatSpeed(run.raw)),
    figureRow('Accuracy', 'result-accuracy', formatPercent(run.accuracy)),
    figureRow('Consistency', 'result-consistency', formatPercent(run.consistency)),
    figureRow('Characters', 'result-characters', run.characters === null ? '-' : `${run.characters.correct}/${run.characters.incorrect}/${run.characters.extra}/${run.characters.missed}`),
    figureRow('Duration', 'result-duration', formatDuration(run.duration)),
  );
  const keyboard = el('div', { class: 'error-keyboard' }, '');
  const errorRows = run.errorsByKey === null ? [] : errorsByKeyRows(run.errorsByKey);
  for (const row of errorRows) {
    const key = el('span', { class: 'keyboard-key' }, row.key);
    key.setAttribute('data-count', String(row.errors));
    keyboard.appendChild(key);
  }
  if (errorRows.length === 0 && run.errorsByKey !== null) keyboard.appendChild(el('span', { class: 'no-errors-inline' }, COPY.noErrors));

  const sealStatus = el('div', { role: 'status', 'aria-label': 'Seal', class: 'status-region seal-status', id: 'seal' }, '');
  if (run.verdict === 'counted') sealStatus.textContent = COPY.countedSeal;
  else sealStatus.textContent = `Not counted: ${NOT_COUNTED_REASONS[run.reason ?? ''] ?? COPY.serverError}`;

  const stub = el('div', { class: 'certificate-stub' }, '');
  const stubHolder = el('div', { class: 'stub-holder' }, '');
  const proof = el('div', { class: 'proof-key', id: 'proof-key' }, '');
  if (run.proofKey !== null) proof.textContent = `Proof ${run.proofKey.slice(0, 16)}`;
  stubHolder.append(sealStatus, proof);
  const finishedAt = el('div', { class: 'stub-finished', id: 'result-finished' }, utcDateTimeFull(run.finishedAt));
  stubHolder.appendChild(finishedAt);
  stub.appendChild(stubHolder);
  card.append(speedEl, el('div', { class: 'certificate-speed-label' }, 'wpm'), figuresColumn, keyboard, stub);
  region.appendChild(card);

  // The carbon, when the run has one: a counted run with a log to replay.
  const hasCarbon = run.verdict === 'counted' && Array.isArray(run.log) && run.log.length > 0 && run.perSecond !== null;
  if (hasCarbon) {
    const log = run.log as LogEntry[];
    const opts = { maxExtraLetters: app.state.config?.maxExtraLetters ?? 10, timeLimitMs: run.mode === 'time' ? (run.length ?? 15) * 1000 : null };
    const replay = replayLog(run.words, log, opts);
    const seconds = Math.max(1, Math.ceil((run.duration ?? replay.durationMs) / 1000));
    const speeds = perSecondSpeeds(run.speed ?? replay.figures.speed, run.words, log, opts, run.duration ?? replay.durationMs);
    const perSecond = (run.perSecond ?? []).map((row, index) => ({ ...row, speed: speeds[index] ?? row.speed }));

    const carbonPanel = el('div', { class: 'carbon-panel' }, '');
    const carbon = el('div', { id: 'carbon', class: 'words-area carbon' }, '');
    const carbonCaret = el('div', { id: 'carbon-caret', class: 'caret', 'data-word': '0', 'data-letter': '0', 'data-style': 'line' }, '');
    const nodes = buildCarbon(carbon, carbonCaret, run.words);
    const { chart, points } = buildChart(perSecond, Math.max(...perSecond.map((p) => p.speed), 10));
    const numeral = el('div', { class: 'replay-numeral' }, '');
    const numeralValue = el('span', { id: 'replay-speed', class: 'replay-speed' }, roundHalfUp(perSecond[seconds - 1]?.speed ?? 0).toFixed(2));
    numeral.append(el('span', { class: 'replay-label' }, 'Speed'), numeralValue);
    const slider = el('input', { type: 'range', class: 'replay-slider', 'aria-label': 'Replay position', min: '0', max: String(seconds), value: String(seconds), step: '1' }) as unknown as HTMLInputElement;
    const tableWrap = el('div', { class: 'certificate-tables' }, '');
    const speedTable = speedOverTimeTable(perSecond);
    tableWrap.append(speedTable, errorsByKeyTable(errorRows, COPY.noErrors));
    carbonPanel.append(carbon, numeral, chart, slider, tableWrap);
    region.appendChild(carbonPanel);

    const render = (position: number): void => {
      const slice = log.filter((entry) => entry.t < position * 1000);
      const state = initialEngineState(run.words);
      for (const entry of slice) {
        const outcome = applyEntry(state, entry, opts);
        if (outcome === null) continue;
        if (outcome.ended) break;
      }
      renderWordStates(nodes, state, 0, false, app.state.config?.maxExtraLetters ?? 10);
      carbonCaret.setAttribute('data-word', String(state.wordIndex));
      carbonCaret.setAttribute('data-letter', String(state.words[state.wordIndex]?.typed.length ?? 0));
      numeralValue.textContent = roundHalfUp(position === 0 ? 0 : perSecond[position - 1]?.speed ?? 0).toFixed(2);
      points.forEach((point) => {
        const second = Number(point.getAttribute('data-second'));
        point.classList.toggle('current', second === position && position !== 0);
      });
      speedTable.querySelectorAll('tr[data-second]').forEach((row) => {
        const second = Number(row.getAttribute('data-second'));
        if (second === position && position !== 0) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
      });
    };

    const setSlider = (position: number, moveAddress: boolean): void => {
      const clamped = Math.max(0, Math.min(seconds, Math.trunc(position)));
      slider.value = String(clamped);
      slider.setAttribute('aria-valuenow', String(clamped));
      slider.setAttribute('aria-valuetext', `${clamped} seconds, speed ${roundHalfUp(clamped === 0 ? 0 : perSecond[clamped - 1]?.speed ?? 0).toFixed(2)}`);
      render(clamped);
      if (moveAddress) {
        window.history.replaceState({}, '', `/runs/${runId}?at=${clamped}`);
      }
    };

    // The address decides the starting position.
    const at = new URLSearchParams(window.location.search).get('at');
    let start = seconds;
    if (at !== null) {
      const value = Number(at);
      if (Number.isInteger(value) && String(Math.trunc(value)) === at.trim()) {
        start = Math.max(0, Math.min(seconds, value));
        if (start !== value) window.history.replaceState({}, '', `/runs/${runId}?at=${start}`);
        else window.history.replaceState({}, '', `/runs/${runId}?at=${start}`);
      } else {
        window.history.replaceState({}, '', `/runs/${runId}?at=${seconds}`);
      }
    }
    setSlider(start, false);

    slider.addEventListener('input', () => setSlider(Number(slider.value), true));
    slider.addEventListener('keydown', (event) => {
      const current = Number(slider.value);
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setSlider(current + 1, true); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setSlider(current - 1, true); }
      else if (event.key === 'PageUp') { event.preventDefault(); setSlider(current + 5, true); }
      else if (event.key === 'PageDown') { event.preventDefault(); setSlider(current - 5, true); }
      else if (event.key === 'Home') { event.preventDefault(); setSlider(0, true); }
      else if (event.key === 'End') { event.preventDefault(); setSlider(seconds, true); }
    });
    slider.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
    slider.addEventListener('touchmove', (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      const rect = slider.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      setSlider(Math.round(ratio * seconds), true);
    }, { passive: false });
  }

  sheetEl.appendChild(region);
}
