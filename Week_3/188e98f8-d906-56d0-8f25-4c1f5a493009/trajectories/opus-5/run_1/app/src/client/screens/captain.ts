/** The answer desk. */

import type { Answer, AnswersBody, Dispute, Round, SessionBody } from '../../shared/model.js';
import { QUESTIONS } from '../../shared/model.js';
import { LIMITS } from '../../shared/text.js';
import { clock } from '../../shared/time.js';
import { COUNTDOWN_TICK_MS } from '../../shared/timing.js';
import { ask, freshIdempotencyKey } from '../api.js';
import { COPY } from '../copy.js';
import { countedField, type CountedField } from '../counter.js';
import { el, focusOn, onKeyDown, setText } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import { Pane } from '../pane.js';
import { RulingWatcher, signOutButton } from '../parts.js';
import type { TileGrid } from '../tiles.js';
import type { PollState, Screen } from './screen.js';

interface AnswerForm {
  round: Round;
  form: HTMLFormElement;
  holder: HTMLElement;
  timer: HTMLElement;
  fields: CountedField[];
  submit: HTMLButtonElement;
  accepted: HTMLElement;
  readOnly: boolean;
}

interface MarkRow {
  row: HTMLElement;
  ruled: HTMLElement;
  status: HTMLElement;
  answerText: HTMLElement;
  button: HTMLButtonElement | null;
  answerId: number;
  round: number;
  question: number;
}

export function captainScreen(
  tiles: TileGrid,
  messages: DeskMessages,
  session: SessionBody,
): Screen {
  const teamId = session.team_id ?? 0;
  const rulings = new RulingWatcher(messages);

  const heading = el('h1', { class: 'desk-heading', tabindex: '-1' }, ['Answer desk']);
  const teamName = el('span', { class: 'team-name' }, [session.team_name ?? '']);
  const renameButton = el('button', { type: 'button', class: 'button' }, ['Rename team']);
  const formArea = el('div', { class: 'form-area' });
  const marksGroups = el('div', { class: 'marks-groups' });
  const marksRegion = el('section', { role: 'region', 'aria-label': 'Your marks', class: 'marks', tabindex: '-1' }, [
    el('h2', {}, ['Your marks']),
    marksGroups,
  ]);
  const root = el('div', { class: 'screen screen-captain' }, [
    messages.region,
    heading,
    el('div', { class: 'team-row' }, [teamName, renameButton]),
    formArea,
    marksRegion,
    tiles.region,
  ]);

  let form: AnswerForm | null = null;
  let waiting: HTMLElement | null = null;
  let secondsLeft: number | null = null;
  const closedTold = new Set<number>();
  const rows = new Map<string, MarkRow>();
  let disputes: Dispute[] = [];
  let currentName = session.team_name ?? '';
  let disputed: { row: MarkRow; order: string[] } | null = null;

  /* Rename team */

  const nameField = el('input', { type: 'text', class: 'field', 'aria-label': 'Team name', id: 'team-name-field' });
  const nameCounted = countedField({
    field: nameField,
    limit: LIMITS.teamName,
    overLimitCopy: COPY.nameTooLong,
    messages,
  });
  const saveName = el('button', { type: 'button', class: 'button' }, ['Save name']);
  const cancelName = el('button', { type: 'button', class: 'button button-quiet' }, ['Cancel']);
  const renamePane = new Pane({
    name: 'Rename team',
    stops: () => [nameField, saveName, cancelName],
    firstStop: () => nameField,
    opener: () => renameButton,
  });
  renamePane.body.append(
    el('h2', {}, ['Rename team']),
    el('label', { class: 'field-label', for: 'team-name-field' }, ['Team name']),
    nameField,
    nameCounted.counter,
    nameCounted.error,
    el('div', { class: 'pane-actions' }, [saveName, cancelName]),
  );

  const sendName = (): void => {
    messages.pending(COPY.renamePending);
    void (async () => {
      const outcome = await ask<{ team: { id: number; name: string } }>({
        method: 'PATCH',
        path: `/api/teams/${teamId}`,
        body: { name: nameField.value },
      });
      if (outcome.ok) {
        currentName = outcome.data.team.name;
        setText(teamName, currentName);
        messages.result(COPY.renameDone);
        renamePane.hide(renameButton);
        return;
      }
      const verdict = outcome.error?.fields?.['name'];
      const refusal =
        outcome.status === 409
          ? COPY.nameTaken
          : verdict === 'required'
            ? COPY.nameRequired
            : verdict === 'too_long'
              ? COPY.nameTooLong
              : COPY.unreachable;
      messages.result(refusal);
      nameCounted.showError(refusal);
    })();
  };

  renameButton.addEventListener('click', () => {
    nameField.value = currentName;
    nameCounted.refresh();
    renamePane.show();
  });
  saveName.addEventListener('click', sendName);
  onKeyDown(nameField, (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    sendName();
  });
  cancelName.addEventListener('click', () => renamePane.hide(renameButton));

  /* Raise a dispute */

  const reasonField = el('textarea', { class: 'field', 'aria-label': 'Reason', id: 'dispute-reason', rows: '3' });
  const reasonCounted = countedField({
    field: reasonField,
    limit: LIMITS.disputeReason,
    overLimitCopy: COPY.reasonTooLong,
    messages,
  });
  const sendDispute = el('button', { type: 'button', class: 'button' }, ['Send dispute']);
  const cancelDispute = el('button', { type: 'button', class: 'button button-quiet' }, ['Cancel']);
  const disputePane = new Pane({
    name: 'Raise a dispute',
    stops: () => [reasonField, sendDispute, cancelDispute],
    firstStop: () => reasonField,
    opener: () => disputed?.row.button ?? marksRegion,
  });
  disputePane.body.append(
    el('h2', {}, ['Raise a dispute']),
    el('label', { class: 'field-label', for: 'dispute-reason' }, ['Reason']),
    reasonField,
    reasonCounted.counter,
    reasonCounted.error,
    el('div', { class: 'pane-actions' }, [sendDispute, cancelDispute]),
  );
  cancelDispute.addEventListener('click', () => disputePane.hide(disputed?.row.button ?? marksRegion));

  sendDispute.addEventListener('click', () => {
    const open = disputed;
    if (open === null) return;
    messages.pending(COPY.disputePending);
    void (async () => {
      const outcome = await ask<{ dispute: Dispute }>({
        method: 'POST',
        path: '/api/disputes',
        body: { answer_id: open.row.answerId, reason: reasonField.value },
      });
      if (outcome.ok) {
        messages.result(COPY.disputeDone);
        const after = nextDisputeButton(open);
        disputePane.hide(after);
        await refreshMarks();
        return;
      }
      const verdict = outcome.error?.fields?.['reason'];
      if (outcome.error?.error === 'dispute_window_closed') {
        messages.result(COPY.disputeWindowClosed(open.row.round));
      } else if (verdict === 'required') messages.result(COPY.reasonRequired);
      else if (verdict === 'too_long') messages.result(COPY.reasonTooLong);
      else messages.result(COPY.unreachable);
      focusOn(sendDispute);
    })();
  });

  function nextDisputeButton(open: { row: MarkRow; order: string[] }): HTMLElement {
    const at = open.order.indexOf(`${open.row.round}:${open.row.question}`);
    for (const key of open.order.slice(at + 1)) {
      const row = rows.get(key);
      if (row?.button != null) return row.button;
    }
    return heading;
  }

  /* The answer form */

  function buildForm(round: Round): AnswerForm {
    const timer = el('div', { role: 'timer', 'aria-label': 'Time left', class: 'countdown tabular' }, [
      COPY.timeLeft(clock(round.seconds_left ?? 0)),
    ]);
    const formEl = el('form', { class: 'answer-form', 'aria-label': `Round ${round.number} answers` });
    const fields: CountedField[] = [];
    const rowsHolder = el('div', { class: 'answer-rows' });
    for (const question of QUESTIONS) {
      const id = `answer-${question}`;
      const input = el('input', { type: 'text', class: 'field', id, 'aria-label': `Question ${question}` });
      const counted = countedField({
        field: input,
        limit: LIMITS.answerText,
        overLimitCopy: COPY.answerTooLong,
        messages,
      });
      fields.push(counted);
      rowsHolder.append(
        el('div', { class: 'answer-row' }, [
          el('label', { class: 'field-label', for: id }, [`Question ${question}`]),
          input,
          counted.counter,
          counted.error,
        ]),
      );
    }
    const submit = el('button', { type: 'submit', class: 'button submit-answers' }, ['Submit answers']);
    formEl.append(timer, rowsHolder);
    if (round.kind === 'picture') {
      formEl.append(
        el('img', {
          class: 'sheet-image',
          src: `/api/rounds/${round.number}/sheet`,
          alt: `Picture sheet for round ${round.number}`,
        }),
      );
    }
    formEl.append(submit);
    const accepted = el('ul', { class: 'accepted', 'aria-label': 'Accepted answers' });
    const holder = el('div', { class: 'form-holder' }, [formEl, accepted]);

    const built: AnswerForm = {
      round,
      form: formEl,
      holder,
      timer,
      fields,
      submit,
      accepted,
      readOnly: round.status !== 'open',
    };

    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      void send(built);
    });
    fields.forEach((counted, index) => {
      onKeyDown(counted.field, (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const next = fields[index + 1];
        if (next === undefined) void send(built);
        else focusOn(next.field);
      });
    });
    return built;
  }

  async function send(shown: AnswerForm): Promise<void> {
    if (shown.readOnly) return;
    const answers = shown.fields
      .map((counted, index) => ({ question: index + 1, text: counted.field.value }))
      .filter((answer) => answer.text.trim() !== '');
    if (answers.length === 0) return;
    messages.pending(COPY.submitPending);
    const outcome = await ask<{ round: number; accepted: Answer[] }>({
      method: 'POST',
      path: `/api/rounds/${shown.round.number}/answers`,
      body: { answers },
      idempotencyKey: freshIdempotencyKey(),
    });
    if (outcome.ok) {
      messages.result(COPY.submitDone(shown.round.number));
      fillAccepted(shown, outcome.data.accepted);
      return;
    }
    if (outcome.status === 429) {
      messages.result(COPY.tooManySubmits(outcome.error?.retry_after ?? 1));
      return;
    }
    if (outcome.error?.error === 'round_closed' || outcome.error?.error === 'round_not_open') {
      messages.result(COPY.roundClosed(shown.round.number));
      closedTold.add(shown.round.number);
      makeReadOnly(shown);
      return;
    }
    const fields = outcome.error?.fields ?? {};
    const tooLong = Object.entries(fields).some(([, verdict]) => verdict === 'too_long');
    if (tooLong) {
      for (const [name, verdict] of Object.entries(fields)) {
        const question = Number(name.replace('question_', ''));
        const counted = shown.fields[question - 1];
        if (counted !== undefined && verdict === 'too_long') counted.showError(COPY.answerTooLong);
      }
      messages.result(COPY.answerTooLong);
      return;
    }
    messages.result(COPY.unreachable);
  }

  function fillAccepted(shown: AnswerForm, answers: Answer[]): void {
    const wanted = answers
      .slice()
      .sort((left, right) => left.question - right.question)
      .map((answer) => `Question ${answer.question}: ${answer.text}`);
    const shownNow = [...shown.accepted.children].map((child) => child.textContent ?? '');
    if (wanted.length === shownNow.length && wanted.every((line, index) => line === shownNow[index])) return;
    shown.accepted.replaceChildren(...wanted.map((line) => el('li', {}, [line])));
    shown.accepted.classList.remove('fade-in');
    void shown.accepted.offsetWidth;
    shown.accepted.classList.add('fade-in');
  }

  function makeReadOnly(shown: AnswerForm): void {
    shown.readOnly = true;
    for (const counted of shown.fields) counted.field.readOnly = true;
    setText(shown.timer, COPY.timeLeft(clock(0)));
  }

  function showForm(round: Round): void {
    if (form !== null && form.round.number === round.number) {
      form.round = round;
      return;
    }
    if (waiting !== null) {
      waiting.remove();
      waiting = null;
    }
    const built = buildForm(round);
    if (form !== null) form.holder.remove();
    form = built;
    formArea.append(built.holder);
    secondsLeft = round.seconds_left;
  }

  function showWaiting(): void {
    if (waiting !== null) return;
    waiting = el('section', { class: 'card waiting-card' }, [COPY.waiting]);
    formArea.append(waiting);
  }

  /* Your marks */

  let lastRounds: Round[] = [];

  async function refreshMarks(): Promise<void> {
    const mine = await ask<{ disputes: Dispute[] }>({ method: 'GET', path: '/api/disputes' });
    if (mine.ok) {
      disputes = mine.data.disputes;
      rulings.note(disputes);
    }
    await drawMarks(lastRounds);
  }

  async function drawMarks(rounds: Round[]): Promise<void> {
    const ruled = rounds.filter((round) => round.status === 'marked' || round.status === 'published');
    const order: string[] = [];
    for (const round of ruled) {
      const answers = await ask<AnswersBody>({ method: 'GET', path: `/api/rounds/${round.number}/answers` });
      if (!answers.ok) continue;
      let group = marksGroups.querySelector<HTMLElement>(`[data-round="${round.number}"]`);
      if (group === null) {
        group = el('div', { role: 'group', 'aria-label': `Round ${round.number}`, class: 'marks-group', 'data-round': round.number }, [
          el('h3', {}, [`Round ${round.number}`]),
        ]);
        marksGroups.append(group);
      }
      for (const answer of answers.data.answers) {
        const key = `${round.number}:${answer.question}`;
        order.push(key);
        const dispute = disputes.find((held) => held.answer_id === answer.id);
        let row = rows.get(key);
        if (row === undefined) {
          const ruledMark = el('span', { class: 'mark-ruled tabular' });
          const status = el('span', { class: 'mark-dispute' });
          const answerText = el('span', { class: 'mark-answer' });
          const holder = el('div', { class: 'mark-row' }, [
            el('span', { class: 'mark-question' }, [`Question ${answer.question}`]),
            answerText,
            ruledMark,
            status,
          ]);
          group.append(holder);
          row = {
            row: holder,
            ruled: ruledMark,
            status,
            answerText,
            button: null,
            answerId: answer.id,
            round: round.number,
            question: answer.question,
          };
          rows.set(key, row);
        }
        row.answerId = answer.id;
        setText(row.answerText, answer.text);
        setText(row.ruled, answer.ruled === null ? '' : String(answer.ruled));
        setText(
          row.status,
          dispute === undefined
            ? ''
            : dispute.status === 'raised'
              ? 'Raised'
              : dispute.status === 'upheld'
                ? 'Upheld'
                : 'Dismissed',
        );
        const mayDispute = answer.ruled === 0 && dispute === undefined && round.status === 'marked';
        if (mayDispute && row.button === null) {
          const button = el('button', { type: 'button', class: 'button' }, [`Dispute question ${answer.question}`]);
          const held = row;
          button.addEventListener('click', () => {
            disputed = { row: held, order: [...order] };
            reasonField.value = '';
            reasonCounted.refresh();
            disputePane.show();
          });
          row.button = button;
          row.row.append(button);
        } else if (!mayDispute && row.button !== null) {
          const hadFocus = document.activeElement === row.button;
          row.button.remove();
          row.button = null;
          if (hadFocus) focusOn(marksRegion);
        }
      }
    }
  }

  /* Polling */

  window.setInterval(() => {
    if (form === null) return;
    if (secondsLeft === null || form.readOnly) return;
    secondsLeft = Math.max(0, secondsLeft - 1);
    setText(form.timer, COPY.timeLeft(clock(secondsLeft)));
  }, COUNTDOWN_TICK_MS);

  return {
    root,
    signOut: signOutButton(),
    land: () => {
      window.scrollTo(0, 0);
      focusOn(heading);
    },
    poll: async (state: PollState) => {
      lastRounds = state.rounds;
      const open = state.rounds.find((round) => round.status === 'open') ?? null;
      if (open !== null) {
        showForm(open);
      } else if (form === null) {
        const opened = state.rounds
          .filter((round) => round.status !== 'drafted')
          .sort((left, right) => (left.opened_at ?? '').localeCompare(right.opened_at ?? ''));
        const latest = opened[opened.length - 1];
        if (latest === undefined) showWaiting();
        else showForm(latest);
      }

      const shown = form;
      if (shown !== null) {
        const mine = state.rounds.find((round) => round.number === shown.round.number);
        if (mine !== undefined) {
          shown.round = mine;
          if (mine.status === 'open') {
            secondsLeft = mine.seconds_left;
            setText(shown.timer, COPY.timeLeft(clock(mine.seconds_left ?? 0)));
          } else {
            if (!shown.readOnly) makeReadOnly(shown);
            if (!closedTold.has(mine.number)) {
              closedTold.add(mine.number);
              messages.result(COPY.roundClosed(mine.number));
            }
          }
        }
        const answers = await ask<AnswersBody>({
          method: 'GET',
          path: `/api/rounds/${shown.round.number}/answers`,
        });
        if (answers.ok) fillAccepted(shown, answers.data.answers);
      }

      const team = state.table.teams.find((held) => held.team_id === teamId);
      if (team !== undefined && team.name !== currentName) {
        currentName = team.name;
        setText(teamName, currentName);
      }

      const mine = await ask<{ disputes: Dispute[] }>({ method: 'GET', path: '/api/disputes' });
      if (mine.ok) {
        disputes = mine.data.disputes;
        rulings.note(disputes);
      }
      await drawMarks(state.rounds);
      tiles.apply(state.table);
    },
  };
}
