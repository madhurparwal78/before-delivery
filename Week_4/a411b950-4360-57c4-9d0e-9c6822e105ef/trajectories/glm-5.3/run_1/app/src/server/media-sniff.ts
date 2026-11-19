/**
 * Sniffing real audio and document content by bytes, never by file name or
 * declared content type (DP-09, DP-19).
 */

export interface WavInfo {
  format: number;
  channels: number;
  sampleRate: number;
}

export function looksLikeWav(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
}

/** Reads the fmt chunk of a RIFF/WAVE file. Returns null when the chunk is missing. */
export function readWavInfo(bytes: Buffer): WavInfo | null {
  if (!looksLikeWav(bytes)) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      if (offset + 8 + 16 > bytes.length) return null;
      const audioFormat = bytes.readUInt16LE(offset + 8);
      const channels = bytes.readUInt16LE(offset + 10);
      const sampleRate = bytes.readUInt32LE(offset + 12);
      let format = audioFormat;
      if (audioFormat === 0xfffe) {
        const cbSize = bytes.readUInt16LE(offset + 24);
        if (cbSize >= 22 && offset + 8 + 40 <= bytes.length) {
          format = bytes.readUInt16LE(offset + 32 + 2);
        } else {
          return { format, channels, sampleRate };
        }
      }
      return { format, channels, sampleRate };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

export function isPcmOrFloatFormat(format: number): boolean {
  return format === 1 || format === 3;
}

export function looksLikeOgg(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  if (bytes.toString("ascii", 0, 4) !== "OggS") return false;
  // The first page must carry a Vorbis or Opus identification header.
  const payload = firstOggPagePayload(bytes);
  if (!payload) return false;
  if (payload.length >= 7 && payload.toString("ascii", 0, 7) === "\x01vorbis") return true;
  if (payload.length >= 8 && payload.toString("ascii", 0, 8) === "OpusHead") return true;
  return false;
}

function firstOggPagePayload(bytes: Buffer): Buffer | null {
  if (bytes.length < 27) return null;
  const headerSize = 27 + bytes[26];
  if (bytes.length < headerSize) return null;
  return bytes.subarray(headerSize, Math.min(bytes.length, headerSize + 64));
}

export function looksLikeMp3(bytes: Buffer): boolean {
  if (bytes.length < 3) return false;
  if (bytes.toString("ascii", 0, 3) === "ID3") return true;
  return (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || (bytes[0] === 0xff && bytes[1] === 0xfb);
}

export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-";
}

export function isWavOrOggAudioStem(bytes: Buffer): { format: "wav" | "ogg"; info: WavInfo } | null {
  if (looksLikeWav(bytes)) {
    const info = readWavInfo(bytes);
    if (!info) return null;
    if (!isPcmOrFloatFormat(info.format)) return null;
    if (info.channels !== 1 && info.channels !== 2) return null;
    if (info.sampleRate < 22050 || info.sampleRate > 96000) return null;
    return { format: "wav", info };
  }
  if (looksLikeOgg(bytes)) {
    return { format: "ogg", info: { format: 1, channels: 2, sampleRate: 44100 } };
  }
  return null;
}

export function isAcceptableReference(bytes: Buffer): { format: "wav" | "ogg" | "mp3" | "pdf" } | null {
  if (looksLikePdf(bytes)) return { format: "pdf" };
  if (looksLikeMp3(bytes)) return { format: "mp3" };
  if (looksLikeWav(bytes)) {
    const info = readWavInfo(bytes);
    if (info && isPcmOrFloatFormat(info.format) && (info.channels === 1 || info.channels === 2) && info.sampleRate >= 22050 && info.sampleRate <= 96000) {
      return { format: "wav" };
    }
    return null;
  }
  if (looksLikeOgg(bytes)) return { format: "ogg" };
  return null;
}

/** WAV duration in milliseconds, from the data chunk and the fmt chunk. */
export function wavDurationMs(bytes: Buffer): number | null {
  const info = readWavInfo(bytes);
  if (!info) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      const bytesPerSample = info.channels * 2;
      const frames = Math.floor(chunkSize / bytesPerSample);
      return Math.round((frames / info.sampleRate) * 1000);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

/** Ogg (Vorbis/Opus) duration in milliseconds, estimated from the last page's granule position. */
export function oggDurationMs(bytes: Buffer): number | null {
  if (bytes.length < 27) return null;
  const last = bytes.lastIndexOf(Buffer.from("OggS", "ascii"));
  if (last < 0 || last + 26 > bytes.length) return null;
  const granule = bytes.readBigUInt64LE(last + 6);
  const sampleRate = 48000;
  if (granule === 0xffffffffffffffffn) return null;
  return Number((granule * 1000n) / BigInt(sampleRate));
}

/** The single file-name rule (DP: Upload checks). */
export function isSafeFilename(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.includes("\0")) return false;
  return !/[\x00-\x1f]/.test(name);
}
