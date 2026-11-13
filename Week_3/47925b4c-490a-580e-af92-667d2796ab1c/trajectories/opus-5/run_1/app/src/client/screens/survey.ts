import { ApiProblem, call, newKey } from '../api.js';
import { append, button, clear, combobox, el, field, showFieldError, spinbutton, textbox } from '../dom.js';
import { listen } from '../events.js';
import { clearBand, heading, navigation, showBand } from '../shell.js';
import { dropOperation, enqueue, lastRejected, readQueue, sync, watchSync } from '../queue.js';
import { syncStatus } from '../sync.js';
import { emptySlot, wallFragment } from '../wall.js';
import type { SiteSummary } from './walls.js';

interface Reading {
  readonly id: string;
  readonly cell: string;
  readonly entered: { text: string; unit: string };
  readonly canonicalLux: string;
  readonly capturedAt: string;
  readonly counts: boolean;
}

interface PointGroup {
  readonly across: HTMLInputElement;
  readonly down: HTMLInputElement;
  readonly metresAcross: HTMLInputElement;
  readonly metresDown: HTMLInputElement;
  readonly node: HTMLElement;
}

function pointGroup(name: string): PointGroup {
  const across = spinbutton('Pixel across', 0, 1, { min: 0 });
  const down = spinbutton('Pixel down', 0, 1, { min: 0 });
  const metresAcross = textbox('Metres across');
  const metresDown = textbox('Metres down');
  const node = el('fieldset', { role: 'group', 'aria-label': name }, [
    el('legend', { text: name }),
    el('label', {}, ['Pixel across', across]),
    el('label', {}, ['Pixel down', down]),
    el('label', {}, ['Metres across', metresAcross]),
    el('label', {}, ['Metres down', metresDown]),
  ]);
  return { across, down, metresAcross, metresDown, node };
}

export async function renderSurvey(screen: HTMLElement, chrome: HTMLElement, siteId: string): Promise<() => void> {
  clear(chrome);
  chrome.appendChild(navigation('/sites'));

  const groups = [1, 2, 3, 4].map((index) => pointGroup(`Point ${index}`));
  const checkPoint = pointGroup('Check point');
  let focused: PointGroup = groups[0] as PointGroup;

  const photo = el('img', {
    alt: 'Upright wall photo',
    src: `/api/sites/${siteId}/photo/upright`,
    style: 'max-width:100%;border-radius:0.35em',
  });
  photo.addEventListener('error', () => photo.removeAttribute('src'));
  photo.addEventListener('click', (event) => {
    const box = photo.getBoundingClientRect();
    const scale = photo.naturalWidth / box.width;
    focused.across.value = String(Math.round((event.clientX - box.left) * scale));
    focused.down.value = String(Math.round((event.clientY - box.top) * scale));
  });
  for (const group of [...groups, checkPoint]) {
    for (const input of [group.across, group.down, group.metresAcross, group.metresDown]) {
      input.addEventListener('focus', () => {
        focused = group;
      });
    }
  }

  const chooser = el('input', { type: 'file', accept: 'image/jpeg,image/png', 'aria-label': 'Choose wall photo' });
  const upload = async (): Promise<void> => {
    const file = chooser.files?.[0];
    if (file === undefined) return;
    clearBand();
    const response = await fetch(`/api/sites/${siteId}/photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Idempotency-Key': newKey(),
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
    });
    if (!response.ok) {
      const body = (await response.json()) as { detail: string };
      showBand(body.detail);
      return;
    }
    photo.src = `/api/sites/${siteId}/photo/upright?at=${Date.now()}`;
    await draw();
  };
  chooser.addEventListener('change', () => void upload());

  const rectifyStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Rectify' });
  const rectify = async (): Promise<void> => {
    clearBand();
    const toPoint = (group: PointGroup): unknown => ({
      pixel: { x: Number(group.across.value), y: Number(group.down.value) },
      wall: {
        across: { text: group.metresAcross.value, unit: 'm' },
        down: { text: group.metresDown.value, unit: 'm' },
      },
    });
    try {
      const answer = await call<{ residualMetres: string }>(`/api/sites/${siteId}/rectification`, {
        method: 'POST',
        body: { points: groups.map(toPoint), check: toPoint(checkPoint) },
      });
      rectifyStatus.textContent = `Rectified to ${answer.residualMetres} m.`;
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const cellBox = textbox('Cell');
  const valueBox = textbox('Value');
  const unitBox = combobox(
    'Unit',
    ['lx', 'fc', 'cd/m2', 'fL'].map((unit) => ({ value: unit, label: unit })),
  );
  const saveReading = async (): Promise<void> => {
    showFieldError('reading/value', null);
    const cell = cellBox.value.trim().toUpperCase();
    for (const waiting of await readQueue()) {
      if (waiting.state === 'rejected' && waiting.cell === cell) await dropOperation(waiting.operationId);
    }
    entered.add(cell);
    await enqueue({
      operationId: crypto.randomUUID(),
      siteId,
      cell,
      value: { text: valueBox.value, unit: unitBox.value },
      capturedAt: new Date().toISOString(),
    });
    valueBox.value = '';
  };

  const entered = new Set<string>();
  const readingsBody = el('tbody');
  const sentenceHost = el('div');
  const staleHost = el('div');

  const drawReadings = async (): Promise<void> => {
    const cells = await call<{ items: { cell: string; readingCount: number }[] }>(`/api/sites/${siteId}/cells`);
    const withReadings = cells.items.filter((entry) => entry.readingCount > 0);
    const chosen = [
      ...withReadings.filter((entry) => entered.has(entry.cell)),
      ...withReadings.filter((entry) => !entered.has(entry.cell)),
    ].slice(0, Math.max(12, entered.size));
    const rows: HTMLElement[] = [];
    for (const cell of chosen) {
      const readings = await call<{ items: Reading[] }>(`/api/sites/${siteId}/cells/${cell.cell}/readings`);
      for (const reading of readings.items) {
        rows.push(
          el('tr', {}, [
            el('td', { text: reading.cell }),
            el('td', { text: `${reading.entered.text} ${reading.entered.unit}` }),
            el('td', { text: `${reading.canonicalLux} lx` }),
            el('td', { text: reading.capturedAt }),
          ]),
        );
      }
    }
    clear(readingsBody);
    append(readingsBody, rows);
  };

  const draw = async (): Promise<void> => {
    const current = await call<SiteSummary>(`/api/sites/${siteId}`);
    clear(sentenceHost);
    sentenceHost.appendChild(
      heading({
        sentence: current.rectified ? `THIS WALL IS MEASURED TO ${current.residualMetres} M` : 'NO WALL YET',
        slot: current.rectified ? wallFragment() : emptySlot('Empty wall frame'),
      }),
    );
    clear(staleHost);
    if (current.stale) {
      staleHost.appendChild(
        el('p', { class: 'stale', text: 'These readings are stale; street lighting and foliage change.' }),
      );
    }
    await drawReadings();
  };

  const sync_ = syncStatus();

  clear(screen);
  append(screen, [
    sentenceHost,
    staleHost,
    el('div', { class: 'columns' }, [
      el('div', { class: 'lede' }, [
        el('form', { 'aria-label': 'Wall photo', onsubmit: (event: Event) => event.preventDefault() }, [
          el('label', {}, ['Choose wall photo', chooser]),
          button('Choose wall photo', () => chooser.click()),
        ]),
        photo,
        el('form', { 'aria-label': 'Points', onsubmit: (event: Event) => event.preventDefault() }, [
          ...groups.map((group) => group.node),
          checkPoint.node,
          button('Rectify wall', () => void rectify()),
        ]),
        rectifyStatus,
      ]),
      el('div', { class: 'evidence' }, [
        el('form', { 'aria-label': 'Reading', onsubmit: (event: Event) => event.preventDefault() }, [
          el('label', {}, ['Cell', cellBox]),
          field('Value', valueBox, 'reading/value'),
          el('label', {}, ['Unit', unitBox]),
          button('Save reading', () => void saveReading()),
        ]),
        sync_.node,
        button('Sync now', () => void sync()),
        el('table', { 'aria-label': 'Readings' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Cell' }),
              el('th', { scope: 'col', text: 'Entered' }),
              el('th', { scope: 'col', text: 'Canonical lux' }),
              el('th', { scope: 'col', text: 'Captured' }),
            ]),
          ]),
          readingsBody,
        ]),
      ]),
    ]),
  ]);

  await draw();

  const stopWatching = watchSync((state) => {
    sync_.update(state);
    const rejected = lastRejected();
    if (state.needsFixing > 0 && rejected !== null) {
      const copy = Object.values(rejected.errors ?? {})[0] ?? null;
      showFieldError('reading/value', copy);
    }
  });
  const stopListening = listen('/api/events', (event) => {
    if (event.type === 'reading.accepted' && event.aggregateId === siteId) {
      entered.add(event.data['cell'] as string);
      void draw();
    }
  });
  return () => {
    stopWatching();
    stopListening();
  };
}
