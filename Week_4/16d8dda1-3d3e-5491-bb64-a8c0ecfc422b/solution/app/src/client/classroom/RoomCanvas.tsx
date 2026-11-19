import { useEffect, useLayoutEffect, useRef } from 'react';
import type { createScene } from '../scene';
import type { SceneInput } from '../scene/types';
import { useClassroom } from './context';

/** The WebGL canvas: the page creates the context, the scene module (loaded after the DOM is up) draws the room. */
export function RoomCanvas({ onUnavailable }: { onUnavailable: () => void }) {
  const { store, state, snapshot, reduced } = useClassroom();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Awaited<ReturnType<typeof createScene>> | null>(null);
  const latest = useRef<SceneInput>({ snapshot, event: state.event, receivedAt: state.receivedAt, reduced });
  latest.current = { snapshot, event: state.event, receivedAt: state.receivedAt, reduced };

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('webgl2') ?? element.getContext('webgl');
    if (!context) {
      onUnavailable();
      return;
    }
    let disposed = false;
    import('../scene')
      .then(({ createScene }) =>
        createScene(element, context, {
          onSeatPick: (seatId) => {
            if (latest.current.snapshot.you.role === 'learner') void store.takeSeat(seatId);
          },
        }),
      )
      .then((handle) => {
        if (disposed) {
          handle.dispose();
          return;
        }
        scene.current = handle;
        handle.update(latest.current);
      })
      .catch(() => {
        if (!disposed) onUnavailable();
      });
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [store, onUnavailable]);

  useEffect(() => {
    scene.current?.update(latest.current);
  }, [snapshot, state.event, reduced]);

  return <canvas ref={canvas} className="room-canvas" role="img" aria-label="Classroom view" />;
}
