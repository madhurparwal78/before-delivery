import { DEFECT_KINDS, DefectKind, SPECIES } from '../../shared/constants';
import { getJson, postJson, postRaw } from '../api';
import { clear, el, labelled, openDialog, setText } from '../dom';
import { Page } from '../shell';
import { refreshServices } from '../store';
import { drawIntakeStrip } from '../strip';
import { Board, DefectZone, Lot, Photo, Ticket } from '../types';

const STATUS_LABELS: Record<string, string> = { issued: 'Issued', 'at-saw': 'At saw', done: 'Done' };

function snapToTen(value: number): number {
  return Math.floor(value / 10 + 0.5) * 10;
}

export async function yardPage(): Promise<Page> {
  const lotsResult = await getJson<{ lots: Lot[] }>('/api/lots');
  const lots = lotsResult.data?.lots ?? [];

  const intakeStatus = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Intake status' } });
  const sawStatus = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Saw status' } });

  const lotSelect = el('select', {}, lots.map((lot) => el('option', { text: lot.name, attrs: { value: lot.id } })));
  const speciesSelect = el('select', {}, SPECIES.map((name) => el('option', { text: name, attrs: { value: name } })));
  const lengthField = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
  const widthField = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
  const thicknessField = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
  const photoField = el('input', { attrs: { type: 'file', multiple: true, accept: 'image/jpeg,image/png' } });
  const tagButton = el('button', { class: 'primary tag-board', text: 'Tag board', attrs: { type: 'button' } });

  const defectStart = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
  const defectEnd = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
  const defectKind = el('select', {}, DEFECT_KINDS.map((kind) => el('option', { text: kind, attrs: { value: kind } })));
  const addDefect = el('button', { text: 'Add defect', attrs: { type: 'button' } });
  const zoneList = el('ul', { class: 'zones', attrs: { role: 'list', 'aria-label': 'Defect zones' } });

  const fieldErrors = new Map<string, HTMLElement>();
  const stripHolder = el('div', { class: 'strip-holder intake-holder', attrs: { tabindex: '0' } });

  let zones: DefectZone[] = [];

  function typedLength(): number | null {
    const raw = lengthField.value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const value = Number(raw);
    return value > 0 ? value : null;
  }

  function renderStrip(): void {
    const width = stripHolder.clientWidth;
    if (width <= 0) {
      window.requestAnimationFrame(renderStrip);
      return;
    }
    clear(stripHolder);
    stripHolder.appendChild(drawIntakeStrip({ widthPx: width, lengthMm: typedLength(), defects: zones }));
  }

  function renderZones(): void {
    clear(zoneList);
    zones.forEach((zone, index) => {
      const remove = el('button', {
        text: `Remove defect ${index + 1}`,
        attrs: { type: 'button' },
        on: {
          click: () => {
            zones = zones.filter((_zone, at) => at !== index);
            renderZones();
            renderStrip();
          }
        }
      });
      zoneList.appendChild(
        el('li', { attrs: { role: 'listitem' } }, [
          el('span', { class: 'mono', text: `${zone.kind} ${zone.start_mm}\u2013${zone.end_mm} mm` }),
          remove
        ])
      );
    });
  }

  function addZone(kind: DefectKind, start: number, end: number): void {
    zones = [...zones, { kind, start_mm: start, end_mm: end }].sort((a, b) => a.start_mm - b.start_mm);
    renderZones();
    renderStrip();
  }

  function openKindSheet(start: number, end: number): void {
    let chosen = false;
    openDialog({
      name: 'Defect kind',
      sheet: true,
      opener: stripHolder,
      build: (handle) => [
        el('h2', { class: 'dialog-title', text: 'Defect kind' }),
        el(
          'div',
          { class: 'kind-buttons' },
          DEFECT_KINDS.map((kind) =>
            el('button', {
              class: 'kind-button',
              text: kind === 'nail hole' ? 'Nail hole' : kind === 'check' ? 'Check' : 'Bolt hole',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  chosen = true;
                  addZone(kind, start, end);
                  handle.close();
                }
              }
            })
          )
        )
      ],
      onClose: () => {
        if (!chosen) renderStrip();
      }
    });
  }

  let dragFrom: number | null = null;

  function positionFromEvent(event: PointerEvent): number | null {
    const total = typedLength();
    if (total === null) return null;
    const strip = stripHolder.querySelector('svg');
    if (strip === null) return null;
    const box = strip.getBoundingClientRect();
    const scale = Number(strip.getAttribute('data-scale') ?? '0');
    if (scale <= 0) return null;
    const mm = (event.clientX - box.left) / scale;
    return Math.min(Math.max(snapToTen(mm), 0), total);
  }

  stripHolder.addEventListener('pointerdown', (event) => {
    const at = positionFromEvent(event as PointerEvent);
    if (at === null) return;
    event.preventDefault();
    dragFrom = at;
    stripHolder.setPointerCapture((event as PointerEvent).pointerId);
  });
  stripHolder.addEventListener('pointerup', (event) => {
    if (dragFrom === null) return;
    const at = positionFromEvent(event as PointerEvent);
    const from = dragFrom;
    dragFrom = null;
    if (at === null || at === from) return;
    openKindSheet(Math.min(from, at), Math.max(from, at));
  });

  addDefect.addEventListener('click', () => {
    const total = typedLength();
    const start = Number(defectStart.value.trim());
    const end = Number(defectEnd.value.trim());
    if (total === null || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > total) {
      setText(intakeStatus, 'Check the highlighted fields.');
      return;
    }
    addZone(defectKind.value as DefectKind, start, end);
    defectStart.value = '';
    defectEnd.value = '';
  });

  lengthField.addEventListener('input', () => {
    const total = typedLength();
    if (total !== null) zones = zones.filter((zone) => zone.end_mm <= total);
    renderZones();
    renderStrip();
  });

  function errorHolder(field: string): HTMLElement {
    const found = fieldErrors.get(field);
    if (found !== undefined) return found;
    const node = el('p', { class: 'field-error', attrs: { 'data-field': field } });
    fieldErrors.set(field, node);
    return node;
  }

  function clearFieldErrors(): void {
    for (const node of fieldErrors.values()) setText(node, '');
  }

  async function tagBoard(): Promise<void> {
    clearFieldErrors();
    tagButton.disabled = true;
    tagButton.textContent = 'Tagging';
    const body = {
      lot: lotSelect.value,
      species: speciesSelect.value,
      length_mm: Number(lengthField.value.trim()),
      width_mm: Number(widthField.value.trim()),
      thickness_mm: Number(thicknessField.value.trim()),
      defects: zones
    };
    const result = await postJson<{ board: Board }>('/api/boards', body);
    if (!result.ok || result.data === null) {
      tagButton.disabled = false;
      tagButton.textContent = 'Tag board';
      for (const [field, message] of Object.entries(result.failure?.fields ?? {})) setText(errorHolder(field), message);
      setText(intakeStatus, result.failure?.error === 'validation' ? 'Check the highlighted fields.' : 'Something went wrong. Try again.');
      return;
    }
    const tag = result.data.board.tag;
    let photosLost = false;
    const files = [...(photoField.files ?? [])];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const upload = await postRaw<{ photo: Photo }>(`/api/boards/${tag}/photos`, bytes, type);
      if (!upload.ok) photosLost = true;
    }
    tagButton.disabled = false;
    tagButton.textContent = 'Tag board';
    setText(intakeStatus, photosLost ? `Tagged ${tag}. Photos were not saved.` : `Tagged ${tag}.`);
    zones = [];
    renderZones();
    lengthField.value = '';
    widthField.value = '';
    thicknessField.value = '';
    photoField.value = '';
    renderStrip();
    void refreshServices();
    void loadQueue();
  }

  tagButton.addEventListener('click', () => void tagBoard());

  const queue = el('div', { class: 'cards saw-queue' });

  async function readTicket(id: string): Promise<Ticket | null> {
    const result = await getJson<{ ticket: Ticket }>(`/api/tickets/${id}`);
    return result.ok && result.data !== null ? result.data.ticket : null;
  }

  async function reportConflict(id: string): Promise<void> {
    const ticket = await readTicket(id);
    if (ticket === null) {
      setText(sawStatus, 'Not saved.');
      return;
    }
    const latest = ticket.events[ticket.events.length - 1];
    const who = latest?.by.name ?? 'someone else';
    if (ticket.status === 'at-saw') setText(sawStatus, `Ticket ${id} was already started by ${who}.`);
    else if (ticket.status === 'done') setText(sawStatus, `Ticket ${id} was already marked done by ${who}.`);
    else setText(sawStatus, 'Not saved.');
    await loadQueue();
  }

  async function startCut(ticket: Ticket, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.textContent = 'Starting';
    const result = await postJson<{ ticket: Ticket }>(`/api/tickets/${ticket.id}/start`, {});
    button.disabled = false;
    button.textContent = `Start cut ${ticket.id}`;
    if (result.ok) {
      setText(sawStatus, `Ticket ${ticket.id} is at the saw.`);
      await loadQueue();
      return;
    }
    if (result.failure?.error === 'ticket_state') {
      await reportConflict(ticket.id);
      return;
    }
    setText(sawStatus, 'Not saved.');
  }

  async function sendDone(ticket: Ticket, measured: number | null, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.textContent = 'Saving';
    const body = measured === null ? {} : { offcut_mm: measured };
    const result = await postJson<{ ticket: Ticket }>(`/api/tickets/${ticket.id}/done`, body);
    button.disabled = false;
    button.textContent = `Mark ${ticket.id} done`;
    if (result.ok && result.data !== null) {
      const offcut = result.data.ticket.offcut;
      setText(
        sawStatus,
        offcut === null || offcut.measured_mm === null
          ? `Ticket ${ticket.id} done.`
          : `Ticket ${ticket.id} done. Offcut ${offcut.tag} is ${offcut.measured_mm} mm.`
      );
      await loadQueue();
      return;
    }
    if (result.failure?.error === 'ticket_state') {
      await reportConflict(ticket.id);
      return;
    }
    setText(sawStatus, 'Not saved.');
  }

  function markDone(ticket: Ticket, button: HTMLButtonElement): void {
    if (ticket.offcut === null) {
      void sendDone(ticket, null, button);
      return;
    }
    const measured = el('input', { attrs: { type: 'text', inputmode: 'numeric', value: String(ticket.offcut.planned_mm) } });
    openDialog({
      name: 'Re-measure offcut',
      opener: button,
      build: (handle) => [
        el('h2', { class: 'dialog-title', text: 'Re-measure offcut' }),
        labelled('Measured offcut (mm)', measured),
        el('button', {
          class: 'primary',
          text: 'Save',
          attrs: { type: 'button' },
          on: {
            click: () => {
              const value = Number(measured.value.trim());
              handle.close();
              void sendDone(ticket, Number.isInteger(value) ? value : 0, button);
            }
          }
        })
      ]
    });
  }

  async function loadQueue(): Promise<void> {
    const result = await getJson<{ tickets: Ticket[] }>('/api/tickets');
    clear(queue);
    const open = (result.data?.tickets ?? [])
      .filter((ticket) => ticket.status === 'issued' || ticket.status === 'at-saw')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (open.length === 0) {
      queue.appendChild(el('p', { class: 'muted', text: 'Nothing waiting at the saw.' }));
      return;
    }
    for (const ticket of open) {
      const action =
        ticket.status === 'issued'
          ? el('button', { class: 'primary', text: `Start cut ${ticket.id}`, attrs: { type: 'button' } })
          : el('button', { class: 'primary', text: `Mark ${ticket.id} done`, attrs: { type: 'button' } });
      action.addEventListener('click', () => {
        if (ticket.status === 'issued') void startCut(ticket, action);
        else markDone(ticket, action);
      });
      queue.appendChild(
        el('article', { class: 'card' }, [
          el('span', { class: 'tag mono', text: ticket.id }),
          el('span', { class: 'badge', text: STATUS_LABELS[ticket.status] ?? ticket.status }),
          el('span', { class: 'mono', text: `Board ${ticket.board}` }),
          action
        ])
      );
    }
  }

  const element = el('section', { class: 'page yard' }, [
    el('h1', { class: 'page-title', text: 'The yard' }),
    el('div', { class: 'yard-columns' }, [
      el('section', { class: 'intake' }, [
        el('h2', { text: 'Tag a board' }),
        intakeStatus,
        el('div', { class: 'intake-form' }, [
          labelled('Lot', lotSelect),
          errorHolder('lot'),
          labelled('Species', speciesSelect),
          errorHolder('species'),
          labelled('Length (mm)', lengthField),
          errorHolder('length_mm'),
          labelled('Width (mm)', widthField),
          errorHolder('width_mm'),
          labelled('Thickness (mm)', thicknessField),
          errorHolder('thickness_mm')
        ]),
        stripHolder,
        el('div', { class: 'defect-form' }, [
          labelled('Defect start (mm)', defectStart),
          labelled('Defect end (mm)', defectEnd),
          labelled('Defect kind', defectKind),
          addDefect
        ]),
        errorHolder('defects'),
        zoneList,
        labelled('Board photos', photoField),
        tagButton
      ]),
      el('section', { class: 'saw' }, [el('h2', { text: 'Saw queue' }), sawStatus, queue])
    ])
  ]);

  renderZones();
  window.requestAnimationFrame(renderStrip);
  void loadQueue();

  let resizeTimer = 0;
  const onResize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderStrip, 120);
  };
  window.addEventListener('resize', onResize);

  return {
    element,
    banners: ['storage'],
    destroy: () => window.removeEventListener('resize', onResize)
  };
}
