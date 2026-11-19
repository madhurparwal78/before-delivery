import { Play, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { copy } from "../../shared/copy";
import { UNDO_DEPTH } from "../../shared/limits";
import type { Block, BlockName, DesignObject, Snapshot } from "../../shared/types";
import type { EditorController, EditorProps } from "../editors/contract";
import { meshVolume, primitiveMesh } from "../geometry";
import { useConfig } from "../lib/config";
import { prefersReducedMotion } from "../lib/motion";
import { useStatus } from "../lib/status";
import { Palette } from "./Palette";
import { ProgramList, type ProgramActions } from "./ProgramList";
import {
  endOfProgram, focusAfterRemoval, insertBlock, newBlock, pointAfterRemoval, pointIsValid, removeBlock, updateBlock,
  type BlockPath, type InsertionPoint,
} from "./program";
import { applyStep, planSteps, startRun, type Plan, type RunState } from "./run";
import { Viewport } from "./Viewport";
import "./blocklab.css";

/** What the editor shows: the program, the objects of the last run, and where the next block goes. */
interface Doc {
  program: Block[];
  objects: DesignObject[];
  point: InsertionPoint;
}

/** The part of the document an undo step keeps. */
type Saved = Pick<Doc, "program" | "objects">;

interface RunView {
  state: "idle" | "running" | "done";
  step: number;
}

/** A run in flight: its steps, how many have run, what they made, and the timer of the next one. */
interface Progress {
  plan: Plan;
  at: number;
  made: RunState;
  timer: number;
  before: Saved;
}

type Outcome = "finished" | "limit" | "stopped";

function startingDoc(snapshot: Snapshot): Doc {
  const program = snapshot.kind === "blocks" ? snapshot.program : [];
  return { program, objects: snapshot.kind === "blocks" ? snapshot.objects : [], point: endOfProgram(program) };
}

function figure(value: number): string {
  return String(Number(value.toFixed(2)));
}

function SceneItem({ object, volume }: { object: DesignObject; volume: number }) {
  return (
    <div
      data-object-id={object.id} data-kind={object.kind} data-mode={object.mode}
      data-x={figure(object.x)} data-y={figure(object.y)} data-z={figure(object.z)}
      data-w={figure(object.w)} data-d={figure(object.d)} data-h={figure(object.h)}
      data-rotation-z={String(((Math.round(object.rotationZ) % 360) + 360) % 360)} data-volume={String(volume)}
    />
  );
}

function BlockLabEditor({ snapshot, readOnly, onChange, controllerRef }: EditorProps) {
  const { announce } = useStatus();
  const { blocksStepMs } = useConfig();
  const [doc, setDoc] = useState<Doc>(() => startingDoc(snapshot));
  const [run, setRun] = useState<RunView>({ state: "idle", step: 0 });
  const [drop, setDrop] = useState<InsertionPoint | null>(null);
  const [activeHead, setActiveHead] = useState("0");

  const docRef = useRef(doc);
  const runRef = useRef(run);
  const dropRef = useRef<InsertionPoint | null>(null);
  const progress = useRef<Progress | null>(null);
  const past = useRef<Saved[]>([]);
  const future = useRef<Saved[]>([]);
  const lastEdit = useRef("");
  const listeners = useRef(new Set<() => void>());
  const programEl = useRef<HTMLDivElement>(null);
  const focusPath = useRef<BlockPath | null | undefined>(undefined);
  const live = useRef({ readOnly, onChange, blocksStepMs, announce });
  live.current = { readOnly, onChange, blocksStepMs, announce };

  const locked = readOnly || run.state === "running";
  const frozen = () => live.current.readOnly || runRef.current.state === "running";

  const show = (next: Doc) => {
    docRef.current = next;
    setDoc(next);
  };

  const showRun = (next: RunView) => {
    runRef.current = next;
    setRun(next);
  };

  const saved = (): Saved => ({ program: docRef.current.program, objects: docRef.current.objects });

  const publish = (next: Saved) => {
    if (!live.current.readOnly) live.current.onChange({ kind: "blocks", program: next.program, objects: next.objects });
  };

  const pushPast = (step: Saved) => {
    past.current = [...past.current, step].slice(-UNDO_DEPTH);
    future.current = [];
    lastEdit.current = "";
    listeners.current.forEach((listener) => listener());
  };

  /** One edit of the program: an undo step of its own, except that typing in one field is a single step. */
  const edit = (program: Block[], point: InsertionPoint, field: string) => {
    if (field === "" || field !== lastEdit.current) pushPast(saved());
    lastEdit.current = field;
    const next = { program, objects: docRef.current.objects, point };
    show(next);
    publish(next);
  };

  const insert = (name: BlockName, at: InsertionPoint = docRef.current.point) => {
    if (frozen()) return;
    const { program } = docRef.current;
    const place = pointIsValid(program, at) ? at : endOfProgram(program);
    edit(insertBlock(program, place, newBlock(name)), { list: place.list, index: place.index + 1 }, "");
  };

  const remove = (path: BlockPath) => {
    if (frozen()) return;
    const { program, point } = docRef.current;
    focusPath.current = focusAfterRemoval(program, path);
    edit(removeBlock(program, path), pointAfterRemoval(point, path), "");
  };

  const setValue = (path: BlockPath, patch: Partial<Block>) => {
    if (frozen()) return;
    const { program, point } = docRef.current;
    edit(updateBlock(program, path, patch), point, `${path.join(".")}:${Object.keys(patch).join(",")}`);
  };

  const setPoint = (point: InsertionPoint) => {
    if (frozen()) return;
    show({ ...docRef.current, point });
  };

  const moveFocus = (from: HTMLElement, delta: 1 | -1) => {
    const heads = Array.from(programEl.current?.querySelectorAll<HTMLElement>("[data-head]") ?? []);
    heads[heads.indexOf(from) + delta]?.focus();
  };

  const actions: ProgramActions = { moveFocus, setPoint, remove, setValue, activate: setActiveHead };

  useLayoutEffect(() => {
    const target = focusPath.current;
    if (target !== undefined) {
      focusPath.current = undefined;
      const head = target && programEl.current?.querySelector<HTMLElement>(`[data-head="${target.join(".")}"]`);
      (head || document.querySelector<HTMLElement>(".bl-chip:not(:disabled)"))?.focus();
    }
    if (!programEl.current?.querySelector(`[data-head="${activeHead}"]`)) setActiveHead("0");
  }, [doc, activeHead]);

  const finish = (outcome: Outcome) => {
    const current = progress.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    progress.current = null;
    const objects = current.made.objects;
    pushPast(current.before);
    flushSync(() => {
      show({ ...docRef.current, objects });
      showRun({ state: "done", step: current.at });
    });
    publish({ program: docRef.current.program, objects });
    live.current.announce(outcome === "limit" ? copy.stepLimit : outcome === "stopped" ? copy.programStopped : copy.programFinished(objects.length));
  };

  const tick = () => {
    const current = progress.current;
    const step = current?.plan.steps[current.at];
    if (!current || !step) return;
    current.made = applyStep(current.made, step);
    current.at += 1;
    if (current.at >= current.plan.steps.length) {
      finish(current.plan.truncated ? "limit" : "finished");
      return;
    }
    flushSync(() => {
      show({ ...docRef.current, objects: current.made.objects });
      showRun({ state: "running", step: current.at });
    });
    current.timer = window.setTimeout(tick, live.current.blocksStepMs);
  };

  const play = () => {
    if (runRef.current.state === "running") return;
    const plan = planSteps(docRef.current.program);
    const current: Progress = { plan, at: 0, made: startRun(), timer: 0, before: saved() };
    progress.current = current;
    show({ ...docRef.current, objects: [] });
    showRun({ state: "running", step: 0 });
    if (prefersReducedMotion() || plan.steps.length === 0) {
      for (const step of plan.steps) current.made = applyStep(current.made, step);
      current.at = plan.steps.length;
      finish(plan.truncated ? "limit" : "finished");
      return;
    }
    current.timer = window.setTimeout(tick, live.current.blocksStepMs);
  };

  const stop = () => {
    if (runRef.current.state === "running") finish("stopped");
  };

  useEffect(() => () => window.clearTimeout(progress.current?.timer), []);

  /** Moves one step between the undo and redo lists, showing the document as it was kept there. */
  const travel = (from: Saved[], to: Saved[]) => {
    const target = from[from.length - 1];
    if (!target || frozen()) return;
    to.push(saved());
    from.pop();
    lastEdit.current = "";
    const point = pointIsValid(target.program, docRef.current.point) ? docRef.current.point : endOfProgram(target.program);
    show({ ...target, point });
    publish(target);
    listeners.current.forEach((listener) => listener());
  };

  const undo = () => travel(past.current, future.current);
  const redo = () => travel(future.current, past.current);

  useEffect(() => {
    const controller: EditorController = {
      undo,
      redo,
      canUndo: () => past.current.length > 0,
      canRedo: () => future.current.length > 0,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      handleKey: (event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) undo();
        else if (key === "y" || (key === "z" && event.shiftKey)) redo();
        else return false;
        return true;
      },
      exportSource: () => ({ kind: "design", objects: docRef.current.objects }),
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // The controller reads only refs, so one per mounted editor is enough.
  }, []);

  /** The gap under the pointer: the innermost list it is over, and the number of its blocks whose middle is above it. */
  const findDrop = (x: number, y: number): InsertionPoint | null => {
    const root = programEl.current;
    if (!root) return null;
    const inside = (box: DOMRect) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    if (!inside(root.getBoundingClientRect())) return null;
    const lists = Array.from(root.querySelectorAll<HTMLElement>("ul[data-list]")).filter((list) => inside(list.getBoundingClientRect()));
    const depth = (list: HTMLElement) => (list.dataset.list ? list.dataset.list.split(".").length : 0);
    const target = lists.sort((a, b) => depth(b) - depth(a))[0] ?? root.querySelector<HTMLElement>("ul[data-list='']");
    if (!target) return null;
    const items = Array.from(target.querySelectorAll<HTMLElement>(":scope > li[data-block]"));
    const above = items.filter((item) => {
      const box = item.getBoundingClientRect();
      return box.top + box.height / 2 < y;
    });
    return { list: target.dataset.list ? target.dataset.list.split(".").map(Number) : [], index: above.length };
  };

  const objects = doc.objects;
  const volumes = useMemo(() => objects.map((object) => Math.round(meshVolume(primitiveMesh(object)))), [objects]);
  const running = run.state === "running";

  return (
    <div className="blocklab">
      <div className="bl-col bl-col--palette">
        <p className="eyebrow bl-eyebrow">Block Lab</p>
        <h2 className="bl-heading">Blocks</h2>
        <Palette
          disabled={locked}
          onInsert={(name) => insert(name)}
          onDrag={(_name, x, y) => {
            dropRef.current = findDrop(x, y);
            setDrop(dropRef.current);
          }}
          onDrop={(name) => {
            const at = dropRef.current;
            dropRef.current = null;
            setDrop(null);
            if (at) insert(name, at);
          }}
          onDragCancel={() => {
            dropRef.current = null;
            setDrop(null);
          }}
        />
      </div>
      <div className="bl-col bl-col--program" ref={programEl}>
        <div className="bl-bar">
          <h2 className="bl-heading">Your program</h2>
          <div className="bl-run">
            <button type="button" className="pill pill--blocks" aria-disabled={running} onClick={play}>
              <Play size={20} aria-hidden="true" focusable="false" />
              Play
            </button>
            <button type="button" className="pill pill--outline bl-stop" aria-disabled={!running} onClick={stop}>
              <Square size={20} aria-hidden="true" focusable="false" />
              Stop
            </button>
          </div>
        </div>
        {doc.program.length === 0 && <p className="hint bl-hint">Pick blocks from the palette. They land in the highlighted gap.</p>}
        <ProgramList blocks={doc.program} list={[]} point={doc.point} drop={drop} locked={locked} activeHead={activeHead} actions={actions} />
      </div>
      <section className="bl-col bl-col--viewer" aria-label="Block Lab viewer">
        <div className="bl-viewport">
          <Viewport objects={objects} />
        </div>
        <p className="bl-readout figures">
          {objects.length} {objects.length === 1 ? "object" : "objects"} · step {run.step}
        </p>
        <div
          id="qy-blocks-scene" className="sr-only" data-mesh-count={objects.length}
          data-sphere-count={objects.filter((object) => object.kind === "sphere").length} data-step={run.step} data-state={run.state}
        >
          {objects.map((object, i) => <SceneItem key={object.id} object={object} volume={volumes[i] ?? 0} />)}
        </div>
      </section>
    </div>
  );
}

/** The Block Lab: palette, program and viewer. A new `documentKey` starts the editor over from the snapshot. */
export default function BlockLab(props: EditorProps) {
  return <BlockLabEditor key={props.documentKey} {...props} />;
}
