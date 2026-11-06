/**
 * Decodes one photo in its own process, so a malformed file can never take the
 * server down. Reads the file on stdin and writes a JSON meta line followed by
 * the normalised JPEG on stdout. The decoder applies the camera orientation
 * while decoding, and re-encoding from pixels drops every metadata block.
 */
import canvasModule from '@napi-rs/canvas';

const { createCanvas, loadImage } = canvasModule;

const MAX_LONG_SIDE = 2_400;

type ImageFormat = 'jpeg' | 'png' | 'webp';

/** Formats are judged by decoded content, never by name or declared type. */
function sniffFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length > 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length > 12
    && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function run(): Promise<void> {
  const bytes = await readStdin();
  if (!sniffFormat(bytes)) {
    process.stdout.write(`${JSON.stringify({ ok: false })}\n`);
    return;
  }
  const image = await loadImage(bytes);
  if (!image.width || !image.height) {
    process.stdout.write(`${JSON.stringify({ ok: false })}\n`);
    return;
  }
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  const jpeg = canvas.encodeSync('jpeg', 86);
  process.stdout.write(`${JSON.stringify({ ok: true, width, height })}\n`);
  process.stdout.write(jpeg);
}

run().catch(() => {
  process.stdout.write(`${JSON.stringify({ ok: false })}\n`);
});
