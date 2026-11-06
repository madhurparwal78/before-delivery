import { crossingsOfZone, derivedZone } from '../../shared/derive';
import { plainLabel } from '../../shared/labels';
import { SYSTEM_KINDS, ZONE_KINDS } from '../../shared/kinds';
import { el, field } from '../dom';
import type { AlignEdge } from '../../shared/editing';
import type { EditorState } from './state';

export interface InspectorHandlers {
  setShapeLabel(id: string, label: string): void;
  setShapeKind(id: string, kind: string): void;
  setGeometry(id: string, values: { x?: number; y?: number; width?: number; height?: number }): void;
  setZoneName(id: string, name: string): void;
  setZoneKind(id: string, kind: string): void;
  setZoneNote(id: string, note: string): void;
  setConnectorLabel(id: string, label: string): void;
  align(edge: AlignEdge): void;
  layer(direction: 'forward' | 'backward'): void;
  group(): void;
  ungroup(): void;
  duplicate(): void;
  remove(): void;
  commitLabel(): void;
  cancelLabel(): void;
}

export interface InspectorView {
  element: HTMLElement;
  body: HTMLElement;
  render(): void;
  firstField(): HTMLElement | null;
  labelField(): HTMLInputElement | null;
}

function numberInput(label: string, value: number, onChange: (value: number) => void, readOnly: boolean): HTMLElement {
  const input = el('input', { type: 'number', value, step: 1, role: 'spinbutton', 'aria-label': label });
  input.readOnly = readOnly;
  input.addEventListener('change', () => {
    const parsed = Number.parseInt(input.value, 10);
    if (Number.isInteger(parsed)) onChange(parsed);
  });
  return field(label, input, { id: `inspector-${label.toLowerCase().replace(/\s+/g, '-')}` });
}

export function createInspector(
  state: EditorState,
  handlers: InspectorHandlers,
  variant: 'pane' | 'drawer',
): InspectorView {
  const body = el('div');
  const heading = el('h2', { text: 'Inspector' });
  let element: HTMLElement;
  if (variant === 'pane') {
    element = el('aside', { class: 'inspector pane', role: 'complementary', 'aria-label': 'Inspector' }, [
      heading,
      body,
    ]);
  } else {
    element = el('div', {}, [heading, body]);
  }

  let labelInput: HTMLInputElement | null = null;

  const render = (): void => {
    const readOnly = state.readOnly;
    labelInput = null;
    const selected = [...state.selection];
    const shape = state.doc.shapes.find((entry) => selected.includes(entry.id));
    const zone = state.doc.zones.find((entry) => selected.includes(entry.id));
    const connector = state.doc.connectors.find((entry) => selected.includes(entry.id));

    if (shape) {
      const input = el('input', { type: 'text', value: shape.label, 'aria-label': 'Label' });
      input.readOnly = readOnly;
      labelInput = input;
      input.addEventListener('change', () => handlers.setShapeLabel(shape.id, input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handlers.setShapeLabel(shape.id, input.value);
          handlers.commitLabel();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          input.value = shape.label;
          handlers.cancelLabel();
        }
      });
      const kind = el('select', { 'aria-label': 'Kind' });
      for (const option of SYSTEM_KINDS) {
        kind.append(el('option', { value: option.id, text: option.name, selected: option.id === shape.kind }));
      }
      kind.disabled = readOnly;
      kind.addEventListener('change', () => handlers.setShapeKind(shape.id, kind.value));

      const buttons = el('div', { class: 'button-row' });
      const addButton = (label: string, action: () => void): void => {
        const node = el('button', { type: 'button', text: label });
        node.disabled = readOnly;
        node.addEventListener('click', action);
        buttons.append(node);
      };
      addButton('Align left', () => handlers.align('left'));
      addButton('Align right', () => handlers.align('right'));
      addButton('Align top', () => handlers.align('top'));
      addButton('Align bottom', () => handlers.align('bottom'));
      addButton('Bring forward', () => handlers.layer('forward'));
      addButton('Send backward', () => handlers.layer('backward'));
      addButton('Group', () => handlers.group());
      addButton('Ungroup', () => handlers.ungroup());
      addButton('Duplicate', () => handlers.duplicate());
      addButton('Delete', () => handlers.remove());

      body.replaceChildren(
        field('Label', input, { id: 'inspector-label' }),
        field('Kind', kind, { id: 'inspector-kind' }),
        el('div', { class: 'grid-2' }, [
          numberInput('X', shape.x, (value) => handlers.setGeometry(shape.id, { x: value }), readOnly),
          numberInput('Y', shape.y, (value) => handlers.setGeometry(shape.id, { y: value }), readOnly),
          numberInput('Width', shape.width, (value) => handlers.setGeometry(shape.id, { width: value }), readOnly),
          numberInput('Height', shape.height, (value) => handlers.setGeometry(shape.id, { height: value }), readOnly),
        ]),
        buttons,
      );
      return;
    }

    if (zone) {
      const name = el('input', { type: 'text', value: zone.name, 'aria-label': 'Zone name' });
      name.readOnly = readOnly;
      name.addEventListener('change', () => handlers.setZoneName(zone.id, name.value));
      const kind = el('select', { 'aria-label': 'Zone kind' });
      for (const option of ZONE_KINDS) {
        kind.append(el('option', { value: option.id, text: option.name, selected: option.id === zone.kind }));
      }
      kind.disabled = readOnly;
      kind.addEventListener('change', () => handlers.setZoneKind(zone.id, kind.value));
      const note = el('input', { type: 'text', value: zone.note, 'aria-label': 'Note' });
      note.readOnly = readOnly;
      note.addEventListener('change', () => handlers.setZoneNote(zone.id, note.value));

      const summary = derivedZone(state.derived, zone.id);
      const systems = el('ul', { role: 'list', 'aria-label': `Systems in ${zone.name}` });
      for (const memberId of summary.members) {
        const member = state.doc.shapes.find((entry) => entry.id === memberId);
        if (!member) continue;
        systems.append(el('li', { text: plainLabel(member.label) }));
      }
      const flows = el('ul', { role: 'list', 'aria-label': `Flows crossing ${zone.name}` });
      for (const crossing of crossingsOfZone(state.derived, zone.id)) {
        const connectorItem = state.doc.connectors.find((entry) => entry.id === crossing.connectorId);
        if (!connectorItem) continue;
        const source = state.doc.shapes.find((entry) => entry.id === connectorItem.from.shapeId);
        const target = state.doc.shapes.find((entry) => entry.id === connectorItem.to.shapeId);
        flows.append(
          el('li', {
            text: `${plainLabel(connectorItem.label)}: ${source ? plainLabel(source.label) : ''} to ${
              target ? plainLabel(target.label) : ''
            }, ${crossing.direction === 'in' ? 'entering' : 'leaving'}`,
          }),
        );
      }

      body.replaceChildren(
        field('Zone name', name, { id: 'inspector-zone-name' }),
        field('Zone kind', kind, { id: 'inspector-zone-kind' }),
        field('Note', note, { id: 'inspector-zone-note' }),
        el('div', { class: 'grid-2' }, [
          numberInput('X', zone.x, (value) => handlers.setGeometry(zone.id, { x: value }), readOnly),
          numberInput('Y', zone.y, (value) => handlers.setGeometry(zone.id, { y: value }), readOnly),
          numberInput('Width', zone.width, (value) => handlers.setGeometry(zone.id, { width: value }), readOnly),
          numberInput('Height', zone.height, (value) => handlers.setGeometry(zone.id, { height: value }), readOnly),
        ]),
        el('h3', { text: `Systems in ${zone.name}` }),
        systems,
        el('h3', { text: `Flows crossing ${zone.name}` }),
        flows,
      );
      return;
    }

    if (connector) {
      const input = el('input', { type: 'text', value: connector.label, 'aria-label': 'Label' });
      input.readOnly = readOnly;
      labelInput = input;
      input.addEventListener('change', () => handlers.setConnectorLabel(connector.id, input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handlers.setConnectorLabel(connector.id, input.value);
          handlers.commitLabel();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          input.value = connector.label;
          handlers.cancelLabel();
        }
      });
      const source = state.doc.shapes.find((entry) => entry.id === connector.from.shapeId);
      const target = state.doc.shapes.find((entry) => entry.id === connector.to.shapeId);
      const from = el('input', { type: 'text', value: source ? plainLabel(source.label) : '', 'aria-label': 'From' });
      from.readOnly = true;
      const to = el('input', { type: 'text', value: target ? plainLabel(target.label) : '', 'aria-label': 'To' });
      to.readOnly = true;
      body.replaceChildren(
        field('Label', input, { id: 'inspector-label' }),
        field('From', from, { id: 'inspector-from' }),
        field('To', to, { id: 'inspector-to' }),
      );
      return;
    }

    body.replaceChildren(el('p', { text: 'Select an item to see its fields.' }));
  };

  render();
  return {
    element,
    body,
    render,
    firstField: () => body.querySelector<HTMLElement>('input, select, button'),
    labelField: () => labelInput,
  };
}
