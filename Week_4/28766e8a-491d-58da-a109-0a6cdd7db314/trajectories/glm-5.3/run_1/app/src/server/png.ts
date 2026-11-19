import sharp from 'sharp';

/** Render the export SVG to a PNG of the requested size. */
export async function renderPng(
  svg: string, width: number, height: number, scale: number, transparent: boolean,
): Promise<Buffer> {
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  const pipeline = sharp(Buffer.from(svg, 'utf8'), { density: Math.max(72, Math.round(72 * scale)) });
  if (transparent) {
    return pipeline.resize(targetWidth, targetHeight).png().toBuffer();
  }
  return pipeline.resize(targetWidth, targetHeight).flatten({ background: '#ffffff' }).png().toBuffer();
}
