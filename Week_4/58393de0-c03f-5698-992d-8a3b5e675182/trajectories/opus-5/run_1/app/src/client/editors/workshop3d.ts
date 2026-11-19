import type { SceneObject, Snapshot, Snapshot3d, Workplane } from '../../shared/types.js';
import { FIELD_COPY, UI_COPY } from '../../shared/copy.js';
import { colorForIndex } from '../../shared/palette.js';
import { el, isNarrow } from '../dom.js';
import { fieldError, openDialog } from '../dialog.js';
import { say } from '../status.js';
import { trim } from '../format.js';
import { Viewer, type ViewerObject } from '../gl/renderer.js';
import { stillSvg } from '../gl/still.js';
import type { Box, Mesh, Vec3 } from '../geom/mesh.js';
import { primitiveWorldMesh, primitiveVolume, primitiveTriangleCount, placeOnWorkplane, defaultWorkplane, workplaneAxes, snapToAxis, faceOfNormal, round2, round1, objectBox, selectionBox } from '../geom/scene.js';
import { groupInWorker } from '../geom/worker-client.js';
import type { EditorBody, EditorHooks } from './editor-kinds.js';

const MAX_OBJECTS = 200;
const MIN_SIZE = 0.1;
const MAX_SIZE = 1000;

interface GroupFacts {
  positions: Float32Array;
  volume: number;
  triangleCount: number;
  box: Box;
}

interface HistoryStep {
  objects: SceneObject[];
  workplane: Workplane;
  selection: string[];
}

const positionsOf = (mesh: Mesh): Float32Array => {
  const data = new Float32Array(mesh.triangles.length * 9);
  let at = 0;
  for (const triangle of mesh.triangles) {
    for (const corner of [triangle.a, triangle.b, triangle.c]) {
      data[at] = corner[0];
      data[at + 1] = corner[1];
      data[at + 2] = corner[2];
      at += 3;
    }
  }
  return data;
};

const cloneObjects = (objects: SceneObject[]): SceneObject[] =>
  objects.map((object) => ({ ...object, children: cloneObjects(object.children) }));

const vectorText = (vector: Vec3): string => vector.map((value) => trim(value)).join(',');

/** The 3D Workshop: solid and hole shapes, grouping, workplanes and keyboard transforms. */
export const createWorkshop3d = (snapshot: Snapshot3d, hooks: EditorHooks): EditorBody => {
  let objects = cloneObjects(snapshot.objects);
  let workplane: Workplane = snapshot.workplane ?? defaultWorkplane();
  let selection: string[] = [];
  let readOnly = false;
  let rotateMode = false;
  let workplaneMode = false;
  let nextColor = objects.length;
  const history: HistoryStep[] = [];
  const future: HistoryStep[] = [];
  const groupFacts = new Map<string, GroupFacts>();

  const sceneElement = el('div', { id: 'qy-scene', class: 'qy-sr-only' });
  const canvas = el('canvas', {
    class: 'qy-canvas',
    role: 'application',
    'aria-label': '3D workplane',
    tabindex: '0',
  });
  const canvasHolder = el('div', { class: 'qy-canvas-holder' }, [canvas]);
  const viewer = new Viewer(canvas);
  const inspectorFields = new Map<'w' | 'd' | 'h', HTMLInputElement>();

  const objectById = (id: string): SceneObject | undefined => objects.find((object) => object.id === id);

  const selectedObjects = (): SceneObject[] =>
    selection.map((id) => objectById(id)).filter((object): object is SceneObject => object !== undefined);

  const boxesOfGroups = (): Map<string, Box> => {
    const map = new Map<string, Box>();
    for (const [id, facts] of groupFacts) map.set(id, facts.box);
    return map;
  };

  const requestGroupFacts = (object: SceneObject): void => {
    void groupInWorker(object.children).then((reply) => {
      groupFacts.set(object.id, {
        positions: reply.positions,
        volume: reply.volume,
        triangleCount: reply.triangleCount,
        box: { min: reply.min, max: reply.max },
      });
      paint();
    });
  };

  for (const object of objects) {
    if (object.kind === 'group') requestGroupFacts(object);
  }

  const viewerObjects = (): ViewerObject[] =>
    objects.map((object) => ({
      id: object.id,
      mode: object.mode,
      color: object.color,
      positions:
        object.kind === 'group'
          ? groupFacts.get(object.id)?.positions ?? new Float32Array()
          : positionsOf(primitiveWorldMesh(object)),
    }));

  const volumeOf = (object: SceneObject): number =>
    object.kind === 'group'
      ? object.mode === 'hole'
        ? 0
        : groupFacts.get(object.id)?.volume ?? 0
      : primitiveVolume(object);

  const triangleCountOf = (object: SceneObject): number =>
    object.kind === 'group' ? groupFacts.get(object.id)?.triangleCount ?? 0 : primitiveTriangleCount(object);

  const paintHiddenState = (): void => {
    sceneElement.replaceChildren();
    sceneElement.dataset.meshCount = String(objects.length);
    sceneElement.dataset.totalVolume = String(
      objects.filter((object) => object.mode === 'solid').reduce((total, object) => total + volumeOf(object), 0),
    );
    sceneElement.dataset.triangleCount = String(
      objects.reduce((total, object) => total + triangleCountOf(object), 0),
    );
    sceneElement.dataset.selected = selection.join(',');
    sceneElement.dataset.workplaneNormal = vectorText(workplane.normal);
    sceneElement.dataset.workplaneOrigin = vectorText(workplane.origin);
    sceneElement.dataset.cameraAzimuth = String(Math.round(viewer.camera.azimuth) % 360);
    sceneElement.dataset.cameraDistance = viewer.camera.distance.toFixed(1);
    for (const object of objects) {
      const child = el('div');
      child.dataset.objectId = object.id;
      child.dataset.kind = object.kind;
      child.dataset.mode = object.mode;
      child.dataset.x = trim(object.x);
      child.dataset.y = trim(object.y);
      child.dataset.z = trim(object.z);
      child.dataset.w = trim(object.w);
      child.dataset.d = trim(object.d);
      child.dataset.h = trim(object.h);
      child.dataset.rotationZ = String(Math.round(object.rotationZ) % 360);
      child.dataset.volume = String(volumeOf(object));
      sceneElement.append(child);
    }
  };

  const paint = (): void => {
    if (viewer.hasWebgl) {
      viewer.setObjects(viewerObjects());
      viewer.setSelection(selection);
      viewer.render();
    } else {
      canvasHolder.replaceChildren();
      canvasHolder.innerHTML = stillSvg(objects, { width: 640, height: 420, topView: true, background: '#e2f1ff' });
    }
    paintHiddenState();
    paintInspector();
  };

  const paintInspector = (): void => {
    const chosen = selectedObjects();
    const anySolid = chosen.some((object) => object.mode === 'solid');
    const anyHole = chosen.some((object) => object.mode === 'hole');
    solidToggle.setAttribute('aria-pressed', anySolid && !anyHole ? 'true' : 'false');
    holeToggle.setAttribute('aria-pressed', anyHole && !anySolid ? 'true' : 'false');
    const only = chosen[0];
    for (const [key, input] of inspectorFields) {
      input.value = only ? trim(only[key]) : '';
      input.disabled = only === undefined || readOnly;
    }
  };

  const pushHistory = (): void => {
    history.push({ objects: cloneObjects(objects), workplane: { ...workplane }, selection: [...selection] });
    if (history.length > 100) history.shift();
    future.length = 0;
  };

  const changed = (): void => {
    paint();
    hooks.onEdit();
  };

  const applyStep = (step: HistoryStep): void => {
    objects = cloneObjects(step.objects);
    workplane = { ...step.workplane };
    selection = [...step.selection];
    for (const object of objects) {
      if (object.kind === 'group' && !groupFacts.has(object.id)) requestGroupFacts(object);
    }
    changed();
  };

  const undo = (): void => {
    const step = history.pop();
    if (!step) return;
    future.push({ objects: cloneObjects(objects), workplane: { ...workplane }, selection: [...selection] });
    applyStep(step);
  };

  const redo = (): void => {
    const step = future.pop();
    if (!step) return;
    history.push({ objects: cloneObjects(objects), workplane: { ...workplane }, selection: [...selection] });
    applyStep(step);
  };

  const addShape = (kind: 'box' | 'cylinder' | 'sphere'): void => {
    if (readOnly) return;
    if (objects.length >= MAX_OBJECTS) {
      say(UI_COPY.objectLimit);
      return;
    }
    pushHistory();
    const centre = placeOnWorkplane(workplane, 20, 20, 20);
    const object: SceneObject = {
      id: `obj-${Date.now().toString(36)}-${objects.length + 1}`,
      kind,
      mode: 'solid',
      x: centre[0],
      y: centre[1],
      z: centre[2],
      w: 20,
      d: 20,
      h: 20,
      rotationZ: 0,
      color: colorForIndex(nextColor),
      children: [],
    };
    nextColor += 1;
    objects = [...objects, object];
    selection = [object.id];
    changed();
  };

  const moveSelection = (delta: Vec3): void => {
    if (readOnly || selection.length === 0) return;
    pushHistory();
    objects = objects.map((object) =>
      selection.includes(object.id)
        ? {
            ...object,
            x: round2(object.x + delta[0]),
            y: round2(object.y + delta[1]),
            z: round2(object.z + delta[2]),
            children: object.children.map((child) => ({
              ...child,
              x: round2(child.x + delta[0]),
              y: round2(child.y + delta[1]),
              z: round2(child.z + delta[2]),
            })),
          }
        : object,
    );
    for (const id of selection) {
      const facts = groupFacts.get(id);
      if (!facts) continue;
      groupFacts.set(id, {
        ...facts,
        positions: facts.positions.map((value, index) => value + delta[index % 3]) as Float32Array,
        box: {
          min: [facts.box.min[0] + delta[0], facts.box.min[1] + delta[1], facts.box.min[2] + delta[2]],
          max: [facts.box.max[0] + delta[0], facts.box.max[1] + delta[1], facts.box.max[2] + delta[2]],
        },
      });
    }
    changed();
  };

  const rotateSelection = (degrees: number): void => {
    if (readOnly || selection.length === 0) return;
    pushHistory();
    objects = objects.map((object) =>
      selection.includes(object.id)
        ? { ...object, rotationZ: ((object.rotationZ + degrees) % 360 + 360) % 360 }
        : object,
    );
    changed();
  };

  const toggleMode = (): void => {
    if (readOnly || selection.length === 0) return;
    pushHistory();
    objects = objects.map((object) =>
      selection.includes(object.id)
        ? { ...object, mode: object.mode === 'solid' ? 'hole' : 'solid' }
        : object,
    );
    changed();
  };

  const deleteSelection = (): void => {
    if (readOnly || selection.length === 0) return;
    pushHistory();
    objects = objects.filter((object) => !selection.includes(object.id));
    selection = [];
    changed();
  };

  const group = async (): Promise<void> => {
    if (readOnly) return;
    const chosen = selectedObjects();
    if (chosen.length < 2) {
      say(UI_COPY.selectTwo);
      return;
    }
    const members = chosen.flatMap((object) => (object.kind === 'group' ? object.children : [object]));
    if (!members.some((member) => member.mode === 'solid')) {
      say(UI_COPY.groupNeedsSolid);
      return;
    }
    say(UI_COPY.grouping);
    groupButton.disabled = true;
    const reply = await groupInWorker(members);
    groupButton.disabled = false;
    pushHistory();
    const box: Box = { min: reply.min, max: reply.max };
    const id = `grp-${Date.now().toString(36)}-${objects.length + 1}`;
    groupFacts.set(id, {
      positions: reply.positions,
      volume: reply.volume,
      triangleCount: reply.triangleCount,
      box,
    });
    const groupObject: SceneObject = {
      id,
      kind: 'group',
      mode: 'solid',
      x: round2((box.min[0] + box.max[0]) / 2),
      y: round2((box.min[1] + box.max[1]) / 2),
      z: round2((box.min[2] + box.max[2]) / 2),
      w: round1(box.max[0] - box.min[0]),
      d: round1(box.max[1] - box.min[1]),
      h: round1(box.max[2] - box.min[2]),
      rotationZ: 0,
      color: members.find((member) => member.mode === 'solid')?.color ?? colorForIndex(0),
      children: cloneObjects(members),
    };
    const firstIndex = objects.findIndex((object) => selection.includes(object.id));
    const remaining = objects.filter((object) => !selection.includes(object.id));
    remaining.splice(Math.max(0, firstIndex), 0, groupObject);
    objects = remaining;
    selection = [id];
    say(UI_COPY.grouped(chosen.length));
    changed();
  };

  const ungroup = (): void => {
    if (readOnly) return;
    const groups = selectedObjects().filter((object) => object.kind === 'group');
    if (groups.length === 0) {
      say(UI_COPY.selectTwo);
      return;
    }
    pushHistory();
    let released = 0;
    const next: SceneObject[] = [];
    for (const object of objects) {
      if (object.kind === 'group' && selection.includes(object.id)) {
        const members = cloneObjects(object.children);
        released += members.length;
        next.push(...members);
        groupFacts.delete(object.id);
      } else {
        next.push(object);
      }
    }
    objects = next;
    selection = [];
    say(UI_COPY.ungrouped(released));
    changed();
  };

  const align = (axis: 'X' | 'Y' | 'Z'): void => {
    const chosen = selectedObjects();
    if (chosen.length < 2) {
      say(UI_COPY.selectTwo);
      return;
    }
    pushHistory();
    const index = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2;
    const box = selectionBox(chosen, boxesOfGroups());
    const centre = (box.min[index] + box.max[index]) / 2;
    objects = objects.map((object) => {
      if (!selection.includes(object.id)) return object;
      const own = objectBox(object, boxesOfGroups());
      const ownCentre = (own.min[index] + own.max[index]) / 2;
      const delta = round2(centre - ownCentre);
      const moved = { ...object };
      if (index === 0) moved.x = round2(object.x + delta);
      if (index === 1) moved.y = round2(object.y + delta);
      if (index === 2) moved.z = round2(object.z + delta);
      moved.children = object.children.map((child) => ({
        ...child,
        x: index === 0 ? round2(child.x + delta) : child.x,
        y: index === 1 ? round2(child.y + delta) : child.y,
        z: index === 2 ? round2(child.z + delta) : child.z,
      }));
      return moved;
    });
    for (const id of selection) {
      const facts = groupFacts.get(id);
      if (facts) groupFacts.delete(id);
    }
    for (const object of objects) {
      if (object.kind === 'group' && !groupFacts.has(object.id)) requestGroupFacts(object);
    }
    say(UI_COPY.aligned(chosen.length, axis));
    changed();
  };

  const setWorkplaneFromPick = (objectId: string, normal: Vec3): void => {
    const object = objectById(objectId);
    if (!object) return;
    pushHistory();
    const snapped = snapToAxis(normal);
    const box = objectBox(object, boxesOfGroups());
    const origin: Vec3 = [
      snapped[0] === 0 ? round2((box.min[0] + box.max[0]) / 2) : snapped[0] > 0 ? box.max[0] : box.min[0],
      snapped[1] === 0 ? round2((box.min[1] + box.max[1]) / 2) : snapped[1] > 0 ? box.max[1] : box.min[1],
      snapped[2] === 0 ? round2((box.min[2] + box.max[2]) / 2) : snapped[2] > 0 ? box.max[2] : box.min[2],
    ];
    workplane = { origin: origin.map(round2) as Vec3, normal: snapped };
    workplaneMode = false;
    say(UI_COPY.workplaneSet(faceOfNormal(snapped)));
    changed();
  };

  const resetWorkplane = (): void => {
    pushHistory();
    workplane = defaultWorkplane();
    say(UI_COPY.workplaneReset);
    changed();
  };

  const openAlignDialog = (opener: HTMLElement): void => {
    if (selectedObjects().length < 2) {
      say(UI_COPY.selectTwo);
      return;
    }
    openDialog({ label: 'Align', opener }, (dialog) => {
      const make = (axis: 'X' | 'Y' | 'Z'): HTMLButtonElement => {
        const control = el('button', {
          type: 'button',
          class: 'qy-pill qy-pill-solid',
          text: `Align centers on ${axis}`,
        });
        control.addEventListener('click', () => {
          align(axis);
          dialog.close();
        });
        return control;
      };
      const cancel = el('button', { type: 'button', class: 'qy-pill qy-pill-outline', text: 'Cancel' });
      cancel.addEventListener('click', dialog.close);
      return [
        el('h2', { class: 'qy-dialog-heading', text: 'Align' }),
        el('div', { class: 'qy-dialog-actions' }, [make('X'), make('Y'), make('Z'), cancel]),
      ];
    });
  };

  const shapeButton = (label: string, kind: 'box' | 'cylinder' | 'sphere'): HTMLButtonElement => {
    const control = el('button', { type: 'button', class: 'qy-tool', text: label });
    control.addEventListener('click', () => addShape(kind));
    return control;
  };

  const shapesToolbar = el('div', { class: 'qy-toolbar', role: 'toolbar', 'aria-label': 'Shapes' }, [
    shapeButton('Box', 'box'),
    shapeButton('Cylinder', 'cylinder'),
    shapeButton('Sphere', 'sphere'),
  ]);

  const solidToggle = el('button', { type: 'button', class: 'qy-tool', text: 'Solid', 'aria-pressed': 'true' });
  const holeToggle = el('button', { type: 'button', class: 'qy-tool', text: 'Hole', 'aria-pressed': 'false' });
  solidToggle.addEventListener('click', () => {
    if (selectedObjects().some((object) => object.mode === 'hole')) toggleMode();
  });
  holeToggle.addEventListener('click', () => {
    if (selectedObjects().some((object) => object.mode === 'solid')) toggleMode();
  });

  const groupButton = el('button', { type: 'button', class: 'qy-tool', text: 'Group' });
  groupButton.addEventListener('click', () => {
    void group();
  });
  const ungroupButton = el('button', { type: 'button', class: 'qy-tool', text: 'Ungroup' });
  ungroupButton.addEventListener('click', ungroup);
  const alignButton = el('button', { type: 'button', class: 'qy-tool', text: 'Align' });
  alignButton.addEventListener('click', () => openAlignDialog(alignButton));
  const workplaneButton = el('button', { type: 'button', class: 'qy-tool', text: 'Workplane' });
  workplaneButton.addEventListener('click', () => {
    workplaneMode = true;
    say(UI_COPY.workplanePick);
  });
  const resetWorkplaneButton = el('button', { type: 'button', class: 'qy-tool', text: 'Reset workplane' });
  resetWorkplaneButton.addEventListener('click', resetWorkplane);
  const deleteButton = el('button', { type: 'button', class: 'qy-tool', text: 'Delete' });
  deleteButton.addEventListener('click', deleteSelection);

  const editTools = el('div', { class: 'qy-toolbar qy-toolbar-edit' }, [
    solidToggle,
    holeToggle,
    groupButton,
    ungroupButton,
    alignButton,
    workplaneButton,
    resetWorkplaneButton,
    deleteButton,
  ]);

  const sizeField = (label: string, key: 'w' | 'd' | 'h'): HTMLElement => {
    const id = `inspector-${key}`;
    const input = el('input', { id, class: 'qy-input', 'aria-label': label, autocomplete: 'off' });
    inspectorFields.set(key, input);
    const commit = (): void => {
      const only = selectedObjects()[0];
      if (!only || readOnly) return;
      const value = Number(input.value);
      fieldError(input, null);
      if (!Number.isFinite(value) || value < MIN_SIZE || value > MAX_SIZE) {
        fieldError(input, FIELD_COPY.size);
        say(FIELD_COPY.size);
        input.value = trim(only[key]);
        return;
      }
      pushHistory();
      const rounded = round1(value);
      objects = objects.map((object) => {
        if (object.id !== only.id) return object;
        const bottom = object.z - object.h / 2;
        const next = { ...object };
        if (object.kind === 'sphere') {
          next.w = rounded;
          next.d = rounded;
          next.h = rounded;
        } else if (object.kind === 'cylinder' && (key === 'w' || key === 'd')) {
          next.w = rounded;
          next.d = rounded;
        } else {
          next[key] = rounded;
        }
        next.z = round2(bottom + next.h / 2);
        return next;
      });
      changed();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    input.addEventListener('blur', commit);
    return el('div', { class: 'qy-field' }, [el('label', { for: id, text: label }), input]);
  };

  const inspectorFieldsHolder = [sizeField('Width (mm)', 'w'), sizeField('Depth (mm)', 'd'), sizeField('Height (mm)', 'h')];
  const inspector = el('aside', { class: 'qy-inspector', role: 'region', 'aria-label': 'Inspector' }, [
    isNarrow()
      ? el('details', { class: 'qy-inspector-fold', open: true }, [
          el('summary', { class: 'qy-panel-heading', text: 'Inspector' }),
          ...inspectorFieldsHolder,
        ])
      : el('div', { class: 'qy-inspector-body' }, [
          el('h2', { class: 'qy-panel-heading', text: 'Inspector' }),
          ...inspectorFieldsHolder,
        ]),
  ]);

  const openShapesSheet = (opener: HTMLElement): void => {
    openDialog({ label: 'Shapes', opener, className: 'qy-sheet' }, (dialog) => {
      const make = (label: string, kind: 'box' | 'cylinder' | 'sphere'): HTMLButtonElement => {
        const control = el('button', { type: 'button', class: 'qy-tool', text: label });
        control.addEventListener('click', () => {
          addShape(kind);
          dialog.close();
        });
        return control;
      };
      return [
        el('div', { class: 'qy-toolbar', role: 'toolbar', 'aria-label': 'Shapes' }, [
          make('Box', 'box'),
          make('Cylinder', 'cylinder'),
          make('Sphere', 'sphere'),
        ]),
      ];
    });
  };

  const shapesSheetButton = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Shapes' });
  shapesSheetButton.addEventListener('click', () => openShapesSheet(shapesSheetButton));

  const left = el('div', { class: 'qy-editor-left' }, isNarrow() ? [shapesSheetButton, editTools] : [shapesToolbar, editTools]);

  const element = el('div', { class: 'qy-editor-3d' }, [left, canvasHolder, inspector, sceneElement]);

  /* ---------- selection and pointer ---------- */

  const selectOnly = (id: string | null): void => {
    selection = id === null ? [] : [id];
    paint();
  };

  const toggleInSelection = (id: string): void => {
    selection = selection.includes(id) ? selection.filter((candidate) => candidate !== id) : [...selection, id];
    paint();
  };

  let dragging: { id: string | null; x: number; y: number; moved: boolean } | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.focus();
    const hit = viewer.pick(event.clientX, event.clientY);
    if (workplaneMode && hit) {
      setWorkplaneFromPick(hit.id, hit.normal);
      return;
    }
    if (hit && event.shiftKey) {
      toggleInSelection(hit.id);
      return;
    }
    if (hit) {
      if (!selection.includes(hit.id)) selectOnly(hit.id);
      dragging = { id: hit.id, x: event.clientX, y: event.clientY, moved: false };
      return;
    }
    selectOnly(null);
    dragging = { id: null, x: event.clientX, y: event.clientY, moved: false };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    if (dragging.id === null) {
      viewer.camera.azimuth = (viewer.camera.azimuth - dx / 2 + 360) % 360;
      viewer.camera.elevation = Math.max(5, Math.min(85, viewer.camera.elevation + dy * 0.25));
      paint();
      return;
    }
    const axes = workplaneAxes(workplane.normal);
    const step = 0.25;
    const delta: Vec3 = [
      (axes.x[0] * dx - axes.y[0] * dy) * step,
      (axes.x[1] * dx - axes.y[1] * dy) * step,
      (axes.x[2] * dx - axes.y[2] * dy) * step,
    ];
    if (!dragging.moved) {
      dragging.moved = true;
      pushHistory();
    }
    objects = objects.map((object) =>
      selection.includes(object.id)
        ? {
            ...object,
            x: round2(object.x + delta[0]),
            y: round2(object.y + delta[1]),
            z: round2(object.z + delta[2]),
          }
        : object,
    );
    paint();
  });

  const endDrag = (): void => {
    if (dragging?.moved && dragging.id !== null) hooks.onEdit();
    dragging = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    viewer.camera.distance = Math.max(20, Math.min(2000, viewer.camera.distance + event.deltaY * 0.5));
    paint();
  });

  let pinch: number | null = null;
  canvas.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 2) return;
      const [one, two] = [event.touches[0], event.touches[1]];
      const spread = Math.hypot(one.clientX - two.clientX, one.clientY - two.clientY);
      if (pinch !== null) {
        viewer.camera.distance = Math.max(20, Math.min(2000, viewer.camera.distance - (spread - pinch)));
        paint();
      }
      pinch = spread;
      event.preventDefault();
    },
    { passive: false },
  );
  canvas.addEventListener('touchend', () => {
    pinch = null;
  });

  /* ---------- keyboard ---------- */

  const stepFor = (event: KeyboardEvent): number => (event.shiftKey ? 10 : 1);

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (!element.contains(target) && target !== document.body) return;
    const axes = workplaneAxes(workplane.normal);
    const key = event.key;

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
      event.preventDefault();
      selection = objects.map((object) => object.id);
      paint();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroup();
      else void group();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;

    if (rotateMode) {
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        const amount = event.shiftKey ? 1 : 15;
        rotateSelection(key === 'ArrowRight' ? amount : -amount);
        return;
      }
      if (key === 'Enter' || key === 'Escape') {
        event.preventDefault();
        rotateMode = false;
        return;
      }
    }

    switch (key) {
      case 'b':
      case 'B':
        event.preventDefault();
        addShape('box');
        return;
      case 'c':
      case 'C':
        event.preventDefault();
        addShape('cylinder');
        return;
      case 's':
      case 'S':
        event.preventDefault();
        addShape('sphere');
        return;
      case 'h':
      case 'H':
        event.preventDefault();
        toggleMode();
        return;
      case 'l':
      case 'L':
        event.preventDefault();
        openAlignDialog((document.activeElement as HTMLElement | null) ?? alignButton);
        return;
      case 'w':
      case 'W':
        event.preventDefault();
        workplaneMode = true;
        say(UI_COPY.workplanePick);
        return;
      case 'r':
      case 'R':
        event.preventDefault();
        rotateMode = true;
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        deleteSelection();
        return;
      case 'Escape':
        if (workplaneMode) {
          event.preventDefault();
          workplaneMode = false;
        }
        return;
      case 'Enter':
        if (workplaneMode && selection.length > 0) {
          event.preventDefault();
          setWorkplaneFromPick(selection[0], [0, 0, 1]);
        }
        return;
      case 'Tab': {
        if (document.activeElement !== canvas) return;
        const order = objects.map((object) => object.id);
        if (order.length === 0) return;
        const index = selection.length === 1 ? order.indexOf(selection[0]) : -1;
        const nextIndex = event.shiftKey ? index - 1 : index + 1;
        if (index === -1) {
          event.preventDefault();
          selectOnly(event.shiftKey ? order[order.length - 1] : order[0]);
          return;
        }
        if (nextIndex < 0 || nextIndex >= order.length) return;
        event.preventDefault();
        selectOnly(order[nextIndex]);
        return;
      }
      case 'ArrowRight':
        event.preventDefault();
        moveSelection(axes.x.map((value) => value * stepFor(event)) as Vec3);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection(axes.x.map((value) => -value * stepFor(event)) as Vec3);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(axes.y.map((value) => value * stepFor(event)) as Vec3);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(axes.y.map((value) => -value * stepFor(event)) as Vec3);
        return;
      case 'PageUp':
        event.preventDefault();
        moveSelection(workplane.normal.map((value) => value * stepFor(event)) as Vec3);
        return;
      case 'PageDown':
        event.preventDefault();
        moveSelection(workplane.normal.map((value) => -value * stepFor(event)) as Vec3);
        return;
      default:
        return;
    }
  };

  document.addEventListener('keydown', onKeyDown);

  const onResize = (): void => paint();
  window.addEventListener('resize', onResize);

  paint();

  return {
    element,
    snapshot: (): Snapshot => ({ kind: '3d', objects: cloneObjects(objects), workplane }),
    undo,
    redo,
    setReadOnly: (next) => {
      readOnly = next;
      for (const control of element.querySelectorAll('button, input')) {
        if (next) control.setAttribute('disabled', '');
      }
      paintInspector();
    },
    loadSnapshot: (next) => {
      if (next.kind !== '3d') return;
      objects = cloneObjects(next.objects);
      workplane = next.workplane ?? defaultWorkplane();
      selection = [];
      groupFacts.clear();
      for (const object of objects) {
        if (object.kind === 'group') requestGroupFacts(object);
      }
      paint();
    },
    exportObjects: () => cloneObjects(objects),
    focus: () => canvas.focus(),
    stop: () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    },
  };
};
