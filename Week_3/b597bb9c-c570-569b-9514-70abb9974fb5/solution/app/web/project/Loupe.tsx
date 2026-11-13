import { useLayoutEffect, useRef, type ReactNode } from "react";
import { timecode } from "../../shared/timecode";
import { reducedMotion } from "./context";
import type { FrameRate } from "../../shared/rational";
import type { Caption, Clip, Comment } from "../../shared/types";
import { rateOfState, ppf, type LoupeState, type ProjectState } from "./state";

const WIDTH = 360;
const HEIGHT = 96;
const GAP = 16;
const CELLS = 9;

interface Mark {
  type: "clip-edge" | "keyframe" | "caption-edge" | "pin";
  frame: number;
}

/** What the loupe reads: the timeline items to mark, and the canvas scale to place itself by. */
export interface LoupeSource {
  clips: readonly Clip[];
  captions: readonly Caption[];
  comments: readonly Comment[];
  rate: FrameRate;
  first: number;
  zoom: number;
}

export const loupeSourceOf = (state: ProjectState): LoupeSource => ({
  clips: state.clips,
  captions: state.captions,
  comments: state.comments,
  rate: rateOfState(state),
  first: state.first,
  zoom: state.zoom,
});

function marksOf(state: LoupeSource): Mark[] {
  const marks: Mark[] = [];
  for (const clip of state.clips) {
    marks.push({ type: "clip-edge", frame: clip.start_frame }, { type: "clip-edge", frame: clip.end_frame });
    for (const diamonds of Object.values(clip.keyframes)) {
      for (const diamond of diamonds ?? []) marks.push({ type: "keyframe", frame: clip.start_frame + diamond.frame });
    }
  }
  for (const caption of state.captions) marks.push({ type: "caption-edge", frame: caption.start_frame }, { type: "caption-edge", frame: caption.end_frame });
  for (const comment of state.comments) if (!comment.parent_id) marks.push({ type: "pin", frame: comment.pin.live_frame });
  return marks;
}

/** The nine-cell Frame Loupe, 360 by 96, centred on the frame under the pointer or the pinned frame. */
export function Loupe({ state, skim, anchor }: { state: LoupeSource; skim: LoupeState; anchor: DOMRect | null }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const rate = state.rate;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion()) return;
    element.animate(
      [
        { opacity: 0, transform: "scale(0.96)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 70, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, []);

  const centreX = skim.pointer ? skim.pointer.x : anchor ? anchor.left + (skim.frame - state.first) * ppf(state.zoom) : WIDTH / 2;
  const left = Math.min(Math.max(centreX - WIDTH / 2, 0), window.innerWidth - WIDTH);
  const bottom = skim.pointer ? skim.pointer.y - GAP : anchor ? anchor.top - GAP : HEIGHT + GAP;
  const marks = marksOf(state);
  const frames = Array.from({ length: CELLS }, (_, index) => skim.frame - Math.floor(CELLS / 2) + index);

  return (
    <div ref={ref} role="group" aria-label="Frame Loupe" data-loupe="" className="loupe" style={{ left, top: bottom - HEIGHT, width: WIDTH, height: HEIGHT }}>
      {frames.map((frame, index) => {
        const centre = index === Math.floor(CELLS / 2);
        return (
          <div key={index} data-loupe-frame={frame} {...(centre ? { "data-loupe-centre": "" } : {})} className={`loupe-cell${centre ? " centre" : ""}${frame < 0 ? " void" : ""}`}>
            {centre ? <span className="loupe-tc tnum">{timecode(rate, Math.max(0, frame))}</span> : null}
            {marks
              .filter((mark) => mark.frame === frame)
              .map((mark, markIndex) => (
                <span key={`${mark.type}-${markIndex}`} data-loupe-mark={mark.type} data-frame={frame} className={`loupe-mark ${mark.type}`} aria-hidden="true" />
              ))}
            {centre && skim.snapped ? <span data-snap-guide="" className="snap-guide" /> : null}
          </div>
        );
      })}
    </div>
  );
}
