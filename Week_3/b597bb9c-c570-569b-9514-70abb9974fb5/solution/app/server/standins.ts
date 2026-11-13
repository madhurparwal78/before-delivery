import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const box = (type: string, payload: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
};

/** A small MP4 stand-in: ftyp, moov (mvhd v0 and one trak/tkhd) and a free box naming the file, with no mdat. */
export function mp4StandIn(name: string, width: number, height: number, timescale: number, duration: number): Buffer {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isom")]));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(duration, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(7, 0);
  tkhd.writeUInt32BE(1, 12);
  tkhd.writeUInt32BE(duration, 20);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const moov = box("moov", Buffer.concat([box("mvhd", mvhd), box("trak", box("tkhd", tkhd))]));
  return Buffer.concat([ftyp, moov, box("free", Buffer.from(name, "utf8"))]);
}

/** 16-bit mono PCM at 8,000 Hz: a 110 Hz sine whose amplitude rises steadily from 0 to half full scale. */
export function wavStandIn(samples: number): Buffer {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const amplitude = (16384 * i) / samples;
    data.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * 110 * i) / 8000)), i * 2);
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE(16000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const head = Buffer.alloc(8);
  head.write("fmt ", 0, "latin1");
  head.writeUInt32LE(16, 4);
  const dataHead = Buffer.alloc(8);
  dataHead.write("data", 0, "latin1");
  dataHead.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), head, fmt, dataHead, data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([head, typed, tail]);
}

/** A solid-colour PNG stand-in. */
export function pngStandIn(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const sha256Of = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
