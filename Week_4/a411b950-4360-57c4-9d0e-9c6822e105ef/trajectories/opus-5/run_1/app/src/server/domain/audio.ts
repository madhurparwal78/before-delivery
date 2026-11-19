export type AudioFormat = 'wav' | 'ogg';

export type AudioProbe = {
  format: AudioFormat;
  channels: number;
  sampleRate: number;
  durationMs: number;
};

export const SAMPLE_RATE_MIN = 22_050;
export const SAMPLE_RATE_MAX = 96_000;

function ascii(bytes: Buffer, offset: number, length: number): string {
  if (offset + length > bytes.length) return '';
  return bytes.toString('latin1', offset, offset + length);
}

function probeWav(bytes: Buffer): AudioProbe | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let byteRate = 0;
  let formatCode = 0;
  let dataBytes = -1;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      formatCode = bytes.readUInt16LE(body);
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      byteRate = bytes.readUInt32LE(body + 8);
      bitsPerSample = bytes.readUInt16LE(body + 14);
      if (formatCode === 0xfffe) {
        if (body + 40 > bytes.length) return null;
        formatCode = bytes.readUInt16LE(body + 24);
      }
    } else if (id === 'data') {
      dataBytes = Math.min(size, Math.max(0, bytes.length - body));
    }
    offset = body + size + (size % 2);
  }
  if (formatCode !== 1 && formatCode !== 3) return null;
  if (channels === 0 || sampleRate === 0 || bitsPerSample === 0) return null;
  const perSecond = byteRate > 0 ? byteRate : (channels * sampleRate * bitsPerSample) / 8;
  if (perSecond === 0 || dataBytes < 0) return null;
  return {
    format: 'wav',
    channels,
    sampleRate,
    durationMs: Math.round((dataBytes / perSecond) * 1000),
  };
}

type OggFirstPage = {
  codec: 'vorbis' | 'opus';
  channels: number;
  sampleRate: number;
  preSkip: number;
};

function readOggFirstPage(bytes: Buffer): OggFirstPage | null {
  if (ascii(bytes, 0, 4) !== 'OggS') return null;
  if (bytes.length < 27) return null;
  const segmentCount = bytes.readUInt8(26);
  const payload = 27 + segmentCount;
  if (ascii(bytes, payload, 1) === '\u0001' && ascii(bytes, payload + 1, 6) === 'vorbis') {
    if (payload + 16 > bytes.length) return null;
    return {
      codec: 'vorbis',
      channels: bytes.readUInt8(payload + 11),
      sampleRate: bytes.readUInt32LE(payload + 12),
      preSkip: 0,
    };
  }
  if (ascii(bytes, payload, 8) === 'OpusHead') {
    if (payload + 19 > bytes.length) return null;
    const declared = bytes.readUInt32LE(payload + 12);
    return {
      codec: 'opus',
      channels: bytes.readUInt8(payload + 9),
      sampleRate: declared === 0 ? 48_000 : declared,
      preSkip: bytes.readUInt16LE(payload + 10),
    };
  }
  return null;
}

function lastGranulePosition(bytes: Buffer): number {
  for (let offset = bytes.length - 27; offset >= 0; offset -= 1) {
    if (ascii(bytes, offset, 4) === 'OggS') {
      const granule = bytes.readBigUInt64LE(offset + 6);
      if (granule !== 0xffffffffffffffffn) return Number(granule);
    }
  }
  return 0;
}

function probeOgg(bytes: Buffer): AudioProbe | null {
  const head = readOggFirstPage(bytes);
  if (head === null || head.channels === 0) return null;
  const granule = lastGranulePosition(bytes);
  const samples = head.codec === 'opus' ? Math.max(0, granule - head.preSkip) : granule;
  const rate = head.codec === 'opus' ? 48_000 : head.sampleRate;
  return {
    format: 'ogg',
    channels: head.channels,
    sampleRate: head.sampleRate,
    durationMs: rate === 0 ? 0 : Math.round((samples / rate) * 1000),
  };
}

export function probeAudio(bytes: Buffer): AudioProbe | null {
  return probeWav(bytes) ?? probeOgg(bytes);
}

export function isMp3(bytes: Buffer): boolean {
  if (ascii(bytes, 0, 3) === 'ID3') return true;
  if (bytes.length < 2) return false;
  const first = bytes.readUInt8(0);
  const second = bytes.readUInt8(1);
  return first === 0xff && (second & 0xe0) === 0xe0;
}

export function isPdf(bytes: Buffer): boolean {
  return ascii(bytes, 0, 5) === '%PDF-';
}

export function hasAcceptedChannelsAndRate(probe: AudioProbe): boolean {
  if (probe.channels !== 1 && probe.channels !== 2) return false;
  return probe.sampleRate >= SAMPLE_RATE_MIN && probe.sampleRate <= SAMPLE_RATE_MAX;
}

/** A mono 16-bit PCM WAV built from samples in -1..1. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'latin1');
  buffer.write('fmt ', 12, 'latin1');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'latin1');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] as number));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  }
  return buffer;
}
