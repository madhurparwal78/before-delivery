import { randomToken } from "../config.js";
import { bad, validation } from "../errors.js";
import { db } from "../db.js";
import { formatBytes, formatDateTime } from "../../shared/format.js";
import { publishAccountEvent } from "../live.js";
import { isDxfText, importDxf } from "../dxf.js";
import { putObject, minioAvailable } from "../providers/minio.js";
import { workspaceNow } from "../clock.js";
import type { Ctx } from "./accounts.js";
import { json, requireAccount } from "./accounts.js";

export interface FileRow {
  id: string;
  kind: "folder" | "drawing";
  name: string;
  modified_epoch: string;
  size: string | null;
  owner: string;
  shared: boolean;
}

const nameForbidden = /[/\\:*?"<>|]/;
const maxNameLength = 80;

export function validFileName(name: string): boolean {
  return name.length >= 1 && name.length <= maxNameLength && !nameForbidden.test(name);
}

export async function rootFolderId(workspaceId: string): Promise<string> {
  const row = await db.one<{ id: string }>(
    `select id from folders where workspace_id = $1 and parent_id is null order by created_epoch limit 1`,
    [workspaceId],
  );
  if (!row) throw bad("not_found");
  return row.id;
}

export async function folderItems(
  workspaceId: string,
  folderId: string,
  zone: string,
  sort: string,
  order: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const folders = await db.all<{ id: string; name: string; modified_epoch: string }>(
    `select id, name, modified_epoch from folders where workspace_id = $1 and coalesce(parent_id, '') = $2`,
    [workspaceId, folderId],
  );
  const drawings = await db.all<{
    id: string;
    name: string;
    modified_epoch: string;
    owner: string;
    size: string | null;
  }>(
    `select d.id, d.name, d.modified_epoch, a.name as owner,
       (select size_bytes from file_versions fv where fv.drawing_id = d.id order by number desc limit 1) as size
     from drawings d left join accounts a on a.workspace_id = d.workspace_id
     where d.workspace_id = $1 and d.deleted_epoch is null and coalesce(d.folder_id, '') = $2
     order by d.modified_epoch desc`,
    [workspaceId, folderId],
  );
  const sharedRows = await db.all<{ drawing_id: string }>(
    `select distinct drawing_id from shares s join drawings d on d.id = s.drawing_id where d.workspace_id = $1 and s.revoked = false`,
    [workspaceId],
  );
  const sharedSet = new Set(sharedRows.map((r) => r.drawing_id));
  const items: Record<string, unknown>[] = [];
  for (const folder of folders) {
    items.push({
      id: folder.id,
      kind: "folder",
      name: folder.name,
      modified_at: new Date(Number(folder.modified_epoch)).toISOString(),
      modified_label: formatDateTime(Number(folder.modified_epoch), zone),
      size_bytes: null,
      size_label: "—",
      owner: "You",
      shared: false,
    });
  }
  for (const drawing of drawings) {
    items.push({
      id: drawing.id,
      kind: "drawing",
      name: drawing.name,
      modified_at: new Date(Number(drawing.modified_epoch)).toISOString(),
      modified_label: formatDateTime(Number(drawing.modified_epoch), zone),
      size_bytes: drawing.size === null ? null : Number(drawing.size),
      size_label: formatBytes(drawing.size === null ? null : Number(drawing.size)),
      owner: drawing.owner ?? "Corbel Works",
      shared: sharedSet.has(drawing.id),
    });
  }
  const filtered = query === "" ? items : items.filter((i) => String(i.name).toLowerCase().includes(query.toLowerCase()));
  const direction = order === "desc" ? -1 : 1;
  const compare = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    switch (sort) {
      case "name":
        return String(a.name).localeCompare(String(b.name)) * direction;
      case "modified": {
        const am = Date.parse(String(a.modified_at));
        const bm = Date.parse(String(b.modified_at));
        return (am - bm) * direction || String(a.name).localeCompare(String(b.name));
      }
      case "size":
        return ((a.size_bytes as number | null) ?? -1) - ((b.size_bytes as number | null) ?? -1) * direction;
      case "owner":
        return String(a.owner).localeCompare(String(b.owner)) * direction;
      case "shared":
        return (Number(a.shared) - Number(b.shared)) * direction || String(a.name).localeCompare(String(b.name));
      case "type":
        return String(a.kind).localeCompare(String(b.kind)) * direction;
      default:
        return 0;
    }
  };
  const folderItemsSorted = filtered.filter((i) => i.kind === "folder").sort(compare);
  const drawingItemsSorted = filtered.filter((i) => i.kind === "drawing").sort(compare);
  return [...folderItemsSorted, ...drawingItemsSorted];
}

export async function handleFolderListing(ctx: Ctx, folderId: string): Promise<void> {
  const account = requireAccount(ctx);
  const url = new URL(ctx.req.url ?? "/", "http://local");
  const sort = url.searchParams.get("sort") ?? "modified";
  const order = url.searchParams.get("order") ?? "desc";
  const query = url.searchParams.get("q") ?? "";
  if (!["type", "name", "modified", "size", "owner", "shared"].includes(sort)) {
    throw validation({ sort: "Choose a sort." });
  }
  if (order !== "asc" && order !== "desc") throw validation({ order: "Choose an order." });
  const id = folderId === "root" ? await rootFolderId(account.workspace_id) : folderId;
  const folder = await db.one<{ id: string; name: string; parent_id: string | null }>(
    `select id, name, parent_id from folders where id = $1 and workspace_id = $2`,
    [id, account.workspace_id],
  );
  if (!folder && id !== "root") throw bad("not_found");
  const items = await folderItems(account.workspace_id, id, account.time_zone, sort, order, query);
  json(ctx.res, 200, {
    folder: folder ? { id: folder.id, name: folder.name, parent_id: folder.parent_id } : { id: "root", name: "My Drawings", parent_id: null },
    items,
  });
}

export async function handleFolderCreate(ctx: Ctx): Promise<void> {
  const account = requireAccount(ctx);
  const body = ctx.body as { parent_id?: string; name?: string };
  const parentId = typeof body?.parent_id === "string" ? body.parent_id : "root";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!validFileName(name)) throw validation({ name: 'Folder names can\'t contain / \\ : * ? " < > | (1 to 80 characters).' });
  const parent = parentId === "root" || parentId === "" ? await rootFolderId(account.workspace_id) : parentId;
  const parentRow = await db.one<{ id: string }>(`select id from folders where id = $1 and workspace_id = $2`, [
    parent,
    account.workspace_id,
  ]);
  if (!parentRow) throw bad("not_found");
  const existing = await db.one<{ id: string }>(
    `select id from folders where workspace_id = $1 and coalesce(parent_id, '') = coalesce($2, '') and name_lower = $3`,
    [account.workspace_id, parent, name.toLowerCase()],
  );
  if (existing) throw validation({ name: `A folder named "${name}" already exists.` });
  const now = Date.now();
  const id = randomToken(9);
  await db.run(
    `insert into folders (id, workspace_id, parent_id, name, name_lower, modified_epoch, created_epoch)
     values ($1, $2, $3, $4, $5, $6, $6)`,
    [id, account.workspace_id, parent, name, name.toLowerCase(), now],
  );
  await db.run(`update folders set modified_epoch = $1 where id = $2`, [now, parent]);
  publishAccountEvent(account.id, "files", { folder_id: parent });
  publishAccountEvent(account.id, "recent", {});
  const row = await db.one<{ id: string; name: string; parent_id: string | null }>(
    `select id, name, parent_id from folders where id = $1`,
    [id],
  );
  json(ctx.res, 201, { folder: row });
}

export async function handleFolderDelete(ctx: Ctx, folderId: string): Promise<void> {
  const account = requireAccount(ctx);
  const row = await db.one<{ id: string; name: string; parent_id: string | null }>(
    `select id, name, parent_id from folders where id = $1 and workspace_id = $2`,
    [folderId, account.workspace_id],
  );
  if (!row) throw bad("not_found");
  const childFolders = await db.one<{ count: string }>(
    `select count(*) as count from folders where parent_id = $1`,
    [folderId],
  );
  const childDrawings = await db.one<{ count: string }>(
    `select count(*) as count from drawings where folder_id = $1 and deleted_epoch is null`,
    [folderId],
  );
  if (Number(childFolders?.count ?? 0) > 0 || Number(childDrawings?.count ?? 0) > 0) {
    throw bad("folder_not_empty");
  }
  await db.run(`delete from folders where id = $1`, [folderId]);
  if (row.parent_id) await db.run(`update folders set modified_epoch = $1 where id = $2`, [Date.now(), row.parent_id]);
  publishAccountEvent(account.id, "files", { folder_id: row.parent_id ?? "root" });
  json(ctx.res, 204, null);
}

export async function nextDrawingName(workspaceId: string, folderId: string): Promise<string> {
  const names = await db.all<{ name_lower: string }>(
    `select name_lower from drawings where workspace_id = $1 and folder_id = $2 and deleted_epoch is null`,
    [workspaceId, folderId],
  );
  const taken = new Set(names.map((n) => n.name_lower));
  let n = 1;
  while (taken.has(`drawing${n}.dxf`)) n += 1;
  return `Drawing${n}.dxf`;
}

export async function createDrawingRow(
  workspaceId: string,
  folderId: string,
  name: string,
  now: number,
  sample = false,
): Promise<string> {
  const id = randomToken(9);
  await db.run(
    `insert into drawings (id, workspace_id, folder_id, name, name_lower, units, plot_style, version, next_handle, max_handle_used, modified_epoch, created_epoch, sample)
     values ($1, $2, $3, $4, $5, 'mm', 'Monochrome', 1, '10', 0, $6, $6, $7)`,
    [id, workspaceId, folderId, name, name.toLowerCase(), now, sample],
  );
  await db.run(
    `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
     values ($1, '0', '0', 'White', 'Continuous', '0.25 mm', true, false, false, true, 0)`,
    [id],
  );
  await db.run(
    `insert into layouts (drawing_id, name, viewport_scale, position) values ($1, 'Model', null, 0), ($1, 'Layout1', '1:50', 1), ($1, 'Layout2', '1:50', 2)`,
    [id],
  );
  return id;
}

export async function handleDrawingCreate(ctx: Ctx): Promise<void> {
  const account = requireAccount(ctx);
  const body = ctx.body as { folder_id?: string; name?: string };
  const folderId =
    typeof body?.folder_id === "string" && body.folder_id !== "" && body.folder_id !== "root"
      ? body.folder_id
      : await rootFolderId(account.workspace_id);
  const folder = await db.one<{ id: string }>(`select id from folders where id = $1 and workspace_id = $2`, [
    folderId,
    account.workspace_id,
  ]);
  if (!folder) throw bad("not_found");
  let name = typeof body?.name === "string" && body.name.trim() !== "" ? body.name.trim() : "";
  if (name === "") {
    name = await nextDrawingName(account.workspace_id, folderId);
  }
  if (!validFileName(name)) throw validation({ name: 'File names can\'t contain / \\ : * ? " < > | (1 to 80 characters).' });
  if (!name.toLowerCase().endsWith(".dxf")) name = `${name}.dxf`;
  const existing = await db.one<{ id: string }>(
    `select id from drawings where workspace_id = $1 and folder_id = $2 and name_lower = $3 and deleted_epoch is null`,
    [account.workspace_id, folderId, name.toLowerCase()],
  );
  if (existing) throw validation({ name: `A drawing named "${name}" already exists.` });
  const now = Date.now();
  const id = await createDrawingRow(account.workspace_id, folderId, name, now);
  await db.run(`update folders set modified_epoch = $1 where id = $2`, [now, folderId]);
  publishAccountEvent(account.id, "files", { folder_id: folderId });
  publishAccountEvent(account.id, "recent", {});
  const drawing = await drawingSummary(id, account.time_zone, account.name);
  json(ctx.res, 201, { drawing });
}

export async function drawingSummary(drawingId: string, zone: string, ownerName: string | null): Promise<Record<string, unknown>> {
  const row = await db.one<{
    id: string;
    name: string;
    folder_id: string | null;
    modified_epoch: string;
    version: number;
  }>(`select id, name, folder_id, modified_epoch, version from drawings where id = $1`, [drawingId]);
  if (!row) throw bad("not_found");
  const size = await db.one<{ size_bytes: string | null }>(
    `select size_bytes from file_versions where drawing_id = $1 order by number desc limit 1`,
    [drawingId],
  );
  return {
    id: row.id,
    kind: "drawing",
    name: row.name,
    folder_id: row.folder_id,
    modified_at: new Date(Number(row.modified_epoch)).toISOString(),
    modified_label: formatDateTime(Number(row.modified_epoch), zone),
    version: row.version,
    size_bytes: size?.size_bytes === null || size?.size_bytes === undefined ? null : Number(size.size_bytes),
    size_label: formatBytes(size?.size_bytes ? Number(size.size_bytes) : null),
    owner: ownerName ?? "You",
    shared: false,
  };
}

export async function handleDrawingCopy(ctx: Ctx, drawingId: string): Promise<void> {
  const account = requireAccount(ctx);
  const body = ctx.body as { name?: string };
  const source = await db.one<{
    id: string;
    folder_id: string | null;
    name: string;
    workspace_id: string;
    units: string;
    plot_style: string;
    version: number;
    sample: boolean;
    next_handle: string;
    max_handle_used: number;
  }>(`select * from drawings where id = $1 and workspace_id = $2 and deleted_epoch is null`, [
    drawingId,
    account.workspace_id,
  ]);
  if (!source) throw bad("not_found");
  const folderId = source.folder_id ?? (await rootFolderId(account.workspace_id));
  const base = source.name.replace(/\.dxf$/i, "");
  const requested = typeof body?.name === "string" && body.name.trim() !== "" ? body.name.trim() : "";
  let name = requested === "" ? `${base} copy.dxf` : requested;
  if (!name.toLowerCase().endsWith(".dxf")) name = `${name}.dxf`;
  if (!validFileName(name)) throw validation({ name: 'File names can\'t contain / \\ : * ? " < > | (1 to 80 characters).' });
  const existing = await db.one<{ id: string }>(
    `select id from drawings where workspace_id = $1 and folder_id = $2 and name_lower = $3 and deleted_epoch is null`,
    [account.workspace_id, folderId, name.toLowerCase()],
  );
  if (existing) throw validation({ name: `A drawing named "${name}" already exists.` });
  const now = Date.now();
  const newId = await db.tx(async (client) => {
    const id = randomToken(9);
    await client.query(
      `insert into drawings (id, workspace_id, folder_id, name, name_lower, units, plot_style, version, next_handle, max_handle_used, modified_epoch, created_epoch)
       values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $10)`,
      [
        id,
        source.workspace_id,
        folderId,
        name,
        name.toLowerCase(),
        source.units,
        source.plot_style,
        source.next_handle,
        source.max_handle_used,
        now,
      ],
    );
    await client.query(
      `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
       select $1, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position from layers where drawing_id = $2`,
      [id, source.id],
    );
    await client.query(
      `insert into objects (handle, drawing_id, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, created_epoch)
       select handle, $1, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, $2
       from objects where drawing_id = $3`,
      [id, now, source.id],
    );
    await client.query(
      `insert into layouts (drawing_id, name, viewport_scale, position)
       select $1, name, viewport_scale, position from layouts where drawing_id = $2`,
      [id, source.id],
    );
    return id;
  });
  await db.run(`update folders set modified_epoch = $1 where id = $2`, [now, folderId]);
  publishAccountEvent(account.id, "files", { folder_id: folderId });
  const drawing = await drawingSummary(newId, account.time_zone, account.name);
  json(ctx.res, 201, { drawing });
}

export async function handleDrawingDelete(ctx: Ctx, drawingId: string): Promise<void> {
  const account = requireAccount(ctx);
  const row = await db.one<{ id: string; folder_id: string | null }>(
    `select id, folder_id from drawings where id = $1 and workspace_id = $2 and deleted_epoch is null`,
    [drawingId, account.workspace_id],
  );
  if (!row) throw bad("not_found");
  const now = Date.now();
  await db.run(`update drawings set deleted_epoch = $1 where id = $2`, [now, drawingId]);
  await db.run(`update shares set revoked = true where drawing_id = $1`, [drawingId]);
  if (row.folder_id) await db.run(`update folders set modified_epoch = $1 where id = $2`, [now, row.folder_id]);
  publishAccountEvent(account.id, "files", { folder_id: row.folder_id ?? "root" });
  json(ctx.res, 204, null);
}

export async function handleUpload(ctx: Ctx, folderId: string): Promise<void> {
  const account = requireAccount(ctx);
  const parentId = folderId === "root" || folderId === "" ? await rootFolderId(account.workspace_id) : folderId;
  const folder = await db.one<{ id: string }>(`select id from folders where id = $1 and workspace_id = $2`, [
    parentId,
    account.workspace_id,
  ]);
  if (!folder) throw bad("not_found");
  const file = ctx.uploads?.find((candidate) => candidate.field === "file");
  if (!file || typeof file.filename !== "string") throw validation({ file: "Choose a DXF file." });
  const name = file.filename.trim();
  if (!validFileName(name)) throw validation({ file: 'File names can\'t contain / \\ : * ? " < > | (1 to 80 characters).' });
  const withDxf = name.toLowerCase().endsWith(".dxf") ? name : `${name}.dxf`;
  if (file.data.byteLength > (await uploadLimit())) {
    throw bad("file_too_large", { limit_bytes: await uploadLimit() });
  }
  if (!isDxfText(file.data)) {
    throw validation({ file: `${withDxf} is not a DXF drawing.` });
  }
  const available = await minioAvailable();
  if (!available) throw bad("storage_unavailable");
  const existing = await db.one<{ id: string; version: number }>(
    `select id, version from drawings where workspace_id = $1 and folder_id = $2 and name_lower = $3 and deleted_epoch is null`,
    [account.workspace_id, parentId, withDxf.toLowerCase()],
  );
  const now = Date.now();
  const text = new TextDecoder().decode(file.data);
  const parsed = importDxf(text, "mm");
  let drawingId: string;
  let fileVersion: number;
  if (existing) {
    drawingId = existing.id;
    const last = await db.one<{ number: string }>(
      `select number from file_versions where drawing_id = $1 order by number desc limit 1`,
      [drawingId],
    );
    fileVersion = (last ? Number(last.number) : 0) + 1;
  } else {
    drawingId = await createDrawingRow(account.workspace_id, parentId, withDxf, now);
    fileVersion = 1;
  }
  const key = `drawings/${drawingId}/v${fileVersion}.dxf`;
  const stored = await putObject(key, file.data, "application/dxf");
  if (!stored) throw bad("storage_unavailable");
  await db.tx(async (client) => {
    await client.query(
      `insert into file_versions (drawing_id, number, created_epoch, actor, size_bytes, object_key)
       values ($1, $2, $3, $4, $5, $6)`,
      [drawingId, fileVersion, now, account.name, file.data.byteLength, key],
    );
    await replaceWithImport(client, drawingId, parsed, now);
    await client.query(`update drawings set version = version + 1, modified_epoch = $1, next_handle = $2, max_handle_used = $3, trace_counter = 0 where id = $4`, [
      now,
      nextHandleAfterImport(parsed.entities.length),
      parsed.entities.length > 0 ? 9 + parsed.entities.length : 15,
      drawingId,
    ]);
  });
  await db.run(`update folders set modified_epoch = $1 where id = $2`, [now, parentId]);
  publishAccountEvent(account.id, "files", { folder_id: parentId });
  publishAccountEvent(account.id, "recent", {});
  const drawing = await drawingSummary(drawingId, account.time_zone, account.name);
  json(ctx.res, 201, {
    drawing,
    file_version: fileVersion,
    imported: parsed.entities.length,
    skipped: parsed.skipped.length,
  });
}

function nextHandleAfterImport(count: number): string {
  return (16 + count).toString(16).toUpperCase();
}

export async function replaceWithImport(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  drawingId: string,
  parsed: { layers: Array<{ name: string; colour: string; linetype: string; frozen: boolean; locked: boolean; off: boolean }>; entities: Array<{ layer: string; type: string; colour?: string; data: Record<string, unknown> }> },
  now: number,
): Promise<void> {
  await client.query(`delete from objects where drawing_id = $1`, [drawingId]);
  await client.query(`delete from layers where drawing_id = $1`, [drawingId]);
  await client.query(
    `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
     values ($1, '0', '0', 'White', 'Continuous', '0.25 mm', true, false, false, true, 0)`,
    [drawingId],
  );
  for (const [index, layer] of parsed.layers.entries()) {
    if (String(layer.name).toLowerCase() === "0") continue;
    await client.query(
      `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
       values ($1, $2, $3, $4, $5, '0.25 mm', $6, $7, $8, false, $9)
       on conflict (drawing_id, name_lower) do nothing`,
      [
        drawingId,
        layer.name,
        layer.name.toLowerCase(),
        layer.colour,
        layer.linetype,
        layer.off !== true,
        layer.frozen === true,
        layer.locked === true,
        index + 1,
      ],
    );
  }
  for (const [index, entity] of parsed.entities.entries()) {
    const handle = (16 + index).toString(16).toUpperCase();
    await client.query(
      `insert into objects (handle, drawing_id, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, created_epoch)
       values ($1, $2, $3, $4, $5, $6, 1, 'ByLayer', 'Standard', 'Standard', 'Standard', $7, $8)`,
      [
        handle,
        drawingId,
        entity.layer,
        entity.type,
        entity.colour ?? "ByLayer",
        "ByLayer",
        JSON.stringify(entity.data),
        now,
      ],
    );
  }
}

async function uploadLimit(): Promise<number> {
  const { config } = await import("../config.js");
  return config.limits.UPLOAD_MAX_BYTES;
}

export async function handleFileVersions(ctx: Ctx, drawingId: string): Promise<void> {
  const account = requireAccount(ctx);
  const drawing = await db.one<{ id: string; name: string; workspace_id: string }>(
    `select id, name, workspace_id from drawings where id = $1 and deleted_epoch is null`,
    [drawingId],
  );
  if (!drawing || drawing.workspace_id !== account.workspace_id) throw bad("not_found");
  const rows = await db.all<{
    number: number;
    created_epoch: string;
    actor: string;
    size_bytes: number;
    object_key: string;
  }>(
    `select number, created_epoch, actor, size_bytes, object_key from file_versions where drawing_id = $1 order by number desc`,
    [drawingId],
  );
  json(ctx.res, 200, {
    versions: rows.map((r) => ({
      number: r.number,
      created_at: new Date(Number(r.created_epoch)).toISOString(),
      created_label: formatDateTime(Number(r.created_epoch), account.time_zone),
      actor: r.actor,
      size_bytes: r.size_bytes,
      size_label: formatBytes(r.size_bytes),
      object_key: r.object_key,
    })),
  });
}

export async function handleFileVersionDownload(ctx: Ctx, drawingId: string, versionNumber: string): Promise<void> {
  const account = requireAccount(ctx);
  const drawing = await db.one<{ id: string; name: string; workspace_id: string }>(
    `select id, name, workspace_id from drawings where id = $1 and deleted_epoch is null`,
    [drawingId],
  );
  if (!drawing || drawing.workspace_id !== account.workspace_id) throw bad("not_found");
  const row = await db.one<{ object_key: string }>(
    `select object_key from file_versions where drawing_id = $1 and number = $2`,
    [drawingId, Number(versionNumber)],
  );
  if (!row) throw bad("not_found");
  const { getObject } = await import("../providers/minio.js");
  const bytes = await getObject(row.object_key);
  if (!bytes) throw bad("storage_unavailable");
  ctx.res.writeHead(200, {
    "content-type": "application/dxf",
    "content-disposition": `attachment; filename="${drawing.name}"`,
  });
  ctx.res.end(bytes);
}

export async function handleOpened(ctx: Ctx, drawingId: string): Promise<void> {
  const account = requireAccount(ctx);
  const drawing = await db.one<{ id: string; workspace_id: string }>(
    `select id, workspace_id from drawings where id = $1 and deleted_epoch is null`,
    [drawingId],
  );
  if (!drawing || drawing.workspace_id !== account.workspace_id) throw bad("not_found");
  const { epochMs } = await workspaceNow(account.workspace_id);
  await db.run(
    `insert into recent_opens (account_id, drawing_id, opened_epoch) values ($1, $2, $3)
     on conflict (account_id, drawing_id) do update set opened_epoch = excluded.opened_epoch`,
    [account.id, drawingId, epochMs],
  );
  publishAccountEvent(account.id, "recent", {});
  json(ctx.res, 204, null);
}

export async function handleRecent(ctx: Ctx): Promise<void> {
  const account = requireAccount(ctx);
  const rows = await db.all<{
    id: string;
    name: string;
    modified_epoch: string;
    owner: string | null;
    size: string | null;
  }>(
    `select d.id, d.name, d.modified_epoch, a.name as owner,
       (select size_bytes from file_versions fv where fv.drawing_id = d.id order by number desc limit 1) as size
     from recent_opens r join drawings d on d.id = r.drawing_id
     left join accounts a on a.workspace_id = d.workspace_id
     where r.account_id = $1 and d.deleted_epoch is null
     order by r.opened_epoch desc limit 10`,
    [account.id],
  );
  const sharedRows = await db.all<{ drawing_id: string }>(
    `select distinct drawing_id from shares s join drawings d on d.id = s.drawing_id where d.workspace_id = $1 and s.revoked = false`,
    [account.workspace_id],
  );
  const sharedSet = new Set(sharedRows.map((r) => r.drawing_id));
  json(ctx.res, 200, {
    items: rows.map((r) => ({
      id: r.id,
      kind: "drawing",
      name: r.name,
      modified_at: new Date(Number(r.modified_epoch)).toISOString(),
      modified_label: formatDateTime(Number(r.modified_epoch), account.time_zone),
      size_bytes: r.size === null ? null : Number(r.size),
      size_label: formatBytes(r.size === null ? null : Number(r.size)),
      owner: r.owner ?? "You",
      shared: sharedSet.has(r.id),
    })),
  });
}

export async function handleSupportFiles(ctx: Ctx): Promise<void> {
  requireAccount(ctx);
  json(ctx.res, 200, {
    linetypes: ["Continuous", "Dashed", "Hidden", "Center"],
    plot_styles: ["Monochrome", "Color", "Grayscale"],
    blocks: ["Door 900", "Window 1200", "Chair 450", "Table 1600x800", "North arrow"],
    templates: ["Title block A3"],
    text_styles: ["Standard", "Annotative"],
  });
}

export async function handleRestore(ctx: Ctx, drawingId: string, versionNumber: string): Promise<void> {
  const account = requireAccount(ctx);
  const body = ctx.body as { base_version?: number };
  const baseVersion = typeof body?.base_version === "number" ? body.base_version : undefined;
  if (baseVersion === undefined) throw validation({ base_version: "Enter a version." });
  const drawing = await db.one<{
    id: string;
    name: string;
    workspace_id: string;
    version: number;
  }>(`select id, name, workspace_id, version from drawings where id = $1 and deleted_epoch is null`, [drawingId]);
  if (!drawing || drawing.workspace_id !== account.workspace_id) throw bad("not_found");
  const source = await db.one<{ object_key: string; size_bytes: number }>(
    `select object_key, size_bytes from file_versions where drawing_id = $1 and number = $2`,
    [drawingId, Number(versionNumber)],
  );
  if (!source) throw bad("not_found");
  if (drawing.version !== baseVersion) {
    const changedRows = await db.all<{ created: string[]; modified: string[]; erased: string[] }>(
      `select created, modified, erased from versions where drawing_id = $1 and version > $2`,
      [drawingId, baseVersion],
    );
    const set = new Set<string>();
    for (const row of changedRows) {
      for (const h of row.created ?? []) set.add(h);
      for (const h of row.modified ?? []) set.add(h);
      for (const h of row.erased ?? []) set.add(h);
    }
    throw bad("version_conflict", { current_version: drawing.version, changed: [...set].sort() });
  }
  const available = await minioAvailable();
  if (!available) throw bad("storage_unavailable");
  const { getObject } = await import("../providers/minio.js");
  const bytes = await getObject(source.object_key);
  if (!bytes) throw bad("storage_unavailable");
  const last = await db.one<{ number: string }>(
    `select number from file_versions where drawing_id = $1 order by number desc limit 1`,
    [drawingId],
  );
  const fileVersion = (last ? Number(last.number) : 0) + 1;
  const key = `drawings/${drawingId}/v${fileVersion}.dxf`;
  const stored = await putObject(key, bytes, "application/dxf");
  if (!stored) throw bad("storage_unavailable");
  const text = new TextDecoder().decode(bytes);
  const parsed = importDxf(text, "mm");
  const now = Date.now();
  await db.tx(async (client) => {
    await client.query(
      `insert into file_versions (drawing_id, number, created_epoch, actor, size_bytes, object_key)
       values ($1, $2, $3, $4, $5, $6)`,
      [drawingId, fileVersion, now, account.name, bytes.byteLength, key],
    );
    await replaceWithImport(client, drawingId, parsed, now);
    await client.query(
      `update drawings set version = version + 1, modified_epoch = $1, next_handle = $2, max_handle_used = $3 where id = $4`,
      [now, nextHandleAfterImport(parsed.entities.length), parsed.entities.length > 0 ? 15 + parsed.entities.length : 15, drawingId],
    );
  });
  const drawingAfter = await db.one<{ version: number }>(`select version from drawings where id = $1`, [drawingId]);
  publishAccountEvent(account.id, "files", { folder_id: "root" });
  json(ctx.res, 201, { file_version: fileVersion, version: drawingAfter?.version ?? drawing.version + 1 });
}
