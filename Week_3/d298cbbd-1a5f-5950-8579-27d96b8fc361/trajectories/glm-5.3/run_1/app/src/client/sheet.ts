import { applyEntry, endByClock, initialEngineState, isLoggedKey, KEY_BACKSPACE, KEY_SPACE, type EngineState, type LogEntry } from '../shared/engine.js';
import { errorsByKeyRows, perSecondSpeeds, replayLog } from '../shared/scoring.js';
import { accuracyOf, consistencyFrom, wpm } from '../shared/engine.js';
import { api, ApiRequestError, type RunSubmission, type TicketResponse } from './api.js';
import { announce, el, roundHalfUp, roundHalfUpInt } from './dom.js';
import { COPY, NOT_COUNTED_REASONS } from './copy.js';
import { buildCarbon, buildChart, buildWordsArea, computeVisibleLines, errorsByKeyTable, figureRow, lineHeightOf, renderWordStates, speedOverTimeTable, type CarbonNode, type LetterNode } from './words.js';
import type { App, StoredChoices } from './app.js';

// The test sheet: ticket requests, the typing loop, the dialogs and the seal.

export interface SheetCallbacks {
  onNavigate: (path: string) => void;
}

interface OwnedTimers {
  endTimeout: ReturnType<typeof setTimeout> | null;
  tickInterval: ReturnType<typeof setInterval> | null;
  focusTimer: ReturnType<typeof setTimeout> | null;
  resendTimer: ReturnType<typeof setTimeout> | null;
}

export class TestSheet {
  private readonly app: App;
  private readonly sheet: HTMLElement;
  private readonly callbacks: SheetCallbacks;
  private choices: StoredChoices;
  private saveChoices: (choices: StoredChoices) => void;
  private customText: string;
  private ticket: TicketResponse | null = null;
  private ticketRequest = 0;
  private ticketFocusPending = true;
  private log: LogEntry[] = [];
  private state: EngineState = initialEngineState([]);
  private keystrokesAt: { t: number; correct: boolean }[] = [];
  private startTime: number | null = null;
  private timers: OwnedTimers = { endTimeout: null, tickInterval: null, focusTimer: null, resendTimer: null };
  private finished = false;
  private resultAnnounced = false;
  private sealState: 'none' | 'held' | 'counted' | 'not_counted' | 'not_filed_sign_in' | 'not_filed_verify' = 'none';
  private sealAnnounced = '';
  private focusWarningShown = false;
  private capsLockOn = false;
  private modeBeforeCustom: StoredChoices['mode'] = 'time';
  private commandFilter = '';
  private commandOpen = false;
  private customOpen = false;
  private customFromRadio = false;
  private commandActive = 0;

  // Elements.
  private wordsArea!: HTMLElement;
  private caret!: HTMLElement;
  private letterNodes: LetterNode[] = [];
  private timerEl!: HTMLElement;
  private liveSpeed!: HTMLElement;
  private liveAccuracy!: HTMLElement;
  private typingInput!: HTMLInputElement;

  private focusLayer!: HTMLElement;
  private focusButton!: HTMLButtonElement;
  private capsStatus!: HTMLElement;
  private sealStatus!: HTMLElement;
  private resultStatus!: HTMLElement;
  private settingsStatus!: HTMLElement;
  private quoteSourceEl!: HTMLElement;
  private ticketAlert!: HTMLElement;
  private modeHost!: HTMLElement;
  private restartButton!: HTMLButtonElement;
  private certificateRegion: HTMLElement | null = null;
  private customDialog: HTMLDialogElement | undefined;
  private commandDialog: HTMLDialogElement | undefined;

  constructor(app: App, container: HTMLElement, choices: StoredChoices, saveChoices: (choices: StoredChoices) => void, customText: string, callbacks: SheetCallbacks) {
    this.app = app;
    this.choices = { ...choices };
    this.saveChoices = saveChoices;
    this.customText = customText;
    this.callbacks = callbacks;
    this.sheet = el('div', { class: 'sheet' }, '');
    container.appendChild(this.sheet);
    this.build();
    void this.requestTicket();
  }

  private build(): void {
    this.modeHost = el('div', { class: 'mode-row' }, '');
    const beginRow = el('div', { class: 'begin-row' }, '');
    this.beginButtonBuild(beginRow);

    const readouts = el('div', { class: 'readouts' }, '');
    const timerGroup = el('div', { class: 'readout-group' }, '');
    timerGroup.append(el('span', { class: 'readout-label' }, 'Time'), this.timerElBuild());
    const speedGroup = el('div', { class: 'readout-group' }, '');
    this.liveSpeed = el('span', { id: 'live-speed', class: 'readout' }, '0');
    speedGroup.append(el('span', { class: 'readout-label' }, 'Speed'), this.liveSpeed);
    const accuracyGroup = el('div', { class: 'readout-group' }, '');
    this.liveAccuracy = el('span', { id: 'live-accuracy', class: 'readout' }, '100%');
    accuracyGroup.append(el('span', { class: 'readout-label' }, 'Accuracy'), this.liveAccuracy);
    readouts.append(timerGroup, speedGroup, accuracyGroup);

    this.wordsArea = el('div', { id: 'words', class: 'words-area', 'aria-busy': 'true' }, '');
    this.caret = el('div', { id: 'caret', class: 'caret', 'data-word': '0', 'data-letter': '0', 'data-style': 'line' }, '');
    this.wordsArea.appendChild(this.caret);

    this.focusLayer = el('div', { class: 'focus-layer' }, '');
    this.focusLayer.style.display = 'none';
    this.focusButton = el('button', { type: 'button', class: 'focus-button' }, COPY.focusButton) as unknown as HTMLButtonElement;
    this.focusButton.addEventListener('click', () => this.refocus());
    this.focusLayer.appendChild(this.focusButton);
    const wordsWrap = el('div', { class: 'words-wrap' }, '');
    wordsWrap.append(this.wordsArea, this.focusLayer);

    this.typingInput = el('input', {
      type: 'text', class: 'typing-input', 'aria-label': 'Typing input',
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    }, '') as unknown as HTMLInputElement;
    this.typingInput.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.typingInput.addEventListener('input', () => this.onInput());
    this.typingInput.addEventListener('blur', () => this.scheduleFocusWarning());
    this.typingInput.addEventListener('focus', () => this.clearFocusWarning());

    const restartButton = el('button', { type: 'button', class: 'button button-quiet restart-button' }, COPY.restartTest) as unknown as HTMLButtonElement;
    restartButton.addEventListener('click', () => this.restart());
    this.restartButton = restartButton;

    this.capsStatus = el('div', { role: 'status', 'aria-label': 'Caps Lock', class: 'status-region caps-status' }, '');
    this.sealStatus = el('div', { role: 'status', 'aria-label': 'Seal', class: 'status-region seal-status', id: 'seal' }, '');
    this.resultStatus = el('div', { role: 'status', 'aria-label': 'Test result', class: 'status-region result-status' }, '');
    this.settingsStatus = el('div', { role: 'status', 'aria-label': 'Settings updates', class: 'status-region settings-status' }, '');

    this.quoteSourceEl = el('div', { id: 'quote-source', class: 'quote-source' }, '');
    this.ticketAlert = el('div', { role: 'alert', class: 'ticket-alert' }, '');
    this.ticketAlert.style.display = 'none';

    const statusRow = el('div', { class: 'status-row' }, '');
    statusRow.append(this.sealStatus, this.resultStatus, this.settingsStatus);

    this.sheet.append(this.modeHost, readouts, wordsWrap, this.quoteSourceEl, this.capsStatus, beginRow, this.typingInput, this.restartButton, statusRow, this.ticketAlert);

    document.addEventListener('keydown', (event) => {
      this.onCapsKeyDown(event);
      this.onBodyKeyDown(event);
    });
    window.addEventListener('resize', () => {
      const requestId = this.ticketRequest;
      requestAnimationFrame(() => {
        if (requestId === this.ticketRequest) this.relayout();
      });
    });
    window.addEventListener('keydown', (event) => this.onWindowKeyDown(event), { capture: true });
    this.buildModeControls();
    this.updateTimerText();
  }

  private beginButtonBuild(row: HTMLElement): void {
    const button = el('button', { type: 'button', class: 'button begin-button' }, COPY.beginTest) as unknown as HTMLButtonElement;
    button.addEventListener('click', () => {
      this.sheet.scrollIntoView({ block: 'start' });
      this.refocus();
    });
    row.appendChild(button);
  }

  private timerElBuild(): HTMLElement {
    this.timerEl = el('span', { id: 'timer', class: 'readout timer' }, '');
    return this.timerEl;
  }

  // Mode controls, rebuilt whenever the mode changes.

  private buildModeControls(): void {
    this.modeHost.textContent = '';
    const modeGroup = el('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': 'Mode' }, '');
    const modes: StoredChoices['mode'][] = ['time', 'words', 'quote', 'custom'];
    for (const mode of modes) {
      const id = `mode-${mode}`;
      const input = el('input', { type: 'radio', name: 'mode', id, value: mode }) as unknown as HTMLInputElement;
      input.checked = this.choices.mode === mode;
      input.addEventListener('keydown', (event) => this.onModeControlKeyDown(event));
      input.addEventListener('click', () => {
        if (this.choices.mode === mode) return;
        this.pickMode(mode, true);
      });
      const label = el('label', { for: id, class: 'mode-label' }, mode);
      modeGroup.append(input, label);
    }
    this.modeHost.appendChild(modeGroup);

    if (this.choices.mode === 'time' || this.choices.mode === 'words') {
      const lengthGroup = el('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': 'Length' }, '');
      const lengths = this.choices.mode === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
      const current = this.choices.mode === 'time' ? this.choices.timeLength : this.choices.wordsLength;
      for (const length of lengths) {
        const id = `length-${this.choices.mode}-${length}`;
        const input = el('input', { type: 'radio', name: 'length', id, value: String(length) }) as unknown as HTMLInputElement;
        input.checked = current === length;
        input.addEventListener('keydown', (event) => this.onModeControlKeyDown(event));
        input.addEventListener('click', () => {
          const value = Number(input.value);
          if (this.choices.mode === 'time') {
            if (this.choices.timeLength === value) return;
            this.choices.timeLength = value;
          } else {
            if (this.choices.wordsLength === value) return;
            this.choices.wordsLength = value;
          }
          this.saveChoices(this.choices);
          void this.requestTicket();
        });
        const label = el('label', { for: id, class: 'mode-label' }, String(length));
        lengthGroup.append(input, label);
      }
      this.modeHost.appendChild(lengthGroup);

      for (const box of [['punctuation', 'Punctuation'], ['numbers', 'Numbers']] as const) {
        const key = box[0] === 'punctuation' ? 'punctuation' : 'numbers';
        const input = el('input', { type: 'checkbox', id: box[0] }) as unknown as HTMLInputElement;
        input.checked = this.choices[key];
        input.addEventListener('keydown', (event) => this.onModeControlKeyDown(event));
        input.addEventListener('click', () => {
          if (this.choices[key] === input.checked) return;
          this.choices[key] = input.checked;
          this.saveChoices(this.choices);
          void this.requestTicket();
        });
        const label = el('label', { for: box[0], class: 'mode-label' }, box[1]);
        this.modeHost.append(input, label);
      }
    }
  }

  private onModeControlKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.app.state.settings.quickRestart === 'enter') {
      event.preventDefault();
      this.restart();
    }
  }

  private pickMode(mode: StoredChoices['mode'], fromRadio: boolean): void {
    if (mode === 'custom') {
      this.modeBeforeCustom = this.choices.mode;
      this.choices.mode = 'custom';
      this.saveChoices(this.choices);
      this.openCustomDialog(fromRadio);
      return;
    }
    this.choices.mode = mode;
    this.saveChoices(this.choices);
    this.buildModeControls();
    void this.requestTicket();
  }

  // Tickets.

  private ticketBody(): Record<string, unknown> {
    const mode = this.choices.mode;
    const punctuation = mode === 'time' || mode === 'words' ? this.choices.punctuation : false;
    const numbers = mode === 'time' || mode === 'words' ? this.choices.numbers : false;
    if (mode === 'time') return { mode, length: this.choices.timeLength, punctuation, numbers, text: null };
    if (mode === 'words') return { mode, length: this.choices.wordsLength, punctuation, numbers, text: null };
    if (mode === 'quote') return { mode, length: this.choices.quoteLength, punctuation: false, numbers: false, text: null };
    return { mode: 'custom', length: null, punctuation: false, numbers: false, text: this.customText };
  }

  private async requestTicket(): Promise<void> {
    const requestId = ++this.ticketRequest;
    this.cancelTimers();
    this.log = [];
    this.keystrokesAt = [];
    this.startTime = null;
    this.finished = false;
    this.resultAnnounced = false;
    this.ticket = null;
    this.wordsArea.setAttribute('aria-busy', 'true');
    this.ticketAlert.style.display = 'none';
    this.timerEl.textContent = this.choices.mode === 'time' ? String(this.choices.timeLength) : `0/${this.currentWordCount()}`;
    try {
      const body = this.ticketBody();
      if (body.mode === 'custom' && typeof body.text === 'string' && body.text.trim() === '') {
        // No remembered custom text yet: keep the sheet empty and busy.
        this.setSealNone();
        return;
      }
      const ticket = await api<TicketResponse>('/api/tickets', 'POST', body);
      if (requestId !== this.ticketRequest) return;
      this.ticket = ticket;
      this.layoutTicket();
      this.updateTimerText();
      if (this.ticketFocusPending) {
        this.typingInput.focus({ preventScroll: true });
      }
    } catch (error) {
      if (requestId !== this.ticketRequest) return;
      this.ticketAlert.textContent = COPY.ticketFailed;
      this.ticketAlert.style.display = 'block';
    }
  }

  private layoutTicket(): void {
    if (this.ticket === null) return;
    this.wordsArea.scrollTop = 0;
    this.sheet.querySelector('.words-wrap')?.removeAttribute('data-hidden');
    this.sheet.querySelector('.readouts')?.removeAttribute('data-hidden');
    this.wordsArea.setAttribute('aria-busy', 'false');
    this.state = initialEngineState(this.ticket.words);
    this.letterNodes = buildWordsArea(this.wordsArea, this.caret, this.ticket.words);
    this.certificateRegion?.remove();
    this.certificateRegion = null;
    this.wordsArea.style.removeProperty('--sheet-shift');
    this.quoteSourceEl.textContent = this.choices.mode === 'quote' ? quoteSourceOf(this.ticket.quoteId) : '';
    requestAnimationFrame(() => {
      this.relayout();
    });
    // Once the bundled fonts are ready the row heights settle; number the lines again.
    void document.fonts.ready.then(() => {
      if (this.ticket === null) return;
      this.relayout();
    });
  }

  private currentWordCount(): number {
    if (this.choices.mode === 'time') return this.choices.timeLength * 4;
    if (this.choices.mode === 'words') return this.choices.wordsLength;
    if (this.choices.mode === 'quote') return 0;
    return this.customText === '' ? 0 : this.customText.split(' ').length;
  }

  private relayout(): void {
    if (this.ticket === null) return;
    computeVisibleLines(this.letterNodes, this.wordsArea);
    this.renderState();
  }

  // Typing.

  private onKeyDown(event: KeyboardEvent): void {
    if (this.finished) return;
    if (event.key === 'Tab') {
      if (this.app.state.settings.quickRestart === 'tab') {
        // Let focus move to the Restart test button.
        return;
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (event.key === 'Backspace') {
        event.preventDefault();
        this.typeKey('CtrlBackspace');
      }
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      this.typeKey('Backspace');
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      this.typeKey(KEY_SPACE);
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      this.typeKey(event.key);
    }
  }

  /** On-screen keyboards: read the input data instead of key events. */
  private onInput(): void {
    const data = this.typingInput.value;
    this.typingInput.value = '';
    for (const character of data) {
      if (character === ' ') this.typeKey(KEY_SPACE);
      else this.typeKey(character);
    }
  }

  private typeKey(key: string): void {
    if (this.finished || this.ticket === null) return;
    if (!isLoggedKey(key)) return;
    if (this.startTime === null) {
      this.startTime = performance.now();
      if (this.choices.mode === 'time') this.startTime = performance.now();
    }
    const elapsed = this.startTime === null ? 0 : Math.round(performance.now() - this.startTime);
    const limit = this.choices.mode === 'time' ? this.choices.timeLength * 1000 : null;
    if (limit !== null && elapsed >= limit) return;
    const entry: LogEntry = { k: key, t: elapsed };
    const outcome = applyEntry(this.state, entry, { maxExtraLetters: this.app.state.config?.maxExtraLetters ?? 10, timeLimitMs: limit });
    if (limit !== null && outcome === null) return;
    this.log.push(entry);
    if (outcome === null) {
      this.renderState();
      return;
    }
    if (outcome.keystroke) {
      this.keystrokesAt.push({ t: entry.t, correct: outcome.correct });
    }
    if (this.startTime !== null && this.timers.tickInterval === null) {
      this.startClock();
    }
    if (outcome.ended) {
      this.finishByKeystroke(entry.t);
      return;
    }
    this.renderState();
  }

  private startClock(): void {
    if (this.choices.mode === 'time') {
      const limit = this.choices.timeLength * 1000;
      const startedAt = this.startTime ?? performance.now();
      const remaining = limit - (performance.now() - startedAt);
      this.timers.endTimeout = setTimeout(() => this.finishByClock(), Math.max(0, remaining));
    }
    this.timers.tickInterval = setInterval(() => this.tick(), 250);
    this.timers.tickInterval.unref?.();
  }

  private tick(): void {
    this.updateTimerText();
    this.updateLiveReadouts();
  }

  private updateTimerText(): void {
    if (this.ticket === null) {
      this.timerEl.textContent = '';
      return;
    }
    if (this.choices.mode === 'time') {
      const limit = this.choices.timeLength;
      if (this.startTime === null) {
        this.timerEl.textContent = String(limit);
        return;
      }
      const elapsed = performance.now() - this.startTime;
      const left = Math.max(0, limit * 1000 - elapsed);
      const secondsLeft = Math.ceil(left / 1000);
      this.timerEl.textContent = String(Math.min(this.choices.timeLength, secondsLeft));
    } else {
      this.timerEl.textContent = `${this.state.wordIndex}/${this.state.words.length}`;
    }
  }

  private updateLiveReadouts(): void {
    if (this.startTime === null) {
      this.liveSpeed.textContent = '0';
      this.liveAccuracy.textContent = '100%';
      return;
    }
    const elapsedMs = performance.now() - this.startTime;
    const second = Math.floor(elapsedMs / 1000);
    if (second === 0) {
      this.liveSpeed.textContent = '0';
      this.liveAccuracy.textContent = `${roundHalfUpInt(accuracyOf(this.keystrokesAt.filter((k) => k.correct).length, this.keystrokesAt.length))}%`;
      return;
    }
    const speed = this.liveSpeedAt(second);
    const correct = this.keystrokesAt.filter((k) => k.correct && k.t < second * 1000).length;
    const total = this.keystrokesAt.filter((k) => k.t < second * 1000).length;
    this.liveSpeed.textContent = String(roundHalfUpInt(speed));
    this.liveAccuracy.textContent = `${roundHalfUpInt(accuracyOf(correct, total))}%`;
  }

  /** The published per-second speed for the live readout. */
  private liveSpeedAt(second: number): number {
    if (this.ticket === null) return 0;
    const slice = this.log.filter((entry) => entry.t < second * 1000);
    const replay = replayLog(this.ticket.words, slice, { maxExtraLetters: this.app.state.config?.maxExtraLetters ?? 10, timeLimitMs: this.choices.mode === 'time' ? second * 1000 : null });
    return replay.figures.speed;
  }

  private renderState(): void {
    const blind = this.app.state.settings.blindMode;
    this.wordsArea.setAttribute('data-caret', this.app.state.settings.caret);
    this.wordsArea.setAttribute('data-smooth', this.app.state.settings.smoothCaret ? 'on' : 'off');
    renderWordStates(this.letterNodes, this.state, 0, blind, this.app.state.config?.maxExtraLetters ?? 10);
    // Mark the caret's word and letter so a block caret can recolour the letter beneath.
    for (let i = 0; i < this.letterNodes.length; i++) {
      const node = this.letterNodes[i];
      if (i === this.state.wordIndex) {
        node.word.setAttribute('data-current', '');
        const at = Math.min(this.state.words[i]?.typed.length ?? 0, node.letters.length - 1);
        node.letters.forEach((letter, index) => { if (index === at) letter.setAttribute('data-current', ''); else letter.removeAttribute('data-current'); });
      } else {
        node.word.removeAttribute('data-current');
        node.letters.forEach((letter) => letter.removeAttribute('data-current'));
      }
    }
    this.caret.setAttribute('data-word', String(this.state.wordIndex));
    this.caret.setAttribute('data-letter', String(this.state.words[this.state.wordIndex]?.typed.length ?? 0));
    this.caret.setAttribute('data-style', this.app.state.settings.caret);
    this.caret.style.visibility = this.app.state.settings.caret === 'off' ? 'hidden' : 'visible';
    this.positionCaret();
    if (this.choices.mode !== 'time') this.updateTimerText();
  }

  private positionCaret(): void {
    const node = this.letterNodes[this.state.wordIndex];
    if (node === undefined) return;
    const line = Number(node.word.getAttribute('data-line') ?? '1');
    const areaTop = this.wordsArea.getBoundingClientRect().top;
    const rect = node.word.getBoundingClientRect();
    const letterIndex = Math.min(this.state.words[this.state.wordIndex]?.typed.length ?? 0, node.letters.length);
    const letterRect = node.letters[letterIndex]?.getBoundingClientRect() ?? rect;
    const targetTop = letterRect.top - areaTop + this.wordsArea.scrollTop;
    const targetLeft = letterRect.left - rect.left;
    this.caret.style.top = `${Math.max(0, targetTop)}px`;
    this.caret.style.left = `${node.word.offsetLeft + targetLeft}px`;
    if (line === 3) {
      // Move the text up one line before the next frame, then number the
      // visible lines 1 to 3 again. Only the current ticket's frame may do it.
      const ticketId = this.ticket?.ticketId;
      this.wordsArea.scrollTop += lineHeightOf(this.wordsArea);
      requestAnimationFrame(() => {
        if (this.ticket?.ticketId !== ticketId) return;
        this.relayout();
      });
    }
  }

  // Test end.

  private finishByKeystroke(durationMs: number): void {
    this.finish(durationMs);
  }

  private finishByClock(): void {
    if (this.finished) return;
    const limit = this.choices.timeLength * 1000;
    endByClock(this.state, limit);
    this.finish(limit);
  }

  private finish(durationMs: number): void {
    if (this.finished || this.ticket === null) return;
    this.finished = true;
    this.cancelTimers();
    this.clearFocusWarning();
    const sheetBody = this.sheet.querySelector('.words-wrap');
    (sheetBody as HTMLElement | null)?.setAttribute('data-hidden', 'true');
    const readouts = this.sheet.querySelector('.readouts');
    (readouts as HTMLElement | null)?.setAttribute('data-hidden', 'true');
    const words = this.ticket.words;
    const characters = countCharactersOf(this.state);
    const correctWordCharacters = this.correctWordCharacters();
    const keystrokes = this.keystrokesAt.length;
    const correctKeystrokes = this.keystrokesAt.filter((k) => k.correct).length;
    const { speed, raw } = wpm(correctWordCharacters, keystrokes, durationMs);
    const accuracy = accuracyOf(correctKeystrokes, keystrokes);
    const raws = perSecondRaws(this.keystrokesAt, durationMs);
    const consistency = consistencyFrom(raws);
    const speeds = perSecondSpeeds(speed, words, this.log, { maxExtraLetters: this.app.state.config?.maxExtraLetters ?? 10, timeLimitMs: this.choices.mode === 'time' ? this.choices.timeLength * 1000 : null }, durationMs);
    const seconds = Math.max(1, Math.ceil(durationMs / 1000));
    const perSecond = [];
    for (let k = 1; k <= seconds; k++) {
      const from = (k - 1) * 1000;
      const to = Math.min(k * 1000, durationMs);
      const count = this.keystrokesAt.filter((ks) => ks.t >= from && (ks.t < to || (k === seconds && ks.t === durationMs))).length;
      const errors = this.keystrokesAt.filter((ks) => !ks.correct && ks.t >= from && (ks.t < to || (k === seconds && ks.t === durationMs))).length;
      perSecond.push({ second: k, speed: speeds[k - 1] ?? speed, raw: to > from ? (count * 12000) / (to - from) : 0, errors });
    }
    const errorsByKey: Record<string, number> = {};
    for (const entry of this.log) {
      const replay = replayLog(words, this.log.slice(0, this.log.indexOf(entry) + 1), { maxExtraLetters: 10, timeLimitMs: null });
      void replay;
      void entry;
      break;
    }
    const figures = { speed, raw, accuracy, consistency };
    const result = { figures, characters, durationMs, perSecond, errorsByKey: this.errorsByKey(), words: this.state.words.map((w) => ({ word: w.word, typed: w.typed, missed: w.missed })) };
    this.showCertificate(result);
    this.announceResult(result);
    this.submit(result);
  }

  private errorsByKey(): Record<string, number> {
    if (this.ticket === null) return {};
    const opts = { maxExtraLetters: this.app.state.config?.maxExtraLetters ?? 10, timeLimitMs: this.choices.mode === 'time' ? this.choices.timeLength * 1000 : null };
    const replay = replayLog(this.ticket.words, this.log, opts);
    return replay.score.errorsByKey;
  }

  private correctWordCharacters(): number {
    if (this.ticket === null) return 0;
    const opts = { maxExtraLetters: this.app.state.config?.maxExtraLetters ?? 10, timeLimitMs: this.choices.mode === 'time' ? this.choices.timeLength * 1000 : null };
    const replay = replayLog(this.ticket.words, this.log, opts);
    return replay.score.correctWordCharacters;
  }

  private announceResult(result: { figures: { speed: number; raw: number; accuracy: number; consistency: number } }): void {
    if (this.resultAnnounced) return;
    this.resultAnnounced = true;
    announce(this.resultStatus, `Speed ${roundHalfUp(result.figures.speed).toFixed(2)}, accuracy ${roundHalfUp(result.figures.accuracy).toFixed(2)}%, raw ${roundHalfUp(result.figures.raw).toFixed(2)}, consistency ${roundHalfUp(result.figures.consistency).toFixed(2)}%.`);
  }

  private showCertificate(result: { figures: { speed: number; raw: number; accuracy: number; consistency: number }; characters: { correct: number; incorrect: number; extra: number; missed: number }; durationMs: number; perSecond: { second: number; speed: number; raw: number; errors: number }[]; errorsByKey: Record<string, number> }): void {
    const region = el('section', { class: 'certificate-region', role: 'region', 'aria-label': 'Certificate' }, '');
    const card = el('div', { class: 'certificate-card' }, '');
    const speedEl = el('div', { class: 'certificate-speed', id: 'result-speed' }, roundHalfUp(result.figures.speed).toFixed(2));
    const speedLabel = el('div', { class: 'certificate-speed-label' }, 'wpm');
    const figuresColumn = el('div', { class: 'figures-column' }, '');
    figuresColumn.append(
      figureRow('Raw speed', 'result-raw', roundHalfUp(result.figures.raw).toFixed(2)),
      figureRow('Accuracy', 'result-accuracy', `${roundHalfUp(result.figures.accuracy).toFixed(2)}%`),
      figureRow('Consistency', 'result-consistency', `${roundHalfUp(result.figures.consistency).toFixed(2)}%`),
      figureRow('Characters', 'result-characters', `${result.characters.correct}/${result.characters.incorrect}/${result.characters.extra}/${result.characters.missed}`),
      figureRow('Duration', 'result-duration', `${roundHalfUp(result.durationMs / 1000).toFixed(2)} s`),
    );
    const keyboard = el('div', { class: 'error-keyboard' }, '');
    const rows = errorsByKeyRows(result.errorsByKey);
    for (const row of rows) {
      const key = el('span', { class: 'keyboard-key' }, row.key);
      key.setAttribute('data-count', String(row.errors));
      keyboard.appendChild(key);
    }
    if (rows.length === 0) keyboard.appendChild(el('span', { class: 'no-errors-inline' }, COPY.noErrors));
    const stub = el('div', { class: 'certificate-stub' }, '');
    const sealHolder = el('div', { class: 'stub-holder' }, '');
    sealHolder.append(this.sealStatus);
    const proof = el('div', { class: 'proof-key', id: 'proof-key' }, '');
    sealHolder.appendChild(proof);
    stub.appendChild(sealHolder);
    const nextButton = el('button', { type: 'button', class: 'button next-button' }, COPY.nextTest);
    nextButton.addEventListener('click', () => this.restart());
    stub.appendChild(nextButton);
    card.append(speedEl, speedLabel, figuresColumn, keyboard, stub);

    const carbonPanel = el('div', { class: 'carbon-panel' }, '');
    const carbon = el('div', { id: 'carbon', class: 'words-area carbon' }, '');
    const carbonCaret = el('div', { id: 'carbon-caret', class: 'caret', 'data-word': '0', 'data-letter': '0', 'data-style': 'line' }, '');
    const nodes = buildCarbon(carbon, carbonCaret, this.ticket?.words ?? []);
    renderWordStates(nodes, this.state, 0, false, this.app.state.config?.maxExtraLetters ?? 10);
    const seconds = Math.max(1, Math.ceil(result.durationMs / 1000));
    const { chart, points } = buildChart(result.perSecond, Math.max(...result.perSecond.map((p) => p.speed), 10));
    const numeral = el('div', { class: 'replay-numeral' }, '');
    const numeralValue = el('span', { id: 'replay-speed', class: 'replay-speed' }, roundHalfUp(result.perSecond[seconds - 1]?.speed ?? 0).toFixed(2));
    numeral.append(el('span', { class: 'replay-label' }, 'Speed'), numeralValue);
    const slider = el('input', { type: 'range', class: 'replay-slider', 'aria-label': 'Replay position', min: '0', max: String(seconds), value: String(seconds), step: '1' }) as unknown as HTMLInputElement;
    const tableWrap = el('div', { class: 'certificate-tables' }, '');
    const speedTable = speedOverTimeTable(result.perSecond);
    const errorsTable = errorsByKeyTable(errorsByKeyRows(result.errorsByKey), COPY.noErrors);
    tableWrap.append(speedTable, errorsTable);
    carbonPanel.append(carbon, numeral, chart, slider, tableWrap);
    region.append(card, carbonPanel);

    this.sheet.insertBefore(region, beginRowRef(this.sheet));
    this.certificateRegion = region;
    this.attachReplay(region, nodes, carbonCaret, slider, numeralValue, points, speedTable, result);
    if (!reducedMotion()) {
      region.classList.add('rise');
      setTimeout(() => region.classList.remove('rise'), 500);
    }
  }

  private attachReplay(
    region: HTMLElement,
    nodes: CarbonNode[],
    carbonCaret: HTMLElement,
    slider: HTMLInputElement,
    numeral: HTMLElement,
    points: HTMLElement[],
    speedTable: HTMLTableElement,
    result: { durationMs: number; perSecond: { second: number; speed: number; raw: number; errors: number }[] },
  ): void {
    const words = this.ticket?.words ?? [];
    const seconds = Math.ceil(result.durationMs / 1000);
    const opts = { maxExtraLetters: this.app.state.config?.maxExtraLetters ?? 10, timeLimitMs: this.choices.mode === 'time' ? this.choices.timeLength * 1000 : null };
    const render = (position: number): void => {
      const slice = this.log.filter((entry) => entry.t < position * 1000);
      const state = initialEngineState(words);
      for (const entry of slice) {
        const outcome = applyEntry(state, entry, opts);
        if (outcome === null) continue;
        if (outcome.ended) break;
      }
      renderWordStates(nodes, state, 0, false, this.app.state.config?.maxExtraLetters ?? 10);
      carbonCaret.setAttribute('data-word', String(state.wordIndex));
      carbonCaret.setAttribute('data-letter', String(state.words[state.wordIndex]?.typed.length ?? 0));
      numeral.textContent = roundHalfUp(position === 0 ? 0 : result.perSecond[position - 1]?.speed ?? 0).toFixed(2);
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
    const setSlider = (value: number, moveAddress: boolean): void => {
      const clamped = Math.max(0, Math.min(seconds, Math.trunc(value)));
      slider.value = String(clamped);
      slider.setAttribute('aria-valuenow', String(clamped));
      slider.setAttribute('aria-valuetext', `${clamped} seconds, speed ${roundHalfUp(clamped === 0 ? 0 : result.perSecond[clamped - 1]?.speed ?? 0).toFixed(2)}`);
      render(clamped);
      void moveAddress;
      void region;
      void points;
    };
    setSlider(seconds, false);
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
    // Touch dragging snaps to whole seconds and never scrolls the page.
    slider.addEventListener('touchstart', (event) => { event.preventDefault(); }, { passive: false });
    slider.addEventListener('touchmove', (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      const rect = slider.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      setSlider(Math.round(ratio * seconds), true);
    }, { passive: false });
  }

  // Submissions and the seal.

  private async submit(result: { figures: { speed: number; raw: number; accuracy: number; consistency: number }; characters: { correct: number; incorrect: number; extra: number; missed: number }; durationMs: number }): Promise<void> {
    if (this.ticket === null) return;
    if (this.app.state.session === null) {
      this.setSeal('not_filed_sign_in', COPY.notFiledSignIn);
      return;
    }
    if (!this.app.state.session.verified) {
      this.setSeal('not_filed_verify', COPY.notFiledUnverified);
      return;
    }
    const submission: RunSubmission = {
      ticketId: this.ticket.ticketId,
      text: this.ticket.words,
      log: this.log,
      duration: this.choices.mode === 'time' ? this.choices.timeLength * 1000 : result.durationMs,
      speed: roundHalfUp(result.figures.speed),
      raw: roundHalfUp(result.figures.raw),
      accuracy: roundHalfUp(result.figures.accuracy),
      consistency: roundHalfUp(result.figures.consistency),
      characters: result.characters,
    };
    this.setSeal('held', COPY.heldSeal);
    const ticketId = this.ticket.ticketId;
    const send = async (): Promise<boolean> => {
      try {
        const response = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(submission),
        });
        const text = await response.text();
        let json: Record<string, unknown> = {};
        if (text !== '') { try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = {}; } }
        if (response.status >= 500) return false;
        if (typeof json.proofKey === 'string' && json.proofKey !== '') {
          const proofEl = document.getElementById('proof-key');
          if (proofEl !== null) proofEl.textContent = `Proof ${json.proofKey.slice(0, 16)}`;
        }
        if (response.status === 201) {
          const isBest = json.personalBest === true;
          const parts: string[] = [COPY.countedSeal];
          if (isBest) parts.push(COPY.newPersonalBest);
          this.setSeal('counted', parts.join('\n'));
          return true;
        }
        if (response.status === 401) {
          this.setSeal('not_filed_sign_in', COPY.notFiledSignIn);
          return true;
        }
        if (response.status === 403) {
          this.setSeal('not_filed_verify', COPY.notFiledUnverified);
          return true;
        }
        const code = typeof json.error === 'string' ? json.error : 'unknown';
        const reason = NOT_COUNTED_REASONS[code] ?? COPY.serverError;
        this.setSeal('not_counted', `Not counted: ${reason}`);
        return true;
      } catch {
        return false;
      }
    };
    const attempt = async (): Promise<void> => {
      const done = await send();
      if (done) return;
      if (this.ticket?.ticketId !== ticketId) return;
      this.timers.resendTimer = setTimeout(() => { void attempt(); }, 5000);
    };
    await attempt();
  }

  private setSealNone(): void {
    this.sealStatus.textContent = '';
    this.sealState = 'none';
    this.sealAnnounced = '';
  }

  private setSeal(state: TestSheet['sealState'], message: string): void {
    if (this.sealState === state && this.sealAnnounced === message) return;
    this.sealState = state;
    announce(this.sealStatus, message);
    this.sealAnnounced = message;
    if (!reducedMotion()) {
      this.sealStatus.classList.add('stamp');
      setTimeout(() => this.sealStatus.classList.remove('stamp'), 260);
    }
  }

  // Restart and abandon.

  restart(): void {
    this.cancelTimers();
    this.resultStatus.textContent = '';
    this.setSealNone();
    this.certificateRegion?.remove();
    this.certificateRegion = null;
    void this.requestTicket().then(() => {
      this.typingInput.focus({ preventScroll: true });
    });
  }

  private cancelTimers(): void {
    if (this.timers.endTimeout !== null) { clearTimeout(this.timers.endTimeout); this.timers.endTimeout = null; }
    if (this.timers.tickInterval !== null) { clearInterval(this.timers.tickInterval); this.timers.tickInterval = null; }
    if (this.timers.focusTimer !== null) { clearTimeout(this.timers.focusTimer); this.timers.focusTimer = null; }
    if (this.timers.resendTimer !== null) { clearTimeout(this.timers.resendTimer); this.timers.resendTimer = null; }
  }

  abandon(): void {
    this.cancelTimers();
  }

  refocus(): void {
    this.typingInput.focus({ preventScroll: true });
    this.clearFocusWarning();
  }

  // Focus warning.

  private scheduleFocusWarning(): void {
    if (this.finished) return;
    const delay = this.app.state.config?.focusWarningMs ?? 1000;
    if (this.timers.focusTimer !== null) clearTimeout(this.timers.focusTimer);
    this.timers.focusTimer = setTimeout(() => {
      if (this.finished) return;
      if (document.activeElement === this.typingInput) return;
      this.focusWarningShown = true;
      this.wordsArea.setAttribute('data-blurred', 'true');
      this.focusLayer.style.display = 'flex';
    }, delay);
  }

  private clearFocusWarning(): void {
    if (this.timers.focusTimer !== null) { clearTimeout(this.timers.focusTimer); this.timers.focusTimer = null; }
    this.focusWarningShown = false;
    this.wordsArea.removeAttribute('data-blurred');
    this.focusLayer.style.display = 'none';
  }

  // Caps Lock: toggled by the Caps Lock key, shown from other keys' modifier state.

  private onCapsKeyDown(event: KeyboardEvent): void {
    if (event.key === 'CapsLock') {
      this.capsLockOn = !this.capsLockOn;
    } else if (event.getModifierState !== undefined) {
      this.capsLockOn = event.getModifierState('CapsLock');
    }
    this.renderCapsLock();
  }

  private renderCapsLock(): void {
    this.capsStatus.textContent = this.capsLockOn ? COPY.capsLockOn : '';
  }

  // Global keys: Escape opens the command line, quick restart by Enter.

  private onWindowKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const inDialog = target !== null && target.closest('dialog[open]') !== null;
    if (event.key === 'Escape' && (this.commandOpen || this.customOpen)) return;
    if (event.key === 'Escape' && !inDialog) {
      event.preventDefault();
      this.openCommandLine();
      return;
    }
    if (this.app.state.settings.quickRestart === 'enter' && event.key === 'Enter' && !inDialog) {
      if (target === null) return;
      if (target.tagName === 'A') return;
      if (target.tagName === 'BUTTON' && !target.isSameNode(this.restartButton) && !(target as HTMLButtonElement).classList.contains('restart-button')) {
        // Enter on another button activates that button.
        return;
      }
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'radio') {
        event.preventDefault();
        this.restart();
        return;
      }
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
        event.preventDefault();
        this.restart();
        return;
      }
      if (target.tagName === 'BUTTON') {
        event.preventDefault();
        this.restart();
        return;
      }
      if (target === document.body || (target as HTMLElement).isContentEditable === false) {
        event.preventDefault();
        this.restart();
      }
    }
  }

  private onBodyKeyDown(event: KeyboardEvent): void {
    if (this.finished) return;
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!this.focusWarningShown) return;
    const active = document.activeElement;
    if (active !== null && active.closest('dialog[open]') !== null) return;
    event.preventDefault();
    this.refocus();
  }

  // Dialogs are provided by dialogs.ts and wired in the page module.

  openCustomDialog(fromRadio: boolean): void {
    this.customOpen = true;
    this.customFromRadio = fromRadio;
    const dialog = this.ensureCustomDialog();
    (dialog.querySelector('textarea') as HTMLTextAreaElement).value = this.customText;
    this.updateCustomCount();
    dialog.showModal();
    (dialog.querySelector('textarea') as HTMLTextAreaElement).focus();
  }

  private ensureCustomDialog(): HTMLDialogElement {
    if (this.customDialog !== undefined) return this.customDialog;
    const dialog = buildCustomDialog(this);
    document.body.appendChild(dialog);
    this.customDialog = dialog;
    return dialog;
  }

  updateCustomCount(): void {
    const dialog = this.customDialog;
    if (dialog === undefined) return;
    const textarea = dialog.querySelector('textarea') as HTMLTextAreaElement;
    const count = dialog.querySelector('#custom-count') as HTMLElement;
    const useText = dialog.querySelector('button.use-text') as HTMLButtonElement;
    const normalized = normalizeCustom(textarea.value);
    const characters = countCodePoints(normalized);
    const words = normalized === '' ? 0 : normalized.split(' ').length;
    const over = characters > 2000 || words > 400;
    if (over) {
      count.textContent = COPY.customTextLimit;
      useText.disabled = true;
    } else {
      count.textContent = `${characters} of 2000 characters, ${words} of 400 words`;
      useText.disabled = false;
    }
  }

  applyCustomText(fromCommand: boolean): void {
    const dialog = this.ensureCustomDialog();
    const textarea = dialog.querySelector('textarea') as HTMLTextAreaElement;
    this.customText = normalizeCustom(textarea.value);
    this.saveCustomText(this.customText);
    dialog.close();
    this.customOpen = false;
    this.choices.mode = 'custom';
    this.saveChoices(this.choices);
    this.buildModeControls();
    void this.requestTicket();
    if (this.customFromRadio) {
      const radio = this.modeHost.querySelector('input[value="custom"]') as HTMLInputElement | null;
      radio?.focus();
    } else if (fromCommand) {
      this.typingInput.focus({ preventScroll: true });
    }
  }

  cancelCustomText(): void {
    const dialog = this.ensureCustomDialog();
    dialog.close();
    this.customOpen = false;
    if (this.customText !== '') {
      this.choices.mode = 'custom';
      this.saveChoices(this.choices);
      this.buildModeControls();
      void this.requestTicket();
    } else {
      this.choices.mode = this.modeBeforeCustom;
      this.saveChoices(this.choices);
      this.buildModeControls();
      void this.requestTicket();
    }
    if (this.customFromRadio) {
      const radio = this.modeHost.querySelector(`input[value="${this.choices.mode}"]`) as HTMLInputElement | null;
      radio?.focus();
    } else {
      this.typingInput.focus({ preventScroll: true });
    }
  }

  private saveCustomText(text: string): void {
    try { localStorage.setItem('strikeproof-custom-text', text); } catch { // Private mode: keep it in memory.
    }
  }

  openCommandLine(): void {
    if (this.commandOpen || this.customOpen) return;
    this.commandOpen = true;
    const dialog = this.ensureCommandDialog();
    const input = dialog.querySelector('input') as HTMLInputElement;
    input.value = '';
    this.commandFilter = '';
    this.renderCommandOptions();
    dialog.showModal();
    input.focus();
    if (!this.finished) this.abandon();
  }

  private ensureCommandDialog(): HTMLDialogElement {
    if (this.commandDialog !== undefined) return this.commandDialog;
    const dialog = buildCommandDialog(this);
    document.body.appendChild(dialog);
    this.commandDialog = dialog;
    return dialog;
  }

  private renderCommandOptions(): void {
    const dialog = this.commandDialog;
    if (dialog === undefined) return;
    const list = dialog.querySelector('[role="listbox"]') as HTMLElement;
    list.textContent = '';
    const input = dialog.querySelector('input') as HTMLInputElement;
    const parts = input.value.trim().toLowerCase().split(/\s+/).filter((p) => p !== '');
    const matches = COPY_COMMANDS.filter((label) => parts.every((part) => label.toLowerCase().includes(part)));
    this.commandMatches = matches;
    if (this.commandActive >= matches.length) this.commandActive = 0;
    matches.forEach((label, index) => {
      const option = el('div', { class: 'command-option', role: 'option', 'aria-selected': index === 0 ? 'true' : 'false', id: `command-option-${index}` }, label);
      if (index === this.commandActive) {
        option.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', option.id);
      } else {
        option.setAttribute('aria-selected', 'false');
      }
      option.addEventListener('click', () => {
        this.applyCommand(label);
      });
      list.appendChild(option);
    });
  }

  private commandMatches: string[] = [];

  renderCommandOptionsPublic(): void {
    this.commandActive = 0;
    this.renderCommandOptions();
  }

  moveCommandActive(delta: number): void {
    if (this.commandMatches.length === 0) return;
    this.commandActive = (this.commandActive + delta + this.commandMatches.length) % this.commandMatches.length;
    const dialog = this.commandDialog;
    if (dialog === undefined) return;
    const input = dialog.querySelector('input') as HTMLInputElement;
    const options = Array.from(dialog.querySelectorAll('.command-option'));
    options.forEach((option, index) => {
      const active = index === this.commandActive;
      option.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  applyActiveCommand(): void {
    const label = this.commandMatches[this.commandActive];
    if (label === undefined) return;
    this.applyCommand(label);
  }

  applyCommand(label: string): void {
    this.commandDialog?.close();
    this.commandOpen = false;
    announce(this.settingsStatus, `${label} applied.`);
    const [group, value] = label.split(': ');
    const settings = this.app.state.settings;
    switch (group) {
      case 'Mode':
        if (value === 'custom') {
          this.openCustomDialog(false);
          return;
        }
        this.pickMode(value as StoredChoices['mode'], false);
        if (value !== 'custom') this.typingInput.focus({ preventScroll: true });
        return;
      case 'Time':
        this.choices.mode = 'time';
        this.choices.timeLength = Number(value);
        this.saveChoices(this.choices);
        this.buildModeControls();
        void this.requestTicket();
        this.typingInput.focus({ preventScroll: true });
        return;
      case 'Words':
        this.choices.mode = 'words';
        this.choices.wordsLength = Number(value);
        this.saveChoices(this.choices);
        this.buildModeControls();
        void this.requestTicket();
        this.typingInput.focus({ preventScroll: true });
        return;
      case 'Quote length':
        this.choices.mode = 'quote';
        this.choices.quoteLength = value as StoredChoices['quoteLength'];
        this.saveChoices(this.choices);
        this.buildModeControls();
        void this.requestTicket();
        this.typingInput.focus({ preventScroll: true });
        return;
      case 'Punctuation':
        if (this.choices.mode === 'quote' || this.choices.mode === 'custom') this.choices.mode = 'time';
        this.choices.punctuation = value === 'on';
        this.saveChoices(this.choices);
        this.buildModeControls();
        void this.requestTicket();
        this.typingInput.focus({ preventScroll: true });
        return;
      case 'Numbers':
        if (this.choices.mode === 'quote' || this.choices.mode === 'custom') this.choices.mode = 'time';
        this.choices.numbers = value === 'on';
        this.saveChoices(this.choices);
        this.buildModeControls();
        void this.requestTicket();
        this.typingInput.focus({ preventScroll: true });
        return;
      case 'Theme':
        this.app.updateSettings({ theme: value as typeof settings.theme });
        return;
      case 'Caret':
        this.app.updateSettings({ caret: value as typeof settings.caret });
        return;
      case 'Smooth caret':
        this.app.updateSettings({ smoothCaret: value === 'on' });
        return;
      case 'Font size':
        this.app.updateSettings({ fontSize: Number(value) });
        return;
      case 'Blind mode':
        this.app.updateSettings({ blindMode: value === 'on' });
        return;
      case 'Quick restart':
        this.app.updateSettings({ quickRestart: value as typeof settings.quickRestart });
        return;
      default:
        return;
    }
  }

  closeCommandLine(): void {
    const dialog = this.commandDialog;
    if (dialog === undefined) return;
    if (!dialog.open) {
      this.commandOpen = false;
      void this.requestTicket();
      this.typingInput.focus({ preventScroll: true });
      return;
    }
    dialog.close();
    this.commandOpen = false;
    void this.requestTicket();
    this.typingInput.focus({ preventScroll: true });
  }

  /** Rebuild the sheet's settings-driven parts after a settings change. */
  settingsChanged(): void {
    this.renderState();
  }
}

function countCodePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

function normalizeCustom(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function beginRowRef(sheet: HTMLElement): HTMLElement {
  const begin = sheet.querySelector('.begin-row');
  if (begin !== null) return begin as HTMLElement;
  return sheet;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function quoteSourceOf(quoteId: string | null): string {
  if (quoteId === null) return '';
  const quotes: Record<string, string> = {
    q1: 'William Shakespeare, Hamlet (1603)',
    q2: 'Mary Shelley, Frankenstein (1818)',
    q3: 'Jane Austen, Pride and Prejudice (1813)',
    q4: 'Henry David Thoreau, Walden (1854)',
    q5: 'Charles Dickens, A Tale of Two Cities (1859)',
    q6: "Lewis Carroll, Alice's Adventures in Wonderland (1865)",
  };
  return quotes[quoteId] ?? '';
}

function perSecondRaws(keystrokesAt: { t: number; correct: boolean }[], durationMs: number): number[] {
  const seconds = Math.ceil(durationMs / 1000);
  const raws: number[] = [];
  for (let k = 1; k <= seconds; k++) {
    const from = (k - 1) * 1000;
    const to = Math.min(k * 1000, durationMs);
    const count = keystrokesAt.filter((ks) => ks.t >= from && (ks.t < to || (k === seconds && ks.t === durationMs))).length;
    raws.push(to > from ? (count * 12000) / (to - from) : 0);
  }
  return raws;
}

function countCharactersOf(state: EngineState): { correct: number; incorrect: number; extra: number; missed: number } {
  let correct = 0;
  let incorrect = 0;
  let extra = 0;
  let missed = 0;
  for (const word of state.words) {
    for (let i = 0; i < word.typed.length; i++) {
      if (i < word.word.length) (word.word[i] === word.typed[i] ? correct++ : incorrect++);
      else extra++;
    }
    missed += word.missed;
  }
  return { correct, incorrect, extra, missed };
}

const COPY_COMMANDS: readonly string[] = [
  'Mode: time', 'Mode: words', 'Mode: quote', 'Mode: custom',
  'Time: 15', 'Time: 30', 'Time: 60', 'Time: 120',
  'Words: 10', 'Words: 25', 'Words: 50', 'Words: 100',
  'Quote length: short', 'Quote length: medium', 'Quote length: long', 'Quote length: all',
  'Punctuation: on', 'Punctuation: off', 'Numbers: on', 'Numbers: off',
  'Theme: sand', 'Theme: cobalt', 'Theme: carbon', 'Theme: ledger',
  'Caret: line', 'Caret: block', 'Caret: underline', 'Caret: off',
  'Smooth caret: on', 'Smooth caret: off',
  'Font size: 1', 'Font size: 1.5', 'Font size: 2', 'Font size: 3',
  'Blind mode: on', 'Blind mode: off',
  'Quick restart: tab', 'Quick restart: enter',
];

function buildCustomDialog(sheet: TestSheet): HTMLDialogElement {
  const dialog = el('dialog', { class: 'dialog', 'aria-label': COPY.customText }, '') as unknown as HTMLDialogElement;
  const form = el('form', { method: 'dialog', class: 'dialog-form' }, '');
  const textarea = el('textarea', { class: 'custom-textarea', 'aria-label': 'Custom text', rows: '6' }, '') as unknown as HTMLTextAreaElement;
  const count = el('div', { id: 'custom-count', class: 'custom-count' }, '');
  const useText = el('button', { type: 'submit', class: 'button use-text' }, COPY.useText);
  form.append(textarea, count, useText);
  dialog.appendChild(form);
  textarea.addEventListener('input', () => sheet.updateCustomCount());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!(useText as HTMLButtonElement).disabled) sheet.applyCustomText(false);
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    sheet.cancelCustomText();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      sheet.cancelCustomText();
    }
    if (event.key === 'Enter' && !(useText as HTMLButtonElement).disabled) {
      event.preventDefault();
      sheet.applyCustomText(false);
    }
    if (event.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('textarea, button'));
      trapTab(event, focusables);
    }
  });
  return dialog;
}

function buildCommandDialog(sheet: TestSheet): HTMLDialogElement {
  const dialog = el('dialog', { class: 'dialog', 'aria-label': COPY.commandLine }, '') as unknown as HTMLDialogElement;
  const input = el('input', { type: 'text', class: 'command-input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'commands-listbox', 'aria-autocomplete': 'list', 'aria-label': 'Command', autocomplete: 'off' }, '') as unknown as HTMLInputElement;
  const list = el('div', { id: 'commands-listbox', class: 'command-list', role: 'listbox', 'aria-label': 'Commands' }, '');
  const form = el('form', { method: 'dialog', class: 'dialog-form' }, '');
  form.append(input, list);
  dialog.appendChild(form);
  input.addEventListener('input', () => {
    sheet.renderCommandOptionsPublic();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); sheet.moveCommandActive(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); sheet.moveCommandActive(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); sheet.applyActiveCommand(); }
    else if (event.key === 'Escape') { event.preventDefault(); sheet.closeCommandLine(); }
    else if (event.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('input'));
      trapTab(event, focusables);
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    sheet.closeCommandLine();
  });
  return dialog;
}

function trapTab(event: KeyboardEvent, focusables: HTMLElement[]): void {
  if (event.shiftKey) {
    const first = focusables[0];
    if (document.activeElement === first && focusables.length > 0) {
      event.preventDefault();
      focusables[focusables.length - 1].focus();
    }
  } else {
    const last = focusables[focusables.length - 1];
    if (document.activeElement === last && focusables.length > 0) {
      event.preventDefault();
      focusables[0].focus();
    }
  }
}

export { COPY_COMMANDS, buildCustomDialog, buildCommandDialog, reducedMotion };
