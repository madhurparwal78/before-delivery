import { api, type RunVerdict, type TicketResponse } from '../api.js';
import { COPY, notCountedSeal, proofStub, resultLine, settingsApplied, whole } from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';
import {
  applyTheme,
  saveChoice,
  saveSettings,
  state,
  type CaretStyle,
  type QuickRestart,
  type TestModeName,
  type Theme,
} from '../state.js';
import { renderCertificate, type CertificateHandle } from '../certificate.js';
import { QUOTES } from '../../shared/quotes.js';
import {
  isPrintedKey,
  kindOfMode,
  type EngineFigures,
  type TestMode,
} from '../../shared/engine.js';
import { WordsView } from './words-view.js';
import { TestSession } from './session.js';
import { dialogOpen, openCommandLine, openCustomText, type CommandSpec } from './dialogs.js';
import { rememberCustomText, rememberedCustomText } from './custom-text.js';
import { radioGroup, type RadioGroupHandle } from '../controls.js';

const TIME_LENGTHS = [15, 30, 60, 120];
const WORD_LENGTHS = [10, 25, 50, 100];
const QUOTE_LENGTHS = ['short', 'medium', 'long', 'all'];

export class TestPage implements Page {
  private readonly view = new WordsView(() => this.focusInput());
  private session: TestSession | null = null;
  private ticketRequest = 0;
  private certificate: CertificateHandle | null = null;
  private mode: TestModeName = state.choice.mode;
  private modeBeforeCustom: TestModeName = state.choice.mode === 'custom' ? 'time' : state.choice.mode;
  private readonly timerEl = el('span', { id: 'timer', class: 'readout-value' }, ['15']);
  private readonly liveSpeedEl = el('span', { id: 'live-speed', class: 'readout-value' }, ['0']);
  private readonly liveAccuracyEl = el('span', {
    id: 'live-accuracy',
    class: 'readout-value',
  }, ['100%']);
  private readonly quoteSourceEl = el('p', { id: 'quote-source', class: 'quote-source' });
  private readonly typingInput = el('input', {
    type: 'text',
    class: 'typing-input',
    'aria-label': 'Typing input',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  private readonly restartButton = el('button', { type: 'button', class: 'button' }, [
    'Restart test',
  ]) as HTMLButtonElement;
  private readonly capsRegion = el('div', {
    role: 'status',
    'aria-label': 'Caps Lock',
    class: 'caps-region',
  });
  private readonly settingsRegion = el('div', {
    role: 'status',
    'aria-label': 'Settings updates',
    class: 'visually-hidden',
  });
  private readonly resultRegion = el('div', {
    role: 'status',
    'aria-label': 'Test result',
    class: 'visually-hidden',
  });
  private readonly alertBox = el('div', { class: 'alert-slot' });
  private readonly controlRow = el('div', { class: 'mode-row' });
  private readonly sheetArea = el('div', { class: 'sheet-area' });
  private modeGroup: RadioGroupHandle | null = null;
  private focusWarningShown = false;
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);
  private readonly onResize = (): void => this.handleResize();

  render(container: HTMLElement): void {
    container.textContent = '';
    const hero = el('section', { class: 'hero' }, [
      el('h1', { class: 'headline' }, [COPY.headline]),
      el('p', { class: 'subhead' }, [COPY.subhead]),
    ]);
    const stack = el('div', { class: 'folder-stack' });
    for (const tone of ['a', 'b', 'c', 'd']) {
      stack.append(el('div', { class: `folder-back tone-${tone}` }));
    }
    const folder = el('div', { class: 'folder open' }, [this.controlRow, this.sheetArea]);
    stack.append(folder);
    container.append(hero, stack);

    this.renderControls();
    this.showSheet();
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
    this.view.holder.addEventListener('click', () => this.focusInput());
    this.typingInput.addEventListener('blur', () => this.handleBlur());
    this.typingInput.addEventListener('focus', () => this.handleFocus());
    this.typingInput.addEventListener('beforeinput', (event) => this.handleBeforeInput(event));
    void this.requestTicket({ moveFocus: true });
  }

  dispose(): void {
    this.disposeSession();
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
  }

  /** The one place every timer and request of the running test is cancelled. */
  private disposeSession(): void {
    this.session?.dispose();
    this.session = null;
  }

  private lengthForMode(): number | string | null {
    if (this.mode === 'time') return state.choice.timeLength;
    if (this.mode === 'words') return state.choice.wordsLength;
    if (this.mode === 'quote') return state.choice.quoteLength;
    return null;
  }

  private renderControls(): void {
    this.controlRow.textContent = '';
    this.modeGroup = radioGroup({
      label: 'Mode',
      options: ['time', 'words', 'quote', 'custom'].map((value) => ({ value, label: value })),
      value: this.mode,
      notifyAlways: true,
      onChange: (value) => this.chooseMode(value as TestModeName),
    });
    this.controlRow.append(this.modeGroup.element);

    if (this.mode !== 'custom') {
      const values =
        this.mode === 'time'
          ? TIME_LENGTHS.map(String)
          : this.mode === 'words'
            ? WORD_LENGTHS.map(String)
            : QUOTE_LENGTHS;
      const group = radioGroup({
        label: 'Length',
        options: values.map((value) => ({ value, label: value })),
        value: String(this.lengthForMode()),
        onChange: (value) => this.chooseLength(value),
      });
      this.controlRow.append(group.element);
    }

    if (this.mode === 'time' || this.mode === 'words') {
      this.controlRow.append(
        this.checkbox('Punctuation', state.choice.punctuation, (checked) => {
          state.choice.punctuation = checked;
          saveChoice();
          void this.requestTicket({ moveFocus: true });
        }),
        this.checkbox('Numbers', state.choice.numbers, (checked) => {
          state.choice.numbers = checked;
          saveChoice();
          void this.requestTicket({ moveFocus: true });
        }),
      );
    }

    const begin = el('button', { type: 'button', class: 'button begin' }, ['Begin test']);
    begin.addEventListener('click', () => {
      this.sheetArea.scrollIntoView({ block: 'center' });
      this.focusInput();
    });
    this.controlRow.append(begin);
  }

  private checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
    const input = el('input', { type: 'checkbox', class: 'checkbox' }) as HTMLInputElement;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { class: 'check' }, [input, el('span', {}, [label])]);
  }

  private showSheet(): void {
    this.certificate = null;
    const readouts = el('div', { class: 'readouts' }, [
      el('span', { class: 'readout' }, [el('span', { class: 'readout-label' }, ['Timer']), this.timerEl]),
      el('span', { class: 'readout' }, [
        el('span', { class: 'readout-label' }, ['Speed']),
        this.liveSpeedEl,
      ]),
      el('span', { class: 'readout' }, [
        el('span', { class: 'readout-label' }, ['Accuracy']),
        this.liveAccuracyEl,
      ]),
    ]);
    const sheet = el('section', { class: 'test-sheet' }, [
      readouts,
      this.quoteSourceEl,
      this.view.holder,
      this.typingInput,
      this.restartButton,
      this.capsRegion,
      this.settingsRegion,
      this.resultRegion,
      this.alertBox,
    ]);
    this.sheetArea.replaceChildren(sheet);
    this.quoteSourceEl.hidden = this.mode !== 'quote';
    this.restartButton.onclick = (): void => {
      void this.requestTicket({ moveFocus: true });
    };
  }

  private focusInput(): void {
    this.typingInput.focus({ preventScroll: true });
  }

  private ticketBody(): Record<string, unknown> {
    if (this.mode === 'custom') {
      return {
        mode: 'custom',
        length: null,
        punctuation: false,
        numbers: false,
        text: rememberedCustomText(),
      };
    }
    if (this.mode === 'quote') {
      return {
        mode: 'quote',
        length: state.choice.quoteLength,
        punctuation: false,
        numbers: false,
        text: null,
      };
    }
    return {
      mode: this.mode,
      length: this.mode === 'time' ? state.choice.timeLength : state.choice.wordsLength,
      punctuation: state.choice.punctuation,
      numbers: state.choice.numbers,
      text: null,
    };
  }

  /** Every ticket request supersedes the earlier ones; a stale answer never reaches the sheet. */
  private async requestTicket(options: { moveFocus: boolean; text?: string }): Promise<void> {
    this.disposeSession();
    this.showSheet();
    this.view.setBusy(true);
    const request = ++this.ticketRequest;
    const body = options.text === undefined ? this.ticketBody() : {
      mode: 'custom',
      length: null,
      punctuation: false,
      numbers: false,
      text: options.text,
    };
    const response = await api.post<TicketResponse>('/api/tickets', body);
    if (request !== this.ticketRequest) return;
    if (response.status !== 201 || !response.body) {
      this.view.setBusy(false);
      this.alertBox.replaceChildren(el('p', { role: 'alert', class: 'alert' }, [COPY.ticketFailed]));
      return;
    }
    this.alertBox.textContent = '';
    this.startSession(response.body);
    this.view.setBusy(false);
    if (options.moveFocus) this.focusInput();
  }

  private startSession(ticket: TicketResponse): void {
    const mode = this.mode as TestMode;
    const lengthMs = mode === 'time' ? state.choice.timeLength * 1000 : null;
    const session = new TestSession(ticket, mode, lengthMs, {
      onSecond: (second) => this.handleSecond(second),
      onEnd: (figures) => this.finishTest(figures),
    });
    this.session = session;
    state.choice.mode = this.mode;
    saveChoice();
    this.view.mount(ticket.words);
    this.view.setCaret(0, 0, state.settings.caret);
    void document.fonts.ready.then(() => {
      if (this.session === session) this.view.remeasure();
    });
    this.timerEl.textContent =
      lengthMs === null ? `0/${ticket.words.length}` : String(state.choice.timeLength);
    this.liveSpeedEl.textContent = '0';
    this.liveAccuracyEl.textContent = '100%';
    this.resultRegion.textContent = '';
    this.quoteSourceEl.hidden = this.mode !== 'quote';
    if (this.mode === 'quote' && ticket.quoteId) {
      const quote = QUOTES.find((candidate) => candidate.id === ticket.quoteId);
      this.quoteSourceEl.textContent = quote ? quote.source : '';
    }
  }

  private handleSecond(second: number): void {
    const session = this.session;
    if (!session) return;
    if (session.lengthMs !== null) {
      this.timerEl.textContent = String(Math.max(0, state.choice.timeLength - second));
    }
    const readout = session.liveReadout(second);
    this.liveSpeedEl.textContent = whole(readout.speed);
    this.liveAccuracyEl.textContent = `${whole(readout.accuracy)}%`;
  }

  private type(key: string): void {
    const session = this.session;
    if (!session || session.ended) return;
    const beforeWord = session.engine.currentWord;
    const word = session.ticket.words[beforeWord] ?? '';
    const beforeExtras = Math.max(0, session.engine.typedLetters(beforeWord).length - word.length);
    const result = session.press(key);
    if (!result) return;
    const afterWord = session.engine.currentWord;
    this.view.renderWord(session.engine, beforeWord);
    if (afterWord !== beforeWord) this.view.renderWord(session.engine, afterWord);
    const afterWordText = session.ticket.words[afterWord] ?? '';
    const afterExtras = Math.max(
      0,
      session.engine.typedLetters(afterWord).length - afterWordText.length,
    );
    if (afterWord === beforeWord && afterExtras !== beforeExtras) this.view.refreshRows();
    this.view.setCaret(afterWord, session.engine.caretLetters, state.settings.caret);
    this.view.scrollIfNeeded(afterWord);
    if (session.lengthMs === null) {
      this.timerEl.textContent = `${afterWord}/${session.ticket.words.length}`;
    }
    if (result.endedNow) session.finish();
  }

  private finishTest(figures: EngineFigures): void {
    const session = this.session;
    if (!session) return;
    this.view.setBlurred(false);
    this.focusWarningShown = false;
    if (!session.resultAnnounced) {
      session.resultAnnounced = true;
      this.resultRegion.textContent = resultLine(
        figures.speed,
        figures.accuracy,
        figures.raw,
        figures.consistency,
      );
    }
    const certificate = renderCertificate({
      figures: {
        speed: figures.speed,
        raw: figures.raw,
        accuracy: figures.accuracy,
        consistency: figures.consistency,
        duration: figures.duration,
        characters: figures.characters,
      },
      replay: {
        words: session.ticket.words,
        log: session.log,
        kind: kindOfMode(session.mode),
        durationMs: figures.duration,
        perSecond: figures.perSecond,
        errorsByKey: figures.errorsByKey,
      },
      finishedAt: null,
      showNextTest: true,
      onNextTest: () => {
        void this.requestTicket({ moveFocus: true });
      },
      initialPosition: null,
    });
    this.certificate = certificate;
    this.sheetArea.replaceChildren(
      certificate.root,
      this.typingInput,
      this.restartButton,
      this.capsRegion,
      this.settingsRegion,
      this.resultRegion,
      this.alertBox,
    );
    certificate.refresh();
    this.setSeal(this.sealForSession(), null);
    if (state.session && state.session.verified) {
      session.submit(session.submissionBody(figures), (status, body) =>
        this.applyVerdict(status, body as RunVerdict | null),
      );
    }
  }

  private sealForSession(): string {
    if (!state.session) return COPY.guestSeal;
    if (!state.session.verified) return COPY.unverifiedSeal;
    return COPY.heldSeal;
  }

  private setSeal(text: string, proofKey: string | null): void {
    const certificate = this.certificate;
    if (!certificate) return;
    certificate.seal.textContent = text;
    certificate.seal.classList.remove('stamping');
    void certificate.seal.offsetWidth;
    certificate.seal.classList.add('stamping');
    if (proofKey) certificate.proofKey.textContent = proofStub(proofKey);
  }

  private applyVerdict(status: number, body: RunVerdict | null): void {
    if (status === 201) {
      const best = body?.personalBest === true;
      this.setSeal(best ? `${COPY.counted}\n${COPY.personalBest}` : COPY.counted, body?.proofKey ?? null);
      return;
    }
    if (status === 401) {
      this.setSeal(COPY.guestSeal, null);
      return;
    }
    if (status === 403 && body?.error === 'email_unverified') {
      this.setSeal(COPY.unverifiedSeal, null);
      return;
    }
    if (body?.error) {
      this.setSeal(notCountedSeal(body.error), body.proofKey ?? null);
      return;
    }
    this.setSeal(COPY.serverError, null);
  }

  private chooseMode(mode: TestModeName): void {
    if (mode === this.mode && mode !== 'custom') return;
    if (mode === 'custom') {
      this.modeBeforeCustom = this.mode === 'custom' ? this.modeBeforeCustom : this.mode;
      this.mode = 'custom';
      this.renderControls();
      this.openCustomDialog('radio');
      return;
    }
    this.mode = mode;
    this.renderControls();
    void this.requestTicket({ moveFocus: true });
  }

  private chooseLength(value: string): void {
    if (this.mode === 'time') state.choice.timeLength = Number(value);
    else if (this.mode === 'words') state.choice.wordsLength = Number(value);
    else if (this.mode === 'quote') state.choice.quoteLength = value;
    saveChoice();
    void this.requestTicket({ moveFocus: true });
  }

  private openCustomDialog(opener: 'radio' | 'command'): void {
    const focusAfter = (): void => {
      if (opener === 'radio') this.modeGroup?.focusChecked();
      else this.focusInput();
    };
    openCustomText({
      initialText: rememberedCustomText(),
      onUse: (text) => {
        rememberCustomText(text);
        this.mode = 'custom';
        this.renderControls();
        focusAfter();
        void this.requestTicket({ moveFocus: false, text });
      },
      onEscape: () => {
        const remembered = rememberedCustomText();
        if (remembered !== '') {
          this.mode = 'custom';
          this.renderControls();
          focusAfter();
          void this.requestTicket({ moveFocus: false, text: remembered });
          return;
        }
        this.mode = this.modeBeforeCustom;
        this.renderControls();
        focusAfter();
        void this.requestTicket({ moveFocus: false });
      },
    });
  }

  private commands(): CommandSpec[] {
    const commands: CommandSpec[] = [];
    const testCommand = (label: string, apply: () => void): void => {
      commands.push({
        label,
        apply: (): void => {
          apply();
          saveChoice();
          this.renderControls();
          this.focusInput();
          void this.requestTicket({ moveFocus: true });
        },
      });
    };
    const settingCommand = (label: string, apply: () => void): void => {
      commands.push({
        label,
        apply: (): void => {
          apply();
          saveSettings();
          applyTheme();
          this.focusInput();
          void this.requestTicket({ moveFocus: true });
        },
      });
    };

    for (const mode of ['time', 'words', 'quote', 'custom'] as TestModeName[]) {
      if (mode === 'custom') {
        commands.push({
          label: 'Mode: custom',
          apply: (): void => {
            this.modeBeforeCustom = this.mode === 'custom' ? this.modeBeforeCustom : this.mode;
            this.mode = 'custom';
            this.renderControls();
            this.openCustomDialog('command');
          },
        });
      } else {
        testCommand(`Mode: ${mode}`, () => {
          this.mode = mode;
        });
      }
    }
    for (const length of TIME_LENGTHS) {
      testCommand(`Time: ${length}`, () => {
        this.mode = 'time';
        state.choice.timeLength = length;
      });
    }
    for (const length of WORD_LENGTHS) {
      testCommand(`Words: ${length}`, () => {
        this.mode = 'words';
        state.choice.wordsLength = length;
      });
    }
    for (const group of QUOTE_LENGTHS) {
      testCommand(`Quote length: ${group}`, () => {
        this.mode = 'quote';
        state.choice.quoteLength = group;
      });
    }
    for (const on of [true, false]) {
      testCommand(`Punctuation: ${on ? 'on' : 'off'}`, () => {
        if (this.mode === 'quote' || this.mode === 'custom') this.mode = 'time';
        state.choice.punctuation = on;
      });
    }
    for (const on of [true, false]) {
      testCommand(`Numbers: ${on ? 'on' : 'off'}`, () => {
        if (this.mode === 'quote' || this.mode === 'custom') this.mode = 'time';
        state.choice.numbers = on;
      });
    }
    for (const theme of ['sand', 'cobalt', 'carbon', 'ledger'] as Theme[]) {
      settingCommand(`Theme: ${theme}`, () => {
        state.settings.theme = theme;
      });
    }
    for (const caret of ['line', 'block', 'underline', 'off'] as CaretStyle[]) {
      settingCommand(`Caret: ${caret}`, () => {
        state.settings.caret = caret;
      });
    }
    for (const on of [true, false]) {
      settingCommand(`Smooth caret: ${on ? 'on' : 'off'}`, () => {
        state.settings.smoothCaret = on;
      });
    }
    for (const size of [1, 1.5, 2, 3]) {
      settingCommand(`Font size: ${size}`, () => {
        state.settings.fontSize = size;
      });
    }
    for (const on of [true, false]) {
      settingCommand(`Blind mode: ${on ? 'on' : 'off'}`, () => {
        state.settings.blindMode = on;
      });
    }
    for (const quick of ['tab', 'enter'] as QuickRestart[]) {
      settingCommand(`Quick restart: ${quick}`, () => {
        state.settings.quickRestart = quick;
      });
    }
    return commands;
  }

  private openCommands(): void {
    this.disposeSession();
    openCommandLine({
      commands: this.commands(),
      onApplied: (command) => {
        this.settingsRegion.textContent = settingsApplied(command.label);
      },
      onEscape: () => {
        this.focusInput();
        void this.requestTicket({ moveFocus: true });
      },
    });
  }

  private restart(): void {
    void this.requestTicket({ moveFocus: true });
  }

  private handleResize(): void {
    const session = this.session;
    if (!session) return;
    const current = session.engine.currentWord;
    const line = this.view.lineOf(current);
    this.view.relayout(current, line);
    this.view.setCaret(current, session.engine.caretLetters, state.settings.caret);
  }

  private handleBlur(): void {
    const session = this.session;
    if (!session || session.ended) return;
    session.startFocusWarning(() => {
      this.focusWarningShown = true;
      this.view.setBlurred(true);
    });
  }

  private handleFocus(): void {
    this.session?.cancelFocusWarning();
    this.focusWarningShown = false;
    this.view.setBlurred(false);
  }

  private handleBeforeInput(event: InputEvent): void {
    event.preventDefault();
    const session = this.session;
    if (!session) return;
    if (event.inputType === 'insertText' && event.data !== null) {
      if ([...event.data].length !== 1) return;
      this.type(event.data === ' ' ? 'Space' : event.data);
      return;
    }
    if (event.inputType === 'deleteContentBackward') this.type('Backspace');
    else if (event.inputType === 'deleteWordBackward') this.type('CtrlBackspace');
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'CapsLock') {
      this.capsRegion.textContent = this.capsRegion.textContent === COPY.capsLock ? '' : COPY.capsLock;
    } else if (event.getModifierState) {
      this.capsRegion.textContent = event.getModifierState('CapsLock') ? COPY.capsLock : '';
    }

    if (dialogOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.openCommands();
      return;
    }

    if (event.key === 'Enter' && state.settings.quickRestart === 'enter') {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName.toLowerCase();
      const isLink = tag === 'a';
      const isOtherButton = tag === 'button' && active !== this.restartButton;
      if (!isLink && !isOtherButton) {
        event.preventDefault();
        this.restart();
        return;
      }
    }

    const active = document.activeElement;
    const typing = active === this.typingInput;
    const printed = isPrintedKey(event.key) && !event.ctrlKey && !event.metaKey;

    if (!typing) {
      // A printed key outside the typing input refocuses it without being typed or logged.
      const tag = (active as HTMLElement | null)?.tagName.toLowerCase();
      const control =
        active !== this.view.focusButton &&
        (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select');
      if (printed && !control) {
        event.preventDefault();
        this.focusInput();
      }
      return;
    }

    if (this.focusWarningShown) {
      this.view.setBlurred(false);
      this.focusWarningShown = false;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      this.type(event.ctrlKey || event.altKey ? 'CtrlBackspace' : 'Backspace');
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      this.type('Space');
      return;
    }
    if (printed) {
      event.preventDefault();
      this.type(event.key);
    }
  }
}
