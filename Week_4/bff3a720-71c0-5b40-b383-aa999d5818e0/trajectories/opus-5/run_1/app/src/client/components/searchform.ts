import { announce } from '../announce.js';
import { h } from '../dom.js';
import { CITIES } from '../../shared/cities.js';
import { runMotion } from '../motion.js';
import { combobox } from './combobox.js';
import { dateField } from './datepicker.js';
import { seatEndMessage, stepper } from './stepper.js';

export interface SearchFormState {
  from: string;
  to: string;
  date: string;
  seats: number;
}

export interface SearchFormOptions {
  initial: SearchFormState;
  /** The results page re-runs the search on every change; Home has a Search button. */
  withSearchButton: boolean;
  onChange?: (state: SearchFormState) => void;
  onSubmit?: (state: SearchFormState) => void;
}

export interface SearchFormHandle {
  element: HTMLElement;
  state(): SearchFormState;
}

export function searchForm(options: SearchFormOptions): SearchFormHandle {
  const state: SearchFormState = { ...options.initial };
  const changed = () => options.onChange?.({ ...state });

  const from = combobox({
    label: 'Leaving from',
    value: state.from,
    choices: () => CITIES.filter((city) => city !== state.to),
    onSelect: (city) => {
      state.from = city;
      changed();
    },
  });
  const to = combobox({
    label: 'Going to',
    value: state.to,
    choices: () => CITIES.filter((city) => city !== state.from),
    onSelect: (city) => {
      state.to = city;
      changed();
    },
  });

  const swap = h('button', {
    type: 'button',
    class: 'swap',
    text: 'Swap cities',
    'aria-label': 'Swap cities',
  });
  swap.addEventListener('click', () => {
    const previousFrom = state.from;
    state.from = state.to;
    state.to = previousFrom;
    from.setValue(state.from);
    to.setValue(state.to);
    runMotion(swap, 'swap-rotate');
    announce(`Leaving from ${state.from}, going to ${state.to}`);
    changed();
  });

  const date = dateField(state.date, (key) => {
    state.date = key;
    changed();
  });

  const seats = stepper({
    label: 'Seats',
    min: 1,
    max: 4,
    step: 1,
    pageStep: 2,
    value: state.seats,
    endMessage: seatEndMessage,
    onChange: (value) => {
      state.seats = value;
      changed();
    },
  });

  const element = h(
    'div',
    { role: 'search', 'aria-label': 'Find a ride', class: 'search-form' },
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Leaving from' }), from.element),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Going to' }), to.element),
    h('div', { class: 'field-box swap-box' }, swap),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Date' }), date.button),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Seats' }), seats.element),
    options.withSearchButton
      ? h('div', { class: 'field-box' },
          h('button', {
            type: 'button',
            class: 'action',
            text: 'Search',
            onclick: () => options.onSubmit?.({ ...state }),
          }),
        )
      : null,
  );

  return { element, state: () => ({ ...state }) };
}
