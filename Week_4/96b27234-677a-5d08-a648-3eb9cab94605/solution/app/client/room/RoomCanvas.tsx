import { useEffect, useRef, useState } from "react";
import type { Layout, PersonView } from "../../shared/protocol";
import { MiniRoom } from "../ui/Drawings";
import { RoomScene } from "./scene";
import type { Ripple } from "./useRoom";

/** The WebGL room, or the plain text and a drawn room when the browser has no WebGL. */
export function RoomCanvas({ layout, people, selfId, ripple, reduced }: { layout: Layout; people: PersonView[]; selfId: string; ripple: Ripple; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<RoomScene | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    let made: RoomScene;
    try {
      made = new RoomScene(element);
    } catch {
      setUnavailable(true);
      return undefined;
    }
    scene.current = made;
    const observer = new ResizeObserver(() => made.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      made.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setReduced(reduced);
  }, [reduced]);

  useEffect(() => {
    scene.current?.setLayout(layout);
    scene.current?.setPeople(people, selfId);
  }, [layout, people, selfId]);

  useEffect(() => {
    scene.current?.setRipple(ripple.at, ripple.radius, ripple.phase, layout);
  }, [ripple, layout]);

  if (unavailable) {
    return (
      <div className="canvas-frame fallback">
        <MiniRoom />
        <p role="status">3D view unavailable. Everything else still works.</p>
      </div>
    );
  }
  return (
    <div className="canvas-frame">
      <canvas ref={canvas} role="img" aria-label="Room view" className="room-canvas" />
    </div>
  );
}
