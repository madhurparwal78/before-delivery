import { createHash } from "node:crypto";
import { recordActivity } from "./activity.ts";
import { OWNER_ONLY, requireMember, requireRole } from "./access.ts";
import { assetKey } from "./assets.ts";
import { readWorkingSet, referencedAssets, showBundle } from "./bundles.ts";
import type { Database, Queryable } from "./db.ts";
import { rows } from "./db.ts";
import { ApiError, assetNotReady, notFound, storageUnavailable, validation, writeJson } from "./errors.ts";
import type { EventHub } from "./events.ts";
import { openStream } from "./events.ts";
import type { Router } from "./http.ts";
import { parsedJson, requireUser } from "./http.ts";
import type { Storage } from "./storage.ts";
import { StorageDown } from "./storage.ts";
import { object, optional, str } from "../shared/schema.ts";
import type { ShowInfo, ShowListing, ShowStatus, ShowVersionDoc } from "../shared/types.ts";

interface ShowVersionRow {
  number: number;
  status: ShowStatus;
  sha256: string;
  size: number;
  note: string;
  asset_ids: string[];
  published_at: Date;
  user_id: string;
  display_name: string;
}

const bundleKey = (setId: string, number: number): string => `sets/${setId}/shows/${number}/bundle.json`;

const VERSION_SELECT = `
  SELECT v.number, v.status, v.sha256, v.size, v.note, v.asset_ids, v.published_at, u.id AS user_id, u.display_name
  FROM show_versions v JOIN users u ON u.id = v.published_by`;

function versionDoc(row: ShowVersionRow, live: number | null): ShowVersionDoc {
  return {
    number: row.number, status: row.status, live: row.number === live, sha256: row.sha256, size: row.size,
    published_at: row.published_at.toISOString(), published_by: { user_id: row.user_id, display_name: row.display_name }, note: row.note,
  };
}

interface LiveVersion {
  set_id: string;
  set_name: string;
  bpm: number;
  live_number: number;
}

export class Shows {
  private readonly db: Database;
  private readonly storage: Storage;
  private readonly hub: EventHub;

  constructor(db: Database, storage: Storage, hub: EventHub) {
    this.db = db;
    this.storage = storage;
    this.hub = hub;
  }

  private async liveOf(token: string): Promise<LiveVersion | null> {
    const [live] = await rows<LiveVersion>(this.db, 
      "SELECT id AS set_id, name AS set_name, bpm, live_number FROM sets WHERE show_token = $1", [token],
    );
    return live ?? null;
  }

  private async requireLive(token: string): Promise<LiveVersion> {
    const live = await this.liveOf(token);
    if (!live) throw notFound();
    if (live.live_number === null) throw new ApiError(404, "not_published", "Nothing is live yet");
    return live;
  }

  private async movePointer(q: Queryable, setId: string, number: number | null): Promise<void> {
    await q.query("UPDATE sets SET live_number = $2 WHERE id = $1", [setId, number]);
  }

  private async switchLive(setId: string, actorId: string, pick: (live: number | null, published: number[]) => number | null, action: "show.rollback" | "show.activate", refusal: ApiError): Promise<{ live_number: number; previous_live_number: number | null }> {
    const result = await this.db.transaction(async (tx) => {
      const [set] = await rows<{ live_number: number | null }>(tx, "SELECT live_number FROM sets WHERE id = $1 FOR UPDATE", [setId]);
      const published = await rows<{ number: number }>(tx, "SELECT number FROM show_versions WHERE set_id = $1 AND status = 'published' ORDER BY number", [setId]);
      const next = pick(set?.live_number ?? null, published.map((row) => row.number));
      if (next === null) throw refusal;
      await this.movePointer(tx, setId, next);
      await recordActivity(tx, setId, actorId, action, String(next), action === "show.rollback" ? `Rolled back to version ${next}` : `Made version ${next} live`);
      return { live_number: next, previous_live_number: set?.live_number ?? null };
    });
    await this.hub.publish(setId, { kind: "show", data: { live_number: result.live_number } });
    return result;
  }

  register(router: Router): void {
    router.add("POST", "/api/sets/:id/shows", { body: "json" }, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, OWNER_ONLY);
      const user = requireUser(ctx);
      const body = parsedJson(ctx, object({ note: optional(str({ max: 200, message: "Note must be at most 200 characters" })) }));
      const note = body.note ?? "";
      const prepared = await this.db.transaction(async (tx) => {
        await tx.query("SELECT 1 FROM sets WHERE id = $1 FOR UPDATE", [membership.setId]);
        const workingSet = await readWorkingSet(tx, membership.setId, membership.role);
        const referenced = referencedAssets(workingSet);
        const notReady = referenced.find((asset) => asset.status !== "ready");
        if (notReady) throw assetNotReady(notReady.name);
        const bytes = Buffer.from(JSON.stringify(showBundle(workingSet)), "utf8");
        const [next] = await rows<{ number: number }>(tx, "SELECT COALESCE(MAX(number), 0) + 1 AS number FROM show_versions WHERE set_id = $1", [membership.setId]);
        const number = next?.number ?? 1;
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await tx.query(
          "INSERT INTO show_versions (set_id, number, status, sha256, size, note, asset_ids, published_by) VALUES ($1,$2,'storing',$3,$4,$5,$6,$7)",
          [membership.setId, number, sha256, bytes.length, note, JSON.stringify(referenced.map((asset) => asset.id)), user.id],
        );
        return { bytes, number };
      });
      const describe = async (): Promise<ShowVersionDoc> => {
        const [row] = await rows<ShowVersionRow>(this.db, `${VERSION_SELECT} WHERE v.set_id = $1 AND v.number = $2`, [membership.setId, prepared.number]);
        const [set] = await rows<{ live_number: number | null }>(this.db, "SELECT live_number FROM sets WHERE id = $1", [membership.setId]);
        if (!row) throw notFound();
        return versionDoc(row, set?.live_number ?? null);
      };
      try {
        await this.storage.putConfirmed(bundleKey(membership.setId, prepared.number), prepared.bytes, "application/json");
      } catch (error) {
        if (!(error instanceof StorageDown)) throw error;
        await this.db.query("UPDATE show_versions SET status = 'store failed' WHERE set_id = $1 AND number = $2", [membership.setId, prepared.number]);
        await recordActivity(this.db, membership.setId, user.id, "show.store_failed", String(prepared.number), `Publishing version ${prepared.number} failed`);
        throw storageUnavailable({ show_version: await describe() });
      }
      await this.db.transaction(async (tx) => {
        await tx.query("UPDATE show_versions SET status = 'published', published_at = clock_timestamp() WHERE set_id = $1 AND number = $2", [membership.setId, prepared.number]);
        await this.movePointer(tx, membership.setId, prepared.number);
        await recordActivity(tx, membership.setId, user.id, "show.publish", String(prepared.number), `Published version ${prepared.number}`);
      });
      await this.hub.publish(membership.setId, { kind: "show", data: { live_number: prepared.number } });
      writeJson(ctx.res, 201, { show_version: await describe() });
    });

    router.add("GET", "/api/sets/:id/shows", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const [set] = await rows<{ live_number: number | null; show_token: string }>(this.db, "SELECT live_number, show_token FROM sets WHERE id = $1", [membership.setId]);
      const found = await rows<ShowVersionRow>(this.db, `${VERSION_SELECT} WHERE v.set_id = $1 ORDER BY v.number DESC`, [membership.setId]);
      const listing: ShowListing = {
        show_url: `/show/${set?.show_token ?? ""}`,
        live_number: set?.live_number ?? null,
        versions: found.map((row) => versionDoc(row, set?.live_number ?? null)),
      };
      writeJson(ctx.res, 200, listing);
    });

    router.add("POST", "/api/sets/:id/shows/rollback", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, OWNER_ONLY);
      const result = await this.switchLive(
        membership.setId, membership.userId,
        (live, published) => (live === null ? null : ([...published].reverse().find((number) => number < live) ?? null)),
        "show.rollback", new ApiError(409, "no_previous_version", "There is no earlier published version"),
      );
      writeJson(ctx.res, 200, result);
    });

    router.add("POST", "/api/sets/:id/shows/:number/activate", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, OWNER_ONLY);
      const wanted = Number(ctx.params["number"]);
      if (!Number.isInteger(wanted) || wanted < 1) throw validation({ number: "Version must be a whole number" });
      const exists = await rows(this.db, "SELECT 1 FROM show_versions WHERE set_id = $1 AND number = $2", [membership.setId, wanted]);
      if (exists.length === 0) throw notFound();
      const result = await this.switchLive(
        membership.setId, membership.userId, (_live, published) => (published.includes(wanted) ? wanted : null),
        "show.activate", new ApiError(409, "not_published", `Version ${wanted} is not published`),
      );
      writeJson(ctx.res, 200, result);
    });

    router.add("GET", "/api/show/:token", { public: true }, async (ctx) => {
      const live = await this.requireLive(ctx.params["token"] ?? "");
      const [version] = await rows<ShowVersionRow>(this.db, `${VERSION_SELECT} WHERE v.set_id = $1 AND v.number = $2`, [live.set_id, live.live_number]);
      if (!version) throw notFound();
      const info: ShowInfo = {
        set_name: live.set_name, bpm: live.bpm,
        version: { number: version.number, sha256: version.sha256, size: version.size, published_at: version.published_at.toISOString() },
      };
      writeJson(ctx.res, 200, info);
    });

    router.add("GET", "/api/show/:token/bundle", { public: true }, async (ctx) => {
      const live = await this.requireLive(ctx.params["token"] ?? "");
      const [version] = await rows<{ sha256: string }>(this.db, "SELECT sha256 FROM show_versions WHERE set_id = $1 AND number = $2", [live.set_id, live.live_number]);
      const bytes = await this.readStored(bundleKey(live.set_id, live.live_number));
      ctx.res.writeHead(200, {
        "content-type": "application/json", "content-length": bytes.length, "X-Bundle-SHA256": version?.sha256 ?? "",
        "X-Show-Version": String(live.live_number), "cache-control": "no-store",
      });
      ctx.res.end(bytes);
    });

    router.add("GET", "/api/show/:token/assets/:assetId", { public: true }, async (ctx) => {
      const live = await this.requireLive(ctx.params["token"] ?? "");
      const assetId = ctx.params["assetId"] ?? "";
      const [version] = await rows<{ listed: boolean }>(this.db, 
        "SELECT asset_ids ? $3 AS listed FROM show_versions WHERE set_id = $1 AND number = $2", [live.set_id, live.live_number, assetId],
      );
      if (!version?.listed) throw notFound();
      const [asset] = await rows<{ content_type: string; sha256: string }>(this.db, "SELECT content_type, sha256 FROM assets WHERE id = $1 AND set_id = $2", [assetId, live.set_id]);
      if (!asset) throw notFound();
      const bytes = await this.readStored(assetKey(live.set_id, assetId));
      ctx.res.writeHead(200, { "content-type": asset.content_type, "content-length": bytes.length, "X-Content-SHA256": asset.sha256 });
      ctx.res.end(bytes);
    });

    router.add("GET", "/api/show/:token/events", { public: true }, async (ctx) => {
      const set = await this.liveOf(ctx.params["token"] ?? "");
      if (!set) throw notFound();
      const stream = openStream(ctx.res);
      stream.send("show", { live_number: set.live_number });
      const stop = this.hub.listen(set.set_id, (event) => {
        if (event.kind === "show") stream.send("show", event.data);
      });
      ctx.req.on("close", () => {
        stop();
        stream.close();
      });
    });
  }

  private async readStored(key: string): Promise<Buffer> {
    try {
      const bytes = await this.storage.get(key);
      if (!bytes) throw notFound();
      return bytes;
    } catch (error) {
      if (error instanceof StorageDown) throw storageUnavailable();
      throw error;
    }
  }
}
