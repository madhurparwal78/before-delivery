import { RoomView, webglSupported, type DrawPlacement, type RoomDims } from './roomView';
import { overviewPose } from './poses';

let shared: RoomView | null = null;

/** Renders a room from its own primitives into a small canvas with the app's own 3D renderer; null without WebGL. */
export function renderThumbnail(dims: RoomDims, placements: DrawPlacement[], width = 320, height = 180): HTMLCanvasElement | null {
  if (!webglSupported()) return null;
  shared ??= new RoomView(document.createElement('canvas'), { thumbnail: true });
  shared.setSize(width, height, 1);
  shared.setRoom(dims);
  shared.setPlacements(placements);
  shared.setPose(overviewPose(dims, 32, 42, 0.92));
  shared.renderNow();
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  copy.getContext('2d')!.drawImage(shared.canvas, 0, 0, width, height);
  return copy;
}

export const toPng = (canvas: HTMLCanvasElement): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
