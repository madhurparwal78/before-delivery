import { combobox, el, radiogroup, spinbutton, switchControl } from './dom';
import type { EditorStore } from './editor-state';
import { MSG } from '../shared/messages';
import {
  displayChoice,
  groupPathOf,
  layerPropDef,
  layerPropDefs,
  scenePropDefs,
  vectorGroupAxes,
} from '../shared/properties';
import type { PropDef } from '../shared/properties';
import { EASING_DISPLAY, EASING_NAMES } from '../shared/easing';
import type { JsonValue, Layer } from '../shared/types';
import { clothPointNames } from '../shared/cloth';
import { clipLabel } from '../shared/gltf';
import { modelFor, resolveLayer, stringAt } from '../shared/evaluator';

const VIEWER_REFUSAL = MSG.viewerCantEdit;

function inheritedLevel(store: EditorStore, layer: Layer, path: string): boolean {
  if (store.state.breakpoint === 'desktop') return false;
  return Object.prototype.hasOwnProperty.call(layer.overrides[store.state.breakpoint], path);
}

function bindingFor(layer: Layer, path: string): string | undefined {
  const group = groupPathOf(path);
  return layer.bindings[path] ?? (group ? layer.bindings[group] : undefined);
}

function fieldExtras(
  store: EditorStore,
  layer: Layer,
  def: PropDef,
  rerender: () => void,
): Node[] {
  const extras: Node[] = [];
  const binding = bindingFor(layer, def.path);
  if (inheritedLevel(store, layer, def.path)) {
    const reset = el('button', {
      type: 'button',
      class: 'button',
      text: 'Reset',
      'aria-label': `Reset ${def.field} to inherited value`,
    });
    reset.addEventListener('click', () => {
      store.clearOverride(layer.id, def.path);
      rerender();
    });
    extras.push(reset);
  }
  const bindable =
    def.type === 'number' || def.type === 'colour' || def.path === 'text' || def.path === 'visible';
  if (bindable && store.canEdit) {
    const group = groupPathOf(def.path);
    const boundPath = binding ? (layer.bindings[def.path] ? def.path : group ?? def.path) : def.path;
    const label = binding ? `Unbind ${def.field}` : `Bind ${def.field}`;
    const bind = el('button', { type: 'button', class: 'button', text: binding ? 'Unbind' : 'Bind', 'aria-label': label });
    bind.addEventListener('click', () => {
      if (binding) {
        store.queue({ type: 'unbind', layerId: layer.id, property: boundPath });
      } else {
        const variable = store.state.document.variables[0];
        if (!variable) {
          store.setNotice('Add a variable first.');
          return;
        }
        const axes = vectorGroupAxes(def.path.split('.')[0], layer.kind);
        const property =
          variable.type === 'Vector 3' || variable.type === 'Vector 2'
            ? axes
              ? def.path.split('.')[0]
              : def.path
            : def.path;
        store.queue({ type: 'bind', layerId: layer.id, property, variable: variable.name });
      }
      rerender();
    });
    extras.push(bind);
  }
  if (binding) {
    extras.push(el('span', { class: 'field-note', text: `Bound to ${binding}` }));
    if (def.type === 'number' && def.min !== undefined && def.max !== undefined) {
      const variable = store.state.document.variables.find((candidate) => candidate.name === binding);
      const raw = variable
        ? typeof variable.value === 'number'
          ? variable.value
          : ((variable.value as Record<string, number>)[def.path.split('.').pop() ?? 'x'] ?? 0)
        : 0;
      if (raw < def.min) {
        extras.push(el('span', { class: 'field-note limit', text: `Clamped to ${def.min}` }));
      } else if (raw > def.max) {
        extras.push(el('span', { class: 'field-note limit', text: `Clamped to ${def.max}` }));
      }
    }
  }
  return extras;
}

function fieldControl(
  store: EditorStore,
  layer: Layer,
  def: PropDef,
  rerender: () => void,
): HTMLElement | null {
  const value = store.readValue(layer, def.path);
  const binding = bindingFor(layer, def.path);
  const held = store.heldBy(layer.id);
  /** A held or locked layer keeps its fields reachable so the server's refusal is shown. */
  const disabled = !store.canEdit || binding !== undefined;
  const description = !store.canEdit
    ? VIEWER_REFUSAL
    : layer.locked
      ? `${layer.name} is locked.`
      : held
        ? `${held.name} is editing this layer.`
        : undefined;
  const focusKey = `field:${layer.id}:${def.path}`;
  const commit = (next: JsonValue): void => {
    store.state.focusedProperty = def.path;
    store.state.focusTarget = focusKey;
    void store.takeLock(layer.id);
    store.updateLayerValue(layer.id, def.path, next);
    rerender();
  };
  let control: HTMLElement | null = null;
  if (def.type === 'number') {
    const spin = spinbutton({
      name: def.field,
      value: typeof value === 'number' ? value : 0,
      min: def.min,
      max: def.max,
      step: def.step,
      shiftStep: def.shiftStep,
      disabled,
      description,
      focusKey,
      onCommit: (next) => commit(next),
    });
    spin.input.addEventListener('focus', () => {
      store.state.focusedProperty = def.path;
    });
    control = spin.wrapper;
  } else if (def.type === 'boolean') {
    control = el('div', { class: 'field' }, [
      switchControl({
        name: def.field,
        checked: value === true,
        disabled,
        description,
        focusKey,
        onChange: (checked) => commit(checked),
      }),
    ]);
  } else if (def.type === 'choice') {
    control = combobox({
      name: def.field,
      value: String(value ?? ''),
      choices: (def.choices ?? []).map((choice) => ({ value: choice, label: displayChoice(choice) })),
      disabled,
      description,
      focusKey,
      onChange: (next) => commit(next),
    }).wrapper;
  } else if (def.type === 'colour' || def.type === 'text') {
    const id = `text-${layer.id}-${def.path}`;
    const input = el('input', {
      id,
      type: 'text',
      class: 'field-input',
      value: String(value ?? ''),
      'aria-disabled': disabled ? 'true' : null,
      readonly: disabled,
      title: description ?? null,
      'data-focus-key': focusKey,
    });
    input.addEventListener('focus', () => {
      store.state.focusedProperty = def.path;
    });
    input.addEventListener('change', () => commit(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(input.value);
      }
    });
    control = el('div', { class: 'field' }, [
      el('label', { for: id, class: 'field-label', text: def.field }),
      input,
    ]);
  }
  if (!control) return null;
  const extras = fieldExtras(store, layer, def, rerender);
  if (extras.length > 0) control.append(el('div', { class: 'card-actions' }, extras));
  return control;
}

function group(title: string, children: (Node | null)[]): HTMLElement {
  const nodes = children.filter((child): child is Node => child !== null);
  if (nodes.length === 0) return el('div');
  return el('section', { class: 'inspector-group' }, [
    el('h4', { text: title }),
    el('div', { class: 'inspector-grid' }, nodes),
  ]);
}

function pathsFor(layer: Layer, prefixes: string[], exact: string[] = []): PropDef[] {
  return layerPropDefs(layer.kind).filter(
    (def) => prefixes.some((prefix) => def.path.startsWith(prefix)) || exact.includes(def.path),
  );
}

export function renderInspector(store: EditorStore, rerender: () => void): HTMLElement {
  const container = el('div', { class: 'inspector-groups' });
  const scene = store.scene;
  if (!scene) return container;
  const layer = store.selectedLayer;

  if (layer) {
    const render = (defs: PropDef[]): (Node | null)[] =>
      defs.map((def) => fieldControl(store, layer, def, rerender));

    container.append(
      group('Layer', [
        fieldControl(store, layer, {
          path: 'name',
          field: 'Name',
          type: 'text',
          maxLength: 60,
          overridable: false,
          default: layer.name,
        }, rerender),
        ...render(pathsFor(layer, [], ['visible', 'locked'])),
      ]),
    );

    if (layer.kind === 'Primitive' || layer.kind === 'Extrusion' || layer.kind === 'Model' ||
        layer.kind === 'Particles' || layer.kind === 'Cloth') {
      container.append(group('Transform', render(pathsFor(layer, ['position.', 'rotation.', 'scale.']))));
      const vertexOptions = vertexChoices(store, layer);
      if (vertexOptions.length > 0) {
        container.append(
          group('Vertex', [
            combobox({
              name: 'Vertex',
              value: store.state.vertex ?? vertexOptions[0],
              choices: vertexOptions.map((name) => ({ value: name, label: name })),
              onChange: (next) => {
                store.state.vertex = next;
                rerender();
              },
            }).wrapper,
          ]),
        );
      }
      container.append(
        group('Material', render(pathsFor(layer, ['material.'], ['depthTest']))),
      );
      const faces = layerPropDef(layer.kind, 'faces');
      if (faces) {
        container.append(
          group('Faces', [
            radiogroup({
              name: 'Faces',
              value: String(store.readValue(layer, 'faces') ?? 'front'),
              choices: [
                { value: 'front', label: 'Front only' },
                { value: 'both', label: 'Both sides' },
              ],
              disabled: !store.canEdit,
              description: store.canEdit ? undefined : VIEWER_REFUSAL,
              onChange: (next) => {
                void store.takeLock(layer.id);
                store.updateLayerValue(layer.id, 'faces', next);
                rerender();
              },
            }),
          ]),
        );
      }
    }

    if (layer.kind === 'Primitive') {
      container.append(group('Primitive', render(pathsFor(layer, [], ['primitive']))));
    }

    if (layer.kind === 'Extrusion') {
      container.append(
        group('Extrusion', render(pathsFor(layer, [], ['text', 'letterHeight', 'depth', 'bevelSize', 'bevelSegments']))),
      );
    }

    if (layer.kind === 'Model') {
      container.append(group('Model', modelControls(store, layer, rerender)));
    }

    if (layer.kind === 'Particles') {
      container.append(
        group('Particles', [
          radiogroup({
            name: 'Particle mode',
            value: String(store.readValue(layer, 'mode') ?? 'emit'),
            choices: [
              { value: 'emit', label: 'Emit' },
              { value: 'form', label: 'Form into' },
            ],
            disabled: !store.canEdit,
            description: store.canEdit ? undefined : VIEWER_REFUSAL,
            onChange: (next) => {
              void store.takeLock(layer.id);
              store.updateLayerValue(layer.id, 'mode', next);
              rerender();
            },
          }),
          ...render(
            pathsFor(layer, ['attractor.', 'formation.'], [
              'seed',
              'rate',
              'burst',
              'lifetime',
              'speed',
              'gravity',
              'trailLength',
              'orbit',
            ]).filter((def) => def.path !== 'formation.target'),
          ),
          formationTargetControl(store, layer, rerender),
          spinbutton({
            name: 'Particle number',
            value: store.state.particleNumber,
            min: 1,
            max: 2000,
            step: 1,
            decimals: 0,
            onCommit: (next) => {
              store.state.particleNumber = Math.max(1, Math.round(next));
              rerender();
            },
          }).wrapper,
        ]),
      );
    }

    if (layer.kind === 'Cloth') {
      const columns = Number(store.readValue(layer, 'columns') ?? 10);
      const rows = Number(store.readValue(layer, 'rows') ?? 10);
      const names = clothPointNames(columns, rows);
      container.append(
        group('Cloth', [
          ...render(
            pathsFor(layer, [], [
              'columns',
              'rows',
              'pinned',
              'gravity',
              'windStrength',
              'windDirection',
              'stiffness',
              'damping',
              'iterations',
              'seed',
            ]),
          ),
          combobox({
            name: 'Cloth point',
            value: store.state.clothPoint ?? names[0] ?? '',
            choices: names.map((name) => ({ value: name, label: name })),
            onChange: (next) => {
              store.state.clothPoint = next;
              rerender();
            },
          }).wrapper,
        ]),
      );
    }

    if (layer.kind === 'Effect') {
      const kind = String(store.readValue(layer, 'effect.kind') ?? 'Blur');
      const own: Record<string, string[]> = {
        Blur: ['effect.blurRadius'],
        Grain: ['effect.grainAmount', 'effect.grainSeed'],
        Bloom: ['effect.bloomThreshold', 'effect.bloomIntensity', 'effect.bloomRadius'],
        Glow: ['effect.glowStrength', 'effect.glowThreshold'],
        'Chromatic aberration': ['effect.aberration'],
        Displacement: ['effect.displacement'],
        Pixelate: ['effect.pixelCell'],
      };
      container.append(
        group('Effect', [
          ...render(pathsFor(layer, [], ['enabled', 'effect.kind'])),
          ...render(pathsFor(layer, [], own[kind] ?? [])),
        ]),
      );
    }

    if (['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient'].includes(layer.kind)) {
      container.append(
        group('Shape', render(
          pathsFor(layer, [], [
            'x',
            'y',
            'width',
            'height',
            'opacity',
            'fill',
            'sides',
            'text',
            'textSize',
            'blendMode',
            'maskAbove',
          ]),
        )),
      );
      if (layer.kind === 'Gradient') {
        container.append(group('Gradient', gradientControls(store, layer, rerender)));
      }
    }

    container.append(group('Events', render(pathsFor(layer, ['events.']))));
  }

  if (!layer) {
    container.append(
      group('Camera', [
        ...scenePropDefs()
          .filter((def) => def.path.startsWith('camera.') || def.path.startsWith('orbit.'))
          .map((def) => sceneField(store, def, rerender)),
        sceneField(store, scenePropDefs().find((def) => def.path === 'environment')!, rerender),
        sceneField(store, scenePropDefs().find((def) => def.path === 'light.enabled')!, rerender),
        sceneField(store, scenePropDefs().find((def) => def.path === 'background')!, rerender),
      ]),
    );
  }

  container.append(
    group('Sample', [
      spinbutton({
        name: 'Sample X',
        value: store.state.sampleX,
        min: 0,
        max: 10000,
        step: 1,
        decimals: 0,
        onCommit: (next) => {
          store.state.sampleX = Math.round(next);
          rerender();
        },
      }).wrapper,
      spinbutton({
        name: 'Sample Y',
        value: store.state.sampleY,
        min: 0,
        max: 10000,
        step: 1,
        decimals: 0,
        onCommit: (next) => {
          store.state.sampleY = Math.round(next);
          rerender();
        },
      }).wrapper,
    ]),
  );

  return container;
}

function sceneField(store: EditorStore, def: PropDef, rerender: () => void): HTMLElement | null {
  const scene = store.scene;
  if (!scene || !def) return null;
  const parts = def.path.split('.');
  let value: unknown = scene;
  for (const part of parts) {
    value = (value as Record<string, unknown>)?.[part];
  }
  const disabled = !store.canEdit;
  const description = disabled ? VIEWER_REFUSAL : undefined;
  const focusKey = `scene:${def.path}`;
  const commit = (next: JsonValue): void => {
    store.state.focusedProperty = focusKey;
    store.state.focusTarget = focusKey;
    store.updateSceneValue(def.path, next);
    rerender();
  };
  if (def.type === 'number') {
    return spinbutton({
      name: def.field,
      value: typeof value === 'number' ? value : 0,
      min: def.min,
      max: def.max,
      step: def.step,
      shiftStep: def.shiftStep,
      disabled,
      description,
      focusKey,
      onCommit: commit,
    }).wrapper;
  }
  if (def.type === 'boolean') {
    return el('div', { class: 'field' }, [
      switchControl({
        name: def.field,
        checked: value === true,
        disabled,
        description,
        focusKey,
        onChange: commit,
      }),
    ]);
  }
  if (def.type === 'choice') {
    return combobox({
      name: def.field,
      value: String(value ?? ''),
      choices: (def.choices ?? []).map((choice) => ({ value: choice, label: displayChoice(choice) })),
      disabled,
      description,
      focusKey,
      onChange: commit,
    }).wrapper;
  }
  return null;
}

function vertexChoices(store: EditorStore, layer: Layer): string[] {
  const resolution = resolveLayer(store.state.document, layer, store.state);
  const cube = ['+x +y +z', '-x +y +z', '+x -y +z', '-x -y +z', '+x +y -z', '-x +y -z', '+x -y -z', '-x -y -z'];
  if (layer.kind === 'Primitive') {
    const primitive = stringAt(resolution, 'primitive', 'Cube');
    if (primitive === 'Plane') return ['+x +y', '-x +y', '+x -y', '-x -y'];
    return cube;
  }
  if (layer.kind === 'Extrusion') {
    if (stringAt(resolution, 'source', 'text') === 'svg') {
      const asset = store.state.loaded[String(store.readValue(layer, 'svgAssetId') ?? '')];
      const count = asset?.outline?.points.length ?? 0;
      return count > 0 ? ['Outline 1', `Outline ${count}`] : [];
    }
    return cube;
  }
  if (layer.kind === 'Model') {
    return modelFor(resolution, store.state.loaded) ? cube : [];
  }
  if (layer.kind === 'Cloth') return cube;
  return [];
}

function modelControls(store: EditorStore, layer: Layer, rerender: () => void): (Node | null)[] {
  const resolution = resolveLayer(store.state.document, layer, store.state);
  const model = modelFor(resolution, store.state.loaded);
  const nodes: (Node | null)[] = [];
  if (!model) return [el('p', { class: 'empty-state', text: 'No model loaded.' })];
  nodes.push(
    combobox({
      name: 'Node',
      value: store.state.node ?? model.nodes[0]?.name ?? '',
      choices: model.nodes.map((node) => ({ value: node.name, label: node.name })),
      onChange: (next) => {
        store.state.node = next;
        rerender();
      },
    }).wrapper,
  );
  const stored = resolution.values.get('clips');
  const clipRecords = Array.isArray(stored) ? (stored as Record<string, JsonValue>[]) : [];
  const list = el('ul', { class: 'list-reset', 'aria-label': 'Clips' });
  for (const clip of model.clips) {
    const record = clipRecords.find((entry) => entry.name === clip.name) ?? {
      name: clip.name,
      play: false,
      loop: false,
      speed: 1,
      offsetMs: 0,
    };
    const writeClip = (changes: Record<string, JsonValue>): void => {
      const next = model.clips.map((candidate) => {
        const existing = clipRecords.find((entry) => entry.name === candidate.name) ?? {
          name: candidate.name,
          play: false,
          loop: false,
          speed: 1,
          offsetMs: 0,
        };
        return candidate.name === clip.name ? { ...existing, ...changes } : existing;
      });
      void store.takeLock(layer.id);
      store.updateLayerValue(layer.id, 'clips', next as unknown as JsonValue);
      rerender();
    };
    const playing = record.play === true;
    const item = el('li', { 'aria-label': `${clip.name} · ${clip.durationS.toFixed(3)} s` }, [
      el('span', { text: clipLabel(clip) }),
      (() => {
        const toggle = el('button', {
          type: 'button',
          class: 'button',
          text: playing ? 'Pause' : 'Play',
          'aria-label': `${playing ? 'Pause' : 'Play'} ${clip.name}`,
          'aria-disabled': store.canEdit ? null : 'true',
          title: store.canEdit ? null : VIEWER_REFUSAL,
        });
        toggle.addEventListener('click', () => {
          if (!store.canEdit) return;
          writeClip({ play: !playing });
        });
        return toggle;
      })(),
      switchControl({
        name: `Loop ${clip.name}`,
        checked: record.loop === true,
        disabled: !store.canEdit,
        description: store.canEdit ? undefined : VIEWER_REFUSAL,
        onChange: (checked) => writeClip({ loop: checked }),
      }),
      spinbutton({
        name: `Speed ${clip.name}`,
        value: typeof record.speed === 'number' ? record.speed : 1,
        min: 0.25,
        max: 4,
        step: 0.25,
        decimals: 2,
        disabled: !store.canEdit,
        description: store.canEdit ? undefined : VIEWER_REFUSAL,
        onCommit: (next) => writeClip({ speed: next }),
      }).wrapper,
      spinbutton({
        name: `Clip offset ${clip.name}`,
        value: typeof record.offsetMs === 'number' ? record.offsetMs : 0,
        min: 0,
        max: 60000,
        step: 1,
        decimals: 0,
        disabled: !store.canEdit,
        description: store.canEdit ? undefined : VIEWER_REFUSAL,
        onCommit: (next) => writeClip({ offsetMs: Math.round(next) }),
      }).wrapper,
    ]);
    list.append(item);
  }
  nodes.push(list);
  return nodes;
}

function formationTargetControl(
  store: EditorStore,
  layer: Layer,
  rerender: () => void,
): HTMLElement {
  const scene = store.scene;
  const choices = (scene?.layers ?? [])
    .filter((candidate) => candidate.id !== layer.id && candidate.kind !== 'Group')
    .map((candidate) => ({ value: candidate.id, label: candidate.name }));
  return combobox({
    name: 'Form into',
    value: String(store.readValue(layer, 'formation.target') ?? ''),
    choices: [{ value: '', label: 'None' }, ...choices],
    disabled: !store.canEdit,
    description: store.canEdit ? undefined : VIEWER_REFUSAL,
    onChange: (next) => {
      void store.takeLock(layer.id);
      store.updateLayerValue(layer.id, 'formation.target', next === '' ? null : next);
      rerender();
    },
  }).wrapper;
}

function gradientControls(store: EditorStore, layer: Layer, rerender: () => void): Node[] {
  const stops = store.readValue(layer, 'gradient.stops');
  const list = Array.isArray(stops) ? (stops as Record<string, JsonValue>[]) : [];
  const container = el('ul', { class: 'list-reset', 'aria-label': 'Gradient stops' });
  const write = (next: Record<string, JsonValue>[]): void => {
    void store.takeLock(layer.id);
    store.updateLayerValue(layer.id, 'gradient.stops', next as unknown as JsonValue);
    rerender();
  };
  list.forEach((stop, index) => {
    const number = index + 1;
    const colourId = `stop-colour-${layer.id}-${number}`;
    const colour = el('input', {
      id: colourId,
      type: 'text',
      class: 'field-input',
      value: String(stop.color ?? '#000000'),
      'aria-disabled': store.canEdit ? null : 'true',
      readonly: !store.canEdit,
    });
    colour.addEventListener('change', () => {
      const next = list.map((entry, position) =>
        position === index ? { ...entry, color: colour.value } : entry,
      );
      write(next);
    });
    const remove = el('button', {
      type: 'button',
      class: 'button',
      text: 'Remove',
      'aria-label': `Remove stop ${number}`,
      'aria-disabled': store.canEdit ? null : 'true',
    });
    remove.addEventListener('click', () => {
      if (!store.canEdit) return;
      write(list.filter((_, position) => position !== index));
    });
    container.append(
      el('li', {}, [
        el('div', { class: 'field' }, [
          el('label', { for: colourId, class: 'field-label', text: `Stop ${number} colour` }),
          colour,
        ]),
        spinbutton({
          name: `Stop ${number} position`,
          value: typeof stop.position === 'number' ? stop.position : 0,
          min: 0,
          max: 100,
          step: 1,
          decimals: 0,
          disabled: !store.canEdit,
          description: store.canEdit ? undefined : VIEWER_REFUSAL,
          onCommit: (next) =>
            write(
              list.map((entry, position) =>
                position === index ? { ...entry, position: Math.round(next) } : entry,
              ),
            ),
        }).wrapper,
        remove,
      ]),
    );
  });
  const add = el('button', {
    type: 'button',
    class: 'button',
    text: 'Add stop',
    'aria-label': 'Add stop',
    'aria-disabled': store.canEdit ? null : 'true',
  });
  add.addEventListener('click', () => {
    if (!store.canEdit) return;
    write([...list, { color: '#FFFFFF', position: 100 }]);
  });
  return [
    ...layerPropDefs(layer.kind)
      .filter((def) => def.path.startsWith('gradient.') && def.path !== 'gradient.stops')
      .map((def) => fieldControl(store, layer, def, rerender))
      .filter((node): node is HTMLElement => node !== null),
    container,
    add,
  ];
}

export function easingChoices(includeSpring: boolean): { value: string; label: string }[] {
  const base = EASING_NAMES.map((name) => ({ value: name, label: EASING_DISPLAY[name] }));
  return includeSpring ? [...base, { value: 'spring', label: 'Spring' }] : base;
}
