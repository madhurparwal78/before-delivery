import { Graph, Layer, REST_STATE_ID, SceneNode, Vec3 } from '../../shared/graph';
import { FIELD_RANGES, RawOp } from '../../shared/ops';
import { shortNumber } from '../../shared/format';
import { announce, closeDialog, el, field, mount, openDialog } from '../dom';
import { tween, withBusy } from '../motion';
import { EditorModel } from './state';

export type Axis = 'X' | 'Y' | 'Z';
export type TransformField = 'position' | 'rotation' | 'scale';

const AXES: Axis[] = ['X', 'Y', 'Z'];
const STEP: Record<TransformField, { plain: number; shift: number }> = {
  position: { plain: 0.1, shift: 1 },
  rotation: { plain: 1, shift: 15 },
  scale: { plain: 0.01, shift: 0.1 },
};

export interface InspectorHost {
  model: EditorModel;
  status: HTMLElement;
  sendOps: (ops: RawOp[], intent: CommitIntent) => Promise<boolean>;
  refreshViewport: () => void;
  previewState: (fromStateId: string, toStateId: string) => void;
  takeOver: (nodeId: string) => Promise<boolean>;
  cameraState: () => { position: Vec3; target: Vec3; fov: number };
}

export interface CommitIntent {
  nodeId: string;
  fieldLabel: string;
  field: TransformField;
  rollback: () => void;
  clearPending: () => void;
}

interface FieldHandle {
  input: HTMLInputElement;
  tag: HTMLElement;
  field: TransformField;
  axis: Axis;
}

export class Inspector {
  readonly element = el('section', { class: 'panel inspector', 'aria-label': 'Inspector' });
  private handles: FieldHandle[] = [];
  private readOnlyNotice = el('p', { class: 'muted inspector-readonly' });

  constructor(private readonly host: InspectorHost) {}

  private get graph(): Graph {
    return this.host.model.graphAt(this.host.model.playhead);
  }

  private get node(): SceneNode | null {
    const selection = this.host.model.selection;
    if (!selection) return null;
    return this.graph.nodes.find((candidate) => candidate.id === selection) ?? null;
  }

  private get editable(): boolean {
    return this.host.model.playhead === this.host.model.latestSeq;
  }

  values(node: SceneNode): Record<TransformField, Vec3> {
    const state = this.host.model.stateId;
    if (state === REST_STATE_ID) {
      return { position: node.position, rotation: node.rotation, scale: node.scale };
    }
    const overrides = this.graph.states.find((candidate) => candidate.id === state)?.overrides ?? [];
    const read = (fieldName: TransformField): Vec3 => {
      const override = overrides.find(
        (entry) => entry.nodeId === node.id && entry.field === fieldName,
      );
      return override ? (override.value as Vec3) : node[fieldName];
    };
    return { position: read('position'), rotation: read('rotation'), scale: read('scale') };
  }

  render(): void {
    const node = this.node;
    this.handles = [];
    if (!node) {
      mount(
        this.element,
        el('h2', { text: 'Inspector' }),
        el('p', { class: 'muted', text: 'Select an object in the hierarchy.' }),
      );
      return;
    }
    const values = this.values(node);
    const transformRows = (['position', 'rotation', 'scale'] as TransformField[]).map((fieldName) =>
      el(
        'div',
        { class: 'transform-row' },
        AXES.map((axis, index) => this.transformField(node, fieldName, axis, values[fieldName][index] ?? 0)),
      ),
    );

    this.readOnlyNotice.textContent = this.editable
      ? ''
      : `Viewing operation ${this.host.model.playhead}. Return to latest to edit.`;

    mount(
      this.element,
      el('h2', { text: 'Inspector' }),
      el('p', { class: 'inspector-node', text: node.name }),
      this.readOnlyNotice,
      el('div', { class: 'transform-grid' }, transformRows),
      this.materialSection(node),
      this.statesSection(),
      this.transitionSection(),
      this.cameraViewsSection(),
    );
  }

  private transformField(
    node: SceneNode,
    fieldName: TransformField,
    axis: Axis,
    value: number,
  ): HTMLElement {
    const label = `${fieldName[0]?.toUpperCase()}${fieldName.slice(1)} ${axis}`;
    const input = el('input', {
      type: 'number',
      'aria-label': label,
      step: String(STEP[fieldName].plain),
      value: shortNumber(value),
      class: 'figure',
    });
    const tag = el('span', { class: 'pending-tag', text: 'Pending' });
    tag.hidden = true;
    input.readOnly = !this.editable;
    const handle: FieldHandle = { input, tag, field: fieldName, axis };
    this.handles.push(handle);

    let committed = shortNumber(value);
    const commit = (next: number): void => {
      const range = FIELD_RANGES[fieldName];
      if (!Number.isFinite(next)) {
        input.value = committed;
        return;
      }
      if (next < range.min || next > range.max) {
        input.value = committed;
        announce(
          this.host.status,
          `${label} must be between ${range.min} and ${range.max}.`,
        );
        input.classList.add('is-rejected');
        window.setTimeout(() => input.classList.remove('is-rejected'), 2_000);
        return;
      }
      const previous = committed;
      committed = shortNumber(next);
      input.value = committed;
      void this.commitTransform(node, fieldName, axis, next, label, () => {
        committed = previous;
        input.value = previous;
      }, handle);
    };

    input.addEventListener('keydown', (event) => {
      if (!this.editable) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(Number(input.value));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        input.value = committed;
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const step = event.shiftKey ? STEP[fieldName].shift : STEP[fieldName].plain;
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        commit(Number(committed) + step * direction);
      }
    });

    const labelNode = el('label', { class: 'transform-label', text: `${axis}` });
    let dragStart: { x: number; value: number } | null = null;
    labelNode.addEventListener('pointerdown', (event) => {
      if (!this.editable) return;
      dragStart = { x: event.clientX, value: Number(committed) };
      labelNode.setPointerCapture(event.pointerId);
    });
    labelNode.addEventListener('pointermove', (event) => {
      if (!dragStart) return;
      const steps = Math.round((event.clientX - dragStart.x) / 4);
      input.value = shortNumber(dragStart.value + steps * STEP[fieldName].plain);
    });
    const endDrag = (event: PointerEvent): void => {
      if (!dragStart) return;
      const steps = Math.round((event.clientX - dragStart.x) / 4);
      const next = dragStart.value + steps * STEP[fieldName].plain;
      dragStart = null;
      if (labelNode.hasPointerCapture(event.pointerId)) {
        labelNode.releasePointerCapture(event.pointerId);
      }
      if (steps !== 0) commit(next);
    };
    labelNode.addEventListener('pointerup', endDrag);
    labelNode.addEventListener('pointercancel', endDrag);

    return el('div', { class: 'transform-field' }, [labelNode, input, tag]);
  }

  private async commitTransform(
    node: SceneNode,
    fieldName: TransformField,
    axis: Axis,
    value: number,
    label: string,
    rollback: () => void,
    handle: FieldHandle,
  ): Promise<void> {
    const index = AXES.indexOf(axis);
    const current = this.values(node)[fieldName];
    const next: Vec3 = [...current] as Vec3;
    next[index] = value;

    const holder = this.host.model.lockHolder(node.id);
    if (holder) {
      this.openLockDialog(node, holder.name, async () => {
        const won = await this.host.takeOver(node.id);
        if (!won) {
          rollback();
          this.setPending(handle, false);
          return;
        }
        await this.send(node, fieldName, next, label, rollback, handle);
      }, () => {
        rollback();
        this.setPending(handle, false);
        handle.input.focus();
      });
      return;
    }
    await this.send(node, fieldName, next, label, rollback, handle);
  }

  private async send(
    node: SceneNode,
    fieldName: TransformField,
    next: Vec3,
    label: string,
    rollback: () => void,
    handle: FieldHandle,
  ): Promise<void> {
    this.setPending(handle, true);
    const stateId = this.host.model.stateId;
    const op: RawOp =
      stateId === REST_STATE_ID
        ? { type: 'transform.set', payload: { id: node.id, [fieldName]: next } }
        : {
            type: 'state.override.set',
            payload: { stateId, nodeId: node.id, field: fieldName, value: next },
          };
    const accepted = await this.host.sendOps([op], {
      nodeId: node.id,
      fieldLabel: label,
      field: fieldName,
      rollback: () => {
        rollback();
        this.setPending(handle, false);
      },
      clearPending: () => this.setPending(handle, false),
    });
    if (accepted) this.setPending(handle, false);
  }

  private setPending(handle: FieldHandle, pending: boolean): void {
    handle.tag.hidden = !pending;
    if (pending) handle.input.dataset.pending = 'true';
    else delete handle.input.dataset.pending;
  }

  openLockDialog(
    node: SceneNode,
    holderName: string,
    onTakeOver: () => Promise<void>,
    onCancel: () => void,
  ): void {
    const takeOver = el('button', { type: 'button', class: 'button primary', text: 'Take over' });
    const cancel = el('button', {
      type: 'button',
      class: 'button quiet',
      text: 'Cancel',
      'data-initial-focus': 'true',
    });
    const dialog = el('div', { class: 'dialog', 'aria-label': 'Object locked' }, [
      el('h2', { text: 'Object locked' }),
      el('p', { text: `${holderName} is editing ${node.name}.` }),
      el('div', { class: 'dialog-actions' }, [cancel, takeOver]),
    ]);
    cancel.addEventListener('click', () => {
      closeDialog(dialog);
      onCancel();
    });
    takeOver.addEventListener('click', () => {
      void withBusy(takeOver, async () => {
        closeDialog(dialog);
        await onTakeOver();
      });
    });
    openDialog(dialog, null);
  }

  /** Counts the shown numbers to their values at the new playhead position. */
  animateTo(previous: Graph): void {
    const node = this.node;
    if (!node) {
      this.render();
      return;
    }
    const before = previous.nodes.find((candidate) => candidate.id === node.id);
    const target = this.values(node);
    this.render();
    if (!before) return;
    const from: Record<TransformField, Vec3> = {
      position: before.position,
      rotation: before.rotation,
      scale: before.scale,
    };
    const handles = this.handles;
    tween(240, (progress) => {
      for (const handle of handles) {
        const index = AXES.indexOf(handle.axis);
        const start = from[handle.field][index] ?? 0;
        const end = target[handle.field][index] ?? 0;
        handle.input.value = shortNumber(start + (end - start) * progress);
      }
    });
  }

  private materialSection(node: SceneNode): HTMLElement {
    const items = node.materialLayers.map((layer) => this.layerItem(node, layer));
    const addLayer = el('button', {
      type: 'button',
      class: 'button',
      text: 'Add material layer',
    });
    addLayer.disabled = !this.editable;
    addLayer.addEventListener('click', () => this.openLayerMenu(node, addLayer));
    return el('div', { class: 'inspector-section' }, [
      el('h3', { text: 'Material' }),
      el('ul', { class: 'layer-list', 'aria-label': 'Material layers' }, items),
      addLayer,
    ]);
  }

  private layerItem(node: SceneNode, layer: Layer): HTMLElement {
    const numeric = (
      label: string,
      value: number,
      apply: (next: number) => RawOp,
    ): HTMLElement => {
      const input = el('input', {
        type: 'number',
        'aria-label': label,
        min: '0',
        max: '1',
        step: '0.05',
        value: shortNumber(value),
        class: 'figure',
      });
      input.readOnly = !this.editable;
      const commit = (): void => {
        const next = Number(input.value);
        if (!Number.isFinite(next) || next < 0 || next > 1) {
          input.value = shortNumber(value);
          announce(this.host.status, `${label} must be between 0 and 1.`);
          return;
        }
        void this.host.sendOps([apply(next)], {
          nodeId: node.id,
          fieldLabel: label,
          field: 'position',
          rollback: () => {
            input.value = shortNumber(value);
          },
          clearPending: () => undefined,
        });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      });
      return el('div', { class: 'layer-field' }, [input]);
    };

    return el('li', { class: 'layer-item' }, [
      el('p', { class: 'layer-type', text: layer.type }),
      numeric(`${layer.type} roughness`, layer.roughness, (next) => ({
        type: 'material.layer.set',
        payload: { id: node.id, layerId: layer.id, roughness: next },
      })),
      numeric(`${layer.type} metalness`, layer.metalness, (next) => ({
        type: 'material.layer.set',
        payload: { id: node.id, layerId: layer.id, metalness: next },
      })),
      ...(['red', 'green', 'blue'] as const).map((channel, index) =>
        numeric(`${layer.type} color ${channel}`, layer.color[index] ?? 0, (next) => {
          const colour: Vec3 = [...layer.color] as Vec3;
          colour[index] = next;
          return {
            type: 'material.layer.set',
            payload: { id: node.id, layerId: layer.id, color: colour },
          };
        }),
      ),
    ]);
  }

  private openLayerMenu(node: SceneNode, opener: HTMLButtonElement): void {
    const types: Layer['type'][] = ['base', 'clearcoat', 'sheen', 'emission'];
    const menu = el('div', { role: 'menu', 'aria-label': 'Layer type', class: 'menu' });
    let index = 0;
    const items = types.map((type, position) => {
      const item = el('div', {
        role: 'menuitem',
        tabindex: position === 0 ? '0' : '-1',
        text: `${type[0]?.toUpperCase()}${type.slice(1)}`,
        'data-layer-type': type,
      });
      item.addEventListener('click', () => {
        void choose(type);
      });
      return item;
    });
    mount(menu, ...items);
    opener.after(menu);
    items[0]?.focus();

    const close = (): void => {
      menu.remove();
      opener.focus();
    };

    const choose = async (type: Layer['type']): Promise<void> => {
      menu.remove();
      const layerId = `l_${Math.random().toString(36).slice(2, 10)}`;
      const accepted = await this.host.sendOps(
        [
          {
            type: 'material.layer.add',
            payload: {
              id: node.id,
              layer: {
                id: layerId,
                type,
                color: [0.6, 0.6, 0.58],
                roughness: 0.5,
                metalness: 0.1,
              },
            },
          },
        ],
        {
          nodeId: node.id,
          fieldLabel: 'Material layer',
          field: 'position',
          rollback: () => undefined,
          clearPending: () => undefined,
        },
      );
      if (accepted) {
        this.render();
        const added = this.element.querySelector<HTMLInputElement>('.layer-item:last-child input');
        added?.focus();
      }
    };

    menu.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        index =
          event.key === 'ArrowDown'
            ? Math.min(items.length - 1, index + 1)
            : Math.max(0, index - 1);
        items[index]?.focus();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const type = items[index]?.getAttribute('data-layer-type') as Layer['type'] | null;
        if (type) void choose(type);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
  }

  private statesSection(): HTMLElement {
    const graph = this.graph;
    const listbox = el('div', { role: 'listbox', 'aria-label': 'States', class: 'listbox' });
    const options = graph.states.map((state) => {
      const option = el('div', {
        role: 'option',
        'aria-selected': state.id === this.host.model.stateId ? 'true' : 'false',
        tabindex: state.id === this.host.model.stateId ? '0' : '-1',
        'data-state-id': state.id,
        text: state.name,
      });
      option.addEventListener('click', () => this.chooseState(state.id));
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.chooseState(state.id);
        }
      });
      return option;
    });
    mount(listbox, ...options);
    listbox.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const current = graph.states.findIndex((state) => state.id === this.host.model.stateId);
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(graph.states.length - 1, current + 1)
          : Math.max(0, current - 1);
      const next = graph.states[nextIndex];
      if (next) this.chooseState(next.id);
    });

    const addState = el('button', { type: 'button', class: 'button', text: 'Add state' });
    addState.disabled = !this.editable;
    addState.addEventListener('click', () => {
      const name = el('input', { type: 'text', name: 'stateName' });
      const add = el('button', { type: 'button', class: 'button primary', text: 'Add' });
      const dialog = el('div', { class: 'dialog', 'aria-label': 'Add state' }, [
        el('h2', { text: 'Add state' }),
        field('State name', name),
        el('div', { class: 'dialog-actions' }, [add]),
      ]);
      const submit = (): void => {
        const stateId = `st_${Math.random().toString(36).slice(2, 10)}`;
        void withBusy(add, async () => {
          const accepted = await this.host.sendOps(
            [{ type: 'state.add', payload: { state: { id: stateId, name: name.value } } }],
            {
              nodeId: '',
              fieldLabel: 'State name',
              field: 'position',
              rollback: () => undefined,
              clearPending: () => undefined,
            },
          );
          if (accepted) {
            closeDialog(dialog);
            this.host.model.stateId = stateId;
            this.render();
            this.host.refreshViewport();
          }
        });
      };
      add.addEventListener('click', submit);
      name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });
      openDialog(dialog, addState);
    });

    return el('div', { class: 'inspector-section' }, [
      el('h3', { text: 'States' }),
      listbox,
      addState,
    ]);
  }

  private chooseState(stateId: string): void {
    const from = this.host.model.stateId;
    this.host.model.stateId = stateId;
    this.render();
    this.host.previewState(from, stateId);
    const name = this.graph.states.find((state) => state.id === stateId)?.name ?? stateId;
    announce(this.host.status, `Previewing ${name}.`);
  }

  private cameraViewsSection(): HTMLElement {
    const views = this.graph.cameraViews;
    const listbox = el('div', { role: 'listbox', 'aria-label': 'Camera views', class: 'listbox' });
    mount(
      listbox,
      ...views.map((view) =>
        el('div', {
          role: 'option',
          'aria-selected': 'false',
          tabindex: '-1',
          text: view.name,
        }),
      ),
    );
    const addView = el('button', { type: 'button', class: 'button', text: 'Add camera view' });
    addView.disabled = !this.editable;
    addView.addEventListener('click', () => {
      const name = el('input', { type: 'text', name: 'viewName' });
      const add = el('button', { type: 'button', class: 'button primary', text: 'Add' });
      const dialog = el('div', { class: 'dialog', 'aria-label': 'Add camera view' }, [
        el('h2', { text: 'Add camera view' }),
        field('View name', name),
        el('div', { class: 'dialog-actions' }, [add]),
      ]);
      add.addEventListener('click', () => {
        const camera = this.host.cameraState();
        void withBusy(add, async () => {
          const accepted = await this.host.sendOps(
            [
              {
                type: 'camera.view.set',
                payload: {
                  name: name.value,
                  position: camera.position,
                  target: camera.target,
                  fov: camera.fov,
                },
              },
            ],
            {
              nodeId: '',
              fieldLabel: 'View name',
              field: 'position',
              rollback: () => undefined,
              clearPending: () => undefined,
            },
          );
          if (accepted) {
            closeDialog(dialog);
            this.render();
          }
        });
      });
      openDialog(dialog, addView);
    });
    return el('div', { class: 'inspector-section' }, [
      el('h3', { text: 'Camera views' }),
      listbox,
      addView,
    ]);
  }

  private transitionSection(): HTMLElement | null {
    const stateId = this.host.model.stateId;
    if (stateId === REST_STATE_ID) return null;
    const trigger = el(
      'select',
      { 'aria-label': 'Trigger' },
      (['hover', 'click', 'scroll'] as const).map((value) =>
        el('option', { value, text: value }),
      ),
    );
    const existing = this.graph.transitions.find(
      (transition) => transition.from === REST_STATE_ID && transition.to === stateId,
    );
    const duration = el('input', {
      type: 'number',
      'aria-label': 'Transition duration',
      min: '0',
      max: '2000',
      step: '10',
      value: String(existing?.durationMs ?? 400),
      class: 'figure',
    });
    const set = el('button', { type: 'button', class: 'button', text: 'Set transition' });
    set.disabled = !this.editable;
    set.addEventListener('click', () => {
      void withBusy(set, async () => {
        const accepted = await this.host.sendOps(
          [
            {
              type: 'transition.set',
              payload: {
                from: REST_STATE_ID,
                to: stateId,
                trigger: trigger.value,
                durationMs: Number(duration.value),
              },
            },
          ],
          {
            nodeId: '',
            fieldLabel: 'Transition duration',
            field: 'position',
            rollback: () => undefined,
            clearPending: () => undefined,
          },
        );
        if (accepted) this.render();
      });
    });
    return el('div', { class: 'inspector-section' }, [
      el('h3', { text: 'Transition from Rest' }),
      el('div', { class: 'row-actions' }, [trigger, duration, set]),
    ]);
  }
}
