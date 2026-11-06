// The strip workspace: the negative, the loupe, the curve and the notes.
import * as api from '../api.js';
import { COPY, fieldCopy, fill } from '../boot.js';
import { badge, el, field, setFieldError } from '../dom.js';
import * as format from '../format.js';
import { drawBlankFrame } from '../hero.js';
import { activity, app } from '../main.js';
import { SAMPLE_CELL, StripPreview, cellOrigin } from '../strip.js';
import { curveCanvas, drawCurve, figureList, notReadySentence } from '../components/curve.js';
import { entryList } from '../components/entries.js';
import { readDraft } from '../drafts.js';

const CELL_STEP = 1;
const CELL_LEAP = 8;
const DOT_GLIDE_MS = 250;

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function phoneWidth() {
  return window.matchMedia('(max-width: 599px)').matches;
}

export async function render(context) {
  const [rollId, scanId] = context.params;
  const [roll, scan, sheet, curve] = await Promise.all([
    api.get(`/api/rolls/${rollId}`),
    api.get(`/api/scans/${scanId}`),
    api.get(`/api/rolls/${rollId}/contact-sheet`),
    api.get(`/api/rolls/${rollId}/curve`),
  ]);
  const wanted = Number(context.query.get('frame')) || null;
  const preview = new StripPreview(scan);
  const previewAvailable = await preview.load();

  const section = el('section', { class: 'workspace' });
  const stripRegion = el('section', {
    role: 'region',
    'aria-label': 'Strip',
    class: 'strip-region',
  });
  const curveRegion = el('section', {
    role: 'region',
    'aria-label': 'Characteristic curve',
    class: 'curve-region surface',
  });
  const notesRegion = el('section', {
    role: 'region',
    'aria-label': 'Shooting notes',
    class: 'notes-region',
  });

  // --- the strip canvas, its handles and its markers -------------------------
  const canvas = el('canvas', {
    role: 'application',
    'aria-label': 'Densitometer strip',
    tabindex: '0',
    class: 'strip-canvas',
    width: Math.min(scan.width, 1600),
    height: Math.max(1, Math.round((Math.min(scan.width, 1600) * scan.height) / scan.width)),
  });
  const overlay = el('div', { class: 'strip-overlay' });
  const stage = el('div', { class: 'strip-stage' }, [canvas, overlay]);
  if (previewAvailable) preview.drawWhole(canvas);
  else drawBlankFrame(canvas);

  const unavailableNote = previewAvailable
    ? null
    : el('p', { class: 'muted', text: COPY.empty.preview_unavailable });

  const loupeHost = el('div', { class: 'loupe-host parked' });
  const readout = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Loupe reading',
    class: 'loupe-readout surface figures',
  });
  const readoutLines = {
    net: el('p', { text: `Net ${format.MISSING}` }),
    gross: el('p', { text: `Gross ${format.MISSING}` }),
    logH: el('p', { text: `log H ${format.MISSING}` }),
    point: el('p', { text: `x ${format.MISSING} · y ${format.MISSING}` }),
  };
  readout.append(readoutLines.net, readoutLines.gross, readoutLines.logH, readoutLines.point);
  const phonePanel = el('div', { class: 'loupe-panel' });
  if (phoneWidth()) phonePanel.append(readout);
  else loupeHost.append(readout);

  // --- the curve panel ------------------------------------------------------
  const plot = curveCanvas('Curve position');
  const zoneStatus = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Curve zone',
    class: 'figures',
    text: `Zone ${format.MISSING}`,
  });
  curveRegion.append(el('h2', { text: 'Characteristic curve' }), plot, zoneStatus);
  if (curve.ready) {
    curveRegion.append(figureList(curve));
    if (roll.kind === 'normal') {
      curveRegion.append(el('p', {
        class: 'figures',
        text: `Meter bias ${format.bias(curve.meter_bias_stops)} stops`,
      }));
    }
  } else if (roll.kind === 'test') {
    curveRegion.append(el('p', { class: 'muted', text: notReadySentence(curve) }));
  } else {
    curveRegion.append(el('p', { class: 'muted', text: COPY.empty.no_curve }));
  }

  let dot = null;
  let dotTarget = null;
  let dotFrame = null;
  drawCurve(plot, curve, null);

  function glideDot(target) {
    dotTarget = target;
    if (reducedMotion() || dot === null || target === null) {
      dot = target;
      drawCurve(plot, curve, dot);
      return;
    }
    const from = { ...dot };
    const started = performance.now();
    if (dotFrame) cancelAnimationFrame(dotFrame);
    const step = (now) => {
      const share = Math.min(1, (now - started) / DOT_GLIDE_MS);
      const eased = 1 - (1 - share) ** 3;
      dot = {
        log_h: from.log_h + (dotTarget.log_h - from.log_h) * eased,
        net: from.net + (dotTarget.net - from.net) * eased,
      };
      drawCurve(plot, curve, dot);
      if (share < 1) dotFrame = requestAnimationFrame(step);
    };
    dotFrame = requestAnimationFrame(step);
  }

  // --- the loupe ------------------------------------------------------------
  let cell = null;
  let readingToken = 0;
  let loupeCanvas = null;

  function placeLoupe() {
    if (!cell) return;
    const stageRect = stripRegion.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const left = (rect.left - stageRect.left)
      + ((cell[0] + SAMPLE_CELL / 2) * rect.width) / scan.width;
    const top = (rect.top - stageRect.top)
      + ((cell[1] + SAMPLE_CELL / 2) * rect.height) / scan.height;
    loupeHost.style.left = `${Math.round(left)}px`;
    loupeHost.style.top = `${Math.round(top)}px`;
  }

  function openLoupe() {
    loupeHost.classList.remove('parked');
    if (!loupeCanvas) {
      loupeCanvas = el('canvas', { role: 'img', 'aria-label': 'Loupe', class: 'loupe' });
      loupeHost.prepend(loupeCanvas);
      if (!reducedMotion()) {
        loupeCanvas.classList.add('shutter');
        requestAnimationFrame(() => loupeCanvas.classList.add('open'));
      }
    }
  }

  function closeLoupe() {
    cell = null;
    if (loupeCanvas) {
      const leaving = loupeCanvas;
      loupeCanvas = null;
      if (reducedMotion()) leaving.remove();
      else {
        leaving.classList.add('closing');
        setTimeout(() => leaving.remove(), 110);
      }
    }
    loupeHost.classList.add('parked');
  }

  function showReading(body) {
    readoutLines.net.textContent = `Net ${format.density(body.net)}`;
    readoutLines.gross.textContent = `Gross ${format.density(body.gross)}`;
    readoutLines.logH.textContent = `log H ${format.logH(body.log_h)}`;
    zoneStatus.textContent = `Zone ${format.zone(body.zone)}`;
    if (body.log_h !== null && body.net !== null) glideDot({ log_h: body.log_h, net: body.net });
  }

  function showDashes() {
    readoutLines.net.textContent = `Net ${format.MISSING}`;
    readoutLines.gross.textContent = `Gross ${format.MISSING}`;
    readoutLines.logH.textContent = `log H ${format.MISSING}`;
    zoneStatus.textContent = `Zone ${format.MISSING}`;
  }

  async function moveLoupe(x, y) {
    const [cellX, cellY] = cellOrigin(
      Math.max(0, Math.min(scan.width - 1, x)),
      Math.max(0, Math.min(scan.height - 1, y)),
    );
    cell = [cellX, cellY];
    openLoupe();
    placeLoupe();
    readoutLines.point.textContent = `x ${cellX} · y ${cellY}`;
    if (loupeCanvas && previewAvailable) preview.drawLoupe(loupeCanvas, cellX, cellY);
    if (!scan.calibration) return;
    const token = ++readingToken;
    readout.setAttribute('aria-busy', 'true');
    try {
      const body = await api.get(`/api/scans/${scan.id}/reading?x=${cellX}&y=${cellY}`);
      if (token !== readingToken) return;
      showReading(body);
    } catch (failure) {
      if (token !== readingToken) return;
      showDashes();
      if (failure.status === 503) activity(COPY.error.storage_unavailable);
    } finally {
      if (token === readingToken) readout.removeAttribute('aria-busy');
    }
  }

  function pointToScan(event) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.floor(((event.clientX - rect.left) / rect.width) * scan.width),
      Math.floor(((event.clientY - rect.top) / rect.height) * scan.height),
    ];
  }

  async function pinCurrentCell() {
    if (!cell) return;
    const [x, y] = cell;
    activity(COPY.pending.pin);
    try {
      const reading = await api.post(`/api/scans/${scan.id}/readings`, { x, y });
      const frame = scan.frames.find((item) => item.id === reading.frame_id);
      activity(fill(COPY.success.pin, {
        net: format.density(reading.net),
        n: frame ? frame.number : '',
      }));
      addMarker(reading);
      addReadingItem(reading);
    } catch (failure) {
      if (failure.status === 503) {
        activity(COPY.error.storage_unavailable);
        return;
      }
      activity(COPY.error[failure.code] || Object.values(failure.fields)[0] || '');
    }
  }

  function addMarker(reading) {
    const marker = el('span', {
      class: 'pin-marker',
      style: `--x:${((reading.x + SAMPLE_CELL / 2) / scan.width) * 100}%;`
        + `--y:${((reading.y + SAMPLE_CELL / 2) / scan.height) * 100}%`,
    });
    overlay.append(marker);
  }

  // --- calibration controls -------------------------------------------------
  const clearRadio = el('input', { type: 'radio', name: 'method', value: 'clear_light', checked: true });
  clearRadio.setAttribute('aria-label', 'Clear light');
  const wedgeRadio = el('input', { type: 'radio', name: 'method', value: 'step_wedge' });
  wedgeRadio.setAttribute('aria-label', 'Step wedge');
  const areaX = field('Area x', el('input', { type: 'number', min: 0, step: 1, value: 0 }));
  const areaY = field('Area y', el('input', { type: 'number', min: 0, step: 1, value: 0 }));
  const areaW = field('Area width', el('input', { type: 'number', min: 1, step: 1, value: 64 }));
  const areaH = field('Area height', el('input', { type: 'number', min: 1, step: 1, value: 64 }));
  const calibrate = el('button', { type: 'button', class: 'solid', text: 'Calibrate' });
  const findFrames = el('button', { type: 'button', class: 'solid', text: 'Find frames' });
  const areaBox = el('span', { class: 'area-box', hidden: true });
  overlay.append(areaBox);

  function paintAreaBox() {
    const x = Number(areaX.control.value);
    const y = Number(areaY.control.value);
    const w = Number(areaW.control.value);
    const h = Number(areaH.control.value);
    areaBox.hidden = !(w > 0 && h > 0);
    areaBox.style.setProperty('--x', `${(x / scan.width) * 100}%`);
    areaBox.style.setProperty('--y', `${(y / scan.height) * 100}%`);
    areaBox.style.setProperty('--w', `${(w / scan.width) * 100}%`);
    areaBox.style.setProperty('--h', `${(h / scan.height) * 100}%`);
  }
  for (const entry of [areaX, areaY, areaW, areaH]) {
    entry.control.addEventListener('input', paintAreaBox);
  }
  paintAreaBox();

  calibrate.addEventListener('click', async () => {
    for (const entry of [areaX, areaY, areaW, areaH]) setFieldError(entry, '');
    const method = wedgeRadio.checked ? 'step_wedge' : 'clear_light';
    activity(COPY.pending.calibrate);
    try {
      await api.post(`/api/scans/${scan.id}/calibration`, {
        method,
        area: {
          x: Number(areaX.control.value),
          y: Number(areaY.control.value),
          w: Number(areaW.control.value),
          h: Number(areaH.control.value),
        },
      });
      activity(method === 'step_wedge'
        ? COPY.success.calibrate_step_wedge
        : COPY.success.calibrate_clear_light);
      await context.navigate(window.location.pathname + window.location.search, { replace: true });
    } catch (failure) {
      if (failure.status === 503) {
        activity(COPY.error.storage_unavailable);
        return;
      }
      const message = failure.fields.area || failure.fields.wedge;
      if (message) {
        setFieldError(areaX, message);
        activity(message);
        areaX.control.focus();
        return;
      }
      activity(COPY.error[failure.code] || '');
    }
  });

  findFrames.addEventListener('click', async () => {
    activity(COPY.pending.detect);
    try {
      const body = await api.post(`/api/scans/${scan.id}/frames/detect`);
      const flagged = body.frames.filter((frame) => frame.flag === 'flagged').length;
      activity(fill(COPY.success.detect, { count: body.frames.length, flagged }));
      await context.navigate(window.location.pathname + window.location.search, { replace: true });
    } catch (failure) {
      if (failure.status === 503) {
        activity(COPY.error.storage_unavailable);
        return;
      }
      activity(COPY.error[failure.code] || failure.fields.scan || '');
    }
  });

  const calibrationControls = el('div', { class: 'calibration' }, [
    el('fieldset', {}, [
      el('legend', { text: 'Calibration' }),
      el('label', {}, [clearRadio, el('span', { text: 'Clear light' })]),
      el('label', {}, [wedgeRadio, el('span', { text: 'Step wedge' })]),
    ]),
    areaX.wrapper,
    areaY.wrapper,
    areaW.wrapper,
    areaH.wrapper,
    el('div', { class: 'row' }, [calibrate, findFrames]),
  ]);

  // --- frame handles --------------------------------------------------------
  const handleHost = el('div', { class: 'handles' });

  function handleFor(frame, edge) {
    const slider = el('input', {
      type: 'range',
      min: 0,
      max: scan.width,
      step: 1,
      value: edge === 'x0' ? frame.x0 : frame.x1,
      class: 'handle',
    });
    slider.setAttribute(
      'aria-label',
      `Frame ${frame.number} ${edge === 'x0' ? 'left' : 'right'} edge`,
    );
    let saved = Number(slider.value);
    const place = () => {
      slider.style.setProperty('--x', `${(Number(slider.value) / scan.width) * 100}%`);
    };
    place();
    slider.addEventListener('input', place);
    slider.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = (event.shiftKey ? CELL_LEAP : CELL_STEP)
          * (event.key === 'ArrowLeft' ? -1 : 1);
        slider.value = String(Math.max(0, Math.min(scan.width, Number(slider.value) + step)));
        place();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    });
    slider.addEventListener('blur', () => save());
    slider.addEventListener('change', () => save());

    async function save() {
      const value = Number(slider.value);
      if (value === saved) return;
      activity(fill(COPY.pending.frame, { n: frame.number }));
      try {
        const updated = await api.patch(`/api/frames/${frame.id}`, { [edge]: value });
        saved = edge === 'x0' ? updated.x0 : updated.x1;
        slider.value = String(saved);
        place();
        activity(fill(COPY.success.frame, { n: frame.number }));
        await context.navigate(window.location.pathname + window.location.search, { replace: true });
      } catch (failure) {
        slider.value = String(saved);
        place();
        if (failure.status === 503) activity(COPY.error.storage_unavailable);
        else activity(failure.fields[edge] || fieldCopy('x0'));
      }
    }
    return slider;
  }

  for (const frame of scan.frames) {
    handleHost.append(handleFor(frame, 'x0'), handleFor(frame, 'x1'));
    if (frame.flag === 'flagged') {
      const accept = el('button', {
        type: 'button',
        class: 'ghost',
        text: 'Accept width',
        style: `--x:${(frame.x1 / scan.width) * 100}%`,
      });
      accept.setAttribute('aria-label', `Accept frame ${frame.number} width`);
      accept.addEventListener('click', async () => {
        activity(fill(COPY.pending.frame, { n: frame.number }));
        try {
          await api.post(`/api/frames/${frame.id}/accept-width`);
          activity(fill(COPY.success.accept_width, { n: frame.number }));
          await context.navigate(window.location.pathname + window.location.search, { replace: true });
        } catch (failure) {
          activity(COPY.error[failure.code] || '');
        }
      });
      handleHost.append(accept);
    }
    const outline = el('span', {
      class: `frame-outline${wanted === frame.number ? ' wanted' : ''}`,
      style: `--x:${(frame.x0 / scan.width) * 100}%; --w:${((frame.x1 - frame.x0) / scan.width) * 100}%`,
    });
    overlay.append(outline);
  }

  stage.append(handleHost);
  stripRegion.append(el('h2', { text: 'Strip' }), stage);
  if (unavailableNote) stripRegion.append(unavailableNote);
  stripRegion.append(loupeHost, calibrationControls);
  if (phoneWidth()) stripRegion.append(phonePanel);

  // --- pointer, keyboard and touch ------------------------------------------
  let dragStart = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return;
    dragStart = pointToScan(event);
  });
  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    if (event.target.closest('.loupe-host')) return;
    const [x, y] = pointToScan(event);
    if (dragStart && event.buttons === 1) {
      const [sx, sy] = dragStart;
      areaX.control.value = String(Math.min(sx, x));
      areaY.control.value = String(Math.min(sy, y));
      areaW.control.value = String(Math.max(1, Math.abs(x - sx)));
      areaH.control.value = String(Math.max(1, Math.abs(y - sy)));
      paintAreaBox();
      return;
    }
    moveLoupe(x, y);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') return;
    const [x, y] = pointToScan(event);
    const moved = dragStart && (Math.abs(x - dragStart[0]) > 3 || Math.abs(y - dragStart[1]) > 3);
    dragStart = null;
    if (!moved) {
      moveLoupe(x, y).then(() => pinCurrentCell());
    }
  });
  stage.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    closeLoupe();
  });

  canvas.addEventListener('focus', () => {
    if (cell) return;
    const first = scan.frames[0];
    if (first) {
      moveLoupe(Math.floor((first.x0 + first.x1) / 2), Math.floor(scan.height / 2));
    } else {
      moveLoupe(Math.floor(scan.width / 2), Math.floor(scan.height / 2));
    }
  });
  canvas.addEventListener('blur', () => closeLoupe());
  canvas.addEventListener('keydown', (event) => {
    const leap = event.shiftKey ? CELL_LEAP : CELL_STEP;
    const moves = {
      ArrowLeft: [-leap, 0],
      ArrowRight: [leap, 0],
      ArrowUp: [0, -leap],
      ArrowDown: [0, leap],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      const [x, y] = cell || [0, 0];
      moveLoupe(x + dx * SAMPLE_CELL, y + dy * SAMPLE_CELL);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pinCurrentCell();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLoupe();
      canvas.focus();
    }
  });

  // Touch: first tap opens, a tap elsewhere moves, a second tap on the cell pins.
  let touchStart = null;
  canvas.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    touchStart = [touch.clientX, touch.clientY];
  }, { passive: true });
  canvas.addEventListener('touchend', (event) => {
    if (event.touches.length > 0) return;
    const touch = event.changedTouches[0];
    if (touchStart) {
      const travelled = Math.hypot(touch.clientX - touchStart[0], touch.clientY - touchStart[1]);
      touchStart = null;
      if (travelled > 10) return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((touch.clientX - rect.left) / rect.width) * scan.width);
    const y = Math.floor(((touch.clientY - rect.top) / rect.height) * scan.height);
    const [cellX, cellY] = cellOrigin(x, y);
    if (cell && cell[0] === cellX && cell[1] === cellY) {
      event.preventDefault();
      pinCurrentCell();
      return;
    }
    event.preventDefault();
    moveLoupe(x, y);
  }, { passive: false });

  document.addEventListener('pointerdown', (event) => {
    if (!cell) return;
    if (!canvas.contains(event.target) && !loupeHost.contains(event.target)) closeLoupe();
  });

  // --- shooting notes -------------------------------------------------------
  const entriesById = new Map(sheet.entries.map((entry) => [entry.id, entry]));
  const readingLists = new Map();

  for (const frame of scan.frames) {
    const entry = frame.entry_id ? entriesById.get(frame.entry_id) : null;
    const titleField = field('Frame title', el('input', { type: 'text', value: frame.title }));
    const saveTitle = el('button', { type: 'button', class: 'ghost', text: 'Save title' });
    saveTitle.addEventListener('click', async () => {
      setFieldError(titleField, '');
      activity(COPY.pending.title);
      try {
        await api.patch(`/api/frames/${frame.id}`, { title: titleField.control.value });
        activity(COPY.success.title);
      } catch (failure) {
        if (failure.fields.title) {
          setFieldError(titleField, failure.fields.title);
          activity(failure.fields.title);
          titleField.control.focus();
          return;
        }
        activity(COPY.error[failure.code] || '');
      }
    });
    const readings = el('ul', {
      role: 'list',
      'aria-label': `Readings for frame ${frame.number}`,
      class: 'readings',
    });
    readingLists.set(frame.id, readings);
    const region = el('section', {
      role: 'region',
      'aria-label': `Frame ${frame.number}`,
      class: `frame-notes${wanted === frame.number ? ' wanted' : ''}`,
    }, [
      el('h3', { class: 'figures', text: `Frame ${frame.number}` }),
      el('p', { class: 'figures', text: `Edge ${frame.edge_number}` }),
      frame.unexposed ? badge('Unexposed') : null,
      frame.flag === 'flagged' ? badge('Flagged') : null,
      frame.blank_slot ? badge('Blank slot') : null,
      titleField.wrapper,
      saveTitle,
      entry
        ? el('p', { class: 'figures note-line' }, [
          el('span', { text: `Note ${entry.counter} · f/${entry.aperture} · ${entry.shutter}` }),
          el('span', { text: ` · EV ${entry.metered_ev} · ${format.stops(entry.relative_stops)} stops` }),
          el('span', { text: ` · ${entry.note}` }),
        ])
        : el('p', { class: 'muted', text: 'No note' }),
      readings,
    ]);
    notesRegion.append(region);
  }
  notesRegion.prepend(el('h2', { text: 'Shooting notes' }));
  const alignment = await api.get(`/api/rolls/${rollId}/alignment`);
  const noteDraft = readDraft(app.account ? app.account.id : null);
  notesRegion.append(entryList('Shooting log', sheet.entries, {
    roll,
    alignment,
    reload: async () => {
      await context.navigate(window.location.pathname + window.location.search, { replace: true });
    },
    restore: noteDraft && noteDraft.kind === 'note'
      && noteDraft.path === window.location.pathname + window.location.search
      ? noteDraft
      : null,
  }));

  function addReadingItem(reading) {
    const list = readingLists.get(reading.frame_id);
    if (!list) return;
    const empty = list.querySelector('.muted');
    if (empty) empty.remove();
    list.append(el('li', {
      class: 'figures',
      text: `Net ${format.density(reading.net)} · Gross ${format.density(reading.gross)}`
        + ` · log H ${format.logH(reading.log_h)} · Zone ${format.zone(reading.zone)}`,
    }));
  }

  for (const frame of scan.frames) {
    const { readings } = await api.get(`/api/frames/${frame.id}`);
    const list = readingLists.get(frame.id);
    if (readings.length === 0) {
      list.append(el('li', { class: 'muted', text: COPY.empty.no_readings }));
      continue;
    }
    for (const reading of readings) {
      addReadingItem(reading);
      addMarker(reading);
    }
  }

  section.append(stripRegion, curveRegion, notesRegion);

  if (wanted) {
    setTimeout(() => {
      const target = notesRegion.querySelector(`[aria-label="Frame ${wanted}"]`);
      if (target) target.scrollIntoView({ block: 'center' });
    }, 0);
  }
  window.addEventListener('resize', placeLoupe);
  return section;
}
