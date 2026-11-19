// The nine sections of the car file. Each one owns its own controls and patches itself in place,
// so a poll never clears a typed value or moves focus.

import { api, Attempt, NoReply, Refused } from '../api.js';
import { all, el, find, keyedList, on, setText, svg } from '../dom.js';
import { BLOCKER_COPY, MESSAGE, OFFER_WORD, ALERT_WORD, LINK_WORD, ODOMETER_FLAG, RECURRED_FLAG } from '../../shared/copy.js';
import { PANELS, isGaugeable } from '../../shared/panels.js';
import { DIAGRAM_HEIGHT, DIAGRAM_WIDTH, diagramSvg, pinAt, rectOf } from '../../shared/diagram.js';
import { bandClass, money, showDate, timeLeft } from '../format.js';
import { showMicrons } from '../parts/units.js';
import { Overlay } from '../ui/overlay.js';
import { announce, announceSteps, statusRegion } from '../ui/status.js';
import { pressable } from '../ui/pending.js';
import { entrance } from '../ui/entrance.js';
import { emptyState } from './ended.js';
import type { Stage } from '../stage/stage.js';
import type {
  AlertRow, CarView, LinkRow, LinkSlot, OwnerFinding, OwnerOffer, PanelView, RecordView, UploadView,
} from '../types.js';
import { fillFindingMeta } from '../parts/finding-meta.js';

export interface CarData {
  car: CarView;
  panels: PanelView[];
  medians: { steel: number | null; aluminium: number | null };
  findings: OwnerFinding[];
  uploads: UploadView[];
  record: RecordView | null;
  links: LinkRow[];
  slots: LinkSlot[];
  offers: OwnerOffer[];
  alerts: AlertRow[];
}

export interface CarFileContext {
  carId: string;
  data: () => CarData;
  status: () => HTMLElement;
  notice: () => HTMLElement;
  preview: Stage;
  act: <T>(options: {
    pending: string;
    run: () => Promise<T>;
    success?: string | ((value: T) => string);
    region?: HTMLElement;
    onRefused?: (error: Refused) => boolean;
    ownKeys?: string[];
    focusHome?: () => void;
  }) => Promise<T | null>;
  refresh: (ownKeys: string[]) => Promise<void>;
  hold: (held: boolean) => void;
  /** Lets held poll announcements through, after this action's success copy. */
  release: () => void;
  setPreviewPin: (pin: { panelId: string; u: number; v: number } | null) => void;
}

interface Sections {
  byFragment: Record<string, HTMLElement>;
  paint: (data: CarData) => void;
}

function findingMeta(finding: OwnerFinding): HTMLElement {
  const line = el('p', { class: 'finding-meta' });
  fillFindingMeta(line, finding);
  return line;
}

function section(fragment: string, heading: string, body: (HTMLElement | null)[]): HTMLElement {
  return el('section', { id: fragment, class: 'car-section' }, [
    entrance(el('h2', { tabindex: '-1' }, [heading])),
    ...body.filter((node): node is HTMLElement => node !== null),
  ]);
}

export function buildSections(context: CarFileContext): Sections {
  const painters: ((data: CarData) => void)[] = [];
  const byFragment: Record<string, HTMLElement> = {};

  const add = (fragment: string, node: HTMLElement, paint: (data: CarData) => void): void => {
    byFragment[fragment] = node;
    painters.push(paint);
  };

  // ---- Panels and readings ----
  const readingsBody = el('tbody');
  const readingsErrors = new Map<string, HTMLElement>();
  const readingInputs = new Map<string, HTMLInputElement>();
  const saveReadings = el('button', { type: 'button', class: 'pill pill-solid' }, ['Save readings']);
  pressable(saveReadings, async () => {
    const readings: { panelId: string; microns: number }[] = [];
    for (const [panelId, input] of readingInputs) {
      if (input.value.trim() === '') continue;
      if (input.dataset.saved === input.value) continue;
      readings.push({ panelId, microns: Number(input.value) });
    }
    if (readings.length === 0) return;
    for (const error of readingsErrors.values()) {
      error.hidden = true;
      error.textContent = '';
    }
    await context.act({
      pending: 'Saving readings',
      success: 'Readings saved',
      ownKeys: ['panels', 'publish'],
      run: () => api.put(`/api/owner/cars/${context.carId}/readings`, { readings }),
      onRefused: (error) => {
        if (!error.body.errors) return false;
        for (const [panelId, message] of Object.entries(error.body.errors)) {
          const holder = readingsErrors.get(panelId);
          if (holder) {
            holder.hidden = false;
            holder.textContent = message;
          }
        }
        void announceSteps(context.status(), [Object.values(error.body.errors)[0]]);
        return true;
      },
    });
  });

  const diagramHolder = el('div', { class: 'diagram-holder' }, [svg(diagramSvg({}))]);
  add('panels', section('panels', 'Panels and readings', [
    el('div', { class: 'panels-layout' }, [
      diagramHolder,
      el('div', { class: 'card' }, [
        el('table', { 'aria-label': 'Panel readings', class: 'readings-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { scope: 'col' }, ['Panel']),
            el('th', { scope: 'col' }, ['Microns']),
            el('th', { scope: 'col' }, ['Band']),
            el('th', { scope: 'col' }, ['Inspector']),
          ])]),
          readingsBody,
        ]),
        saveReadings,
      ]),
    ]),
  ]), (data) => {
    keyedList(readingsBody, data.panels, (panel) => panel.id, (panel) => {
      const error = el('p', { class: 'field-error', hidden: true });
      readingsErrors.set(panel.id, error);
      const cell = el('td', {});
      if (isGaugeable(panel.id)) {
        const input = el('input', {
          type: 'number', min: '1', max: '2000', step: '1',
          'aria-label': `Microns for ${panel.label}`, class: 'field-input figures',
        });
        readingInputs.set(panel.id, input);
        cell.append(input, error);
      } else {
        cell.append(el('span', {}, ['Not gauged']), error);
      }
      return el('tr', {}, [
        el('th', { scope: 'row' }, [panel.label]),
        cell,
        el('td', { class: 'band-cell' }, [el('span', {})]),
        el('td', { class: 'figures inspector-figure inspector-cell' }, ['']),
      ]);
    }, (row, panel) => {
      const input = readingInputs.get(panel.id);
      const stored = panel.owner.microns;
      if (input && document.activeElement !== input) {
        const text = stored === null ? '' : String(stored);
        if (input.dataset.saved !== text) {
          input.value = text;
          input.dataset.saved = text;
        }
      } else if (input) {
        input.dataset.saved = stored === null ? '' : String(stored);
      }
      const band = find<HTMLElement>(row, '.band-cell span') as HTMLElement;
      setText(band, panel.owner.band);
      band.className = bandClass(panel.owner.band);
      setText(find(row, '.inspector-cell'), panel.inspector.map((item) => showMicrons(item.microns)).join(', ') || '—');
    });
  });

  // ---- Findings ----
  const panelListbox = el('ul', { role: 'listbox', 'aria-label': 'Panels', tabindex: '0', class: 'panel-listbox' },
    PANELS.map((panel) => el('li', { role: 'option', 'aria-selected': 'false', 'data-panel': panel.id }, [panel.label])));
  const pinButton = el('button', { type: 'button', class: 'pin-button' }, ['Finding pin']);
  const findingDiagram = el('div', { class: 'diagram-holder' });
  const titleField = el('input', { type: 'text', 'aria-label': 'Finding title', class: 'field-input' });
  const wordingField = el('input', { type: 'text', 'aria-label': 'Finding wording', class: 'field-input' });
  const severityField = el('select', { 'aria-label': 'Severity', class: 'field-input' },
    ['cosmetic', 'moderate', 'serious'].map((value) => el('option', { value }, [value])));
  const photoField = el('select', { 'aria-label': 'Finding photo', class: 'field-input' });
  const saveFinding = el('button', { type: 'button', class: 'pill pill-solid' }, ['Save finding']);
  const findingList = el('ul', { role: 'list', 'aria-label': 'Findings', class: 'finding-list' });
  const previewHolder = el('div', { class: 'preview-holder' }, [context.preview.element]);

  let chosenPanel: string | null = null;
  let pin = { u: 0.5, v: 0.5 };
  let editing: OwnerFinding | null = null;

  const paintPin = (): void => {
    const at = chosenPanel ? pinAt(chosenPanel, pin.u, pin.v) : null;
    findingDiagram.replaceChildren(svg(diagramSvg({
      interactive: true,
      pins: at ? [{ x: at.x, y: at.y, label: 'Finding pin', strong: true }] : [],
    })));
    const node = findingDiagram.firstElementChild;
    if (node) {
      on(node, 'pointerdown', (event) => {
        const pointer = event as PointerEvent;
        const rect = (node as SVGElement).getBoundingClientRect();
        const x = ((pointer.clientX - rect.left) / rect.width) * DIAGRAM_WIDTH;
        const y = ((pointer.clientY - rect.top) / rect.height) * DIAGRAM_HEIGHT;
        const hit = PANELS.map((panel) => rectOf(panel.id)).find((shape) =>
          shape && x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height);
        if (!hit) return;
        event.preventDefault();
        choosePanel(hit.id, {
          u: Math.round(((x - hit.x) / hit.width) * 1000) / 1000,
          v: Math.round(((y - hit.y) / hit.height) * 1000) / 1000,
        });
      });
    }
    if (chosenPanel) context.setPreviewPin({ panelId: chosenPanel, u: pin.u, v: pin.v });
  };

  const choosePanel = (panelId: string, at = { u: 0.5, v: 0.5 }): void => {
    chosenPanel = panelId;
    pin = at;
    for (const option of all(panelListbox, '[role="option"]')) {
      option.setAttribute('aria-selected', option.getAttribute('data-panel') === panelId ? 'true' : 'false');
    }
    paintPin();
  };
  paintPin();

  on(panelListbox, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    event.preventDefault();
    const index = PANELS.findIndex((panel) => panel.id === chosenPanel);
    const next = key === 'ArrowDown'
      ? Math.min(PANELS.length - 1, index + 1)
      : Math.max(0, index <= 0 ? 0 : index - 1);
    choosePanel(PANELS[next].id);
    void announceSteps(context.status(), [`Panel ${PANELS[next].label}`]);
  });
  for (const option of all(panelListbox, '[role="option"]')) {
    on(option, 'click', () => choosePanel(option.getAttribute('data-panel') ?? PANELS[0].id));
  }

  on(pinButton, 'keydown', (event) => {
    const press = event as KeyboardEvent;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const step = steps[press.key];
    if (!step || !chosenPanel) return;
    press.preventDefault();
    const size = press.shiftKey ? 0.05 : 0.01;
    pin = {
      u: Math.min(1, Math.max(0, Math.round((pin.u + step[0] * size) * 1000) / 1000)),
      v: Math.min(1, Math.max(0, Math.round((pin.v + step[1] * size) * 1000) / 1000)),
    };
    paintPin();
    void announceSteps(context.status(), [
      `Pin at ${Math.round(pin.u * 100)}% across, ${Math.round(pin.v * 100)}% down`,
    ]);
  });

  pressable(saveFinding, async () => {
    if (!chosenPanel) {
      await announceSteps(context.status(), ['Choose a panel for the finding']);
      return;
    }
    const body = {
      panelId: chosenPanel,
      u: pin.u,
      v: pin.v,
      title: titleField.value,
      wording: wordingField.value,
      severity: severityField.value,
      photoId: photoField.value === '' ? null : photoField.value,
    };
    const current = editing;
    const done = await context.act({
      pending: 'Saving finding',
      success: 'Finding saved',
      ownKeys: ['findings', 'publish'],
      run: () => (current
        ? api.patch(`/api/owner/cars/${context.carId}/findings/${current.id}`, body,
          { 'If-Match': `"${current.revision}"` })
        : api.post(`/api/owner/cars/${context.carId}/findings`, body)),
      onRefused: (error) => {
        if (error.status === 412) {
          void announceSteps(context.status(), [MESSAGE.staleFinding]);
          return true;
        }
        return false;
      },
    });
    if (done) {
      editing = null;
      titleField.value = '';
      wordingField.value = '';
      chosenPanel = null;
      context.setPreviewPin(null);
      paintPin();
    }
  });

  add('findings', section('findings', 'Findings', [
    el('div', { class: 'card preview-card' }, [previewHolder]),
    el('div', { class: 'card finding-form' }, [
      el('div', { class: 'finding-grid' }, [
        el('div', {}, [el('p', { class: 'field-label' }, ['Panel']), panelListbox]),
        el('div', {}, [findingDiagram, pinButton]),
      ]),
      el('label', { class: 'field' }, [el('span', {}, ['Finding title']), titleField]),
      el('label', { class: 'field' }, [el('span', {}, ['Finding wording']), wordingField]),
      el('label', { class: 'field' }, [el('span', {}, ['Severity']), severityField]),
      el('label', { class: 'field' }, [el('span', {}, ['Finding photo']), photoField]),
      saveFinding,
    ]),
    findingList,
  ]), (data) => {
    keyedList(photoField, [{ id: '', fileName: 'No photo' } as { id: string; fileName: string },
      ...data.uploads.filter((upload) => upload.kind === 'photo')],
    (upload) => upload.id || 'none',
    (upload) => el('option', { value: upload.id }, [upload.fileName]),
    () => undefined);
    if (data.findings.length === 0) {
      findingList.replaceChildren(el('li', {}, [emptyState(MESSAGE.noFindings)]));
      return;
    }
    keyedList(findingList, data.findings, (finding) => finding.id, () => el('li', { class: 'finding-row' }), (row, finding) => {
      const edit = el('button', { type: 'button', class: 'pill pill-quiet' }, [`Edit ${finding.title}`]);
      on(edit, 'click', () => {
        editing = finding;
        choosePanel(finding.panelId, { u: finding.u, v: finding.v });
        titleField.value = finding.title;
        wordingField.value = finding.wording;
        severityField.value = finding.severity;
        photoField.value = finding.photoId ?? '';
      });
      const remove = el('button', { type: 'button', class: 'pill pill-quiet' }, [`Remove ${finding.title}`]);
      pressable(remove, () => context.act({
        pending: 'Removing finding',
        success: 'Finding removed',
        ownKeys: ['findings', 'publish'],
        run: () => api.delete(`/api/owner/cars/${context.carId}/findings/${finding.id}`,
          { 'If-Match': `"${finding.revision}"` }),
        onRefused: (error) => {
          if (error.status !== 412) return false;
          void announceSteps(context.status(), [MESSAGE.staleFinding]);
          return true;
        },
      }).then(() => undefined));
      row.replaceChildren(
        el('p', { class: 'finding-title' }, [`${finding.position}. ${finding.title}`]),
        findingMeta(finding),
        el('p', {}, [finding.wording]),
        el('div', { class: 'row-actions' }, [edit, remove]),
      );
    });
  });

  // ---- Evidence ----
  const evidence = buildEvidence(context);
  add('evidence', evidence.node, evidence.paint);

  // ---- Test record ----
  const record = buildRecord(context);
  add('record', record.node, record.paint);

  // ---- Publish ----
  const publish = buildPublish(context);
  add('publish', publish.node, publish.paint);

  // ---- People ----
  const people = buildPeople(context);
  add('people', people.node, people.paint);

  // ---- Viewings ----
  const viewings = buildViewings(context);
  add('viewings', viewings.node, viewings.paint);

  // ---- Offers ----
  const offers = buildOffers(context);
  add('offers', offers.node, offers.paint);

  // ---- Alerts ----
  const alerts = buildAlerts(context);
  add('alerts', alerts.node, alerts.paint);

  return {
    byFragment,
    paint: (data) => {
      for (const painter of painters) painter(data);
    },
  };
}

// ---------------------------------------------------------------- Evidence

function buildEvidence(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const picker = el('input', { type: 'file', accept: 'image/jpeg,image/png', hidden: true });
  const invoicePicker = el('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf', hidden: true });
  const addPhoto = el('button', { type: 'button', class: 'pill pill-solid' }, ['Add photo']);
  const storePhoto = el('button', { type: 'button', class: 'pill pill-solid' }, ['Store photo']);
  const preview = el('canvas', { role: 'img', 'aria-label': 'Photo preview', class: 'photo-preview' });
  const previewHolder = el('div', { class: 'preview-slot' });
  const maskFields = new Map<string, HTMLInputElement>();
  const noPlate = el('input', { type: 'checkbox', 'aria-label': 'No plate in this photo' });
  const maskError = el('p', { class: 'field-error', hidden: true });
  const list = el('ul', { role: 'list', 'aria-label': 'Evidence', class: 'evidence-list' });
  const invoiceLabel = el('input', { type: 'text', 'aria-label': 'Invoice label', class: 'field-input' });
  const addInvoice = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Add invoice']);

  let chosen: File | null = null;
  let generation = 0;

  const maskGroup = el('fieldset', { class: 'mask-group', 'aria-label': 'Plate mask' }, [
    ...['Mask left', 'Mask top', 'Mask width', 'Mask height'].map((label) => {
      const input = el('input', {
        type: 'number', min: '0', max: '100', step: '0.1', 'aria-label': label, class: 'field-input figures',
      });
      maskFields.set(label, input);
      return el('label', { class: 'field field-inline' }, [el('span', {}, [label]), input]);
    }),
    el('label', { class: 'field field-inline' }, [el('span', {}, ['No plate in this photo']), noPlate]),
    maskError,
  ]);

  const clearMask = (): void => {
    for (const input of maskFields.values()) input.value = '';
    noPlate.checked = false;
    maskError.hidden = true;
  };

  on(addPhoto, 'click', () => picker.click());
  on(picker, 'change', () => {
    const file = picker.files?.[0] ?? null;
    if (!file) return;
    chosen = file;
    clearMask();
    const mine = ++generation;
    void showPreview(file, preview, previewHolder, () => mine === generation);
  });

  on(addInvoice, 'click', () => invoicePicker.click());
  on(invoicePicker, 'change', () => {
    const file = invoicePicker.files?.[0] ?? null;
    if (!file) return;
    void context.act({
      pending: 'Storing file',
      ownKeys: ['evidence'],
      run: () => sendUpload(context.carId, file, { kind: 'invoice', label: invoiceLabel.value }),
      success: 'File stored',
      onRefused: (error) => {
        void announceSteps(context.status(), [uploadRefusal(error)]);
        return true;
      },
    });
  });

  const dragState = { on: false, startX: 0, startY: 0 };
  on(preview, 'pointerdown', (event) => {
    const pointer = event as PointerEvent;
    event.preventDefault();
    const rect = preview.getBoundingClientRect();
    dragState.on = true;
    dragState.startX = (pointer.clientX - rect.left) / rect.width;
    dragState.startY = (pointer.clientY - rect.top) / rect.height;
    preview.setPointerCapture(pointer.pointerId);
  });
  const dragTo = (event: Event): void => {
    if (!dragState.on) return;
    const pointer = event as PointerEvent;
    event.preventDefault();
    const rect = preview.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (pointer.clientY - rect.top) / rect.height));
    const left = Math.min(dragState.startX, x);
    const top = Math.min(dragState.startY, y);
    const width = Math.abs(x - dragState.startX);
    const height = Math.abs(y - dragState.startY);
    const put = (label: string, value: number): void => {
      const input = maskFields.get(label);
      if (input) input.value = (value * 100).toFixed(1);
    };
    put('Mask left', left);
    put('Mask top', top);
    put('Mask width', width);
    put('Mask height', height);
  };
  on(preview, 'pointermove', dragTo);
  on(preview, 'pointerup', (event) => {
    dragTo(event);
    dragState.on = false;
  });
  on(preview, 'touchmove', (event) => event.preventDefault(), { passive: false });

  pressable(storePhoto, async () => {
    if (!chosen) return;
    const values = ['Mask left', 'Mask top', 'Mask width', 'Mask height']
      .map((label) => Number(maskFields.get(label)?.value ?? ''));
    const hasMask = values.every((value) => Number.isFinite(value)) && values[2] > 0 && values[3] > 0;
    const mask = hasMask
      ? { x: values[0] / 100, y: values[1] / 100, w: values[2] / 100, h: values[3] / 100 }
      : null;
    if (!mask && !noPlate.checked) {
      maskError.hidden = false;
      maskError.textContent = MESSAGE.maskRequired;
      void announceSteps(context.status(), [MESSAGE.maskRequired]);
      return;
    }
    maskError.hidden = true;
    const file = chosen;
    const stored = await context.act({
      pending: 'Storing file',
      ownKeys: ['evidence'],
      run: () => sendUpload(context.carId, file, { kind: 'photo', mask }),
      onRefused: (error) => {
        const message = uploadRefusal(error);
        maskError.hidden = false;
        maskError.textContent = message;
        void announceSteps(context.status(), [message]);
        return true;
      },
    });
    if (!stored) return;
    await announceSteps(context.status(), ['File stored']);
    if (stored.locationRemoved) {
      await announceSteps(context.status(), ['Location removed from the buyer copy']);
    }
    chosen = null;
    picker.value = '';
    clearMask();
    previewHolder.replaceChildren();
    addPhoto.focus();
  });

  const node = section('evidence', 'Evidence', [
    el('div', { class: 'card' }, [
      el('div', { class: 'row-actions' }, [addPhoto, picker, storePhoto]),
      previewHolder,
      maskGroup,
    ]),
    el('div', { class: 'card' }, [
      el('label', { class: 'field' }, [el('span', {}, ['Invoice label']), invoiceLabel]),
      el('div', { class: 'row-actions' }, [addInvoice, invoicePicker]),
    ]),
    list,
  ]);

  return {
    node,
    paint: (data) => {
      if (data.uploads.length === 0) {
        list.replaceChildren(el('li', {}, ['No files yet']));
        return;
      }
      keyedList(list, data.uploads, (upload) => upload.id, () => el('li', { class: 'evidence-row' }), (row, upload) => {
        row.replaceChildren(
          el('span', {}, [upload.label ?? upload.fileName]),
          el('span', { class: 'evidence-name' }, [upload.fileName]),
          el('a', { class: 'text-link', href: `/api/owner/uploads/${upload.id}/original` }, ['Download original']),
        );
      });
    },
  };
}

async function showPreview(
  file: File,
  canvas: HTMLCanvasElement,
  holder: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!isCurrent()) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context?.drawImage(bitmap, 0, 0);
    holder.replaceChildren(canvas);
  } catch {
    if (isCurrent()) holder.replaceChildren();
  }
}

function uploadRefusal(error: Refused): string {
  if (error.status === 415) return 'This file type is not accepted';
  if (error.status === 413) return 'This file is over the size limit';
  if (error.status === 503) return MESSAGE.storageDown;
  if (error.body.errors?.file) return 'That file name is not allowed';
  return error.body.message;
}

async function sendUpload(
  carId: string,
  file: File,
  options: { kind: 'photo' | 'invoice'; mask?: { x: number; y: number; w: number; h: number } | null; label?: string },
): Promise<UploadView> {
  const form = new FormData();
  form.append('kind', options.kind);
  if (options.kind === 'photo') form.append('plateMask', JSON.stringify(options.mask ?? null));
  if (options.kind === 'invoice') form.append('label', options.label ?? '');
  form.append('file', file, file.name);
  return api.postForm<UploadView>(`/api/owner/cars/${carId}/uploads`, form);
}

// ---------------------------------------------------------------- Test record

function buildRecord(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const pull = el('button', { type: 'button', class: 'pill pill-solid' }, ['Pull test record']);
  const tape = el('div', { role: 'region', 'aria-label': 'Odometer tape', class: 'tape card' });
  const advisories = el('div', { role: 'region', 'aria-label': 'Advisories', class: 'advisory-list card' });
  const tally = el('p', { class: 'advisory-tally' }, ['Open advisories: 0']);
  const rows = el('div', { class: 'advisory-rows' });
  advisories.append(tally, rows);

  pressable(pull, () => context.act({
    pending: 'Pulling the test record',
    success: 'Test record pulled',
    ownKeys: ['record', 'publish'],
    run: () => api.post(`/api/owner/cars/${context.carId}/record/pull`),
    onRefused: (error) => {
      const copy: Record<string, string> = {
        record_not_found: MESSAGE.recordNotFound,
        record_throttled: `The record service is busy. Try again in ${String(error.body.retryAfterSeconds)} seconds.`,
      };
      if (error.body.error === 'record_unreachable') {
        announce(context.notice(), MESSAGE.recordDown);
        return true;
      }
      const message = copy[error.body.error];
      if (!message) return false;
      void announceSteps(context.status(), [message]);
      return true;
    },
    focusHome: () => pull.focus(),
  }).then(() => {
    pull.focus();
  }));

  const node = section('record', 'Test record', [
    el('div', { class: 'row-actions' }, [pull]),
    tape,
    advisories,
  ]);

  return {
    node,
    paint: (data) => {
      const record = data.record;
      setText(tally, `Open advisories: ${data.car.workingOpenAdvisories}`);
      if (!record) {
        tape.replaceChildren(el('h3', {}, ['Odometer tape']), el('p', {}, ['Pull the test record to see the tape.']));
        rows.replaceChildren(el('p', {}, ['No advisories yet']));
        return;
      }
      const steps = record.tape.map((step) => el('div', { class: 'tape-step' }, [
        el('p', { class: 'tape-date' }, [showDate(step.completedDate)]),
        el('p', { class: 'tape-reading figures' }, [
          step.odometerValue === null
            ? '—'
            : `${Number(step.odometerValue).toLocaleString('en-GB')} ${step.odometerUnit ?? ''}`,
        ]),
        el('p', { class: step.flag ? 'tape-flag' : `tape-flag tape-result-${step.testResult.toLowerCase()}` }, [
        step.flag ? ODOMETER_FLAG[step.flag] : step.testResult,
      ]),
      ]));
      steps.forEach((step, index) => step.style.setProperty('--step', String(index)));
      tape.replaceChildren(el('h3', {}, ['Odometer tape']), ...steps);

      keyedList(rows, record.advisories, (advisory) => advisory.id, (advisory) => {
        const stance = el('select', { 'aria-label': `Response to ${advisory.text}`, class: 'field-input' },
          [el('option', { value: '' }, ['Not answered']),
            ...['repaired', 'monitoring', 'not_repaired'].map((value) => el('option', { value }, [value]))]);
        const note = el('input', { type: 'text', 'aria-label': `Note on ${advisory.text}`, class: 'field-input' });
        const save = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Save response']);
        const error = el('p', { class: 'field-error', hidden: true });
        pressable(save, () => context.act({
          pending: 'Saving response',
          success: 'Response saved',
          ownKeys: ['record', 'publish'],
          run: () => api.put(`/api/owner/cars/${context.carId}/advisories/${advisory.id}`,
            { stance: stance.value, note: note.value }),
          onRefused: (refusal) => {
            const message = refusal.body.errors ? Object.values(refusal.body.errors)[0] : refusal.body.message;
            error.hidden = false;
            error.textContent = message;
            void announceSteps(context.status(), [message]);
            return true;
          },
        }).then(() => undefined));
        return el('div', { class: 'advisory-row' }, [
          el('p', { class: 'advisory-text' }, [advisory.text]),
          el('p', { class: 'advisory-flag', hidden: true }, [RECURRED_FLAG]),
          el('label', { class: 'field' }, [el('span', {}, ['Response']), stance]),
          el('label', { class: 'field' }, [el('span', {}, ['Note']), note]),
          save,
          error,
        ]);
      }, (row, advisory) => {
        row.style.setProperty('--step', String(record.advisories.indexOf(advisory)));
        const flag = find<HTMLElement>(row, '.advisory-flag');
        if (flag) flag.hidden = !advisory.recurred;
        const stance = find<HTMLSelectElement>(row, 'select');
        const note = find<HTMLInputElement>(row, 'input');
        if (stance && document.activeElement !== stance && stance.dataset.saved !== (advisory.stance ?? '')) {
          if (!stance.dataset.touched) stance.value = advisory.stance ?? '';
          stance.dataset.saved = advisory.stance ?? '';
        }
        if (note && document.activeElement !== note && note.dataset.saved !== (advisory.note ?? '')) {
          if (!note.dataset.touched) note.value = advisory.note ?? '';
          note.dataset.saved = advisory.note ?? '';
        }
        if (stance && !stance.dataset.bound) {
          stance.dataset.bound = 'yes';
          on(stance, 'input', () => {
            stance.dataset.touched = 'yes';
          });
        }
        if (note && !note.dataset.bound) {
          note.dataset.bound = 'yes';
          on(note, 'input', () => {
            note.dataset.touched = 'yes';
          });
        }
      });
    },
  };
}

// ---------------------------------------------------------------- Publish

function buildPublish(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const publish = el('button', { type: 'button', class: 'pill pill-solid' }, ['Publish']);
  const withdraw = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Withdraw listing']);
  const blockers = el('ul', { role: 'list', 'aria-label': 'Publish blockers', class: 'blocker-list' });
  const clear = el('p', { class: 'blocker-clear', hidden: true }, [MESSAGE.nothingBlocking]);

  pressable(publish, () => context.act({
    pending: 'Rendering the report',
    success: (value: { version: number }) => `Published as version ${value.version}`,
    ownKeys: ['publish', 'record', 'findings', 'panels'],
    run: () => api.post<{ version: number }>(`/api/owner/cars/${context.carId}/publish`),
    onRefused: (error) => {
      if (error.body.error === 'report_render_failed') {
        announce(context.notice(), MESSAGE.renderFailed);
        return true;
      }
      if (error.body.error === 'report_store_failed') {
        announce(context.notice(), MESSAGE.storeFailed);
        return true;
      }
      return false;
    },
  }).then(() => undefined));

  pressable(withdraw, () => context.act({
    pending: 'Withdrawing listing',
    success: 'Listing withdrawn',
    ownKeys: ['publish'],
    run: () => api.post(`/api/owner/cars/${context.carId}/withdraw`),
  }).then(() => undefined));

  const node = section('publish', 'Publish', [
    el('div', { class: 'card' }, [
      el('div', { class: 'blocker-row' }, [blockers, clear]),
      el('div', { class: 'row-actions' }, [publish, withdraw]),
    ]),
  ]);

  return {
    node,
    paint: (data) => {
      keyedList(blockers, data.car.publishBlockers, (reason) => reason, () => el('li', {}),
        (row, reason) => setText(row, BLOCKER_COPY[reason]));
      clear.hidden = data.car.publishBlockers.length > 0;
      publish.hidden = !['draft', 'live'].includes(data.car.listingStatus);
      withdraw.hidden = !['draft', 'live', 'under_offer'].includes(data.car.listingStatus);
    },
  };
}

// ---------------------------------------------------------------- People

function buildPeople(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const name = el('input', { type: 'text', 'aria-label': "Person's name", class: 'field-input' });
  const buyer = el('input', { type: 'radio', name: 'link-role', value: 'buyer', 'aria-label': 'Buyer', checked: true });
  const inspector = el('input', { type: 'radio', name: 'link-role', value: 'inspector', 'aria-label': 'Inspector' });
  const create = el('button', { type: 'button', class: 'pill pill-solid' }, ['Create link']);
  const newLink = el('div', { role: 'region', 'aria-label': 'New link', class: 'new-link', hidden: true });
  const body = el('tbody');

  const showAddress = (path: string, personName: string): void => {
    const address = `${window.location.origin}${path}`;
    const link = el('a', { href: address, class: 'text-link new-link-address' }, [address]);
    const copy = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Copy link']);
    pressable(copy, async () => {
      try {
        await navigator.clipboard.writeText(address);
      } catch {
        // the address stays on screen either way
      }
      await announceSteps(context.status(), ['Link copied']);
    });
    newLink.hidden = false;
    newLink.replaceChildren(el('p', {}, [`Link ready for ${personName}`]), link, copy);
    copy.focus();
  };

  pressable(create, async () => {
    newLink.hidden = true;
    const person = name.value;
    const made = await context.act({
      pending: 'Creating link',
      ownKeys: ['people'],
      run: () => api.post<LinkRow>(`/api/owner/cars/${context.carId}/links`, {
        role: inspector.checked ? 'inspector' : 'buyer',
        name: person,
      }),
    });
    if (!made) return;
    showAddress(made.path as string, made.name); // a newly made link carries its path
    await announceSteps(context.status(), [`Link ready for ${made.name}`]);
  });

  const node = section('people', 'People', [
    el('div', { class: 'card' }, [
      el('label', { class: 'field' }, [el('span', {}, ["Person's name"]), name]),
      el('div', { role: 'radiogroup', 'aria-label': 'Link type', class: 'radio-row' }, [
        el('label', { class: 'field-inline' }, [buyer, el('span', {}, ['Buyer'])]),
        el('label', { class: 'field-inline' }, [inspector, el('span', {}, ['Inspector'])]),
      ]),
      create,
      newLink,
    ]),
    el('div', { class: 'card table-card' }, [
      el('table', { 'aria-label': 'People', class: 'people-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col' }, ['Person']),
          el('th', { scope: 'col' }, ['Status']),
          el('th', { scope: 'col' }, ['Progress']),
          el('th', { scope: 'col' }, ['Offer']),
          el('th', { scope: 'col' }, ['Actions']),
        ])]),
        body,
      ]),
    ]),
  ]);

  return {
    node,
    paint: (data) => {
      keyedList(body, data.links, (link) => link.id, () => el('tr', { class: 'people-row' }), (row, link) => {
        const action = (label: string, path: string, success: string, keepAddress: boolean): HTMLButtonElement => {
          const button = el('button', { type: 'button', class: 'pill pill-quiet' }, [label]);
          pressable(button, async () => {
            newLink.hidden = true;
            const made = await context.act({
              pending: 'Updating link',
              success,
              ownKeys: ['people', 'viewings'],
              run: () => api.post<LinkRow>(`/api/owner/links/${link.id}/${path}`),
            });
            if (made && keepAddress && made.path) showAddress(made.path, made.name);
          });
          return button;
        };
        row.replaceChildren(
          el('th', { scope: 'row' }, [link.name, el('span', { class: 'row-note' }, [` ${link.role}`])]),
          el('td', {}, [
            LINK_WORD[link.status],
            el('span', { class: 'figures row-note' }, [
              link.status === 'active' ? ` ${timeLeft(link.secondsRemaining)}` : '',
            ]),
          ]),
          el('td', { class: 'figures' }, [
            `${link.seen} of ${link.total}`,
            el('span', { class: 'row-note' }, [link.lastSeenAt ? ` ${showDate(link.lastSeenAt)}` : '']),
          ]),
          el('td', {}, [link.offerStatus ? OFFER_WORD[link.offerStatus] : '—']),
          el('td', { class: 'row-actions' }, [
            action('Revoke', 'revoke', 'Link revoked', false),
            action('Renew', 'renew', 'Link renewed', false),
            action('Replace', 'replace', 'Link replaced', true),
          ]),
        );
      });
    },
  };
}

// ---------------------------------------------------------------- Viewings

function buildViewings(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const when = el('input', {
    type: 'text', 'aria-label': 'Viewing date and time', class: 'field-input', placeholder: 'YYYY-MM-DDTHH:mm',
  });
  const minutes = el('input', {
    type: 'number', min: '15', max: '240', step: '1', 'aria-label': 'Viewing length in minutes',
    class: 'field-input figures', value: '45',
  });
  const add = el('button', { type: 'button', class: 'pill pill-solid' }, ['Add viewing slot']);
  const whenError = el('p', { class: 'field-error', hidden: true });
  const minutesError = el('p', { class: 'field-error', hidden: true });
  const list = el('ul', { role: 'list', 'aria-label': 'Owner viewing slots', class: 'slot-list' });

  pressable(add, async () => {
    whenError.hidden = true;
    minutesError.hidden = true;
    await context.act({
      pending: 'Adding viewing slot',
      success: 'Viewing slot added',
      ownKeys: ['viewings'],
      run: () => api.post(`/api/owner/cars/${context.carId}/slots`, {
        localStart: when.value,
        durationMinutes: Number(minutes.value),
      }),
      onRefused: (error) => {
        if (!error.body.errors) return false;
        if (error.body.errors.localStart) {
          whenError.hidden = false;
          whenError.textContent = error.body.errors.localStart;
        }
        if (error.body.errors.durationMinutes) {
          minutesError.hidden = false;
          minutesError.textContent = error.body.errors.durationMinutes;
        }
        void announceSteps(context.status(), [Object.values(error.body.errors)[0]]);
        return true;
      },
    });
  });

  const node = section('viewings', 'Viewings', [
    el('div', { class: 'card' }, [
      el('label', { class: 'field' }, [el('span', {}, ['Viewing date and time']), when, whenError]),
      el('label', { class: 'field' }, [el('span', {}, ['Viewing length in minutes']), minutes, minutesError]),
      add,
    ]),
    list,
  ]);

  return {
    node,
    paint: (data) => {
      if (data.slots.length === 0) {
        list.replaceChildren(el('li', {}, [emptyState(MESSAGE.noViewings)]));
        return;
      }
      keyedList(list, data.slots, (slot) => slot.id, () => el('li', { class: 'slot-row' }), (row, slot) => {
        row.replaceChildren(
          el('span', { class: 'slot-label' }, [slot.label]),
          el('span', { class: 'figures' }, [`${slot.durationMinutes} minutes`]),
          el('span', {}, [slot.holderName ? `Held by ${slot.holderName}` : 'Free']),
        );
      });
    },
  };
}

// ---------------------------------------------------------------- Offers

function buildOffers(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const body = el('tbody');
  const complete = el('button', { type: 'button', class: 'pill pill-solid' }, ['Complete sale']);
  const handover = el('a', { class: 'text-link', href: `/api/owner/cars/${context.carId}/handover` },
    ['Download handover record']);
  const acceptAttempt = new Attempt();
  let dialog: Overlay | null = null;
  let dialogCount: HTMLElement | null = null;
  let openOfferId: string | null = null;

  pressable(complete, () => context.act({
    pending: 'Rendering the handover record',
    success: 'Sale complete',
    ownKeys: ['offers', 'publish'],
    run: () => api.post(`/api/owner/cars/${context.carId}/complete`),
    onRefused: (error) => {
      if (error.status === 503) {
        announce(context.notice(), MESSAGE.handoverFailed);
        complete.focus();
        return true;
      }
      return false;
    },
    focusHome: () => complete.focus(),
  }).then(() => undefined));

  const openAccept = (offer: OwnerOffer, opener: HTMLElement): void => {
    acceptAttempt.reopen();
    let accepted = false;
    openOfferId = offer.id;
    const status = statusRegion('Dialog status');
    const confirm = el('button', { type: 'button', class: 'pill pill-solid' }, ['Confirm acceptance']);
    const cancel = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Cancel']);
    const others = context.data().offers.filter(
      (item) => item.id !== offer.id && ['open', 'needs_reread'].includes(item.status)).length;
    dialogCount = el('p', { class: 'accept-count' }, [`Other open offers closed: ${others}`]);
    const box = new Overlay({
      name: 'Accept offer',
      locked: () => confirm.isConnected && confirm.getAttribute('aria-disabled') === 'true',
      focusHome: () => find<HTMLElement>(document, '#offers h2'),
      onClose: () => {
        openOfferId = null;
        dialogCount = null;
        if (!accepted) context.release();
      },
    }, () => [
      el('div', { class: 'overlay-head' }, [el('h2', {}, ['Accept offer'])]),
      el('p', {}, [`Accept ${money(offer.amountPounds)} from ${offer.buyerName}?`]),
      dialogCount as HTMLElement,
      status,
      el('div', { class: 'overlay-actions' }, [confirm, cancel]),
    ]);
    on(cancel, 'click', () => box.close());
    pressable(confirm, async () => {
      announce(status, 'Accepting offer');
      const key = acceptAttempt.keyFor({ offer: offer.id });
      try {
        await api.post(`/api/owner/offers/${offer.id}/accept`, {}, { 'Idempotency-Key': key });
        accepted = true;
        box.close();
        await context.refresh(['offers', 'publish']);
        await announceSteps(context.status(), ['Offer accepted. Other open offers are closed.']);
        find<HTMLElement>(document, '#offers h2')?.focus();
        // the lines a poll found while the dialog was open now arrive, from the newest state
        context.release();
      } catch (error) {
        if (error instanceof NoReply || (error instanceof Refused && error.status >= 500)) {
          announce(status, MESSAGE.sendFailed);
          return;
        }
        const refusal = error as Refused;
        const copy: Record<string, string> = {
          offer_already_accepted: MESSAGE.offerAlreadyAccepted,
          offer_lapsed: MESSAGE.offerLapsed,
          offer_needs_reread: MESSAGE.offerNeedsRereadRefusal,
          offer_not_open: MESSAGE.offerNotOpen,
        };
        announce(status, copy[refusal.body.error] ?? refusal.body.message);
        confirm.remove();
        cancel.focus();
        await context.refresh([]);
      }
    });
    context.hold(true);
    box.show(opener);
    dialog = box;
  };

  const node = section('offers', 'Offers', [
    el('div', { class: 'card table-card' }, [
      el('table', { 'aria-label': 'Offers', class: 'offers-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col' }, ['Buyer']),
          el('th', { scope: 'col' }, ['Amount']),
          el('th', { scope: 'col' }, ['Status']),
          el('th', { scope: 'col' }, ['Progress']),
          el('th', { scope: 'col' }, ['Actions']),
        ])]),
        body,
      ]),
    ]),
    el('div', { class: 'row-actions' }, [complete, handover]),
  ]);

  return {
    node,
    paint: (data) => {
      complete.hidden = data.car.listingStatus !== 'under_offer';
      handover.hidden = data.car.listingStatus !== 'sold';
      if (data.offers.length === 0) {
        body.replaceChildren(el('tr', {}, [el('td', { colspan: '5' }, [emptyState(MESSAGE.noOffers)])]));
        return;
      }
      keyedList(body, data.offers, (offer) => offer.id, () => el('tr', { class: 'offer-row' }), (row, offer) => {
        const live = ['open', 'needs_reread'].includes(offer.status);
        const actions = el('td', { class: 'row-actions' });
        if (offer.status === 'open') {
          const accept = el('button', { type: 'button', class: 'pill pill-solid' }, ['Accept']);
          on(accept, 'click', () => openAccept(offer, accept));
          actions.append(accept);
        }
        if (live) {
          const decline = el('button', { type: 'button', class: 'pill pill-quiet' }, ['Decline']);
          pressable(decline, () => context.act({
            pending: 'Declining offer',
            success: 'Offer declined',
            ownKeys: ['offers'],
            run: () => api.post(`/api/owner/offers/${offer.id}/decline`),
            onRefused: (error) => {
              const copy: Record<string, string> = {
                offer_lapsed: MESSAGE.offerLapsed,
                offer_not_open: MESSAGE.offerNotOpen,
              };
              const message = copy[error.body.error];
              if (!message) return false;
              void announceSteps(context.status(), [message]);
              return true;
            },
          }).then(() => undefined));
          actions.append(decline);
        }
        row.replaceChildren(
          el('th', { scope: 'row' }, [offer.buyerName]),
          el('td', { class: 'figures' }, [money(offer.amountPounds)]),
          el('td', {}, [
            OFFER_WORD[offer.status],
            el('span', { class: 'figures row-note' }, [live ? ` ${timeLeft(offer.secondsRemaining)}` : '']),
          ]),
          el('td', { class: 'figures' }, [`${offer.seen} of ${offer.total}`]),
          actions,
        );
      });
      if (dialog && openOfferId && dialogCount) {
        const others = data.offers.filter(
          (item) => item.id !== openOfferId && ['open', 'needs_reread'].includes(item.status)).length;
        setText(dialogCount, `Other open offers closed: ${others}`);
      }
    },
  };
}

// ---------------------------------------------------------------- Alerts

function buildAlerts(context: CarFileContext): { node: HTMLElement; paint: (data: CarData) => void } {
  const list = el('ul', { role: 'list', 'aria-label': 'Alerts', class: 'alert-list' });
  const node = section('alerts', 'Alerts', [list]);

  return {
    node,
    paint: (data) => {
      if (data.alerts.length === 0) {
        list.replaceChildren(el('li', {}, [emptyState(MESSAGE.noAlerts)]));
        return;
      }
      keyedList(list, data.alerts, (alert) => alert.id, () => el('li', { class: 'alert-row', tabindex: '-1' }),
        (row, alert) => {
          const hasRetry = find<HTMLButtonElement>(row, '.retry-button');
          // A poll never repaints a row with a pending request.
          if (row.dataset.pending === 'yes') return;
          if (alert.state === 'failed') {
            if (hasRetry) {
              setText(find(row, '.alert-state'), ALERT_WORD[alert.state]);
              return;
            }
            const retry = el('button', { type: 'button', class: 'pill pill-solid retry-button' }, ['Retry']);
            pressable(retry, async () => {
              row.dataset.pending = 'yes';
              await context.act({
              pending: 'Sending alert',
              success: 'Alert delivered',
              ownKeys: ['alerts'],
              run: () => api.post(`/api/owner/alerts/${alert.id}/retry`),
              onRefused: (error) => {
                if (error.status === 503) {
                  announce(context.notice(), MESSAGE.alertFailed);
                  void announceSteps(context.status(), [MESSAGE.alertFailed]);
                  retry.focus();
                  return true;
                }
                void announceSteps(context.status(), [MESSAGE.alertInProgress]);
                retry.focus();
                return true;
              },
              focusHome: () => row.focus(),
              });
              delete row.dataset.pending;
              await context.refresh([]);
            });
            row.replaceChildren(
              el('span', {}, [alertName(alert)]),
              el('span', { class: 'alert-state' }, [ALERT_WORD[alert.state]]),
              retry,
            );
            return;
          }
          row.replaceChildren(
            el('span', {}, [alertName(alert)]),
            el('span', { class: 'alert-state' }, [ALERT_WORD[alert.state]]),
            el('span', { class: 'row-note' }, [showDate(alert.createdAt)]),
          );
        });
    },
  };
}

function alertName(alert: AlertRow): string {
  const names: Record<string, string> = {
    viewing_claim: 'Viewing claim',
    new_offer: 'New offer',
    offer_lapsing: 'Offer about to lapse',
  };
  return names[alert.kind];
}

