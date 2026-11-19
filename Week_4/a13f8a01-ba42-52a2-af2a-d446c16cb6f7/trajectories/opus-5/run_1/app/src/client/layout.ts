import { h, replace } from './dom';

export type Band = 'wide' | 'medium' | 'narrow';

const WIDE = '(min-width: 1024px)';
const MEDIUM = '(min-width: 768px)';

export const band = (): Band => {
  if (window.matchMedia(WIDE).matches) return 'wide';
  return window.matchMedia(MEDIUM).matches ? 'medium' : 'narrow';
};

/** The two breakpoints are the only things that change a working screen's arrangement. */
export const onBandChange = (run: (value: Band) => void): void => {
  let last = band();
  const check = (): void => {
    const next = band();
    if (next !== last) {
      last = next;
      run(next);
    }
  };
  window.matchMedia(WIDE).addEventListener('change', check);
  window.matchMedia(MEDIUM).addEventListener('change', check);
};

export interface Split {
  root: HTMLElement;
  stage: HTMLElement;
  column: HTMLElement;
}

export const splitPage = (header: HTMLElement, stageClass = ''): Split => {
  const stage = h('div', { class: `stage ${stageClass}` });
  const column = h('div', { class: 'column' });
  const root = h('div', { class: 'shell' }, [
    header,
    h('div', { class: 'split' }, [h('div', { class: 'stage-wrap' }, [stage]), column]),
  ]);
  return { root, stage, column };
};

export const mountPage = (root: HTMLElement): void => {
  const app = document.getElementById('app')!;
  replace(app, [root]);
};
