import type { MatchState } from '../../shared/wire.js';
import { createStore } from './store.js';

type Feedback = { kind: 'status' | 'alert'; text: string } | null;

/** What the sighted see of the two live regions, which are visually hidden. */
export const feedbackStore = createStore<Feedback>(null);

/** Both live regions are in the page shell, so they exist before any script runs. */
const region = (id: 'announcer' | 'alert'): HTMLElement => document.getElementById(id) as HTMLElement;

/** An announcement replaces the region's text; the same sentence twice empties it first and sets it on the next frame. */
const write = (target: HTMLElement, text: string): void => {
  if (target.textContent === text && text !== '') {
    target.textContent = '';
    requestAnimationFrame(() => { target.textContent = text; });
  } else {
    target.textContent = text;
  }
};

export const announce = (text: string): void => {
  write(region('announcer'), text);
  feedbackStore.set({ kind: 'status', text });
};

export const raise = (text: string): void => {
  write(region('alert'), text);
  feedbackStore.set({ kind: 'alert', text });
};

/** `<line>. <team> <runs>/<wickets>.`, then the over end, the innings break or the result when the delivery brought one. */
export const deliveryAnnouncement = (state: MatchState): string => {
  const newest = state.commentary.find((item) => item.kind !== 'over-end');
  const overEnd = state.commentary[0];
  const parts = [`${newest?.line ?? ''}. ${state.batting_team.name} ${state.runs}/${state.wickets}.`];
  if (overEnd?.kind === 'over-end') parts.push(overEnd.line.slice(0, overEnd.line.indexOf('. ') + 1));
  if (state.innings_break) parts.push(state.innings_break.text);
  else if (state.result) parts.push(`${state.result}.`);
  return parts.join(' ');
};
