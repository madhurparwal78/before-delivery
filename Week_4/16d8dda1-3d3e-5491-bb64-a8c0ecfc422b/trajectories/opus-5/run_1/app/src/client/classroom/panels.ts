import type { ChatMessageJson, SessionSnapshot } from '../../shared/types.js';
import { formatClock, percentOf } from '../../shared/rules.js';
import { api } from '../api.js';
import { button, element, keepFocus, labelledInput, setAttributes } from '../dom.js';
import { makeDialog } from '../dialog.js';

export interface PanelHost {
  snapshot: () => SessionSnapshot;
  isOwner: () => boolean;
  act: (control: HTMLButtonElement, run: () => Promise<string | null>) => void;
  chatMessages: () => ChatMessageJson[];
  chatTable: () => string | null;
  setChatTable: (tableId: string) => void;
  sendChat: (text: string) => Promise<string | null>;
  takeSeat: (seatId: string) => void;
}

export interface Panel {
  root: HTMLElement;
  update: () => void;
}

export interface Panels {
  hands: Panel;
  poll: Panel;
  breakout: Panel;
  chat: Panel;
  seats: Panel;
  dialogs: HTMLElement[];
  chatField: HTMLInputElement;
  tickTimer: (remaining: number | null, urgent: boolean) => void;
  update: () => void;
}

function region(name: string, className: string): HTMLElement {
  return element('section', { 'aria-label': name, class: `panel ${className}` }, [element('h2', {}, [name])]);
}

export function createPanels(host: PanelHost): Panels {
  /* Hands */
  const handsRoot = region('Hands', 'hands-panel');
  const handList = element('ul', { 'aria-label': 'Raised hands', class: 'rows' });
  const handsEmpty = element('p', { class: 'meta' }, ['No hands raised.']);
  const raiseHand = button('Raise hand', { class: 'primary', 'data-focus-key': 'raise-hand' });
  const takeNext = button('Take next hand', { class: 'primary', 'data-focus-key': 'take-next' });
  const seatedList = element('ul', { 'aria-label': 'Learners in seats', class: 'rows' });
  const clearSpotlight = button('Clear spotlight', { 'data-focus-key': 'clear-spotlight' });
  handsRoot.append(handList, handsEmpty, raiseHand, takeNext, seatedList, clearSpotlight);

  raiseHand.addEventListener('click', () => {
    const own = host.snapshot().seats.find((seat) => seat.learnerId === host.snapshot().you.learnerId);
    const raised = own?.hand === 'raised';
    host.act(raiseHand, async () => {
      const answer = await api.post(`/api/sessions/${host.snapshot().id}/hand`, { raised: !raised });
      return answer.error;
    });
  });
  takeNext.addEventListener('click', () => {
    host.act(takeNext, async () => {
      const answer = await api.post(`/api/sessions/${host.snapshot().id}/hands/next`);
      return answer.error;
    });
  });
  clearSpotlight.addEventListener('click', () => {
    host.act(clearSpotlight, async () => {
      const answer = await api.post(`/api/sessions/${host.snapshot().id}/spotlight`, { learnerId: null });
      return answer.error;
    });
  });

  const updateHands = (): void => {
    const snapshot = host.snapshot();
    const learner = snapshot.you.role === 'learner';
    const inPlay = snapshot.state === 'live' || snapshot.state === 'breakouts';
    keepFocus(() => {
      handList.replaceChildren();
      for (const hand of snapshot.hands) handList.append(element('li', {}, [hand.displayName]));
      seatedList.replaceChildren();
      if (!learner) {
        for (const seat of snapshot.seats) {
          if (seat.learnerId === null || seat.displayName === null) continue;
          const spotlight = button(`Spotlight ${seat.displayName}`, {
            'aria-pressed': snapshot.spotlight === seat.learnerId ? 'true' : 'false',
            'data-focus-key': `spotlight-${seat.learnerId}`
          });
          const learnerId = seat.learnerId;
          spotlight.addEventListener('click', () => {
            host.act(spotlight, async () => {
              const answer = await api.post(`/api/sessions/${snapshot.id}/spotlight`, { learnerId });
              return answer.error;
            });
          });
          seatedList.append(element('li', {}, [spotlight]));
        }
      }
    });
    handsEmpty.hidden = snapshot.hands.length > 0;
    raiseHand.hidden = !learner || !inPlay;
    const own = snapshot.seats.find((seat) => seat.learnerId === snapshot.you.learnerId);
    raiseHand.textContent = own?.hand === 'raised' ? 'Lower hand' : 'Raise hand';
    takeNext.hidden = learner || !inPlay;
    seatedList.hidden = learner;
    clearSpotlight.hidden = learner || !inPlay;
  };

  /* Poll */
  const pollRoot = region('Poll', 'poll-panel');
  const noPoll = element('p', { class: 'meta' }, ['No poll is open.']);
  const newPoll = button('New poll', { class: 'primary', 'data-focus-key': 'new-poll' });
  const pollGroup = element('div', { role: 'group', 'aria-label': 'Poll', class: 'poll-group' });
  const pollQuestion = element('p', { class: 'poll-question' }, ['']);
  const pollOptions = element('div', { class: 'poll-options' });
  const pollCounts = element('ul', { 'aria-label': 'Poll counts', class: 'rows mono' });
  const closePoll = button('Close poll', { 'data-focus-key': 'close-poll' });
  const pollResults = element('ul', { 'aria-label': 'Poll results', class: 'rows' });
  pollGroup.append(pollQuestion, pollOptions, pollCounts, closePoll);
  pollRoot.append(noPoll, newPoll, pollGroup, pollResults);

  const question = labelledInput('Question');
  const optionFields: { field: HTMLLabelElement; input: HTMLInputElement }[] = [];
  const optionBox = element('div', { class: 'stack' });
  const addOption = button('Add option');
  const openPoll = button('Open poll', { class: 'primary' });
  const cancelPoll = button('Cancel', { class: 'quiet' });
  const pollAlert = element('div', { role: 'alert', class: 'alert', hidden: true });
  const pollDialog = makeDialog('New poll', [
    pollAlert,
    question.field,
    optionBox,
    element('div', { class: 'row' }, [addOption, openPoll, cancelPoll])
  ]);

  const addOptionField = (): void => {
    if (optionFields.length >= 6) return;
    const field = labelledInput(`Option ${optionFields.length + 1}`);
    optionFields.push(field);
    optionBox.append(field.field);
  };
  addOptionField();
  addOptionField();
  addOption.addEventListener('click', addOptionField);
  cancelPoll.addEventListener('click', () => pollDialog.close());
  newPoll.addEventListener('click', () => pollDialog.open(newPoll));
  openPoll.addEventListener('click', () => {
    pollAlert.hidden = true;
    host.act(openPoll, async () => {
      const answer = await api.post(`/api/sessions/${host.snapshot().id}/polls`, {
        question: question.input.value,
        options: optionFields.map((field) => field.input.value).filter((value) => value.trim() !== '')
      });
      if (answer.error !== null) {
        pollAlert.hidden = false;
        pollAlert.textContent = answer.error;
        return null;
      }
      pollDialog.close();
      question.input.value = '';
      for (const field of optionFields) field.input.value = '';
      return null;
    });
  });
  closePoll.addEventListener('click', () => {
    const poll = host.snapshot().poll;
    if (poll === null) return;
    host.act(closePoll, async () => {
      const answer = await api.post(`/api/polls/${poll.pollId}/close`);
      return answer.error;
    });
  });

  const answerOption = (optionNumber: number): void => {
    const poll = host.snapshot().poll;
    if (poll === null || poll.state !== 'open') return;
    const control = pollOptions.querySelector<HTMLButtonElement>(`[data-option="${optionNumber}"]`);
    if (control === null) return;
    host.act(control, async () => {
      const answer = await api.post(`/api/polls/${poll.pollId}/answer`, { option: optionNumber });
      return answer.error;
    });
  };

  const updatePoll = (): void => {
    const snapshot = host.snapshot();
    const poll = snapshot.poll;
    const learner = snapshot.you.role === 'learner';
    const inPlay = snapshot.state === 'live' || snapshot.state === 'breakouts';
    noPoll.hidden = poll !== null;
    newPoll.hidden = learner || !inPlay;
    pollGroup.hidden = poll === null;
    if (poll === null) {
      pollResults.replaceChildren();
      pollResults.hidden = true;
      return;
    }
    pollQuestion.textContent = poll.question;
    keepFocus(() => {
      pollOptions.replaceChildren();
      if (learner && poll.state === 'open') {
        poll.options.forEach((option, index) => {
          const control = button(option, {
            'data-option': String(index + 1),
            'aria-pressed': poll.yourAnswer === index + 1 ? 'true' : 'false',
            'data-focus-key': `option-${index + 1}`
          });
          control.addEventListener('click', () => answerOption(index + 1));
          pollOptions.append(control);
        });
      }
      pollCounts.replaceChildren();
      if (!learner && poll.counts !== null) {
        poll.options.forEach((option, index) => {
          pollCounts.append(element('li', {}, [`${option}: ${poll.counts?.[index] ?? 0}`]));
        });
      }
      pollResults.replaceChildren();
      if (poll.state === 'closed') {
        const counts = poll.counts ?? poll.options.map(() => 0);
        const total = counts.reduce((sum, count) => sum + count, 0);
        poll.options.forEach((option, index) => {
          pollResults.append(element('li', {}, [`${option} ${percentOf(counts[index] ?? 0, total)}%`]));
        });
      }
    });
    pollCounts.hidden = learner || poll.counts === null;
    closePoll.hidden = learner || poll.state !== 'open';
    pollResults.hidden = poll.state !== 'closed';
  };

  /* Breakout */
  const breakoutRoot = region('Breakout', 'breakout-panel');
  const startBreakouts = button('Start breakouts', { class: 'primary', 'data-focus-key': 'start-breakouts' });
  const timer = element('div', { role: 'timer', 'aria-label': 'Breakout time left', class: 'timer mono', 'data-urgent': 'false' }, [
    '00:00'
  ]);
  const addMinutes = button('Add 2 minutes', { 'data-focus-key': 'add-minutes' });
  const tableList = element('ul', { 'aria-label': 'Breakout tables', class: 'rows' });
  breakoutRoot.append(startBreakouts, timer, addMinutes, tableList);

  const tablesInput = element('input', { type: 'number', min: '2', value: '2' });
  const tablesField = element('label', { class: 'field' }, [element('span', {}, ['Tables']), tablesInput]);
  const start = button('Start', { class: 'primary' });
  const cancelBreakouts = button('Cancel', { class: 'quiet' });
  const breakoutAlert = element('div', { role: 'alert', class: 'alert', hidden: true });
  const breakoutDialog = makeDialog('Start breakouts', [
    breakoutAlert,
    tablesField,
    element('div', { class: 'row' }, [start, cancelBreakouts])
  ]);
  cancelBreakouts.addEventListener('click', () => breakoutDialog.close());
  startBreakouts.addEventListener('click', () => breakoutDialog.open(startBreakouts));
  start.addEventListener('click', () => {
    breakoutAlert.hidden = true;
    host.act(start, async () => {
      const answer = await api.post(`/api/sessions/${host.snapshot().id}/breakouts`, {
        tables: Number(tablesInput.value)
      });
      if (answer.error !== null) {
        breakoutAlert.hidden = false;
        breakoutAlert.textContent = answer.error;
        return null;
      }
      breakoutDialog.close();
      return null;
    });
  });
  addMinutes.addEventListener('click', () => {
    host.act(addMinutes, async () => {
      const answer = await api.post(`/api/sessions/${host.snapshot().id}/breakouts/extend`);
      return answer.error;
    });
  });

  const updateBreakout = (): void => {
    const snapshot = host.snapshot();
    const running = snapshot.breakout !== null;
    startBreakouts.hidden = !host.isOwner() || snapshot.state !== 'live';
    addMinutes.hidden = !host.isOwner() || !running;
    timer.hidden = !running;
    if (running && snapshot.breakout !== null) {
      timer.textContent = formatClock(snapshot.breakout.remainingSeconds);
      setAttributes(timer, { 'data-urgent': snapshot.breakout.warning ? 'true' : 'false' });
    }
    keepFocus(() => {
      tableList.replaceChildren();
      if (snapshot.breakout === null) return;
      for (const table of snapshot.breakout.tables) {
        const names = table.learnerIds
          .map((learnerId) => snapshot.seats.find((seat) => seat.learnerId === learnerId)?.displayName ?? '')
          .filter((name) => name !== '');
        tableList.append(element('li', {}, [`${table.tableId}: ${names.join(', ')}`]));
      }
    });
  };

  /* Table chat */
  const chatRoot = region('Table chat', 'chat-panel');
  const tablePicker = element('select', { 'aria-label': 'Table' });
  const chatClosed = element('p', { class: 'meta' }, ['Chat opens when breakouts start.']);
  const log = element('div', { role: 'log', 'aria-label': 'Table messages', class: 'chat-log' });
  const chatField = element('input', { type: 'text', 'aria-label': 'Message your table', class: 'chat-field' });
  const send = button('Send', { class: 'primary', 'data-focus-key': 'send' });
  chatRoot.append(tablePicker, chatClosed, log, chatField, send);

  tablePicker.addEventListener('change', () => host.setChatTable(tablePicker.value));
  const sendMessage = (): void => {
    const text = chatField.value;
    if (text.trim() === '') return;
    host.act(send, async () => {
      const error = await host.sendChat(text);
      if (error === null) chatField.value = '';
      return error;
    });
  };
  send.addEventListener('click', sendMessage);
  chatField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
  });

  const updateChat = (): void => {
    const snapshot = host.snapshot();
    const running = snapshot.breakout !== null;
    tablePicker.hidden = snapshot.you.role !== 'teacher';
    if (snapshot.you.role === 'teacher') {
      const wanted = snapshot.tables.map((table) => table.tableId);
      const current = [...tablePicker.options].map((option) => option.value);
      if (wanted.join() !== current.join()) {
        tablePicker.replaceChildren();
        for (const tableId of wanted) tablePicker.append(element('option', { value: tableId }, [tableId]));
      }
      const chosen = host.chatTable();
      if (chosen !== null) tablePicker.value = chosen;
    }
    chatClosed.hidden = running;
    chatField.disabled = !running;
    send.disabled = !running;
    keepFocus(() => {
      log.replaceChildren();
      for (const message of host.chatMessages()) {
        log.append(
          element('p', {}, [element('span', { class: 'chat-author' }, [`${message.author}: `]), message.text])
        );
      }
    });
  };

  /* Seats, offered as buttons on a phone */
  const seatsRoot = region('Seats', 'seats-panel');
  const seatButtons = element('div', { class: 'seat-buttons' });
  seatsRoot.append(seatButtons);
  const updateSeats = (): void => {
    const snapshot = host.snapshot();
    keepFocus(() => {
      seatButtons.replaceChildren();
      for (const seat of snapshot.seats) {
        const name =
          seat.displayName === null ? `Seat ${seat.seatId}` : `Seat ${seat.seatId}, taken by ${seat.displayName}`;
        const control = button(name, { 'data-focus-key': `seat-${seat.seatId}`, class: 'seat-button' });
        control.addEventListener('click', () => host.takeSeat(seat.seatId));
        seatButtons.append(control);
      }
    });
  };

  const update = (): void => {
    updateHands();
    updatePoll();
    updateBreakout();
    updateChat();
    updateSeats();
  };

  return {
    hands: { root: handsRoot, update: updateHands },
    poll: { root: pollRoot, update: updatePoll },
    breakout: { root: breakoutRoot, update: updateBreakout },
    chat: { root: chatRoot, update: updateChat },
    seats: { root: seatsRoot, update: updateSeats },
    dialogs: [pollDialog.root, breakoutDialog.root],
    chatField,
    tickTimer: (remaining, urgent) => {
      if (remaining === null) return;
      timer.textContent = formatClock(remaining);
      setAttributes(timer, { 'data-urgent': urgent ? 'true' : 'false' });
    },
    update
  };
}

export function answerPollByNumber(panels: Panels, optionNumber: number): void {
  const control = panels.poll.root.querySelector<HTMLButtonElement>(`[data-option="${optionNumber}"]`);
  control?.click();
}
