import { el, roundHalfUp, roundHalfUpInt, ordinal } from './dom.js';

// DOM helpers specific to the words area, certificate and tables.

export interface LetterNode { word: HTMLElement; letters: HTMLElement[] }

/** One element per word, one per letter, with data-index and data-line. */
export function buildWordsArea(wordsArea: HTMLElement, caret: HTMLElement, words: string[]): LetterNode[] {
  wordsArea.textContent = '';
  const nodes: LetterNode[] = [];
  for (let i = 0; i < words.length; i++) {
    const wordEl = el('div', { class: 'word', 'data-index': String(i), 'data-line': '1' }, '');
    const letters: HTMLElement[] = [];
    for (const letter of Array.from(words[i])) {
      const letterEl = el('span', { class: 'letter', 'data-state': 'untyped' }, letter);
      letters.push(letterEl);
      wordEl.appendChild(letterEl);
    }
    wordsArea.appendChild(wordEl);
    nodes.push({ word: wordEl, letters });
  }
  wordsArea.appendChild(caret);
  return nodes;
}

export interface CarbonNode { word: HTMLElement; letters: HTMLElement[] }

/** The carbon: the same structure as the words area, without data-line. */
export function buildCarbon(carbon: HTMLElement, carbonCaret: HTMLElement, words: string[]): CarbonNode[] {
  carbon.textContent = '';
  const nodes: CarbonNode[] = [];
  for (let i = 0; i < words.length; i++) {
    const wordEl = el('div', { class: 'word', 'data-index': String(i) }, '');
    const letters: HTMLElement[] = [];
    for (const letter of words[i]) {
      const letterEl = el('span', { class: 'letter', 'data-state': 'untyped' }, letter);
      letters.push(letterEl);
      wordEl.appendChild(letterEl);
    }
    carbon.appendChild(wordEl);
    nodes.push({ word: wordEl, letters });
  }
  carbon.appendChild(carbonCaret);
  return nodes;
}

/** Set every letter's data-state from the typed state, honouring blind mode. */
export function renderWordStates(
  nodes: { word: HTMLElement; letters: HTMLElement[] }[],
  state: { words: { word: string; typed: string; missed: number }[] },
  fromIndex: number,
  blindMode: boolean,
  maxExtraLetters: number,
): void {
  for (let i = fromIndex; i < nodes.length && i < state.words.length; i++) {
    const word = state.words[i];
    const node = nodes[i];
    const typedLength = blindMode ? word.typed.length : word.typed.length;
    for (let j = 0; j < node.letters.length; j++) {
      let value: string;
      if (word.missed > 0 && j >= word.typed.length && j < word.word.length && j >= word.word.length - word.missed) value = 'missed';
      else if (j < typedLength) {
        if (blindMode) value = 'typed';
        else value = word.typed.charAt(j) === word.word.charAt(j) ? 'correct' : 'incorrect';
      } else value = 'untyped';
      node.letters[j].setAttribute('data-state', value);
    }
    // Extra letters, added after the word's own letters.
    const extras = Math.max(0, Math.min(word.typed.length - word.word.length, maxExtraLetters));
    for (let e = node.letters.length; e < word.word.length + extras; e++) {
      const letterEl = el('span', { class: 'letter letter-extra', 'data-state': blindMode ? 'typed' : 'extra' }, word.typed.charAt(e));
      node.word.appendChild(letterEl);
      node.letters.push(letterEl);
    }
    // Trim extra elements left from earlier renders.
    const keep = word.word.length + extras;
    while (node.letters.length > keep) {
      const last = node.letters.pop();
      last?.remove();
    }
  }
}


/**
 * Number the visible lines 1 to 3 from the words area's visible band, and the
 * words above and below 0 and 4 upward. Words that share a visual row share a
 * line, so a line is the set of words at one top edge.
 */
export function computeVisibleLines(nodes: LetterNode[], wordsArea: HTMLElement): void {
  // Grouping runs in one pass; the caller sequences relayouts per ticket frame.
  const scrollTop = wordsArea.scrollTop;
  const lineStep = Math.max(1, Math.round(wordsArea.clientHeight / 3));
  const origin = nodes[0]?.word.offsetTop ?? 0;

  // Group every word by its content row. A row is one line step tall; words on
  // one row differ by at most a pixel, so take the nearest existing row.
  const rows = new Map<number, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const top = nodes[i].word.offsetTop - origin;
    // Snap to the nearest line step so words on one row always share a bucket.
    const bucket = Math.round(top / lineStep) * lineStep;
    if (!rows.has(bucket)) rows.set(bucket, []);
    rows.get(bucket)?.push(i);
  }

  // The visible band is the area's own height, measured from the scroll position.
  const bandTop = scrollTop;
  const bandBottom = scrollTop + wordsArea.clientHeight;
  // The visible rows are those inside the band, in order.
  const visibleRows = Array.from(rows.keys()).filter((top) => top >= bandTop && top < bandBottom).sort((a, b) => a - b);
  const lineOfRow = new Map<number, number>();
  visibleRows.forEach((top, index) => lineOfRow.set(top, Math.min(3, index + 1)));
  // Every row below the visible band is hidden below; number it 4 and upward.
  const belowRows = Array.from(rows.keys()).filter((top) => top >= bandBottom).sort((a, b) => a - b);
  belowRows.forEach((top, index) => lineOfRow.set(top, 4 + index));
  const aboveRows = Array.from(rows.keys()).filter((top) => top < bandTop).sort((a, b) => b - a);
  aboveRows.forEach((top) => lineOfRow.set(top, 0));

  for (let i = 0; i < nodes.length; i++) {
    const bucket = Math.round((nodes[i].word.offsetTop - origin) / lineStep) * lineStep;
    const line = lineOfRow.get(bucket) ?? 0;
    nodes[i].word.setAttribute('data-line', String(line));
  }
}

export function lineHeightOf(wordsArea: HTMLElement): number {
  const style = getComputedStyle(wordsArea);
  const size = Number(style.fontSize.replace('px', ''));
  return size * 1.5;
}

/** The certificate's figure column. */
export function figureRow(label: string, id: string, value: string): HTMLElement {
  const row = el('div', { class: 'figure-row' }, '');
  row.append(el('span', { class: 'figure-label' }, label), el('span', { class: 'figure-value', id }, value));
  return row;
}

/** The Speed over time chart: one point per second. */
export function buildChart(seconds: { second: number; speed: number }[], maxSpeed: number): { chart: HTMLElement; points: HTMLElement[] } {
  const chart = el('div', { class: 'speed-chart', role: 'img', 'aria-label': 'Speed over time' }, '');
  const width = 260;
  const height = 96;
  const points: HTMLElement[] = [];
  const peak = Math.max(10, maxSpeed);
  seconds.forEach((second, index) => {
    const x = seconds.length === 1 ? 0 : (index / (seconds.length - 1)) * width;
    const y = height - (second.speed / peak) * height;
    const point = el('div', { class: 'chart-point', 'data-second': String(second.second), style: `left:${x}px;top:${y}px` }, '');
    points.push(point);
    chart.appendChild(point);
  });
  chart.setAttribute('style', `position:relative;width:${width}px;height:${height}px`);
  return { chart, points };
}

export function speedOverTimeTable(rows: { second: number; speed: number; raw: number; errors: number }[]): HTMLTableElement {
  const table = el('table', { class: 'data-table', 'aria-label': 'Speed over time' }, '') as unknown as HTMLTableElement;
  const thead = el('thead', {}, '');
  const headRow = el('tr', {}, '');
  headRow.append(el('th', { scope: 'col' }, 'Second'), el('th', { scope: 'col' }, 'Speed'), el('th', { scope: 'col' }, 'Raw'), el('th', { scope: 'col' }, 'Errors'));
  thead.appendChild(headRow);
  const tbody = el('tbody', {}, '');
  for (const row of rows) {
    const tr = el('tr', { 'data-second': String(row.second) }, '');
    tr.append(
      el('td', {}, String(row.second)),
      el('td', {}, roundHalfUp(row.speed).toFixed(2)),
      el('td', {}, roundHalfUp(row.raw).toFixed(2)),
      el('td', {}, String(row.errors)),
    );
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  return table;
}

export function errorsByKeyTable(rows: { key: string; errors: number }[], noErrorsText: string): HTMLElement {
  if (rows.length === 0) return el('p', { class: 'no-errors' }, noErrorsText);
  const table = el('table', { class: 'data-table', 'aria-label': 'Errors by key' }, '') as unknown as HTMLTableElement;
  const thead = el('thead', {}, '');
  const headRow = el('tr', {}, '');
  headRow.append(el('th', { scope: 'col' }, 'Key'), el('th', { scope: 'col' }, 'Errors'));
  thead.appendChild(headRow);
  const tbody = el('tbody', {}, '');
  for (const row of rows) {
    const tr = el('tr', { 'data-key': row.key }, '');
    tr.append(el('td', {}, row.key), el('td', {}, String(row.errors)));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  return table;
}

export { roundHalfUp, roundHalfUpInt, ordinal };
