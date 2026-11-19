import { ReactNode, useEffect, useRef, useState } from "react";
import { PreviewAnswer } from "../lib/api";
import { copy } from "../lib/copy";
import { SieveBand } from "./SieveBand";
import { JsonEditor } from "./JsonEditor";

/**
 * The pipeline builder (DP-19, DP-22 to DP-33): stage cards as Stage Sieve
 * bands, keyboard moves with Alt+Arrow, drag reorder, the pin marker and the
 * polite Pipeline status.
 */

export interface StageState {
  text: string;
  disabled: boolean;
}

export function PipelineScreen(props: {
  stages: StageState[];
  preview: PreviewAnswer | null;
  collectionCount: number;
  pinId: string;
  pending: boolean;
  statusText: string;
  errorText: string;
  cappedLimit: number | null;
  onChange: (stages: StageState[]) => void;
  onRecompute: () => void;
  onPreviewStage: (index: number | null) => void;
  onFocusStage: (index: number) => void;
  onSaveDraft: (stages: StageState[]) => void;
  onStatus: (text: string) => void;
  onPin: (id: string) => void;
  onUnpin: () => void;
  readOnly: boolean;
  phone: boolean;
}): ReactNode {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const total = props.stages.length;

  const moveStage = (index: number, delta: number): void => {
    const to = index + delta;
    if (to < 0 || to >= total) return;
    const next = [...props.stages];
    const [st] = next.splice(index, 1);
    next.splice(to, 0, st);
    props.onChange(next);
    props.onSaveDraft(next);
    props.onPreviewStage(to);
    props.onStatus(copy.stageMoved(to + 1, total));
  };

  const stageStatusText = (i: number): string => {
    const stage = props.stages[i];
    let parseOk = true;
    try {
      JSON.parse(stage.text);
    } catch {
      parseOk = false;
    }
    if (stage.disabled) return copy.passThrough;
    if (!parseOk) return "not valid JSON";
    if (props.preview === null) return "";
    const p = props.preview.stages[i];
    if (p === undefined) return "";
    if (props.cappedLimit !== null) return copy.stageStatusCapped(i + 1, total, props.cappedLimit);
    return copy.stageStatus(i + 1, total, p.count);
  };

  return (
    <div className="pipeline-screen">
      <div className="pipeline-toolbar">
        <button
          className="btn primary"
          disabled={props.readOnly}
          onClick={() => {
            const next = [...props.stages, { text: '{"$match":{}}', disabled: false }];
            props.onChange(next);
            props.onSaveDraft(next);
            props.onPreviewStage(next.length - 1);
          }}
        >
          Add stage
        </button>
        <label className="field">
          <span className="field-label">Pin document</span>
          <input
            aria-label="Pin document"
            className="text-input"
            value={props.pinId}
            onChange={e => props.onPin(e.target.value)}
          />
        </label>
        <button className="btn" onClick={() => props.onPin(props.pinId)}>Pin</button>
        <button className="btn" onClick={props.onUnpin}>Unpin</button>
      </div>
      <div role="status" aria-label="Pipeline status" className="pipeline-status">
        {props.statusText}
      </div>
      <div role="alert" aria-label="Pipeline error" className="pipeline-error">
        {props.errorText}
      </div>
      <ul aria-label="Pipeline stages" className="stage-list">
        {props.stages.map((stage, i) => {
          const previewStage = props.preview?.stages[i];
          const out = props.cappedLimit !== null
            ? props.cappedLimit
            : (previewStage?.count ?? 0);
          const disabledCount = previewStage?.count ?? 0;
          const inputCount = i === 0
            ? props.collectionCount
            : (props.cappedLimit !== null ? props.cappedLimit : (props.preview?.stages[i - 1]?.count ?? 0));
          const isCapped = props.cappedLimit !== null;
          const pinStop = props.preview?.pin !== null && props.preview?.pin !== undefined && props.preview.pin.stopped_at === i;
          const pinEnd = props.preview?.pin !== null && props.preview?.pin !== undefined && props.preview.pin.stopped_at === null && i === total - 1;
          return (
            <li key={i} className="stage-card-wrap">
              <div
                role="group"
                aria-label={`Stage ${i + 1}: ${stageOp(stage.text)}`}
                tabIndex={0}
                className="stage-card"
                data-stage-index={i}
                data-stage-count={isCapped ? props.cappedLimit : (stage.disabled ? disabledCount : out)}
                data-capped={isCapped ? "true" : "false"}
                data-disabled={stage.disabled ? "true" : "false"}
                onFocus={() => props.onFocusStage(i)}
                onKeyDown={e => {
                  if (e.altKey && e.key === "ArrowUp") {
                    e.preventDefault();
                    moveStage(i, -1);
                  } else if (e.altKey && e.key === "ArrowDown") {
                    e.preventDefault();
                    moveStage(i, 1);
                  } else if (e.key === "Delete" && e.target === e.currentTarget) {
                    setDeleteIndex(i);
                  } else if (e.key === "Enter" && e.target === e.currentTarget) {
                    const text = e.currentTarget.querySelector<HTMLElement>("[aria-label='Stage " + (i + 1) + " JSON']");
                    text?.focus();
                  }
                }}
              >
                <div className="stage-head">
                  <button
                    aria-label={`Move stage ${i + 1}`}
                    className="stage-handle"
                    draggable={!props.readOnly}
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={e => e.preventDefault()}
                  >
                    <span aria-hidden="true">&#8942;</span>
                  </button>
                  <span className="stage-title">Stage {i + 1}: {stageOp(stage.text)}</span>
                  <label className="switch-pill">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Enable stage ${i + 1}`}
                      checked={!stage.disabled}
                      onChange={e => {
                        const next = props.stages.map((s, j) => j === i ? { ...s, disabled: !e.target.checked } : s);
                        props.onChange(next);
                        props.onSaveDraft(next);
                      }}
                    />
                    <span />
                  </label>
                  <button
                    className="btn danger small"
                    aria-label={`Delete stage ${i + 1}`}
                    disabled={props.readOnly}
                    onClick={() => setDeleteIndex(i)}
                  >
                    Delete stage {i + 1}
                  </button>
                </div>
                <div className="stage-editor">
                  <JsonEditor
                    value={stage.text}
                    onChange={v => {
                      const next = props.stages.map((s, j) => j === i ? { ...s, text: v } : s);
                      props.onChange(next);
                    }}
                    readOnly={props.readOnly}
                    ariaLabel={`Stage ${i + 1} JSON`}
                  />
                </div>
                <div role="status" className="stage-status">
                  {stageStatusText(i)}
                  {pinStop ? ` ${copy.pinStop}` : ""}
                  {pinEnd ? ` ${copy.pinEnd}` : ""}
                </div>
                <SieveBand
                  geo={{
                    input: inputCount,
                    out: stage.disabled ? 0 : out,
                    disabled: stage.disabled,
                    capped: isCapped,
                  }}
                  delayMs={40 * (i - (props.pending ? 0 : 0))}
                  animate
                />
                {props.preview?.pin !== null && props.preview?.pin !== undefined && props.preview.pin.stopped_at !== null && i >= props.preview.pin.stopped_at && (
                  <div className="pin-marker" data-pin-marker="" data-stop-index={props.preview.pin.stopped_at} aria-hidden="true" />
                )}
              </div>
              {dragIndex !== null && dragIndex !== i && (
                <div
                  className="drop-gap"
                  onDrop={e => {
                    e.preventDefault();
                    if (dragIndex === null) return;
                    const next = [...props.stages];
                    const [st] = next.splice(dragIndex, 1);
                    next.splice(i > dragIndex ? i - 1 : i, 0, st);
                    props.onChange(next);
                    props.onSaveDraft(next);
                    setDragIndex(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <DeleteStageDialog
        open={deleteIndex !== null}
        index={deleteIndex}
        stageOpName={deleteIndex !== null ? stageOp(props.stages[deleteIndex].text) : ""}
        onCancel={() => setDeleteIndex(null)}
        onDelete={() => {
          if (deleteIndex === null) return;
          const next = props.stages.filter((_, j) => j !== deleteIndex);
          props.onChange(next);
          props.onSaveDraft(next);
          props.onPreviewStage(Math.min(deleteIndex, next.length - 1));
          props.onStatus(copy.stageDeleted(deleteIndex + 1));
          setDeleteIndex(null);
        }}
      />
    </div>
  );
}

function DeleteStageDialog(propsD: {
  open: boolean;
  index: number | null;
  stageOpName: string;
  onCancel: () => void;
  onDelete: () => void;
}): ReactNode {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (propsD.open) confirmRef.current?.focus();
  }, [propsD.open]);
  if (propsD.index === null) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={e => {
      if (e.target === e.currentTarget) propsD.onCancel();
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete stage ${propsD.index + 1} (${propsD.stageOpName})?`}
        className="dialog"
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.preventDefault();
            propsD.onCancel();
          }
        }}
      >
        <h2 className="dialog-title">Delete stage {propsD.index + 1} ({propsD.stageOpName})?</h2>
        <div className="dialog-actions">
          <button ref={confirmRef} className="btn danger" onClick={propsD.onDelete}>Delete</button>
          <button className="btn" onClick={propsD.onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function stageOp(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    return keys.length > 0 ? keys[0] : "—";
  } catch {
    return "—";
  }
}
