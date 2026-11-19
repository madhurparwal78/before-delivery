import type { AttendanceRow, ReviewJson, SummaryJson } from '../../shared/types.js';
import { api } from '../api.js';
import { button, element, labelledInput } from '../dom.js';
import { navigate, pageShell, pending } from '../shell.js';
import { statusLabel } from '../labels.js';

export function joinPage(): HTMLElement {
  const shell = pageShell('narrow');
  const code = labelledInput('Class code', { autocapitalize: 'characters', class: 'mono' });
  const name = labelledInput('Your name');
  const join = element('button', { type: 'submit', class: 'primary' }, ['Join']);

  const form = element('form', { class: 'stack', novalidate: true }, [code.field, name.field, join]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      shell.showError(null);
      pending(join, true);
      shell.setStatus('Saving...');
      const answer = await api.post<{ sessionId: string }>('/api/join', {
        code: code.input.value,
        displayName: name.input.value
      });
      pending(join, false);
      shell.setStatus('');
      if (answer.error !== null) {
        shell.showError(answer.status === 404 ? "That code doesn't match a class." : answer.error);
        return;
      }
      navigate(`/sessions/${answer.body.sessionId}`);
    })();
  });

  shell.body.append(element('h1', {}, ['Join a class']), form);
  return shell.root;
}

export function summaryPage(sessionId: string): HTMLElement {
  const shell = pageShell('wide');
  const counts = element('ul', { class: 'rows', 'aria-label': 'Attendance counts' });
  const tableBody = element('tbody', {});
  const table = element('table', { 'aria-label': 'Attendance', class: 'sheet' }, [
    element('thead', {}, [
      element('tr', {}, [
        element('th', { scope: 'col' }, ['Learner']),
        element('th', { scope: 'col' }, ['Status']),
        element('th', { scope: 'col' }, ['First joined']),
        element('th', { scope: 'col' }, ['Last left'])
      ])
    ]),
    tableBody
  ]);
  const pollResults = element('ul', { class: 'rows', 'aria-label': 'Poll results' });
  const questions = element('div', { class: 'poll-questions' });
  const hands = element('p', {}, ['']);
  const rounds = element('p', {}, ['']);

  shell.body.append(
    element('h1', {}, ['Session summary']),
    element('section', { class: 'panel' }, [element('h2', {}, ['Attendance']), counts]),
    element('section', { class: 'panel' }, [element('div', { class: 'table-box' }, [table])]),
    element('section', { class: 'panel' }, [element('h2', {}, ['Polls']), questions, pollResults]),
    element('section', { class: 'panel' }, [hands, rounds])
  );

  void (async () => {
    const summary = await api.get<SummaryJson>(`/api/sessions/${sessionId}/summary`);
    if (summary.status === 404) {
      shell.showNotFound();
      return;
    }
    if (summary.error !== null) {
      shell.showError(summary.error);
      return;
    }
    const sums = summary.body.attendance;
    for (const [label, value] of [
      ['Present', sums.present],
      ['Late', sums.late],
      ['Left early', sums.leftEarly],
      ['Late, left early', sums.lateLeftEarly],
      ['Absent', sums.absent]
    ] as const) {
      counts.append(element('li', {}, [`${label} `, element('span', { class: 'mono' }, [String(value)])]));
    }
    for (const poll of summary.body.polls) {
      questions.append(element('p', { class: 'poll-question' }, [poll.question]));
      for (const result of poll.results) {
        pollResults.append(element('li', {}, [`${result.option} ${result.percent}%`]));
      }
    }
    hands.textContent = `Hands taken: ${summary.body.handsTaken}`;
    rounds.textContent = `Breakout rounds: ${summary.body.breakoutRounds}`;

    const attendance = await api.get<{ rows: AttendanceRow[] }>(`/api/sessions/${sessionId}/attendance`);
    if (attendance.error !== null) {
      shell.showError(attendance.error);
      return;
    }
    for (const row of attendance.body.rows) {
      tableBody.append(
        element('tr', {}, [
          element('td', {}, [row.displayName]),
          element('td', {}, [statusLabel(row.status)]),
          element('td', { class: 'mono' }, [row.firstJoined === null ? '-' : row.firstJoined.slice(11)]),
          element('td', { class: 'mono' }, [row.lastLeft === null ? '-' : row.lastLeft.slice(11)])
        ])
      );
    }
  })();

  return shell.root;
}

export function reviewPage(sessionId: string): HTMLElement {
  const shell = pageShell('wide');
  const heading = element('h1', {}, ['']);
  const slideImage = element('img', { alt: '', class: 'review-slide' });
  const position = element('p', { class: 'mono' }, ['']);
  const previous = button('Previous slide');
  const next = button('Next slide');
  const models = element('ul', { class: 'rows', 'aria-label': 'Models' });
  let slides: ReviewJson['slides'] = [];
  let at = 0;

  const draw = (): void => {
    const slide = slides[at];
    if (slide === undefined) return;
    slideImage.src = slide.url;
    slideImage.alt = `Slide ${slide.number}`;
    position.textContent = `Slide ${slide.number} of ${slides.length}`;
    previous.disabled = at === 0;
    next.disabled = at === slides.length - 1;
  };

  previous.addEventListener('click', () => {
    if (at > 0) {
      at -= 1;
      draw();
    }
  });
  next.addEventListener('click', () => {
    if (at < slides.length - 1) {
      at += 1;
      draw();
    }
  });

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' && at > 0) {
      at -= 1;
      draw();
    }
    if (event.key === 'ArrowRight' && at < slides.length - 1) {
      at += 1;
      draw();
    }
  };
  addEventListener('keydown', onKey);
  shell.root.addEventListener('slatehall:leave', () => removeEventListener('keydown', onKey));

  shell.body.append(
    heading,
    element('div', { class: 'review-frame' }, [slideImage]),
    element('div', { class: 'review-controls' }, [previous, position, next]),
    element('section', { class: 'panel' }, [element('h2', {}, ['Models']), models])
  );

  void (async () => {
    const answer = await api.get<ReviewJson>(`/api/sessions/${sessionId}/review`);
    if (answer.status === 404) {
      shell.showNotFound();
      return;
    }
    if (answer.error !== null) {
      shell.showError(answer.error);
      return;
    }
    heading.textContent = `Review: ${answer.body.lessonTitle}`;
    slides = answer.body.slides;
    for (const model of answer.body.models) {
      models.append(
        element('li', {}, [
          element('a', { href: model.url, download: `model-${model.number}.glb` }, [`Download model ${model.number}`])
        ])
      );
    }
    draw();
  })();

  return shell.root;
}

export function notFoundPage(): HTMLElement {
  const shell = pageShell('narrow');
  shell.body.append(element('h1', {}, ['Page not found']), element('p', {}, ["We couldn't find that page."]));
  return shell.root;
}
