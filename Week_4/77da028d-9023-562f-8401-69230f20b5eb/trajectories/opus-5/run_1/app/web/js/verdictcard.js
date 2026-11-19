import { UNSENT_PUSH } from './copy.js';
import { el, clear } from './dom.js';
import { countdown, duration, hhmm } from './format.js';

export function verdictCard() {
  return el('section', { 'aria-label': 'Tonight verdict', class: 'a-verdict' });
}

const WORDS = { go: 'Go', 'no-go': 'No-go', unknown: 'Unknown' };

export function bestUsableMinutes(plan) {
  return plan.best ? plan.best.usable_minutes : 0;
}

function owedAfterTonight(plan) {
  let total = 0;
  for (const target of plan.targets) {
    if (!target.counts) continue;
    for (const entry of target.filters) total += entry.owed_after_tonight_seconds;
  }
  return total;
}

function countdownLine(plan) {
  const window = plan.clear_window;
  if (plan.is_tonight) {
    if (!window) return 'No clear window tonight';
    if (window.starts_in_minutes > 0) {
      return `Clear window opens in ${countdown(window.starts_in_minutes)}`;
    }
    return `Clear window open until ${hhmm(window.end)}`;
  }
  if (!window) return 'No clear window';
  return `Clear window ${hhmm(window.start)}-${hhmm(window.end)}`;
}

/** Paints the one bright card from a single plan body. */
export function paintVerdict(card, plan, pushState) {
  clear(card);
  const lines = [
    el('span', { class: 'verdict-word', text: WORDS[plan.verdict] }),
    el('span', {
      class: 'verdict-line verdict-usable',
      text: `${bestUsableMinutes(plan)} usable minutes`,
    }),
  ];
  if (plan.best) {
    lines.push(
      el('span', {
        class: 'verdict-line',
        text: `Best: ${plan.best.target_name} in ${plan.best.filter}`,
      }),
    );
  }
  lines.push(
    el('span', {
      class: 'verdict-line verdict-owed',
      text: `Owed after tonight: ${duration(owedAfterTonight(plan))}`,
    }),
    el('span', {
      class: 'verdict-line muted',
      text: `Moon ${Math.round(plan.moon.illumination * 100)}% lit`,
    }),
    el('span', { class: 'verdict-line verdict-count', text: countdownLine(plan) }),
  );
  if (pushState) {
    lines.push(el('span', { class: 'verdict-line muted', text: pushState }));
  }
  card.append(...lines);
}

/** The published unsent copy when the latest push for a night is unsent. */
export function pushStateFor(pushes, observingDate) {
  if (!pushes) return null;
  const forNight = pushes.filter((push) => push.date === observingDate);
  if (!forNight.length) return null;
  return forNight[0].status === 'unsent' ? UNSENT_PUSH : null;
}
