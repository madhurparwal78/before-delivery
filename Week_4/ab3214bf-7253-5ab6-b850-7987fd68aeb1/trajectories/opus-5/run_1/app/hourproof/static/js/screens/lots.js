// Lots and merit order: rank by keyboard, touch or pointer.

import { get, put } from '../api.js';
import { PHONE, currentBand, onBandChange } from '../breakpoints.js';
import { Dialog } from '../dialog.js';
import { announce, clear, el, liveRegion } from '../dom.js';
import { commas, percent } from '../format.js';
import { linkTo } from '../router.js';
import { countdown } from '../timers.js';

export async function mount({ container, params }) {
  const windowId = params[0];
  let record = (await get(`/api/windows/${windowId}`)).data;
  let lots = [];
  let pending = false;
  let drawer = null;

  const merit = el('ul', { role: 'list', 'aria-label': 'Merit order', className: 'merit' });
  const lotList = el('div', {
    role: 'region',
    'aria-label': 'Lot list',
    className: 'panel panel--white stack',
  });
  const empty = el('p', { className: 'word', text: 'NO LOTS HERE.', hidden: true });
  const figures = el('div', { className: 'row' });
  container.append(
    el('div', { className: 'panel stack' }, [
      el('h1', { text: 'RANK YOUR LOTS.' }),
      linkTo(`/windows/${windowId}`, 'Window desk'),
      figures,
      liveRegion('Merit order status', 'status'),
    ]),
    el('div', { className: 'lots-grid' }, [
      el('div', { className: 'panel panel--white stack' }, [merit, empty]),
      lotList,
    ])
  );

  const rows = new Map();
  let touchDragFrom = null;

  function buildRow(lotId) {
    const up = el('button', { type: 'button', text: 'Move up' });
    const down = el('button', { type: 'button', text: 'Move down' });
    const details = el('button', { type: 'button', text: 'Details' });
    up.addEventListener('click', () => shift(lotId, -1, up));
    down.addEventListener('click', () => shift(lotId, 1, down));
    details.addEventListener('click', () => openDrawer(lotId));
    const name = el('strong', {});
    const rank = el('span', {});
    const status = el('span', {});
    const opening = el('span', {});
    const item = el('li', { draggable: 'true', dataset: { lot: lotId } }, [
      el('div', { className: 'stack' }, [name, rank, status, opening]),
      el('div', { className: 'row' }, [up, down, details]),
    ]);
    item.addEventListener('dragstart', (event) => {
      item.dataset.dragging = 'true';
      event.dataTransfer.setData('text/plain', lotId);
    });
    item.addEventListener('dragend', () => {
      item.dataset.dragging = 'false';
    });
    item.addEventListener('dragover', (event) => event.preventDefault());
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      dropAt(event.dataTransfer.getData('text/plain'), lotId);
    });
    item.addEventListener('touchstart', () => {
      touchDragFrom = lotId;
    });
    item.addEventListener('touchend', () => {
      if (touchDragFrom && touchDragFrom !== lotId) dropAt(touchDragFrom, lotId);
      touchDragFrom = null;
    });
    const row = { item, up, down, details, name, rank, status, opening };
    rows.set(lotId, row);
    return row;
  }

  function paint() {
    // Rows are built once and moved, never rebuilt, so focus survives every change.
    lots.forEach((lot, index) => {
      const row = rows.get(lot.id) || buildRow(lot.id);
      row.name.textContent = lot.name;
      row.rank.textContent = `Rank ${lot.rank}`;
      row.status.textContent = lot.status;
      row.opening.textContent = `${commas(lot.opening_wh)} Wh`;
      setDisabled(row.up, index === 0 || pending);
      setDisabled(row.down, index === lots.length - 1 || pending);
      merit.append(row.item);
    });
    empty.hidden = lots.length > 0;
    clear(lotList);
    lots.forEach((lot) =>
      lotList.append(
        el('div', { className: 'stack' }, [
          el('strong', { text: lot.name }),
          el('span', { text: lot.technology }),
          el('span', { text: lot.zone }),
          el('span', { text: lot.status }),
          el('span', { text: lot.cancel_by }),
          el('span', { text: `${lot.bundle_count} bundles` }),
          el('span', {
            text: `Confirmed ${lot.lines_confirmed} of ${lot.lines_total} lines`,
          }),
        ])
      )
    );
    if (drawer) {
      drawer.dialog.opener = rows.get(drawer.lotId)?.details || drawer.dialog.opener;
    }
    clear(figures);
    figures.append(
      el('span', { text: `Month ${percent(record.scores.month_bp)}%` }),
      el('span', { text: `Week ${percent(record.scores.week_bp)}%` }),
      el('span', { text: `Day ${percent(record.scores.day_bp)}%` }),
      el('span', { text: `Hour ${percent(record.scores.hour_bp)}%` }),
      el('span', { text: `Unmatched ${commas(record.unmatched_wh)} Wh` }),
      el('span', { text: `Unmatched hours ${record.unmatched_hours}` })
    );
  }

  function setDisabled(button, disabled) {
    if (disabled) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }

  async function load() {
    const [windowAnswer, lotsAnswer] = await Promise.all([
      get(`/api/windows/${windowId}`),
      get(`/api/windows/${windowId}/lots`),
    ]);
    if (windowAnswer.status === 200) record = windowAnswer.data;
    if (lotsAnswer.status !== 200) return;
    lots = lotsAnswer.data.lots;
    paint();
    if (drawer) paintDrawer();
  }

  async function sendOrder(order, moving) {
    pending = true;
    paint();
    const answer = await put(`/api/windows/${windowId}/merit-order`, {
      revision: record.revision,
      lot_ids: order,
    });
    pending = false;
    if (answer.cancelled) {
      paint();
      return;
    }
    if (answer.status !== 200) {
      announce('Desk alert', answer.error ? answer.error.message : '');
      await load();
      return;
    }
    lots = answer.data.lots;
    record = answer.data.window;
    paint();
    const moved = lots.find((lot) => lot.id === moving.lot);
    const row = rows.get(moving.lot);
    if (row && moving.pressed) {
      const wanted = moving.pressed === row.up ? row.up : row.down;
      const other = wanted === row.up ? row.down : row.up;
      if (wanted.getAttribute('aria-disabled') === 'true') other.focus();
      else wanted.focus();
    }
    announce(
      'Merit order status',
      `${moved.name} is now rank ${moved.rank} of ${lots.length}.`
    );
    announce(
      'Desk status',
      `Allocation done. Hour score ${percent(record.scores.hour_bp)} percent.` +
        ` ${record.unmatched_hours} unmatched hours.`
    );
  }

  function shift(lotId, direction, pressed) {
    if (pending) return;
    const order = lots.map((lot) => lot.id);
    const index = order.indexOf(lotId);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    order.splice(index, 1);
    order.splice(target, 0, lotId);
    sendOrder(order, { lot: lotId, pressed });
  }

  function dropAt(lotId, ontoLotId) {
    if (pending || !lotId || lotId === ontoLotId) return;
    const order = lots.map((lot) => lot.id);
    const from = order.indexOf(lotId);
    const onto = order.indexOf(ontoLotId);
    if (from === -1 || onto === -1) return;
    order.splice(from, 1);
    order.splice(onto, 0, lotId);
    sendOrder(order, { lot: lotId, pressed: null });
  }

  function openDrawer(lotId) {
    const sheet = currentBand() === PHONE ? 'dialog--sheet-bottom' : 'dialog--sheet-right';
    const dialog = new Dialog({ name: 'Lot drawer', sheet });
    drawer = { dialog, lotId, body: el('div', { className: 'stack' }) };
    dialog.bodyNode.append(drawer.body);
    const close = el('button', { type: 'button', text: 'Close' });
    close.addEventListener('click', () => dialog.close());
    drawer.toggle = el('button', { type: 'button', text: 'Exclude lot' });
    drawer.toggle.addEventListener('click', () => toggleExclusion());
    dialog.buttonsNode.append(drawer.toggle, close);
    const stopWatching = onBandChange((next) => {
      dialog.setSheet(
        next === PHONE ? 'dialog--sheet-bottom' : 'dialog--sheet-right'
      );
    });
    dialog.onClose = () => {
      stopWatching();
      drawer = null;
    };
    paintDrawer();
  }

  function paintDrawer() {
    const lot = lots.find((candidate) => candidate.id === drawer.lotId);
    if (!lot) return;
    clear(drawer.body);
    drawer.body.append(
      el('strong', { text: lot.name }),
      el('span', { text: lot.status }),
      el('span', { text: `${commas(lot.opening_wh)} Wh` }),
      el('span', { text: `Confirmed ${lot.lines_confirmed} of ${lot.lines_total} lines` })
    );
    if (lot.cancel_seconds_left !== null) {
      if (!drawer.timer) {
        drawer.timer = countdown({
          label: 'Cancel-by time left',
          seconds: lot.cancel_seconds_left,
          reask: () => load(),
        });
      } else {
        drawer.timer.set(lot.cancel_seconds_left);
      }
      drawer.body.append(drawer.timer.node);
    }
    drawer.toggle.textContent = lot.excluded ? 'Include lot' : 'Exclude lot';
  }

  async function toggleExclusion() {
    const lot = lots.find((candidate) => candidate.id === drawer.lotId);
    const answer = await put(
      `/api/windows/${windowId}/lots/${lot.id}/exclusion`,
      { revision: record.revision, excluded: !lot.excluded }
    );
    if (answer.cancelled) return;
    if (answer.status !== 200) {
      announce('Desk alert', answer.error ? answer.error.message : '');
      return;
    }
    record = answer.data.window;
    await load();
    announce(
      'Desk status',
      `Allocation done. Hour score ${percent(record.scores.hour_bp)} percent.` +
        ` ${record.unmatched_hours} unmatched hours.`
    );
  }

  await load();
  return { refresh: load };
}
