/** The answer archive: paging in place and plain-text search. */

import type { Answer, ArchiveBody, SearchBody } from '../../shared/model.js';
import { ROUND_NUMBERS } from '../../shared/model.js';
import { LIMITS } from '../../shared/text.js';
import { timeSent } from '../../shared/time.js';
import { ask } from '../api.js';
import { COPY } from '../copy.js';
import { countedField } from '../counter.js';
import { el, focusOn } from '../dom.js';
import type { DeskMessages } from '../messages.js';
import { signOutButton } from '../parts.js';
import type { PollState, Screen } from './screen.js';

const COLUMNS = ['Round', 'Question', 'Team', 'Answer', 'Time sent', 'Mark'] as const;

function answerRow(answer: Answer): HTMLElement {
  const cell = (label: string, value: string, extra: string): HTMLElement =>
    el('td', { role: 'cell', class: `archive-cell cell-${extra}` }, [
      el('span', { class: 'cell-label' }, [label]),
      el('span', { class: 'cell-value' }, [value]),
    ]);
  const answerCell = el('td', { role: 'cell', class: 'archive-cell cell-answer' }, [
    el('span', { class: 'cell-label' }, ['Answer']),
    el('span', { class: 'cell-value' }, [answer.text]),
    el('span', { class: 'cell-time-inline tabular' }, [timeSent(answer.submitted_at)]),
  ]);
  return el('tr', { role: 'row', class: 'archive-row', tabindex: '-1' }, [
    cell('Round', String(answer.round), 'round'),
    cell('Question', String(answer.question), 'question'),
    cell('Team', answer.team_name, 'team'),
    answerCell,
    cell('Time sent', timeSent(answer.submitted_at), 'time'),
    cell('Mark', answer.mark === null ? '' : String(answer.mark), 'mark'),
  ]);
}

function buildTable(name: string): { table: HTMLElement; body: HTMLElement } {
  const body = el('tbody', { role: 'rowgroup' });
  const head = el('tr', { role: 'row' }, COLUMNS.map((column) =>
    el('th', { role: 'columnheader', scope: 'col', class: `archive-head head-${column.toLowerCase().replace(' ', '-')}` }, [column]),
  ));
  const table = el('table', { role: 'table', 'aria-label': name, class: 'archive-table' }, [
    el('thead', { role: 'rowgroup' }, [head]),
    body,
  ]);
  return { table, body };
}

export function archiveScreen(messages: DeskMessages): Screen {
  const heading = el('h1', { class: 'desk-heading', tabindex: '-1' }, ['Answer archive']);

  const searchField = el('input', { type: 'search', class: 'field', 'aria-label': 'Search answers', id: 'search-answers' });
  const searchCounted = countedField({
    field: searchField,
    limit: LIMITS.searchQuery,
    overLimitCopy: COPY.searchTooLong,
    messages,
  });
  const roundFilter = el('select', { class: 'field', 'aria-label': 'Round', id: 'search-round' }, [
    el('option', { value: 'all' }, ['All rounds']),
    ...ROUND_NUMBERS.map((number) => el('option', { value: String(number) }, [`Round ${number}`])),
  ]);
  const searchButton = el('button', { type: 'button', class: 'button' }, ['Search']);
  const searchBar = el('div', { class: 'search-bar' }, [
    el('div', { class: 'search-field-row' }, [searchField, searchCounted.counter, searchCounted.error]),
    el('div', { class: 'search-controls' }, [roundFilter, searchButton]),
  ]);

  const results = buildTable('Search results');
  const resultsHolder = el('div', { class: 'search-results' }, [results.table]);
  resultsHolder.hidden = true;

  const archive = buildTable('Answer archive');
  const more = el('button', { type: 'button', class: 'button' }, ['More answers']);

  const root = el('div', { class: 'screen screen-archive' }, [
    messages.region,
    heading,
    searchBar,
    resultsHolder,
    archive.table,
    more,
  ]);

  let cursor: string | null = null;
  let resultRows: HTMLElement[] = [];
  let caret = 0;

  async function page(): Promise<void> {
    messages.pending(COPY.archivePending);
    const path = cursor === null ? '/api/answers' : `/api/answers?cursor=${encodeURIComponent(cursor)}`;
    const outcome = await ask<ArchiveBody>({ method: 'GET', path });
    if (!outcome.ok) {
      messages.result(COPY.unreachable);
      return;
    }
    if (outcome.data.answers.length === 0) {
      messages.result(COPY.archiveEmpty);
      focusOn(more);
      return;
    }
    messages.result('');
    const rows = outcome.data.answers.map(answerRow);
    for (const row of rows) archive.body.append(row);
    cursor = outcome.data.next_cursor ?? cursor;
    focusOn(rows[0] ?? null);
  }

  async function runSearch(): Promise<void> {
    const query = searchField.value;
    if (query.trim() === '') {
      messages.result(COPY.searchEmpty);
      return;
    }
    messages.pending(COPY.searchPending);
    const chosen = roundFilter.value;
    const outcome = await ask<SearchBody>({
      method: 'POST',
      path: '/api/answers/search',
      body: chosen === 'all' ? { query } : { query, round: Number(chosen) },
    });
    if (!outcome.ok) {
      if (outcome.error?.error === 'search_timeout') messages.result(COPY.searchTimeout);
      else if (outcome.error?.fields?.['query'] === 'too_long') messages.result(COPY.searchTooLong);
      else if (outcome.error?.fields?.['query'] === 'required') messages.result(COPY.searchEmpty);
      else messages.result(COPY.unreachable);
      return;
    }
    resultsHolder.hidden = false;
    resultRows = outcome.data.answers.map(answerRow);
    results.body.replaceChildren(...resultRows);
    messages.result(outcome.data.count === 0 ? COPY.searchNone(query) : COPY.searchDone(outcome.data.count));
  }

  searchButton.addEventListener('click', () => void runSearch());
  searchField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runSearch();
      focusOn(searchField);
      return;
    }
    if (event.key !== 'ArrowDown') return;
    if (resultRows.length === 0) return;
    event.preventDefault();
    caret = searchField.selectionStart ?? searchField.value.length;
    focusOn(resultRows[0] ?? null);
  });

  results.body.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    const at = resultRows.findIndex((row) => row === active);
    if (at === -1) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOn(resultRows[Math.min(resultRows.length - 1, at + 1)] ?? null);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOn(resultRows[Math.max(0, at - 1)] ?? null);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusOn(resultRows[0] ?? null);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusOn(resultRows[resultRows.length - 1] ?? null);
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    focusOn(searchField);
    searchField.setSelectionRange(caret, caret);
  });

  more.addEventListener('click', () => void page());

  return {
    root,
    signOut: signOutButton(),
    land: () => {
      window.scrollTo(0, 0);
      focusOn(heading);
      void firstPage();
    },
    poll: async (_state: PollState) => {
      /* polls never reload the archive table or the search results */
    },
  };

  async function firstPage(): Promise<void> {
    const outcome = await ask<ArchiveBody>({ method: 'GET', path: '/api/answers' });
    if (!outcome.ok) return;
    for (const answer of outcome.data.answers) archive.body.append(answerRow(answer));
    cursor = outcome.data.next_cursor ?? cursor;
  }
}
