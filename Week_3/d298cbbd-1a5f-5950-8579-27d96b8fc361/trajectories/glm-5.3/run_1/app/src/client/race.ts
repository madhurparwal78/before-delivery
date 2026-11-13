import { api, ApiRequestError } from './api.js';
import { announce, el, formatPercent, formatSpeed, ordinal, roundHalfUp } from './dom.js';
import { COPY } from './copy.js';
import type { PageContext } from './main.js';
import { applyEntry, initialEngineState, type LogEntry } from '../shared/engine.js';

// Race rooms: the index with Create and Join, and the room page.

interface RacerView { name: string; host: boolean; left: boolean; progress: number; place: number | null; speed: number | null; accuracy: number | null }

export async function renderRaceIndex(context: PageContext, folder: HTMLElement): Promise<void> {
  const { app, onNavigate } = context;
  const sheetEl = el('div', { class: 'sheet race-sheet' }, '');
  if (app.state.session === null) {
    const line = el('p', { class: 'race-signed-out' }, COPY.raceSignedOut);
    const link = el('a', { href: '/signin', class: 'quiet-link' }, 'Sign in');
    sheetEl.append(link, line);
    folder.appendChild(sheetEl);
    return;
  }
  const alert = el('div', { role: 'alert', class: 'race-alert' }, '');
  const create = el('button', { class: 'button', type: 'button' }, COPY.createRoom) as unknown as HTMLButtonElement;
  create.addEventListener('click', async () => {
    try {
      const room = await api<{ code: string }>('/api/rooms', 'POST', {});
      onNavigate(`/race/${room.code}`);
    } catch {
      alert.textContent = COPY.serverError;
    }
  });
  const input = el('input', { class: 'input', 'aria-label': 'Room code', placeholder: 'XXX-XXX' }) as unknown as HTMLInputElement;
  const join = el('button', { class: 'button button-quiet', type: 'button' }, COPY.join) as unknown as HTMLButtonElement;
  const doJoin = async (): Promise<void> => {
    const code = input.value.trim();
    if (code === '') return;
    try {
      await api(`/api/rooms/${encodeURIComponent(code)}/join`, 'POST', {});
      onNavigate(`/race/${code.toUpperCase()}`);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        alert.textContent = error.code === 'room_not_found' ? COPY.unknownRoom : error.code === 'room_full' ? COPY.roomFull : COPY.serverError;
      } else {
        alert.textContent = COPY.serverError;
      }
    }
  };
  join.addEventListener('click', () => { void doJoin(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void doJoin(); }
  });
  const joinRow = el('div', { class: 'race-join-row' }, '');
  joinRow.append(input, join);
  sheetEl.append(create, joinRow, alert);
  folder.appendChild(sheetEl);
}

export async function renderRaceRoom(context: PageContext, folder: HTMLElement, code: string): Promise<void> {
  const { app } = context;
  const sheetEl = el('div', { class: 'sheet race-room' }, '');
  folder.appendChild(sheetEl);
  if (app.state.session === null) {
    sheetEl.append(el('a', { href: '/signin', class: 'quiet-link' }, 'Sign in'), el('p', { class: 'race-signed-out' }, COPY.raceSignedOut));
    return;
  }

  const alert = el('div', { role: 'alert', class: 'race-alert' }, '');
  const codeEl = el('div', { id: 'room-code', class: 'room-code' }, formatRoomCode(code));
  const racersList = el('ul', { class: 'racers-list', 'aria-label': 'Racers' }, '');
  const countdown = el('div', { role: 'status', 'aria-label': 'Race countdown', class: 'status-region race-countdown' }, '');
  const updates = el('div', { role: 'status', 'aria-label': 'Race updates', class: 'status-region race-updates' }, '');
  const startButton = el('button', { class: 'button', type: 'button' }, COPY.startRace) as unknown as HTMLButtonElement;
  const barsHost = el('div', { class: 'progress-bars' }, '');
  const resultsHost = el('div', { class: 'race-results' }, '');
  const wordsArea = el('div', { id: 'words', class: 'words-area race-words' }, '');
  const caret = el('div', { id: 'caret', class: 'caret', 'data-word': '0', 'data-letter': '0', 'data-style': 'line' }, '');
  const typingInput = el('input', { type: 'text', class: 'typing-input', 'aria-label': 'Typing input', autocomplete: 'off' }, '') as unknown as HTMLInputElement;
  const finishedLine = el('div', { class: 'race-finish-line' }, '');

  sheetEl.append(codeEl, alert, racersList, updates, startButton, countdown, wordsArea, typingInput, barsHost, finishedLine, resultsHost);

  let state: 'open' | 'countdown' | 'racing' | 'finished' = 'open';
  let words: string[] = [];
  let goAt: number | null = null;
  let log: LogEntry[] = [];
  let ownLog: LogEntry[] = [];
  let finished = false;
  const bars = new Map<string, HTMLElement>();

  const renderRacers = (racers: RacerView[]): void => {
    racersList.textContent = '';
    barsHost.textContent = '';
    for (const racer of racers) {
      const label = `${racer.name}${racer.host ? ' (host)' : ''}${racer.left ? ' (Left)' : ''}`;
      racersList.appendChild(el('li', { class: 'racer-item' }, label));
      const barHost = el('div', { class: 'progress-bar-host' }, '');
      const bar = el('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuenow': String(racer.progress), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${racer.name} progress` }, '');
      bar.style.setProperty('--progress', `${racer.progress}%`);
      barHost.append(el('span', { class: 'progress-name' }, racer.name), bar);
      barsHost.appendChild(barHost);
      bars.set(racer.name, bar);
    }
  };

  const renderResults = (racers: RacerView[]): void => {
    resultsHost.textContent = '';
    const table = el('table', { class: 'data-table', 'aria-label': 'Race results' });
    const thead = el('thead', {}, '');
    const headRow = el('tr', {}, '');
    for (const column of ['Place', 'Racer', 'Speed', 'Accuracy']) {
      headRow.appendChild(el('th', { scope: 'col' }, column));
    }
    thead.appendChild(headRow);
    const tbody = el('tbody', {}, '');
    for (const racer of racers) {
      const tr = el('tr', {}, '');
      tr.append(
        el('td', {}, racer.place === null ? (racer.left ? 'Left' : 'DNF') : ordinal(racer.place)),
        el('td', {}, racer.name),
        el('td', {}, racer.speed === null ? '-' : formatSpeed(racer.speed)),
        el('td', {}, racer.accuracy === null ? '-' : formatPercent(racer.accuracy)),
      );
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    resultsHost.appendChild(table);
  };

  const applyState = (payload: { state: string; racers: RacerView[]; words: string[] | null; elapsedMs: number | null }): void => {
    const previous = state;
    state = payload.state as typeof state;
    renderRacers(payload.racers);
    renderResults(payload.racers);
    const meHost = payload.racers.find((r) => r.host);
    startButton.style.display = meHost === undefined || state !== 'open' ? 'none' : '';
    startButton.disabled = payload.racers.length < 2;
    if (payload.words !== null && words.length === 0) {
      words = payload.words;
      layoutWords();
    }
    if (state === 'racing' && previous !== 'racing' && !finished) {
      typingInput.focus({ preventScroll: true });
    }
  };

  const layoutWords = (): void => {
    wordsArea.textContent = '';
    words.forEach((word, index) => {
      const wordEl = el('div', { class: 'word', 'data-index': String(index), 'data-line': '1' }, '');
      for (const letter of word) {
        wordEl.appendChild(el('span', { class: 'letter', 'data-state': 'untyped' }, letter));
      }
      wordsArea.appendChild(wordEl);
    });
    wordsArea.appendChild(caret);
  };

  const renderTyped = (): void => {
    const engine = initialEngineState(words);
    for (const entry of log) {
      const outcome = applyEntry(engine, entry, { maxExtraLetters: 10, timeLimitMs: null });
      if (outcome === null) continue;
      if (outcome.ended) break;
    }
    wordsArea.querySelectorAll('.word').forEach((wordEl, index) => {
      const word = words[index];
      const typed = engine.words[index]?.typed ?? '';
      const missed = engine.words[index]?.missed ?? 0;
      wordEl.querySelectorAll('.letter').forEach((letterEl, letterIndex) => {
        let value = 'untyped';
        if (letterIndex < typed.length) value = word.charAt(letterIndex) === typed.charAt(letterIndex) ? 'correct' : 'incorrect';
        else if (missed > 0 && letterIndex >= typed.length && letterIndex >= word.length - missed) value = 'missed';
        letterEl.setAttribute('data-state', value);
      });
    });
    caret.setAttribute('data-word', String(engine.wordIndex));
    caret.setAttribute('data-letter', String(engine.words[engine.wordIndex]?.typed.length ?? 0));
  };

  typingInput.addEventListener('keydown', (event) => {
    if (state !== 'racing' || finished) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (event.key === 'Backspace') { event.preventDefault(); pushKey('CtrlBackspace'); }
      return;
    }
    if (event.key === 'Backspace') { event.preventDefault(); pushKey('Backspace'); return; }
    if (event.key === ' ') { event.preventDefault(); pushKey('Space'); return; }
    if (event.key.length === 1) { event.preventDefault(); pushKey(event.key); }
  });
  typingInput.addEventListener('input', () => {
    const value = typingInput.value;
    typingInput.value = '';
    for (const character of value) pushKey(character === ' ' ? 'Space' : character);
  });

  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  const pushKey = (key: string): void => {
    if (state !== 'racing' || finished) return;
    const now = goAt === null ? 0 : performance.now() - goAt;
    const entry = { k: key, t: Math.max(0, Math.round(now)) };
    log.push(entry);
    ownLog.push(entry);
    renderTyped();
    if (sendTimer === null) {
      sendTimer = setTimeout(() => {
        sendTimer = null;
        void api(`/api/rooms/${encodeURIComponent(code)}/typed`, 'POST', { log: ownLog }).catch(() => { void 0; });
      }, 200);
    }
    const engine = initialEngineState(words);
    for (const entry2 of log) {
      const outcome = applyEntry(engine, entry2, { maxExtraLetters: 10, timeLimitMs: null });
      if (outcome === null) continue;
      if (outcome.ended) {
        void finishRace();
        return;
      }
    }
  };

  const finishRace = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    try {
      const result = await api<{ place: number; speed: number; accuracy: number }>(`/api/rooms/${encodeURIComponent(code)}/finish`, 'POST', { log: ownLog, text: words });
      finishedLine.textContent = `Speed ${formatSpeed(result.speed)}, accuracy ${formatPercent(result.accuracy)}, place ${ordinal(result.place)}.`;
      wordsArea.style.display = 'none';
      typingInput.style.display = 'none';
    } catch (error) {
      if (error instanceof ApiRequestError) {
        alert.textContent = error.code === 'race_over' ? COPY.raceStarted : COPY.serverError;
      }
    }
  };

  startButton.addEventListener('click', async () => {
    try {
      await api(`/api/rooms/${encodeURIComponent(code)}/start`, 'POST', {});
    } catch (error) {
      if (error instanceof ApiRequestError) alert.textContent = COPY.serverError;
    }
  });

  // Join, then follow the live channel.
  try {
    const join = await api<{ code: string; rejoined: boolean }>(`/api/rooms/${encodeURIComponent(code)}/join`, 'POST', {});
    if (join.rejoined) announce(updates, `Rejoined race ${formatRoomCode(join.code)}.`);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.code === 'room_not_found') alert.textContent = COPY.unknownRoom;
      else if (error.code === 'room_full') alert.textContent = COPY.roomFull;
      else if (error.code === 'race_started') alert.textContent = COPY.raceStarted;
      else alert.textContent = COPY.serverError;
      return;
    }
    return;
  }
  try {
    const room = await api<{ state: string; racers: RacerView[]; words: string[] | null; elapsedMs: number | null; log?: LogEntry[] }>(`/api/rooms/${encodeURIComponent(code)}`, 'GET');
    if (room.log !== undefined && room.log.length > 0) {
      log = room.log;
      ownLog = room.log.slice();
    }
    applyState(room);
    if (room.state === 'racing' && room.elapsedMs !== null) {
      goAt = performance.now() - room.elapsedMs;
    }
  } catch {
    alert.textContent = COPY.serverError;
    return;
  }

  app.connectLive([], code);
  app.onLive((event) => {
    const payload = event.payload as Record<string, unknown>;
    if (event.kind === 'room-state') {
      applyState(payload as unknown as { state: string; racers: RacerView[]; words: string[] | null; elapsedMs: number | null });
      if ((payload as { state?: string }).state === 'racing' && goAt === null) {
        goAt = performance.now();
        typingInput.focus({ preventScroll: true });
      }
      if ((payload as { state?: string }).state === 'finished' && state === 'finished') {
        if (resultsHost.querySelector('h3') === null) {
          resultsHost.insertBefore(el('h3', { class: 'sheet-heading' }, COPY.raceFinishedHeading), resultsHost.firstChild);
        }
      }
      return;
    }
    if (event.kind === 'countdown') {
      const step = payload.step;
      countdown.textContent = String(step);
      return;
    }
    if (event.kind === 'racer-joined' && typeof payload.name === 'string') {
      announce(updates, `${payload.name} joined.`);
      return;
    }
    if (event.kind === 'racer-left' && typeof payload.name === 'string') {
      announce(updates, `${payload.name} left.`);
      return;
    }
    if (event.kind === 'host-changed' && typeof payload.name === 'string') {
      announce(updates, `${payload.name} is now the host.`);
      return;
    }
    if (event.kind === 'racer-finished' && typeof payload.name === 'string' && typeof payload.place === 'number') {
      announce(updates, `${payload.name} finished ${ordinal(payload.place)} with ${formatSpeed(typeof payload.speed === 'number' ? payload.speed : 0)} wpm.`);
      return;
    }
    if (event.kind === 'race-over') {
      announce(updates, COPY.raceFinishedAnnouncement);
      return;
    }
    if (event.kind === 'progress' && typeof payload.typistId === 'string' && typeof payload.progress === 'number') {
      void payload;
      return;
    }
    void roundHalfUp;
  });
}

function formatRoomCode(code: string): string {
  const normalized = code.replace(/[-\s]/g, '').toUpperCase();
  if (normalized.length !== 6) return code.toUpperCase();
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}
