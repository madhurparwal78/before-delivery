import type { VNode } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Scene3D, ShapeObject, Workplane, Primitive, GroupObject } from '../../shared/scene.js';
import type { EditorHandle } from '../pages/editor.js';
import { createContext, drawScene, hexToRgb, meshFor, DEFAULT_CAMERA, type CameraState } from '../gl.js';
import {
  MAX_OBJECTS, SIZE_MIN, SIZE_MAX, newShapeCentre, nextColor, primitiveVolume, triangleCount,
  bboxOfObject, selectionBBox, workplaneAxes, FACE_NAMES, snapNormal, faceOrigin, isGroup,
  round1, round2, fmtNum,
} from '../geometry.js';
import { say } from '../status.js';
import { useDialogA11yWithLanding } from '../pages/classroomDialogs.js';
import { M } from '../copy.js';

interface UndoStep {
  objects: ShapeObject[];
  workplane: Workplane;
  selection: string[];
}

export function Workshop3D(props: {
  snapshot: Scene3D;
  readOnly: boolean;
  markDirty: () => void;
  onHandle: (h: EditorHandle) => void;
  name: string;
  setName: (n: string) => void;
}): VNode {
  const [objects, setObjects] = useState<ShapeObject[]>(props.snapshot.objects);
  const [workplane, setWorkplane] = useState<Workplane>(props.snapshot.workplane);
  const [selection, setSelection] = useState<string[]>([]);
  const [camera, setCamera] = useState<CameraState>({ ...DEFAULT_CAMERA });
  const [rotateMode, setRotateMode] = useState(false);
  const [workplaneTool, setWorkplaneTool] = useState(false);
  const [inspector, setInspector] = useState({ w: '', d: '', h: '' });
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [alignOpen, setAlignOpen] = useState(false);
  const [alignOpener, setAlignOpener] = useState<HTMLElement | null>(null);
  const alignDialogRef = useRef<HTMLDivElement>(null);
  useDialogA11yWithLanding(alignDialogRef, () => { setAlignOpen(false); }, alignOpener, () => true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetOpener, setSheetOpener] = useState<HTMLElement | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupMesh, setGroupMesh] = useState<{ positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null>(null);
  const [groupVolumes, setGroupVolumes] = useState<Map<string, number>>(new Map());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<ReturnType<typeof createContext> | null>(null);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const workplaneRef = useRef(workplane);
  workplaneRef.current = workplane;
  const rotateModeRef = useRef(rotateMode);
  rotateModeRef.current = rotateMode;
  const workplaneToolRef = useRef(workplaneTool);
  workplaneToolRef.current = workplaneTool;
  const colorCounter = useRef(objects.length);
  const undoStack = useRef<UndoStep[]>([]);
  const redoStack = useRef<UndoStep[]>([]);
  const idCounter = useRef(1);
  const dragRef = useRef<{ mode: 'none' | 'orbit' | 'move' | 'pinch'; startX: number; startY: number; lastX: number; lastY: number; moved: boolean }>({ mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false });
  const objectsAtDragStart = useRef<ShapeObject[] | null>(null);
  const pinchRef = useRef<number | null>(null);

  // ---- snapshot sync (kept edits restore, stale-tab loads) ----
  useEffect(() => {
    setObjects(props.snapshot.objects as ShapeObject[]);
    setWorkplane(props.snapshot.workplane);
    colorCounter.current = props.snapshot.objects.length;
  }, [props.snapshot]);

  const snapshotOf = useCallback((): Scene3D => ({
    kind: '3d',
    objects: clone(objectsRef.current).map((o) => ({
      ...o,
      x: round2(o.x), y: round2(o.y), z: round2(o.z),
      w: round1(o.w), d: round1(o.d), h: round1(o.h),
      rotationZ: ((o.rotationZ % 360) + 360) % 360,
    })),
    workplane: {
      origin: [round2(workplaneRef.current.origin[0]), round2(workplaneRef.current.origin[1]), round2(workplaneRef.current.origin[2])],
      normal: workplaneRef.current.normal,
    },
  }), []);

  useEffect(() => {
    props.onHandle({
      getSnapshot: snapshotOf,
      getName: () => props.name,
      setSnapshot: (s) => {
        const scene = s as Scene3D;
        setObjects(scene.objects);
        setWorkplane(scene.workplane);
        colorCounter.current = scene.objects.length;
      },
      markSaved: () => { setObjects(objectsRef.current); },
      isDirty: () => false,
    });
  }, [props.name]);

  // ---- undo ----
  const pushUndo = useCallback((nextObjects: ShapeObject[], nextWorkplane: Workplane, nextSelection: string[]) => {
    undoStack.current.push({ objects: clone(objectsRef.current), workplane: { ...workplaneRef.current }, selection: [...selectionRef.current] });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setObjects(nextObjects);
    setWorkplane(nextWorkplane);
    setSelection(nextSelection);
    objectsRef.current = nextObjects;
    workplaneRef.current = nextWorkplane;
    selectionRef.current = nextSelection;
    props.markDirty();
  }, [props.markDirty]);

  const undo = useCallback(() => {
    const step = undoStack.current.pop();
    if (!step) return;
    redoStack.current.push({ objects: clone(objectsRef.current), workplane: { ...workplaneRef.current }, selection: [...selectionRef.current] });
    setObjects(step.objects); objectsRef.current = step.objects;
    setWorkplane(step.workplane); workplaneRef.current = step.workplane;
    setSelection(step.selection); selectionRef.current = step.selection;
  }, []);

  const redo = useCallback(() => {
    const step = redoStack.current.pop();
    if (!step) return;
    undoStack.current.push({ objects: clone(objectsRef.current), workplane: { ...workplaneRef.current }, selection: [...selectionRef.current] });
    setObjects(step.objects); objectsRef.current = step.objects;
    setWorkplane(step.workplane); workplaneRef.current = step.workplane;
    setSelection(step.selection); selectionRef.current = step.selection;
  }, []);

  // ---- selection helpers ----
  const selectedObjects = useMemo(() => objects.filter((o) => selection.includes(o.id)), [objects, selection]);
  const selectedRef = useRef(selectedObjects);
  selectedRef.current = selectedObjects;

  const updateInspectorFromSelection = useCallback((objs: ShapeObject[]) => {
    if (objs.length === 0) { setInspector({ w: '', d: '', h: '' }); return; }
    const o = objs[objs.length - 1]!;
    setInspector({ w: fmtNum(o.w), d: fmtNum(o.d), h: fmtNum(o.h) });
  }, []);

  useEffect(() => { updateInspectorFromSelection(selectedObjects); }, [selection]);

  // ---- add shape ----
  const addShape = useCallback((kind: 'box' | 'cylinder' | 'sphere') => {
    if (objectsRef.current.length >= MAX_OBJECTS) {
      say(M.objectLimit);
      return;
    }
    const w = 20, d = 20, h = 20;
    const [x, y, z] = newShapeCentre(workplaneRef.current, w, d, h);
    const newObj: Primitive = {
      id: `o${idCounter.current++}-${Date.now().toString(36)}`,
      kind, mode: 'solid', x, y, z, w, d, h, rotationZ: 0,
      color: nextColor(colorCounter.current++), children: [],
    };
    pushUndo([...objectsRef.current, newObj], workplaneRef.current, [newObj.id]);
  }, [pushUndo]);

  // ---- transforms ----
  const moveSelection = useCallback((dx: number, dy: number, dz: number) => {
    if (selectionRef.current.length === 0) return;
    const next = objectsRef.current.map((o) =>
      selectionRef.current.includes(o.id) ? { ...o, x: o.x + dx, y: o.y + dy, z: o.z + dz } : o);
    pushUndo(next, workplaneRef.current, selectionRef.current);
  }, [pushUndo]);

  const rotateSelection = useCallback((deg: number) => {
    if (selectionRef.current.length === 0) return;
    const next = objectsRef.current.map((o): ShapeObject =>
      selectionRef.current.includes(o.id) ? { ...o, rotationZ: ((o.rotationZ + deg) % 360 + 360) % 360 } : o);
    pushUndo(next, workplaneRef.current, selectionRef.current);
  }, [pushUndo]);

  const toggleMode = useCallback(() => {
    if (selectionRef.current.length === 0) return;
    const next = objectsRef.current.map((o): ShapeObject =>
      selectionRef.current.includes(o.id) ? { ...o, mode: o.mode === 'solid' ? 'hole' as const : 'solid' as const } : o);
    pushUndo(next, workplaneRef.current, selectionRef.current);
  }, [pushUndo]);

  const deleteSelection = useCallback(() => {
    if (selectionRef.current.length === 0) return;
    const next = objectsRef.current.filter((o) => !selectionRef.current.includes(o.id));
    pushUndo(next, workplaneRef.current, []);
  }, [pushUndo]);

  // ---- grouping (Web Worker with manifold) ----
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker('/assets/geometryWorker.js');
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type: 'grouped'; positions: Float32Array; normals: Float32Array; indices: Uint32Array; volume: number; bbox: { min: number[]; max: number[] }; children: ShapeObject[]; color: string; mode: 'solid' | 'hole' }
        | { type: 'error'; message: string };
      setGrouping(false);
      if (data.type === 'error') { say(data.message); return; }
      setGroupMesh({ positions: data.positions, normals: data.normals, indices: data.indices });
      const bb = data.bbox;
      const cx = (bb.min[0]! + bb.max[0]!) / 2;
      const cy = (bb.min[1]! + bb.max[1]!) / 2;
      const cz = (bb.min[2]! + bb.max[2]!) / 2;
      const group: GroupObject = {
        id: `g${idCounter.current++}-${Date.now().toString(36)}`,
        kind: 'group', mode: data.mode, x: round2(cx), y: round2(cy), z: round2(cz),
        w: round1(bb.max[0]! - bb.min[0]!), d: round1(bb.max[1]! - bb.min[1]!), h: round1(bb.max[2]! - bb.min[2]!),
        rotationZ: 0, color: data.color, children: data.children,
      };
      const next = [...objectsRef.current.filter((o) => !selectionRef.current.includes(o.id)), group];
      setGroupVolumes((m) => { const copy = new Map(m); copy.set(group.id, Math.round(data.volume)); return copy; });
      say(M.grouped(data.children.length));
      pushUndo(next, workplaneRef.current, [group.id]);
    };
    return () => { worker.terminate(); };
  }, [pushUndo]);

  const doGroup = useCallback(() => {
    const sel = selectedRef.current;
    if (sel.length < 2) { say(M.selectTwo); return; }
    if (!sel.some((o) => o.mode === 'solid')) { say(M.groupNeedsSolid); return; }
    setGrouping(true);
    say(M.grouping);
    workerRef.current?.postMessage({ objects: sel });
  }, []);

  const doUngroup = useCallback(() => {
    const sel = selectedRef.current;
    if (sel.length === 0) return;
    const groups = sel.filter(isGroup);
    if (groups.length === 0) { say(M.selectTwo); return; }
    let next = [...objectsRef.current];
    const newIds: string[] = [];
    for (const g of groups) {
      const index = next.findIndex((o) => o.id === g.id);
      if (index === -1) continue;
      next.splice(index, 1, ...g.children);
      newIds.push(...g.children.map((c) => c.id));
    }
    say(M.ungrouped(groups.length));
    pushUndo(next, workplaneRef.current, newIds);
  }, [pushUndo]);

  // ---- align ----
  const alignOn = useCallback((axis: 'x' | 'y' | 'z') => {
    const sel = selectedRef.current;
    if (sel.length < 2) { say(M.selectTwo); return; }
    const bb = selectionBBox(sel);
    if (!bb) return;
    const centre = (axis === 'x' ? bb.min[0] + bb.max[0] : axis === 'y' ? bb.min[1] + bb.max[1] : bb.min[2] + bb.max[2]) / 2;
    const next = objectsRef.current.map((o): ShapeObject => {
      if (!selectionRef.current.includes(o.id)) return o;
      if (axis === 'x') return { ...o, x: centre };
      if (axis === 'y') return { ...o, y: centre };
      return { ...o, z: centre };
    });
    say(M.aligned(sel.length, axis.toUpperCase()));
    pushUndo(next, workplaneRef.current, selectionRef.current);
    setAlignOpen(false);
    setTimeout(() => alignOpener?.focus(), 0);
  }, [pushUndo, alignOpener]);

  // ---- workplane tool ----
  const pickFace = useCallback((obj: ShapeObject | null) => {
    const target = obj ?? selectedRef.current[selectedRef.current.length - 1] ?? null;
    if (!target) return;
    // Enter with an object selected picks its top face.
    const normal = snapNormal([0, 0, 1]);
    const origin = faceOrigin(target, normal);
    const faceName = FACE_NAMES[normal.join(',')]!;
    setWorkplaneTool(false);
    pushUndo(objectsRef.current, { origin, normal }, selectionRef.current);
    say(M.workplaneSet(faceName));
  }, [pushUndo]);

  // ---- keyboard ----
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      return node !== null && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (props.readOnly) return;
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const axes = workplaneAxes(workplaneRef.current.normal);
      const step = e.shiftKey ? 10 : 1;

      if (mod && key.toLowerCase() === 's') { e.preventDefault(); return; }
      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(objectsRef.current.map((o) => o.id));
        return;
      }
      if (mod && key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) doUngroup(); else doGroup();
        return;
      }
      if (rotateModeRef.current && (key === 'ArrowRight' || key === 'ArrowLeft')) {
        e.preventDefault();
        rotateSelection(key === 'ArrowRight' ? (e.shiftKey ? 1 : 15) : (e.shiftKey ? -1 : -15));
        return;
      }
      if (key.startsWith('Arrow') || key === 'PageUp' || key === 'PageDown') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        if (key === 'ArrowRight') moveSelection(axes.xDir[0] * step, axes.xDir[1] * step, axes.xDir[2] * step);
        else if (key === 'ArrowLeft') moveSelection(-axes.xDir[0] * step, -axes.xDir[1] * step, -axes.xDir[2] * step);
        else if (key === 'ArrowUp') moveSelection(axes.yDir[0] * step, axes.yDir[1] * step, axes.yDir[2] * step);
        else if (key === 'ArrowDown') moveSelection(-axes.yDir[0] * step, -axes.yDir[1] * step, -axes.yDir[2] * step);
        else if (key === 'PageUp') moveSelection(workplaneRef.current.normal[0] * step, workplaneRef.current.normal[1] * step, workplaneRef.current.normal[2] * step);
        else moveSelection(-workplaneRef.current.normal[0] * step, -workplaneRef.current.normal[1] * step, -workplaneRef.current.normal[2] * step);
        return;
      }
      switch (key.toLowerCase()) {
        case 'b': addShape('box'); break;
        case 'c': addShape('cylinder'); break;
        case 's': addShape('sphere'); break;
        case 'h': toggleMode(); break;
        case 'l': {
          if (selectedRef.current.length < 2) { say(M.selectTwo); break; }
          setAlignOpener(document.activeElement as HTMLElement | null);
          setAlignOpen(true);
          break;
        }
        case 'w':
          setWorkplaneTool(true);
          say(M.pickFace);
          break;
        case 'r':
          setRotateMode(true);
          break;
        case 'delete':
        case 'backspace':
          deleteSelection();
          break;
        default:
          if (key === 'Enter') {
            if (workplaneToolRef.current) { pickFace(null); break; }
            if (rotateModeRef.current) setRotateMode(false);
          } else if (key === 'Escape') {
            if (workplaneToolRef.current) setWorkplaneTool(false);
            else if (rotateModeRef.current) setRotateMode(false);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addShape, toggleMode, deleteSelection, moveSelection, rotateSelection, doGroup, doUngroup, undo, redo, pickFace, props.readOnly]);

  // ---- pointer and touch ----
  const pickObjectAt = useCallback((clientX: number, clientY: number): ShapeObject | null => {
    // Project each object's bbox to screen; pick the nearest hit.
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const proj = projectCamera(cam, rect.width, rect.height);
    let best: ShapeObject | null = null;
    let bestDepth = Infinity;
    for (const o of objectsRef.current) {
      const bb = bboxOfObject(o);
      if (projectPoint(bb.min, proj) === null) continue;
      const depth = Math.hypot((bb.min[0] + bb.max[0]) / 2 - cam.target[0], (bb.min[1] + bb.max[1]) / 2 - cam.target[1], (bb.min[2] + bb.max[2]) / 2 - cam.target[2]);
      void depth;
      // Simple screen-space centre distance test against the projected centre.
      const centreScreen = projectPoint([(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2], proj);
      if (centreScreen) {
        const dist = Math.hypot(centreScreen.x - (clientX - rect.left), centreScreen.y - (clientY - rect.top));
        const maxDist = 60;
        if (dist < maxDist && depth < bestDepth) {
          if (dist < 60) { best = o; bestDepth = depth; }
        }
      }
    }
    return best;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    glRef.current = createContext(canvas);

    const onPointerDown = (e: PointerEvent) => {
      if (props.readOnly) return;
      dragRef.current = { mode: 'none', startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      const hit = pickObjectAt(e.clientX, e.clientY);
      if (workplaneRef.current && workplaneTool) {
        if (hit) { pickFace(hit); return; }
      }
      if (hit) {
        if (e.shiftKey) {
          setSelection((sel) => sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id]);
        } else if (!selectionRef.current.includes(hit.id)) {
          setSelection([hit.id]);
        }
        dragRef.current.mode = 'move';
        objectsAtDragStart.current = clone(objectsRef.current);
      } else {
        if (!e.shiftKey) setSelection([]);
        dragRef.current.mode = 'orbit';
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d.mode === 'none') return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 2) d.moved = true;
      if (d.mode === 'orbit') {
        setCamera((c) => ({ ...c, azimuth: norm360(c.azimuth - dx / 2), elevation: clamp(c.elevation + dy * 0.25, 5, 85) }));
      } else if (d.mode === 'move' && selectionRef.current.length > 0) {
        const axes = workplaneAxes(workplaneRef.current.normal);
        // world mm per screen px at the target distance
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scale = (2 * cameraRef.current.distance * Math.tan((20 * Math.PI) / 180)) / Math.max(1, rect.height);
        const wx = (dx * axes.xDir[0] + dy * axes.yDir[0]) * scale;
        const wy = (dx * axes.xDir[1] + dy * axes.yDir[1]) * scale;
        const wz = (dx * axes.xDir[2] + dy * axes.yDir[2]) * scale;
        const next = objectsRef.current.map((o): ShapeObject =>
          selectionRef.current.includes(o.id) ? { ...o, x: o.x + wx, y: o.y + wy, z: o.z + wz } : o);
        setObjects(next);
        objectsRef.current = next;
      }
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      if (d.mode === 'move' && d.moved) {
        // A pointer drag that moved the selection is one undo step.
        undoStack.current.push({ objects: clone(objectsAtDragStart.current ?? objectsRef.current), workplane: { ...workplaneRef.current }, selection: [...selectionRef.current] });
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
        props.markDirty();
      }
      dragRef.current = { mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCamera((c) => ({ ...c, distance: clamp(c.distance * (1 + e.deltaY / 400), 20, 2000) }));
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [pickObjectAt, pickFace, props.markDirty, props.readOnly]);

  // touch pinch
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const touches = new Map<number, { x: number; y: number }>();
    const updateDist = () => {
      const list = [...touches.values()];
      if (list.length === 2) {
        const d = Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y);
        if (pinchRef.current !== null) {
          const factor = pinchRef.current / Math.max(1, d);
          setCamera((c) => ({ ...c, distance: clamp(c.distance * factor, 20, 2000) }));
        }
        pinchRef.current = d;
      } else {
        pinchRef.current = null;
      }
    };
    const onStart = (e: TouchEvent) => {
      for (const t of [...e.touches]) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      updateDist();
    };
    const onMove = (e: TouchEvent) => {
      for (const t of [...e.touches]) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      updateDist();
    };
    const onEnd = (e: TouchEvent) => {
      for (const t of [...e.changedTouches]) touches.delete(t.identifier);
      updateDist();
    };
    canvas.addEventListener('touchstart', onStart, { passive: true });
    canvas.addEventListener('touchmove', onMove, { passive: true });
    canvas.addEventListener('touchend', onEnd, { passive: true });
    canvas.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = glRef.current;
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const items = objectsRef.current.map((o) => {
        if (isGroup(o)) {
          return groupMesh && selectionRef.current.includes(o.id)
            ? { mesh: groupMesh, x: o.x, y: o.y, z: o.z, color: hexToRgb(o.color), mode: o.mode }
            : null;
        }
        return {
          mesh: meshFor(o.kind, o.w, o.d, o.h, o.rotationZ),
          x: o.x, y: o.y, z: o.z,
          color: hexToRgb(o.color),
          mode: o.mode,
        };
      }).filter(Boolean) as { mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array }; x: number; y: number; z: number; color: [number, number, number]; mode: 'solid' | 'hole' }[];
      drawScene(ctx, items, { ...cameraRef.current, target: [0, 0, 10] }, [0.956, 0.973, 0.996, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [groupMesh]);

  // hidden state element
  const totalVolume = Math.round(objects.reduce((sum, o) => o.mode === 'solid' && !isGroup(o) ? sum + primitiveVolume(o.kind, o.w, o.d, o.h) : sum + (o.mode === 'solid' && isGroup(o) ? groupVolumeOf(o) : 0), 0));
  const triTotal = objects.reduce((sum, o) => sum + (isGroup(o) ? (groupMesh ? (groupMesh.indices.length / 3) : 0) : triangleCount(o.kind)), 0);

  return (
    <>
      <div class="panel toolbar-col" style="width:190px">
        <h2 id="shapes-heading">Shapes</h2>
        <div class="tool-row" role="toolbar" aria-labelledby="shapes-heading">
          <button class="btn" aria-label="Box" onClick={() => addShape('box')} disabled={props.readOnly}>Box</button>
          <button class="btn" aria-label="Cylinder" onClick={() => addShape('cylinder')} disabled={props.readOnly}>Cylinder</button>
          <button class="btn" aria-label="Sphere" onClick={() => addShape('sphere')} disabled={props.readOnly}>Sphere</button>
        </div>
        <h2 style="margin-top:16px">Edit</h2>
        <div class="tool-row">
          <button class="btn" aria-pressed={selectedObjects.some((o) => o.mode === 'solid')} aria-label="Solid" onClick={() => { if (selectedObjects.length) { const next = objects.map((o) => selection.includes(o.id) ? { ...o, mode: 'solid' as const } : o); pushUndo(next, workplane, selection); } }} disabled={props.readOnly}>Solid</button>
          <button class="btn" aria-pressed={selectedObjects.some((o) => o.mode === 'hole')} aria-label="Hole" onClick={() => { if (selectedObjects.length) { const next = objects.map((o) => selection.includes(o.id) ? { ...o, mode: 'hole' as const } : o); pushUndo(next, workplane, selection); } }} disabled={props.readOnly}>Hole</button>
          <button class="btn" aria-label="Group" onClick={() => doGroup()} disabled={grouping || props.readOnly}>{grouping ? 'Grouping…' : 'Group'}</button>
          <button class="btn" aria-label="Ungroup" onClick={() => doUngroup()} disabled={props.readOnly}>Ungroup</button>
          <button class="btn" aria-label="Align" onClick={(e) => { if (selectedObjects.length < 2) { say(M.selectTwo); return; } setAlignOpener(e.currentTarget as HTMLElement); setAlignOpen(true); }} disabled={props.readOnly}>Align</button>
          <button class="btn" aria-label="Workplane" aria-pressed={workplaneTool} onClick={() => { setWorkplaneTool(!workplaneTool); if (!workplaneTool) say(M.pickFace); }} disabled={props.readOnly}>Workplane</button>
          <button class="btn" aria-label="Reset workplane" onClick={() => { pushUndo(objects, { origin: [0, 0, 0], normal: [0, 0, 1] }, selection); say(M.workplaneReset); }} disabled={props.readOnly}>Reset workplane</button>
          <button class="btn" aria-label="Delete" onClick={() => deleteSelection()} disabled={props.readOnly}>Delete</button>
        </div>
      </div>

      <div class="workbench">
        <canvas
          ref={canvasRef}
          role="application"
          aria-label="3D workplane"
          tabIndex={0}
        />
      </div>

      <div class="panel" style="width:250px" role="region" aria-label="Inspector">
        <h2>Inspector</h2>
        {selectedObjects.length > 0 && (
          <>
            <div class="field">
              <label htmlFor="ins-w">Width (mm)</label>
              <input id="ins-w" value={inspector.w} disabled={props.readOnly}
                onInput={(e) => setInspector((v) => ({ ...v, w: (e.target as HTMLInputElement).value }))}
                onBlur={() => commitSize('w')}
                onKeyDown={(e) => { if (e.key === 'Enter') commitSize('w'); }}
                aria-describedby={sizeError ? 'size-err' : undefined} />
            </div>
            <div class="field">
              <label htmlFor="ins-d">Depth (mm)</label>
              <input id="ins-d" value={inspector.d} disabled={props.readOnly}
                onInput={(e) => setInspector((v) => ({ ...v, d: (e.target as HTMLInputElement).value }))}
                onBlur={() => commitSize('d')}
                onKeyDown={(e) => { if (e.key === 'Enter') commitSize('d'); }} />
            </div>
            <div class="field">
              <label htmlFor="ins-h">Height (mm)</label>
              <input id="ins-h" value={inspector.h} disabled={props.readOnly}
                onInput={(e) => setInspector((v) => ({ ...v, h: (e.target as HTMLInputElement).value }))}
                onBlur={() => commitSize('h')}
                onKeyDown={(e) => { if (e.key === 'Enter') commitSize('h'); }} />
            </div>
            {sizeError && <span class="err" id="size-err" role="alert">{sizeError}</span>}
          </>
        )}
        <p style="color:var(--slate);font-size:0.9rem">
          Workplane {FACE_NAMES[workplane.normal.join(',')] ?? 'top'} face<br />
          Origin {workplane.origin.map((v) => fmtNum(v)).join(', ')}
        </p>
        {rotateMode && <p><strong>Rotate mode</strong> — arrows turn the selection</p>}
        {workplaneTool && <p><strong>Workplane tool</strong> — press Enter for the selected shape's top</p>}
      </div>

      {/* hidden state */}
      <div
        id="qy-scene"
        class="qy-hidden"
        aria-hidden="true"
        data-mesh-count={objects.length}
        data-total-volume={totalVolume}
        data-triangle-count={triTotal}
        data-selected={selection.join(',')}
        data-workplane-normal={workplane.normal.join(',')}
        data-workplane-origin={workplane.origin.join(',')}
        data-camera-azimuth={Math.round(((camera.azimuth % 360) + 360) % 360)}
        data-camera-distance={camera.distance.toFixed(1)}
      >
        {objects.map((o) => (
          <div
            key={o.id}
            data-object-id={o.id}
            data-kind={o.kind}
            data-mode={o.mode}
            data-x={fmtNum(o.x)}
            data-y={fmtNum(o.y)}
            data-z={fmtNum(o.z)}
            data-w={fmtNum(o.w)}
            data-d={fmtNum(o.d)}
            data-h={fmtNum(o.h)}
            data-rotation-z={Math.round(((o.rotationZ % 360) + 360) % 360)}
            data-volume={Math.round(isGroup(o) ? groupVolumeOf(o) : primitiveVolume(o.kind, o.w, o.d, o.h))}
          />
        ))}
      </div>

      {alignOpen && (
        <div class="overlay" role="dialog" aria-modal="true" aria-label="Align" ref={alignDialogRef}>
          <div class="dialog">
            <h2>Align</h2>
            <div style="display:flex;flex-direction:column;gap:10px">
              <button class="btn" onClick={() => alignOn('x')}>Align centers on X</button>
              <button class="btn" onClick={() => alignOn('y')}>Align centers on Y</button>
              <button class="btn" onClick={() => alignOn('z')}>Align centers on Z</button>
            </div>
            <div class="row">
              <button class="pill ghost" onClick={() => { setAlignOpen(false); setTimeout(() => alignOpener?.focus(), 0); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* narrow phone bottom sheet */}
      <button class="btn narrow-only" style="position:fixed;right:14px;bottom:14px;z-index:50" aria-label="Shapes" onClick={(e) => { setSheetOpener(e.currentTarget as HTMLElement); setSheetOpen(true); }}>Shapes</button>
      {sheetOpen && (
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Shapes">
          <h2>Shapes</h2>
          <div class="shapes">
            <button class="btn" aria-label="Box" onClick={() => { addShape('box'); setSheetOpen(false); setTimeout(() => sheetOpener?.focus(), 0); }}>Box</button>
            <button class="btn" aria-label="Cylinder" onClick={() => { addShape('cylinder'); setSheetOpen(false); setTimeout(() => sheetOpener?.focus(), 0); }}>Cylinder</button>
            <button class="btn" aria-label="Sphere" onClick={() => { addShape('sphere'); setSheetOpen(false); setTimeout(() => sheetOpener?.focus(), 0); }}>Sphere</button>
          </div>
          <div class="row"><button class="pill ghost" onClick={() => { setSheetOpen(false); setTimeout(() => sheetOpener?.focus(), 0); }}>Close</button></div>
        </div>
      )}
    </>
  );

  function commitSize(field: 'w' | 'd' | 'h'): void {
    const sel = selectedObjects[selectedObjects.length - 1];
    if (!sel) return;
    const value = parseFloat(inspector[field]);
    if (Number.isNaN(value) || value < SIZE_MIN || value > SIZE_MAX) {
      setSizeError(M.sizeRange);
      setInspector((v) => ({ ...v, [field]: fmtNum(sel[field]) }));
      say(M.sizeRange);
      return;
    }
    setSizeError(null);
    let w = round1(field === 'w' ? value : sel.w);
    let d = round1(field === 'd' ? value : sel.d);
    const h = round1(field === 'h' ? value : sel.h);
    if (sel.kind === 'cylinder') {
      if (field === 'w' || field === 'd') { w = round1(value); d = round1(value); }
    }
    if (sel.kind === 'sphere') {
      const v = round1(value);
      w = v; d = v;
    }
    // keep the bottom-centre fixed
    const next = objects.map((o) => {
      if (o.id !== sel.id) return o;
      const bottomZ = o.z - o.h / 2;
      return { ...o, w, d, h, z: round2(bottomZ + h / 2) };
    });
    pushUndo(next, workplane, selection);
  }

  function groupVolumeOf(g: GroupObject): number {
    // The worker's computed mesh volume is authoritative; the analytic
    // difference is only a stand-in before a group has been computed.
    const computed = groupVolumes.get(g.id);
    if (computed !== undefined) return computed;
    let solid = 0;
    let hole = 0;
    for (const c of g.children) {
      const v = primitiveVolume(c.kind, c.w, c.d, c.h);
      if (c.mode === 'solid') solid += v; else hole += v;
    }
    return Math.max(0, solid - hole);
  }
}

function clone(objects: ShapeObject[]): ShapeObject[] {
  return objects.map((o) => ({ ...o }));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function norm360(v: number): number {
  return ((v % 360) + 360) % 360;
}

interface Proj { view: Float32Array; proj: Float32Array; w: number; h: number }

function projectCamera(cam: CameraState, w: number, h: number): Proj {
  const { lookAt, perspective } = glHelpers;
  return { view: lookAt(cam), proj: perspective(40, w / h), w, h };
}

const glHelpers = {
  lookAt: (cam: CameraState) => {
    // re-import to avoid circular init: implemented inline matching gl.ts
    const az = (cam.azimuth * Math.PI) / 180;
    const el = (cam.elevation * Math.PI) / 180;
    const eyeX = cam.target[0] + cam.distance * Math.cos(el) * Math.sin(az);
    const eyeY = cam.target[1] - cam.distance * Math.cos(el) * Math.cos(az);
    const eyeZ = cam.target[2] + cam.distance * Math.sin(el);
    const f = norm3([cam.target[0] - eyeX, cam.target[1] - eyeY, cam.target[2] - eyeZ]);
    const s = norm3(cross(f, [0, 0, 1]));
    const u = cross(s, f);
    return new Float32Array([
      s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0,
      -(s[0] * eyeX + s[1] * eyeY + s[2] * eyeZ), -(u[0] * eyeX + u[1] * eyeY + u[2] * eyeZ), (f[0] * eyeX + f[1] * eyeY + f[2] * eyeZ), 1,
    ]);
  },
  perspective: (fovyDeg: number, aspect: number) => {
    let fovy = (fovyDeg * Math.PI) / 180;
    if (aspect < 1) fovy = 2 * Math.atan(Math.tan(fovy / 2) / aspect);
    const f = 1 / Math.tan(fovy / 2);
    const near = 1, far = 5000;
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (far - near), 1, 0, 0, (2 * far * near) / (near - far), 0]);
  },
};

function projectPoint(p: [number, number, number], proj: Proj): { x: number; y: number } | null {
  const [x, y, z] = p;
  const v = proj.view;
  const wx = v[0]! * x + v[4]! * y + v[8]! * z + v[12]!;
  const wy = v[1]! * x + v[5]! * y + v[9]! * z + v[13]!;
  const wz = v[2]! * x + v[6]! * y + v[10]! * z + v[14]! + 1;
  const m = proj.proj;
  const cx = m[0]! * wx;
  const cy = m[5]! * wy;
  const cw = m[11]! * wz;
  if (cw === 0) return null;
  return { x: (cx / cw * 0.5 + 0.5) * proj.w, y: (0.5 - cy / cw * 0.5) * proj.h };
}

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
