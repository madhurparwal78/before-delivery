import { useEffect, useState, type RefObject } from 'react';
import { RoomView, type Marker, type RoomDims } from '../three/roomView';

/** The 3D stage on a canvas: sized to it, showing the room and the other testers. Null until it exists. */
export function useRoomView(canvas: RefObject<HTMLCanvasElement | null>, room: RoomDims, markers: Marker[]): RoomView | null {
  const [view, setView] = useState<RoomView | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const created = new RoomView(element);
    const fit = (): void => created.setSize(element.clientWidth, element.clientHeight, window.devicePixelRatio);
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    setView(created);
    return () => {
      observer.disconnect();
      created.dispose();
      setView(null);
    };
  }, [canvas]);

  useEffect(() => view?.setRoom(room), [view, room]);
  useEffect(() => view?.setMarkers(markers), [view, markers]);
  return view;
}
