import { escapeHtml } from '../shared/escape';
import { interviewFilterAnnouncement } from '../shared/messages';
import type { InterviewCategory, InterviewSummary } from '../shared/types';
import { portraitSvg } from './art';
import { all, announce, fillWith, need } from './dom';

const FILTERS: Record<string, InterviewCategory | 'all'> = {
  all: 'all',
  experts: 'expert',
  everyday: 'everyday',
};

const CATEGORY_LABELS: Record<InterviewCategory, string> = {
  expert: 'Expert',
  everyday: 'Everyday',
};

function card(interview: InterviewSummary): string {
  return `<li><article class="interview-card">
<div class="interview-card__portrait">${portraitSvg(interview.hue)}</div>
<h3 class="interview-card__name">${escapeHtml(interview.name)}</h3>
<p class="interview-card__role">${escapeHtml(interview.role)}</p>
<p class="interview-card__label">${CATEGORY_LABELS[interview.category]}</p>
<p class="interview-card__lede">${escapeHtml(interview.lede)}</p>
<p><a href="/interviews/${escapeHtml(interview.slug)}">Read the interview with ${escapeHtml(interview.name)}</a></p>
</article></li>`;
}

/** The interview list, filtered by category and kept in published order. */
export function renderInterviews(interviews: InterviewSummary[]): void {
  const list = need<HTMLElement>('[data-interviews]');
  const show = (filter: string, shouldAnnounce: boolean): void => {
    const wanted = FILTERS[filter] ?? 'all';
    const shown = interviews.filter(
      (interview) => wanted === 'all' || interview.category === wanted,
    );
    fillWith(list, shown.map(card).join(''));
    if (shouldAnnounce) {
      announce(interviewFilterAnnouncement(shown.length));
    }
  };

  for (const radio of all<HTMLInputElement>('[data-interview-filter]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        show(radio.value, true);
      }
    });
  }
  show('all', false);
}
