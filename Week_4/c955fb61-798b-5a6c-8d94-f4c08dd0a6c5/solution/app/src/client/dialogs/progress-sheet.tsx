import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Item } from "../../shared/types";
import { Dialog } from "../components/dialog";
import { percentSentence } from "../messages";
import type { ProjectSession } from "../store";

const STEP = 5;

interface Props {
  session: ProjectSession;
  item: Item;
  returnTo: () => HTMLElement | null;
  onClose: () => void;
}

/** The phone sheet: a slider for percent complete that works by touch, pointer and keyboard in steps of 5. */
export function ProgressSheet({ session, item, returnTo, onClose }: Props) {
  const [percent, setPercent] = useState(item.percent);
  const track = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setPercent(Math.round((ratio * 100) / STEP) * STEP);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: Math.min(100, percent + STEP), ArrowUp: Math.min(100, percent + STEP), ArrowLeft: Math.max(0, percent - STEP), ArrowDown: Math.max(0, percent - STEP), Home: 0, End: 100 };
    if (event.key in keys) {
      event.preventDefault();
      setPercent(keys[event.key]);
    }
  };

  const save = async () => {
    setBusy(true);
    await session.edit(item.id, () => ({ payload: { percent }, sentence: (result) => percentSentence(result.item) }));
    setBusy(false);
    onClose();
  };

  return (
    <Dialog label="Update progress" className="sheet" onClose={onClose} returnTo={returnTo}>
      <h2>{item.name}</h2>
      <p className="sheet-value">{percent}%</p>
      <div
        className="slider"
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Percent complete"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        data-autofocus=""
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event);
        }}
      >
        <div className="slider-fill" style={{ width: `${percent}%` }} />
        <div className="slider-thumb" style={{ left: `${percent}%` }} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          Save progress
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
