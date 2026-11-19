import { Pause, Play } from "lucide-react";

interface LoopToggleProps {
  /** The accessible name, always the pause wording; the pressed state says whether the loop is paused. */
  label: string;
  playing: boolean;
  onToggle: () => void;
  className?: string;
}

/** The small round pause toggle of a looping preview. It reports pressed while the loop is paused and then shows the play glyph. */
export function LoopToggle({ label, playing, onToggle, className = "" }: LoopToggleProps) {
  return (
    <button type="button" className={`loop-toggle ${className}`.trim()} aria-label={label} aria-pressed={!playing} onClick={onToggle}>
      <span className="loop-toggle-ring" aria-hidden="true">
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </span>
    </button>
  );
}
