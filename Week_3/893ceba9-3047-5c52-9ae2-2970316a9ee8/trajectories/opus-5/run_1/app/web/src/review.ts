// The review queue, worked by keyboard alone.

import { DeskError, QueueRow, api } from './api';
import { labelledField, openModal } from './dialog';
import { clear, el, localTime, statusTag, statusWord } from './dom';
import { announce, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { emptyPanel } from './illustrations';
import { desk } from './shell';

let refreshTimer = 0;

export async function renderReview(screen: HTMLElement, search: URLSearchParams): Promise<void> {
  const language = search.get('lang');
  const region = el('section', { class: 'queue', role: 'region', 'aria-label': 'Review queue' });
  const column = el('div', { class: 'content-column' }, [
    el('h1', { text: 'Review queue' }),
    el('p', { class: 'shortcut-line', text: 'Shortcuts: J next, K previous, A approve, C correct.' }),
    region,
  ]);
  screen.append(column);

  let rows: QueueRow[] = [];
  let currentAt = 0;
  const approved = new Set<string>();

  // A refresh drops approved and expired cards and keeps the current card when
  // it is still listed.
  const load = async (keepCurrent: boolean): Promise<void> => {
    const currentID = rows[currentAt]?.segment_id;
    const answer = await api.get<{ segments: QueueRow[] }>(
      `/api/review-queue${language ? `?lang=${encodeURIComponent(language)}` : ''}`,
    );
    rows = answer.segments.filter((row) => row.status !== 'approved');
    approved.clear();
    currentAt = 0;
    if (keepCurrent && currentID) {
      const at = rows.findIndex((row) => row.segment_id === currentID);
      if (at >= 0) currentAt = at;
    }
    paint();
  };

  const paint = (): void => {
    clear(region);
    if (rows.length === 0) {
      region.append(emptyState());
      region.append(refreshButton(load));
      return;
    }
    rows.forEach((row, index) => region.append(card(row, index === currentAt)));
    region.append(refreshButton(load));
  };

  function card(row: QueueRow, current: boolean): HTMLElement {
    const done = approved.has(row.segment_id);
    const approve = el('button', {
      type: 'button',
      class: 'button primary',
      text: 'Approve',
      disabled: row.removed || done,
      onclick: () => void approveRow(row),
    });
    const correct = el('button', {
      type: 'button',
      class: 'button outline',
      text: 'Correct',
      disabled: row.removed || done,
      onclick: (event: Event) => openCorrect(row, event.currentTarget as HTMLElement),
    });
    return el('article', {
      class: `card queue-card ${current ? 'current' : ''}`.trim(),
      'aria-label': `${row.key} (${row.language})`,
      'aria-current': current ? 'true' : null,
      'data-segment': row.segment_id,
      tabindex: '-1',
    }, [
      el('h2', { text: `${row.key} (${row.language})` }),
      el('p', {
        class: 'source-text',
        text: row.removed ? `This key was removed on ${row.branch}.` : row.source ?? '',
      }),
      el('p', { class: 'target-text', text: row.value ?? '' }),
      el('p', { class: 'score-line tabular', text: row.score === null ? 'Not scored' : `MQM ${row.score}` }),
      row.issues.length > 0
        ? el('ul', { class: 'issue-list' }, row.issues.map((issue) =>
            el('li', { text: `${issue.category} / ${issue.severity}${issue.note ? ` \u2014 ${issue.note}` : ''}` }),
          ))
        : null,
      el('p', {}, [statusTag(done ? 'approved' : row.status)]),
      el('p', {
        class: 'muted',
        text: row.expires_at ? `Assignment expires at ${localTime(row.expires_at)}` : 'Not assigned',
      }),
      el('div', { class: 'queue-actions' }, [approve, correct]),
    ]);
  }

  async function approveRow(row: QueueRow): Promise<void> {
    clearProblem();
    announce('Approving.');
    try {
      await api.post(`/api/segments/${row.segment_id}/approve`);
      approved.add(row.segment_id);
      announce('Approved.');
      paint();
      focusCurrent();
    } catch (error) {
      announce('');
      if (error instanceof DeskError) {
        problem(failureCopy(error, { from: statusWord(row.status), branch: row.branch }));
      }
    }
  }

  function openCorrect(row: QueueRow, opener: HTMLElement): void {
    openModal({
      name: 'Correct segment',
      opener,
      body: (handle) => {
        const value = el('textarea', { 'data-field': 'value', rows: '4', text: row.value ?? '' });
        const comment = el('textarea', { 'data-field': 'comment', rows: '3' });
        const save = el('button', { type: 'submit', class: 'button primary', text: 'Save correction' });
        const form = el('form', {
          onsubmit: async (event: Event) => {
            event.preventDefault();
            clearProblem();
            save.disabled = true;
            announce('Saving correction.');
            try {
              await api.post(`/api/segments/${row.segment_id}/correct`, {
                value: value.value,
                comment: comment.value || undefined,
              });
              approved.add(row.segment_id);
              announce('Correction saved and approved.');
              handle.close();
              paint();
              focusCurrent();
            } catch (error) {
              save.disabled = false;
              announce('');
              if (error instanceof DeskError) {
                problem(failureCopy(error, { from: statusWord(row.status), branch: row.branch }));
                showFieldErrors(form, error.info.fields);
              }
            }
          },
        }, [
          el('h2', { text: 'Correct segment' }),
          labelledField('Corrected translation', value),
          labelledField('Comment', comment),
          el('div', { class: 'dialog-actions' }, [
            save,
            el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
          ]),
        ]);
        return [form];
      },
    });
  }

  // focusCurrent keeps focus inside the queue: the current card's Approve
  // button, or the card itself once its buttons are done.
  function focusCurrent(): void {
    const card = currentCard();
    if (!card) return;
    const approve = card.querySelector<HTMLButtonElement>('button:not([disabled])');
    (approve ?? card).focus();
  }

  function currentCard(): HTMLElement | null {
    return region.querySelectorAll<HTMLElement>('.queue-card')[currentAt] ?? null;
  }

  region.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!['j', 'k', 'a', 'c'].includes(key)) return;
    event.preventDefault();
    if (rows.length === 0) return;
    if (key === 'j') {
      currentAt = Math.min(currentAt + 1, rows.length - 1);
      paint();
      focusCurrent();
    } else if (key === 'k') {
      currentAt = Math.max(currentAt - 1, 0);
      paint();
      focusCurrent();
    } else if (key === 'a') {
      void approveRow(rows[currentAt]);
    } else if (key === 'c') {
      const correct = currentCard()?.querySelectorAll<HTMLButtonElement>('button')[1];
      if (correct && !correct.disabled) openCorrect(rows[currentAt], correct);
    }
  });

  await load(false);
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void load(true), 15000);
}

function refreshButton(load: (keepCurrent: boolean) => Promise<void>): HTMLElement {
  return el('button', {
    type: 'button',
    class: 'button outline',
    text: 'Refresh queue',
    onclick: () => void load(true),
  });
}

function emptyState(): HTMLElement {
  const owner = desk.user?.role === 'owner';
  return el('div', { class: 'card empty-state' }, [
    emptyPanel(),
    el('h2', { text: 'Nothing to review right now' }),
    el('p', {
      text: owner
        ? "Segments that score below a project's MQM threshold land here."
        : "When the engineer assigns segments to you, they'll show up here.",
    }),
  ]);
}
