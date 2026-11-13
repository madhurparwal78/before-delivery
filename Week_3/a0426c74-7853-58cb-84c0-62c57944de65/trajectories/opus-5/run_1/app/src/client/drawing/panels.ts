import { fmtDisplay } from '../../shared/numbers.js';
import { LAYER_COLOURS, LINETYPES, LINEWEIGHTS, type Layer, findEntity } from '../../shared/model.js';
import { entityLabel } from '../../shared/labels.js';
import { entityArea, entityBox, entityLength } from '../../shared/geometry.js';
import { evaluateExpression } from '../../shared/expressions.js';
import type { Operation } from '../../shared/operations.js';
import { api, RequestFailed } from '../api.js';
import { button, clear, el, on } from '../dom.js';
import { store } from '../store.js';
import { canvas } from './canvas.js';
import { toast } from '../toasts.js';

const ROW_WINDOW = 200;

export interface PanelHooks {
  submit(command: string, ops: Operation[]): Promise<void>;
  refresh(): void;
  openCompare(): void;
}

let hooks: PanelHooks | null = null;

export function setPanelHooks(next: PanelHooks): void {
  hooks = next;
}

function send(command: string, ops: Operation[]): void {
  void hooks?.submit(command, ops);
}

function opId(): string {
  return `op-${Math.random().toString(36).slice(2, 10)}`;
}

/** grid Entities: one row per entity in the whole drawing. */
export function entitiesGrid(): HTMLElement {
  const grid = el('div', { class: 'entities-grid' });
  let cursor = 0;
  let offset = 0;

  const items = (): { id: string; label: string; handle: string }[] => {
    const model = store.model.entities.map((entity) => ({
      id: entity.handle,
      handle: entity.handle,
      label: entityLabel(store.model, entity),
    }));
    const xrefs = store
      .xrefEntities()
      .map((item) => ({ id: item.id, handle: item.id, label: entityLabel(store.model, item.entity, item.id) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return [...model, ...xrefs];
  };

  const draw = (): void => {
    const all = items();
    grid.setAttribute('aria-rowcount', String(all.length));
    clear(grid);
    offset = Math.max(0, Math.min(cursor - Math.floor(ROW_WINDOW / 2), Math.max(0, all.length - ROW_WINDOW)));
    const slice = all.slice(offset, offset + ROW_WINDOW);
    slice.forEach((item, index) => {
      const position = offset + index;
      const row = el('div', {
        role: 'row',
        'aria-rowindex': String(position + 1),
        'aria-label': item.label,
        'aria-selected': store.selection.has(item.handle) ? 'true' : 'false',
        'data-entity-row': item.id,
        tabindex: position === cursor ? '0' : '-1',
        class: 'entity-row',
      }, [item.label]);
      grid.append(row);
    });
  };

  const focusRow = (): void => {
    const row = grid.querySelector<HTMLElement>(`[aria-rowindex="${cursor + 1}"]`);
    row?.focus();
  };

  const move = (step: number): void => {
    const all = items();
    if (all.length === 0) return;
    cursor = Math.max(0, Math.min(all.length - 1, cursor + step));
    const item = all[cursor];
    store.selection.clear();
    store.selection.add(item.handle);
    draw();
    focusRow();
    canvas().render();
  };

  on(grid, 'keydown', (event: KeyboardEvent) => {
    const all = items();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      const item = all[cursor];
      if (!item) return;
      if (store.selection.has(item.handle)) store.selection.delete(item.handle);
      else store.selection.add(item.handle);
      draw();
      focusRow();
      canvas().render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = all[cursor];
      if (!item) return;
      const entity = findEntity(store.model, item.handle) ?? store.xrefEntities().find((x) => x.id === item.handle)?.entity;
      if (!entity) return;
      canvas().panTo(entityBox(store.model, entity), 48);
    }
  });

  on(grid, 'click', (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest('[data-entity-row]');
    if (!target) return;
    const handle = target.getAttribute('data-entity-row') ?? '';
    const index = items().findIndex((item) => item.id === handle);
    if (index >= 0) cursor = index;
    store.selection.clear();
    store.selection.add(handle);
    draw();
    canvas().render();
  });

  store.on((event) => {
    if (event.kind === 'model' || event.kind === 'selection') draw();
  });
  draw();
  return grid;
}

function layerSelect(label: string, options: string[], value: string, onChange: (next: string) => void): HTMLSelectElement {
  const select = el('select', { 'aria-label': label, class: 'layer-select' });
  for (const option of options) {
    const node = el('option', { value: option, selected: option === value }, [option]);
    select.append(node);
  }
  on(select, 'change', () => onChange(select.value));
  return select;
}

/** region Layers with its layer list, current layer and saved states. */
export function layersPanel(): HTMLElement {
  const wrapper = el('div', { class: 'layers' });
  const grid = el('div', { role: 'grid', 'aria-label': 'Layer list', class: 'layer-grid' });
  const currentWrapper = el('div', { class: 'layer-current' });
  const statesList = el('ul', { role: 'list', 'aria-label': 'Layer states', class: 'layer-states' });

  const draw = (): void => {
    clear(grid);
    grid.setAttribute('aria-rowcount', String(store.model.layers.length));
    store.model.layers.forEach((layer, index) => {
      const row = el('div', { role: 'row', 'aria-rowindex': String(index + 1), class: 'layer-row', 'data-layer-name': layer.name });
      row.append(el('span', { class: 'layer-name' }, [layer.name]));
      const toggle = (name: 'On' | 'Frozen' | 'Locked', pressed: boolean): HTMLButtonElement => {
        const node = button(name, { 'aria-pressed': pressed ? 'true' : 'false', class: 'layer-toggle' });
        on(node, 'click', () => {
          const set =
            name === 'On' ? { on: !layer.on } : name === 'Frozen' ? { frozen: !layer.frozen } : { locked: !layer.locked };
          send('LAYER', [{ op_id: opId(), type: 'layer_set', name: layer.name, set }]);
        });
        return node;
      };
      row.append(toggle('On', layer.on), toggle('Frozen', layer.frozen), toggle('Locked', layer.locked));
      row.append(
        layerSelect('Colour', LAYER_COLOURS, layer.colour, (next) =>
          send('LAYER', [{ op_id: opId(), type: 'layer_set', name: layer.name, set: { colour: next as Layer['colour'] } }]),
        ),
        layerSelect('Linetype', LINETYPES, layer.linetype, (next) =>
          send('LAYER', [{ op_id: opId(), type: 'layer_set', name: layer.name, set: { linetype: next as Layer['linetype'] } }]),
        ),
        layerSelect(
          'Lineweight',
          LINEWEIGHTS.map((weight) => `${weight} mm`),
          `${layer.lineweight} mm`,
          (next) =>
            send('LAYER', [
              {
                op_id: opId(),
                type: 'layer_set',
                name: layer.name,
                set: { lineweight: next.replace(' mm', '') as Layer['lineweight'] },
              },
            ]),
        ),
      );
      grid.append(row);
    });

    clear(currentWrapper);
    const names = store.model.layers.map((layer) => layer.name).sort((a, b) => a.localeCompare(b));
    const current = layerSelect('Current layer', names, store.currentLayer, (next) => {
      const layer = store.model.layers.find((candidate) => candidate.name === next);
      if (layer && layer.frozen) {
        toast('Frozen layers can\u2019t be current.');
        current.value = store.currentLayer;
        return;
      }
      store.currentLayer = next;
    });
    currentWrapper.append(current);
    const add = button('New layer');
    on(add, 'click', () => {
      const name = `Layer ${store.model.layers.length}`;
      send('LAYER', [{ op_id: opId(), type: 'layer_add', name, colour: 'white', linetype: 'Continuous', lineweight: '0.25' }]);
    });
    const save = button('Save layer state');
    on(save, 'click', () => {
      const name = `State ${store.model.layer_states.length + 1}`;
      send('LAYERSTATE', [{ op_id: opId(), type: 'layer_state_save', name }]);
    });
    currentWrapper.append(add, save);

    clear(statesList);
    for (const state of store.model.layer_states) {
      const item = el('li', {}, [state.name]);
      const restore = button('Restore');
      on(restore, 'click', () => send('LAYERSTATE', [{ op_id: opId(), type: 'layer_state_restore', name: state.name }]));
      item.append(restore);
      statesList.append(item);
    }
  };

  wrapper.append(grid, currentWrapper, statesList);
  store.on((event) => {
    if (event.kind === 'model') draw();
  });
  draw();
  return wrapper;
}

/** region Properties: Length, Area, attributes and dimension style fields. */
export function propertiesPanel(): HTMLElement {
  const wrapper = el('div', { class: 'properties' });

  const draw = (): void => {
    clear(wrapper);
    const entities = [...store.selection]
      .map((handle) => findEntity(store.model, handle))
      .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined);
    if (entities.length === 0) {
      wrapper.append(el('p', {}, ['Nothing selected.']));
      return;
    }
    const lengths = entities.map((entity) => entityLength(entity)).filter((value): value is number => value !== null);
    const areas = entities.map((entity) => entityArea(entity)).filter((value): value is number => value !== null);
    const field = (label: string, value: string): HTMLElement =>
      el('p', { class: 'property' }, [el('span', { class: 'property-label' }, [label]), el('span', { 'data-property': label }, [value])]);
    const same = (values: number[]): string =>
      values.length === 0 ? '' : values.every((value) => Math.abs(value - values[0]) < 0.001) ? fmtDisplay(values[0]) : '*VARIES*';
    if (lengths.length > 0) wrapper.append(field('Length', same(lengths)));
    if (areas.length > 0) wrapper.append(field('Area', same(areas)));
    for (const entity of entities) {
      if (entity.type === 'insert') {
        for (const [tag, value] of Object.entries(entity.attributes)) {
          const input = el('input', { type: 'text', 'aria-label': tag, value });
          on(input, 'change', () => {
            send('PROPERTIES', [
              { op_id: opId(), type: 'modify', handle: entity.handle, set: { attributes: { [tag]: input.value } } },
            ]);
          });
          const row = el('p', { class: 'property' }, [el('span', { class: 'property-label' }, [tag])]);
          row.append(input);
          wrapper.append(row);
        }
      }
      if (entity.type === 'dimension') {
        const style = store.model.dim_styles.find((candidate) => candidate.name === entity.style);
        if (!style) continue;
        for (const [label, value] of [
          ['Precision', String(style.precision)],
          ['Prefix', style.prefix],
          ['Suffix', style.suffix],
          ['Scale', String(style.scale)],
          ['Text height', String(style.text_height_mm)],
        ] as [string, string][]) {
          const input = el('input', { type: 'text', 'aria-label': label, value });
          on(input, 'change', () => {
            const next = {
              name: style.name,
              precision: label === 'Precision' ? Number(input.value) : style.precision,
              prefix: label === 'Prefix' ? input.value : style.prefix,
              suffix: label === 'Suffix' ? input.value : style.suffix,
              scale: label === 'Scale' ? Number(input.value) : style.scale,
              text_height_mm: label === 'Text height' ? Number(input.value) : style.text_height_mm,
            };
            send('PROPERTIES', [{ op_id: opId(), type: 'dim_style_set', ...next }]);
          });
          const row = el('p', { class: 'property' }, [el('span', { class: 'property-label' }, [label])]);
          row.append(input);
          wrapper.append(row);
        }
      }
    }
  };

  store.on((event) => {
    if (event.kind === 'model' || event.kind === 'selection') draw();
  });
  draw();
  return wrapper;
}

/** region Parameters with the parameter list. */
export function parametersPanel(): HTMLElement {
  const wrapper = el('div', { class: 'parameters' });
  const grid = el('div', { role: 'grid', 'aria-label': 'Parameter list', class: 'parameter-grid' });
  const entry = el('input', { type: 'text', 'aria-label': 'Parameter entry', placeholder: 'd1 = 10' });

  const draw = (): void => {
    clear(grid);
    const header = el('div', { role: 'row', 'aria-rowindex': '1', class: 'parameter-row' });
    for (const column of ['Name', 'Expression', 'Value']) {
      header.append(el('span', { role: 'columnheader' }, [column]));
    }
    grid.append(header);
    store.model.parameters.forEach((parameter, index) => {
      let value = '';
      try {
        value = fmtDisplay(evaluateExpression(parameter.name, store.model.parameters, parameter.name));
      } catch {
        value = '';
      }
      const row = el('div', {
        role: 'row',
        'aria-rowindex': String(index + 2),
        class: 'parameter-row',
        'data-parameter': parameter.name,
      });
      row.append(
        el('span', { role: 'gridcell' }, [parameter.name]),
        el('span', { role: 'gridcell' }, [parameter.expression]),
        el('span', { role: 'gridcell', 'data-parameter-value': value }, [value]),
      );
      grid.append(row);
    });
  };

  on(entry, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const [name, expression] = entry.value.split('=');
    if (!name || expression === undefined) return;
    send('PARAM', [{ op_id: opId(), type: 'parameter_set', name: name.trim(), expression: expression.trim() }]);
    entry.value = '';
  });

  wrapper.append(grid, entry);
  store.on((event) => {
    if (event.kind === 'model') draw();
  });
  draw();
  return wrapper;
}

/** region Xrefs with reload and clip controls. */
export function xrefsPanel(): HTMLElement {
  const wrapper = el('div', { class: 'xrefs' });
  const draw = (): void => {
    clear(wrapper);
    if (store.xrefs.length === 0) {
      wrapper.append(el('p', {}, ['No references attached.']));
      return;
    }
    for (const xref of store.xrefs) {
      const row = el('div', { class: 'xref-row', 'data-xref': xref.name }, [
        el('span', {}, [`${xref.name} v${xref.version_number ?? 0}`]),
      ]);
      const reload = button('Reload');
      on(reload, 'click', () => send('XRELOAD', [{ op_id: opId(), type: 'xref_reload', name: xref.name }]));
      const clip = button('Clip');
      on(clip, 'click', () =>
        send('XCLIP', [{ op_id: opId(), type: 'xref_clip', name: xref.name, rect: [0, 0, 10, 10] }]),
      );
      const remove = button('Remove clip');
      on(remove, 'click', () => send('XCLIP', [{ op_id: opId(), type: 'xref_clip', name: xref.name, rect: null }]));
      row.append(reload, clip, remove);
      wrapper.append(row);
    }
  };
  store.on((event) => {
    if (event.kind === 'model') draw();
  });
  draw();
  return wrapper;
}

/** region Markups with its three tools. */
export function markupsPanel(): HTMLElement {
  const wrapper = el('div', { class: 'markups' });
  const list = el('ul', { role: 'list', 'aria-label': 'Markup list', class: 'markup-list' });

  const latestVersion = (): string | null => {
    for (const sheet of store.sheets) {
      const published = [...sheet.versions].sort((a, b) => b.number - a.number)[0];
      if (published) return published.id;
    }
    return null;
  };

  const draw = (): void => {
    clear(list);
    for (const markup of store.markups) {
      const item = el('li', { 'data-markup': markup.id, 'data-flag': markup.flag ?? undefined }, [
        `${markup.kind}: ${markup.text ?? ''}`,
      ]);
      if (markup.flag) item.append(el('span', { class: 'flag' }, ['Geometry changed under this markup']));
      list.append(item);
    }
  };

  for (const kind of ['Cloud', 'Arrow', 'Text'] as const) {
    const node = button(kind);
    on(node, 'click', () => {
      const versionId = latestVersion();
      if (!versionId) {
        toast('Publish a version first.');
        return;
      }
      void api
        .post(`/api/versions/${versionId}/markups`, {
          kind: kind.toLowerCase(),
          x1: store.lastPoint.x,
          y1: store.lastPoint.y,
          x2: store.lastPoint.x + 1,
          y2: store.lastPoint.y + 1,
          text: kind,
        })
        .then(() => hooks?.refresh())
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) toast(error.body.message);
        });
    });
    wrapper.append(node);
  }
  wrapper.append(list);
  store.on((event) => {
    if (event.kind === 'markups' || event.kind === 'versions') draw();
  });
  draw();
  return wrapper;
}

interface RfiView {
  id: string;
  question: string;
  state: string;
  ball_in_court: string;
}

function rfiArticle(rfi: RfiView): HTMLElement {
  const article = el('article', {
    'aria-label': `RFI: ${rfi.question}`,
    'data-rfi': rfi.id,
    'data-state': rfi.state,
    class: 'rfi',
  });
  article.append(el('p', { class: 'rfi-state' }, [rfi.state]), el('p', { class: 'rfi-ball' }, [`With ${rfi.ball_in_court}`]));
  const answer = el('input', { type: 'text', 'aria-label': 'RFI answer' });
  article.append(answer);
  const move = (label: string, to: string): HTMLButtonElement => {
    const node = button(label);
    on(node, 'click', () => {
      void api
        .post(`/api/rfis/${rfi.id}/transitions`, { to, answer: answer.value })
        .then(() => hooks?.refresh())
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) toast(error.body.message);
        });
    });
    return node;
  };
  article.append(move('Send RFI', 'sent'), move('Answer RFI', 'answered'), move('Close RFI', 'closed'), move('Reopen RFI', 'sent'));
  return article;
}

/** region Issues with every transition button in every state. */
export function issuesPanel(): HTMLElement {
  const wrapper = el('div', { class: 'issues' });
  const list = el('ul', { role: 'list', 'aria-label': 'Issue list', class: 'issue-list' });

  const openRfiDialog = (issueId: string): void => {
    const dialog = el('dialog', { 'aria-label': 'New RFI', class: 'surface' });
    const question = el('input', { type: 'text', 'aria-label': 'Question' });
    const addressee = el('select', { 'aria-label': 'Addressee' });
    for (const member of store.members
      .filter((entry) => entry.username !== store.username)
      .sort((a, b) => a.username.localeCompare(b.username))) {
      addressee.append(el('option', { value: member.username }, [member.username]));
    }
    const save = button('Save RFI', { class: 'primary' });
    on(save, 'click', () => {
      void api
        .post(`/api/issues/${issueId}/rfis`, { question: question.value, addressee: addressee.value })
        .then(() => {
          dialog.close();
          dialog.remove();
          hooks?.refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) toast(error.body.message);
        });
    });
    dialog.append(el('h2', {}, ['New RFI']), question, addressee, save);
    document.body.append(dialog);
    dialog.showModal();
    question.focus();
  };

  const draw = (): void => {
    clear(list);
    for (const issue of store.issues) {
      const item = el('li', { 'data-issue': issue.id, 'data-state': issue.state, class: 'issue' }, [
        el('span', { class: 'issue-title' }, [issue.title]),
        el('span', { class: 'issue-state' }, [issue.state]),
      ]);
      const create = button('Create RFI');
      on(create, 'click', () => openRfiDialog(issue.id));
      const transition = (label: string, to: string): HTMLButtonElement => {
        const node = button(label);
        on(node, 'click', () => {
          void api
            .post(`/api/issues/${issue.id}/transitions`, { to })
            .then(() => hooks?.refresh())
            .catch((error: unknown) => {
              if (error instanceof RequestFailed) toast(error.body.message);
            });
        });
        return node;
      };
      item.append(create, transition('Answer issue', 'answered'), transition('Close issue', 'closed'), transition('Reopen issue', 'open'));
      for (const rfi of issue.rfis) item.append(rfiArticle(rfi));
      list.append(item);
    }
    if (store.issues.length === 0) list.append(el('li', { class: 'empty' }, ['No issues yet.']));
  };

  wrapper.append(list);
  store.on((event) => {
    if (event.kind === 'issues') draw();
  });
  draw();
  return wrapper;
}
