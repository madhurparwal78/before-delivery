import { h, setAttrs } from '../dom.ts';
import { clampBox, MIN_SIZE, NUDGE_LARGE, NUDGE_SMALL, round4, type Box } from '../../shared/geometry.ts';
import type { FieldJson, RecipientJson } from '../../shared/types.ts';

export interface FieldHost {
  /** Fields can only be edited while the document is an editable draft. */
  editable: () => boolean;
  pageGroup: (page: number) => HTMLElement | null;
  recipients: () => RecipientJson[];
  save: (fieldId: string, patch: Record<string, unknown>) => void;
  remove: (fieldId: string) => void;
  select: (fieldId: string | null) => void;
  announcePosition: (field: FieldJson) => void;
  pageCount: () => number;
}

export interface PlacedField {
  field: FieldJson;
  button: HTMLButtonElement;
  handle: HTMLButtonElement;
  setSelected: (selected: boolean) => void;
  apply: (next: FieldJson) => void;
  detach: () => void;
}

const recipientName = (recipients: readonly RecipientJson[], recipientId: string): string =>
  recipients.find((row) => row.id === recipientId)?.name ?? '';

const fieldAccessibleName = (
  field: FieldJson,
  recipients: readonly RecipientJson[],
): string => `${field.label} for ${recipientName(recipients, field.recipientId)}`;

const applyBox = (node: HTMLElement, box: Box): void => {
  node.style.left = `${box.x * 100}%`;
  node.style.top = `${box.y * 100}%`;
  node.style.width = `${box.w * 100}%`;
  node.style.height = `${box.h * 100}%`;
};

/** Draws one placed field and wires its pointer and keyboard editing. */
export const placeField = (field: FieldJson, host: FieldHost): PlacedField => {
  let current: FieldJson = { ...field };
  const label = h('span', { class: 'field-label' });
  const who = h('span', { class: 'field-who' });
  const button = h(
    'button',
    { type: 'button', id: `field-${field.id}`, class: 'field-box', 'aria-pressed': 'false' },
    label,
    who,
  );
  const handle = h('button', {
    type: 'button',
    class: 'field-handle',
    tabindex: '-1',
  });

  const paint = (): void => {
    applyBox(button, current);
    label.textContent = current.label;
    who.textContent = recipientName(host.recipients(), current.recipientId);
    button.setAttribute('aria-label', fieldAccessibleName(current, host.recipients()));
    handle.setAttribute('aria-label', `Resize ${current.label}`);
  };

  const attachTo = (page: number): void => {
    const group = host.pageGroup(page);
    if (!group) return;
    group.appendChild(button);
    group.appendChild(handle);
    applyBox(handle, current);
  };

  const syncHandle = (): void => {
    handle.style.left = `${(current.x + current.w) * 100}%`;
    handle.style.top = `${(current.y + current.h) * 100}%`;
  };

  const commit = (next: Partial<FieldJson>, announce: boolean): void => {
    const merged = { ...current, ...next };
    const clamped = clampBox(merged);
    current = { ...merged, ...clamped };
    paint();
    syncHandle();
    host.save(current.id, {
      page: current.page,
      x: current.x,
      y: current.y,
      w: current.w,
      h: current.h,
    });
    if (announce) host.announcePosition(current);
  };

  const pageSize = (): { width: number; height: number } => {
    const group = host.pageGroup(current.page);
    const rect = group?.getBoundingClientRect();
    return { width: rect?.width ?? 1, height: rect?.height ?? 1 };
  };

  let drag: { pointerId: number; startX: number; startY: number; origin: Box } | null = null;

  button.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || !host.editable()) return;
    host.select(current.id);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: current.x, y: current.y, w: current.w, h: current.h },
    };
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener('pointermove', (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const size = pageSize();
    const next = clampBox({
      x: drag.origin.x + (event.clientX - drag.startX) / size.width,
      y: drag.origin.y + (event.clientY - drag.startY) / size.height,
      w: drag.origin.w,
      h: drag.origin.h,
    });
    current = { ...current, ...next };
    applyBox(button, current);
    syncHandle();
  });

  const pageUnderPoint = (x: number, y: number): number => {
    for (let page = 1; page <= host.pageCount(); page += 1) {
      const rect = host.pageGroup(page)?.getBoundingClientRect();
      if (!rect) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return page;
    }
    return current.page;
  };

  const endDrag = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved =
      Math.abs(event.clientX - drag.startX) > 2 || Math.abs(event.clientY - drag.startY) > 2;
    drag = null;
    button.releasePointerCapture?.(event.pointerId);
    if (!moved) {
      button.focus();
      return;
    }
    const page = pageUnderPoint(event.clientX, event.clientY);
    if (page !== current.page) {
      const rect = host.pageGroup(page)?.getBoundingClientRect();
      if (rect) {
        const next = clampBox({
          x: (event.clientX - rect.left) / rect.width - current.w / 2,
          y: (event.clientY - rect.top) / rect.height - current.h / 2,
          w: current.w,
          h: current.h,
        });
        current = { ...current, ...next, page };
        attachTo(page);
      }
    }
    commit({}, true);
    button.focus();
  };

  button.addEventListener('pointerup', endDrag);
  button.addEventListener('pointercancel', endDrag);

  let resize: { pointerId: number; startX: number; startY: number; origin: Box } | null = null;
  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (!host.editable()) return;
    event.stopPropagation();
    resize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: current.x, y: current.y, w: current.w, h: current.h },
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event: PointerEvent) => {
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    const size = pageSize();
    const next = clampBox({
      x: resize.origin.x,
      y: resize.origin.y,
      w: Math.max(MIN_SIZE, resize.origin.w + (event.clientX - resize.startX) / size.width),
      h: Math.max(MIN_SIZE, resize.origin.h + (event.clientY - resize.startY) / size.height),
    });
    current = { ...current, ...next };
    applyBox(button, current);
    syncHandle();
  });
  const endResize = (event: PointerEvent): void => {
    if (!resize || resize.pointerId !== event.pointerId) return;
    resize = null;
    handle.releasePointerCapture?.(event.pointerId);
    commit({}, true);
  };
  handle.addEventListener('pointerup', endResize);
  handle.addEventListener('pointercancel', endResize);

  button.addEventListener('focus', () => {
    if (host.editable()) host.select(current.id);
  });

  button.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!host.editable()) return;
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;
    const key = event.key;
    if (event.altKey && key.startsWith('Arrow')) {
      event.preventDefault();
      const grow = key === 'ArrowRight' || key === 'ArrowDown' ? step : -step;
      if (key === 'ArrowRight' || key === 'ArrowLeft') commit({ w: round4(current.w + grow) }, true);
      else commit({ h: round4(current.h + grow) }, true);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      commit({ x: round4(current.x + (key === 'ArrowRight' ? step : -step)) }, true);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      commit({ y: round4(current.y + (key === 'ArrowDown' ? step : -step)) }, true);
      return;
    }
    if (key === 'PageDown' || key === 'PageUp') {
      event.preventDefault();
      const target = current.page + (key === 'PageDown' ? 1 : -1);
      if (target < 1 || target > host.pageCount()) return;
      current = { ...current, page: target };
      attachTo(target);
      commit({}, true);
      button.focus();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      host.remove(current.id);
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      host.select(null);
      host.pageGroup(current.page)?.focus();
    }
  });

  paint();
  attachTo(current.page);
  syncHandle();

  return {
    get field() {
      return current;
    },
    button,
    handle,
    setSelected: (selected: boolean) => {
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.classList.toggle('selected', selected);
      handle.classList.toggle('shown', selected && host.editable());
    },
    apply: (next: FieldJson) => {
      const page = current.page;
      current = { ...next };
      paint();
      syncHandle();
      if (page !== current.page) attachTo(current.page);
    },
    detach: () => {
      button.remove();
      handle.remove();
    },
  };
};

export interface PropertiesPanel {
  panel: HTMLElement;
  refresh: (field: FieldJson, recipients: readonly RecipientJson[]) => void;
}

/** One panel, reused for whichever field is selected. */
export const fieldPropertiesPanel = (
  onChange: (patch: Record<string, unknown>) => void,
  onClose: () => void,
): PropertiesPanel => {
  const assign = h('select', { id: 'field-assign' });
  const required = h('input', { type: 'checkbox', id: 'field-required' });
  const labelInput = h('input', { type: 'text', id: 'field-label' });
  const closeButton = h('button', { type: 'button', class: 'button quiet' }, 'Close');

  assign.addEventListener('change', () => onChange({ recipientId: assign.value }));
  required.addEventListener('change', () => onChange({ required: required.checked }));
  labelInput.addEventListener('input', () => onChange({ label: labelInput.value }));
  closeButton.addEventListener('click', onClose);

  const panel = h(
    'aside',
    { class: 'field-properties' },
    h(
      'div',
      { class: 'panel-body' },
      h('div', { class: 'field' }, h('label', { for: 'field-assign' }, 'Assign to'), assign),
      h(
        'div',
        { class: 'field checkbox' },
        required,
        h('label', { for: 'field-required' }, 'Required'),
      ),
      h('div', { class: 'field' }, h('label', { for: 'field-label' }, 'Label'), labelInput),
      closeButton,
    ),
  );
  setAttrs(panel, { 'aria-hidden': 'true' });

  return {
    panel,
    refresh: (field: FieldJson, list: readonly RecipientJson[]) => {
      assign.replaceChildren(
        ...list.map((row) =>
          h('option', { value: row.id, selected: row.id === field.recipientId }, row.name),
        ),
      );
      required.checked = field.required;
      if (document.activeElement !== labelInput) labelInput.value = field.label;
    },
  };
};
