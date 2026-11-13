// The wall workspace: loupe, grid, placements, issue and live updates
// (DP-28 to DP-38, DP-34 to DP-37).

import { h, clear, announce, showProblem, hideProblem, statusRegion, fieldError, COPY } from './ui.js';
import { api, idempotencyKey, subscribe, prefersReducedMotion, cellNameOf, parseCellName, ApiProblem } from './app.js';
import { route, state } from './main.js';

export async function renderWorkspace(shell, band, siteId, layoutId) {
  const site = await api.get(`/api/sites/${siteId}`);
  const layoutResponse = await fetch(`/api/layouts/${layoutId}`);
  const etag = layoutResponse.headers.get('etag').replace(/"(.*)"/, '$1');
  const layout = await layoutResponse.json();
  const picker = await api.get(`/api/layouts/${layoutId}/picker`);

  shell.append(nav('/sites'));

  const heading = h('h1', { class: 'sentence' });
  const slot = h('button', { class: 'slot', onclick: () => openStage() }, 'loupe');
  const cellFromUrl = new URLSearchParams(window.location.search).get('cell');
  const figures = await loadCells(layoutId);
  const chosen = validCell(cellFromUrl, site, figures) ?? lowestCovered(layout, figures);
  drawHeading(chosen);
  shell.append(heading);

  const regions = { wall: h('div', { class: 'wall-region' }), readings: h('div'), bodies: h('div') };
  regions.wall.setAttribute('role', 'region');
  regions.wall.setAttribute('aria-label', 'Wall');
  regions.readings.setAttribute('role', 'region');
  regions.readings.setAttribute('aria-label', 'Readings');
  regions.bodies.setAttribute('role', 'region');
  regions.bodies.setAttribute('aria-label', 'Bodies');

  const workspace = h('div', { class: 'workspace' }, regions.wall, regions.readings, regions.bodies);
  shell.append(workspace);

  const cellStatus = statusRegion('Cell reading');
  const sync = syncRegionFor(siteId);
  const loupeCanvas = h('canvas', { width: 260, height: 150, role: 'img', 'aria-label': 'Show-night loupe' });
  const loupe = h('div', { class: 'loupe' }, loupeCanvas);

  const wallCanvas = h('canvas', { width: 960, height: 480 });
  const wrap = h('div', { class: 'canvas-wrap' }, wallCanvas, loupe);
  regions.wall.append(wrap, cellStatus, sync);

  const scale = {
    columns: site.columns,
    rows: site.rows,
    width: site.widthMetres,
    height: site.heightMetres,
  };

  drawWall(wallCanvas, figures, scale, chosen);

  const cellReadings = await readRegion(siteId, layoutId, figures, site);
  regions.readings.append(cellReadings);
  const bodiesRegion = await bodies(layout, site, picker, layoutId, etag, band, figures);
  regions.bodies.append(bodiesRegion);

  // ---- loupe: the signature ----
  let current = chosen;
  function moveTo(cell, { fromPointer = false, focusGrid = false } = {}) {
    if (cell === null) return;
    current = cell;
    positionLoupe(cell);
    drawWall(wallCanvas, figures, scale, cell);
    announce(cellStatus, cellAnnouncement(cell, figures.get(cell)));
    const url = new URL(window.location.href);
    url.searchParams.set('cell', cell);
    window.history.replaceState({}, '', url);
    updateHeading();
    if (focusGrid) focusCellInGrid(cell);
  }

  function positionLoupe(cell) {
    const rect = wrap.getBoundingClientRect();
    const cellW = rect.width / scale.columns;
    const cellH = rect.height / scale.rows;
    const parsed = parseCellName(cell);
    const loupeW = Math.min(rect.width * 0.4, 300);
    const loupeH = loupeW * 0.58;
    loupe.style.width = `${loupeW}px`;
    loupe.style.height = `${loupeH}px`;
    const cx = (parsed.column - 0.5) * cellW;
    const cy = (parsed.row - 0.5) * cellH;
    if (prefersReducedMotion()) {
      loupe.style.transform = `translate(${cx - loupeW / 2}px, ${cy - loupeH / 2}px)`;
    } else {
      loupe.style.transform = `translate(${cx - loupeW / 2}px, ${cy - loupeH / 2}px)`;
    }
    drawLoupe(loupeCanvas, figures, cell, site, scale);
  }

  function updateHeading() {
    const cellFigures = figures.get(current);
    heading.setAttribute('aria-label', headingText());
    drawHeading(current);
  }

  function headingText() {
    if (current === null) {
      const lowest = lowestCovered(layout, figures);
      return lowest === null ? 'THIS WALL HAS NO READING HERE' : `THIS WALL READS AT ${figures.get(lowest).contrastText} TO 1`;
    }
    const cellFigures = figures.get(current);
    if (cellFigures === undefined || cellFigures.contrast === null) return 'THIS WALL HAS NO READING HERE';
    return `THIS WALL READS AT ${cellFigures.contrastText} TO 1`;
  }

  function drawHeading(cell) {
    clear(heading);
    const text = cell === null ? 'THIS WALL HAS NO READING HERE' : headingText();
    heading.setAttribute('aria-label', text);
    heading.append(text, slot);
  }

  // pointer
  wrap.addEventListener('pointermove', (event) => {
    const rect = wrap.getBoundingClientRect();
    const column = Math.min(scale.columns, Math.max(1, Math.ceil((event.clientX - rect.left) / (rect.width / scale.columns))));
    const row = Math.min(scale.rows, Math.max(1, Math.ceil((event.clientY - rect.top) / (rect.height / scale.rows))));
    const cell = cellNameOf(column, row);
    if (cell !== current) moveTo(cell, { fromPointer: true });
  });

  wrap.addEventListener('click', () => {
    if (current !== null) focusCellInGrid(current);
  });

  // touch: the loupe stays fixed at the middle; the wall pans beneath it
  wrap.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

  // grid: APG pattern
  const grid = h('div', { role: 'grid', 'aria-label': 'Wall cells', class: 'wall-grid' });
  for (let row = 1; row <= scale.rows; row++) {
    const gridRow = h('div', { role: 'row' });
    for (let column = 1; column <= scale.columns; column++) {
      const cell = cellNameOf(column, row);
      const cellNode = h('div', {
        role: 'gridcell',
        'aria-label': cell,
        tabindex: '-1',
        onkeydown: (event) => onGridKey(event, cell),
      }, cellFiguresLabel(cell));
      gridRow.append(cellNode);
    }
    grid.append(gridRow);
  }
  regions.wall.append(grid);
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${scale.columns}, 1fr)`;
  grid.style.fontSize = '10px';
  grid.style.gap = '2px';

  function focusCellInGrid(cell) {
    const index = gridIndex(cell);
    const cells = grid.querySelectorAll('[role="gridcell"]');
    const target = cells[index];
    if (target) {
      for (const node of cells) node.setAttribute('tabindex', '-1');
      target.setAttribute('tabindex', '0');
      target.focus();
    }
  }

  function gridIndex(cell) {
    const parsed = parseCellName(cell);
    return (parsed.row - 1) * scale.columns + (parsed.column - 1);
  }

  function onGridKey(event, cell) {
    const parsed = parseCellName(cell);
    const step = event.shiftKey ? 5 : 1;
    let { column, row } = parsed;
    switch (event.key) {
      case 'ArrowLeft': column = Math.max(1, column - step); break;
      case 'ArrowRight': column = Math.min(scale.columns, column + step); break;
      case 'ArrowUp': row = Math.max(1, row - step); break;
      case 'ArrowDown': row = Math.min(scale.rows, row + step); break;
      default: return;
    }
    event.preventDefault();
    moveTo(cellNameOf(column, row), { focusGrid: true });
  }

  // workspace shortcuts: P places, F opens the stage
  regions.wall.addEventListener('keydown', (event) => {
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      openPlaceDialog(current);
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      openStage();
    }
  });

  const stage = h('div', { class: 'stage', hidden: '' }, h('canvas', { width: 1600, height: 800, role: 'img', 'aria-label': 'Full wall' }));
  const closeStage = h('button', { onclick: () => { stage.hidden = true; slot.focus(); } }, 'Close the full wall');
  stage.append(closeStage);
  shell.append(stage);

  function openStage() {
    const canvas = stage.querySelector('canvas');
    drawWall(canvas, figures, scale, current, true);
    stage.hidden = false;
    if (!prefersReducedMotion()) {
      stage.animate?.(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 333, easing: 'ease-out' },
      );
    }
    closeStage.focus();
  }

  const issueStatus = statusRegion('Issue');
  const issueButton = h('button', { onclick: () => issueLayout() }, 'Issue rig sheet');
  const sheetLink = layout.sheetStatus !== 'Draft'
    ? h('a', { href: `/sheets/${layoutSheetId ?? ''}`, 'data-link': '' }, 'Open the sheet')
    : null;

  async function issueLayout() {
    announce(issueStatus, COPY.issuePending);
    try {
      const sheet = await api.post(`/api/layouts/${layoutId}/issue`, {}, { headers: { 'Idempotency-Key': idempotencyKey('issue', layoutId + layout.version) } });
      announce(issueStatus, COPY.issueSuccess);
      route(`/sheets/${sheet.id}`);
    } catch (err) {
      showProblem(band, err.problem ?? err);
      clear(issueStatus);
    }
  }

  let layoutSheetId = null;
  if (layout.sheetStatus !== 'Draft') {
    layoutSheetId = await findSheetId(layoutId);
  }

  // place dialog
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Place a body', hidden: '' });
  shell.append(dialog);
  const placeButton = h('button', { onclick: () => openPlaceDialog(current) }, 'Place body');
  regions.wall.append(h('div', { class: 'row' }, placeButton, issueButton, issueStatus, sheetLink));

  function openPlaceDialog(cell) {
    if (cell === null) return;
    clear(dialog);
    const parsed = parseCellName(cell);
    const acrossDefault = Math.ceil((parsed.column - 0.5) * 0.5 * 2) / 2;
    const downDefault = Math.ceil((parsed.row - 0.5) * 0.5 * 2) / 2;
    dialog.append(placementForm(layout, site, picker, layoutId, etag, band, {
      aimAcross: acrossDefault,
      aimDown: downDefault,
    }, null, () => { dialog.hidden = true; route(window.location.pathname); }));
    dialog.hidden = false;
    dialog.querySelector('button')?.focus();
  }

  subscribe((event) => {
    if (event.type === 'reading.accepted' && event.aggregateId === siteId) {
      void refreshCells();
    }
    if (event.type === 'layout.changed' && event.aggregateId === layoutId) {
      route(window.location.pathname);
    }
  });

  async function refreshCells() {
    const fresh = await loadCells(layoutId);
    figures.clear();
    for (const [name, value] of fresh) figures.set(name, value);
    drawWall(wallCanvas, figures, scale, current);
    moveTo(current, { fromPointer: true });
  }

  moveTo(chosen);
}

async function loadCells(layoutId) {
  const response = await api.get(`/api/layouts/${layoutId}/cells`);
  const map = new Map();
  for (const cell of response.items) map.set(cell.cell, cell);
  return map;
}

function validCell(name, site, figures) {
  if (name === null) return null;
  const parsed = parseCellName(name);
  if (parsed === null || parsed.column > site.columns || parsed.row > site.rows) return null;
  if (!figures.has(name)) return null;
  return name;
}

function lowestCovered(layout, figures) {
  let best = null;
  for (const [name, cell] of figures) {
    if (cell.contrast === null) continue;
    if (cell.projectedLux <= 0) continue;
    if (best === null || cell.contrast < figures.get(best).contrast) best = name;
  }
  return best;
}

function drawWall(canvas, figures, scale, chosen, large = false) {
  const ctx = canvas.getContext('2d');
  const cellW = canvas.width / scale.columns;
  const cellH = canvas.height / scale.rows;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const [name, cell] of figures) {
    const parsed = parseCellName(name);
    const x = (parsed.column - 1) * cellW;
    const y = (parsed.row - 1) * cellH;
    const dim = !large && name !== chosen;
    if (cell.hatched) {
      ctx.fillStyle = dim ? '#4a2c47' : '#6b3f5e';
    } else if (cell.contrast === null) {
      ctx.fillStyle = dim ? '#401f3c' : '#4d2349';
    } else {
      const level = cell.litLevel ?? 0;
      const alpha = dim ? 0.16 : 0.25 + Math.min(0.75, level) * 0.75;
      ctx.fillStyle = `rgba(247, 237, 223, ${alpha.toFixed(3)})`;
      if (dim) ctx.fillStyle = `rgba(247, 237, 223, 0.13)`;
    }
    ctx.fillRect(x, y, cellW - 1, cellH - 1);
    // hatching for the lowest band
    if (cell.hatched) {
      ctx.strokeStyle = 'rgba(247,237,223,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < cellW; i += 6) {
        ctx.moveTo(x + i, y + cellH);
        ctx.lineTo(x + i + cellH, y);
      }
      ctx.stroke();
    }
    if (!large) {
      ctx.fillStyle = 'rgba(247, 237, 223, 0.9)';
      ctx.font = '11px "Albert Sans"';
      if (cell.contrast !== null) {
        ctx.fillText(cell.contrast.toFixed(1), x + 3, y + cellH - 4);
      }
    }
  }
}

function drawLoupe(canvas, figures, cell, site, scale) {
  const ctx = canvas.getContext('2d');
  const parsed = parseCellName(cell);
  const view = { across: 4, down: 2.4 };
  const cellW = canvas.width / (view.across * 2);
  const cellH = canvas.height / (view.down * 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#3b1f38';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const centreAcross = (parsed.column - 0.5) * 0.5;
  const centreDown = (parsed.row - 0.5) * 0.5;
  const startColumn = Math.floor((centreAcross - view.across) * 2) + 1;
  const startRow = Math.floor((centreDown - view.down) * 2) + 1;
  for (let row = startRow; row < startRow + view.down * 2 + 2; row++) {
    for (let column = startColumn; column < startColumn + view.across * 2 + 2; column++) {
      if (column < 1 || row < 1 || column > scale.columns || row > scale.rows) continue;
      const name = cellNameOf(column, row);
      const cellFigures = figures.get(name);
      const x = ((column - 1) * 0.5 - (centreAcross - view.across)) * 2 * cellW;
      const y = ((row - 1) * 0.5 - (centreDown - view.down)) * 2 * cellH;
      if (cellFigures === undefined) continue;
      if (cellFigures.contrast === null) {
        ctx.fillStyle = '#573253';
      } else {
        const level = cellFigures.litLevel ?? 0;
        ctx.fillStyle = `rgba(247, 237, 223, ${(0.3 + Math.min(0.7, level) * 0.7).toFixed(3)})`;
      }
      ctx.fillRect(x, y, cellW - 1, cellH - 1);
      if (cellFigures.blended) {
        ctx.strokeStyle = 'rgba(247,237,223,0.9)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 2, cellH - 2);
      }
    }
  }
}

function cellAnnouncement(cell, figures) {
  if (figures === undefined || figures.contrast === null) return `Cell ${cell}, no reading.`;
  const blended = figures.blended ? ', blended.' : '.';
  return `Cell ${cell}, ${figures.contrastText}, ${figures.pixelsPerMetre} pixels per metre${blended}`;
}

function cellFiguresLabel(cell) {
  return cell;
}

async function readRegion(siteId, layoutId, figures, site) {
  const wrap = h('div');
  const table = h('table', { 'aria-label': 'Readings' });
  table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Cell'), h('th', {}, 'Lux'), h('th', {}, 'Band'), h('th', {}, 'Pixels/m'))));
  const body = h('tbody');
  const sample = [...figures.entries()].filter(([, cell]) => cell.contrast !== null).slice(0, 14);
  for (const [name, cell] of sample) {
    body.append(h('tr', {},
      h('td', {}, name),
      h('td', {}, cell.contrastText),
      h('td', {}, cell.band),
      h('td', {}, String(cell.pixelsPerMetre))));
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

async function bodies(layout, site, picker, layoutId, etag, band, figures) {
  const wrap = h('div');
  const list = h('ul', { 'aria-label': 'Placements', role: 'list' });
  for (const placement of layout.placements) {
    const label = placement.bodySerial ?? (placement.holdId ? 'On hold' : 'Needs a body');
    const item = h('li', { role: 'listitem' },
      `${label} ${placement.lensSerial} @ ${placement.aimAcross}/${placement.aimDown}`,
      h('button', { onclick: () => route(window.location.pathname) }, `Aim ${placement.bodySerial ?? `placement ${layout.placements.indexOf(placement) + 1}`}`));
    list.append(item);
  }
  const free = h('ul', { 'aria-label': 'Free bodies', role: 'list' });
  for (const model of picker.models) {
    free.append(h('li', { role: 'listitem' }, `${model.model} ${model.free} free`));
  }
  wrap.append(list, free);
  return wrap;
}

function placementForm(layout, site, picker, layoutId, etag, band, defaults, existing, done) {
  const bodyOptions = [];
  for (const body of picker.bodies) bodyOptions.push({ value: body.serial, label: `${body.serial} ${body.model}` });
  for (const hold of picker.holds) bodyOptions.push({ value: `hold:${hold.id}`, label: `${hold.serial ?? hold.model} ${hold.model} on hold` });
  const shortfallModels = new Set(layout.placements.filter((p) => !p.bodySerial && !p.holdId).map((p) => p.model));
  for (const model of shortfallModels) bodyOptions.push({ value: `needs:${model}`, label: `Needs a body ${model}` });
  if (bodyOptions.length === 0) bodyOptions.push({ value: '', label: 'No body available' });

  const body = h('select', { 'aria-label': 'Body' }, bodyOptions.map((option) => h('option', { value: option.value }, option.label)));
  const lens = h('select', { 'aria-label': 'Lens' }, picker.lenses.map((option) => h('option', { value: option.serial }, `${option.serial} ${option.model}`)));
  const aimAcross = spinbutton('Aim across', defaults.aimAcross);
  const aimDown = spinbutton('Aim down', defaults.aimDown);
  const bodyAcross = spinbutton('Body across', defaults.aimAcross);
  const bodyDown = spinbutton('Body down', defaults.aimDown);
  const standoff = h('input', { type: 'text', 'aria-label': 'Standoff', value: '18' });
  const standoffUnit = h('select', { 'aria-label': 'Standoff unit' }, ['m', 'ft'].map((u) => h('option', { value: u }, u)));
  const zoom = h('input', { type: 'text', 'aria-label': 'Zoom ratio', value: '1,3' });
  const shiftAcross = h('input', { type: 'text', 'aria-label': 'Shift across', value: '0' });
  const shiftDown = h('input', { type: 'text', 'aria-label': 'Shift down', value: '0' });
  const circuit = h('select', { 'aria-label': 'Circuit' }, site.circuits.map((c) => h('option', { value: c.id }, c.name)));

  const form = h('form', {
    'aria-label': 'Place a body',
    onsubmit: async (event) => {
      event.preventDefault();
      hideProblem(band);
      const bodyValue = body.value;
      const input = {
        lensSerial: lens.value,
        aimAcross: { text: aimAcross.value, unit: 'm' },
        aimDown: { text: aimDown.value, unit: 'm' },
        bodyAcross: { text: bodyAcross.value, unit: 'm' },
        bodyDown: { text: bodyDown.value, unit: 'm' },
        standoff: { text: standoff.value, unit: standoffUnit.value },
        ratio: zoom.value,
        shiftAcrossPercent: shiftAcross.value,
        shiftDownPercent: shiftDown.value,
        circuitId: circuit.value,
      };
      if (bodyValue.startsWith('hold:')) input.holdId = bodyValue.slice(5);
      else if (bodyValue.startsWith('needs:')) input.model = bodyValue.slice(6);
      else if (bodyValue !== '') input.bodySerial = bodyValue;

      try {
        const response = await fetch(`/api/layouts/${layoutId}/placements${existing ? `/${existing.id}` : ''}`, {
          method: existing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': `"${etag}"`,
            ...(existing ? {} : { 'Idempotency-Key': idempotencyKey('placement', layoutId + JSON.stringify(input)) }),
          },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const problem = await response.json();
          showProblem(band, problem);
          return;
        }
        done();
      } catch (err) {
        showProblem(band, { detail: 'Something went wrong on our side.' });
      }
    },
  },
    h('div', {}, h('label', {}, 'Body'), body),
    h('div', {}, h('label', {}, 'Lens'), lens),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Aim across'), aimAcross), h('div', { class: 'grow' }, h('label', {}, 'Aim down'), aimDown)),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Body across'), bodyAcross), h('div', { class: 'grow' }, h('label', {}, 'Body down'), bodyDown)),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Standoff'), standoff), h('div', { style: 'flex:0 0 90px' }, h('label', {}, 'Standoff unit'), standoffUnit)),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', {}, 'Zoom ratio'), zoom),
      h('div', { class: 'grow' }, h('label', {}, 'Shift across'), shiftAcross),
      h('div', { class: 'grow' }, h('label', {}, 'Shift down'), shiftDown)),
    h('div', {}, h('label', {}, 'Circuit'), circuit),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Save placement'), h('button', { type: 'button', onclick: () => { dialogClose(); } }, 'Cancel')));
  return form;

  function dialogClose() {
    done();
  }
}

function spinbutton(label, value) {
  const input = h('input', {
    type: 'text',
    'aria-label': label,
    value: String(value),
    role: 'spinbutton',
    'aria-valuenow': String(value),
    'aria-valuemin': '0',
    'aria-valuenow-unit': 'm',
    onkeydown: (event) => {
      let current = Number(input.value.replace(',', '.')) || 0;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        current += 0.5;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        current -= 0.5;
      } else return;
      input.value = String(current).replace('.', ',');
      input.setAttribute('aria-valuenow', String(current));
    },
  });
  return input;
}

function syncRegionFor(siteId) {
  const status = statusRegion('Sync');
  const button = h('button', { onclick: async () => {
    const result = await import('./app.js').then((m) => m.syncQueue(siteId));
    announce(status, `Waiting to sync ${result.waiting}`);
  } }, 'Sync now');
  return h('div', { class: 'row' }, status, button);
}

function nav(current) {
  const links = [
    { href: '/sites', label: 'Walls' },
    { href: '/kit', label: 'Shelf' },
    { href: '/hire', label: 'Hire' },
  ];
  return h('nav', { class: 'landmark', 'aria-label': 'Workspace' },
    links.map((link) => h('a', { href: link.href, 'data-link': '', 'aria-current': link.href === current ? 'page' : null }, link.label)));
}

async function findSheetId(layoutId) {
  const response = await api.get(`/api/layouts/${layoutId}/circuits`);
  return response.items.length > 0 ? null : null;
}
