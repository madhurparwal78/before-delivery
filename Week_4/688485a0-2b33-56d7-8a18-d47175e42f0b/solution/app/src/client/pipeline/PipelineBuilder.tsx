import { GripVertical, CircleAlert, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { reducedMotion } from "../focus.js";
import { displayNumber } from "../../shared/display.js";
import { ConfirmDialog, useOverlay } from "../components/Dialog.js";
import { JsonCode } from "../components/JsonCode.js";
import { Separator } from "../components/Separator.js";
import { SieveMeter, useSieveMotion, type SieveMotion } from "../components/Sieve.js";
import { useLayout } from "../hooks.js";
import { stageStatus, usePipeline, type PipelineState, type StageDraft } from "./usePipeline.js";

/** The Pipeline builder: stage cards (each a Stage Sieve band), pin, status, and the preview of the focused stage. */

const LONG_PRESS_MS = 350;
const DRAG_START_PX = 4;

export function PipelineBuilder(): ReactNode {
  const motion = useSieveMotion();
  const pipeline = usePipeline(motion);
  const layout = useLayout();
  const [split, setSplit] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { stages, preview, focusAfter } = pipeline;
  const stackedSplit = layout === "tablet" ? { minHeight: `${split * 0.6}vh` } : undefined;

  useLayoutEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    if ("add" in target) addButton.current?.focus();
    else wrap.current?.querySelector<HTMLElement>(`[data-stage-key="${target.key}"]${target.text ? " textarea" : ""}`)?.focus();
  }, [stages, focusAfter]);

  const stop = preview?.pin ? preview.pin.stoppedAt : undefined;
  useLayoutEffect(() => {
    if (!preview?.pin || !wrap.current || !stages) return;
    const index = preview.pin.stoppedAt ?? stages.length - 1;
    const card = wrap.current.querySelector<HTMLElement>(`[data-stage-index="${index}"]`);
    if (!card) return;
    const y = card.getBoundingClientRect().top - wrap.current.getBoundingClientRect().top;
    motion.moveMarker(y, Math.max(0, index - preview.changedFrom), reducedMotion());
  }, [preview, stages, motion]);

  const focused = stages && pipeline.focusedKey ? stages.findIndex((stage) => stage.key === pipeline.focusedKey) : -1;
  const shown = stages ? (focused >= 0 ? focused : stages.length - 1) : -1;

  return (
    <div className="pipeline" ref={frame}>
      <div className="pipeline-controls">
        <button ref={addButton} type="button" className="btn btn-ink" onClick={pipeline.add}>
          <Plus size={18} aria-hidden="true" />
          Add stage
        </button>
        <form
          className="pin-form"
          onSubmit={(event) => {
            event.preventDefault();
            const id = pipeline.pinText.trim();
            if (id) pipeline.setPin(id);
          }}
        >
          <label className="field field-inline">
            <span className="field-label">Pin document</span>
            <input className="input" spellCheck={false} value={pipeline.pinText} onChange={(event) => pipeline.setPinText(event.target.value)} />
          </label>
          <button type="submit" className="btn">
            <Pin size={18} aria-hidden="true" />
            Pin
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              pipeline.setPin(null);
            }}
          >
            <PinOff size={18} aria-hidden="true" />
            Unpin
          </button>
        </form>
      </div>
      <p className="status-line" role="status" aria-label="Pipeline status">
        {pipeline.status}
      </p>
      {pipeline.error ? (
        <p className="error-chip error-block" role="alert" aria-label="Pipeline error">
          <CircleAlert size={18} aria-hidden="true" />
          {pipeline.error}
        </p>
      ) : null}
      <div className="pipeline-panes" style={layout === "desktop" ? { gridTemplateColumns: `${split}% 16px minmax(0, 1fr)` } : undefined}>
        <div className="stage-wrap" ref={wrap} style={stackedSplit} aria-busy={stages === null || undefined}>
          {pipeline.pin !== null && preview?.pin ? (
            <div ref={(node) => motion.attachMarker(node)} className="pin-marker" data-pin-marker data-stop-index={stop === null || stop === undefined ? "end" : String(stop)} aria-hidden="true">
              <Pin size={16} aria-hidden="true" />
            </div>
          ) : null}
          {stages === null ? (
            <div className="skeleton-stack" aria-hidden="true">
              <div className="skeleton-block" />
              <div className="skeleton-block" />
            </div>
          ) : (
            <StageList pipeline={pipeline} stages={stages} motion={motion} />
          )}
          {stages?.length === 0 ? <p className="muted">No stages yet. Add one to see how many documents survive it.</p> : null}
        </div>
        {layout === "phone" ? null : (
          <Separator name="Resize pipeline pane" value={split} onChange={setSplit} container={frame} orientation={layout === "desktop" ? "vertical" : "horizontal"} />
        )}
        <section className="stage-preview code-pane" role="region" aria-label="Stage preview" tabIndex={0} aria-busy={preview === null || undefined}>
          {preview && shown >= 0 && stages?.[shown] ? (
            <>
              <h3 className="preview-title">
                Stage {displayNumber(shown + 1)} · {stages[shown]?.op} · first {displayNumber(preview.documents[preview.order.indexOf((stages[shown] as StageDraft).key)]?.length ?? 0)} documents
              </h3>
              {(preview.documents[preview.order.indexOf((stages[shown] as StageDraft).key)] ?? []).map((doc, index) => (
                <pre className="json-block" key={index}>
                  <JsonCode value={doc} />
                </pre>
              ))}
            </>
          ) : (
            <p className="preview-title">Focus a stage to see its first documents.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function StageList({ pipeline, stages, motion }: { pipeline: PipelineState; stages: StageDraft[]; motion: SieveMotion }): ReactNode {
  const deleting = useOverlay<number>();
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const slot = deleting.slot;
  const deleted = slot ? stages[slot.value] : undefined;

  const dropIndex = (from: number, clientY: number): number => {
    const cards = [...(list.current?.querySelectorAll<HTMLElement>("[data-stage-index]") ?? [])];
    return cards.filter((card, index) => index !== from && card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2 < clientY).length;
  };

  const startHandle = (event: PointerEvent<HTMLButtonElement>, from: number): void => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const begin = (): void => {
      dragging = true;
      document.body.classList.add("is-dragging");
    };
    if (event.pointerType === "touch") timer = setTimeout(begin, LONG_PRESS_MS);
    const onMove = (move: globalThis.PointerEvent): void => {
      if (!dragging && event.pointerType !== "touch" && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) > DRAG_START_PX) begin();
      if (!dragging && timer && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) > 10) {
        clearTimeout(timer);
        timer = null;
      }
      if (dragging) setDrag({ from, over: dropIndex(from, move.clientY) });
    };
    const finish = (up: globalThis.PointerEvent, drop: boolean): void => {
      if (timer) clearTimeout(timer);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      document.body.classList.remove("is-dragging");
      if (dragging && drop) pipeline.move(from, dropIndex(from, up.clientY));
      setDrag(null);
    };
    const onUp = (up: globalThis.PointerEvent): void => finish(up, true);
    const onCancel = (up: globalThis.PointerEvent): void => finish(up, false);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  };

  const onCardKey = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      pipeline.move(index, index + (event.key === "ArrowUp" ? -1 : 1));
    } else if (event.key === "Delete" && event.target === event.currentTarget) {
      event.preventDefault();
      deleting.open(index);
    }
  };

  const total = stages.length;
  return (
    <>
      <ul className="stage-list" role="list" aria-label="Pipeline stages" ref={list}>
        {stages.map((stage, index) => {
          const preview = pipeline.preview;
          const at = preview ? preview.order.indexOf(stage.key) : -1;
          const count = preview && at >= 0 ? preview.counts[at] : undefined;
          const capped = preview?.capped != null;
          const overflow = preview !== null && count !== undefined && count > preview.input && !stage.disabled;
          const stoppedHere = preview?.pin ? (preview.pin.stoppedAt === index ? "Pinned document stops here" : preview.pin.stoppedAt === null && index === total - 1 ? "Pinned document reaches the end" : null) : null;
          const position = displayNumber(index + 1);
          return (
            <li key={stage.key} className={drag && drag.over === index && drag.from !== index ? "stage-item drop-before" : "stage-item"}>
              <div
                role="group"
                aria-label={`Stage ${position}: ${stage.op}`}
                tabIndex={0}
                className={drag?.from === index ? "stage-card is-dragged" : "stage-card"}
                data-stage-key={stage.key}
                data-stage-index={index}
                data-stage-count={count}
                data-capped={String(capped)}
                data-disabled={String(stage.disabled)}
                onKeyDown={(event) => onCardKey(event, index)}
                onFocus={() => pipeline.setFocusedKey(stage.key)}
              >
                <div className="stage-head">
                  <button
                    type="button"
                    className="btn btn-icon handle"
                    aria-label={`Move stage ${position}`}
                    onPointerDown={(event) => startHandle(event, index)}
                  >
                    <GripVertical size={20} aria-hidden="true" />
                  </button>
                  <span className="stage-title">
                    <span className="stage-number">{position}</span> <code>{stage.op}</code>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    aria-label={`Enable stage ${position}`}
                    checked={!stage.disabled}
                    onChange={() => pipeline.toggle(index)}
                  />
                  <button type="button" className="btn btn-icon" aria-label={`Delete stage ${position}`} onClick={() => deleting.open(index)}>
                    <Trash2 size={20} aria-hidden="true" />
                  </button>
                </div>
                <div className={stage.disabled ? "sieve-band is-off" : "sieve-band"}>
                  <SieveMeter motion={motion} id={stage.key} disabled={stage.disabled} overflow={overflow} />
                </div>
                <textarea
                  className="code-box stage-box"
                  aria-label={`Stage ${position} JSON`}
                  rows={1}
                  spellCheck={false}
                  value={stage.text}
                  onChange={(event) => pipeline.edit(index, event.target.value)}
                />
                <p className="stage-status" role="status">
                  {stageStatus(index, total, stage, preview)}
                </p>
                {stoppedHere ? <p className="pin-note">{stoppedHere}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {slot && deleted ? (
        <ConfirmDialog
          key={slot.id}
          name={`Delete stage ${displayNumber(slot.value + 1)} (${deleted.op})?`}
          text={`Delete stage ${displayNumber(slot.value + 1)} from this pipeline?`}
          onClose={deleting.closeFor(slot.id)}
          onConfirm={() => {
            deleting.closeFor(slot.id)();
            pipeline.remove(slot.value);
          }}
        />
      ) : null}
    </>
  );
}

