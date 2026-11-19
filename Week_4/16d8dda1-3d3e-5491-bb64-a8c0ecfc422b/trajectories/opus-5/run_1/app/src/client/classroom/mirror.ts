import type { SessionSnapshot } from '../../shared/types.js';
import { element, setAttributes } from '../dom.js';

export interface Mirror {
  region: HTMLElement;
  canvas: HTMLCanvasElement;
  boardStrip: HTMLElement;
  update: (snapshot: SessionSnapshot, cursorSeat: string | null) => void;
  tickTables: (remaining: number | null) => void;
  setReturning: (returning: boolean) => void;
  setMotion: (reduced: boolean) => void;
  setWebgl: (on: boolean) => void;
  seatAt: (point: { x: number; y: number }) => string | null;
}

/** DP-41: the DOM mirror follows the server's messages, never an animation frame. */
export function createMirror(): Mirror {
  const canvas = element('canvas', { role: 'img', 'aria-label': 'Classroom view', class: 'classroom-canvas' });
  const slideImage = element('img', { alt: '', class: 'board-slide' });
  const boardText = element('span', { class: 'board-text mono' }, ['']);
  const boardStrip = element('div', { 'data-board': '', 'data-slide': '0', 'data-slide-total': '0', 'data-dimmed': 'false', class: 'board-strip' }, [
    slideImage,
    boardText
  ]);
  const seatList = element('ul', { 'aria-label': 'Seats', class: 'seat-key' });
  const tableList = element('ul', { 'aria-label': 'Tables', class: 'table-key' });
  const modelNode = element('div', { 'data-model': '', 'data-model-id': '', class: 'model-key' }, ['']);
  const mirror = element('div', { class: 'mirror' }, [seatList, tableList, modelNode]);
  const region = element(
    'section',
    {
      'aria-label': 'Classroom',
      class: 'classroom-region',
      'data-motion': 'animated',
      'data-webgl': 'on',
      'data-returning': 'false'
    },
    [boardStrip, element('div', { class: 'canvas-box' }, [canvas]), mirror]
  );

  let placed: { seatId: string; column: number; row: number }[] = [];
  let bounds = { columns: 8, rows: 6 };

  const update: Mirror['update'] = (snapshot, cursorSeat) => {
    const total = snapshot.slide.total;
    setAttributes(boardStrip, {
      'data-slide': String(snapshot.slide.current),
      'data-slide-total': String(total),
      'data-dimmed': snapshot.state === 'breakouts' ? 'true' : 'false'
    });
    boardText.textContent = `Slide ${snapshot.slide.current} of ${total}`;
    if (snapshot.slide.fileId === null) {
      slideImage.removeAttribute('src');
      slideImage.alt = '';
      slideImage.hidden = true;
    } else {
      slideImage.hidden = false;
      const source = `/api/files/${snapshot.slide.fileId}`;
      if (!slideImage.src.endsWith(source)) slideImage.src = source;
      slideImage.alt = `Slide ${snapshot.slide.current}`;
    }

    seatList.replaceChildren();
    for (const seat of snapshot.seats) {
      seatList.append(
        element(
          'li',
          {
            'data-seat-id': seat.seatId,
            'data-table': seat.table ?? '',
            'data-row': String(seat.row),
            'data-column': String(seat.column),
            'data-occupant': seat.learnerId ?? '',
            'data-occupant-name': seat.displayName ?? '',
            'data-hand': seat.hand,
            'data-spotlit': snapshot.spotlight !== null && snapshot.spotlight === seat.learnerId ? 'true' : 'false',
            'data-selected': seat.seatId === cursorSeat ? 'true' : 'false',
            'data-breakout-table': seat.breakoutTable ?? '',
            class: 'seat-key-item'
          },
          [
            element('span', { class: 'mono' }, [seat.seatId]),
            element('span', {}, [seat.displayName === null ? ' free' : ` ${seat.displayName}`])
          ]
        )
      );
    }

    tableList.replaceChildren();
    for (const table of snapshot.tables) {
      tableList.append(
        element(
          'li',
          {
            'data-table-id': table.tableId,
            'data-row': String(table.row),
            'data-column': String(table.column),
            'data-breakout-remaining': snapshot.breakout === null ? '' : String(snapshot.breakout.remainingSeconds),
            class: 'table-key-item'
          },
          [element('span', { class: 'mono' }, [table.tableId])]
        )
      );
    }

    setAttributes(modelNode, { 'data-model-id': snapshot.modelFileId ?? '' });
    modelNode.textContent = snapshot.modelFileId === null ? 'No model on show' : 'Model on show';

    placed = snapshot.seats.map((seat) => ({ seatId: seat.seatId, column: seat.column, row: seat.row }));
    bounds = {
      columns: Math.max(4, ...snapshot.seats.map((seat) => seat.column + 1), ...snapshot.tables.map((table) => table.column + 1)),
      rows: Math.max(3, ...snapshot.seats.map((seat) => seat.row + 1), ...snapshot.tables.map((table) => table.row + 1))
    };
  };

  const tickTables: Mirror['tickTables'] = (remaining) => {
    for (const item of tableList.children) {
      if (!(item instanceof HTMLElement)) continue;
      item.dataset.breakoutRemaining = remaining === null ? '' : String(remaining);
    }
  };

  return {
    region,
    canvas,
    boardStrip,
    update,
    tickTables,
    setReturning: (returning) => setAttributes(region, { 'data-returning': returning ? 'true' : 'false' }),
    setMotion: (reduced) => setAttributes(region, { 'data-motion': reduced ? 'reduced' : 'animated' }),
    setWebgl: (on) => setAttributes(region, { 'data-webgl': on ? 'on' : 'off' }),
    /** A tap on the canvas lands on the nearest seat of the plan it draws. */
    seatAt: (point) => {
      const box = canvas.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || placed.length === 0) return null;
      const across = (point.x - box.left) / box.width;
      const down = (point.y - box.top) / box.height;
      const column = across * bounds.columns - 0.5;
      const row = (1 - down) * bounds.rows - 0.5;
      let best: { seatId: string; distance: number } | null = null;
      for (const seat of placed) {
        const distance = Math.hypot(seat.column - column, seat.row - row);
        if (best === null || distance < best.distance) best = { seatId: seat.seatId, distance };
      }
      return best !== null && best.distance < 1.6 ? best.seatId : null;
    }
  };
}
