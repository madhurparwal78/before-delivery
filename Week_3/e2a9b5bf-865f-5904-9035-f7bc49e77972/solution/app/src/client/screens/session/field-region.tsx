import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { round2, roundPoint, viewToSky } from "../../../shared/projection";
import { COPY } from "../../../shared/messages";
import { pairSentence } from "../../../shared/pair";
import { readoutLine } from "../../../shared/optics";
import type { Derived, ObjectKind, Optics, Point } from "../../../shared/types";
import { Compass, paintCompass, type CompassParts } from "../../field/compass";
import { drawField } from "../../field/draw";
import type { Sketch, Width } from "../../field/sketch";
import type { FieldController, Frame } from "../../field/swap";
import { createStore, useSelect, type Store } from "../../lib/store";
import { Dialog, useDialog } from "../../ui/dialog";
import { ClearIcon, MeasureIcon, PencilIcon, StarIcon, UndoIcon, WidthIcon } from "../../ui/icons";

export interface FrameStore {
  frame: Frame | null;
}

export function createFrameStore(): Store<FrameStore> {
  return createStore<FrameStore>({ frame: null });
}

export interface FieldModel {
  sketch: Sketch;
  controller: FieldController;
  frames: Store<FrameStore>;
  painter: { current: (() => void) | null };
  compassParts: { current: CompassParts };
  derived: Derived;
  compassSentence: string;
  announcement: string;
  say(text: string): void;
  pick(partial: Partial<Optics>): void;
  stepEyepiece(delta: number): void;
  kind: ObjectKind | null;
  locked: boolean;
  /** Called when the optics change or a contact lands: finishes a swap in progress. */
  landed(): void;
  /** Pointers whose contact the optics interrupted: they draw nothing more until they lift. */
  blocked: { current: Set<number> };
  /** Lets the optics handler end the stroke in progress. */
  contact: { current: { end(): void } | null };
}

function dialogOpen(): boolean {
  return document.querySelector("#dialogs .dialog-backdrop:not(.leaving)") !== null;
}

export function FieldRegion({ model }: { model: FieldModel }) {
  const { sketch, controller } = model;
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, bump] = useState(0);
  const frame = useSelect(model.frames, (s) => s.frame);
  const clear = useDialog();
  const live = useRef({ stroke: null as number | null, touches: new Set<number>(), pen: null as number | null, discarded: false, tap: null as null | { id: number; x: number; y: number } });

  const redraw = () => {
    const c = canvas.current;
    const f = field.current;
    if (!c || !f) return;
    const view = controller.frame.view;
    drawField(c, f.clientWidth, view, sketch, !model.locked);
    paintCompass(model.compassParts.current, view);
  };
  model.painter.current = redraw;

  useLayoutEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (field.current) observer.observe(field.current);
    return () => observer.disconnect();
  }, [model.locked]);

  useLayoutEffect(
    () =>
      sketch.subscribe(() => {
        redraw();
        bump((n) => n + 1);
      }),
    [sketch],
  );

  const orient = () => {
    const v = controller.frame.view;
    return { rotation_deg: v.rot, mirrored: v.sx < 0 };
  };

  /** Maps a pointer to sky coordinates through the projection on screen now; null outside the circle. */
  const toSky = (e: PointerEvent): Point | null => {
    const f = field.current;
    if (!f) return null;
    const rect = f.getBoundingClientRect();
    const R = rect.width / 2;
    const dx = e.clientX - (rect.left + R);
    const dy = rect.top + R - e.clientY;
    if (dx * dx + dy * dy > R * R) return null;
    const view = controller.frame.view;
    const k = view.half / R;
    return roundPoint(viewToSky(dx * k, dy * k, orient()));
  };

  model.contact.current = {
    end() {
      const s = live.current;
      if (s.stroke === null) return;
      model.blocked.current.add(s.stroke);
      s.stroke = null;
      sketch.endStroke();
    },
  };

  const releaseContact = (id: number) => {
    const s = live.current;
    s.touches.delete(id);
    if (s.pen === id) s.pen = null;
    if (s.touches.size === 0) s.discarded = false;
    model.blocked.current.delete(id);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (model.locked || (e.pointerType === "mouse" && e.button !== 0)) return;
    const s = live.current;
    if (e.pointerType === "touch" && s.pen !== null) return;
    model.landed();
    if (e.pointerType === "pen") s.pen = e.pointerId;
    if (e.pointerType === "touch") {
      s.touches.add(e.pointerId);
      if (s.touches.size > 1) {
        sketch.discardStroke();
        s.stroke = null;
        s.tap = null;
        s.discarded = true;
        return;
      }
    }
    if (s.discarded) return;
    e.preventDefault();
    field.current?.setPointerCapture?.(e.pointerId);
    const at = toSky(e);
    if (!at) return;
    if (sketch.mode === "pencil") {
      s.stroke = e.pointerId;
      sketch.beginStroke(at);
    } else {
      s.tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = live.current;
    if (s.discarded || model.blocked.current.has(e.pointerId)) return;
    if (s.stroke === e.pointerId) {
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const part of events.length > 0 ? events : [e]) {
        const at = toSky(part);
        if (at) sketch.extendStroke(at);
      }
    } else if (s.tap && s.tap.id === e.pointerId && Math.hypot(e.clientX - s.tap.x, e.clientY - s.tap.y) > 12) {
      s.tap = null;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const s = live.current;
    const blocked = model.blocked.current.has(e.pointerId);
    if (s.stroke === e.pointerId) {
      s.stroke = null;
      if (!blocked && !s.discarded) sketch.endStroke();
      else sketch.discardStroke();
    } else if (s.tap && s.tap.id === e.pointerId) {
      const tap = s.tap;
      s.tap = null;
      if (!s.discarded && !blocked) {
        const at = toSky(e);
        if (at && tap) placeAt(at);
      }
    }
    releaseContact(e.pointerId);
  };

  const onPointerCancel = (e: PointerEvent) => {
    const s = live.current;
    if (s.stroke === e.pointerId) {
      s.stroke = null;
      sketch.discardStroke();
    }
    if (s.tap?.id === e.pointerId) s.tap = null;
    releaseContact(e.pointerId);
  };

  const placeAt = (at: Point) => {
    if (sketch.mode === "star") {
      sketch.addStar(at);
    } else if (sketch.mode === "measure") {
      sketch.markPair(at);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (dialogOpen()) return;
    const key = e.key;
    const arrows: Record<string, Point> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const arrow = arrows[key];
    if (arrow) {
      e.preventDefault();
      if (model.locked) return;
      const step = e.shiftKey ? 5 : 1;
      const [dx, dy] = viewToSky(arrow[0] * step, arrow[1] * step, orient());
      const next: Point = [round2(sketch.cursor[0] + dx), round2(sketch.cursor[1] + dy)];
      const radius = model.derived.true_field_arcmin / 2;
      if (Math.hypot(next[0], next[1]) <= radius + 1e-9) sketch.setCursor(next);
      return;
    }
    if (/^[1-5]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      sketch.setBrightness(Number(key));
      model.say(COPY.brightness(Number(key)));
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      if (model.locked) return;
      if (sketch.mode === "measure") sketch.markPair(sketch.cursor);
      else {
        sketch.addStar(sketch.cursor);
        model.say(COPY.starPlaced(sketch.brightness));
      }
      return;
    }
    if (key === "]" || key === "[") {
      e.preventDefault();
      model.stepEyepiece(key === "]" ? 1 : -1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "z") {
      e.preventDefault();
      if (sketch.undo()) model.say(COPY.removedMark);
    }
  };

  const mode = sketch.mode;
  const width = sketch.width;
  const pair = sketch.pair();
  const marks = sketch.pairMarks.length;
  const pairReadout = pairSentence(pair ? { primary: pair[0], secondary: pair[1] } : null, marks);
  const hidden = frame?.active === true;
  const toolButton = (name: string, pressed: boolean | undefined, onClick: () => void, icon: preact.ComponentChildren, disabled = false) => (
    <button
      type="button"
      class="tool"
      aria-label={name}
      title={name}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      onClick={() => {
        field.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        onClick();
      }}
    >
      {icon}
    </button>
  );
  const widthButton = (name: string, value: Width, weight: number) =>
    toolButton(name, width === value, () => sketch.setWidth(value), <WidthIcon weight={weight} />, model.locked);

  return (
    <section role="region" aria-label="Field" class="field-region" onKeyDown={onKeyDown}>
      <div class="field-circle">
        <div
          ref={field}
          role="application"
          aria-label="Eyepiece field"
          class="eyepiece"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <canvas ref={canvas} />
        </div>
        <Compass
          sentence={model.compassSentence}
          view={controller.frame.view}
          setParts={(parts) => {
            model.compassParts.current = parts;
          }}
        />
      </div>
      <div role="toolbar" aria-label="Sketch tools" class="tools">
        {toolButton("Pencil", mode === "pencil", () => sketch.setMode("pencil"), <PencilIcon />, model.locked)}
        {toolButton("Star", mode === "star", () => sketch.setMode("star"), <StarIcon />, model.locked)}
        {model.kind === "double_star"
          ? toolButton("Measure", mode === "measure", () => sketch.setMode("measure"), <MeasureIcon />, model.locked)
          : null}
        {widthButton("Fine", "fine", 1)}
        {widthButton("Medium", "medium", 2.25)}
        {widthButton("Broad", "broad", 3.75)}
        {toolButton("Undo", undefined, () => sketch.undo() && model.say(COPY.removedMark), <UndoIcon />, model.locked)}
        {toolButton("Clear sketch", undefined, () => clear.show(), <ClearIcon />, model.locked)}
      </div>
      <div class="readouts">
        <div role="status" aria-label="Optics readout" class={`readout${hidden ? " visually-hidden" : ""}`}>
          {readoutLine(model.derived)}
        </div>
        {frame?.active ? (
          <div class="figures">
            <span aria-hidden="true">{`${frame.mag}×`}</span>
            <span aria-hidden="true">{`${frame.field}′`}</span>
            <span aria-hidden="true">{`${frame.pupil.toFixed(1)} mm`}</span>
          </div>
        ) : null}
        {model.kind === "double_star" ? (
          <div role="status" aria-label="Pair readout" class="pair-readout">
            {pairReadout}
          </div>
        ) : null}
      </div>
      <div role="status" aria-label="Field announcements" class="announcements">
        {model.announcement || null}
      </div>
      <Dialog handle={clear} label="Clear sketch?">
        <h2>Clear sketch?</h2>
        <p class="sentence">Every stroke and star on this circle will be erased. One Undo brings them back.</p>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn"
            onClick={() => {
              sketch.clear();
              clear.close();
            }}
          >
            Clear
          </button>
          <button type="button" class="btn" data-initial onClick={() => clear.close()}>
            Keep sketch
          </button>
        </div>
      </Dialog>
    </section>
  );
}
