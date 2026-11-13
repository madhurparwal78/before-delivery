import { ManifestEntry } from './api';
import { apply, el, find, on } from './dom';
import {
  ParameterValue,
  Unit,
  Values,
  clampValue,
  derivedText,
  fieldText,
  isModified,
  shownNumber,
  shownPrecision,
  stepValue,
  stepsFor,
  typedToMillimetres,
  unitMark,
  valueOf,
  valueText,
  wasMarker,
} from './values';
import { matchesNumberGrammar, roundTo } from '../shared/numbers';

export type Commit = (name: string, value: ParameterValue) => void;

type Control = {
  entry: ManifestEntry;
  row: HTMLElement;
  input?: HTMLElement;
  refresh: () => void;
  focusTarget: () => HTMLElement;
};

export class ParameterControls {
  private readonly controls: Control[] = [];

  constructor(
    private readonly manifest: ManifestEntry[],
    private readonly values: Values,
    private unit: Unit,
    private readonly commit: Commit,
  ) {}

  setUnit(unit: Unit): void {
    this.unit = unit;
    this.refresh();
  }

  refresh(): void {
    for (const control of this.controls) control.refresh();
  }

  focusParameter(name: string): void {
    const control = this.controls.find((candidate) => candidate.entry.name === name);
    control?.focusTarget().focus();
  }

  /** Builds every control of one group, in declaration order. */
  build(entries: ManifestEntry[]): HTMLElement[] {
    return entries.map((entry) => this.control(entry));
  }

  private control(entry: ManifestEntry): HTMLElement {
    if (entry.derived) return this.derived(entry);
    if (entry.kind === 'boolean') return this.boolean(entry);
    if (entry.kind === 'enum') return this.enumeration(entry);
    return this.spin(entry);
  }

  private register(control: Control): HTMLElement {
    this.controls.push(control);
    control.refresh();
    return control.row;
  }

  private derived(entry: ManifestEntry): HTMLElement {
    const text = el('p', { class: 'derived-value', 'data-parameter': entry.name });
    const row = el('div', { class: 'rail-row rail-row-derived' }, [text]);
    return this.register({
      entry,
      row,
      refresh: () => {
        text.textContent = derivedText(entry, valueOf(entry, this.values));
      },
      focusTarget: () => text,
    });
  }

  private markers(entry: ManifestEntry, row: HTMLElement): void {
    const modified = isModified(entry, this.values);
    row.classList.toggle('is-modified', modified);
    const existing = find('[data-ui="was-marker"]', row);
    if (modified) {
      const text = wasMarker(entry);
      if (existing) existing.textContent = text;
      else row.append(el('p', { 'data-ui': 'was-marker', class: 'was-marker' }, [text]));
    } else {
      existing?.remove();
    }
  }

  private spin(entry: ManifestEntry): HTMLElement {
    const input = el('input', {
      type: 'text',
      inputmode: 'decimal',
      role: 'spinbutton',
      'aria-label': entry.label,
      class: 'spin-input',
      autocomplete: 'off',
      'data-parameter': entry.name,
    });
    const unitMarkNode = el('span', { class: 'field-unit', 'aria-hidden': 'true' });
    const scrub = el(
      'button',
      { type: 'button', class: 'scrub-handle', 'aria-label': `Scrub ${entry.label}` },
      ['⇔'],
    );
    const field = el('div', { class: 'spin-field' }, [input, unitMarkNode]);
    const row = el('div', { class: 'rail-row' }, [
      el('div', { class: 'rail-row-head' }, [
        el('span', { class: 'rail-label' }, [entry.label]),
        scrub,
      ]),
      field,
    ]);

    const current = (): number => Number(valueOf(entry, this.values));

    const refresh = (): void => {
      const value = current();
      input.value = fieldText(entry, value, this.unit);
      const attributes: Record<string, string | null> = {
        'aria-valuenow': String(roundTo(shownNumber(entry, value, this.unit), 6)),
        'aria-valuetext': valueText(entry, value, this.unit),
        'aria-invalid': null,
      };
      if (entry.min !== undefined) {
        attributes['aria-valuemin'] = String(roundTo(shownNumber(entry, entry.min, this.unit), 6));
      }
      if (entry.max !== undefined) {
        attributes['aria-valuemax'] = String(roundTo(shownNumber(entry, entry.max, this.unit), 6));
      }
      apply(input, attributes);
      unitMarkNode.textContent = unitMark(entry, this.unit);
      this.markers(entry, row);
      const error = find('[data-ui="field-error"]', row);
      error?.remove();
    };

    const refuse = (message: string): void => {
      input.setAttribute('aria-invalid', 'true');
      const existing = find('[data-ui="field-error"]', row);
      existing?.remove();
      row.append(el('p', { 'data-ui': 'field-error', class: 'field-error' }, [message]));
    };

    const commitTyped = (): void => {
      const typed = input.value.trim();
      if (typed === fieldText(entry, current(), this.unit)) {
        refresh();
        return;
      }
      if (!matchesNumberGrammar(typed)) {
        refuse(`${entry.label} takes a plain decimal such as 12.5.`);
        return;
      }
      const asNumber = Number(typed);
      if (entry.kind === 'count' && !Number.isInteger(asNumber)) {
        refuse('Enter a whole number.');
        return;
      }
      const millimetres = typedToMillimetres(entry, asNumber, this.unit);
      this.commit(entry.name, clampValue(entry, millimetres));
    };

    on(input, 'keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.isComposing) return;
      if (keyboard.key === 'Enter') {
        keyboard.preventDefault();
        commitTyped();
        return;
      }
      const modifiers = {
        fine: keyboard.ctrlKey || keyboard.metaKey,
        coarse: keyboard.shiftKey,
      };
      let direction = 0;
      let page = false;
      switch (keyboard.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          direction = 1;
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          direction = -1;
          break;
        case 'PageUp':
          direction = 1;
          page = true;
          break;
        case 'PageDown':
          direction = -1;
          page = true;
          break;
        default:
          return;
      }
      keyboard.preventDefault();
      const chosen = page ? { steps: 10, fine: 1 } : stepsFor(entry, modifiers);
      this.commit(entry.name, stepValue(entry, current(), direction * chosen.steps, chosen.fine));
    });

    on(input, 'blur', () => commitTyped());

    this.wireScrub(entry, scrub, input, current);

    return this.register({ entry, row, input, refresh, focusTarget: () => input });
  }

  /** Each 4 pixels of sideways movement is one step; one commit happens on release. */
  private wireScrub(
    entry: ManifestEntry,
    handle: HTMLElement,
    input: HTMLInputElement,
    current: () => number,
  ): void {
    let startValue = 0;
    let startX = 0;
    let moving = false;
    let latest = 0;

    const finish = (commit: boolean): void => {
      if (!moving) return;
      moving = false;
      window.removeEventListener('keydown', onKey, true);
      if (commit) this.commit(entry.name, latest);
      else this.commit(entry.name, startValue);
    };

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    }

    on(handle, 'pointerdown', (event) => {
      const pointer = event as unknown as PointerEvent;
      pointer.preventDefault();
      moving = true;
      startValue = current();
      latest = startValue;
      startX = pointer.clientX;
      handle.setPointerCapture(pointer.pointerId);
      window.addEventListener('keydown', onKey, true);
    });
    on(handle, 'pointermove', (event) => {
      if (!moving) return;
      const pointer = event as unknown as PointerEvent;
      const steps = Math.trunc((pointer.clientX - startX) / 4);
      const chosen = stepsFor(entry, { fine: pointer.ctrlKey || pointer.metaKey, coarse: pointer.shiftKey });
      latest = stepValue(entry, startValue, steps * chosen.steps, chosen.fine);
      input.value = fieldText(entry, latest, this.unit);
      input.setAttribute('aria-valuetext', valueText(entry, latest, this.unit));
    });
    on(handle, 'pointerup', () => finish(true));
    on(handle, 'pointercancel', () => finish(false));
  }

  private boolean(entry: ManifestEntry): HTMLElement {
    const button = el(
      'button',
      { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': entry.label, class: 'switch' },
      [entry.label],
    );
    const row = el('div', { class: 'rail-row' }, [button]);
    on(button, 'click', () => this.commit(entry.name, valueOf(entry, this.values) !== true));
    return this.register({
      entry,
      row,
      input: button,
      refresh: () => {
        button.setAttribute('aria-checked', valueOf(entry, this.values) === true ? 'true' : 'false');
        this.markers(entry, row);
      },
      focusTarget: () => button,
    });
  }

  private enumeration(entry: ManifestEntry): HTMLElement {
    const options = entry.options ?? [];
    if (options.length <= 3) {
      const group = el('div', { role: 'radiogroup', 'aria-label': entry.label, class: 'radio-row' });
      const buttons = options.map((option) => {
        const button = el(
          'button',
          { type: 'button', role: 'radio', 'aria-checked': 'false', class: 'radio-option' },
          [option],
        );
        on(button, 'click', () => this.commit(entry.name, option));
        on(button, 'keydown', (event) => {
          const keyboard = event as KeyboardEvent;
          const index = options.indexOf(option);
          if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowDown') {
            keyboard.preventDefault();
            this.commit(entry.name, options[(index + 1) % options.length]);
            this.focusParameter(entry.name);
          } else if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowUp') {
            keyboard.preventDefault();
            this.commit(entry.name, options[(index - 1 + options.length) % options.length]);
            this.focusParameter(entry.name);
          }
        });
        group.append(button);
        return button;
      });
      const row = el('div', { class: 'rail-row' }, [
        el('span', { class: 'rail-label' }, [entry.label]),
        group,
      ]);
      return this.register({
        entry,
        row,
        refresh: () => {
          const value = valueOf(entry, this.values);
          buttons.forEach((button, index) => {
            const chosen = options[index] === value;
            button.setAttribute('aria-checked', chosen ? 'true' : 'false');
            button.setAttribute('tabindex', chosen ? '0' : '-1');
          });
          if (!buttons.some((button) => button.getAttribute('tabindex') === '0')) {
            buttons[0]?.setAttribute('tabindex', '0');
          }
          this.markers(entry, row);
        },
        focusTarget: () =>
          buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0],
      });
    }
    const select = el('select', { 'aria-label': entry.label, class: 'enum-select' });
    for (const option of options) select.append(el('option', { value: option }, [option]));
    on(select, 'change', () => this.commit(entry.name, select.value));
    const row = el('div', { class: 'rail-row' }, [
      el('span', { class: 'rail-label' }, [entry.label]),
      select,
    ]);
    return this.register({
      entry,
      row,
      input: select,
      refresh: () => {
        select.value = String(valueOf(entry, this.values));
        this.markers(entry, row);
      },
      focusTarget: () => select,
    });
  }

  entries(): ManifestEntry[] {
    return this.manifest;
  }
}
