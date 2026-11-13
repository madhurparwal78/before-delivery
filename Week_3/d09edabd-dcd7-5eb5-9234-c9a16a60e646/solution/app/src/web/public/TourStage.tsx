import '../styles/chrome.css';
import { useEffect, useRef, useState } from 'react';
import { FloorPlan } from '../ui/FloorPlan';
import { RoomView, webglSupported } from '../three/roomView';
import { cameraAt, scrollProgress } from './tour';
import { cuePoints, VAULT_DIMS, VAULT_PLACEMENTS } from './vault';

function TourCanvas({ lit }: { lit: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<RoomView | null>(null);

  useEffect(() => {
    const target = canvas.current!;
    const room = new RoomView(target);
    room.setRoom(VAULT_DIMS);
    room.setPlacements(VAULT_PLACEMENTS);
    const aim = (): void => room.setPose(cameraAt(scrollProgress(), target.clientWidth / target.clientHeight));
    const fit = (): void => {
      room.setSize(target.clientWidth, target.clientHeight, window.devicePixelRatio);
      aim();
    };
    fit();
    const settled = requestAnimationFrame(fit); // measure again once the first layout has settled
    const resized = new ResizeObserver(fit);
    resized.observe(target);
    window.addEventListener('scroll', aim, { passive: true });
    view.current = room;
    return () => {
      cancelAnimationFrame(settled);
      resized.disconnect();
      window.removeEventListener('scroll', aim);
      view.current = null;
      room.dispose();
    };
  }, []);

  useEffect(() => {
    view.current?.setCues(cuePoints(lit));
  }, [lit]);

  return <canvas ref={canvas} aria-hidden="true" />;
}

function TourPlan() {
  return (
    <>
      <p className="stage-notice">3D view unavailable on this device. Showing the floor plan.</p>
      <div className="stage-plan">
        <FloorPlan dims={VAULT_DIMS} placements={VAULT_PLACEMENTS} label="Vault floor plan" />
      </div>
    </>
  );
}

/** The full-window stage behind the page: the Vault in 3D, or its flat floor plan when the browser has no WebGL. */
export function TourStage({ lit }: { lit: number }) {
  const [webgl] = useState(webglSupported);
  return <div className="stage-region tour-stage">{webgl ? <TourCanvas lit={lit} /> : <TourPlan />}</div>;
}
