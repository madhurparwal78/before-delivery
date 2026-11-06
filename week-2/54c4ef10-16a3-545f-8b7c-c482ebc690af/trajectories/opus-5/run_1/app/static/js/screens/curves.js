// Curves: one section per test roll you own.
import * as api from '../api.js';
import { el } from '../dom.js';
import { curveCanvas, drawCurve, figureList, notReadySentence } from '../components/curve.js';
import { blankFramePrint } from './notfound.js';

export async function render() {
  const { rolls } = await api.get('/api/rolls');
  const testRolls = rolls.filter((roll) => roll.kind === 'test');
  const section = el('section', { class: 'curves' }, [el('h1', { text: 'Curves' })]);
  if (testRolls.length === 0) {
    section.append(el('div', { class: 'empty-state' }, [
      blankFramePrint(),
      el('p', { class: 'muted', text: 'No test rolls yet.' }),
    ]));
    return section;
  }
  for (const roll of testRolls) {
    const curve = await api.get(`/api/rolls/${roll.id}/curve`);
    const region = el('section', {
      role: 'region',
      'aria-label': `Curve for ${roll.name}`,
      class: 'curve-region surface',
    }, [el('h2', { text: roll.name })]);
    if (curve.ready) {
      const canvas = curveCanvas(`Curve for ${roll.name} plot`);
      drawCurve(canvas, curve);
      region.append(canvas, figureList(curve));
    } else {
      region.append(el('p', { class: 'muted', text: notReadySentence(curve) }));
    }
    section.append(region);
  }
  return section;
}
