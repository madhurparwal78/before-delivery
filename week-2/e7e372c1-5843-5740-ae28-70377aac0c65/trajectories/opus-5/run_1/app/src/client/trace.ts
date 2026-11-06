/**
 * Unspool: the figure trace. It opens pinned to one stored computation and runs
 * the four-step sequence, with one thread per filed input.
 */
import { BOARD_COPY, lastTickLine, officialCloseLine } from './copy';
import { containFocus, element, isTabletUp, prefersReducedMotion, svgElement } from './dom';
import { displayOf, newYorkFields } from './format';
import { CLOCK_BADGES, ROW_KEYS, ROW_LABELS, RowKey } from '../shared/labels';
import { Computation, ComputationInput, HistoryRow } from './types';

const OPEN_DELAY_MS = 167;
const CLOSE_REMOVE_MS = 450;

export interface TraceHost {
  tile: HTMLElement;
  numeral: HTMLElement;
  chipHost: HTMLElement;
  opener: HTMLElement;
  computation: Computation;
  exhibitRows: HistoryRow | null;
  marketDate: string | null;
  onStep: ((inputKey: string) => void) | null;
  onClose: () => void;
  /** Opens at the sequence's end state, which a shared citation URL does. */
  instant?: boolean;
  initialInputKey?: string | null;
}

export interface TraceController {
  readonly computation: Computation;
  readonly tile: HTMLElement;
  close(): void;
  selectInput(key: string): void;
  selectedInput(): string;
}

let active: TraceController | null = null;

export function activeTrace(): TraceController | null {
  return active;
}

const MNAV_FORMULA =
  'Share price times assumed diluted shares, divided by ending ETH balance times ETH price.';

function operatorsFor(figure: string): string[] {
  switch (figure) {
    case 'eth-held':
      return ['+', '+'];
    case 'eth-per-1000-diluted':
      return ['\u00f7'];
    default:
      return [];
  }
}

function trailingOperator(figure: string): string | null {
  return figure === 'eth-per-1000-diluted' ? '\u00d7 1,000' : null;
}

function badgeOf(input: ComputationInput): string {
  return CLOCK_BADGES[input.clock];
}

function isFiled(input: ComputationInput): boolean {
  return input.source.kind === 'exhibit';
}

function exhibitSourceOf(computation: Computation) {
  for (const input of computation.inputs) {
    if (input.source.kind === 'exhibit') return input.source;
  }
  return null;
}

function rowDisplay(rows: HistoryRow, key: RowKey): string {
  switch (key) {
    case 'beginning-balance':
      return displayOf(rows.beginning_balance, 'eth');
    case 'eth-acquired':
      return displayOf(rows.eth_acquired, 'eth');
    case 'staking-rewards':
      return displayOf(rows.staking_rewards, 'eth');
    case 'ending-balance':
      return displayOf(rows.ending_balance, 'eth');
    case 'cumulative-staking-rewards':
      return displayOf(rows.cumulative_staking_rewards, 'eth');
    case 'diluted-shares':
      return displayOf(rows.diluted_shares, 'shares');
  }
}

interface ChipEntry {
  key: string;
  node: HTMLElement;
}

interface ThreadEntry {
  key: string;
  path: SVGPathElement;
  chip: HTMLElement;
  row: HTMLElement;
}

export function openTrace(host: TraceHost): TraceController {
  active?.close();
  const reducedMotion = prefersReducedMotion();
  const computation = host.computation;
  const inputs = computation.inputs;
  const exhibit = exhibitSourceOf(computation);

  // --- Step 1 and 2: the numeral splits into its operand chips. ---
  const chips: ChipEntry[] = [];
  const chipArea = element('div', { className: reducedMotion ? 'unspool-list-area' : 'unspool-chips' });

  if (computation.figure === 'mnav') {
    chipArea.appendChild(
      element('p', { className: 'unspool-formula', text: MNAV_FORMULA, attributes: { 'aria-hidden': 'true' } }),
    );
  }

  const chipRow = element(reducedMotion ? 'ol' : 'div', {
    className: reducedMotion ? 'unspool-list' : 'unspool-chip-row',
    attributes: { 'aria-hidden': 'true' },
  });
  const operators = operatorsFor(computation.figure);
  inputs.forEach((input, index) => {
    if (!reducedMotion && index > 0 && operators[index - 1] !== undefined) {
      chipRow.appendChild(
        element('span', { className: 'unspool-operator', text: operators[index - 1] as string }),
      );
    }
    const detail: HTMLElement[] = [
      element('span', { className: 'unspool-chip-label', text: input.label }),
      element('span', { className: 'clock-badge', text: badgeOf(input) }),
      element('span', { className: 'unspool-chip-asof', text: newYorkFields(input.as_of).time }),
    ];
    if (input.source.kind === 'tick') {
      detail.push(
        element('span', {
          className: 'unspool-chip-tick',
          text: lastTickLine(newYorkFields(input.source.at).time),
        }),
      );
    }
    if (reducedMotion && input.source.kind === 'exhibit') {
      detail.push(
        element('span', {
          className: 'unspool-chip-source',
          text: `Exhibit ${input.source.accession} p. ${input.source.page} \u2014 ${input.source.row}`,
        }),
      );
    }
    const chip = element(reducedMotion ? 'li' : 'span', {
      className: 'unspool-chip',
      attributes: {
        'data-unspool-chip': input.key,
        ...(input.sets_as_of ? { 'data-sets-as-of': 'true' } : {}),
      },
      children: detail,
    });
    chip.addEventListener('click', () => controller.selectInput(input.key));
    chipRow.appendChild(chip);
    chips.push({ key: input.key, node: chip });
  });
  const trailing = trailingOperator(computation.figure);
  if (!reducedMotion && trailing !== null) {
    chipRow.appendChild(element('span', { className: 'unspool-operator', text: trailing }));
  }
  chipArea.appendChild(chipRow);
  host.chipHost.appendChild(chipArea);
  host.numeral.classList.add('numeral-split');

  // --- Step 3: the panel, its input list and the cited exhibit table. ---
  const panel = element('div', {
    className: 'trace-panel',
    attributes: { role: 'dialog', 'aria-label': `Trace: ${computation.label}` },
  });

  const inputList = element('ul', {
    className: 'trace-inputs',
    attributes: { role: 'list', 'aria-label': 'Inputs' },
  });
  const inputButtons = new Map<string, HTMLButtonElement>();
  for (const input of inputs) {
    const button = element('button', {
      className: 'trace-input-button',
      text: input.label,
      attributes: { type: 'button', 'aria-pressed': 'false' },
    });
    button.addEventListener('click', () => controller.selectInput(input.key));
    inputButtons.set(input.key, button);
    const meta: HTMLElement[] = [
      element('span', { className: 'clock-badge', text: badgeOf(input) }),
      element('span', {
        className: 'trace-input-asof',
        text: `${newYorkFields(input.as_of).date} ${newYorkFields(input.as_of).time} ET`,
      }),
    ];
    if (input.source.kind === 'tick') {
      meta.push(
        element('span', {
          className: 'trace-input-tick',
          text: lastTickLine(newYorkFields(input.source.at).time),
        }),
      );
    }
    if (input.sets_as_of) {
      meta.push(element('span', { className: 'trace-sets-asof', text: BOARD_COPY.setsAsOf }));
    }
    inputList.appendChild(
      element('li', {
        className: 'trace-input',
        children: [button, element('span', { className: 'trace-input-meta', children: meta })],
      }),
    );
  }
  panel.appendChild(inputList);

  const selectedDetail = element('p', { className: 'trace-selected-detail' });
  panel.appendChild(selectedDetail);

  const exhibitRowNodes = new Map<string, HTMLElement>();
  if (exhibit !== null) {
    const body = element('tbody', { attributes: { role: 'rowgroup' } });
    for (const key of ROW_KEYS) {
      const label = ROW_LABELS[key];
      const value =
        host.exhibitRows === null
          ? (inputs.find((input) => input.key === key)?.display ?? '\u2014')
          : rowDisplay(host.exhibitRows, key);
      const row = element('tr', {
        className: 'trace-exhibit-row',
        attributes: { role: 'row' },
        children: [
          element('th', { attributes: { scope: 'row', role: 'rowheader' }, text: label }),
          element('td', { attributes: { role: 'cell' }, className: 'numeric', text: value }),
        ],
      });
      body.appendChild(row);
      exhibitRowNodes.set(key, row);
    }
    panel.appendChild(
      element('table', {
        className: 'trace-exhibit',
        attributes: {
          role: 'table',
          'aria-label': `Exhibit ${exhibit.accession} page ${exhibit.page}`,
        },
        children: [body],
      }),
    );
    panel.appendChild(element('p', { className: 'trace-provenance', text: `Accession ${exhibit.accession}` }));
    panel.appendChild(element('p', { className: 'trace-provenance', text: `SHA-256 ${exhibit.sha256}` }));
  }

  const downloadStatus = element('div', {
    className: 'trace-download-status',
    attributes: { role: 'status', 'aria-label': 'Exhibit download', 'aria-live': 'polite' },
  });

  if (exhibit !== null) {
    const exhibitLink = element('a', {
      className: 'trace-exhibit-link',
      text: `Open exhibit ${exhibit.accession}`,
      attributes: { href: `/api/exhibits/${exhibit.sha256}` },
    });
    exhibitLink.addEventListener('click', (event) => {
      event.preventDefault();
      void downloadExhibit(exhibitLink.getAttribute('href') ?? '', exhibit.accession, downloadStatus);
    });
    panel.appendChild(exhibitLink);
  }
  panel.appendChild(downloadStatus);

  let citeLink: HTMLAnchorElement | null = null;
  if (host.marketDate !== null) {
    citeLink = element('a', {
      className: 'trace-cite-link',
      text: BOARD_COPY.citeFigure,
      attributes: { href: `/cite/${computation.figure}/${host.marketDate}` },
    });
    panel.appendChild(citeLink);
  }

  const closeButton = element('button', {
    className: 'trace-close',
    text: BOARD_COPY.closeTrace,
    attributes: { type: 'button', 'aria-label': 'Close trace' },
  });
  panel.appendChild(closeButton);
  document.body.appendChild(panel);

  // --- Step 3 continued: one ultramarine thread per filed input. ---
  let threadLayer: SVGSVGElement | null = null;
  let threads: ThreadEntry[] = [];

  function buildThreads(animate: boolean): void {
    if (reducedMotion || !isTabletUp()) return;
    threadLayer = svgElement('svg', { class: 'unspool-threads', 'aria-hidden': 'true' });
    threads = [];
    for (const input of inputs) {
      if (!isFiled(input)) continue;
      const chip = chips.find((candidate) => candidate.key === input.key);
      const row = exhibitRowNodes.get(input.key);
      if (chip === undefined || row === undefined) continue;
      const path = svgElement('path', {
        class: 'unspool-thread',
        'data-unspool-thread': input.key,
        fill: 'none',
      });
      threadLayer.appendChild(path);
      threads.push({ key: input.key, path, chip: chip.node, row });
    }
    document.body.appendChild(threadLayer);
    anchorThreads(animate);
  }

  /**
   * The panel may still be sliding in, so an exhibit row's measured position
   * carries the panel's transform. Anchoring to its settled position keeps each
   * thread inside its row without redrawing when the slide finishes.
   */
  function panelTranslate(): { x: number; y: number } {
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(panel).transform);
    return { x: matrix.m41, y: matrix.m42 };
  }

  function anchorThreads(animate: boolean): void {
    if (threadLayer === null) return;
    threadLayer.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    threadLayer.setAttribute('width', String(window.innerWidth));
    threadLayer.setAttribute('height', String(window.innerHeight));
    const settle = panelTranslate();
    for (const thread of threads) {
      const chipBox = thread.chip.getBoundingClientRect();
      const rowBox = thread.row.getBoundingClientRect();
      const fromX = chipBox.left + chipBox.width / 2;
      const fromY = chipBox.top + chipBox.height / 2;
      const toX = rowBox.left - settle.x + Math.min(24, rowBox.width / 2);
      const toY = rowBox.top - settle.y + rowBox.height / 2;
      const midX = (fromX + toX) / 2;
      thread.path.setAttribute('d', `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`);
      const length = thread.path.getTotalLength();
      thread.path.style.strokeDasharray = `${length}`;
      if (animate) {
        thread.path.style.transition = 'none';
        thread.path.style.strokeDashoffset = `${length}`;
        requestAnimationFrame(() => {
          thread.path.style.transition = 'stroke-dashoffset 400ms cubic-bezier(0.2, 0.9, 0.3, 1)';
          thread.path.style.strokeDashoffset = '0';
        });
      } else {
        thread.path.style.transition = 'none';
        thread.path.style.strokeDashoffset = '0';
      }
    }
  }

  function removeThreads(): void {
    threadLayer?.remove();
    threadLayer = null;
    threads = [];
  }

  let anchorQueued = false;
  function queueAnchor(): void {
    if (anchorQueued || threadLayer === null) return;
    anchorQueued = true;
    requestAnimationFrame(() => {
      anchorQueued = false;
      anchorThreads(false);
    });
  }

  const requestedKey = host.initialInputKey ?? null;
  let selected =
    requestedKey !== null && inputs.some((candidate) => candidate.key === requestedKey)
      ? requestedKey
      : (inputs[0]?.key ?? '');

  function applySelection(): void {
    const input = inputs.find((candidate) => candidate.key === selected);
    for (const [key, button] of inputButtons) {
      button.setAttribute('aria-pressed', key === selected ? 'true' : 'false');
    }
    for (const chip of chips) {
      chip.node.classList.toggle('chip-selected', chip.key === selected);
    }
    for (const [key, row] of exhibitRowNodes) {
      if (input !== undefined && isFiled(input) && key === selected) {
        row.setAttribute('aria-current', 'true');
      } else {
        row.removeAttribute('aria-current');
      }
    }
    if (input === undefined) {
      selectedDetail.textContent = '';
    } else if (input.source.kind === 'tick') {
      selectedDetail.textContent = lastTickLine(newYorkFields(input.source.at).time);
    } else if (input.source.kind === 'official_close') {
      selectedDetail.textContent = officialCloseLine(
        input.source.date,
        newYorkFields(input.as_of).shortTime,
      );
    } else {
      selectedDetail.textContent = '';
    }
    if (citeLink !== null && host.marketDate !== null) {
      citeLink.setAttribute('href', `/cite/${computation.figure}/${host.marketDate}?step=${selected}`);
    }
  }

  let closing = false;

  function close(): void {
    if (closing) return;
    closing = true;
    if (active === controller) active = null;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', queueAnchor, true);
    panel.removeEventListener('scroll', queueAnchor, true);
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    panel.classList.remove('trace-open');
    chipArea.classList.remove('chips-open');
    document.body.classList.remove('trace-sheet-open', 'trace-panel-open');
    for (const thread of threads) {
      const length = thread.path.getTotalLength();
      thread.path.style.transition = 'stroke-dashoffset 250ms ease-in';
      thread.path.style.strokeDashoffset = `${length}`;
    }
    const finish = (): void => {
      removeThreads();
      panel.remove();
      chipArea.remove();
      host.numeral.classList.remove('numeral-split');
      host.onClose();
    };
    if (reducedMotion) finish();
    else window.setTimeout(finish, CLOSE_REMOVE_MS);
    host.opener.focus();
  }

  /** The side panel reserves its own width, so no tile sits under it. */
  function applyPanelInset(): void {
    document.body.classList.toggle('trace-sheet-open', !isTabletUp());
    document.body.classList.toggle('trace-panel-open', isTabletUp());
  }

  function onResize(): void {
    applyPanelInset();
    if (!isTabletUp()) {
      removeThreads();
      return;
    }
    if (threadLayer === null) buildThreads(false);
    else queueAnchor();
  }

  function onOutsidePointer(event: Event): void {
    if (!isTabletUp()) return;
    const target = event.target as Node | null;
    if (target === null) return;
    if (panel.contains(target) || chipArea.contains(target) || host.opener.contains(target)) return;
    close();
  }

  function stepBy(offset: number): void {
    const index = inputs.findIndex((candidate) => candidate.key === selected);
    const next = inputs[(index + offset + inputs.length) % inputs.length];
    if (next !== undefined) controller.selectInput(next.key);
  }

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === ']') {
      event.preventDefault();
      stepBy(1);
      return;
    }
    if (event.key === '[') {
      event.preventDefault();
      stepBy(-1);
      return;
    }
    containFocus(panel, event);
  });
  closeButton.addEventListener('click', () => close());

  const controller: TraceController = {
    computation,
    tile: host.tile,
    close,
    selectedInput: () => selected,
    selectInput(key: string) {
      if (closing) return;
      if (!inputs.some((candidate) => candidate.key === key)) return;
      selected = key;
      applySelection();
      host.onStep?.(key);
    },
  };
  active = controller;

  applySelection();

  applyPanelInset();
  if (reducedMotion || host.instant === true) {
    panel.classList.add('trace-open', 'trace-reduced');
    chipArea.classList.add('chips-open');
    if (!reducedMotion) buildThreads(false);
  } else {
    requestAnimationFrame(() => {
      chipArea.classList.add('chips-open');
      panel.classList.add('trace-open');
    });
    window.setTimeout(() => {
      if (!closing) buildThreads(true);
    }, OPEN_DELAY_MS);
    // Settle the anchors once the opening sequence has finished.
    window.setTimeout(() => {
      if (!closing) anchorThreads(false);
    }, 620);
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', queueAnchor, true);
  panel.addEventListener('scroll', queueAnchor, true);
  window.setTimeout(() => {
    if (!closing) document.addEventListener('pointerdown', onOutsidePointer, true);
  }, 0);

  const firstButton = inputButtons.get(selected);
  firstButton?.focus();

  return controller;
}

async function downloadExhibit(
  href: string,
  accession: string,
  status: HTMLElement,
): Promise<void> {
  status.textContent = '';
  let response: Response;
  try {
    response = await fetch(href, { credentials: 'same-origin' });
  } catch {
    status.textContent = BOARD_COPY.exhibitDownloadVaultDown;
    return;
  }
  if (response.status === 503) {
    status.textContent = BOARD_COPY.exhibitDownloadVaultDown;
    return;
  }
  if (response.status !== 200) {
    status.textContent = BOARD_COPY.unexpected;
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { attributes: { href: url, download: `${accession}.pdf` } });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
