import { poolDb } from "./db";
import { businessNow } from "./clock";
import { solidImage } from "./image";
import { putObject, storageState } from "./storage";
import { hashPassword } from "./auth";

const DEMO_PASSWORD = "mothlight-demo-2027";
const NIGHT_SIZES: Array<[number, number]> = [[600, 900], [800, 800], [1200, 600], [600, 1200], [900, 600], [700, 1000], [1000, 1000], [640, 960]];
const FERN_SIZES: Array<[number, number]> = [[800, 1200], [1000, 800], [1200, 700], [900, 900]];
const NIGHT_COLORS = ["#2e4a3f", "#3a5548", "#26343c", "#22404a", "#344a35", "#3c4a52", "#40503e", "#2c4642"];
const FERN_COLORS = ["#37503c", "#415740", "#4c6a4c", "#2f4a35"];

/**
 * Demo content (DP-91): created once on the first start on a database with no people.
 * If object storage is unreachable at that start, it is created at the next start instead.
 */
export async function seedDemoContent(): Promise<void> {
  const people = await poolDb.queryOne<{ id: string }>(`select id from users limit 1`);
  if (people) return;
  if (!storageState().ok) return;

  const clockStart = businessNow();
  const mkUser = async (name: string, handle: string, email: string, at: Date) => {
    const row = await poolDb.queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, handle, created_at) values ($1, $2, $3, $4, $5) returning id`,
      [email, hashPassword(DEMO_PASSWORD), name, handle, at]
    );
    return Number(row!.id);
  };

  const wrenAt = new Date(clockStart.getTime() - 30 * 3600_000);
  const odileAt = new Date(clockStart.getTime() - 32 * 3600_000);
  const wren = await mkUser("Wren Hollis", "wren_hollis", "wren@demo.mothlight.example", wrenAt);
  const odile = await mkUser("Odile Marsh", "odile_marsh", "odile@demo.mothlight.example", odileAt);
  await poolDb.query(
    `insert into follows_users (follower_id, target_id, created_at) values ($1, $2, $3) on conflict do nothing`,
    [wren, odile, odileAt]
  );

  const mkBoard = async (ownerId: number, name: string, at: Date) => {
    const row = await poolDb.queryOne<{ id: string }>(
      `insert into boards (owner_id, name, name_key, visibility, seq, created_at) values ($1, $2, $3, 'public', 0, $4) returning id`,
      [ownerId, name, name.toLowerCase(), at]
    );
    return Number(row!.id);
  };
  const nightBoard = await mkBoard(wren, "Night studies", new Date(clockStart.getTime() - 29 * 3600_000));
  const fernBoard = await mkBoard(odile, "Fern room", new Date(clockStart.getTime() - 31 * 3600_000));

  // Fern study <n> is created <n> hours before the clock's start; Night study <n> 4 + <n> hours before.
  const placePin = async (ownerId: number, boardId: number, size: [number, number], color: string, title: string, at: Date) => {
    const processed = await solidImage(size[0], size[1], "png", color);
    const imageRow = await poolDb.queryOne<{ id: string }>(
      `insert into images (width, height, sha256, format, created_at) values ($1, $2, $3, 'png', $4) returning id`,
      [processed.width, processed.height, processed.sha256, at]
    );
    const imageId = Number(imageRow!.id);
    await putObject(`images/${imageId}/original.png`, processed.original, "image/png");
    for (const v of processed.variants) {
      await putObject(`images/${imageId}/w${v.width}.png`, v.bytes, "image/png");
    }
    await poolDb.query(
      `update pins set position = position + 1 where board_id = $1 and section_id is null and status = 'live'`,
      [boardId]
    );
    const pin = await poolDb.queryOne<{ id: string }>(
      `insert into pins (owner_id, board_id, section_id, image_id, root_id, title, description, alt, source, source_host, tags, position, status, created_at, updated_at)
       values ($1, $2, null, $3, null, $4, '', $5, null, null, '{}', 1, 'live', $6, $6) returning id`,
      [ownerId, boardId, imageId, title, `${title}, a generated print`, at]
    );
    return Number(pin!.id);
  };

  // Pins take positions 1..n in title order: create the latest first so each lands at position 1.
  for (let i = NIGHT_SIZES.length; i >= 1; i--) {
    const at = new Date(clockStart.getTime() - (4 + i) * 3600_000);
    await placePin(wren, nightBoard, NIGHT_SIZES[i - 1]!, NIGHT_COLORS[i - 1]!, `Night study ${i}`, at);
  }
  for (let i = FERN_SIZES.length; i >= 1; i--) {
    const at = new Date(clockStart.getTime() - i * 3600_000);
    await placePin(odile, fernBoard, FERN_SIZES[i - 1]!, FERN_COLORS[i - 1]!, `Fern study ${i}`, at);
  }
}
