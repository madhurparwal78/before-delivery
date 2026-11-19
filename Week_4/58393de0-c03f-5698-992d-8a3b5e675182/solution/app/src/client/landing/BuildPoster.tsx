import { Play } from "lucide-react";
import { hasWebGL } from "../render";
import { fitCanvas } from "./gl";
import { LoopToggle } from "./LoopToggle";
import { usePlayback, useLoop } from "./loop";
import { ToyStill } from "./stills";
import { BUILD_FINISHED_MS, BUILD_LOOP_MS, sharedToyRig } from "./toyRig";
import { POSTER_BOX, POSTER_VIEW } from "./views";

/**
 * The live build poster card: a procedural build of the hero scene. The wedge drops in, the cylinder rises, the box
 * appears and the hole carves through it. Without WebGL it is the finished picture as an SVG with no controls.
 */
export function BuildPoster() {
  const live = hasWebGL();
  const { playing, toggle } = usePlayback(live);
  const { ref } = useLoop<HTMLCanvasElement>({
    playing, periodMs: BUILD_LOOP_MS, restMs: BUILD_FINISHED_MS, frameGapMs: 33,
    paint: (ms, canvas) => {
      if (fitCanvas(canvas)) sharedToyRig().draw(canvas, POSTER_VIEW, ms);
    },
  });
  return (
    <section className="poster" aria-label="Build preview">
      <div className="poster-stage" data-playing={String(playing)}>
        {live
          ? <canvas ref={ref} className="preview-canvas" aria-hidden="true" />
          : <ToyStill className="preview-canvas" layout={POSTER_VIEW.layout} framing={POSTER_VIEW.framing} width={POSTER_BOX.width} height={POSTER_BOX.height} ground="var(--surface)" />}
      </div>
      {live ? (
        <>
          <button type="button" className="poster-play" aria-label="Play build preview" hidden={playing} onClick={toggle}>
            <Play size={22} fill="currentColor" aria-hidden="true" />
          </button>
          <LoopToggle label="Pause build preview" playing={playing} onToggle={toggle} className="loop-toggle--corner" />
        </>
      ) : null}
    </section>
  );
}
