// The archive index: one print per roll, newest first, in uneven arrangements.
import * as api from '../api.js';
import { COPY } from '../boot.js';
import { el } from '../dom.js';
import { StripPreview } from '../strip.js';
import { counterList, stateWord } from '../components/counters.js';
import { blankFramePrint } from './notfound.js';

// One fixed set of spans and drops; neighbours never share an arrangement.
const ARRANGEMENTS = [
  { start: 1, span: 5, drop: 0 },
  { start: 7, span: 4, drop: 200 },
  { start: 2, span: 4, drop: 120 },
  { start: 8, span: 5, drop: 0 },
  { start: 4, span: 3, drop: 200 },
  { start: 1, span: 4, drop: 120 },
];

const PHONE_ARRANGEMENTS = ['phone-full', 'phone-left', 'phone-right'];

async function rollPrint(roll) {
  const canvas = el('canvas', {
    width: 400,
    height: 500,
    role: 'img',
    'aria-label': `Strongest frame of ${roll.name}`,
    class: 'print',
  });
  const scans = await api.get(`/api/rolls/${roll.id}/scans`);
  if (!roll.strongest_frame_id) {
    return { node: blankFramePrint(240, 160), sentence: scans.scans.length === 0 };
  }
  const { frame } = await api.get(`/api/frames/${roll.strongest_frame_id}`);
  const scan = scans.scans.find((item) => item.id === frame.scan_id);
  const preview = new StripPreview(scan);
  if (!(await preview.load())) {
    return { node: blankFramePrint(240, 160), sentence: false, unavailable: true };
  }
  canvas.height = Math.max(
    1,
    Math.round((canvas.width * scan.height) / (frame.x1 - frame.x0)),
  );
  preview.drawCrop(canvas, frame.x0, frame.x1);
  return { node: canvas, sentence: false };
}

export async function render() {
  const { rolls } = await api.get('/api/rolls');
  const list = el('ul', { class: 'rolls', role: 'list', 'aria-label': 'Rolls' });
  const section = el('section', { class: 'archive' }, [
    el('div', { class: 'archive-head' }, [
      el('h1', { text: 'Archive' }),
      el('a', { href: '/rolls/new', class: 'solid', text: 'New roll' }),
    ]),
    rolls.length === 0
      ? el('div', { class: 'empty-state' }, [
        blankFramePrint(),
        el('p', { class: 'muted', text: COPY.empty.archive }),
      ])
      : list,
  ]);

  rolls.forEach((roll, index) => {
    const arrangement = ARRANGEMENTS[index % ARRANGEMENTS.length];
    const item = el('li', {
      class: `roll-print ${PHONE_ARRANGEMENTS[index % 3]}`,
      style: `--start:${arrangement.start}; --span:${arrangement.span}; --drop:${arrangement.drop}px`,
      dataset: {
        start: String(arrangement.start),
        span: String(arrangement.span),
        drop: String(arrangement.drop),
      },
    });
    const printHost = el('div', { class: 'print-host' }, [blankFramePrint(240, 160)]);
    const caption = el('div', { class: 'print-caption' }, [
      el('a', { href: `/rolls/${roll.id}`, text: roll.name }),
      el('p', { class: 'muted', text: `${roll.stock} · EI ${roll.ei}` }),
      el('p', { class: 'state', text: stateWord(roll.state) }),
      counterList(roll.counters),
    ]);
    item.append(printHost, caption);
    list.append(item);
    rollPrint(roll)
      .then(({ node, sentence, unavailable }) => {
        printHost.replaceChildren(node);
        if (sentence) {
          caption.prepend(el('p', { class: 'muted', text: COPY.empty.no_strips }));
        }
        if (unavailable) {
          caption.prepend(el('p', { class: 'muted', text: COPY.empty.preview_unavailable }));
        }
      })
      .catch(() => {});
  });

  return section;
}
