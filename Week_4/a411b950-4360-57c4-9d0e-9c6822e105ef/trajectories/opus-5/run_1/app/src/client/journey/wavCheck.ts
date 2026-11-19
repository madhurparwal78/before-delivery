export const REFERENCE_SIZE_LIMIT = 10_000_000;
const SAMPLE_RATE_MIN = 22_050;
const SAMPLE_RATE_MAX = 96_000;

export type ReferenceCheck =
  | { outcome: 'send' }
  | { outcome: 'rejected'; reason: 'size' | 'format' | 'channels' | 'sample-rate' | 'decode' };

type WavHeader = { formatCode: number; channels: number; sampleRate: number } | null;

function ascii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    if (offset + index >= view.byteLength) return '';
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

export function isRiffWave(view: DataView): boolean {
  return ascii(view, 0, 4) === 'RIFF' && ascii(view, 8, 4) === 'WAVE';
}

function readFormatChunk(view: DataView): WavHeader {
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= view.byteLength) {
      let formatCode = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      if (formatCode === 0xfffe) {
        if (body + 26 > view.byteLength) return null;
        formatCode = view.getUint16(body + 24, true);
      }
      return { formatCode, channels, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** The checks run in order and stop at the first failure, exactly as the brief form promises. */
export async function checkReferenceFile(file: File): Promise<ReferenceCheck> {
  if (file.size > REFERENCE_SIZE_LIMIT) return { outcome: 'rejected', reason: 'size' };

  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  if (!isRiffWave(view)) return { outcome: 'send' };

  const header = readFormatChunk(view);
  if (header === null || (header.formatCode !== 1 && header.formatCode !== 3)) {
    return { outcome: 'rejected', reason: 'format' };
  }
  if (header.channels !== 1 && header.channels !== 2) return { outcome: 'rejected', reason: 'channels' };
  if (header.sampleRate < SAMPLE_RATE_MIN || header.sampleRate > SAMPLE_RATE_MAX) {
    return { outcome: 'rejected', reason: 'sample-rate' };
  }

  try {
    const offline = new OfflineAudioContext(header.channels, 1, header.sampleRate);
    await offline.decodeAudioData(bytes.slice(0));
  } catch {
    return { outcome: 'rejected', reason: 'decode' };
  }
  return { outcome: 'send' };
}
