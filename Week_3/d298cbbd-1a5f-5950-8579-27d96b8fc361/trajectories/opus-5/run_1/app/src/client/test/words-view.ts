import { el } from '../dom.js';
import { COPY } from '../copy.js';
import { state } from '../state.js';
import type { CaretStyle } from '../state.js';
import type { LetterState, TypingEngine } from '../../shared/engine.js';

export type DisplayState = LetterState | 'typed';

export function displayState(letterState: LetterState): DisplayState {
  if (!state.settings.blindMode) return letterState;
  if (letterState === 'correct' || letterState === 'incorrect') return 'typed';
  if (letterState === 'missed') return 'untyped';
  return letterState;
}

/** The words area: three visible lines, one element per word, one per letter. */
export class WordsView {
  /** The words area itself, holding only the passage. */
  readonly element: HTMLElement;
  /** The words area with the focus button layered over it. */
  readonly holder: HTMLElement;
  readonly inner: HTMLElement;
  readonly caret: HTMLElement;
  readonly focusButton: HTMLButtonElement;
  private words: string[] = [];
  private rows: number[] = [];
  private scrolledLines = 0;
  private placed: { word: number; letter: number; style: CaretStyle } | null = null;

  constructor(onFocusRequest: () => void) {
    this.inner = el('div', { class: 'words-inner' });
    this.caret = el('div', { id: 'caret', class: 'caret', 'data-word': 0, 'data-letter': 0 });
    this.focusButton = el('button', { type: 'button', class: 'focus-button' }, [
      COPY.focusButton,
    ]) as HTMLButtonElement;
    this.focusButton.hidden = true;
    this.focusButton.addEventListener('click', onFocusRequest);
    this.element = el('div', { id: 'words', class: 'words', 'aria-busy': 'false' }, [this.inner]);
    this.holder = el('div', { class: 'words-holder' }, [this.element, this.focusButton]);
    this.inner.append(this.caret);
  }

  setBusy(busy: boolean): void {
    this.element.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  setBlurred(blurred: boolean): void {
    if (blurred) this.element.dataset['blurred'] = 'true';
    else delete this.element.dataset['blurred'];
    this.focusButton.hidden = !blurred;
  }

  mount(words: string[]): void {
    this.words = words;
    this.scrolledLines = 0;
    for (const word of [...this.inner.querySelectorAll('.word')]) word.remove();
    words.forEach((word, index) => {
      const node = el('div', { class: 'word', 'data-index': index, 'data-line': 1 });
      for (const character of word) {
        node.append(el('span', { class: 'letter', 'data-state': 'untyped' }, [character]));
      }
      node.append(document.createTextNode(index === words.length - 1 ? '' : ' '));
      this.inner.append(node);
    });
    this.recomputeRows();
    this.applyLines();
  }

  private wordElement(index: number): HTMLElement | null {
    return this.inner.querySelector<HTMLElement>(`.word[data-index="${index}"]`);
  }

  /** Reads the visual rows from the layout, so words on one row share one top edge. */
  recomputeRows(): void {
    const tops: number[] = [];
    this.rows = this.words.map((_, index) => {
      const node = this.wordElement(index);
      if (!node) return 0;
      const top = node.offsetTop;
      let row = tops.findIndex((value) => Math.abs(value - top) <= 1);
      if (row === -1) {
        tops.push(top);
        row = tops.length - 1;
      }
      return row;
    });
  }

  private applyLines(): void {
    this.words.forEach((_, index) => {
      const node = this.wordElement(index);
      if (!node) return;
      const line = (this.rows[index] ?? 0) - this.scrolledLines + 1;
      node.dataset['line'] = String(Math.max(0, line));
    });
    this.inner.style.transform = `translateY(calc(var(--line-height) * -${this.scrolledLines}))`;
  }

  lineOf(index: number): number {
    return Math.max(0, (this.rows[index] ?? 0) - this.scrolledLines + 1);
  }

  private firstWordOfRow(row: number): number {
    return this.rows.findIndex((value) => value === row);
  }

  /** The text moves up one line when the caret enters the first word of line 3. */
  scrollIfNeeded(currentWord: number): void {
    const row = this.rows[currentWord] ?? 0;
    if (this.lineOf(currentWord) === 3 && this.firstWordOfRow(row) === currentWord) {
      this.scrolledLines += 1;
      this.applyLines();
    }
  }

  /** After a resize the current word keeps line 1, or moves to line 2 from anywhere else. */
  relayout(currentWord: number, previousLine: number): void {
    this.recomputeRows();
    const desired = previousLine === 1 ? 1 : 2;
    const row = this.rows[currentWord] ?? 0;
    this.scrolledLines = Math.max(0, row - desired + 1);
    this.applyLines();
  }

  /** Re-reads the rows after extra letters have changed a word's width. */
  refreshRows(): void {
    this.recomputeRows();
    this.applyLines();
  }

  renderWord(engine: TypingEngine, index: number): void {
    const node = this.wordElement(index);
    if (!node) return;
    const word = this.words[index] as string;
    const states = engine.letterStates(index);
    const typed = engine.typedLetters(index);
    node.textContent = '';
    states.forEach((letterState, position) => {
      const character = position < word.length ? word.charAt(position) : (typed[position] as string);
      node.append(
        el('span', { class: 'letter', 'data-state': displayState(letterState) }, [character]),
      );
    });
    node.append(document.createTextNode(index === this.words.length - 1 ? '' : ' '));
  }

  renderAll(engine: TypingEngine): void {
    this.words.forEach((_, index) => this.renderWord(engine, index));
  }

  /** Re-reads the layout once the typing face has loaded, so the caret sits on its letter. */
  remeasure(): void {
    this.recomputeRows();
    this.applyLines();
    const placed = this.placed;
    if (placed) this.setCaret(placed.word, placed.letter, placed.style);
  }

  setCaret(word: number, letter: number, style: CaretStyle): void {
    this.placed = { word, letter, style };
    this.caret.dataset['word'] = String(word);
    this.caret.dataset['letter'] = String(letter);
    this.caret.dataset['style'] = style;
    for (const marked of [...this.inner.querySelectorAll('.under-caret')]) {
      marked.classList.remove('under-caret');
    }
    const node = this.wordElement(word);
    if (!node) return;
    const letters = [...node.querySelectorAll<HTMLElement>('.letter')];
    const target = letters[letter];
    const last = letters.at(-1);
    const left = target
      ? target.offsetLeft
      : last
        ? last.offsetLeft + last.offsetWidth
        : node.offsetLeft;
    const top = target ? target.offsetTop : (last?.offsetTop ?? node.offsetTop);
    const width = target?.offsetWidth ?? last?.offsetWidth ?? 12;
    this.caret.style.transform = `translate(${left}px, ${top}px)`;
    this.caret.style.setProperty('--caret-width', `${width}px`);
    if (style === 'block' && target) target.classList.add('under-caret');
  }
}
