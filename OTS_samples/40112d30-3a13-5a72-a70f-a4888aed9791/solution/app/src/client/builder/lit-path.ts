import { h } from '../lib/dom.ts';
import type { Context } from './context.ts';
import { pageMap } from './page-map.ts';
import { trialControls } from './trial-controls.ts';
import { trialValues } from './trial-values.ts';

// The Lit path: trial answers, the page map the server's evaluation lights, and the calculated values it worked out.

export function litPath(context: Context): HTMLElement {
  const { trial } = context;
  const map = pageMap();
  const values = trialValues();
  const show = (): void => {
    if (!trial.evaluation) return;
    map.show(trial.evaluation);
    values.show(trial.evaluation);
  };
  trial.evaluated.listen(show);
  show();
  return h('section', { class: 'lit-path' }, h('h3', {}, 'Lit path'), trialControls(context), map.element, values.element);
}
