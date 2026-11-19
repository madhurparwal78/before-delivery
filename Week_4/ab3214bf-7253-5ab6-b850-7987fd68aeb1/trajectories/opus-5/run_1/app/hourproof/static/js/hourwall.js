// The Hour Wall: one keyboard-walkable grid, one cell per window hour.

import { announce, el } from './dom.js';

export function localParts(hourUtc, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(hourUtc)).map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    clock: `${parts.hour}:00`,
  };
}

export function describeHours(buckets, timeZone) {
  // Each window hour with its local date, clock hour and whether it is a repeat.
  return buckets.map((bucket, index) => {
    const local = localParts(bucket.key, timeZone);
    const previous = index > 0 ? localParts(buckets[index - 1].key, timeZone) : null;
    const again =
      previous !== null && previous.date === local.date && previous.clock === local.clock;
    return { ...bucket, local, again };
  });
}

export function cellName(hour) {
  const again = hour.again ? ' again' : '';
  const consumed =
    hour.quality === 'Missing' ? 'consumed none' : `consumed ${hour.consumed_wh} Wh`;
  return (
    `${hour.local.date} ${hour.local.clock}${again} local, ${hour.key.slice(11, 16)} UTC,` +
    ` ${consumed}, matched ${hour.matched_wh} Wh, ${hour.quality}`
  );
}

export class HourWall {
  constructor({ timeZone, onOpen, onSelection }) {
    this.timeZone = timeZone;
    this.onOpen = onOpen;
    this.onSelection = onSelection;
    this.cells = new Map();
    this.order = [];
    this.focusKey = null;
    this.anchorKey = null;
    this.selection = new Set();
    this.touchMode = false;
    this.scale = 1;
    this.selectButton = el('button', {
      type: 'button',
      text: 'Select hours',
      'aria-pressed': 'false',
    });
    this.selectButton.addEventListener('click', () => this.toggleTouchMode());
    this.grid = el('table', {
      role: 'grid',
      'aria-label': 'Hour Wall',
      'aria-multiselectable': 'true',
      className: 'wall',
    });
    this.scroll = el('div', { className: 'wall-scroll' }, [this.grid]);
    this.region = el(
      'div',
      { role: 'region', 'aria-label': 'Hour Wall', className: 'wall-region' },
      [this.selectButton, this.scroll]
    );
    this.grid.addEventListener('keydown', (event) => this.handleKey(event));
  }

  toggleTouchMode() {
    this.touchMode = !this.touchMode;
    this.selectButton.setAttribute('aria-pressed', String(this.touchMode));
    if (this.touchMode) this.anchorKey = null;
  }

  render(hours) {
    this.hours = hours;
    this.order = hours.map((hour) => hour.key);
    const byKey = new Map(hours.map((hour) => [hour.key, hour]));
    this.byKey = byKey;
    this.scale = Math.max(
      1,
      ...hours.map((hour) => hour.consumed_wh + hour.surplus_wh)
    );
    const days = [];
    hours.forEach((hour) => {
      if (!days.includes(hour.local.date)) days.push(hour.local.date);
    });
    const rows = [];
    hours.forEach((hour) => {
      const label = `${hour.local.clock}${hour.again ? ' again' : ''}`;
      if (!rows.includes(label)) rows.push(label);
    });
    rows.sort((left, right) => {
      const base = left.slice(0, 5).localeCompare(right.slice(0, 5));
      if (base !== 0) return base;
      return left.length - right.length;
    });
    const head = el('tr', { role: 'row' }, [
      el('th', { role: 'columnheader', scope: 'col', text: 'Hour' }),
      ...days.map((date) =>
        el('th', { role: 'columnheader', scope: 'col', text: date.slice(8, 10) })
      ),
    ]);
    const bodyRows = rows.map((label) => {
      const cells = days.map((date) => {
        const hour = hours.find(
          (candidate) =>
            candidate.local.date === date &&
            `${candidate.local.clock}${candidate.again ? ' again' : ''}` === label
        );
        if (!hour) return el('td', { className: 'empty', 'aria-hidden': 'true' });
        return this.buildCell(hour);
      });
      return el('tr', { role: 'row' }, [
        el('th', { role: 'rowheader', scope: 'row', text: label }),
        ...cells,
      ]);
    });
    this.grid.replaceChildren(
      el('caption', { text: 'Every hour of the window, local days across, local hours down' }),
      el('thead', {}, [head]),
      el('tbody', {}, bodyRows)
    );
    if (!this.focusKey || !byKey.has(this.focusKey)) this.focusKey = this.order[0] || null;
    this.applyRoving();
    this.paintSelection();
  }

  buildCell(hour) {
    const fill = el('div', {
      className: 'cell-fill',
      dataset: { blockPart: 'matched' },
    });
    const cell = el(
      'td',
      {
        role: 'gridcell',
        tabindex: '-1',
        'aria-label': cellName(hour),
        dataset: {
          hour: hour.key,
          quality: hour.quality,
          bucketKey: hour.key,
          matchedWh: hour.matched_wh,
          consumedWh: hour.consumed_wh,
          surplusWh: hour.surplus_wh,
        },
      },
      [fill]
    );
    fill.style.height = `${(hour.matched_wh / this.scale) * 100}%`;
    cell.addEventListener('click', (event) => this.handleClick(event, hour.key));
    this.cells.set(hour.key, cell);
    return cell;
  }

  update(hours) {
    // A live refresh changes the cells' values without moving focus.
    const sameShape =
      this.hours &&
      hours.length === this.hours.length &&
      hours.every((hour, index) => hour.key === this.hours[index].key);
    if (!sameShape) {
      this.cells = new Map();
      this.render(hours);
      return;
    }
    this.hours = hours;
    this.byKey = new Map(hours.map((hour) => [hour.key, hour]));
    this.scale = Math.max(1, ...hours.map((hour) => hour.consumed_wh + hour.surplus_wh));
    hours.forEach((hour) => {
      const cell = this.cells.get(hour.key);
      if (!cell) return;
      cell.setAttribute('aria-label', cellName(hour));
      cell.dataset.quality = hour.quality;
      cell.dataset.matchedWh = hour.matched_wh;
      cell.dataset.consumedWh = hour.consumed_wh;
      cell.dataset.surplusWh = hour.surplus_wh;
      const fill = cell.querySelector('.cell-fill');
      if (fill) fill.style.height = `${(hour.matched_wh / this.scale) * 100}%`;
    });
  }

  applyRoving() {
    this.cells.forEach((cell, key) => {
      cell.setAttribute('tabindex', key === this.focusKey ? '0' : '-1');
    });
  }

  focusCell(key, { scroll = true } = {}) {
    const cell = this.cells.get(key);
    if (!cell) return;
    this.focusKey = key;
    this.applyRoving();
    cell.focus({ preventScroll: true });
    if (scroll) {
      const left = cell.offsetLeft - this.scroll.clientWidth / 2;
      this.scroll.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    }
  }

  handleClick(event, key) {
    if (this.touchMode) {
      if (!this.anchorKey) this.anchorKey = key;
      this.focusCell(key);
      this.extendTo(key);
      return;
    }
    if (event.shiftKey) {
      if (!this.anchorKey) this.anchorKey = this.focusKey || key;
      this.focusCell(key);
      this.extendTo(key);
      return;
    }
    this.focusCell(key);
    this.clearSelection();
    this.onOpen(key);
  }

  handleKey(event) {
    const key = this.focusKey;
    if (!key) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const moves = {
      ArrowUp: () => this.step(key, 0, -1),
      ArrowDown: () => this.step(key, 0, 1),
      ArrowLeft: () => this.step(key, -1, 0),
      ArrowRight: () => this.step(key, 1, 0),
      Home: () => this.edgeOfRow(key, -1),
      End: () => this.edgeOfRow(key, 1),
      PageUp: () => this.step(key, -1, 0),
      PageDown: () => this.step(key, 1, 0),
    };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onOpen(key);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.clearSelection();
      return;
    }
    if ((event.key === 'm' || event.key === 'M') && plain) {
      event.preventDefault();
      this.jumpMissing(event.shiftKey ? -1 : 1);
      return;
    }
    if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const target = event.key === 'Home' ? this.order[0] : this.order[this.order.length - 1];
      this.focusCell(target);
      this.clearSelection();
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const target = move();
    if (!target) return;
    if (event.shiftKey && (event.key.startsWith('Arrow') )) {
      if (!this.anchorKey) this.anchorKey = key;
      this.focusCell(target);
      this.extendTo(target);
      return;
    }
    this.focusCell(target);
    this.clearSelection();
  }

  position(key) {
    const cell = this.cells.get(key);
    const row = cell.parentElement;
    const rows = Array.from(row.parentElement.children);
    return {
      row: rows.indexOf(row),
      column: Array.from(row.children).indexOf(cell),
      rows,
    };
  }

  step(key, columnStep, rowStep) {
    const { row, column, rows } = this.position(key);
    let rowIndex = row;
    let columnIndex = column;
    for (let guard = 0; guard < 400; guard += 1) {
      rowIndex += rowStep;
      columnIndex += columnStep;
      const candidateRow = rows[rowIndex];
      if (!candidateRow) return null;
      const candidate = candidateRow.children[columnIndex];
      if (!candidate) return null;
      if (candidate.dataset.hour) return candidate.dataset.hour;
      if (rowStep === 0 && columnStep === 0) return null;
    }
    return null;
  }

  edgeOfRow(key, direction) {
    const cell = this.cells.get(key);
    const cells = Array.from(cell.parentElement.children).filter(
      (node) => node.dataset.hour
    );
    const target = direction < 0 ? cells[0] : cells[cells.length - 1];
    return target ? target.dataset.hour : null;
  }

  jumpMissing(direction) {
    const index = this.order.indexOf(this.focusKey);
    const count = this.order.length;
    const missing = this.order.filter((key) => this.byKey.get(key).quality === 'Missing');
    if (!missing.length) {
      announce('Desk status', 'No Missing hours.');
      return;
    }
    for (let step = 1; step <= count; step += 1) {
      const next = this.order[(index + direction * step + count * 2) % count];
      if (this.byKey.get(next).quality === 'Missing') {
        this.focusCell(next);
        this.clearSelection();
        return;
      }
    }
  }

  extendTo(key) {
    const from = this.order.indexOf(this.anchorKey);
    const to = this.order.indexOf(key);
    if (from < 0 || to < 0) return;
    const [low, high] = from <= to ? [from, to] : [to, from];
    this.selection = new Set(this.order.slice(low, high + 1));
    this.paintSelection();
    announce('Wall selection', `${this.selection.size} hours selected.`);
    this.onSelection(this.selectedHours());
  }

  selectedHours() {
    return this.order.filter((key) => this.selection.has(key));
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection = new Set();
    this.anchorKey = null;
    this.paintSelection();
    announce('Wall selection', 'Selection cleared.');
    this.onSelection([]);
  }

  paintSelection() {
    this.cells.forEach((cell, key) => {
      if (this.selection.has(key)) cell.setAttribute('aria-selected', 'true');
      else cell.removeAttribute('aria-selected');
    });
  }
}
