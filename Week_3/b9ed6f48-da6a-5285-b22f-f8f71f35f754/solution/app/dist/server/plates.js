// Procedural plates (brief: Seed data › Chapters, "three procedurally generated plates"). Each
// plate is an engraving drawn in code from a seeded generator and encoded as PNG.
import { deflateSync } from "node:zlib";
const W = 1080;
const H = 720;
const GROUND = [20, 22, 15];
const INK = [222, 213, 192];
const STONE = [140, 136, 122];
function prng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
class Plate {
    ink = new Float32Array(W * H);
    stone = new Float32Array(W * H);
    paint(layer, x0, y0, x1, y1, coverage) {
        const ax = Math.max(0, Math.floor(x0));
        const ay = Math.max(0, Math.floor(y0));
        const bx = Math.min(W - 1, Math.ceil(x1));
        const by = Math.min(H - 1, Math.ceil(y1));
        for (let y = ay; y <= by; y++) {
            for (let x = ax; x <= bx; x++) {
                const c = coverage(x + 0.5, y + 0.5);
                if (c > 0)
                    layer[y * W + x] = Math.max(layer[y * W + x], Math.min(1, c));
            }
        }
    }
    line(x1, y1, x2, y2, width, layer = this.ink) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy || 1;
        const pad = width + 1;
        this.paint(layer, Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad, (x, y) => {
            const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
            const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
            return width / 2 + 0.5 - d;
        });
    }
    ring(cx, cy, r, width, layer = this.ink, wobble) {
        const pad = r + width + 12;
        this.paint(layer, cx - pad, cy - pad, cx + pad, cy + pad, (x, y) => {
            const radius = r + (wobble ? wobble(Math.atan2(y - cy, x - cx)) : 0);
            return width / 2 + 0.5 - Math.abs(Math.hypot(x - cx, y - cy) - radius);
        });
    }
    /** A disc filled with diagonal engraving hatch. */
    disc(cx, cy, r, layer = this.ink, pitch = 7) {
        this.paint(layer, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
            const inside = r + 0.5 - Math.hypot(x - cx, y - cy);
            if (inside <= 0)
                return 0;
            const phase = (x + y) % pitch;
            return Math.min(inside, phase < pitch * 0.38 ? 1 : 0);
        });
    }
    rect(x, y, w, h, width, layer = this.ink) {
        this.line(x, y, x + w, y, width, layer);
        this.line(x + w, y, x + w, y + h, width, layer);
        this.line(x + w, y + h, x, y + h, width, layer);
        this.line(x, y + h, x, y, width, layer);
    }
    /** Horizontal engraving rules shaded by a tone field in [0, 1]. */
    field(tone, layer = this.stone, pitch = 9) {
        this.paint(layer, 0, 0, W, H, (x, y) => {
            const centre = Math.abs((y % pitch) - pitch / 2);
            return tone(x, y) * (pitch / 2) - centre + 0.5;
        });
    }
    curve(fn, steps, width, layer = this.ink) {
        let [px, py] = fn(0);
        for (let i = 1; i <= steps; i++) {
            const [x, y] = fn(i / steps);
            this.line(px, py, x, y, width, layer);
            [px, py] = [x, y];
        }
    }
    png() {
        const raw = Buffer.alloc((W * 3 + 1) * H);
        for (let y = 0; y < H; y++) {
            raw[y * (W * 3 + 1)] = 0;
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const vignette = 1 - 0.35 * Math.hypot((x - W / 2) / W, (y - H / 2) / H);
                const o = y * (W * 3 + 1) + 1 + x * 3;
                for (let c = 0; c < 3; c++) {
                    const base = GROUND[c] * vignette;
                    const withStone = base + (STONE[c] - base) * this.stone[i] * 0.4;
                    raw[o + c] = Math.round(withStone + (INK[c] - withStone) * this.ink[i]);
                }
            }
        }
        return encodePng(raw);
    }
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(data) {
    let c = 0xffffffff;
    for (const byte of data)
        c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}
function encodePng(raw) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(W, 0);
    header.writeUInt32BE(H, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const gears = (p, rand) => {
    for (let i = 0; i < 5; i++) {
        const cx = 260 + i * 150 + rand() * 40;
        const cy = 300 + (i % 2) * 150;
        const r = 70 + rand() * 60;
        const teeth = Math.round(r / 7);
        p.curve((t) => {
            const a = t * Math.PI * 2;
            const tooth = (t * teeth) % 1;
            const radius = r + (tooth > 0.15 && tooth < 0.55 ? 10 : 0) + (tooth > 0.1 && tooth <= 0.15 ? (tooth - 0.1) * 200 : 0) + (tooth >= 0.55 && tooth < 0.6 ? (0.6 - tooth) * 200 : 0);
            return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
        }, teeth * 24, 2.5);
        p.ring(cx, cy, r * 0.55, 1.5);
        p.disc(cx, cy, r * 0.18);
        for (let s = 0; s < 6; s++)
            p.line(cx, cy, cx + Math.cos((s * Math.PI) / 3) * r * 0.55, cy + Math.sin((s * Math.PI) / 3) * r * 0.55, 1.2, p.stone);
    }
};
const columns = (p, rand) => {
    for (let c = 0; c < 7; c++) {
        const x = 170 + c * 110;
        const depth = 3 + Math.floor(rand() * 5);
        for (let r = 0; r < depth; r++)
            p.rect(x, 140 + r * 60 + c * 18, 80, 40, 2);
        p.line(x + 40, 120, x + 40, 160 + depth * 60 + c * 18, 1, p.stone);
    }
};
const lattice = (p, rand) => {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 16; c++) {
            const x = 150 + c * 50;
            const y = 150 + r * 50;
            if (rand() > 0.55)
                p.disc(x, y, 12);
            else
                p.ring(x, y, 12, 1.5, p.stone);
        }
    }
    p.rect(120, 120, 810, 470, 2.5);
};
const relays = (p, rand) => {
    const nodes = Array.from({ length: 14 }, () => [140 + rand() * 800, 120 + rand() * 480]);
    nodes.forEach(([x, y], i) => {
        const [nx, ny] = nodes[(i + 3) % nodes.length];
        p.line(x, y, nx, y, 2);
        p.line(nx, y, nx, ny, 2);
        p.ring(x, y, 14, 2);
        if (i % 2)
            p.disc(x, y, 8);
    });
};
const gate = (p) => {
    p.curve((t) => [300 + t * 480, 360 + Math.sin(t * Math.PI) * -220], 80, 3);
    p.curve((t) => [300 + t * 480, 360 + Math.sin(t * Math.PI) * 220], 80, 3);
    p.line(120, 290, 330, 290, 3);
    p.line(120, 430, 330, 430, 3);
    p.line(780, 360, 960, 360, 3);
    p.disc(540, 360, 40);
};
const tape = (p, rand) => {
    for (let i = 0; i < 13; i++) {
        const x = 90 + i * 70;
        p.rect(x, 300, 64, 110, 2);
        if (rand() > 0.45)
            p.disc(x + 32, 355, 16);
    }
    p.curve((t) => [520 + Math.cos(t * Math.PI * 2) * 60, 210 + Math.sin(t * Math.PI * 2) * 30], 60, 2.5);
    p.line(520, 240, 520, 296, 3);
};
const memory = (p, rand) => {
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 10; c++) {
            const x = 140 + c * 82;
            const y = 140 + r * 76;
            p.rect(x, y, 70, 60, 1.5, c < 4 ? p.ink : p.stone);
            if (rand() > 0.6)
                p.line(x + 10, y + 30, x + 60, y + 30, 3);
        }
    }
};
const net = (p, rand) => {
    const layers = [4, 6, 3];
    const pos = layers.map((n, l) => Array.from({ length: n }, (_, i) => [220 + l * 320, 360 + (i - (n - 1) / 2) * 90]));
    for (let l = 0; l < 2; l++)
        for (const a of pos[l])
            for (const b of pos[l + 1])
                p.line(a[0], a[1], b[0], b[1], rand() > 0.5 ? 2 : 0.8, rand() > 0.3 ? p.stone : p.ink);
    for (const layer of pos)
        for (const [x, y] of layer)
            p.disc(x, y, 22);
};
const loop = (p) => {
    p.curve((t) => [540 + Math.cos(t * Math.PI * 6) * (260 - t * 200), 360 + Math.sin(t * Math.PI * 6) * (200 - t * 150)], 400, 2.5);
    p.disc(540, 360, 26);
};
const wave = (p) => {
    p.curve((t) => [80 + t * 920, 360 - Math.exp(-t * 4) * Math.cos(t * 40) * 240], 600, 3);
    p.curve((t) => [80 + t * 920, 360 - Math.exp(-t * 4) * 240], 200, 1, p.stone);
    p.curve((t) => [80 + t * 920, 360 + Math.exp(-t * 4) * 240], 200, 1, p.stone);
};
const screens = (p) => {
    p.rect(160, 180, 300, 360, 3);
    p.rect(620, 180, 300, 360, 3);
    p.ring(310, 320, 60, 3);
    p.ring(770, 320, 60, 3, p.ink, (a) => Math.sin(a * 8) * 6);
    p.line(540, 120, 540, 600, 2, p.stone);
};
const textLines = (p, rand) => {
    for (let r = 0; r < 12; r++) {
        const w = 300 + rand() * 500;
        p.line(160, 130 + r * 40, 160 + w, 130 + r * 40, r % 2 ? 2 : 5, r % 2 ? p.stone : p.ink);
    }
};
const table = (p) => {
    p.ring(540, 360, 250, 3, p.ink, (a) => Math.cos(a * 2) * 40);
    for (let i = 0; i < 10; i++)
        p.disc(540 + Math.cos((i / 10) * Math.PI * 2) * 330, 360 + Math.sin((i / 10) * Math.PI * 2) * 250, 24);
};
const tree = (p, rand) => {
    const branch = (x, y, angle, len, depth) => {
        const nx = x + Math.cos(angle) * len;
        const ny = y + Math.sin(angle) * len;
        p.line(x, y, nx, ny, Math.max(1, depth * 1.2));
        p.ring(nx, ny, 6, 1.5);
        if (depth > 0) {
            branch(nx, ny, angle - 0.45 - rand() * 0.2, len * 0.72, depth - 1);
            branch(nx, ny, angle + 0.45 + rand() * 0.2, len * 0.72, depth - 1);
        }
    };
    branch(540, 660, -Math.PI / 2, 150, 5);
};
const spectrum = (p, rand) => {
    for (let i = 0; i < 46; i++) {
        const x = 110 + i * 19;
        const h = 30 + Math.pow(rand(), 2.5) * 420;
        p.line(x, 600, x, 600 - h, i % 5 === 0 ? 4 : 2);
    }
    p.line(90, 602, 990, 602, 2, p.stone);
};
const orderedBars = (p) => {
    for (let i = 0; i < 6; i++) {
        p.rect(200, 130 + i * 82, 680, 56, i === 1 ? 4 : 1.5, i === 1 ? p.ink : p.stone);
        p.disc(240, 158 + i * 82, 12);
    }
};
const scatter = (p, rand) => {
    for (let i = 0; i < 40; i++) {
        const signal = i % 2 === 0;
        const x = signal ? 600 + rand() * 340 : 140 + rand() * 340;
        const y = signal ? 130 + rand() * 300 : 300 + rand() * 300;
        if (signal)
            p.disc(x, y, 12);
        else
            p.ring(x, y, 11, 2.5);
    }
    p.line(320, 650, 820, 70, 3);
};
const rods = (p, rand) => {
    for (let i = 0; i < 9; i++) {
        const len = 80 + rand() * 300;
        p.line(180 + i * 90, 560, 180 + i * 90, 560 - len, 10);
        p.disc(180 + i * 90, 560 - len, 14, p.stone);
    }
};
const frost = (p, rand) => {
    for (let k = 0; k < 4; k++) {
        const cx = 220 + k * 220;
        const cy = 260 + (k % 2) * 220;
        for (let a = 0; a < 6; a++) {
            const angle = (a * Math.PI) / 3;
            const len = 70 + rand() * 50;
            p.line(cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, 2.5);
            for (let s = 1; s <= 3; s++) {
                const bx = cx + Math.cos(angle) * len * (s / 4);
                const by = cy + Math.sin(angle) * len * (s / 4);
                p.line(bx, by, bx + Math.cos(angle + 0.7) * 20, by + Math.sin(angle + 0.7) * 20, 1.5);
                p.line(bx, by, bx + Math.cos(angle - 0.7) * 20, by + Math.sin(angle - 0.7) * 20, 1.5);
            }
        }
    }
};
const stars = (p, rand) => {
    const pts = Array.from({ length: 18 }, () => [140 + rand() * 800, 110 + rand() * 500]);
    pts.forEach(([x, y], i) => {
        const [nx, ny] = pts[(i * 7 + 3) % pts.length];
        if (i % 3)
            p.line(x, y, nx, ny, 1, p.stone);
        p.disc(x, y, 6 + rand() * 10);
    });
};
const angle = (p) => {
    p.line(200, 600, 900, 520, 3);
    p.line(200, 600, 760, 160, 3);
    p.curve((t) => [200 + Math.cos(-0.11 - t * 0.55) * 260, 600 + Math.sin(-0.11 - t * 0.55) * 260], 80, 2, p.stone);
    p.disc(200, 600, 16);
};
const pull = (p) => {
    p.line(200, 600, 520, 200, 3);
    p.line(520, 200, 860, 300, 3, p.stone);
    p.line(200, 600, 860, 300, 4);
    for (const [x, y] of [[860, 300], [520, 200]])
        p.disc(x, y, 18);
    p.ring(860, 300, 60, 1.5, p.stone);
};
const MOTIFS = [
    [gears, columns, lattice],
    [lattice, relays, gate],
    [tape, memory, memory],
    [net, loop, wave],
    [screens, textLines, table],
    [tree, spectrum, orderedBars],
    [scatter, rods, frost],
    [stars, angle, pull],
];
/** Plate `index` (0..2) of chapter `number` (1..8), as PNG bytes. */
export function plateImage(number, index) {
    const plate = new Plate();
    const rand = prng(number * 97 + index * 13);
    plate.field((x, y) => 0.12 + 0.16 * Math.sin((x + number * 40) / 170 + Math.cos((y - index * 60) / 210) * 1.4));
    MOTIFS[number - 1][index](plate, rand);
    return plate.png();
}
