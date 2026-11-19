// The units mode bar. It changes only what is shown, and remembers its choice on the device.

import { el, on } from '../dom.js';
import { mils } from '../../shared/measures.js';

type Units = 'microns' | 'mils';

const KEY = 'open-bonnet-units';
const listeners = new Set<() => void>();

function units(): Units {
  return localStorage.getItem(KEY) === 'mils' ? 'mils' : 'microns';
}

function setUnits(value: Units): void {
  localStorage.setItem(KEY, value);
  for (const listener of listeners) listener();
}

export function onUnitsChange(listener: () => void): void {
  listeners.add(listener);
}

/** `121 microns` or `4.8 mils`, from the server's stored whole microns. */
export function showMicrons(value: number | null): string {
  if (value === null) return '';
  return units() === 'microns' ? `${value} microns` : `${mils(value)} mils`;
}

export function unitsButton(): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'units-toggle' });
  const paint = (): void => {
    button.textContent = units();
    button.setAttribute('aria-label', `Units: ${units()}`);
  };
  paint();
  on(button, 'click', () => {
    setUnits(units() === 'microns' ? 'mils' : 'microns');
  });
  onUnitsChange(paint);
  return button;
}

export function unitsBar(): HTMLElement {
  return el('div', { class: 'units-bar' }, [
    el('span', { class: 'units-label' }, ['Units']),
    unitsButton(),
  ]);
}
