// Upload checks: file types are judged by their bytes, never by name or declared type.

import { fail, invalid } from "./http.js";

type AudioFormat = "wav" | "ogg";
export type ReferenceFormat = AudioFormat | "mp3" | "pdf";

interface AudioInfo {
  format: AudioFormat;
  channels: number;
  sampleRate: number;
  durationMs: number;
}

const STEM_LIMIT_BYTES = 20_000_000;
const REFERENCE_LIMIT_BYTES = 10_000_000;

export const CONTENT_TYPES: Record<ReferenceFormat, string> = {
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
};

function readWav(data: Buffer): AudioInfo | null {
  if (data.length < 12 || data.toString("latin1", 0, 4) !== "RIFF" || data.toString("latin1", 8, 12) !== "WAVE") {
    return null;
  }
  let offset = 12;
  let format: { tag: number; channels: number; rate: number; blockAlign: number } | null = null;
  while (offset + 8 <= data.length) {
    const id = data.toString("latin1", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= data.length) {
      let tag = data.readUInt16LE(body);
      if (tag === 0xfffe && size >= 40 && body + 26 <= data.length) tag = data.readUInt16LE(body + 24);
      format = {
        tag,
        channels: data.readUInt16LE(body + 2),
        rate: data.readUInt32LE(body + 4),
        blockAlign: data.readUInt16LE(body + 12),
      };
    } else if (id === "data") {
      if (!format || (format.tag !== 1 && format.tag !== 3) || format.blockAlign === 0 || format.rate === 0) return null;
      const length = Math.min(size, data.length - body);
      const frames = Math.floor(length / format.blockAlign);
      return {
        format: "wav",
        channels: format.channels,
        sampleRate: format.rate,
        durationMs: Math.floor((frames * 1000) / format.rate),
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function readOgg(data: Buffer): AudioInfo | null {
  if (data.length < 28 || data.toString("latin1", 0, 4) !== "OggS") return null;
  const packet = 27 + (data[26] ?? 0);
  if (packet + 16 > data.length) return null;
  let channels: number;
  let sampleRate: number;
  let granuleRate: number;
  let preSkip = 0;
  if (data.toString("latin1", packet, packet + 7) === "\u0001vorbis") {
    channels = data[packet + 11] ?? 0;
    sampleRate = data.readUInt32LE(packet + 12);
    granuleRate = sampleRate;
  } else if (data.toString("latin1", packet, packet + 8) === "OpusHead") {
    channels = data[packet + 9] ?? 0;
    preSkip = data.readUInt16LE(packet + 10);
    sampleRate = data.readUInt32LE(packet + 12);
    granuleRate = 48_000;
  } else {
    return null;
  }
  const last = data.lastIndexOf("OggS");
  const granule = last + 14 <= data.length ? Number(data.readBigUInt64LE(last + 6)) : 0;
  const durationMs = granuleRate > 0 ? Math.max(0, Math.floor(((granule - preSkip) * 1000) / granuleRate)) : 0;
  return { format: "ogg", channels, sampleRate, durationMs };
}

function readAudio(data: Buffer): AudioInfo | null {
  return readWav(data) ?? readOgg(data);
}

/** A name answers 422 when empty, over 200 characters, or containing a slash, backslash, "..", NUL or control character. */
function checkFileName(field: string, name: string): void {
  if (name.length === 0 || [...name].length > 200 || /[/\\\u0000-\u001f\u007f]/u.test(name) || name.includes("..")) {
    invalid({ [field]: "File name is not allowed." });
  }
}

function unsupported(message: string): never {
  fail(415, "unsupported_media", message);
}

function tooLarge(limit: number): never {
  fail(413, "file_too_large", `The file is larger than ${limit.toLocaleString("en-US")} bytes.`);
}

function withinAudioLimits(info: AudioInfo, maxMs: number, minMs: number): boolean {
  return info.channels >= 1 && info.channels <= 2 && info.sampleRate >= 22_050 && info.sampleRate <= 96_000
    && info.durationMs >= minMs && info.durationMs <= maxMs;
}

/** A stem: a real WAV or Ogg Vorbis/Opus, mono or stereo, 22.05–96 kHz, 1–180 s, at most 20,000,000 bytes. */
export function checkStem(field: string, filename: string, data: Buffer): AudioInfo {
  if (data.length > STEM_LIMIT_BYTES) tooLarge(STEM_LIMIT_BYTES);
  const info = readAudio(data);
  if (!info) unsupported("That file isn’t a WAV or OGG stem.");
  if (!withinAudioLimits(info, 180_000, 1000)) {
    unsupported("A stem must be mono or stereo, 22,050 to 96,000 Hz and 1 to 180 seconds long.");
  }
  checkFileName(field, filename);
  return info;
}

/** A reference: WAV/Ogg up to 600 s, MP3 or PDF, at most 10,000,000 bytes. */
export function checkReference(field: string, filename: string, data: Buffer): ReferenceFormat {
  if (data.length > REFERENCE_LIMIT_BYTES) tooLarge(REFERENCE_LIMIT_BYTES);
  const audio = readAudio(data);
  let format: ReferenceFormat;
  if (audio) {
    if (!withinAudioLimits(audio, 600_000, 1)) unsupported("Reference audio must be up to 600 seconds long.");
    format = audio.format;
  } else if (data.toString("latin1", 0, 3) === "ID3" || ((data[0] ?? 0) === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0)) {
    format = "mp3";
  } else if (data.toString("latin1", 0, 5) === "%PDF-") {
    format = "pdf";
  } else {
    unsupported("That file type isn’t accepted. Send WAV, OGG, MP3 or PDF.");
  }
  checkFileName(field, filename);
  return format;
}
