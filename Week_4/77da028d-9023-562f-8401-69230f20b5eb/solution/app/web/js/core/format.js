// Formatting only: every figure arrives from the server.
export function duration(seconds) {
  if (seconds < 0) return `Over by ${duration(-seconds)}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function longDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const parts = Object.fromEntries(LONG_DATE.formatToParts(new Date(Date.UTC(year, month - 1, day))).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

export function hhmm(isoLocal) {
  return isoLocal.slice(11, 16);
}

export function oneDecimal(value) {
  return Number(value).toFixed(1);
}

export function stateWord(state) {
  return state[0].toUpperCase() + state.slice(1);
}

export const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'];

export const VERDICT_WORDS = { go: 'Go', 'no-go': 'No-go', unknown: 'Unknown' };

export const POSITION_TEXT = {
  clear: 'Clear',
  'behind-treeline': 'Behind the treeline',
  'below-minimum': 'Below minimum altitude',
  'below-horizon': 'Below the horizon',
};

export const UNSENT_PUSH = 'Push not sent yet. Darkframe will retry.';

// The verdict card's figures, from one plan body (Business rules: Card figures and countdown refresh).
export function cardFigures(plan) {
  const owedAfterTonight = plan.targets
    .filter((target) => target.counts)
    .flatMap((target) => target.filters)
    .reduce((sum, row) => sum + row.owed_after_tonight_seconds, 0);
  const window = plan.clear_window;
  let countdown;
  if (plan.is_tonight) {
    if (window === null) countdown = 'No clear window tonight';
    else if (window.starts_in_minutes > 0) {
      const minutes = window.starts_in_minutes;
      countdown = `Clear window opens in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
    } else countdown = `Clear window open until ${hhmm(window.end)}`;
  } else countdown = window === null ? 'No clear window' : `Clear window ${hhmm(window.start)}-${hhmm(window.end)}`;
  return {
    word: VERDICT_WORDS[plan.verdict],
    usable: plan.best ? plan.best.usable_minutes : 0,
    best: plan.best ? `Best: ${plan.best.target_name} in ${plan.best.filter}` : null,
    owedAfterTonight,
    moon: `Moon ${Math.round(plan.moon.illumination * 100)}% lit`,
    countdown,
  };
}

export function staleWarning(maxAgeDays) {
  return `Warning: this set is older than ${maxAgeDays} days. It still calibrates, but consider a fresh library.`;
}
