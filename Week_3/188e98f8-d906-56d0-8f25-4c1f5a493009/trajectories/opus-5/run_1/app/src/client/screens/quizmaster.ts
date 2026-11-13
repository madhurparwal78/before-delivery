/** The quizmaster's desk: round cards, the dispute queue and the ruling dialog. */

import type { Dispute, LeagueTable, Round } from '../../shared/model.js';
import { roundStatusLabel } from '../../shared/model.js';
import { ask } from '../api.js';
import { COPY } from '../copy.js';
import { el, focusOn, setText } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import { Pane } from '../pane.js';
import { signOutButton } from '../parts.js';
import type { TileGrid } from '../tiles.js';
import type { PollState, Screen } from './screen.js';

interface Card {
  article: HTMLElement;
  status: HTMLElement;
  sheetStatus: HTMLElement | null;
  outage: HTMLElement;
  controls: HTMLElement;
  open: HTMLButtonElement;
  close: HTMLButtonElement;
  publish: HTMLButtonElement;
  file: HTMLInputElement | null;
  fileLabel: HTMLElement | null;
  upload: HTMLButtonElement | null;
  round: Round;
}

export function quizmasterScreen(tiles: TileGrid, messages: DeskMessages): Screen {
  const heading = el('h1', { class: 'desk-heading', tabindex: '-1' }, ["Quizmaster's desk"]);
  const cardsHolder = el('div', { class: 'round-cards' });
  const queue = el('div', { class: 'dispute-queue' });
  const disputesHeading = el('h2', { tabindex: '-1' }, ['Disputes']);
  const disputesRegion = el('section', { role: 'region', 'aria-label': 'Disputes', class: 'disputes' }, [
    disputesHeading,
    queue,
  ]);
  const root = el('div', { class: 'screen screen-quizmaster' }, [
    messages.region,
    heading,
    el('div', { class: 'desk-columns' }, [cardsHolder, disputesRegion]),
    tiles.region,
  ]);

  const cards = new Map<number, Card>();
  const queued = new Map<number, { button: HTMLButtonElement; dispute: Dispute }>();
  let queueOrder: number[] = [];
  let ruling: { dispute: Dispute; order: number[] } | null = null;

  /* The ruling dialog */

  const answerLine = el('p', { class: 'ruling-answer' });
  const reasonLine = el('p', { class: 'ruling-reason' });
  const uphold = el('input', { type: 'radio', name: 'ruling', class: 'ruling-radio' });
  const dismiss = el('input', { type: 'radio', name: 'ruling', class: 'ruling-radio' });
  const rulingGroup = el('div', { role: 'radiogroup', 'aria-label': 'Ruling', class: 'ruling-choices' }, [
    el('label', { class: 'mark-choice' }, [uphold, el('span', {}, ['Uphold'])]),
    el('label', { class: 'mark-choice' }, [dismiss, el('span', {}, ['Dismiss'])]),
  ]);
  const saveRuling = el('button', { type: 'button', class: 'button' }, ['Save ruling']);
  const cancelRuling = el('button', { type: 'button', class: 'button button-quiet' }, ['Cancel']);
  const rulingPane = new Pane({
    name: 'Rule on dispute',
    stops: () => [dismiss.checked ? dismiss : uphold, saveRuling, cancelRuling],
    firstStop: () => uphold,
    opener: () => {
      if (ruling === null) return disputesHeading;
      // A dispute ruled on another device leaves the queue; focus moves on in queue order.
      return queued.get(ruling.dispute.id)?.button ?? nextRuleButton(ruling.dispute.id, ruling.order);
    },
  });
  rulingPane.body.append(
    el('h2', {}, ['Rule on dispute']),
    answerLine,
    reasonLine,
    rulingGroup,
    el('div', { class: 'pane-actions' }, [saveRuling, cancelRuling]),
  );
  cancelRuling.addEventListener('click', () => rulingPane.hide());
  rulingPane.dialog.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'u' && key !== 'd') return;
    event.preventDefault();
    if (key === 'u') uphold.checked = true;
    else dismiss.checked = true;
  });
  saveRuling.addEventListener('click', () => {
    const open = ruling;
    if (open === null) return;
    const chosen = uphold.checked ? 'upheld' : dismiss.checked ? 'dismissed' : null;
    messages.pending(COPY.rulingPending);
    void (async () => {
      const outcome = await ask<{ dispute: Dispute }>({
        method: 'POST',
        path: `/api/disputes/${open.dispute.id}/ruling`,
        body: { ruling: chosen },
      });
      if (outcome.ok) {
        messages.result(COPY.rulingDone);
        rulingPane.hide(null);
        await refreshQueue();
        focusOn(nextRuleButton(open.dispute.id, open.order));
        return;
      }
      if (outcome.error?.error === 'dispute_already_ruled') {
        messages.result(COPY.alreadyRuled);
        return;
      }
      // No ruling chosen yet: the dialog waits for Uphold or Dismiss.
      messages.result(outcome.error?.fields?.['ruling'] === undefined ? COPY.unreachable : '');
      focusOn(saveRuling);
    })();
  });

  function nextRuleButton(id: number, order: number[]): HTMLElement {
    const at = order.indexOf(id);
    for (const held of order.slice(at + 1)) {
      const found = queued.get(held);
      if (found !== undefined) return found.button;
    }
    const first = queueOrder.map((held) => queued.get(held)).find((held) => held !== undefined);
    return first?.button ?? disputesHeading;
  }

  async function refreshQueue(): Promise<void> {
    const outcome = await ask<{ disputes: Dispute[] }>({ method: 'GET', path: '/api/disputes' });
    if (!outcome.ok) return;
    drawQueue(outcome.data.disputes, lastTable);
  }

  let lastTable: LeagueTable | null = null;

  function teamName(teamId: number): string {
    return lastTable?.teams.find((team) => team.team_id === teamId)?.name ?? '';
  }

  function drawQueue(disputes: Dispute[], table: LeagueTable | null): void {
    lastTable = table;
    const raised = disputes.filter((dispute) => dispute.status === 'raised');
    queueOrder = raised.map((dispute) => dispute.id);
    for (const [id, held] of queued) {
      if (queueOrder.includes(id)) continue;
      held.button.remove();
      queued.delete(id);
    }
    for (const dispute of raised) {
      const held = queued.get(dispute.id);
      const name = `Rule on ${teamName(dispute.team_id)}, round ${dispute.round}, question ${dispute.question}`;
      if (held === undefined) {
        const button = el('button', { type: 'button', class: 'button' }, [name]);
        button.addEventListener('click', () => {
          ruling = { dispute, order: [...queueOrder] };
          setText(answerLine, dispute.answer_text);
          setText(reasonLine, dispute.reason);
          uphold.checked = false;
          dismiss.checked = false;
          rulingPane.show();
        });
        queue.append(button);
        queued.set(dispute.id, { button, dispute });
        continue;
      }
      held.dispute = dispute;
      setText(held.button, name);
      queue.append(held.button);
    }
  }

  /* Round cards */

  function buildCard(round: Round): Card {
    const status = el('span', { class: 'round-status' });
    const outage = el('p', { class: 'card-outage' });
    const controls = el('div', { class: 'card-controls' });
    const article = el('article', { class: 'card round-card', 'aria-label': `Round ${round.number}`, tabindex: '-1' }, [
      el('h2', {}, [`Round ${round.number}: ${round.title}`]),
      status,
    ]);
    const card: Card = {
      article,
      status,
      sheetStatus: null,
      outage,
      controls,
      open: el('button', { type: 'button', class: 'button' }, [`Open round ${round.number}`]),
      close: el('button', { type: 'button', class: 'button' }, [`Close round ${round.number}`]),
      publish: el('button', { type: 'button', class: 'button' }, [`Publish round ${round.number}`]),
      file: null,
      fileLabel: null,
      upload: null,
      round,
    };
    if (round.kind === 'picture') {
      card.sheetStatus = el('span', { class: 'sheet-status' });
      const id = `sheet-file-${round.number}`;
      card.file = el('input', { type: 'file', id, class: 'file-field', accept: 'image/png,image/jpeg' });
      card.fileLabel = el('label', { class: 'field-label', for: id }, [
        `Picture sheet for round ${round.number}`,
      ]);
      card.upload = el('button', { type: 'button', class: 'button' }, [
        `Upload sheet for round ${round.number}`,
      ]);
      card.upload.addEventListener('click', () => void upload(card));
      article.append(card.sheetStatus);
    }
    article.append(outage, controls);
    card.open.addEventListener('click', () => void openRound(card));
    card.close.addEventListener('click', () => void closeRound(card));
    card.publish.addEventListener('click', () => void publishRound(card));
    return card;
  }

  function applyRound(card: Card, round: Round): void {
    const hadFocus = document.activeElement;
    card.round = round;
    setText(card.status, roundStatusLabel(round.status));
    if (card.sheetStatus !== null) {
      setText(card.sheetStatus, round.sheet?.status === 'stored' ? 'Sheet stored' : 'Sheet not stored');
    }
    const wanted: HTMLElement[] = [];
    if (round.status === 'drafted') {
      wanted.push(card.open);
      if (card.file !== null && card.fileLabel !== null && card.upload !== null) {
        wanted.push(card.fileLabel, card.file, card.upload);
      }
    } else if (round.status === 'open') wanted.push(card.close);
    else if (round.status === 'marked') wanted.push(card.publish);

    for (const child of [...card.controls.children]) {
      if (wanted.includes(child as HTMLElement)) continue;
      const held = child === hadFocus;
      child.remove();
      if (held) focusOn(card.article);
    }
    for (const control of wanted) {
      if (control.parentElement !== card.controls) card.controls.append(control);
    }
  }

  async function openRound(card: Card): Promise<void> {
    messages.pending(COPY.openPending(card.round.number));
    const outcome = await ask<{ round: Round }>({
      method: 'POST',
      path: `/api/rounds/${card.round.number}/open`,
    });
    setText(card.outage, '');
    if (outcome.ok) {
      messages.result(COPY.openDone(card.round.number));
      applyRound(card, outcome.data.round);
      focusOn(card.close);
      return;
    }
    if (outcome.error?.error === 'sheet_not_stored') {
      messages.result(COPY.sheetMissing(card.round.number));
    } else if (outcome.error?.error === 'another_round_open') {
      messages.result(COPY.anotherOpen);
    } else if (outcome.error?.error === 'storage_unavailable') {
      messages.result(COPY.sheetOutage);
      setText(card.outage, COPY.sheetOutage);
    } else {
      messages.result(COPY.unreachable);
    }
    focusOn(card.open);
  }

  async function closeRound(card: Card): Promise<void> {
    messages.pending(COPY.closePending(card.round.number));
    const outcome = await ask<{ round: Round }>({
      method: 'POST',
      path: `/api/rounds/${card.round.number}/close`,
    });
    if (outcome.ok) {
      messages.result(COPY.closeDone(card.round.number));
      applyRound(card, outcome.data.round);
      focusOn(card.article);
      return;
    }
    messages.result(COPY.unreachable);
    focusOn(card.close);
  }

  async function publishRound(card: Card): Promise<void> {
    messages.pending(COPY.publishPending(card.round.number));
    const outcome = await ask<{ round: Round; table: LeagueTable }>({
      method: 'POST',
      path: `/api/rounds/${card.round.number}/publish`,
    });
    if (outcome.ok) {
      messages.result('');
      applyRound(card, outcome.data.round);
      focusOn(card.article);
      tiles.apply(outcome.data.table);
      return;
    }
    if (outcome.error?.error === 'disputes_pending') {
      messages.result(COPY.disputesPending(card.round.number, outcome.error.count ?? 0));
    } else {
      messages.result(COPY.unreachable);
    }
    focusOn(card.publish);
  }

  async function upload(card: Card): Promise<void> {
    const file = card.file?.files?.[0] ?? null;
    const button = card.upload;
    if (button === null) return;
    if (file === null) {
      messages.result(COPY.noFileChosen);
      focusOn(button);
      return;
    }
    messages.pending(COPY.uploadPending);
    const outcome = await ask<{ round: Round }>({
      method: 'PUT',
      path: `/api/rounds/${card.round.number}/sheet`,
      bytes: { data: await file.arrayBuffer(), contentType: file.type === '' ? 'application/octet-stream' : file.type },
    });
    setText(card.outage, '');
    if (outcome.ok) {
      messages.result(COPY.uploadDone(card.round.number));
      applyRound(card, outcome.data.round);
      focusOn(button);
      return;
    }
    if (outcome.status === 413) messages.result(COPY.sheetTooLarge);
    else if (outcome.status === 415) messages.result(COPY.sheetWrongType);
    else if (outcome.error?.fields?.['body'] === 'invalid') messages.result(COPY.sheetDimensions);
    else if (outcome.error?.fields?.['body'] === 'required') messages.result(COPY.sheetWrongType);
    else if (outcome.error?.error === 'storage_unavailable') {
      messages.result(COPY.sheetOutage);
      setText(card.outage, COPY.sheetOutage);
    } else messages.result(COPY.unreachable);
    focusOn(button);
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
        let card = cards.get(round.number);
        if (card === undefined) {
          card = buildCard(round);
          cards.set(round.number, card);
          cardsHolder.append(card.article);
        }
        applyRound(card, round);
      }
      const disputes = await ask<{ disputes: Dispute[] }>({ method: 'GET', path: '/api/disputes' });
      if (disputes.ok) drawQueue(disputes.data.disputes, state.table);
      tiles.apply(state.table);
    },
  };
}
