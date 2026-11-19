import type { VNode } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { BlocksSnapshot, ProgramBlock, ShapeObject } from '../../shared/scene.js';
import type { EditorHandle } from '../pages/editor.js';
import { say } from '../status.js';
import { M } from '../copy.js';
import { createContext, drawScene, hexToRgb, meshFor, type CameraState } from '../gl.js';
import { primitiveVolume, round2 } from '../geometry.js';
import { useReducedMotion } from '../pages/landing.js';

const MOVE_MIN = -500, MOVE_MAX = 500;
const REPEAT_MIN = 1, REPEAT_MAX = 50;
const STEP_LIMIT = 500;

export function BlockLab(props: {
  snapshot: BlocksSnapshot;
  readOnly: boolean;
  markDirty: () => void;
  onHandle: (h: EditorHandle) => void;
  name: string;
  setName: (n: string) => void;
  stepMs: number;
}): VNode {
  const [program, setProgram] = useState<ProgramBlock[]>(props.snapshot.program);
  const [objects, setObjects] = useState<ShapeObject[]>(props.snapshot.objects);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [insertPath, setInsertPath] = useState<string>('end');

  const programRef = useRef(program);
  programRef.current = program;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const runningRef = useRef(running);
  runningRef.current = running;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<ReturnType<typeof createContext> | null>(null);
  const stopRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const undoStack = useRef<{ program: ProgramBlock[]; objects: ShapeObject[] }[]>([]);
  const redoStack = useRef<{ program: ProgramBlock[]; objects: ShapeObject[] }[]>([]);
  const objCounter = useRef(1);
  const reduced = useReducedMotion();

  useEffect(() => {
    setProgram(props.snapshot.program);
    setObjects(props.snapshot.objects);
  }, [props.snapshot]);

  const snapshotOf = useCallback((): BlocksSnapshot => ({
    kind: 'blocks',
    program: cloneProgram(programRef.current),
    objects: objectsRef.current,
  }), []);

  useEffect(() => {
    props.onHandle({
      getSnapshot: snapshotOf,
      getName: () => props.name,
      setSnapshot: (s) => {
        const snap = s as BlocksSnapshot;
        setProgram(snap.program);
        setObjects(snap.objects);
      },
      markSaved: () => {},
      isDirty: () => false,
    });
  }, [props.name]);

  const pushUndo = (nextProgram: ProgramBlock[], nextObjects: ShapeObject[]) => {
    undoStack.current.push({ program: cloneProgram(programRef.current), objects: [...objectsRef.current] });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setProgram(nextProgram);
    setObjects(nextObjects);
    programRef.current = nextProgram;
    objectsRef.current = nextObjects;
    props.markDirty();
  };

  const undo = () => {
    const s = undoStack.current.pop();
    if (!s) return;
    redoStack.current.push({ program: cloneProgram(programRef.current), objects: [...objectsRef.current] });
    setProgram(s.program); programRef.current = s.program;
    setObjects(s.objects); objectsRef.current = s.objects;
  };

  const redo = () => {
    const s = redoStack.current.pop();
    if (!s) return;
    undoStack.current.push({ program: cloneProgram(programRef.current), objects: [...objectsRef.current] });
    setProgram(s.program); programRef.current = s.program;
    setObjects(s.objects); objectsRef.current = s.objects;
  };

  // Insert a palette block at the insertion point.
  const insertBlock = (name: string) => {
    if (runningRef.current) return;
    let block: ProgramBlock;
    switch (name) {
      case 'addBox': block = { block: 'addBox' }; break;
      case 'addCylinder': block = { block: 'addCylinder' }; break;
      case 'addSphere': block = { block: 'addSphere' }; break;
      case 'makeHole': block = { block: 'makeHole' }; break;
      case 'moveX': block = { block: 'moveX', mm: 10 }; break;
      case 'moveY': block = { block: 'moveY', mm: 10 }; break;
      case 'moveZ': block = { block: 'moveZ', mm: 10 }; break;
      default: block = { block: 'repeat', count: 3, body: [] }; break;
    }
    const next = cloneProgram(programRef.current);
    insertAt(next, insertPath, block);
    pushUndo(next, objectsRef.current);
    // Move the insertion point just after the new block.
    setInsertPath(advanceInsertPath(next, insertPath));
  };

  function insertAt(list: ProgramBlock[], path: string, block: ProgramBlock): void {
    if (path === 'end' || path === '') { list.push(block); return; }
    const parts = path.split('/');
    const idx = parseInt(parts[0]!, 10);
    if (parts.length === 1) { list.splice(idx, 0, block); return; }
    const host = list[idx];
    if (host && host.block === 'repeat') insertAt(host.body, parts.slice(1).join('/'), block);
  }

  function advanceInsertPath(list: ProgramBlock[], path: string): string {
    if (path === 'end' || path === '') return `end`;
    const parts = path.split('/');
    const idx = parseInt(parts[0]!, 10);
    if (parts.length === 1) return `${idx + 1 < list.length ? idx + 1 : 'end'}`;
    const host = list[idx];
    if (host && host.block === 'repeat') return `${idx}/${advanceInsertPath(host.body, parts.slice(1).join('/'))}`;
    return 'end';
  }

  const deleteBlock = (path: string) => {
    const next = cloneProgram(programRef.current);
    removeAt(next, path);
    pushUndo(next, objectsRef.current);
  };

  function removeAt(list: ProgramBlock[], path: string): void {
    const parts = path.split('/');
    const idx = parseInt(parts[0]!, 10);
    if (Number.isNaN(idx)) return;
    if (parts.length === 1) { list.splice(idx, 1); return; }
    const host = list[idx];
    if (host && host.block === 'repeat') removeAt(host.body, parts.slice(1).join('/'));
  }

  const setField = (path: string, field: 'mm' | 'count', value: number) => {
    const next = cloneProgram(programRef.current);
    const target = findAt(next, path);
    if (!target) return;
    if (target.block === 'repeat' && field === 'count') {
      target.count = Math.min(REPEAT_MAX, Math.max(REPEAT_MIN, Math.round(value)));
    } else if ((target.block === 'moveX' || target.block === 'moveY' || target.block === 'moveZ') && field === 'mm') {
      target.mm = Math.min(MOVE_MAX, Math.max(MOVE_MIN, value));
    }
    setProgram(next);
    programRef.current = next;
    props.markDirty();
  };

  function findAt(list: ProgramBlock[], path: string): ProgramBlock | null {
    const parts = path.split('/');
    const idx = parseInt(parts[0]!, 10);
    if (Number.isNaN(idx) || list[idx] === undefined) return null;
    if (parts.length === 1) return list[idx]!;
    const host = list[idx]!;
    if (host.block === 'repeat') return findAt(host.body, parts.slice(1).join('/'));
    return null;
  }

  // ---- program runner ----
  interface FlatStep { kind: 'add' | 'move' | 'hole'; shapeKind?: 'box' | 'cylinder' | 'sphere'; axis?: 'x' | 'y' | 'z'; mm?: number }

  function flatten(list: ProgramBlock[], out: FlatStep[]): void {
    for (const b of list) {
      if (b.block === 'repeat') {
        for (let i = 0; i < b.count; i++) flatten(b.body, out);
      } else if (b.block === 'addBox') out.push({ kind: 'add', shapeKind: 'box' });
      else if (b.block === 'addCylinder') out.push({ kind: 'add', shapeKind: 'cylinder' });
      else if (b.block === 'addSphere') out.push({ kind: 'add', shapeKind: 'sphere' });
      else if (b.block === 'makeHole') out.push({ kind: 'hole' });
      else out.push({ kind: 'move', axis: b.block === 'moveX' ? 'x' : b.block === 'moveY' ? 'y' : 'z', mm: b.block === 'moveX' || b.block === 'moveY' || b.block === 'moveZ' ? b.mm : 0 });
    }
  }

  const play = () => {
    if (runningRef.current) return;
    const steps: FlatStep[] = [];
    flatten(programRef.current, steps);
    const limited = steps.slice(0, STEP_LIMIT);
    const hitLimit = steps.length > STEP_LIMIT;

    const runSteps = (list: FlatStep[]): ShapeObject[] => {
      const out: ShapeObject[] = [];
      const cursor = { x: 0, y: 0, z: 0 };
      for (const s of list) {
        if (s.kind === 'add') {
          out.push({
            id: `s${objCounter.current++}`,
            kind: s.shapeKind!,
            mode: 'solid',
            x: round2(cursor.x), y: round2(cursor.y), z: round2(cursor.z),
            w: 20, d: 20, h: 20, rotationZ: 0,
            color: ['#4caf50', '#9c27b0', '#ff9800'][out.length % 3]!,
            children: [],
          } as ShapeObject);
        } else if (s.kind === 'move') {
          cursor[s.axis!] += s.mm ?? 10;
        } else if (s.kind === 'hole' && out.length > 0) {
          const last = out[out.length - 1]!;
          out[out.length - 1] = { ...last, mode: 'hole' };
        }
      }
      return out;
    };

    if (reduced) {
      // Reduced motion: run at once and show the end state.
      const result = runSteps(limited);
      pushUndo(programRef.current, result);
      setStep(limited.length);
      setRunning(true);
      setTimeout(() => {
        setRunning(false);
        if (hitLimit) say(M.programLimit);
        else say(M.programFinished(result.length));
      }, 0);
      return;
    }

    setRunning(true);
    setStep(0);
    const result: ShapeObject[] = [];
    const cursor = { x: 0, y: 0, z: 0 };
    let i = 0;
    stopRef.current = false;
    const runNext = () => {
      if (stopRef.current) return;
      if (i >= limited.length) {
        setRunning(false);
        if (hitLimit) say(M.programLimit);
        else say(M.programFinished(result.length));
        pushUndo(programRef.current, result);
        return;
      }
      const s = limited[i]!;
      if (s.kind === 'add') {
        result.push({
          id: `s${objCounter.current++}`,
          kind: s.shapeKind!,
          mode: 'solid',
          x: round2(cursor.x), y: round2(cursor.y), z: round2(cursor.z),
          w: 20, d: 20, h: 20, rotationZ: 0,
          color: ['#4caf50', '#9c27b0', '#ff9800'][result.length % 3]!,
          children: [],
        } as ShapeObject);
      } else if (s.kind === 'move') {
        cursor[s.axis!] += s.mm ?? 10;
      } else if (s.kind === 'hole' && result.length > 0) {
        const last = result[result.length - 1]!;
        result[result.length - 1] = { ...last, mode: 'hole' };
      }
      setObjects([...result]);
      objectsRef.current = result;
      i++;
      setStep(i);
      timersRef.current.push(setTimeout(runNext, props.stepMs));
    };
    timersRef.current.push(setTimeout(runNext, props.stepMs));
  };

  const stop = () => {
    stopRef.current = true;
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    setRunning(false);
    say(M.programStopped);
  };

  useEffect(() => () => { for (const t of timersRef.current) clearTimeout(t); }, []);

  // keyboard for the Program list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const node = e.target as HTMLElement | null;
      if (node && (node.tagName === 'INPUT' || node.isContentEditable)) return;
      if (e.key === 'Enter') {
        const listbox = document.querySelector('[role="listbox"][aria-label="Program"]');
        if (listbox && listbox.contains(document.activeElement)) {
          const name = (document.activeElement as HTMLElement).dataset.blockName;
          if (name && !runningRef.current) insertBlock(name);
        }
        return;
      }
      if (runningRef.current) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[data-block-path]'));
        const current = items.findIndex((it) => it === document.activeElement?.closest('[data-block-path]'));
        const next = current + (e.key === 'ArrowDown' ? 1 : -1);
        if (next >= 0 && next < items.length) { e.preventDefault(); items[next]!.focus(); setFocusIndex(next); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement?.closest<HTMLElement>('[data-block-path]');
        const path = active?.dataset.blockPath;
        if (path) { e.preventDefault(); deleteBlock(path); }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const active = document.activeElement?.closest<HTMLElement>('[data-block-path]');
        const path = active?.dataset.blockPath;
        if (!path) return;
        e.preventDefault();
        if (e.key === 'ArrowRight') {
          // move insertion point into this repeat's body end
          const target = findAt(programRef.current, path);
          if (target && target.block === 'repeat') setInsertPath(`${path}/${target.body.length}`);
        } else {
          // move insertion point to just after the enclosing repeat
          const parts = path.split('/');
          if (parts.length > 1) setInsertPath(parts[0]!);
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    glRef.current = createContext(canvas);
    const ctx = glRef.current;
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const items = objectsRef.current.map((o) => ({
        mesh: meshFor(o.kind, o.w, o.d, o.h, o.rotationZ),
        x: o.x, y: o.y, z: o.z,
        color: hexToRgb(o.color),
        mode: o.mode,
      }));
      const camera: CameraState = { azimuth: 45, elevation: 35, distance: 260, target: [0, 0, 10] };
      drawScene(ctx, items, camera, [0.965, 0.973, 0.996, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const renderBlockRow = (b: ProgramBlock, path: string, index: number): VNode => {
    const labels: Record<string, string> = {
      addBox: 'Add Box', addCylinder: 'Add Cylinder', addSphere: 'Add Sphere',
      makeHole: 'Make hole', moveX: 'Move X by', moveY: 'Move Y by', moveZ: 'Move Z by',
      repeat: 'Repeat',
    };
    const isRepeat = b.block === 'repeat';
    return (
      <div key={path} data-block-path={path} class={`block-row ${insertPath === path ? 'gap-here' : ''}`}>
        <span tabIndex={0} data-block-name={b.block} data-block-path={path} role="option" aria-selected={focusIndex === index}>
          {labels[b.block]}
        </span>
        {(b.block === 'moveX' || b.block === 'moveY' || b.block === 'moveZ') && (
          <>
            <label class="qy-hidden" htmlFor={`mm-${path}`}>{labels[b.block]} (mm)</label>
            <input id={`mm-${path}`} style="width:70px" value={b.mm} disabled={props.readOnly || running}
              onInput={(e) => setField(path, 'mm', parseFloat((e.target as HTMLInputElement).value) || 0)} />
          </>
        )}
        {isRepeat && (
          <>
            <label class="qy-hidden" htmlFor={`cnt-${path}`}>Repeat count</label>
            <input id={`cnt-${path}`} style="width:60px" value={b.count} disabled={props.readOnly || running}
              onInput={(e) => setField(path, 'count', parseInt((e.target as HTMLInputElement).value, 10) || 1)} />
          </>
        )}
        <button class="btn del" aria-label="Delete block" onClick={() => deleteBlock(path)} disabled={props.readOnly || running}>Delete</button>
        {isRepeat && (
          <div class="repeat-body" role="list" aria-label="Repeat body">
            {b.body.map((child, ci) => renderBlockRow(child, `${path}/${ci}`, ci))}
            {b.body.length === 0 && <p style="color:var(--slate);margin:4px 0">Body is empty</p>}
          </div>
        )}
      </div>
    );
  };

  const meshVolume = objects.reduce((sum, o) => sum + (o.mode === 'solid' ? primitiveVolume(o.kind, o.w, o.d, o.h) : 0), 0);

  return (
    <>
      <div class="panel blocks-palette">
        <h2 id="palette-heading">Blocks palette</h2>
        <div class="toolbar-col" role="toolbar" aria-labelledby="palette-heading">
          <button class="btn" aria-label="Add Box" onClick={() => insertBlock('addBox')} disabled={props.readOnly || running}>Add Box</button>
          <button class="btn" aria-label="Add Cylinder" onClick={() => insertBlock('addCylinder')} disabled={props.readOnly || running}>Add Cylinder</button>
          <button class="btn" aria-label="Add Sphere" onClick={() => insertBlock('addSphere')} disabled={props.readOnly || running}>Add Sphere</button>
          <button class="btn" aria-label="Move X by" onClick={() => insertBlock('moveX')} disabled={props.readOnly || running}>Move X by</button>
          <button class="btn" aria-label="Move Y by" onClick={() => insertBlock('moveY')} disabled={props.readOnly || running}>Move Y by</button>
          <button class="btn" aria-label="Move Z by" onClick={() => insertBlock('moveZ')} disabled={props.readOnly || running}>Move Z by</button>
          <button class="btn" aria-label="Make hole" onClick={() => insertBlock('makeHole')} disabled={props.readOnly || running}>Make hole</button>
          <button class="btn" aria-label="Repeat" onClick={() => insertBlock('repeat')} disabled={props.readOnly || running}>Repeat</button>
        </div>
      </div>

      <div class="panel program-list">
        <h2>Program</h2>
        <div role="listbox" aria-label="Program">
          {program.map((b, i) => renderBlockRow(b, `${i}`, i))}
          {program.length === 0 && <p style="color:var(--slate)">Press Enter on a palette block to insert it.</p>}
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          {running ? (
            <button class="pill" onClick={stop}>Stop</button>
          ) : (
            <button class="pill" onClick={play} disabled={props.readOnly}>Play</button>
          )}
        </div>
      </div>

      <div class="blocks-viewer" role="region" aria-label="Block Lab viewer">
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>

      <div id="qy-blocks-scene" class="qy-hidden" aria-hidden="true"
        data-mesh-count={objects.length}
        data-sphere-count={objects.filter((o) => o.kind === 'sphere').length}
        data-step={step}
        data-state={running ? 'running' : 'done'}>
        {objects.map((o) => (
          <div key={o.id}
            data-object-id={o.id}
            data-kind={o.kind}
            data-mode={o.mode}
            data-x={o.x}
            data-y={o.y}
            data-z={o.z}
            data-w={o.w}
            data-d={o.d}
            data-h={o.h}
            data-rotation-z={o.rotationZ}
            data-volume={Math.round(primitiveVolume(o.kind, o.w, o.d, o.h))}
          />
        ))}
      </div>
      <span class="qy-hidden" aria-hidden="true" data-total-volume={Math.round(meshVolume)} />
    </>
  );
}

function cloneProgram(list: ProgramBlock[]): ProgramBlock[] {
  return list.map((b) => {
    if (b.block === 'repeat') return { ...b, body: cloneProgram(b.body) };
    return { ...b };
  });
}
