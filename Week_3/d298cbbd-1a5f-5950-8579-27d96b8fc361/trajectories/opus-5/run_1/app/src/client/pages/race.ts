import { api, type RoomSnapshot } from '../api.js';
import {
  COPY,
  newHost,
  percent,
  racerFinished,
  racerJoined,
  racerLeft,
  rejoinedRace,
  resultLine,
  two,
} from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { state } from '../state.js';
import { heading, signInHref } from '../shell.js';
import { WordsView } from '../test/words-view.js';
import {
  TypingEngine,
  isPrintedKey,
  replay,
  roundHalfUp,
  type LogEntry,
} from '../../shared/engine.js';

export class RaceLobbyPage implements Page {
  render(container: HTMLElement): void {
    container.textContent = '';
    const folder = el('div', { class: 'folder open ticket' });
    folder.append(heading(1, 'Race rooms'));
    if (!state.session) {
      folder.append(
        el('div', { class: 'row' }, [
          el('a', { href: signInHref(), class: 'link' }, ['Sign in']),
          el('span', {}, [COPY.raceSignedOut]),
        ]),
      );
      container.append(folder);
      return;
    }
    const alertSlot = el('div', { class: 'alert-slot' });
    const create = el('button', { type: 'button', class: 'button' }, ['Create room']);
    create.addEventListener('click', () => {
      void api.post<{ code: string }>('/api/rooms').then((response) => {
        if (response.status === 201 && response.body) navigate(`/race/${response.body.code}`);
        else alertSlot.replaceChildren(el('p', { role: 'alert', class: 'alert' }, [COPY.serverError]));
      });
    });
    const code = el('input', {
      type: 'text',
      class: 'input',
      'aria-label': 'Room code',
      autocomplete: 'off',
    }) as HTMLInputElement;
    const join = el('button', { type: 'submit', class: 'button' }, ['Join']);
    const form = el('form', { class: 'row' }, [
      el('label', { class: 'field' }, [el('span', {}, ['Room code']), code]),
      join,
    ]) as HTMLFormElement;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const trimmed = code.value.trim();
      if (trimmed === '') return;
      void api
        .post<{ code: string; error?: string }>(`/api/rooms/${encodeURIComponent(trimmed)}/join`)
        .then((response) => {
          if (response.status === 200 && response.body) {
            navigate(`/race/${response.body.code}`);
            return;
          }
          alertSlot.replaceChildren(
            el('p', { role: 'alert', class: 'alert' }, [refusal(response.status, response.body?.error)]),
          );
        });
    });
    folder.append(create, form, alertSlot);
    container.append(folder);
  }
}

function refusal(status: number, code: string | undefined): string {
  if (status === 404) return COPY.unknownRoom;
  if (code === 'room_full') return COPY.fullRoom;
  if (code === 'race_started') return COPY.startedRace;
  return COPY.serverError;
}

interface RoomEventPayload {
  seq: number;
  kind: 'join' | 'leave' | 'host' | 'finish' | 'finished';
  actorId: string | null;
  payload: { name?: string; place?: number; speed?: number };
}

export class RaceRoomPage implements Page {
  private readonly code: string;
  private readonly view = new WordsView(() => this.focusInput());
  private readonly codeEl = el('p', { id: 'room-code', class: 'room-code' });
  private readonly racersList = el('ul', { role: 'list', 'aria-label': 'Racers', class: 'racers' });
  private readonly countdown = el('div', {
    role: 'status',
    'aria-label': 'Race countdown',
    class: 'countdown',
  });
  private readonly updates = el('div', {
    role: 'status',
    'aria-label': 'Race updates',
    class: 'visually-hidden',
  });
  private readonly bars = el('div', { class: 'bars' });
  private readonly resultsHolder = el('div', { class: 'results-holder' });
  private readonly headingSlot = el('div', { class: 'race-heading' });
  private readonly alertSlot = el('div', { class: 'alert-slot' });
  private readonly startButton = el('button', { type: 'button', class: 'button' }, [
    'Start race',
  ]) as HTMLButtonElement;
  private readonly typingInput = el('input', {
    type: 'text',
    class: 'typing-input',
    'aria-label': 'Typing input',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  private stream: EventSource | null = null;
  private snapshot: RoomSnapshot | null = null;
  private engine: TypingEngine | null = null;
  private log: LogEntry[] = [];
  private goAt: number | null = null;
  private finished = false;
  private lastSeq = 0;
  private announced = new Set<number>();
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private words: string[] = [];
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKey(event);

  constructor(code: string) {
    this.code = code;
  }

  async render(container: HTMLElement): Promise<void> {
    container.textContent = '';
    const folder = el('div', { class: 'folder open ticket' });
    folder.append(
      this.headingSlot,
      this.codeEl,
      this.racersList,
      this.startButton,
      this.countdown,
      this.view.holder,
      this.typingInput,
      this.bars,
      this.resultsHolder,
      this.updates,
      this.alertSlot,
    );
    container.append(folder);
    this.codeEl.textContent = this.code.toUpperCase();
    this.startButton.hidden = true;
    this.startButton.addEventListener('click', () => {
      void api.post<{ error?: string }>(`/api/rooms/${this.code}/start`).then((response) => {
        if (response.status !== 200) {
          this.alertSlot.replaceChildren(
            el('p', { role: 'alert', class: 'alert' }, [
              refusal(response.status, response.body?.error),
            ]),
          );
        }
      });
    });

    if (!state.session) {
      folder.replaceChildren(
        heading(1, 'Race room'),
        el('div', { class: 'row' }, [
          el('a', { href: signInHref(), class: 'link' }, ['Sign in']),
          el('span', {}, [COPY.raceSignedOut]),
        ]),
      );
      return;
    }

    const response = await api.post<{ code: string; rejoined: boolean; error?: string }>(
      `/api/rooms/${this.code}/join`,
    );
    if (response.status !== 200 || !response.body) {
      folder.replaceChildren(
        heading(1, 'Race room'),
        el('p', { role: 'alert', class: 'alert' }, [refusal(response.status, response.body?.error)]),
        el('a', { href: '/race', class: 'link' }, ['Race rooms']),
      );
      return;
    }
    this.codeEl.textContent = response.body.code;
    if (response.body.rejoined) this.updates.textContent = rejoinedRace(response.body.code);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.listen();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown, true);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.stream?.close();
    this.stream = null;
  }

  private listen(): void {
    this.stream?.close();
    const stream = new EventSource(`/api/live/room/${this.code}?since=${this.lastSeq}`);
    this.stream = stream;
    stream.addEventListener('room', (event) => {
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as RoomSnapshot;
      this.applySnapshot(snapshot);
    });
    stream.addEventListener('countdown', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { step: string };
      this.countdown.textContent = payload.step;
      if (payload.step === 'Go') {
        this.goAt = performance.now();
        this.focusInput();
      }
    });
    stream.addEventListener('progress', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        name: string;
        progress: number;
      };
      this.setBar(payload.name, payload.progress);
    });
    stream.addEventListener('event', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RoomEventPayload;
      this.handleRoomEvent(payload);
    });
    stream.addEventListener('error', () => {
      stream.close();
      setTimeout(() => {
        if (this.stream === stream) this.listen();
      }, 1000);
    });
  }

  private handleRoomEvent(event: RoomEventPayload): void {
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    if (this.announced.has(event.seq)) return;
    this.announced.add(event.seq);
    if (event.actorId !== null && event.actorId === state.session?.id) return;
    const name = event.payload.name ?? '';
    if (event.kind === 'join') this.updates.textContent = racerJoined(name);
    else if (event.kind === 'leave') this.updates.textContent = racerLeft(name);
    else if (event.kind === 'host') this.updates.textContent = newHost(name);
    else if (event.kind === 'finish') {
      this.updates.textContent = racerFinished(name, event.payload.place ?? 1, event.payload.speed ?? 0);
    } else this.updates.textContent = COPY.raceFinishedAnnouncement;
  }

  private applySnapshot(snapshot: RoomSnapshot): void {
    const first = this.snapshot === null;
    this.snapshot = snapshot;
    if (snapshot.seq !== undefined && first) this.lastSeq = snapshot.seq;
    this.paintRacers(snapshot);
    if (snapshot.words && this.words.length === 0) {
      this.words = snapshot.words;
      this.view.mount(snapshot.words);
      this.engine = new TypingEngine(snapshot.words, 'finite', state.config.maxExtraLetters);
      this.view.setCaret(0, 0, state.settings.caret);
      void document.fonts.ready.then(() => this.view.remeasure());
    }
    if (snapshot.state === 'racing' && snapshot.elapsedMs !== null && this.goAt === null) {
      this.goAt = performance.now() - snapshot.elapsedMs;
      this.focusInput();
    }
    if (snapshot.ownEntries && snapshot.ownEntries.length > 0 && this.log.length === 0 && this.engine) {
      this.log = snapshot.ownEntries;
      this.engine.applyAll(this.log);
      this.view.renderAll(this.engine);
      this.view.setCaret(this.engine.currentWord, this.engine.caretLetters, state.settings.caret);
    }
    if (snapshot.state === 'finished') {
      this.headingSlot.replaceChildren(heading(2, COPY.raceFinishedHeading));
    }
    this.paintResults(snapshot);
  }

  private paintRacers(snapshot: RoomSnapshot): void {
    this.racersList.textContent = '';
    for (const racer of snapshot.racers) {
      const label = `${racer.name}${racer.host ? ' (host)' : ''}${racer.left ? ' (Left)' : ''}`;
      this.racersList.append(el('li', { class: 'racer-stamp' }, [label]));
    }
    const own = snapshot.racers.find((racer) => racer.name === state.session?.name);
    const isHost = own?.host === true;
    this.startButton.hidden = !isHost || snapshot.state !== 'open';
    this.startButton.disabled = snapshot.racers.length < 2;

    this.bars.textContent = '';
    for (const racer of snapshot.racers) {
      const bar = el('div', {
        role: 'progressbar',
        'aria-label': `${racer.name} progress`,
        'aria-valuenow': racer.progress,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'data-racer': racer.name,
        class: 'progress',
      });
      bar.append(el('span', { class: 'progress-fill' }));
      bar.style.setProperty('--progress', String(racer.progress));
      this.bars.append(el('div', { class: 'bar-row' }, [el('span', {}, [racer.name]), bar]));
    }
  }

  private setBar(name: string, progress: number): void {
    const bar = this.bars.querySelector<HTMLElement>(`[data-racer="${CSS.escape(name)}"]`);
    if (!bar) return;
    const current = Number(bar.getAttribute('aria-valuenow') ?? '0');
    if (progress < current) return;
    bar.setAttribute('aria-valuenow', String(progress));
    bar.style.setProperty('--progress', String(progress));
  }

  private paintResults(snapshot: RoomSnapshot): void {
    const table = el('table', { class: 'data-table' });
    table.append(el('caption', {}, ['Race results']));
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Place']),
          el('th', { scope: 'col' }, ['Racer']),
          el('th', { scope: 'col' }, ['Speed']),
          el('th', { scope: 'col' }, ['Accuracy']),
        ]),
      ]),
    );
    const body = el('tbody');
    const ranked = [...snapshot.racers].sort((a, b) => {
      const left = typeof a.place === 'number' ? a.place : Number.MAX_SAFE_INTEGER;
      const right = typeof b.place === 'number' ? b.place : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
    for (const racer of ranked) {
      body.append(
        el('tr', {}, [
          el('td', {}, [racer.place === null ? '-' : String(racer.place)]),
          el('td', {}, [racer.name]),
          el('td', {}, [racer.speed === null ? '-' : two(racer.speed)]),
          el('td', {}, [racer.accuracy === null ? '-' : percent(racer.accuracy)]),
        ]),
      );
    }
    table.append(body);
    this.resultsHolder.replaceChildren(table);
  }

  private focusInput(): void {
    this.typingInput.focus({ preventScroll: true });
  }

  private handleKey(event: KeyboardEvent): void {
    if (document.activeElement !== this.typingInput) return;
    if (this.finished || this.goAt === null || !this.engine) return;
    const key =
      event.key === 'Backspace'
        ? event.ctrlKey || event.altKey
          ? 'CtrlBackspace'
          : 'Backspace'
        : event.key === ' '
          ? 'Space'
          : isPrintedKey(event.key) && !event.ctrlKey && !event.metaKey
            ? event.key
            : null;
    if (key === null) return;
    event.preventDefault();
    const entry: LogEntry = { k: key, t: Math.round(performance.now() - this.goAt) };
    this.log.push(entry);
    const before = this.engine.currentWord;
    const result = this.engine.apply(entry);
    this.view.renderWord(this.engine, before);
    const after = this.engine.currentWord;
    if (after !== before) this.view.renderWord(this.engine, after);
    this.view.setCaret(after, this.engine.caretLetters, state.settings.caret);
    this.view.scrollIfNeeded(after);
    this.scheduleSend();
    if (result.endedNow) this.finishRace(entry.t);
  }

  private scheduleSend(): void {
    if (this.sendTimer !== null) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      void api.post(`/api/rooms/${this.code}/keys`, { entries: this.log });
    }, 200);
  }

  private finishRace(duration: number): void {
    this.finished = true;
    const figures = replay({
      words: this.words,
      kind: 'finite',
      log: this.log,
      maxExtraLetters: state.config.maxExtraLetters,
      timeDurationMs: null,
    }).figures;
    void duration;
    void api
      .post(`/api/rooms/${this.code}/finish`, {
        text: this.words,
        log: this.log,
        duration: roundHalfUp(figures.duration),
        speed: roundHalfUp(figures.speed),
        raw: roundHalfUp(figures.raw),
        accuracy: roundHalfUp(figures.accuracy),
        consistency: roundHalfUp(figures.consistency),
        characters: { ...figures.characters },
      })
      .then(() => {
        this.view.holder.replaceChildren(
          el('p', { class: 'own-result' }, [
            resultLine(figures.speed, figures.accuracy, figures.raw, figures.consistency),
          ]),
        );
      });
  }
}
