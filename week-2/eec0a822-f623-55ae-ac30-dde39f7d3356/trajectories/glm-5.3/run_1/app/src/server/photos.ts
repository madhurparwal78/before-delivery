import { jpegInfo, type JpegInfo } from './jpeg.js';
import { pngInfo, pngRender } from './png.js';

export type ImageType = 'jpeg' | 'png';

export interface CleanImage {
  type: ImageType;
  bytes: Buffer;
  width: number;
  height: number;
}

function isSideways(orientation: number | null): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

export function parseImage(buf: Buffer): CleanImage | null {
  if (buf.length < 8) return null;
  const jpeg = jpegInfo(buf);
  if (jpeg) return { type: 'jpeg', bytes: buf, width: isSideways(jpeg.exifOrientation) ? jpeg.height : jpeg.width, height: isSideways(jpeg.exifOrientation) ? jpeg.width : jpeg.height };
  if (pngInfo(buf)) {
    const rendered = pngRender(buf);
    if (!rendered) return { type: 'png', bytes: buf, width: 0, height: 0 };
    return { type: 'png', bytes: rendered, width: rendered.readUInt32BE(16), height: rendered.readUInt32BE(20) };
  }
  return null;
}
