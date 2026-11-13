import { useRef, type ReactNode } from "react";
import { timecode } from "../../shared/timecode";
import type { Clip } from "../../shared/types";
import { rateOf } from "../../shared/rational";
import { timelineOrder } from "./state";
import type { Row } from "../../shared/types";

interface ScrubberProps {
  frame: number;
  last: number;
  rate: string;
  onChange: (frame: number) => void;
  onHold: (held: { x: number; y: number } | null) => void;
}

/** The Scrubber slider; on touch, holding the thumb shows the loupe above it. */
export function Scrubber({ frame, last, rate, onChange, onHold }: ScrubberProps): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const thumb = (value: number): { x: number; y: number } | null => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? { x: rect.left + (last ? value / last : 0) * rect.width, y: rect.top } : null;
  };
  return (
    <input
      ref={ref}
      type="range"
      aria-label="Scrubber"
      aria-valuetext={timecode(rateOf(rate), frame)}
      className="scrubber"
      min={0}
      max={Math.max(0, last)}
      value={frame}
      onChange={(event) => {
        onChange(Number(event.target.value));
        if (event.target === document.activeElement) onHold(thumb(Number(event.target.value)));
      }}
      onPointerDown={(event) => event.pointerType === "touch" && onHold(thumb(frame))}
      onPointerUp={() => onHold(null)}
      onPointerCancel={() => onHold(null)}
    />
  );
}

interface ClipsListProps {
  clips: readonly Clip[];
  rows: readonly Row[];
  rate: string;
  onPick: (clip: Clip) => void;
}

/** The stacked clip list of the review layouts, in timeline order. */
export function ClipsList({ clips, rows, rate, onPick }: ClipsListProps): ReactNode {
  const parsed = rateOf(rate);
  return (
    <ul aria-label="Clips" className="clips-list">
      {timelineOrder(clips, rows).map((clip) => (
        <li key={clip.id}>
          <button type="button" onClick={() => onPick(clip)}>
            {`${clip.name}, ${timecode(parsed, clip.start_frame)} to ${timecode(parsed, clip.end_frame)}`}
          </button>
        </li>
      ))}
    </ul>
  );
}
