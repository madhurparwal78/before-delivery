import { api, type Cohort } from '../api.js';
import { COPY, dollars, nightsLine, phaseLabel, seatsCopy } from '../copy.js';
import { h } from '../dom.js';
import { navigate } from '../main.js';

function cohortCard(cohort: Cohort): HTMLElement {
  const full = cohort.seats_left <= 0;
  const enroll = h('button', {
    type: 'button',
    class: 'primary',
    'aria-label': `Enroll in ${cohort.name}`,
    text: COPY.enroll,
    disabled: full,
  });
  enroll.addEventListener('click', () => {
    navigate(`/enroll/${cohort.id}`);
  });
  return h('article', { class: 'card', 'aria-label': cohort.name }, [
    h('h2', { class: 'card-name', text: cohort.name }),
    h('p', { class: 'muted', text: cohort.coach_name }),
    h('p', { class: 'muted', text: phaseLabel(cohort.phase, cohort.week) }),
    h('p', { text: nightsLine(cohort.starts_on) }),
    h('p', { class: 'price', text: dollars(cohort.price_cents) }),
    h('p', { class: 'seats', text: seatsCopy(cohort.seats_left) }),
    enroll,
  ]);
}

export function cohortsScreen(): Node {
  const list = h('div', { class: 'cohort-grid' });
  const screen = h('section', { class: 'screen cohorts' }, [
    h('h1', { text: COPY.openCohorts }),
    list,
  ]);
  void (async () => {
    const result = await api.cohorts();
    if (result.body === null) return;
    for (const cohort of result.body.cohorts) list.append(cohortCard(cohort));
  })();
  return screen;
}
