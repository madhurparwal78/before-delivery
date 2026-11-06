// Archive: one print per roll, newest first, in uneven arrangements chosen from one fixed set.
import { get } from '../api.js';
import { announce, h } from '../dom.js';
import { paintProcedural } from '../prints.js';
import { PreviewUnavailable, drawFrameCrop } from '../tint.js';

// (start column, column span, vertical drop in px); neighbours in this cycle always differ.
const ARRANGEMENTS = [[1, 4, 0], [6, 5, 120], [3, 3, 200], [8, 4, 0], [2, 5, 120], [7, 3, 0], [4, 4, 200], [9, 4, 120]];
const PHONE_WIDTHS = [['100%', 'auto'], ['72%', '0 auto 0 0'], ['60%', '0 0 0 auto']];
export const STATE_WORDS = { logging: 'Logging', developed: 'Developed', aligned: 'Aligned', 'curve-ready': 'Curve-ready' };

export function counters(roll) {
  const c = roll.counters;
  return h('div', { class: 'counters' }, h('span', {}, `Detected ${c.detected}`), h('span', {}, `Aligned ${c.aligned}`),
    h('span', {}, `Unexposed ${c.unexposed}`), h('span', {}, `Unmatched notes ${c.unmatched_notes}`));
}

async function paintPrint(canvas, roll) {
  if (roll.strongest_frame_id) {
    const frame = await get(`/api/frames/${roll.strongest_frame_id}`);
    const scan = await get(`/api/scans/${frame.data.frame.scan_id}`);
    try {
      await drawFrameCrop(canvas, scan.data, frame.data.frame);
      return;
    } catch (error) {
      if (!(error instanceof PreviewUnavailable)) throw error;
    }
  }
  canvas.style.aspectRatio = '4 / 3';
  paintProcedural(canvas, 'blank');
}

function placement(index) {
  const [start, span, drop] = ARRANGEMENTS[index % ARRANGEMENTS.length];
  const textLeft = start - 1 >= 3;
  return {
    print: { gridColumn: `${start} / span ${span}`, gridRow: 1, marginTop: `${drop}px` },
    info: { gridColumn: textLeft ? `${start - 3} / span 3` : `${start + span} / span 3`, gridRow: 1, marginTop: `${drop}px`,
      textAlign: textLeft ? 'right' : 'left' },
  };
}

export async function render(main) {
  const [rolls] = await Promise.all([get('/api/rolls')]);
  const list = rolls.data.rolls;
  const scans = await Promise.all(list.map((roll) => get(`/api/rolls/${roll.id}/scans`)));
  const phone = window.matchMedia('(max-width: 599px)').matches;
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Archive'), h('a', { class: 'button primary', href: '/rolls/new' }, 'New roll')));
  if (!list.length) {
    const blank = h('canvas', { 'aria-hidden': 'true', class: 'blank-frame' });
    main.append(h('div', { class: 'empty' }, blank, h('p', {}, 'Your archive is empty. Start a roll before you shoot.')));
    paintProcedural(blank, 'blank');
    return;
  }
  const rows = list.map((roll, index) => {
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const place = placement(index);
    const [width, margin] = PHONE_WIDTHS[index % PHONE_WIDTHS.length];
    const noScans = scans[index].data.scans.length === 0;
    const info = h('div', { class: 'info' },
      h('p', {}, h('a', { href: `/rolls/${roll.id}` }, roll.name)),
      h('p', { class: 'muted' }, `${roll.stock} · EI ${roll.ei}`),
      h('p', { class: 'state-word' }, STATE_WORDS[roll.state]),
      counters(roll),
      noScans ? h('p', { class: 'muted' }, 'No strips yet.') : null);
    const print = h('div', { class: 'print' }, canvas);
    if (phone) {
      print.style.width = width;
      print.style.margin = margin;
      info.style.margin = '12px 0 0';
    } else {
      Object.assign(print.style, place.print);
      Object.assign(info.style, place.info);
    }
    return { item: h('li', {}, print, info), canvas, roll };
  });
  main.append(h('ul', { class: 'archive-list', role: 'list', 'aria-label': 'Rolls' }, rows.map((row) => row.item)));
  await Promise.all(rows.map((row) => paintPrint(row.canvas, row.roll)));
}
