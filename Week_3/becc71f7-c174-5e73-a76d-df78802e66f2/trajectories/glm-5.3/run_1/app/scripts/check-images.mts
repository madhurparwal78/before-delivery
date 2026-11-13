// Image pipeline check (run with: node --experimental-strip-types scripts/check-images.mts)
import { sniffFormat, decodePhoto, encodeClean, targetSize, resample, contentTypeOf } from '../src/server/images.ts';

function gradient(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 255) / w;
      data[i + 1] = (y * 255) / h;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

let fails = 0;
function check(label: string, ok: boolean, extra = '') {
  if (!ok) { fails++; console.log(`FAIL ${label} ${extra}`); } else console.log(`ok   ${label}`);
}

// 1. Sniffing
check('jpeg magic', sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])) === 'jpeg');
check('png magic', sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === 'png');
check('webp magic', sniffFormat(new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50])) === 'webp');
check('not an image', sniffFormat(new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61])) === null);
check('text file', sniffFormat(new Uint8Array(Buffer.from('hello world this is not an image at all'))) === null);

// 2. Full round trips for each format
const g = gradient(64, 48);
const jpegEnc = await import('@jsquash/jpeg/encode.js');
await jpegEnc.init(await WebAssembly.compile((await import('node:fs')).readFileSync('/app/node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')));
const jpegBytes = new Uint8Array(await jpegEnc.default({ data: g.data, width: g.width, height: g.height }));

const webpEnc = await import('@jsquash/webp/encode.js');
await webpEnc.init(await WebAssembly.compile((await import('node:fs')).readFileSync('/app/node_modules/@jsquash/webp/codec/enc/webp_enc.wasm')));
const webpBytes = new Uint8Array(await webpEnc.default({ data: g.data, width: g.width, height: g.height }));

const { PNG } = await import('pngjs');
const pngBytes = new Uint8Array(PNG.sync.write({ width: g.width, height: g.height, data: Buffer.from(g.data) }));

for (const [name, bytes, want] of [['jpeg', jpegBytes, 'jpeg'], ['png', pngBytes, 'png'], ['webp', webpBytes, 'webp']] as const) {
  check(`${name} sniffs as ${want}`, sniffFormat(bytes) === want, `got ${sniffFormat(bytes)}`);
  const decoded = await decodePhoto(bytes, sniffFormat(bytes)!);
  check(`${name} decodes to ${g.width}x${g.height}`, decoded.width === g.width && decoded.height === g.height, `got ${decoded.width}x${decoded.height}`);
  const clean = await encodeClean(decoded);
  check(`${name} re-encodes`, sniffFormat(clean) === want, `got ${sniffFormat(clean)}`);
  check(`${name} clean copy has no metadata`, !hasExif(clean), 'metadata block found');
}

function hasExif(bytes: Uint8Array): boolean {
  // JPEG: look for APP1 with "Exif"
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i < Math.min(bytes.length - 4, 200); i += 1) {
      if (bytes[i] === 0xff && bytes[i+1] === 0xe1 && bytes[i+4] === 0x45 && bytes[i+5] === 0x78 && bytes[i+6] === 0x69 && bytes[i+7] === 0x66) return true;
    }
    return false;
  }
  // PNG: look for eXIf / tEXt / iTXt chunks
  if (bytes[0] === 0x89) {
    for (let i = 8; i < bytes.length - 4; i += 1) {
      const t = String.fromCharCode(bytes[i], bytes[i+1], bytes[i+2], bytes[i+3]);
      if (t === 'eXIf' || t === 'tEXt' || t === 'iTXt' || t === 'zTXt') return true;
    }
    return false;
  }
  return false;
}

// 3. Resizing
const big = gradient(2400, 1200);
const to = targetSize(big.width, big.height);
check('2400x1200 shrinks to 1600 long side', to.width === 1600 && to.height === 800, `got ${to.width}x${to.height}`);
const small = targetSize(800, 600);
check('800x600 stays', small.width === 800 && small.height === 600);
const portrait = targetSize(900, 3000);
check('portrait longest side', portrait.height === 1600 && portrait.width === 480, `got ${portrait.width}x${portrait.height}`);
const rs = resample(big, to);
check('resample output size', rs.width === 1600 && rs.height === 800);
check('resample data length', rs.data.length === 1600 * 800 * 4);

// 4. Content types
check('jpeg content type', contentTypeOf('jpeg') === 'image/jpeg');
check('png content type', contentTypeOf('png') === 'image/png');
check('webp content type', contentTypeOf('webp') === 'image/webp');

console.log(fails === 0 ? '\nALL IMAGE CHECKS PASS' : `\n${fails} IMAGE FAILURES`);
process.exit(fails === 0 ? 0 : 1);
