import { el } from './dom.js';

export interface ScrubCallbacks {
  getValue: () => number;
  setValue: (value: number) => void;
  onCommit: (value: number) => void;
  onLive: (value: number) => void;
  step?: number;
  decimals: number;
  bpmField?: boolean;
  onFocusGained?: () => number;
  error?: (message: string | null) => void;
}

// A scrub field: drag to change 0.1 per pixel (0.01 with Shift), arrow keys
// step the same, Enter commits, Escape reverts, blur commits. The BPM field
// always steps 0.1 and rounds to one decimal place, exact halves up.
export class ScrubField {
  readonly input: HTMLInputElement;
  private readonly callbacks: ScrubCallbacks;
  private dragging = false;
  private editing = false;
  private focusStart: number | null = null;
  private lastPointerX = 0;
  private pending: number | null = null;
  private wrap: HTMLElement;
  private errorNode: HTMLElement | null = null;

  constructor (name: string, callbacks: ScrubCallbacks) {
    this.callbacks = callbacks;
    this.input = el('input', { class: 'scrub', role: 'spinbutton', 'aria-label': name, 'aria-valuenow': String(callbacks.getValue()) }) as HTMLInputElement;
    this.input.readOnly = true;
    this.input.value = callbacks.getValue().toFixed(callbacks.decimals);
    this.wrap = el('div');
    this.bindEvents();
  }

  refresh (): void {
    if (this.editing) return;
    this.input.value = (this.pending ?? this.callbacks.getValue()).toFixed(this.callbacks.decimals);
    this.input.setAttribute('aria-valuenow', String(this.pending ?? this.callbacks.getValue()));
  }

  showError (message: string | null): void {
    if (this.errorNode !== null) {
      this.errorNode.remove();
      this.errorNode = null;
    }
    this.input.classList.toggle('error', message !== null);
    if (message !== null) {
      this.errorNode = el('div', { class: 'field-error', text: message });
      this.wrap.append(this.errorNode);
    }
  }

  private bindEvents (): void {
    const field = this.input;
    field.addEventListener('pointerdown', (event) => {
      if (this.editing) return;
      this.dragging = true;
      this.editing = false;
      this.lastPointerX = event.clientX;
      if (this.pending === null) this.pending = this.callbacks.getValue();
      field.classList.add('scrubbing');
      field.setPointerCapture(event.pointerId);
    });
    field.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const step = this.stepFor(event.shiftKey);
      const deltaPx = event.clientX - this.lastPointerX;
      this.lastPointerX = event.clientX;
      const next = (this.pending ?? this.callbacks.getValue()) + deltaPx * step;
      this.pending = next;
      this.updateDisplay(next);
      this.callbacks.onLive(next);
    });
    field.addEventListener('pointerup', () => {
      if (!this.dragging) return;
      this.dragging = false;
      field.classList.remove('scrubbing');
      const value = this.pending ?? this.callbacks.getValue();
      this.pending = null;
      const clamped = this.round(value);
      this.callbacks.onCommit(clamped);
      this.updateDisplay(clamped);
    });
    field.addEventListener('click', () => {
      if (this.dragging) return;
      this.beginEditing();
    });
    field.addEventListener('keydown', (event) => {
      if (this.editing) {
        if (event.key === 'Enter') {
          event.preventDefault();
          const parsed = this.parseTyped(field.value);
          this.endEditing();
          this.pending = null;
          this.callbacks.onCommit(parsed);
          this.updateDisplay(parsed);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          const revert = this.focusStart ?? this.callbacks.getValue();
          this.endEditing();
          this.pending = null;
          this.updateDisplay(revert);
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.beginEditing();
        return;
      }
      const step = this.stepFor(event.shiftKey);
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.nudge(step);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        this.nudge(-step);
      }
    });
    field.addEventListener('blur', () => {
      if (this.editing) {
        const parsed = this.parseTyped(field.value);
        this.endEditing();
        this.pending = null;
        this.callbacks.onCommit(parsed);
        this.updateDisplay(parsed);
      } else if (this.pending !== null) {
        const value = this.pending;
        this.pending = null;
        this.callbacks.onCommit(this.round(value));
      }
      this.focusStart = null;
    });
    field.addEventListener('focus', () => {
      this.focusStart = this.callbacks.onFocusGained !== undefined ? this.callbacks.onFocusGained() : this.callbacks.getValue();
    });
  }

  private stepFor (shift: boolean): number {
    if (this.callbacks.bpmField === true) return 0.1;
    return shift ? 0.01 : 0.1;
  }

  private round (value: number): number {
    if (this.callbacks.bpmField === true) {
      return Math.round(value * 10) / 10;
    }
    return value;
  }

  private nudge (delta: number): void {
    const base = this.pending ?? this.callbacks.getValue();
    const next = this.round(base + delta);
    this.pending = next;
    this.updateDisplay(next);
    this.callbacks.onLive(next);
    this.callbacks.onCommit(next);
    this.pending = null;
  }

  private parseTyped (text: string): number {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return this.focusStart ?? this.callbacks.getValue();
    if (this.callbacks.bpmField === true) {
      // One decimal place, exact half rounding up.
      return Math.round(parsed * 10) / 10;
    }
    return parsed;
  }

  private beginEditing (): void {
    this.editing = true;
    this.input.readOnly = false;
    this.input.classList.add('editing');
    this.focusStart = this.focusStart ?? this.callbacks.getValue();
    this.input.select();
  }

  private endEditing (): void {
    this.editing = false;
    this.input.readOnly = true;
    this.input.classList.remove('editing');
  }

  private updateDisplay (value: number): void {
    this.input.value = value.toFixed(this.callbacks.decimals);
    this.input.setAttribute('aria-valuenow', String(value));
  }

  attachTo (parent: HTMLElement): void {
    this.wrap.append(this.input);
    parent.append(this.wrap);
  }

  get element (): HTMLElement {
    return this.wrap;
  }
}
