// The tonight verdict card: painted from one plan body. Never computes a verdict; it formats and ticks.
import { h } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { cardFigures, duration, UNSENT_PUSH } from './format.js';

const TICK_MS = 180;
const PUSH_RECHECK_MS = 4000;

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Counts `node` from its current number to `target` with an ease-out; the last frame is always the exact value.
function tick(node, target, { delay, format }) {
  const from = node.__value === undefined ? target : node.__value;
  node.__value = target;
  if (node.__frame) cancelAnimationFrame(node.__frame);
  if (from === target || reducedMotion() || delay === null) {
    node.textContent = format(target);
    return;
  }
  const begin = performance.now() + delay;
  const step = (now) => {
    const progress = Math.min(1, Math.max(0, (now - begin) / TICK_MS));
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = format(progress >= 1 ? target : Math.round(from + (target - from) * eased));
    node.__frame = progress < 1 ? requestAnimationFrame(step) : 0;
  };
  node.__frame = requestAnimationFrame(step);
}

// createVerdictCard() -> {element, paint(plan, {delays: {usable, owed}}), showLoading()}
// `delays` stage the ticks (milliseconds after the user action); omit them to paint at once.
export function createVerdictCard() {
  const word = h('div', { class: 'verdict-word' });
  const usable = h('span', { class: 'num', 'data-usable': '' });
  const best = h('p', { class: 'verdict-line', 'data-best': '' });
  const owed = h('span', { class: 'num', 'data-owed': '' });
  const moon = h('p', { class: 'verdict-line verdict-muted', 'data-moon': '' });
  const countdown = h('p', { class: 'verdict-line', 'data-countdown': '' });
  const push = h('p', { class: 'verdict-push', 'data-push': '', hidden: true });
  const element = h('section', { class: 'verdict-card', 'aria-label': 'Tonight verdict' },
    word,
    h('p', { class: 'verdict-usable' }, usable, h('small', {}, ' usable minutes')),
    best,
    h('p', { class: 'verdict-line' }, 'Owed after tonight: ', owed),
    moon, countdown, push);

  let pushChecked = { date: null, at: -Infinity };

  async function refreshPush(date) {
    pushChecked = { date, at: performance.now() };
    try {
      const { pushes } = await api('GET', '/api/pushes');
      const latest = pushes.find((entry) => entry.kind === 'verdict' && entry.date === date);
      push.hidden = !(latest && latest.status === 'unsent');
      push.textContent = push.hidden ? '' : UNSENT_PUSH;
    } catch {
      push.hidden = true;
    }
  }

  const card = {
    element,
    showLoading() {
      word.replaceChildren(h('span', { class: 'skeleton', style: { width: '8ch' } }));
      usable.textContent = '';
      moon.textContent = 'Reading the sky...';
    },
    paint(plan, { delays = null } = {}) {
      const figures = cardFigures(plan);
      const key = plan.verdict;
      word.replaceChildren(icon(key, 28), h('span', { 'data-verdict': '' }, figures.word));
      tick(usable, figures.usable, { delay: delays ? delays.usable : null, format: String });
      tick(owed, figures.owedAfterTonight, { delay: delays ? delays.owed : null, format: duration });
      best.hidden = figures.best === null;
      best.textContent = figures.best || '';
      moon.textContent = figures.moon;
      countdown.textContent = figures.countdown;
      if (pushChecked.date !== plan.date || performance.now() - pushChecked.at > PUSH_RECHECK_MS) refreshPush(plan.date);
    },
  };
  return card;
}
