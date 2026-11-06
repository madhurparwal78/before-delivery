// The strip workspace: Strip, Loupe reading, Characteristic curve and Shooting notes.
import { get, patch, post } from '../api.js';
import { failureCopy } from '../copy.js';
import { curveFigures, plotCurve } from '../curve.js';
import { announce, field, h, replace } from '../dom.js';
import { CURVE_READY, LIMITS, MESSAGES } from '../domain.js';
import { characters, fixed, signed } from '../format.js';
import { createStrip } from '../strip.js';
import { notFoundPage } from './shared.js';

const AREA_FIELDS = [['x', 'Area x'], ['y', 'Area y'], ['w', 'Area width'], ['h', 'Area height']];

export async function render(main, { params, query }) {
  const [rollId, scanId] = params;
  const [scanResponse, rollResponse] = await Promise.all([get(`/api/scans/${scanId}`), get(`/api/rolls/${rollId}`)]);
  if (!scanResponse.ok || !rollResponse.ok || scanResponse.data.roll_id !== rollId) return notFoundPage(main);
  const roll = rollResponse.data;
  const state = { scan: scanResponse.data, entries: [], details: new Map(), curve: null };

  async function loadAround() {
    const [scan, entries, curve] = await Promise.all([get(`/api/scans/${scanId}`), get(`/api/rolls/${rollId}/entries`), get(`/api/rolls/${rollId}/curve`)]);
    state.scan = scan.data;
    state.entries = entries.data.entries;
    state.curve = curve.data;
    const details = await Promise.all(state.scan.frames.map((frame) => get(`/api/frames/${frame.id}`)));
    state.details = new Map(details.map((response) => [response.data.frame.id, response.data]));
  }
  await loadAround();

  const frameNumber = (id) => state.scan.frames.find((frame) => frame.id === id).number;
  const allPins = () => [...state.details.values()].flatMap((detail) => detail.readings);

  // --- strip -----------------------------------------------------------------------------------------------------
  const zoneStatus = h('p', { role: 'status', 'aria-label': 'Curve zone', class: 'small' }, 'Zone —');
  let plot = plotCurve(state.curve);
  const strip = createStrip({
    scan: state.scan,
    onNudge: async (frame, key, value) => {
      announce(`Saving frame ${frame.number}…`);
      const response = await patch(`/api/frames/${frame.id}`, { [key]: value });
      if (!response.ok) {
        announce(failureCopy(response));
        return false;
      }
      announce(`Frame ${frame.number} saved.`);
      await reloadFrames();
      return true;
    },
    onAccept: async (frame) => {
      announce(`Saving frame ${frame.number}…`);
      const response = await post(`/api/frames/${frame.id}/accept-width`);
      if (!response.ok) {
        announce(failureCopy(response));
        return;
      }
      announce(`Frame ${frame.number} width accepted.`);
      await reloadFrames();
    },
    onPin: async (cell) => {
      announce('Pinning…');
      const response = await post(`/api/scans/${scanId}/readings`, { x: cell.x, y: cell.y });
      if (!response.ok) {
        announce(failureCopy(response));
        return;
      }
      const reading = response.data;
      state.details.get(reading.frame_id).readings.push(reading);
      strip.setPins(allPins());
      paintReadings(reading.frame_id);
      announce(`Pinned net ${fixed(reading.net)} on frame ${frameNumber(reading.frame_id)}.`);
    },
    onReading: (reading) => {
      plot.moveDot(reading?.logH ?? null, reading?.net ?? null);
      zoneStatus.textContent = `Zone ${reading?.zone ?? '—'}`;
    },
    onArea: (area) => {
      for (const [key] of AREA_FIELDS) areaInputs[key].value = String(area[key]);
      strip.setArea(area);
    },
  });

  async function reloadFrames() {
    const [scan, curve] = await Promise.all([get(`/api/scans/${scanId}`), get(`/api/rolls/${rollId}/curve`)]);
    state.scan = scan.data;
    state.curve = curve.data;
    strip.setFrames(state.scan.frames);
    paintCurve();
  }

  // --- calibration -----------------------------------------------------------------------------------------------
  const clear = h('input', { type: 'radio', name: 'method', id: 'method-clear', checked: true });
  const wedge = h('input', { type: 'radio', name: 'method', id: 'method-wedge' });
  const initial = { x: 0, y: 0, w: Math.min(32, state.scan.width), h: Math.min(32, state.scan.height) };
  const areaInputs = Object.fromEntries(AREA_FIELDS.map(([key]) => [key, h('input', { type: 'number', step: 1, value: initial[key] })]));
  const readArea = () => {
    const area = Object.fromEntries(AREA_FIELDS.map(([key]) => [key, areaInputs[key].value.trim() === '' ? NaN : Number(areaInputs[key].value)]));
    return Object.values(area).every(Number.isInteger) ? area : null;
  };
  for (const input of Object.values(areaInputs)) input.addEventListener('input', () => strip.setArea(readArea()));
  const calibrate = h('button', { type: 'button', class: 'primary' }, 'Calibrate');
  const find = h('button', { type: 'button' }, 'Find frames');
  const calibrationError = h('p', { class: 'field-error', hidden: true });
  calibrate.addEventListener('click', async () => {
    calibrationError.hidden = true;
    announce('Calibrating…');
    const method = wedge.checked ? 'step_wedge' : 'clear_light';
    const area = readArea() ?? { x: NaN, y: NaN, w: NaN, h: NaN };
    const response = await post(`/api/scans/${scanId}/calibration`, { method, area });
    if (!response.ok) {
      const message = failureCopy(response);
      calibrationError.textContent = message;
      calibrationError.hidden = response.status !== 422;
      announce(message);
      return;
    }
    announce(method === 'clear_light' ? 'Calibrated from clear light.' : 'Calibrated from the step wedge.');
    await reloadFrames();
  });
  find.addEventListener('click', async () => {
    announce('Finding frames…');
    const response = await post(`/api/scans/${scanId}/frames/detect`);
    if (!response.ok) {
      announce(failureCopy(response));
      return;
    }
    const flagged = response.data.frames.filter((frame) => frame.flag === 'flagged').length;
    announce(`Found ${response.data.frames.length} frames, ${flagged} flagged.`);
    await loadAround();
    strip.setFrames(state.scan.frames);
    strip.setPins(allPins());
    paintNotes();
    paintCurve();
  });
  const calibration = h('div', { class: 'calibration' },
    h('fieldset', {}, h('legend', {}, 'Calibration'), h('div', { class: 'methods' },
      h('label', { class: 'check', for: 'method-clear' }, clear, 'Clear light'), h('label', { class: 'check', for: 'method-wedge' }, wedge, 'Step wedge'))),
    h('div', { class: 'area' }, AREA_FIELDS.map(([key, label]) => field(label, areaInputs[key]).root)),
    calibrationError, h('div', { class: 'actions' }, calibrate, find));

  // --- curve -----------------------------------------------------------------------------------------------------
  const curvePanel = h('section', { 'aria-label': 'Characteristic curve', class: 'curve-region curve-panel' });
  function paintCurve() {
    const curve = state.curve;
    plot = plotCurve(curve);
    const normal = roll.kind === 'normal';
    let body;
    if (curve.ready) body = curveFigures(curve, { bias: normal });
    else if (normal) body = h('p', {}, 'No curve yet. Link a curve-ready test roll.');
    else body = h('p', {}, `Needs at least ${CURVE_READY.frames} aligned bracket frames spanning ${CURVE_READY.span} stops (now ${curve.frames_used} frames, ${curve.stops_span.toFixed(1)} stops).`);
    replace(curvePanel, h('h2', {}, 'Characteristic curve'), plot.svg, zoneStatus, body);
  }

  // --- notes -----------------------------------------------------------------------------------------------------
  const notes = h('section', { 'aria-label': 'Shooting notes', class: 'notes-region' });
  function paintReadings(frameId) {
    const region = notes.querySelector(`[data-frame="${frameId}"]`);
    const readings = state.details.get(frameId).readings;
    region.querySelector('ul').replaceChildren(...readings.map((reading) => h('li', {},
      `Net ${fixed(reading.net)} · Gross ${fixed(reading.gross)} · log H ${reading.log_h === null ? '—' : signed(reading.log_h)} · Zone ${reading.zone ?? '—'}`)));
    region.querySelector('.none').hidden = readings.length > 0;
  }

  function frameRegion(frame) {
    const entry = state.entries.find((candidate) => candidate.frame_id === frame.id);
    const title = h('input', { type: 'text', value: frame.title });
    const titleField = field('Frame title', title);
    const save = h('button', { type: 'button' }, 'Save title');
    save.addEventListener('click', async () => {
      titleField.setError(null);
      if (characters(title.value) > LIMITS.title) {
        titleField.setError(MESSAGES.title);
        announce(MESSAGES.title);
        title.focus();
        return;
      }
      announce('Saving title…');
      const response = await patch(`/api/frames/${frame.id}`, { title: title.value.trim() });
      if (response.status === 422) {
        titleField.setError(response.data.fields.title);
        announce(response.data.fields.title);
        return;
      }
      if (!response.ok) {
        announce(failureCopy(response));
        return;
      }
      announce('Title saved.');
    });
    const facts = entry
      ? h('div', { class: 'facts' }, h('strong', {}, `Note ${entry.counter}`), h('span', {}, `f/${entry.aperture}`), h('span', {}, entry.shutter),
        h('span', {}, `EV ${entry.metered_ev}`), h('span', {}, `${signed(entry.relative_stops)} stops`), entry.note ? h('span', {}, entry.note) : null)
      : h('div', { class: 'facts' }, h('span', { class: 'muted' }, 'No note'));
    const region = h('section', { 'aria-label': `Frame ${frame.number}`, class: 'frame-note', 'data-frame': frame.id },
      h('h3', {}, `Frame ${frame.number}`), h('p', { class: 'muted small' }, `Edge ${frame.edge_number}`),
      h('div', { class: 'title-row' }, titleField.root, save), facts,
      h('ul', { role: 'list', 'aria-label': `Readings for frame ${frame.number}` }), h('p', { class: 'muted small none' }, 'No pinned readings.'));
    return region;
  }

  function paintNotes() {
    replace(notes, h('h2', {}, 'Shooting notes'), ...state.scan.frames.map(frameRegion));
    for (const frame of state.scan.frames) paintReadings(frame.id);
  }

  main.append(h('div', { class: 'page-head compact' }, h('h1', {}, `Strip ${state.scan.position}`),
    h('p', { class: 'muted' }, h('a', { href: `/rolls/${rollId}` }, roll.name))),
  h('div', { class: 'stage' },
    h('section', { 'aria-label': 'Strip', class: 'strip-region' }, strip.box, calibration),
    strip.loupePanel, curvePanel, notes));
  paintCurve();
  paintNotes();
  strip.setFrames(state.scan.frames);
  strip.setPins(allPins());
  strip.setArea(readArea());
  const current = Number(query.get('frame'));
  if (current) strip.setCurrent(current);
  await strip.load();
  if (current) notes.querySelector(`[aria-label="Frame ${current}"]`)?.scrollIntoView({ block: 'center' });
  return undefined;
}
