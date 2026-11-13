import { escapeHtml } from '../shared/escape';
import type { InterviewResponse } from '../shared/types';
import { fetchInterview } from './api';
import { portraitSvg } from './art';
import { fillWith, find, need } from './dom';

function neighbourLinks(interview: InterviewResponse): string {
  const links: string[] = [];
  if (interview.previous !== null) {
    links.push(
      `<li><a href="/interviews/${escapeHtml(interview.previous.slug)}">Previous interview: ${escapeHtml(interview.previous.name)}</a></li>`,
    );
  }
  if (interview.next !== null) {
    links.push(
      `<li><a href="/interviews/${escapeHtml(interview.next.slug)}">Next interview: ${escapeHtml(interview.next.name)}</a></li>`,
    );
  }
  return `<ul>${links.join('')}</ul>`;
}

function setupArrowKeys(interview: InterviewResponse): void {
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (find('[data-menu-dialog]:not([hidden])') !== null) {
      return;
    }
    const target =
      event.key === 'ArrowLeft'
        ? interview.previous
        : event.key === 'ArrowRight'
          ? interview.next
          : null;
    if (target !== null) {
      event.preventDefault();
      window.location.assign(`/interviews/${target.slug}`);
    }
  });
}

/** One interview page, read from the site's own API. */
export async function renderInterviewPage(): Promise<void> {
  const article = need<HTMLElement>('[data-interview-slug]');
  const interview = await fetchInterview(
    article.dataset['interviewSlug'] ?? '',
  );
  need<HTMLElement>('[data-interview-name]').textContent = interview.name;
  need<HTMLElement>('[data-interview-role]').textContent = interview.role;
  need<HTMLElement>('[data-interview-lede]').textContent = interview.lede;
  fillWith(
    need<HTMLElement>('[data-interview-portrait]'),
    portraitSvg(interview.hue),
  );
  fillWith(
    need<HTMLElement>('[data-interview-answers]'),
    interview.answers
      .map(
        (answer) =>
          `<h2 class="interview__question">${escapeHtml(answer.question)}</h2>
<p class="interview__answer">${escapeHtml(answer.answer)}</p>`,
      )
      .join(''),
  );
  fillWith(need<HTMLElement>('[data-interview-nav]'), neighbourLinks(interview));
  setupArrowKeys(interview);
  need<HTMLElement>('#page-heading').focus();
}
