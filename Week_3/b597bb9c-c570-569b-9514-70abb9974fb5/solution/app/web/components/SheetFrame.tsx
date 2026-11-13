import type { ReactNode } from "react";
import { frameSize, layersAt } from "../../shared/layers";
import type { Clip, MediaDims, Row, AspectRatio } from "../../shared/types";
import { checksumColour } from "../lib/format";

interface Props {
  title: string;
  aspect: AspectRatio;
  frame: number;
  timecode: string;
  rows: Row[];
  clips: Clip[];
  media: Record<string, MediaDims>;
  projectId: string;
}

/** One frame of the contact sheet: the layer boxes at their computed positions, drawn from the shared box maths. */
export function SheetFrame({ title, aspect, frame, timecode, rows, clips, media, projectId }: Props): ReactNode {
  const size = frameSize(aspect);
  const layers = layersAt(frame, clips, rows, media, size);
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  return (
    <div
      role="img"
      aria-label={`${title} at ${timecode}`}
      data-sheet-frame=""
      data-project-id={projectId}
      className="sheet-frame"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <svg viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true" focusable="false">
        {layers.map((layer) => {
          const clip = byId.get(layer.clip_id);
          const fill = clip?.kind === "text" ? `#${clip.box_colour ?? "000000"}` : checksumColour(clip?.media_id ? (media[clip.media_id]?.sha256 ?? "000000") : "000000");
          return (
            <rect
              key={layer.clip_id}
              x={layer.x - layer.width / 2}
              y={layer.y - layer.height / 2}
              width={layer.width}
              height={layer.height}
              fill={fill}
              opacity={layer.opacity / 100}
              transform={`rotate(${layer.rotation} ${layer.x} ${layer.y})`}
            />
          );
        })}
      </svg>
    </div>
  );
}
