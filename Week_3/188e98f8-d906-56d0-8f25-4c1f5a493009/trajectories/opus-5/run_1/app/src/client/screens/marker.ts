/** The marking desk and its marking pane. */

import type { Answer, AnswersBody, Round } from '../../shared/model.js';
import { roundStatusLabel } from '../../shared/model.js';
import { ask } from '../api.js';
import { COPY } from '../copy.js';
import { el, focusOn, setText } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import { Pane } from '../pane.js';
import { signOutButton } from '../parts.js';
import type { PollState, Screen } from './screen.js';

interface MarkingRow {
  answer: Answer;
  row: HTMLElement;
  correct: HTMLInputElement;
  wrong: HTMLInputElement;
  text: HTMLElement;
}

interface MarkingPane {
  pane: Pane;
  rows: Map<number, MarkingRow>;
  order: number[];
  list: HTMLElement;
  finish: HTMLButtonElement;
  close: HTMLButtonElement;
  current: number | null;
  round: number;
}

export function markerScreen(messages: DeskMessages): Screen {
  const heading = el('h1', { class: 'desk-heading', tabindex: '-1' }, ['Marking']);
  const roundList = el('ul', { class: 'marker-rounds' });
  const archiveLink = el('a', { class: 'link', href: '/archive' }, ['Answer archive']);
  const root = el('div', { class: 'screen screen-marker' }, [
    messages.region,
    heading,
    roundList,
    el('p', {}, [archiveLink]),
  ]);

  const items = new Map<number, { item: HTMLElement; status: HTMLElement; button: HTMLButtonElement }>();
  const panes = new Map<number, MarkingPane>();

  function paneFor(round: number): MarkingPane {
    const held = panes.get(round);
    if (held !== undefined) return held;

    const list = el('div', { class: 'marking-rows' });
    const finish = el('button', { type: 'button', class: 'button' }, ['Finish marking']);
    const close = el('button', { type: 'button', class: 'button button-quiet' }, ['Close']);
    const built: MarkingPane = {
      pane: new Pane({
        name: `Mark round ${round}`,
        stops: () => [...stopsOf(built), finish, close],
        firstStop: () => firstStopOf(built),
        opener: () => items.get(round)?.button ?? heading,
      }),
      rows: new Map(),
      order: [],
      list,
      finish,
      close,
      current: null,
      round,
    };
    built.pane.body.append(
      el('h2', {}, [`Mark round ${round}`]),
      list,
      el('div', { class: 'pane-actions' }, [finish, close]),
    );
    close.addEventListener('click', () => built.pane.hide(items.get(round)?.button ?? heading));
    finish.addEventListener('click', () => {
      messages.pending(COPY.finishPending(round));
      void (async () => {
        const outcome = await ask<{ round: Round }>({ method: 'POST', path: `/api/rounds/${round}/marked` });
        if (outcome.ok) {
          messages.result(COPY.finishDone(round));
          built.pane.hide(heading);
          return;
        }
        if (outcome.error?.error === 'unmarked_answers') {
          messages.result(COPY.unmarkedLeft(round, outcome.error.count ?? 0));
          return;
        }
        messages.result(COPY.unreachable);
      })();
    });
    built.pane.dialog.addEventListener('keydown', (event) => onShortcut(built, event));
    panes.set(round, built);
    return built;
  }

  function stopsOf(pane: MarkingPane): HTMLElement[] {
    return pane.order
      .map((id) => pane.rows.get(id))
      .filter((row): row is MarkingRow => row !== undefined)
      .map((row) => (row.wrong.checked ? row.wrong : row.correct));
  }

  function firstStopOf(pane: MarkingPane): HTMLElement | null {
    const id = pane.current ?? pane.order[0];
    if (id === undefined) return pane.finish;
    const row = pane.rows.get(id);
    if (row === undefined) return pane.finish;
    return row.wrong.checked ? row.wrong : row.correct;
  }

  function onShortcut(pane: MarkingPane, event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'c' && key !== 'x' && key !== 'j' && key !== 'k') return;
    event.preventDefault();
    if (key === 'j' || key === 'k') {
      step(pane, key === 'j' ? 1 : -1);
      return;
    }
    const id = pane.current;
    if (id === null) return;
    void save(pane, id, key === 'c' ? 1 : 0, true);
  }

  function step(pane: MarkingPane, by: number): void {
    if (pane.order.length === 0) return;
    const at = pane.current === null ? -1 : pane.order.indexOf(pane.current);
    const next = Math.min(pane.order.length - 1, Math.max(0, at + by));
    const id = pane.order[next];
    if (id === undefined) return;
    setCurrent(pane, id, true);
  }

  function setCurrent(pane: MarkingPane, id: number, moveFocus: boolean): void {
    pane.current = id;
    for (const [held, row] of pane.rows) row.row.classList.toggle('current', held === id);
    const row = pane.rows.get(id);
    if (row === undefined) return;
    row.row.scrollIntoView({ block: 'nearest' });
    if (moveFocus) focusOn(row.wrong.checked ? row.wrong : row.correct);
  }

  function nextUnmarked(pane: MarkingPane, from: number): number | null {
    const at = pane.order.indexOf(from);
    for (const id of pane.order.slice(at + 1)) {
      const row = pane.rows.get(id);
      if (row !== undefined && row.answer.mark === null) return id;
    }
    return null;
  }

  async function save(pane: MarkingPane, id: number, points: 0 | 1, thenNext: boolean): Promise<void> {
    const row = pane.rows.get(id);
    if (row === undefined) return;
    const outcome = await ask<{ answer: Answer }>({
      method: 'PUT',
      path: `/api/rounds/${pane.round}/marks`,
      body: { answer_id: id, points },
    });
    if (!outcome.ok) {
      messages.result(COPY.unreachable);
      return;
    }
    row.answer = outcome.data.answer;
    row.correct.checked = points === 1;
    row.wrong.checked = points === 0;
    messages.result(COPY.markDone(row.answer.team_name, row.answer.question, points));
    if (!thenNext) {
      setCurrent(pane, id, false);
      return;
    }
    const next = nextUnmarked(pane, id);
    setCurrent(pane, next ?? id, true);
  }

  function drawRows(pane: MarkingPane, answers: Answer[]): void {
    pane.order = answers.map((answer) => answer.id);
    for (const answer of answers) {
      let row = pane.rows.get(answer.id);
      if (row === undefined) {
        const group = el('div', {
          role: 'radiogroup',
          'aria-label': `${answer.team_name}, question ${answer.question}`,
          class: 'mark-choices',
        });
        const correct = el('input', { type: 'radio', name: `mark-${answer.id}`, class: 'mark-radio' });
        const wrong = el('input', { type: 'radio', name: `mark-${answer.id}`, class: 'mark-radio' });
        group.append(
          el('label', { class: 'mark-choice' }, [correct, el('span', {}, ['Correct'])]),
          el('label', { class: 'mark-choice' }, [wrong, el('span', {}, ['Wrong'])]),
        );
        const text = el('span', { class: 'marking-answer' }, [answer.text]);
        const holder = el('div', { class: 'marking-row' }, [
          el('span', { class: 'marking-team' }, [`${answer.team_name}, question ${answer.question}`]),
          text,
          group,
        ]);
        pane.list.append(holder);
        row = { answer, row: holder, correct, wrong, text };
        pane.rows.set(answer.id, row);
        correct.addEventListener('change', () => void save(pane, answer.id, 1, false));
        wrong.addEventListener('change', () => void save(pane, answer.id, 0, false));
      }
      row.answer = answer;
      setText(row.text, answer.text);
      row.correct.checked = answer.mark === 1;
      row.wrong.checked = answer.mark === 0;
    }
    if (pane.current === null) {
      const unmarked = answers.find((answer) => answer.mark === null);
      const first = unmarked ?? answers[0];
      if (first !== undefined) setCurrent(pane, first.id, false);
    }
  }

  async function openPane(round: number): Promise<void> {
    const pane = paneFor(round);
    const answers = await ask<AnswersBody>({ method: 'GET', path: `/api/rounds/${round}/answers` });
    if (answers.ok) drawRows(pane, answers.data.answers);
    pane.pane.show();
  }

  async function refreshOpenPane(): Promise<void> {
    for (const pane of panes.values()) {
      if (!pane.pane.open) continue;
      const answers = await ask<AnswersBody>({ method: 'GET', path: `/api/rounds/${pane.round}/answers` });
      if (answers.ok) drawRows(pane, answers.data.answers);
    }
  }

  return {
    root,
    signOut: signOutButton(),
    land: () => {
      window.scrollTo(0, 0);
      focusOn(heading);
    },
    poll: async (state: PollState) => {
      for (const round of state.rounds) {
        let item = items.get(round.number);
        if (item === undefined) {
          const status = el('span', { class: 'marker-status' });
          const button = el('button', { type: 'button', class: 'button' }, [`Mark round ${round.number}`]);
          button.addEventListener('click', () => void openPane(round.number));
          const holder = el('li', { class: 'marker-round' }, [
            el('span', {}, [`Round ${round.number}: ${round.title}`]),
            status,
            button,
          ]);
          roundList.append(holder);
          item = { item: holder, status, button };
          items.set(round.number, item);
        }
        setText(item.status, roundStatusLabel(round.status));
        const mayMark = round.status === 'closed';
        if (mayMark && !item.item.contains(item.button)) item.item.append(item.button);
        if (!mayMark && item.item.contains(item.button)) item.button.remove();
      }
      await refreshOpenPane();
    },
  };
}
