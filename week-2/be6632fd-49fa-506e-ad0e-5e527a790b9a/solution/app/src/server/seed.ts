// Seed data (brief: Seed data), applied once under the start-up lock; look images are drawn by the app and
// stored in MinIO, retried by every sweep until MinIO accepts them.
import type pg from "pg";
import { MARKETS, type Market, type Wall, copenhagenWall, localText, parseInstant, parseLocal, rollingOpenings } from "../shared/time";
import { hashPassword } from "./auth";
import { pool, rows } from "./db";
import { type Figure, LOOK_SIZE, drawLook } from "./drawing";
import { putObject } from "./s3";

const PASSWORD = "Hourline-Seed-2027";

interface SeedDrop {
  workspace: string;
  name: string;
  slug: string;
  type: "simultaneous" | "rolling";
  timing: string | null;
  status: string;
  pieces: number;
  hold: number;
  palette: string[];
  styles: Array<[string, string, string, number, number]>;
  looks: Array<[Figure, string, string]>;
  note: string;
}

const DROPS: SeedDrop[] = [
  {
    workspace: "Maren Vale", name: "Harbour Wool Edit", slug: "harbour-wool-edit", type: "simultaneous", timing: "2027-03-18T09:00:00Z", status: "scheduled", pieces: 50, hold: 900,
    palette: ["ink", "vermilion", "sand"],
    styles: [["MV-2701", "Harbour wool coat", "Ink", 120, 279900], ["MV-2702", "Harbour knit", "Sand", 80, 149950], ["MV-2703", "Dock trouser", "Fog", 60, 109900]],
    looks: [["coat", "Harbour wool coat", "An ink wool coat with a vermilion collar, drawn on a pale fog ground"], ["knit", "Harbour knit", "A ribbed sand knit sweater with an ink collar"], ["trouser", "Dock trouser", "Wide fog trousers with a vermilion waistband"]],
    note: "Hold five coats for the flagship window.",
  },
  {
    workspace: "Maren Vale", name: "New Year Studio", slug: "new-year-studio", type: "rolling", timing: "2027-01-01T12:00", status: "scheduled", pieces: 20, hold: 600,
    palette: ["night", "fog", "vermilion"], styles: [["MV-2750", "Studio overshirt", "Ink", 70, 159900]],
    looks: [["overshirt", "Studio overshirt", "A night-blue overshirt with fog pockets"], ["overshirt", "Studio overshirt, back", "The overshirt from behind on a stone ground"]], note: "",
  },
  {
    workspace: "Maren Vale", name: "Night Ferry Knits", slug: "night-ferry-knits", type: "rolling", timing: "2026-10-01T10:00", status: "live", pieces: 20, hold: 900,
    palette: ["night", "rust", "fog"], styles: [["MV-2610", "Night ferry cardigan", "Night", 60, 189900], ["MV-2611", "Ferry beanie", "Rust", 100, 39900]],
    looks: [["cardigan", "Night ferry cardigan", "A night-blue cardigan with rust buttons"], ["beanie", "Ferry beanie", "A ribbed rust beanie with a fog pompom"]], note: "",
  },
  {
    workspace: "Maren Vale", name: "Salt Linen", slug: "salt-linen", type: "simultaneous", timing: "2026-06-04T08:00:00Z", status: "sold_out", pieces: 10, hold: 900,
    palette: ["fog", "sand", "ink"], styles: [["MV-2605", "Salt linen shirt", "Fog", 80, 99900]],
    looks: [["shirt", "Salt linen shirt", "A fog linen shirt with sand pockets"], ["shirt", "Salt linen shirt, open", "The linen shirt worn open on a stone ground"]], note: "",
  },
  {
    workspace: "Maren Vale", name: "Lantern Ceramics", slug: "lantern-ceramics", type: "simultaneous", timing: "2026-12-03T09:00:00Z", status: "withdrawn", pieces: 30, hold: 900,
    palette: ["sand", "rust", "ink"], styles: [["MV-2620", "Lantern cup", "Sand", 200, 24900]],
    looks: [["cup", "Lantern cup", "A sand ceramic cup with a rust rim"]], note: "",
  },
  {
    workspace: "Maren Vale", name: "Midwinter Draft", slug: "midwinter-draft", type: "simultaneous", timing: null, status: "draft", pieces: 0, hold: 900,
    palette: ["vermilion", "stone", "ink"], styles: [["MV-2740", "Midwinter scarf", "Vermilion", 90, 59900]],
    looks: [["scarf", "Midwinter scarf", "A long vermilion scarf with stone stripes"]], note: "",
  },
  {
    workspace: "Kestrel Row", name: "Field Jacket 01", slug: "field-jacket-01", type: "simultaneous", timing: "2027-02-11T10:00:00Z", status: "scheduled", pieces: 25, hold: 900,
    palette: ["moss", "sand", "ink"], styles: [["KR-1101", "Field jacket", "Moss", 100, 249900]],
    looks: [["jacket", "Field jacket", "A moss field jacket with sand pockets"], ["jacket", "Field jacket, side", "The field jacket on a stone ground"]], note: "",
  },
  {
    workspace: "Kestrel Row", name: "Kestrel Studio Draft", slug: "kestrel-studio-draft", type: "simultaneous", timing: null, status: "draft", pieces: 0, hold: 900,
    palette: ["sand", "moss", "ink"], styles: [["KR-1150", "Rope sandal", "Sand", 80, 89900]],
    looks: [["sandal", "Rope sandal", "A pair of sand rope sandals with moss straps"]], note: "",
  },
];

const FIGURES: Figure[] = ["coat", "knit", "trouser", "cardigan", "beanie", "shirt", "cup", "overshirt", "scarf", "jacket", "sandal"];

function figureImage(seedFigure: number, palette: string[]): Buffer {
  return drawLook(FIGURES[Math.floor(seedFigure / 10)], palette, seedFigure % 10);
}

export async function seed(db: pg.PoolClient): Promise<void> {
  const done = await db.query("SELECT 1 FROM seed_marks WHERE name = 'v1'");
  if (done.rowCount) return;
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const hash = await hashPassword(PASSWORD);
  const ids: Record<string, string> = {};
  for (const name of ["Maren Vale", "Kestrel Row"]) ids[name] = (await db.query("INSERT INTO workspaces (name) VALUES ($1) RETURNING id", [name])).rows[0].id;

  const stockist = async (ws: string, name: string, market: Market, contact: string, email: string, phone: string | null, notes: string, offset: number): Promise<string> =>
    (await db.query(
      "INSERT INTO stockists (workspace_id, name, market, contact_name, contact_email, contact_phone, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [ids[ws], name, market, contact, email, phone, notes, new Date(now.getTime() + offset * 1000)],
    )).rows[0].id;
  const stores: Record<string, string> = {};
  const maren: Array<[string, Market, string, string, string, string]> = [
    ["Atelier Lune", "paris", "Camille Roux", "camille.roux@atelierlune.example", "+33 1 42 00 18 18", "Window display every drop"],
    ["Mori Select", "tokyo", "Yui Mori", "yui.mori@moriselect.example", "+81 3 5555 0142", "Ships via Osaka hub"],
    ["Zinc Goods", "london", "Tom Hale", "tom.hale@zincgoods.example", "+44 20 7946 0321", "Pays on 30 days"],
    ["Ærø Supply", "stockholm", "Nils Ek", "nils.ek@aerosupply.example", "+46 8 555 012 34", "Prefers knitwear"],
    ["Øster Room", "copenhagen", "Lea Krogh", "lea.krogh@osterroom.example", "+45 33 12 45 67", "Flagship partner"],
    ["Aaby Hus", "new_york", "Dana Price", "dana.price@aabyhus.example", "+1 212 555 0187", "Pays on delivery"],
  ];
  for (const [i, s] of maren.entries()) stores[s[0]] = await stockist("Maren Vale", ...s, i);
  stores["Bryggen Supply"] = await stockist("Kestrel Row", "Bryggen Supply", "copenhagen", "Mikkel Dahl", "mikkel.dahl@bryggensupply.example", null, "", 10);
  const kestrel: Array<[string, Market]> = [["Fjell Room", "stockholm"], ["Maison Gris", "paris"], ["Thames & Pine", "london"], ["Hudson Loft", "new_york"], ["Kaze Store", "tokyo"]];
  for (const [i, [name, market]] of kestrel.entries()) {
    stores[name] = await stockist("Kestrel Row", name, market, "Buyer", `buyer@${name.replace(/[ &]/g, "").toLowerCase()}.example`, null, "", 11 + i);
  }

  const members: Array<[string, string, string, string, string | null]> = [
    ["Maren Vale", "Ida Holm", "ida.holm@marenvale.example", "launch_producer", null],
    ["Maren Vale", "Jonas Berg", "jonas.berg@marenvale.example", "merchandiser", null],
    ["Maren Vale", "Sofie Lund", "sofie.lund@marenvale.example", "finance_lead", null],
    ["Maren Vale", "Amir Haddad", "amir.haddad@marenvale.example", "press_lead", null],
    ["Maren Vale", "Lea Krogh", "lea.krogh@osterroom.example", "stockist_buyer", "Øster Room"],
    ["Kestrel Row", "Noor Vik", "noor.vik@kestrelrow.example", "launch_producer", null],
    ["Kestrel Row", "Emil Sand", "emil.sand@kestrelrow.example", "merchandiser", null],
    ["Kestrel Row", "Karin Ström", "karin.strom@kestrelrow.example", "finance_lead", null],
    ["Kestrel Row", "Theo Blom", "theo.blom@kestrelrow.example", "press_lead", null],
    ["Kestrel Row", "Mikkel Dahl", "mikkel.dahl@bryggensupply.example", "stockist_buyer", "Bryggen Supply"],
  ];
  for (const [i, [ws, name, email, role, store]] of members.entries()) {
    await db.query("INSERT INTO members (workspace_id, name, email, role, stockist_id, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      ids[ws], name, email, role, store ? stores[store] : null, hash, new Date(now.getTime() + i * 1000),
    ]);
  }

  const dropIds: Record<string, string> = {};
  const styleIds: Record<string, string> = {};
  let figureCount = 0;
  for (const [i, d] of DROPS.entries()) {
    let openings: Map<Market, number> | null = null;
    let copenhagen: string | null = null;
    let local: string | null = null;
    if (d.timing && d.type === "rolling") {
      local = d.timing;
      openings = new Map(rollingOpenings(parseLocal(d.timing) as Wall).map((o) => [o.market, o.ms]));
    } else if (d.timing) {
      const ms = parseInstant(d.timing) as number;
      copenhagen = localText(copenhagenWall(ms));
      openings = new Map(MARKETS.map((m) => [m, ms]));
    }
    const drop = (await db.query(
      `INSERT INTO drops (workspace_id, slug, name, type, status, hold_seconds, palette, internal_note, copenhagen_go_live, local_go_live, created_at, withdrawn_at, withdraw_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [ids[d.workspace], d.slug, d.name, d.type, d.status, d.hold, d.palette, d.note, copenhagen, local, new Date(now.getTime() + i * 1000),
        d.status === "withdrawn" ? now : null, d.status === "withdrawn" ? "Kiln delay" : null],
    )).rows[0].id as string;
    dropIds[d.slug] = drop;
    for (const market of MARKETS) {
      const at = openings?.get(market);
      await db.query("INSERT INTO drop_markets (drop_id, market, store_pieces, go_live_at) VALUES ($1, $2, $3, $4)", [drop, market, d.pieces, at === undefined ? null : new Date(at)]);
    }
    for (const [p, [number, name, colour, edition, rrp]] of d.styles.entries()) {
      styleIds[number] = (await db.query(
        "INSERT INTO styles (drop_id, position, style_number, name, colour, wholesale_edition, rrp_dkk_minor) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [drop, p + 1, number, name, colour, edition, rrp],
      )).rows[0].id;
    }
    for (const [p, [figure, title, alt]] of d.looks.entries()) {
      const seedFigure = FIGURES.indexOf(figure) * 10 + (figureCount++ % 3);
      const look = (await db.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
      await db.query(
        `INSERT INTO looks (id, drop_id, position, title, alt_text, width, height, content_type, size_bytes, object_key, stored, seed_figure)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'image/png', $8, $9, false, $10)`,
        [look, drop, p + 1, title, alt, LOOK_SIZE.width, LOOK_SIZE.height, figureImage(seedFigure, d.palette).length, `looks/${drop}/${look}.png`, seedFigure],
      );
    }
    const story =
      d.slug === "harbour-wool-edit"
        ? "<p>Harbour Wool Edit is knitted and tailored from undyed wool spun on the island of Fanø, in the colours of the harbour after dark.</p><h2>Made for the walk home</h2><p>A coat, a knit and a dock trouser, cut close and finished by hand in Copenhagen.</p>"
        : "";
    await db.query("INSERT INTO stories (drop_id, html, version, saved_by, saved_at, published_html, published_at) VALUES ($1, $2, 1, $3, $4, $5, $6)", [
      drop, story, story ? "Amir Haddad" : null, story ? now : null, story || null, story ? now : null,
    ]);
  }

  const claim = async (slug: string, market: Market, n: number): Promise<void> => {
    for (let k = 1; k <= n; k += 1) {
      await db.query("INSERT INTO claims (drop_id, market, name, email, reference, claimed_at) VALUES ($1, $2, $3, $4, $5, $6)", [
        dropIds[slug], market, `Shopper ${String(k).padStart(2, "0")}`, `shopper${String(k).padStart(2, "0")}@example.com`,
        `HL-${slug === "salt-linen" ? "S" : "N"}${MARKETS.indexOf(market)}${String(k).padStart(4, "0")}`, new Date(now.getTime() - (n - k) * 60_000),
      ]);
    }
  };
  await claim("night-ferry-knits", "copenhagen", 5);
  for (const market of MARKETS) await claim("salt-linen", market, 10);

  const waitlist: Array<[Market, string, string]> = [
    ["copenhagen", "Freja Dahl", "freja.dahl@example.com"],
    ["copenhagen", "Oskar Lind", "oskar.lind@example.com"],
    ["copenhagen", "Maja Holt", "maja.holt@example.com"],
    ["tokyo", "Hana Mori", "hana.mori@example.com"],
    ["tokyo", "Ren Sato", "ren.sato@example.com"],
  ];
  for (const [k, [market, name, email]] of waitlist.entries()) {
    const at = new Date(now.getTime() - (waitlist.length - k) * 60_000);
    await db.query("INSERT INTO waitlist_members (drop_id, market, name, email, status, joined_at, confirmed_at) VALUES ($1, $2, $3, $4, 'confirmed', $5, $5)", [
      dropIds["harbour-wool-edit"], market, name, email, at,
    ]);
  }

  const requests: Array<[string, number, number]> = [["Øster Room", 40, 30], ["Atelier Lune", 50, 20], ["Mori Select", 70, 40]];
  const harbourStyles = await rows<{ id: string; style_number: string }>(db, "SELECT id, style_number FROM styles WHERE drop_id = $1 ORDER BY position", [dropIds["harbour-wool-edit"]]);
  for (const [k, [store, coats, knits]] of requests.entries()) {
    const at = new Date(now.getTime() - (requests.length - k) * 3_600_000);
    const allocation = (await db.query(
      "INSERT INTO allocations (drop_id, stockist_id, status, requested_at, saved_by, saved_at) VALUES ($1, $2, 'requested', $3, 'Jonas Berg', $3) RETURNING id",
      [dropIds["harbour-wool-edit"], stores[store], at],
    )).rows[0].id;
    for (const style of harbourStyles) {
      const q = style.style_number === "MV-2701" ? coats : style.style_number === "MV-2702" ? knits : 0;
      await db.query("INSERT INTO allocation_lines (allocation_id, style_id, requested_quantity) VALUES ($1, $2, $3)", [allocation, style.id, q]);
    }
  }

  const lists: Array<[string, string, string, Array<[string, string, number]>]> = [
    ["Maren Vale", "Spring 2026", "2026-01-01", [["MV-2701", "DKK", 119900], ["MV-2701", "JPY", 25900]]],
    ["Maren Vale", "Autumn 2026", "2026-08-01", [
      ["MV-2701", "DKK", 123450], ["MV-2701", "SEK", 182000], ["MV-2701", "EUR", 16550], ["MV-2701", "GBP", 14200], ["MV-2701", "USD", 17900], ["MV-2701", "JPY", 26800],
      ["MV-2702", "DKK", 64900], ["MV-2702", "SEK", 95000], ["MV-2702", "EUR", 8700], ["MV-2702", "GBP", 7500], ["MV-2702", "USD", 9400], ["MV-2702", "JPY", 14100],
      ["MV-2703", "DKK", 49950], ["MV-2703", "SEK", 73000], ["MV-2703", "EUR", 6700], ["MV-2703", "GBP", 5800], ["MV-2703", "USD", 7200], ["MV-2703", "JPY", 10850],
      ["MV-2610", "DKK", 84900], ["MV-2610", "JPY", 18200], ["MV-2605", "DKK", 44900],
    ]],
    ["Maren Vale", "Spring 2027", "2027-02-01", [["MV-2701", "DKK", 135795], ["MV-2701", "JPY", 29480], ["MV-2702", "DKK", 71390]]],
    ["Kestrel Row", "Autumn 2026", "2026-08-01", [["KR-1101", "DKK", 112450], ["KR-1101", "SEK", 165000], ["KR-1101", "EUR", 15100], ["KR-1101", "GBP", 12900], ["KR-1101", "USD", 16300], ["KR-1101", "JPY", 24500]]],
  ];
  for (const [ws, name, effective, prices] of lists) {
    const list = (await db.query("INSERT INTO price_lists (workspace_id, name, effective_date, created_at) VALUES ($1, $2, $3, $4) RETURNING id", [ids[ws], name, effective, now])).rows[0].id;
    for (const [style, currency, unit] of prices) {
      await db.query("INSERT INTO price_list_prices (price_list_id, style_number, currency, unit_price_minor) VALUES ($1, $2, $3, $4)", [list, style, currency, unit]);
    }
  }
  await db.query("INSERT INTO seed_marks (name) VALUES ('v1')");
}

/** Draws and stores every seeded look image not yet in MinIO; each row is claimed so copies never collide. */
export async function storeSeedImages(): Promise<void> {
  const waiting = await rows<{ id: string }>(pool, "SELECT id FROM looks WHERE stored = false");
  for (const { id } of waiting) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT l.id, l.object_key, l.seed_figure, d.palette FROM looks l JOIN drops d ON d.id = l.drop_id WHERE l.id = $1 AND l.stored = false FOR UPDATE OF l SKIP LOCKED",
        [id],
      );
      const look = found.rows[0] as { id: string; object_key: string; seed_figure: number; palette: string[] } | undefined;
      if (look) {
        await putObject(look.object_key, figureImage(look.seed_figure, look.palette), "image/png");
        await client.query("UPDATE looks SET stored = true WHERE id = $1", [look.id]);
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      return;
    } finally {
      client.release();
    }
  }
}
