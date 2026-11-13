import { parentPort } from 'node:worker_threads';
import {
  decodeUpright,
  readColourProfileDescription,
  readPhotoHeader,
  renderDisplayCrop,
  sniffPhotoType,
} from './domain/photo.js';
import { computedSwatchArea, eyedropperArea, measureSwatch, srgbConverter } from './domain/swatch.js';

/**
 * Pixel work runs here, off the request thread, so that decoding a photograph never holds
 * up the rest of the server.
 */

export interface AnalyseRequest {
  id: number;
  bytes: Uint8Array;
  point: { x: number; y: number } | null;
  wantDisplayCrop: boolean;
}

export interface AnalyseResult {
  id: number;
  ok: true;
  width: number;
  height: number;
  swatch: string;
  display: Uint8Array | null;
}

export interface AnalyseFailure {
  id: number;
  ok: false;
  reason: 'undecodable';
}

const port = parentPort;
if (!port) throw new Error('the image worker must run as a worker thread');

port.on('message', (request: AnalyseRequest) => {
  try {
    port.postMessage(analyse(request));
  } catch {
    const failure: AnalyseFailure = { id: request.id, ok: false, reason: 'undecodable' };
    port.postMessage(failure);
  }
});

function analyse(request: AnalyseRequest): AnalyseResult {
  const type = sniffPhotoType(request.bytes);
  if (!type) throw new Error('not a JPEG or PNG');
  const header = readPhotoHeader(request.bytes, type);
  if (!header) throw new Error('no readable header');
  const image = decodeUpright(request.bytes, type, header.orientation);
  const convert = srgbConverter(readColourProfileDescription(request.bytes, type));
  const area = request.point
    ? eyedropperArea(image.width, image.height, request.point.x, request.point.y)
    : computedSwatchArea(image.width, image.height);
  const swatch = measureSwatch(image, area, convert);
  const display = request.wantDisplayCrop
    ? new Uint8Array(renderDisplayCrop(image, convert))
    : null;
  return { id: request.id, ok: true, width: image.width, height: image.height, swatch, display };
}
