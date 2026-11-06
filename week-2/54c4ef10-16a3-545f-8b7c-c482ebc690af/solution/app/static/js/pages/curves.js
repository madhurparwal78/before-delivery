// Curves: one section per test roll you own with the plotted curve and its figures.
import { get } from '../api.js';
import { h } from '../dom.js';
import { CURVE_READY } from '../domain.js';
import { curveFigures, plotCurve } from '../curve.js';
import { paintProcedural } from '../prints.js';

export async function render(main) {
  const rolls = (await get('/api/rolls')).data.rolls.filter((roll) => roll.kind === 'test');
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Curves')));
  if (!rolls.length) {
    const blank = h('canvas', { 'aria-hidden': 'true', class: 'blank-frame' });
    main.append(h('div', { class: 'empty' }, blank, h('p', {}, 'No test rolls yet.')));
    paintProcedural(blank, 'blank');
    return;
  }
  const curves = await Promise.all(rolls.map((roll) => get(`/api/rolls/${roll.id}/curve`)));
  rolls.forEach((roll, index) => {
    const curve = curves[index].data;
    const panel = h('div', { class: 'curve-panel' });
    if (curve.ready) {
      panel.append(plotCurve(curve).svg, curveFigures(curve));
    } else {
      panel.append(h('p', {}, `Needs at least ${CURVE_READY.frames} aligned bracket frames spanning ${CURVE_READY.span} stops (now ${curve.frames_used} frames, ${curve.stops_span.toFixed(1)} stops).`));
    }
    main.append(h('section', { 'aria-label': `Curve for ${roll.name}`, class: 'section' },
      h('h2', {}, h('a', { href: `/rolls/${roll.id}` }, roll.name)), panel));
  });
}
