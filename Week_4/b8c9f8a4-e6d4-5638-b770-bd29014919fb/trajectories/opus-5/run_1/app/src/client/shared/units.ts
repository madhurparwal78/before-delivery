import { formatGauge } from '../../shared/format';
import { el, onPress } from './dom';

export type UnitsMode = 'microns' | 'mils';

const KEY = 'open-bonnet:units';
const listeners = new Set<(mode: UnitsMode) => void>();

export const unitsMode = (): UnitsMode => (window.localStorage.getItem(KEY) === 'mils' ? 'mils' : 'microns');

/** The toggle changes only what is displayed, and remembers its choice on the device. */
export const setUnitsMode = (mode: UnitsMode): void => {
  window.localStorage.setItem(KEY, mode);
  for (const listener of listeners) listener(mode);
};

export const onUnitsChange = (listener: (mode: UnitsMode) => void): void => {
  listeners.add(listener);
};

export const gaugeText = (microns: number | null, mils: string | null): string =>
  formatGauge(microns, mils, unitsMode());

/** `button "Units: microns"` or `button "Units: mils"`: the name shows the current unit. */
export const unitsToggle = (): HTMLButtonElement => {
  const button = el('button', { type: 'button', class: 'units-toggle' });
  const paint = (): void => {
    const mode = unitsMode();
    button.textContent = `Units: ${mode}`;
    button.setAttribute('aria-label', `Units: ${mode}`);
  };
  paint();
  onUnitsChange(paint);
  onPress(button, () => {
    setUnitsMode(unitsMode() === 'microns' ? 'mils' : 'microns');
  });
  return button;
};

/** The units mode bar: a thin strip at the very top at 768 pixels and above. */
export const unitsBar = (): HTMLElement =>
  el('div', { class: 'units-bar' }, [
    el('div', { class: 'units-bar-inner' }, [el('span', { class: 'units-bar-label', text: 'Units' }), unitsToggle()]),
  ]);
