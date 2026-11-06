import { clamp, formatCount, two } from './dom.js';
import { CITY_WINDOWS } from './scenes/city.js';

/** The story clock: 21:00 at the top of the page, 22:00 only at the very bottom. */
export function storyClockText(fraction: number): string {
  const minutes = Math.floor(clamp(fraction, 0, 1) * 60);
  return minutes >= 60 ? '22:00' : `21:${two(minutes)}`;
}

/** The window counter: 4,096 until 0.18 of the city, 1 from 0.82, straight in between. */
export function litWindows(progress: number): number {
  if (progress <= 0.18) return CITY_WINDOWS;
  if (progress >= 0.82) return 1;
  return Math.round(CITY_WINDOWS - (CITY_WINDOWS - 1) * ((progress - 0.18) / 0.64));
}

export const windowsText = (count: number): string =>
  count === 1 ? '1 window lit' : `${formatCount(count)} windows lit`;

export function cityCaption(progress: number): string {
  if (progress < 0.4) return 'The offices close.';
  if (progress < 0.82) return 'The kitchens go quiet.';
  return 'One window left.';
}

/** The brightness dial: 100% before the dial arrives, 5% once it has passed. */
export const brightnessValue = (pass: number): number => Math.round(100 - 95 * clamp(pass, 0, 1));

const DIAL_CIRCUMFERENCE = 2 * Math.PI * 84;

export function paintDial(dial: HTMLElement, value: HTMLElement, sweep: SVGCircleElement, level: number): void {
  dial.setAttribute('aria-valuenow', String(level));
  value.textContent = `${level}%`;
  sweep.style.strokeDasharray = String(DIAL_CIRCUMFERENCE);
  sweep.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - level / 100));
  dial.style.setProperty('--dial-glow', `${Math.round(3 + (level / 100) * 24)}px`);
}
