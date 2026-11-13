import { createHash, createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";
import { config } from "./config.js";
import type { Sample } from "./types.js";
const hash = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();
export async function storage(
  method: string,
  key: string,
  body?: Buffer,
  type?: string,
): Promise<Response> {
  const base = new URL(config.s3Endpoint);
  const path =
    "/" +
    [...(config.s3PathStyle ? [config.s3Bucket] : []), ...key.split("/")]
      .map(encodeURIComponent)
      .join("/");
  if (!config.s3PathStyle)
    base.hostname = `${config.s3Bucket}.${base.hostname}`;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const payload = hash(body || Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: base.host,
    "x-amz-content-sha256": payload,
    "x-amz-date": date,
  };
  if (type) headers["content-type"] = type;
  const names = Object.keys(headers).sort();
  const signed = names.join(";");
  const canonical = [
    method,
    path,
    "",
    names.map((k) => `${k}:${headers[k]}\n`).join(""),
    signed,
    payload,
  ].join("\n");
  const scope = `${day}/${config.s3Region}/s3/aws4_request`;
  const keySig = hmac(
    hmac(hmac(hmac("AWS4" + config.s3SecretKey, day), config.s3Region), "s3"),
    "aws4_request",
  );
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKey}/${scope}, SignedHeaders=${signed}, Signature=${hmac(keySig, ["AWS4-HMAC-SHA256", date, scope, hash(canonical)].join("\n")).toString("hex")}`;
  const url = new URL(path, base);
  return fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
}
export async function putObject(
  key: string,
  body: Buffer,
  type: string,
): Promise<void> {
  const response = await storage("PUT", key, body, type);
  if (!response.ok) throw new StorageRefused();
}
export async function deleteObject(key: string): Promise<void> {
  const response = await storage("DELETE", key);
  if (!response.ok && response.status !== 404) throw new StorageRefused();
}
// A storage reply that is an error; an unreachable service throws from fetch instead.
export class StorageRefused extends Error {}
export const sampleRoute = "kestrel-2";
function sampleUrl(id: string, file: string): string {
  return `/media/samples/${sampleRoute}/${id}/${file}`;
}
export const sampleDefinitions: Sample[] = [
  {
    id: "pitch-contour",
    kind: "audio",
    title: "Pitch contour study",
    urls: [sampleUrl("pitch-contour", "clip.wav")],
  },
  {
    id: "rhythm-continuation",
    kind: "audio",
    title: "Rhythm continuation study",
    urls: [sampleUrl("rhythm-continuation", "clip.wav")],
  },
  {
    id: "denoise-sequence",
    kind: "image_sequence",
    title: "Denoising sequence",
    urls: Array.from({ length: 12 }, (_, i) =>
      sampleUrl(
        "denoise-sequence",
        `frame-${String(i + 1).padStart(2, "0")}.png`,
      ),
    ),
  },
];
function wav(rhythm = false): Buffer {
  const rate = 22050,
    seconds = 3,
    count = rate * seconds;
  const b = Buffer.alloc(44 + count * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(count * 2, 40);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    phase +=
      (2 * Math.PI * (rhythm ? 220 : 220 + 160 * Math.sin(t * 0.9))) / rate;
    const envelope =
      Math.sin((Math.PI * t) / seconds) ** 2 *
      (rhythm ? Math.exp(-((t * 4) % 1) * 8) : 1);
    b.writeInt16LE(Math.round(Math.sin(phase) * envelope * 11000), 44 + i * 2);
  }
  return b;
}
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer): Buffer {
  const n = Buffer.from(name);
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length);
  n.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([n, data])), 8 + data.length);
  return b;
}
function png(frame: number): Buffer {
  const width = 640,
    height = 360;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      const radial = Math.exp(
        -(((x - 320) / 180) ** 2 + ((y - 180) / 105) ** 2),
      );
      const wave =
        Math.sin(x * 0.035 + Math.sin(y * 0.03) * 2) * Math.cos(y * 0.035);
      // Paper-toned grain (120–240) rather than full-range static.
      const noise =
        120 +
        ((((Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>>
          0) %
          255) *
          120) /
          255;
      // Frame 1 shows a faint trace of the final structure under the grain; frame 12 is resolved.
      const amount = 0.25 + (0.75 * (frame - 1)) / 11;
      const v = Math.round(
        noise * (1 - amount) + (225 - radial * (90 + 70 * wave)) * amount,
      );
      raw[i] = Math.min(245, v + 8);
      raw[i + 1] = Math.min(242, v + 5);
      raw[i + 2] = Math.min(233, v);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function generatedSamples(): {
  key: string;
  body: Buffer;
  type: string;
}[] {
  return sampleDefinitions.flatMap((s) =>
    s.urls.map((url, i) => ({
      key: url.replace("/media/", ""),
      body:
        s.kind === "audio" ? wav(s.id === "rhythm-continuation") : png(i + 1),
      type: s.kind === "audio" ? "audio/wav" : "image/png",
    })),
  );
}
