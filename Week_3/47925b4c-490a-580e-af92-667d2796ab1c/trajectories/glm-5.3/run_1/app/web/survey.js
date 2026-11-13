// The survey: photo upload, reference points, rectification and readings (DP-02 to DP-07).

import { h, clear, announce, showProblem, hideProblem, statusRegion, fieldError, COPY } from './ui.js';
import { api, idempotencyKey, enqueueReading, loadQueue, syncQueue, formatCents } from './app.js';
import { route, state, syncRegion, drawSync } from './main.js';

const LENGTH_UNITS = ['m', 'ft'];
const READING_UNITS = ['lx', 'fc', 'cd/m2', 'fL'];

export async function renderSurvey(shell, band, siteId) {
  const site = await api.get(`/api/sites/${siteId}`);
  const cells = await api.get(`/api/sites/${siteId}/cells`);
  shell.append(nav('/sites'));

  const heading = h('h1', { class: 'sentence' });
  const frame = h('span', { class: 'slot empty', 'aria-hidden': 'true' }, '');
  const rectified = site.rectified;
  heading.append(
    rectified ? `THIS WALL IS MEASURED TO ${site.residualMetres} M` : 'NO WALL YET',
    rectified ? wallSlot() : frame);
  shell.append(heading);

  const evidence = h('div', { class: 'two-col' });

  // photo, points
  const photoWrap = h('div');
  photoWrap.append(await photoSection(shell, band, site));
  photoWrap.append(pointsSection(band, site));

  // readings
  const readingsSection = await readings(shell, band, site, cells);

  evidence.append(photoWrap, readingsSection);
  shell.append(evidence);
}

async function photoSection(shell, band, site) {
  const wrap = h('div');
  const photoStatus = statusRegion('Photo');
  const choose = h('button', { onclick: () => input.click() }, 'Choose wall photo');
  const input = h('input', {
    type: 'file',
    accept: 'image/jpeg,image/png',
    'aria-label': 'Choose wall photo',
    style: 'display:none',
    onchange: async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      hideProblem(band);
      const bytes = await file.arrayBuffer();
      const response = await fetch(`/api/sites/${site.id}/photo`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'Idempotency-Key': idempotencyKey('photo', `${file.name}-${file.size}`),
        },
        body: bytes,
      });
      if (!response.ok) {
        const problem = await response.json();
        showProblem(band, problem);
        return;
      }
      route(window.location.pathname);
    },
  });

  if (site.rectified || site.photoKey) {
    const img = h('img', { src: `/api/sites/${site.id}/photo/upright`, alt: 'Upright wall photo', style: 'max-width:100%;border-radius:12px' });
    wrap.append(img);
  }
  wrap.append(h('div', { class: 'row' }, choose, input, photoStatus));
  return wrap;
}

function pointsSection(band, site) {
  const status = statusRegion('Rectify');
  const groups = [];
  const rows = [1, 2, 3, 4, 'Check'];
  for (const row of rows) {
    const name = row === 'Check' ? 'Check point' : `Point ${row}`;
    const acrossPx = h('input', { type: 'number', 'aria-label': 'Pixel across', value: '0', min: '0', step: '1' });
    const downPx = h('input', { type: 'number', 'aria-label': 'Pixel down', value: '0', min: '0', step: '1' });
    const acrossMetres = h('input', { type: 'text', 'aria-label': 'Metres across', value: '0' });
    const downMetres = h('input', { type: 'text', 'aria-label': 'Metres down', value: '0' });
    const group = h('fieldset', { role: 'group', 'aria-label': name },
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('label', {}, 'Pixel across'), acrossPx),
        h('div', { class: 'grow' }, h('label', {}, 'Pixel down'), downPx),
        h('div', { class: 'grow' }, h('label', {}, 'Metres across'), acrossMetres),
        h('div', { class: 'grow' }, h('label', {}, 'Metres down'), downMetres)));
    groups.push({ acrossPx, downPx, acrossMetres, downMetres, group });
  }

  const rectify = h('button', {
    onclick: async () => {
      hideProblem(band);
      clear(status);
      const points = groups.slice(0, 4).map((g) => pointOf(g));
      const check = pointOf(groups[4]);
      try {
        const result = await api.post(`/api/sites/${site.id}/rectification`, { points, check });
        announce(status, COPY.rectifySuccess(result.residualMetres));
        setTimeout(() => route(`/sites/${site.id}/layouts/${site.layouts[0].id}`), 900);
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  }, 'Rectify wall');

  return h('div', {}, h('form', { 'aria-label': 'Points', onsubmit: (e) => { e.preventDefault(); rectify.click(); } },
    groups.map((g) => g.group), rectify), status);
}

function pointOf(group) {
  return {
    pixel: { x: Number(group.acrossPx.value), y: Number(group.downPx.value) },
    wall: { across: { text: group.acrossMetres.value, unit: 'm' }, down: { text: group.downMetres.value, unit: 'm' } },
  };
}

async function readings(shell, band, site, cells) {
  const wrap = h('div');
  const sync = syncRegion(site.id);
  const cellField = h('input', { type: 'text', 'aria-label': 'Cell', placeholder: 'A1' });
  const valueField = h('input', { type: 'text', 'aria-label': 'Value', placeholder: '30' });
  const unitField = h('select', { 'aria-label': 'Unit' }, READING_UNITS.map((unit) => h('option', { value: unit }, unit)));
  const valueError = fieldError('reading-value-error', null);
  const capturedNote = h('span', {}, '');

  // seed the queue counts from the durable queue
  const queue = loadQueue();
  state.sync = { waiting: queue.filter((op) => !op.rejected).length, needsFixing: queue.filter((op) => op.rejected).length, sending: false };
  drawSync(sync.firstChild);

  const save = h('button', {
    type: 'submit',
    onclick: async () => {
      // Always place the reading on the device queue; the server alone judges it.
      const operation = {
        operationId: `op-${crypto.randomUUID()}`,
        cell: cellField.value.trim().toUpperCase(),
        value: { text: valueField.value, unit: unitField.value },
        capturedAt: new Date().toISOString(0).replace('Z', '+00:00'),
      };
      state.sync.waiting += 1;
      drawSync(sync.firstChild);
      enqueueReading(operation);
      if (navigator.onLine) {
        const result = await syncQueue(site.id, () => drawSync(sync.firstChild));
        state.sync.waiting = result.waiting;
        state.sync.needsFixing = result.needsFixing;
        drawSync(sync.firstChild);
      }
    },
  }, 'Save reading');

  const form = h('form', {
    'aria-label': 'Reading',
    onsubmit: (event) => { event.preventDefault(); save.click(); },
  },
    h('div', { class: 'row' },
      h('div', { style: 'flex:0 0 90px' }, h('label', {}, 'Cell'), cellField),
      h('div', { class: 'grow' }, h('label', {}, 'Value'), valueField),
      h('div', { style: 'flex:0 0 110px' }, h('label', {}, 'Unit'), unitField)),
    valueError, save, sync, capturedNote);

  const table = h('table', { 'aria-label': 'Readings' });
  table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Cell'), h('th', {}, 'Entered'), h('th', {}, 'Lux'), h('th', {}, 'Captured'))));
  const body = h('tbody');
  const entries = await loadRecentReadings(site.id, cells);
  for (const reading of entries) {
    body.append(h('tr', {},
      h('td', {}, reading.cell),
      h('td', {}, `${reading.entered.text} ${reading.entered.unit}`),
      h('td', {}, reading.canonicalLux),
      h('td', {}, reading.capturedAt.replace('T', ' ').slice(0, 16))));
  }
  table.append(body);
  wrap.append(form, table);
  return wrap;
}

async function loadRecentReadings(siteId, cells) {
  const out = [];
  const sample = cells.items.slice(0, 12);
  for (const cell of sample) {
    if (cell.readingCount === 0) continue;
    const readings = await api.get(`/api/sites/${siteId}/cells/${cell.cell}/readings`);
    out.push(...readings.items.slice(0, 1));
  }
  return out.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
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

function wallSlot() {
  return h('span', { class: 'slot', 'aria-hidden': 'true' }, 'measured');
}
