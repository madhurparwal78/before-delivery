import { el, prefersReducedMotion, svg } from './dom.js';
import { COPY, replayValueText, two, utcStamp } from './copy.js';
import {
  TypingEngine,
  errorsByKeyOrder,
  secondsInRun,
  type LetterState,
  type LogEntry,
  type PerSecondRow,
  type TestKind,
} from '../shared/engine.js';
import { state } from './state.js';

export interface CertificateFigures {
  readonly speed: number | null;
  readonly raw: number | null;
  readonly accuracy: number | null;
  readonly consistency: number | null;
  readonly duration: number | null;
  readonly characters: {
    correct: number | null;
    incorrect: number | null;
    extra: number | null;
    missed: number | null;
  } | null;
}

export interface ReplaySource {
  readonly words: string[];
  readonly log: LogEntry[];
  readonly kind: TestKind;
  readonly durationMs: number;
  readonly perSecond: PerSecondRow[];
  readonly errorsByKey: Record<string, number>;
}

export interface CertificateOptions {
  readonly figures: CertificateFigures;
  readonly replay: ReplaySource | null;
  readonly finishedAt: string | null;
  readonly showNextTest: boolean;
  readonly onNextTest?: () => void;
  readonly onPosition?: (second: number) => void;
  readonly initialPosition?: number | null;
}

export interface CertificateHandle {
  readonly root: HTMLElement;
  readonly seal: HTMLElement;
  readonly proofKey: HTMLElement;
  setPosition(second: number): void;
  /** Re-measures the carbon once the certificate is on the page. */
  refresh(): void;
  readonly maxPosition: number;
}

function charactersText(characters: CertificateFigures['characters']): string {
  if (!characters) return '-';
  const parts = [
    characters.correct,
    characters.incorrect,
    characters.extra,
    characters.missed,
  ].map((value) => (value === null ? '-' : String(value)));
  return parts.join('/');
}

function figureRow(label: string, id: string, value: string): HTMLElement {
  return el('div', { class: 'figure-row' }, [
    el('span', { class: 'figure-label' }, [label]),
    el('span', { class: 'figure-value', id }, [value]),
  ]);
}

const KEYBOARD_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

function errorKeyboard(errorsByKey: Record<string, number>): SVGElement {
  const struck = new Set<string>();
  for (const [key, count] of Object.entries(errorsByKey)) {
    if (count > 0) struck.add(key.toLowerCase());
  }
  const keys: SVGElement[] = [];
  KEYBOARD_ROWS.forEach((row, rowIndex) => {
    row.forEach((key, index) => {
      keys.push(
        svg('rect', {
          x: index * 18 + rowIndex * 6 + 2,
          y: rowIndex * 18 + 2,
          width: 15,
          height: 15,
          rx: 2,
          class: struck.has(key) ? 'key struck' : 'key',
        }),
      );
    });
  });
  keys.push(
    svg('rect', {
      x: 30,
      y: 56,
      width: 90,
      height: 14,
      rx: 2,
      class: struck.has('space') ? 'key struck' : 'key',
    }),
  );
  return svg(
    'svg',
    {
      viewBox: '0 0 200 74',
      class: 'error-keyboard',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    keys,
  );
}

function speedChart(rows: readonly PerSecondRow[]): SVGElement {
  const width = 320;
  const height = 120;
  const maxSpeed = Math.max(1, ...rows.map((row) => Math.max(row.speed, row.raw)));
  const x = (second: number): number =>
    rows.length <= 1 ? width / 2 : ((second - 1) / (rows.length - 1)) * (width - 16) + 8;
  const y = (value: number): number => height - 8 - (value / maxSpeed) * (height - 24);
  const line = rows.map((row) => `${x(row.second)},${y(row.speed)}`).join(' ');
  const rawLine = rows.map((row) => `${x(row.second)},${y(row.raw)}`).join(' ');
  const points = rows.map((row) =>
    svg('circle', {
      cx: x(row.second),
      cy: y(row.speed),
      r: 3,
      'data-second': row.second,
      class: 'chart-point',
    }),
  );
  return svg(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Speed over time',
      class: 'speed-chart',
    },
    [
      svg('polyline', { points: rawLine, class: 'chart-raw' }),
      svg('polyline', { points: line, class: 'chart-speed' }),
      ...points,
    ],
  );
}

function letterSpan(character: string, letterState: LetterState): HTMLElement {
  return el('span', { class: 'letter', 'data-state': letterState }, [character]);
}

function blindState(letterState: LetterState): LetterState | 'typed' {
  if (!state.settings.blindMode) return letterState;
  if (letterState === 'correct' || letterState === 'incorrect') return 'typed';
  if (letterState === 'missed') return 'untyped';
  return letterState;
}

/** The carbon copy: the same word and letter elements as the words area, without data-line. */
class Carbon {
  readonly element: HTMLElement;
  readonly caret: HTMLElement;
  private readonly source: ReplaySource;
  private readonly wordCount: number;
  private rendered: string[][] = [];

  constructor(source: ReplaySource) {
    this.source = source;
    const final = new TypingEngine(source.words, source.kind, state.config.maxExtraLetters);
    final.applyAll(source.log);
    this.wordCount = final.reachedWords;
    this.element = el('div', { id: 'carbon', class: 'carbon' });
    this.caret = el('div', { id: 'carbon-caret', class: 'carbon-caret' });
    this.element.append(this.caret);
  }

  render(second: number, forward: boolean): void {
    const engine = new TypingEngine(
      this.source.words,
      this.source.kind,
      state.config.maxExtraLetters,
    );
    for (const entry of this.source.log) {
      if (entry.t >= second * 1000) break;
      engine.apply(entry);
    }
    const animate = forward && !prefersReducedMotion();
    for (let index = 0; index < this.wordCount; index += 1) {
      const states = engine.letterStates(index);
      const typed = engine.typedLetters(index);
      const word = this.source.words[index] as string;
      const letters: string[] = [];
      for (let i = 0; i < states.length; i += 1) {
        const character = i < word.length ? word.charAt(i) : (typed[i] as string);
        letters.push(`${character}:${blindState(states[i] as LetterState)}`);
      }
      const before = this.rendered[index];
      if (before && before.join('|') === letters.join('|')) continue;
      this.renderWord(index, letters, before ?? [], animate);
      this.rendered[index] = letters;
    }
    const caretWord = this.element.querySelector<HTMLElement>(
      `.word[data-index="${engine.currentWord}"]`,
    );
    this.caret.dataset['word'] = String(engine.currentWord);
    this.caret.dataset['letter'] = String(engine.caretLetters);
    if (caretWord) {
      const letters = [...caretWord.querySelectorAll<HTMLElement>('.letter')];
      const target = letters[engine.caretLetters];
      const last = letters.at(-1);
      const left = target
        ? target.offsetLeft
        : last
          ? last.offsetLeft + last.offsetWidth
          : caretWord.offsetLeft;
      const top = target ? target.offsetTop : (last?.offsetTop ?? caretWord.offsetTop);
      this.caret.style.transform = `translate(${left}px, ${top}px)`;
    }
  }

  private renderWord(index: number, letters: string[], before: string[], animate: boolean): void {
    let word = this.element.querySelector<HTMLElement>(`.word[data-index="${index}"]`);
    if (!word) {
      word = el('div', { class: 'word', 'data-index': index });
      this.element.append(word);
    }
    word.textContent = '';
    letters.forEach((entry, position) => {
      const splitAt = entry.lastIndexOf(':');
      const character = entry.slice(0, splitAt);
      const letterState = entry.slice(splitAt + 1) as LetterState;
      const span = letterSpan(character, letterState);
      const previous = before[position];
      const wasStruck = previous !== undefined && !previous.endsWith(':untyped');
      if (animate && !wasStruck && letterState !== 'untyped') span.classList.add('inking');
      word.append(span);
    });
    if (index < this.wordCount - 1) word.append(document.createTextNode(' '));
  }
}

export function renderCertificate(options: CertificateOptions): CertificateHandle {
  const figures = options.figures;
  const card = el('div', { class: 'certificate-card' });
  card.append(
    el('h1', { class: 'certificate-title' }, ['Certificate of typing proficiency']),
    el('p', { class: 'speed-figure', id: 'result-speed' }, [two(figures.speed)]),
    el('p', { class: 'speed-label' }, ['words per minute']),
  );
  const column = el('div', { class: 'figure-column' }, [
    figureRow('Raw speed', 'result-raw', two(figures.raw)),
    figureRow(
      'Accuracy',
      'result-accuracy',
      figures.accuracy === null ? '-' : `${two(figures.accuracy)}%`,
    ),
    figureRow(
      'Consistency',
      'result-consistency',
      figures.consistency === null ? '-' : `${two(figures.consistency)}%`,
    ),
    figureRow('Characters', 'result-characters', charactersText(figures.characters)),
    figureRow(
      'Duration',
      'result-duration',
      figures.duration === null ? '-' : `${two(figures.duration / 1000)} s`,
    ),
  ]);
  card.append(column);
  card.append(errorKeyboard(options.replay?.errorsByKey ?? {}));

  const seal = el('div', { id: 'seal', role: 'status', 'aria-label': 'Seal', class: 'seal' });
  const proofKey = el('span', { id: 'proof-key', class: 'proof-key' });
  const stub = el('div', { class: 'stub' }, [seal, proofKey]);
  if (options.finishedAt) {
    stub.append(el('span', { id: 'result-finished', class: 'finished' }, [utcStamp(options.finishedAt)]));
  }
  card.append(stub);

  const panel = el('div', { class: 'carbon-panel' });
  const region = el('section', { class: 'certificate', role: 'region', 'aria-label': 'Certificate' }, [
    card,
    panel,
  ]);

  let maxPosition = 0;
  let position = 0;
  let carbon: Carbon | null = null;
  let slider: HTMLElement | null = null;
  let replaySpeed: HTMLElement | null = null;
  let chart: SVGElement | null = null;
  let perSecondTable: HTMLTableElement | null = null;

  const setPosition = (next: number): void => {
    if (!options.replay || !carbon || !slider || !replaySpeed) return;
    const clamped = Math.max(0, Math.min(maxPosition, Math.round(next)));
    const forward = clamped > position;
    position = clamped;
    carbon.render(clamped, forward);
    const row = options.replay.perSecond[clamped - 1];
    const speed = clamped === 0 ? 0 : (row?.speed ?? 0);
    replaySpeed.textContent = two(speed);
    slider.setAttribute('aria-valuenow', String(clamped));
    slider.setAttribute('aria-valuetext', replayValueText(clamped, speed));
    const fraction = maxPosition === 0 ? 1 : clamped / maxPosition;
    slider.style.setProperty('--slider-fraction', String(fraction));
    chart?.querySelectorAll('[data-second]').forEach((point) => {
      if (Number(point.getAttribute('data-second')) === clamped && clamped > 0) {
        point.setAttribute('aria-current', 'true');
      } else point.removeAttribute('aria-current');
    });
    perSecondTable?.querySelectorAll('tbody tr').forEach((tableRow, index) => {
      if (index + 1 === clamped && clamped > 0) tableRow.setAttribute('aria-current', 'true');
      else tableRow.removeAttribute('aria-current');
    });
    options.onPosition?.(clamped);
  };

  if (options.replay) {
    const replaySource = options.replay;
    maxPosition = secondsInRun(replaySource.durationMs);
    carbon = new Carbon(replaySource);
    replaySpeed = el('span', { id: 'replay-speed', class: 'replay-speed' }, ['0.00']);
    slider = el('div', {
      role: 'slider',
      'aria-label': 'Replay position',
      'aria-valuemin': 0,
      'aria-valuemax': maxPosition,
      'aria-valuenow': 0,
      'aria-orientation': 'horizontal',
      tabindex: 0,
      class: 'slider',
    });
    slider.append(el('span', { class: 'slider-track' }), el('span', { class: 'slider-thumb' }));
    chart = speedChart(replaySource.perSecond);

    perSecondTable = el('table', { class: 'data-table' }) as HTMLTableElement;
    perSecondTable.append(
      el('caption', {}, ['Speed over time']),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Second']),
          el('th', { scope: 'col' }, ['Speed']),
          el('th', { scope: 'col' }, ['Raw']),
          el('th', { scope: 'col' }, ['Errors']),
        ]),
      ]),
    );
    const body = el('tbody');
    for (const row of replaySource.perSecond) {
      body.append(
        el('tr', {}, [
          el('td', {}, [String(row.second)]),
          el('td', {}, [two(row.speed)]),
          el('td', {}, [two(row.raw)]),
          el('td', {}, [String(row.errors)]),
        ]),
      );
    }
    perSecondTable.append(body);

    const errorRows = errorsByKeyOrder(replaySource.errorsByKey);
    let errorsBlock: HTMLElement;
    if (errorRows.length === 0) {
      errorsBlock = el('p', { class: 'no-errors' }, [COPY.noErrors]);
    } else {
      const table = el('table', { class: 'data-table' });
      table.append(
        el('caption', {}, ['Errors by key']),
        el('thead', {}, [
          el('tr', {}, [el('th', { scope: 'col' }, ['Key']), el('th', { scope: 'col' }, ['Errors'])]),
        ]),
      );
      const errorBody = el('tbody');
      for (const [key, count] of errorRows) {
        errorBody.append(el('tr', {}, [el('td', {}, [key]), el('td', {}, [String(count)])]));
      }
      table.append(errorBody);
      errorsBlock = table;
    }

    panel.append(
      carbon.element,
      chart,
      el('div', { class: 'replay-controls' }, [
        slider,
        el('span', { class: 'replay-readout' }, [replaySpeed, el('span', {}, [' wpm'])]),
      ]),
      perSecondTable,
      errorsBlock,
    );

    const move = (delta: number): void => setPosition(position + delta);
    slider.addEventListener('keydown', (event) => {
      const keys: Record<string, () => void> = {
        ArrowRight: () => move(1),
        ArrowUp: () => move(1),
        ArrowLeft: () => move(-1),
        ArrowDown: () => move(-1),
        PageUp: () => move(5),
        PageDown: () => move(-5),
        Home: () => setPosition(0),
        End: () => setPosition(maxPosition),
      };
      const action = keys[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
    const fromPointer = (clientX: number): void => {
      const box = (slider as HTMLElement).getBoundingClientRect();
      const fraction = box.width === 0 ? 0 : (clientX - box.left) / box.width;
      setPosition(Math.round(fraction * maxPosition));
    };
    slider.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      (slider as HTMLElement).setPointerCapture(event.pointerId);
      (slider as HTMLElement).focus();
      fromPointer(event.clientX);
    });
    slider.addEventListener('pointermove', (event) => {
      if (!(slider as HTMLElement).hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      fromPointer(event.clientX);
    });
  }

  if (options.showNextTest) {
    const next = el('button', { type: 'button', class: 'button next-test' }, ['Next test']);
    next.addEventListener('click', () => options.onNextTest?.());
    card.append(next);
  }

  if (options.replay) {
    const start = options.initialPosition;
    setPosition(start === null || start === undefined ? maxPosition : start);
    void document.fonts.ready.then(() => setPosition(position));
  }

  return {
    root: region,
    seal,
    proofKey,
    setPosition,
    refresh: (): void => setPosition(position),
    maxPosition,
  };
}
