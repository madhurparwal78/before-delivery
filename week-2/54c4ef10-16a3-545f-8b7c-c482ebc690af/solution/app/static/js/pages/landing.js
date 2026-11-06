// Landing: wordmark and links, Open archive, the two prints, the headline and the muted sentence.
import { get } from '../api.js';
import { h } from '../dom.js';
import { paintProcedural } from '../prints.js';
import { session } from '../session.js';
import { drawFrameCrop } from '../tint.js';

async function paintSignedIn(canvas) {
  const latest = session.account.latest_aligned_frame;
  if (!latest) return false;
  const scan = await get(`/api/scans/${latest.scan_id}`);
  if (!scan.ok) return false;
  try {
    await drawFrameCrop(canvas, scan.data, latest, { cover: true });
  } catch {
    return false;
  }
  return true;
}

export async function render(main) {
  const negative = h('canvas', { role: 'img', 'aria-label': 'Negative print' });
  const wedge = h('canvas', { role: 'img', 'aria-label': 'Step wedge print' });
  main.style.padding = '0';
  main.append(h('section', { class: 'hero' }, h('div', { class: 'hero-grid' },
    h('div', { class: 'large' }, negative),
    h('div', { class: 'small-print' }, wedge),
    h('h1', { class: 'headline' }, 'Every frame,', h('br'), 'back with its notes.'),
    h('p', { class: 'sentence' }, 'Density read from the negative, not guessed from the print.'))));
  paintProcedural(wedge, 'wedge');
  const drawn = session.account ? await paintSignedIn(negative) : false;
  if (!drawn) paintProcedural(negative, 'negative');
  return () => { main.style.padding = ''; };
}
