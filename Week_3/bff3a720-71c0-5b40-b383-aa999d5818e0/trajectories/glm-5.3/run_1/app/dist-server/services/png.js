import zlib from 'zlib';
/**
 * Tiny PNG writer (truecolor, no interlace) for the generated photos and ID
 * documents that grading setup and seeding place in MinIO.
 */
export function writePng(width, height, rgb) {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        const rowStart = y * (width * 3 + 1);
        raw[rowStart] = 0;
        rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const chunks = [];
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    chunks.push(chunk('IHDR', ihdr));
    chunks.push(chunk('IDAT', zlib.deflateSync(raw)));
    chunks.push(chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat([signature, ...chunks]);
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
/** A small identicon-style PNG seeded by a string. */
export function generatedPng(seed, width = 64, height = 64) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const q = ((x >> 3) + (y >> 3) + ((h >>> ((x + y) % 28)) & 1)) & 3;
            const o = (y * width + x) * 3;
            rgb[o] = 70 + q * 30;
            rgb[o + 1] = 82 + q * 24;
            rgb[o + 2] = 88 + q * 26;
        }
    }
    return writePng(width, height, rgb);
}
