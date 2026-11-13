import { TapeOperation } from './api';
import { clear, el, find, on, reducedMotion } from './dom';
import { display } from '../shared/numbers';

export const TICK_SPACING = 24;

/** `Operation <k> of <N> · <op> · <change> cm³` for geometry, without the change otherwise. */
export function tapeReadout(operations: TapeOperation[], index: number): string {
  const operation = operations[index];
  const last = operations.length - 1;
  if (!operation) return '';
  if (operation.kind === 'start') return `Operation 0 of ${last} · empty`;
  if (operation.kind === 'params') return `Operation ${index} of ${last} · ${operation.op}`;
  const change = operation.delta / 1000;
  const sign = change > 0 ? '+' : change < 0 ? '' : '±';
  const text = change === 0 ? '0.00' : display(change, 2);
  return `Operation ${index} of ${last} · ${operation.op} · ${sign}${text} cm³`;
}

export function tapeValueText(operations: TapeOperation[], index: number): string {
  const operation = operations[index];
  const last = operations.length - 1;
  if (!operation) return '';
  return `Operation ${index} of ${last} · ${operation.kind} · ${operation.op}`;
}

export type TapeOptions = {
  onMove: (index: number) => void;
  onFork?: (index: number) => void;
  owner: boolean;
};

export class BuildTape {
  readonly root: HTMLElement;
  readonly slider: HTMLElement;
  readonly readout: HTMLElement;
  private readonly track: HTMLElement;
  private readonly playhead: HTMLElement;
  private readonly forkButton: HTMLElement | null;
  private readonly note: HTMLElement;
  private operations: TapeOperation[] = [];
  private index = 0;
  private disabled = false;

  constructor(private readonly options: TapeOptions) {
    this.playhead = el('span', { class: 'tape-playhead', 'aria-hidden': 'true' });
    this.track = el('div', { class: 'tape-track' }, [this.playhead]);
    this.slider = el(
      'div',
      {
        role: 'slider',
        'aria-label': 'Build tape',
        tabindex: '0',
        class: 'tape-slider',
        'aria-valuemin': '0',
        'aria-valuemax': '0',
        'aria-valuenow': '0',
      },
      [this.track],
    );
    this.readout = el('p', { 'data-ui': 'tape-readout', class: 'tape-readout' });
    this.forkButton = options.owner
      ? el('button', { type: 'button', class: 'chip', 'data-ui': 'fork-button' }, ['Fork from operation 0'])
      : null;
    this.note = el('p', { class: 'tape-note' });
    this.root = el('section', { class: 'build-tape', 'aria-label': 'Build tape' }, [
      this.slider,
      this.readout,
      ...(this.forkButton ? [this.forkButton] : []),
      this.note,
    ]);
    if (this.forkButton) {
      on(this.forkButton, 'click', () => this.options.onFork?.(this.index));
    }
    this.wireKeys();
    this.wireDrag();
  }

  private wireKeys(): void {
    on(this.slider, 'keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.isComposing || this.disabled) return;
      const last = this.operations.length - 1;
      if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowLeft') {
        keyboard.preventDefault();
        const forward = keyboard.key === 'ArrowRight';
        if (keyboard.shiftKey) {
          const geometry = this.operations.filter(
            (operation) => operation.kind === 'body' || operation.kind === 'cut' || operation.kind === 'join',
          );
          const next = forward
            ? geometry.find((operation) => operation.index > this.index)
            : [...geometry].reverse().find((operation) => operation.index < this.index);
          if (next) this.moveTo(next.index);
          return;
        }
        this.moveTo(Math.max(0, Math.min(last, this.index + (forward ? 1 : -1))));
      } else if (keyboard.key === 'Home') {
        keyboard.preventDefault();
        this.moveTo(0);
      } else if (keyboard.key === 'End') {
        keyboard.preventDefault();
        this.moveTo(last);
      } else if (keyboard.key === 'Enter' && this.options.owner) {
        keyboard.preventDefault();
        this.options.onFork?.(this.index);
      }
    });
  }

  /** The playhead follows the nearest tick during a captured drag. */
  private wireDrag(): void {
    let dragging = false;
    let startIndex = 0;

    const indexAt = (clientX: number): number => {
      const box = this.track.getBoundingClientRect();
      const last = this.operations.length - 1;
      if (last <= 0) return 0;
      const ratio = (clientX - box.left) / Math.max(1, box.width);
      return Math.max(0, Math.min(last, Math.round(ratio * last)));
    };

    const stop = (commit: boolean): void => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('keydown', onKey, true);
      if (!commit) this.moveTo(startIndex);
    };

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') stop(false);
    }

    on(this.track, 'pointerdown', (event) => {
      if (this.disabled) return;
      const pointer = event as unknown as PointerEvent;
      pointer.preventDefault();
      dragging = true;
      startIndex = this.index;
      this.track.setPointerCapture(pointer.pointerId);
      window.addEventListener('keydown', onKey, true);
      this.moveTo(indexAt(pointer.clientX));
    });
    on(this.track, 'pointermove', (event) => {
      if (!dragging) return;
      const pointer = event as unknown as PointerEvent;
      this.moveTo(indexAt(pointer.clientX));
    });
    on(this.track, 'pointerup', () => {
      stop(true);
      this.settle();
    });
    on(this.track, 'pointercancel', () => stop(false));
  }

  private settle(): void {
    if (reducedMotion()) return;
    this.playhead.classList.add('is-settling');
    window.setTimeout(() => this.playhead.classList.remove('is-settling'), 240);
  }

  setOperations(operations: TapeOperation[], index = operations.length - 1): void {
    this.operations = operations;
    clear(this.track);
    this.track.append(this.playhead);
    for (const operation of operations) {
      this.track.append(
        el('span', {
          class: `tape-tick tape-tick-${operation.kind}`,
          'aria-hidden': 'true',
          'data-index': operation.index,
        }),
      );
    }
    this.track.style.setProperty('--tick-count', String(operations.length));
    this.slider.setAttribute('aria-valuemax', String(Math.max(0, operations.length - 1)));
    this.index = Math.max(0, Math.min(operations.length - 1, index));
    this.paint();
  }

  setDisabled(disabled: boolean, line: string): void {
    this.disabled = disabled;
    if (disabled) {
      this.slider.setAttribute('aria-disabled', 'true');
      this.note.textContent = line;
    } else {
      this.slider.removeAttribute('aria-disabled');
      this.note.textContent = '';
    }
  }

  noteLine(line: string): void {
    const existing = find('[data-ui="tape-extra-note"]', this.root);
    existing?.remove();
    if (line.length === 0) return;
    this.root.append(el('p', { 'data-ui': 'tape-extra-note', class: 'tape-note' }, [line]));
  }

  current(): number {
    return this.index;
  }

  operationAt(index: number): TapeOperation | undefined {
    return this.operations[index];
  }

  all(): TapeOperation[] {
    return this.operations;
  }

  moveTo(index: number): void {
    const last = this.operations.length - 1;
    const next = Math.max(0, Math.min(last, index));
    if (next === this.index) {
      this.paint();
      return;
    }
    this.index = next;
    this.paint();
    this.options.onMove(next);
  }

  private paint(): void {
    const last = Math.max(0, this.operations.length - 1);
    this.slider.setAttribute('aria-valuenow', String(this.index));
    this.slider.setAttribute('aria-valuetext', tapeValueText(this.operations, this.index));
    this.readout.textContent = tapeReadout(this.operations, this.index);
    this.playhead.style.left = `${last === 0 ? 0 : (this.index / last) * 100}%`;
    if (this.forkButton) {
      this.forkButton.textContent = `Fork from operation ${this.index}`;
      this.forkButton.setAttribute('aria-label', `Fork from operation ${this.index}`);
    }
  }
}
