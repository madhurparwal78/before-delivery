import { useEffect, useMemo, useRef, useState } from 'react';
import { FloorPlan } from '../ui/FloorPlan';
import { webglSupported, type Marker } from '../three/roomView';
import type { PlayNode, PlayView } from '../../shared/types';
import { stoodAt } from './walk';
import { useRoomView } from './useRoomView';
import { useWalker } from './useWalker';

interface Props {
  token: string;
  room: PlayView['room'];
  nodes: PlayNode[];
  markers: Marker[];
  /** The session runs, the tester has joined and no sheet is open. */
  walking: boolean;
  onApproach: (nodeId: string) => void;
}

const NO_WEBGL = '3D view unavailable on this device. Showing the floor plan.';

/** The Room stage: the room at player height, or its floor plan where WebGL is missing. */
export function PlayStage({ token, room, nodes, markers, walking, onApproach }: Props) {
  const [webgl] = useState(webglSupported);
  const stage = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dims = useMemo(() => ({ widthMm: room.widthMm, depthMm: room.depthMm, heightMm: room.heightMm }), [room.widthMm, room.depthMm, room.heightMm]);
  const view = useRoomView(canvas, dims, markers);
  const pushed = useWalker(stage, { token, view, room, nodes, enabled: walking, onApproach });
  const drawn = useMemo(() => room.placements.map((placement) => stoodAt(placement, pushed)), [room.placements, pushed]);
  useEffect(() => view?.setPlacements(drawn), [view, drawn]);

  return (
    <section ref={stage} className="stage-region" aria-label="Room stage">
      {webgl ? (
        <canvas ref={canvas} />
      ) : (
        <>
          <p className="stage-notice play-notice">{NO_WEBGL}</p>
          <div className="stage-plan">
            <FloorPlan dims={dims} placements={drawn} label="Floor plan of the room" />
          </div>
        </>
      )}
    </section>
  );
}
