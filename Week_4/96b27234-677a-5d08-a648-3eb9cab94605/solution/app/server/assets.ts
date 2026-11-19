import type { Layout, MeasureName, Rank } from "../shared/protocol.js";
import { one, query, tx } from "./db.js";
import { checkGlb } from "./glb.js";
import { conflict, invalid, notFound, Refusal, reply, Router, textLength, type Context, type Reply } from "./http.js";
import { parseMultipart, type Upload } from "./multipart.js";
import { newId, type Person } from "./people.js";
import { repaintSessionsOf } from "./notify.js";
import type { Kind, Measures } from "./rank.js";
import { parseLayout } from "./room.js";
import { deleteObject, getObject, putObject, reading, saving, versionKey } from "./storage.js";

interface AssetRow {
  id: string;
  world_id: string;
  owner_id: string;
  kind: Kind;
  name: string;
  current_version: number | null;
  next_version: number;
}

interface VersionRow {
  asset_id: string;
  version: number;
  status: "checked" | "published";
  rank: Rank;
  worst_measure: MeasureName;
  measures: Measures;
  measure_ranks: Record<MeasureName, Rank>;
  layout: Layout | null;
  created_at: Date;
}

const versionView = (row: VersionRow): Record<string, unknown> => ({
  version: row.version,
  status: row.status,
  rank: row.rank,
  worstMeasure: row.worst_measure,
  measures: row.measures,
  measureRanks: row.measure_ranks,
  ...(row.layout ? { layout: row.layout } : {}),
  createdAt: row.created_at.toISOString(),
});

const resultView = (assetId: string, row: VersionRow): Record<string, unknown> => ({
  assetId,
  version: row.version,
  rank: row.rank,
  worstMeasure: row.worst_measure,
  measures: row.measures,
  measureRanks: row.measure_ranks,
});

async function loadAsset(id: string, person: Person, lock = false): Promise<AssetRow> {
  const asset = await one<AssetRow>(
    `SELECT id, world_id, owner_id, kind, name, current_version, next_version FROM assets WHERE id = $1 AND world_id = $2 AND NOT removed${lock ? " FOR UPDATE" : ""}`,
    [id, person.worldId],
  );
  if (!asset) throw notFound();
  return asset;
}

/** An asset the caller owns, or the 404 for everyone else. */
async function ownedAsset(ctx: Context, person: Person): Promise<AssetRow> {
  const asset = await loadAsset(ctx.params.id ?? "", person);
  if (asset.owner_id !== person.id) throw notFound();
  return asset;
}

async function loadVersion(assetId: string, number: string | undefined): Promise<VersionRow> {
  const version = await one<VersionRow>("SELECT * FROM asset_versions WHERE asset_id = $1 AND version = $2", [assetId, Number(number)]);
  if (!version) throw notFound();
  return version;
}

const inUse = async (assetId: string, version?: number): Promise<boolean> =>
  (await one(
    `SELECT 1 AS ok FROM session_members m JOIN sessions s ON s.id = m.session_id
     WHERE s.room_id = $1 AND NOT m.gone AND s.status = 'open' AND ($2::int IS NULL OR m.room_version = $2)`,
    [assetId, version ?? null],
  )) !== null;

const IN_USE = "This version is in use by an open session.";

function readUpload(ctx: Context): Upload {
  return ctx.contentType.startsWith("multipart/") ? parseMultipart(ctx.raw, ctx.contentType) : { fields: new Map(), file: null };
}

type Checked = Extract<ReturnType<typeof checkGlb>, { ok: true }>;

/** The checks on a model's file and room layout, in the order the brief states them. */
function checkFile(kind: Kind, upload: Upload): { bytes: Buffer; layout: Layout | null; checked: Checked } {
  if (!upload.file || upload.file.data.length === 0) throw invalid("Choose a file to upload.");
  let layout: Layout | null = null;
  if (kind === "room") {
    let raw: unknown = null;
    try {
      raw = JSON.parse(upload.fields.get("layout") ?? "");
    } catch {
      raw = null;
    }
    layout = parseLayout(raw);
    if (!layout) throw invalid("This room layout is not valid.");
  }
  const checked = checkGlb(kind, upload.file.data);
  if (!checked.ok) throw new Refusal(checked.status, checked.message);
  return { bytes: upload.file.data, layout, checked };
}

async function addVersion(
  asset: AssetRow,
  bytes: Buffer,
  layout: Layout | null,
  result: Pick<VersionRow, "rank" | "worst_measure" | "measures" | "measure_ranks">,
  status: "checked" | "published",
): Promise<VersionRow> {
  return tx(async (client) => {
    const locked = await one<{ next_version: number }>("SELECT next_version FROM assets WHERE id = $1 FOR UPDATE", [asset.id], client);
    const number = locked?.next_version ?? 1;
    await saving(() => putObject(versionKey(asset.id, number), bytes));
    const row = await one<VersionRow>(
      `INSERT INTO asset_versions (asset_id, version, status, rank, worst_measure, measures, measure_ranks, layout)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [asset.id, number, status, result.rank, result.worst_measure, result.measures, result.measure_ranks, layout],
      client,
    );
    await query("UPDATE assets SET next_version = $2, current_version = CASE WHEN $3 = 'published' THEN $4::int ELSE current_version END WHERE id = $1", [asset.id, number + 1, status, number], client);
    return row as VersionRow;
  });
}

const checkedResult = (check: Checked): Pick<VersionRow, "rank" | "worst_measure" | "measures" | "measure_ranks"> => ({
  rank: check.rank,
  worst_measure: check.worstMeasure,
  measures: check.measures,
  measure_ranks: check.measureRanks,
});

export function assetRoutes(router: Router<Person>): void {
  router.add(
    "POST",
    "/api/assets",
    async (ctx, person): Promise<Reply> => {
      const upload = readUpload(ctx);
      const kind = upload.fields.get("kind");
      if (kind !== "room" && kind !== "avatar") throw invalid("Choose room or avatar.");
      const name = (upload.fields.get("name") ?? "").trim();
      if (textLength(name) < 1 || textLength(name) > 80) throw invalid("Give the model a name of 1 to 80 characters.");
      const { bytes, layout, checked } = checkFile(kind, upload);
      const id = newId();
      const row = await tx(async (client) => {
        await query("INSERT INTO assets (id, world_id, owner_id, kind, name, next_version) VALUES ($1, $2, $3, $4, $5, 2)", [id, person.worldId, person.id, kind, name], client);
        await saving(() => putObject(versionKey(id, 1), bytes));
        return one<VersionRow>(
          `INSERT INTO asset_versions (asset_id, version, status, rank, worst_measure, measures, measure_ranks, layout)
           VALUES ($1, 1, 'checked', $2, $3, $4, $5, $6) RETURNING *`,
          [id, checked.rank, checked.worstMeasure, checked.measures, checked.measureRanks, layout],
          client,
        ) as Promise<VersionRow>;
      });
      return reply(201, resultView(id, row));
    },
  );

  router.add(
    "POST",
    "/api/assets/:id/versions",
    async (ctx, person): Promise<Reply> => {
      const asset = await ownedAsset(ctx, person);
      const { bytes, layout, checked } = checkFile(asset.kind, readUpload(ctx));
      const row = await addVersion(asset, bytes, layout, checkedResult(checked), "checked");
      return reply(201, resultView(asset.id, row));
    },
  );

  router.add("GET", "/api/assets", async (ctx, person): Promise<Reply> => {
    const kind = ctx.url.searchParams.get("kind");
    const mine = ctx.url.searchParams.get("mine") === "true";
    const rows = await query<{ id: string; kind: string; name: string; owner_name: string; current_version: number | null; rank: Rank | null }>(
      `SELECT a.id, a.kind, a.name, o.display_name AS owner_name, a.current_version, v.rank
       FROM assets a JOIN people o ON o.id = a.owner_id LEFT JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.current_version
       WHERE a.world_id = $1 AND NOT a.removed AND ($2::text IS NULL OR a.kind = $2)
         AND (CASE WHEN $3 THEN a.owner_id = $4 ELSE a.current_version IS NOT NULL END)
       ORDER BY a.kind DESC, a.name, a.id`,
      [person.worldId, kind, mine, person.id],
    );
    const assets = rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, ownerName: row.owner_name, currentVersion: row.current_version, rank: row.rank }));
    return reply(200, { assets, total: assets.length });
  });

  router.add("GET", "/api/assets/:id", async (ctx, person): Promise<Reply> => {
    const asset = await loadAsset(ctx.params.id ?? "", person);
    const owner = asset.owner_id === person.id;
    if (!owner && asset.current_version === null) throw notFound();
    const versions = await query<VersionRow>("SELECT * FROM asset_versions WHERE asset_id = $1 AND ($2 OR status = 'published') ORDER BY version", [asset.id, owner]);
    const ownerRow = await one<{ display_name: string }>("SELECT display_name FROM people WHERE id = $1", [asset.owner_id]);
    const current = versions.find((row) => row.version === asset.current_version);
    return reply(200, {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      ownerName: ownerRow?.display_name ?? "",
      currentVersion: asset.current_version,
      rank: current?.rank ?? null,
      versions: versions.map(versionView),
    });
  });

  router.add("GET", "/api/assets/:id/versions/:n/file", async (ctx, person): Promise<Reply> => {
    const asset = await loadAsset(ctx.params.id ?? "", person);
    const version = await loadVersion(asset.id, ctx.params.n);
    if (version.status !== "published" && asset.owner_id !== person.id) throw notFound();
    const bytes = await reading(() => getObject(versionKey(asset.id, version.version)));
    if (!bytes) throw notFound();
    return { status: 200, body: bytes, headers: { "content-type": "model/gltf-binary" } };
  });

  router.add("POST", "/api/assets/:id/versions/:n/publish", async (ctx, person): Promise<Reply> => {
    const asset = await ownedAsset(ctx, person);
    const version = await loadVersion(asset.id, ctx.params.n);
    await tx(async (client) => {
      const moved = await one("UPDATE asset_versions SET status = 'published' WHERE asset_id = $1 AND version = $2 AND status = 'checked' RETURNING version", [asset.id, version.version], client);
      if (!moved) throw conflict("This version is already published.");
      await query("UPDATE assets SET current_version = $2 WHERE id = $1", [asset.id, version.version], client);
    });
    return reply(200, { assetId: asset.id, version: version.version, status: "published" });
  });

  router.add("POST", "/api/assets/:id/versions/:n/restore", async (ctx, person): Promise<Reply> => {
    const asset = await ownedAsset(ctx, person);
    const old = await loadVersion(asset.id, ctx.params.n);
    const bytes = await saving(() => getObject(versionKey(asset.id, old.version)));
    if (!bytes) throw notFound();
    const row = await addVersion(asset, bytes, old.layout, old, "published");
    return reply(201, resultView(asset.id, row));
  });

  router.add("DELETE", "/api/assets/:id/versions/:n", async (ctx, person): Promise<Reply> => {
    const asset = await ownedAsset(ctx, person);
    const version = await loadVersion(asset.id, ctx.params.n);
    if (asset.kind === "room" && (await inUse(asset.id, version.version))) throw conflict(IN_USE);
    await saving(() => deleteObject(versionKey(asset.id, version.version)));
    await query("DELETE FROM asset_versions WHERE asset_id = $1 AND version = $2", [asset.id, version.version]);
    const published = await query<{ version: number }>("SELECT version FROM asset_versions WHERE asset_id = $1 AND status = 'published' ORDER BY version DESC", [asset.id]);
    const left = await one<{ count: number }>("SELECT count(*) AS count FROM asset_versions WHERE asset_id = $1", [asset.id]);
    if (published.length > 0) {
      if (asset.current_version === version.version) await query("UPDATE assets SET current_version = $2 WHERE id = $1", [asset.id, published[0]?.version]);
    } else if (version.status === "published" || (left?.count ?? 0) === 0) {
      await removeAsset(asset);
    } else await query("UPDATE assets SET current_version = NULL WHERE id = $1", [asset.id]);
    return reply(200, { status: "removed" });
  });

  router.add("DELETE", "/api/assets/:id", async (ctx, person): Promise<Reply> => {
    const asset = await ownedAsset(ctx, person);
    if (asset.kind === "room" && (await inUse(asset.id))) throw conflict(IN_USE);
    await removeAsset(asset);
    return reply(200, { status: "removed" });
  });
}

/** Removes every version, object and the asset itself; wearers fall back to the plain paper figure. */
async function removeAsset(asset: AssetRow): Promise<void> {
  const versions = await query<{ version: number }>("SELECT version FROM asset_versions WHERE asset_id = $1", [asset.id]);
  await saving(async () => {
    for (const row of versions) await deleteObject(versionKey(asset.id, row.version));
  });
  await query("DELETE FROM asset_versions WHERE asset_id = $1", [asset.id]);
  await query("UPDATE assets SET removed = true, current_version = NULL WHERE id = $1", [asset.id]);
  const wearers = await query<{ id: string }>("SELECT id FROM people WHERE avatar_id = $1", [asset.id]);
  if (wearers.length > 0) await repaintSessionsOf(wearers.map((row) => row.id));
}

