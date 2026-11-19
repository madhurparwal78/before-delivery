import { deflateSync as zlibDeflate } from "node:zlib";
import type { Pool } from "pg";
import { DateTime } from "luxon";
import type { Config } from "./config.js";
import { StorageClient } from "./storage.js";

// The seed is inserted only when absent. Seeded covers are generated flat
// teal-on-paper PNG images stored in the bucket at first start.

interface SeedPerson {
  id: string;
  name: string;
  email: string;
  key: string;
}

const SEED_PEOPLE: readonly SeedPerson[] = [
  {
    id: "per_mara",
    name: "Mara Quillfeather",
    email: "mara@quillfeather.example",
    key: "dgk_mara_seed_4f1c0b7a9e2d4c68b3a1",
  },
  {
    id: "per_ines",
    name: "Ines Calloway",
    email: "ines@inkshelter.example",
    key: "dgk_ines_seed_8a2e6d1f0c9b4e37a5d2",
  },
  {
    id: "per_tobias",
    name: "Tobias Ferrante",
    email: "tobias@reader.example",
    key: "dgk_tobias_seed_2b9c4e7a1d0f5e83c6",
  },
  {
    id: "per_wren",
    name: "Wren Adeyemi",
    email: "wren@reader.example",
    key: "dgk_wren_seed_6e3a9c2b8d1f4a70e5b9",
  },
];

interface SeedTier {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  domestic: number;
  europe: number;
  restOfWorld: number;
}

interface SeedCampaign {
  id: string;
  creatorId: string;
  title: string;
  story: string;
  goal: number;
  minRunCopies: number;
  shipsFrom: string;
  timeZone: string;
  localHour: number;
  daysAhead: number;
  stretch: readonly { copies: number; amount: number }[];
  tiers: readonly SeedTier[];
  coverText: string;
}

const SEED_CAMPAIGNS: readonly SeedCampaign[] = [
  {
    id: "saltmarsh-nocturnes",
    creatorId: "per_mara",
    title: "Saltmarsh Nocturnes",
    story:
      "A 48-page risograph comic about the tide-lights of the saltmarsh at night, " +
      "collected from a year of drawing by flashlight. Each spread pairs a marsh " +
      "resident with the weather that shaped their evening. The goal is set to my " +
      "printer's minimum offset run of 300 copies on uncoated stock.",
    goal: 240000,
    minRunCopies: 300,
    shipsFrom: "GB",
    timeZone: "Europe/London",
    localHour: 20,
    daysAhead: 30,
    stretch: [
      { copies: 500, amount: 340000 },
      { copies: 1000, amount: 560000 },
    ],
    tiers: [
      {
        id: "saltmarsh-reading-copy",
        title: "Reading copy",
        description: "The standard edition, signed on the title page.",
        price: 1200,
        quantity: null,
        domestic: 350,
        europe: 700,
        restOfWorld: 1100,
      },
      {
        id: "saltmarsh-signed-variant",
        title: "Signed variant cover",
        description: "A hand-signed variant cover printed in teal duotone. Strictly two copies.",
        price: 2500,
        quantity: 2,
        domestic: 350,
        europe: 700,
        restOfWorld: 1100,
      },
      {
        id: "saltmarsh-original-page",
        title: "Original page",
        description: "The original brush-and-ink drawing for one page of the book, plus the reading copy.",
        price: 18000,
        quantity: 1,
        domestic: 900,
        europe: 1800,
        restOfWorld: 3000,
      },
    ],
    coverText: "SALTMARSH NOCTURNES",
  },
  {
    id: "fold-here",
    creatorId: "per_ines",
    title: "Fold Here",
    story:
      "A folded zine about origami for people with two left hands. Every page folds " +
      "into a small paper animal by following the printed crease lines. The minimum " +
      "digital run at my press is 100 copies.",
    goal: 60000,
    minRunCopies: 100,
    shipsFrom: "IE",
    timeZone: "Europe/Dublin",
    localHour: 20,
    daysAhead: 30,
    stretch: [{ copies: 250, amount: 120000 }],
    tiers: [
      {
        id: "fold-here-zine",
        title: "Zine",
        description: "The zine, folded flat and posted in a board envelope.",
        price: 600,
        quantity: null,
        domestic: 120,
        europe: 250,
        restOfWorld: 400,
      },
      {
        id: "fold-here-zine-and-print",
        title: "Zine and risograph print",
        description: "The zine plus an A5 risograph print of the crane. Twenty-five copies.",
        price: 1500,
        quantity: 25,
        domestic: 200,
        europe: 450,
        restOfWorld: 750,
      },
    ],
    coverText: "FOLD HERE",
  },
  {
    id: "wet-ink-almanac",
    creatorId: "per_mara",
    title: "Wet Ink Almanac",
    story:
      "A still-wet drafting almanac of printshop weather. A draft for now: cover art " +
      "still drying.",
    goal: 150000,
    minRunCopies: 200,
    shipsFrom: "GB",
    timeZone: "Europe/London",
    localHour: 20,
    daysAhead: 21,
    stretch: [],
    tiers: [
      {
        id: "wet-ink-almanac-copy",
        title: "Almanac",
        description: "The almanac, printed and bound on recycled stock.",
        price: 1800,
        quantity: null,
        domestic: 400,
        europe: 800,
        restOfWorld: 1200,
      },
    ],
    coverText: "WET INK ALMANAC",
  },
];

/** Teal on paper, drawn as a flat disc of halftone dots. */
export function generateCoverPng(text: string): Buffer {
  const width = 600;
  const height = 600;
  const teal = [13, 92, 96];
  const paper = [244, 247, 244];

  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let on = false;
      if (dist < 300) {
        const angle = Math.atan2(dy, dx);
        const ring = Math.floor(dist / 16);
        const ringStart = ring * 16;
        const inRing = dist - ringStart;
        const dots = 6 * Math.max(ring, 1);
        const dotAngle = ((Math.round((angle / (2 * Math.PI)) * dots) % dots) + dots) % dots;
        const centreAngle = (dotAngle / dots) * 2 * Math.PI;
        const cx = Math.cos(centreAngle) * (ringStart + 8);
        const cy = Math.sin(centreAngle) * (ringStart + 8);
        const dotDist = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2);
        const coverage = Math.max(0.15, Math.min(1, dist / 240));
        on = dotDist < 5.5 * Math.sqrt(coverage);
      }
      const color = on ? teal : paper;
      const offset = (y * width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }

  return encodePng(width, height, pixels, text);
}

function encodePng(width: number, height: number, pixels: Buffer, _text: string): Buffer {
  // Minimal PNG encoder using zlib (deflate) with no dependencies beyond Node.
  const bytesPerPixel = 3;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlibDeflate(raw);

  const chunks: Buffer[] = [];
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(signature);
  chunks.push(pngChunk("IHDR", ihdr));
  chunks.push(pngChunk("IDAT", compressed));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function seedIfEmpty(
  pool: Pool,
  config: Config,
  storage: StorageClient,
): Promise<void> {
  const marker = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM seed_marker`);
  if (Number(marker.rows[0]?.count ?? 0) > 0) return;

  for (const person of SEED_PEOPLE) {
    await pool.query(
      `INSERT INTO people (id, name, email, key) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [person.id, person.name, person.email, person.key],
    );
  }

  for (const campaign of SEED_CAMPAIGNS) {
    const launch = DateTime.utc().plus({ days: -1 });
    const deadlineInZone = DateTime.now()
      .setZone(campaign.timeZone)
      .plus({ days: campaign.daysAhead })
      .set({ hour: campaign.localHour, minute: 0, second: 0, millisecond: 0 });
    const local = deadlineInZone.toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const deadlineUtc = deadlineInZone.toUTC().toJSDate();
    const status = campaign.id === "wet-ink-almanac" ? "draft" : "live";
    const launchedAt = status === "draft" ? null : launch.toJSDate();

    await pool.query(
      `INSERT INTO campaigns
         (id, creator_id, title, story, status, goal, min_run_copies, ships_from,
          time_zone, deadline_local, deadline_utc, launched_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (id) DO NOTHING`,
      [
        campaign.id,
        campaign.creatorId,
        campaign.title,
        campaign.story,
        status,
        campaign.goal,
        campaign.minRunCopies,
        campaign.shipsFrom,
        campaign.timeZone,
        local,
        deadlineUtc,
        launchedAt,
      ],
    );

    for (const [index, stretch] of campaign.stretch.entries()) {
      await pool.query(
        `INSERT INTO stretch_breaks (campaign_id, position, copies, amount)
         VALUES ($1, $2, $3, $4) ON CONFLICT (campaign_id, position) DO NOTHING`,
        [campaign.id, index, stretch.copies, stretch.amount],
      );
    }

    for (const [index, tier] of campaign.tiers.entries()) {
      await pool.query(
        `INSERT INTO tiers
           (id, campaign_id, title, description, price, quantity,
            shipping_domestic, shipping_europe, shipping_rest_of_world, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          tier.id,
          campaign.id,
          tier.title,
          tier.description,
          tier.price,
          tier.quantity,
          tier.domestic,
          tier.europe,
          tier.restOfWorld,
          index,
        ],
      );
    }

    if (campaign.id !== "wet-ink-almanac") {
      const mediaId = `med_${campaign.id}-cover`;
      const objectKey = `campaigns/${campaign.id}/media/${mediaId}.png`;
      const png = generateCoverPng(campaign.coverText);
      const stored = await storage.putAndConfirm(objectKey, png, "image/png");
      await pool.query(
        `INSERT INTO media (id, campaign_id, kind, status, content_type, bytes, object_key, filename)
         VALUES ($1, $2, 'cover', $3, 'image/png', $4, $5, 'cover.png')
         ON CONFLICT (id) DO NOTHING`,
        [mediaId, campaign.id, stored.stored ? "stored" : "failed", png.length, objectKey],
      );
    }
  }

  await pool.query(`INSERT INTO seed_marker (id) VALUES (1) ON CONFLICT DO NOTHING`);
}
