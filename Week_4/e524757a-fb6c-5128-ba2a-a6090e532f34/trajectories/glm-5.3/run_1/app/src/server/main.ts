// The Hushfoot server: pages, API, live stream, grading routes.

import * as http from "node:http";
import { loadConfig, Config } from "../shared/config";
import { createPool, Db, withTransaction } from "./db";
import { migrate } from "./schema";
import { createStorage, Storage, objectKeyFor, ImageType } from "./storage";
import { createMailer, Mailer } from "./mail";
import { WorldClock } from "./clock";
import { ApiError, json, fail, readJson, readBody, str, num } from "./http";
import { openSse, publishLive } from "./live";
import * as players from "./players";
import { hashPassword, verifyPassword } from "./passwords";
import { handlePhoto, parsePose, parseMultipart, photoBody, setPhotoConfig } from "./photos";
import { creatureById } from "../shared/creatures";
import { ISLANDS, isLand, Heading, HEADINGS, islandById } from "../shared/world";
import { newId, makeSafariCode, handleFromName, makeConfirmCode, isValidEmail, isBlank } from "../shared/ids";
import { Pages } from "./pages";
import { seedMainWorld, createGradingWorld } from "./seed";

const JSON_LIMIT = 64000;

export class App {
  readonly config: Config;
  readonly db: Db;
  readonly storage: Storage;
  readonly mailer: Mailer;
  readonly clock: WorldClock;
  readonly pages: Pages;

  constructor() {
    this.config = loadConfig();
    this.db = createPool(this.config.databaseUrl);
    this.storage = createStorage(this.config);
    this.mailer = createMailer(this.config);
    this.clock = new WorldClock(this.db, this.config);
    this.pages = new Pages();
    setPhotoConfig(this.config);
  }

  async start(): Promise<void> {
    // A dependency unreachable at boot does not stop the server.
    try {
      await migrate(this.db);
      await seedMainWorld(this);
    } catch {
      const timer = setInterval(async () => {
        try {
          await migrate(this.db);
          await seedMainWorld(this);
          clearInterval(timer);
        } catch { /* retry */ }
      }, 2000);
    }
    try {
      await this.storage.healthy();
    } catch { /* storage unreachable is fine */ }
  }

  async databaseHealthy(): Promise<boolean> {
    try {
      await this.db.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      await this.route(req, res);
    } catch (err) {
      if (err instanceof ApiError) {
        fail(res, err);
        return;
      }
      const dbDown = !(await this.databaseHealthy());
      if (dbDown) {
        fail(res, new ApiError("database_unavailable"));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal", message: "Something went wrong." }));
    }
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // Same origin only: a state-changing request from another site is refused.
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host ?? "";
        try {
          if (new URL(origin).host !== host) throw new ApiError("bad_origin");
        } catch {
          throw new ApiError("bad_origin");
        }
      }
    }

    if (path === "/api/health" && method === "GET") return this.health(res);
    if (path.startsWith("/api/")) return this.api(req, res, url, method);
    if (path === "/favicon.ico") {
      res.writeHead(204); res.end(); return;
    }
    return this.pages.serve(req, res, url, method);
  }

  private async health(res: http.ServerResponse): Promise<void> {
    const db = await this.databaseHealthy().catch(() => false);
    const storage = await this.storage.healthy().catch(() => false);
    json(res, 200, { status: db && storage ? "ok" : "unavailable" });
  }

  // ---------------- API ----------------

  private async api(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<void> {
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean); // ["api", ...]
    const body: (string | null)[] = [path, method, url.searchParams.get("player")];
    void body;

    const token = sessionToken(req);
    const player = await players.playerByToken(this.db, token);
    const ctx = new Ctx(this, req, res, url, player, token);

    try {
      // Auth
      if (path === "/api/signup" && method === "POST") return await this.signup(ctx);
      if (path === "/api/session" && method === "POST") return await this.signin(ctx);
      if (path === "/api/session" && method === "DELETE") {
        if (!ctx.player) throw new ApiError("not_signed_in");
        await players.deleteSession(this.db, token!);
        ctx.res.writeHead(204); ctx.res.end();
        return;
      }
      if (path === "/api/confirm" && method === "POST") return await this.confirm(ctx);
      if (path === "/api/confirm/resend" && method === "POST") return await this.resend(ctx);

      if (path === "/api/live" && method === "GET") return this.live(ctx);

      if (path === "/api/world" && method === "GET") return await this.world(ctx);

      if (path === "/api/photos" && method === "POST") return await this.postPhoto(ctx);
      if (path === "/api/me/photos" && method === "GET") return await this.myPhotos(ctx);
      if (parts.length === 4 && parts[1] === "photos" && parts[3] === "image" && method === "GET") return await this.photoImage(ctx, parts[2]);
      if (parts.length === 3 && parts[1] === "photos" && method === "GET") return await this.getPhoto(ctx, parts[2]);
      if (parts.length === 4 && parts[1] === "photos" && parts[3] === "like" && (method === "PUT" || method === "DELETE")) return await this.like(ctx, parts[2], method === "PUT");

      // Everything below needs a session (handled inside each handler via ctx.requirePlayer).
      if (path === "/api/me" && method === "GET") return await this.me(ctx);
      if (path === "/api/me/position" && method === "PUT") return await this.putPosition(ctx);
      if (path === "/api/me/albums" && method === "GET") return await this.myAlbums(ctx);
      if (path === "/api/me/refill" && method === "POST") return await this.refill(ctx);
      if (path === "/api/me/restart" && method === "POST") return await this.restart(ctx);
      if (path === "/api/me/settings" && method === "GET") return await this.getSettings(ctx);
      if (path === "/api/me/settings" && method === "PUT") return await this.putSettings(ctx);
      if (path === "/api/me/hall" && method === "GET") return await this.myHall(ctx);
      if (path === "/api/me/hall" && method === "PUT") return await this.putHall(ctx);
      if (parts.length === 3 && parts[1] === "halls" && method === "GET") return await this.getHall(ctx, parts[2]);

      if (path === "/api/safaris" && method === "POST") return await this.startSafari(ctx);
      if (path === "/api/safaris/current" && method === "GET") return await this.currentSafari(ctx);
      if (parts.length === 4 && parts[1] === "safaris" && parts[3] === "join" && method === "POST") return await this.joinSafari(ctx, parts[2]);
      if (parts.length === 4 && parts[1] === "safaris" && parts[3] === "sightings" && method === "POST") return await this.addSighting(ctx, parts[2]);
      if (parts.length === 4 && parts[1] === "safaris" && parts[3] === "leave" && method === "POST") return await this.leaveSafari(ctx, parts[2]);
      if (parts.length === 4 && parts[1] === "safaris" && parts[3] === "end" && method === "POST") return await this.endSafari(ctx, parts[2]);

      if (path === "/api/notes" && method === "GET") return await this.notes(ctx);
      if (path === "/api/notes" && method === "POST") return await this.pinNote(ctx);
      if (path === "/api/ranger/notes" && method === "GET") return await this.rangerNotes(ctx);
      if (parts.length === 4 && parts[1] === "notes" && parts[3] === "approve" && method === "POST") return await this.approveNote(ctx, parts[2]);
      if (parts.length === 4 && parts[1] === "notes" && parts[3] === "decline" && method === "POST") return await this.declineNote(ctx, parts[2]);
      if (parts.length === 3 && parts[1] === "notes" && method === "DELETE") return await this.removeNote(ctx, parts[2]);

      if (path === "/api/postcards" && method === "POST") return await this.postPostcard(ctx);
      if (parts.length === 3 && parts[1] === "postcards" && method === "GET") return await this.getPostcard(ctx, parts[2]);

      if (parts.length === 3 && parts[1] === "boards" && method === "GET") return await this.getBoard(ctx, parts[2]);
      if (parts.length === 4 && parts[1] === "boards" && parts[3] === "entries" && method === "POST") return await this.enterBoard(ctx, parts[2]);

      if (this.config.gradingRoutes) {
        if (path === "/api/grading/world" && method === "POST") return await this.gradingWorld(ctx);
        if (path === "/api/grading/clock" && method === "POST") return await this.gradingClock(ctx);
      }

      throw new ApiError("not_found");
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const dbDown = !(await this.databaseHealthy());
      if (dbDown) throw new ApiError("database_unavailable");
      throw err;
    }
  }

  private live(ctx: Ctx): void {
    const p = ctx.player ?? null;
    if (!p) {
      ctx.res.writeHead(401, { "Content-Type": "application/json" });
      ctx.res.end(JSON.stringify({ error: "not_signed_in", message: "Sign in first." }));
      return;
    }
    openSse(ctx.req, ctx.res, p.world_id);
  }

  private async world(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const snap = await this.clock.snapshot(p.world_id);
    const lighthouse = await players.lighthouseOpen(this.db, p.id);
    json(ctx.res, 200, {
      world: p.world_id,
      tick: snap.tick,
      hour: snap.hour,
      minute: snap.minute,
      time: snap.time,
      weather: snap.weather,
      dusk: snap.dusk,
      lighthouse: lighthouse ? "open" : "closed",
      creatures: snap.creatures.map(c => ({ id: c.id, name: c.name, island: c.island, size: c.size, x: c.x, y: c.y, heading: c.heading }))
    });
  }

  private async signup(ctx: Ctx): Promise<void> {
    const body = await readJson(ctx.req, JSON_LIMIT);
    const name = str(body.name).trim();
    const email = str(body.email).trim().toLowerCase();
    const password = str(body.password);
    if (name.length < 1 || name.length > 40) throw new ApiError("bad_name");
    if (!isValidEmail(email)) throw new ApiError("bad_email");
    if (password.length < 8) throw new ApiError("bad_password");

    const worldId = await this.mainWorldId();
    const exists = await this.db.query("SELECT 1 FROM players WHERE world_id = $1 AND lower(email) = $2", [worldId, email]);
    if (exists.rows.length > 0) throw new ApiError("email_taken");

    const id = newId("player");
    const handleBase = handleFromName(name);
    let handle = handleBase;
    for (let i = 0; i < 50; i++) {
      const taken = await this.db.query("SELECT 1 FROM players WHERE world_id = $1 AND handle = $2", [worldId, handle]);
      if (taken.rows.length === 0) break;
      handle = `${handleBase}${i + 2}`;
    }

    const hash = await hashPassword(password);
    const code = makeConfirmCode();
    let codeSent = false;
    try {
      await this.mailer.send({
        to: email,
        subject: "Your Hushfoot confirmation code",
        text: `Your code is ${code}.\n`
      });
      codeSent = true;
    } catch { codeSent = false; }

    await withTransaction(this.db, async client => {
      await client.query(
        "INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger, code, code_expires_at) VALUES ($1,$2,$3,$4,$5,$6,FALSE,FALSE,$7, now() + make_interval(secs => $8))",
        [id, worldId, name, handle, email, hash, code, this.config.confirmCodeTtlSeconds]);
      await client.query("INSERT INTO positions (player_id) VALUES ($1)", [id]);
      await players.writeFilm(client, id, 36, "start");
      await client.query("INSERT INTO hall_frames (player_id, public) VALUES ($1, FALSE)", [id]);
      await client.query("INSERT INTO settings (player_id) VALUES ($1)", [id]);
    });

    const token = await players.createSession(this.db, id);
    setCookie(ctx.res, token);
    const row = await players.playerById(this.db, id);
    json(ctx.res, 201, { player: players.playerBody(row!, true), code_sent: codeSent });
  }

  private async signin(ctx: Ctx): Promise<void> {
    const body = await readJson(ctx.req, JSON_LIMIT);
    const email = str(body.email).trim().toLowerCase();
    const password = str(body.password);
    const r = await this.db.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM players WHERE lower(email) = $1", [email]);
    const row = r.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new ApiError("bad_credentials");
    const token = await players.createSession(this.db, row.id);
    setCookie(ctx.res, token);
    const p = await players.playerById(this.db, row.id);
    json(ctx.res, 200, { player: players.playerBody(p!, true) });
  }

  private async confirm(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const body = await readJson(ctx.req, JSON_LIMIT);
    const code = str(body.code).trim();
    if (p.confirmed) {
      json(ctx.res, 200, { player: players.playerBody(p, true) });
      return;
    }
    const r = await this.db.query<{ code: string | null; code_expires_at: Date | null }>(
      "SELECT code, code_expires_at FROM players WHERE id = $1", [p.id]);
    const row = r.rows[0];
    if (!row.code || row.code !== code) throw new ApiError("bad_code");
    if (row.code_expires_at && row.code_expires_at.getTime() < Date.now()) throw new ApiError("code_expired");
    await this.db.query("UPDATE players SET confirmed = TRUE, code = NULL, code_expires_at = NULL WHERE id = $1", [p.id]);
    const updated = await players.playerById(this.db, p.id);
    json(ctx.res, 200, { player: players.playerBody(updated!, true) });
  }

  private async resend(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const code = makeConfirmCode();
    try {
      await this.mailer.send({
        to: p.email,
        subject: "Your Hushfoot confirmation code",
        text: `Your code is ${code}.\n`
      });
    } catch {
      throw new ApiError("mail_unavailable_code");
    }
    await this.db.query(
      "UPDATE players SET code = $2, code_expires_at = now() + make_interval(secs => $3) WHERE id = $1",
      [p.id, code, this.config.confirmCodeTtlSeconds]);
    json(ctx.res, 200, { sent: true });
  }

  private async me(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const position = await players.positionOf(this.db, p.id);
    const film = await players.filmSatchel(this.db, p.id);
    const stamps = await players.stampsCount(this.db, p.id);
    const lighthouse = await players.lighthouseOpen(this.db, p.id);
    const settings = await this.getSettingsRow(p.id);
    json(ctx.res, 200, {
      player: players.playerBody(p, true),
      position: { island: position.island, tile: position.tile, heading: position.heading },
      film,
      stamps,
      lighthouse: lighthouse ? "open" : "closed",
      settings
    });
  }

  private async putPosition(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const body = await readJson(ctx.req, JSON_LIMIT);
    const island = num(body.island);
    const tile = body.tile;
    const heading = str(body.heading);
    if (!Number.isInteger(island) || island < 1 || island > 5) throw new ApiError("not_land");
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(n => Number.isInteger(n))) throw new ApiError("not_land");
    if (!HEADINGS.includes(heading as Heading)) throw new ApiError("not_land");
    const [x, y] = tile as number[];
    if (!isLand(island, x, y)) throw new ApiError("not_land");
    await players.savePosition(this.db, p.id, { island, tile: [x, y], heading: heading as Heading });
    publishLive({ world: p.world_id, kind: "position", payload: { player_id: p.id, island, tile: [x, y], heading } });
    const position = await players.positionOf(this.db, p.id);
    json(ctx.res, 200, { position: { island: position.island, tile: position.tile, heading: position.heading } });
  }

  private async myAlbums(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const albums = [];
    let stamps = 0;
    for (const island of ISLANDS) {
      const pages = await players.albumOf(this.db, p.id, island.id);
      const filled = pages.filter(pg => pg.filled).length;
      const stamp = await players.stampOf(this.db, p.id, island.id);
      if (stamp) stamps++;
      albums.push({ island: island.id, island_name: island.name, pages, pages_filled: filled, stamp });
    }
    const film = await players.filmSatchel(this.db, p.id);
    const lighthouse = await players.lighthouseOpen(this.db, p.id);
    json(ctx.res, 200, { albums, stamps, lighthouse: lighthouse ? "open" : "closed", film });
  }

  private async refill(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const position = await players.positionOf(this.db, p.id);
    if (position.island !== 1) throw new ApiError("not_at_harbour");
    const film = await players.filmSatchel(this.db, p.id);
    if (film >= 36) throw new ApiError("film_full");
    const after = await players.grantFilm(this.db, p.id, 36 - film, "refill");
    publishLive({ world: p.world_id, kind: "film", payload: { player_id: p.id, film: after } });
    json(ctx.res, 200, { film: after });
  }

  private async restart(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const after = await withTransaction(this.db, async client => {
      await client.query("DELETE FROM album_pages WHERE player_id = $1", [p.id]);
      await client.query("UPDATE stamps SET earned = FALSE WHERE player_id = $1", [p.id]);
      const film = await players.filmSatchelIn(client, p.id);
      await players.writeFilm(client, p.id, 36 - film, "restart");
      await client.query("UPDATE positions SET island = 1, x = 3, y = 12, heading = 'E', updated_at = now() WHERE player_id = $1", [p.id]);
      return await players.filmSatchelIn(client, p.id);
    });
    publishLive({ world: p.world_id, kind: "restart", payload: { player_id: p.id, film: after, stamps: 0, lighthouse: "closed", position: { island: 1, tile: [3, 12], heading: "E" } } });
    json(ctx.res, 200, { position: { island: 1, tile: [3, 12], heading: "E" }, film: after, stamps: 0, lighthouse: "closed" });
  }

  private async getSettings(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    json(ctx.res, 200, { settings: await this.getSettingsRow(p.id) });
  }

  private async getSettingsRow(playerId: string): Promise<{ music: number; effects: number; graphics: string }> {
    const r = await this.db.query<{ music: number; effects: number; graphics: string }>(
      "SELECT music, effects, graphics FROM settings WHERE player_id = $1", [playerId]);
    return r.rows[0] ?? { music: 60, effects: 80, graphics: "full" };
  }

  private async putSettings(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const body = await readJson(ctx.req, JSON_LIMIT);
    const music = num(body.music);
    const effects = num(body.effects);
    const graphics = str(body.graphics);
    if (!Number.isInteger(music) || music < 0 || music > 100 || !Number.isInteger(effects) || effects < 0 || effects > 100) throw new ApiError("bad_request");
    if (!["full", "balanced", "light"].includes(graphics)) throw new ApiError("bad_request");
    await this.db.query(
      `INSERT INTO settings (player_id, music, effects, graphics) VALUES ($1,$2,$3,$4)
       ON CONFLICT (player_id) DO UPDATE SET music = $2, effects = $3, graphics = $4`,
      [p.id, music, effects, graphics]);
    json(ctx.res, 200, { settings: { music, effects, graphics } });
  }

  private async postPhoto(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const shotKey = header(ctx.req, "shot-key") ?? ctx.url.searchParams.get("shot-key");
    const contentType = header(ctx.req, "content-type") ?? "";
    if (!/multipart\/form-data/i.test(contentType)) {
      // A JSON pose with no image: read the pose to produce its refusal order.
      const body = await readJson(ctx.req, JSON_LIMIT);
      void body;
      throw new ApiError("bad_pose");
    }
    const raw = await readBody(ctx.req, this.config.photoMaxBytes + JSON_LIMIT + 4096);
    const parsed = parseMultipart(raw, contentType);
    const poseRaw = parsed.fields.pose;
    if (!poseRaw) throw new ApiError("bad_pose");
    const pose = parsePose(poseRaw);
    if (!parsed.image) throw new ApiError("not_an_image");
    const answer = await handlePhoto(this.db, this.config, this.storage, this.clock, {
      playerId: p.id, worldId: p.world_id, shotKey, pose, image: parsed.image
    });
    json(ctx.res, 201, answer);
  }

  private async myPhotos(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const r = await this.db.query(
      "SELECT id, creature_id, island, tick, size, centring, facing, sharpness, total FROM photos WHERE player_id = $1 ORDER BY created_at DESC", [p.id]);
    json(ctx.res, 200, { photos: r.rows.map(photoBody) });
  }

  private async getPhoto(ctx: Ctx, id: string): Promise<void> {
    ctx.requirePlayer();
    const r = await this.db.query(
      "SELECT id, player_id, creature_id, island, tick, size, centring, facing, sharpness, total FROM photos WHERE id = $1", [id]);
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found");
    if (!(await this.maySeePhoto(ctx.player, row.player_id, row.id))) throw new ApiError("not_found");
    json(ctx.res, 200, { photo: photoBody(row) });
  }

  /** A photo's image is visible to its owner; to anyone while hung in a public hall, entered on a board, on a postcard, or fed to the seated safari guest; and to no one else. */
  private async maySeePhoto(viewer: players.PlayerRow | null, ownerId: string, photoId: string): Promise<boolean> {
    if (viewer && viewer.id === ownerId) return true;
    if (await this.photoOnPublicHall(photoId)) return true;
    if (await this.photoOnBoard(photoId)) return true;
    if (await this.photoOnPostcard(photoId)) return true;
    if (viewer && await this.photoFedToViewer(viewer, ownerId)) return true;
    return false;
  }

  private async photoOnPublicHall(photoId: string): Promise<boolean> {
    const r = await this.db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM hall_photos hp JOIN hall_frames hf ON hf.player_id = hp.player_id
       WHERE hp.photo_id = $1 AND hf.public`, [photoId]);
    return Number(r.rows[0].n) > 0;
  }

  private async photoOnBoard(photoId: string): Promise<boolean> {
    const r = await this.db.query("SELECT 1 FROM board_entries WHERE photo_id = $1", [photoId]);
    return r.rows.length > 0;
  }

  private async photoOnPostcard(photoId: string): Promise<boolean> {
    const r = await this.db.query("SELECT 1 FROM postcards WHERE photo_id = $1 AND status = 'posted'", [photoId]);
    return r.rows.length > 0;
  }

  private async photoFedToViewer(viewer: players.PlayerRow, ownerId: string): Promise<boolean> {
    const r = await this.db.query<{ guest_id: string | null }>(
      "SELECT guest_id FROM safaris WHERE host_id = $1 AND status = 'joined' AND guest_id = $2", [ownerId, viewer.id]);
    const guestId = r.rows[0]?.guest_id;
    if (!guestId) return false;
    const joined = await this.db.query<{ created_at: Date }>(
      "SELECT created_at FROM safaris WHERE host_id = $1 AND guest_id = $2 AND status = 'joined'", [ownerId, guestId]);
    const joinedAt = joined.rows[0]?.created_at;
    if (!joinedAt) return false;
    const kept = await this.db.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM photos WHERE player_id = $1 AND created_at >= $2", [ownerId, joinedAt]);
    return Number(kept.rows[0].n) > 0;
  }

  private async photoImage(ctx: Ctx, id: string): Promise<void> {
    const r = await this.db.query<{ player_id: string; content_type: ImageType }>(
      "SELECT player_id, content_type FROM photos WHERE id = $1", [id]);
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found");
    if (!(await this.maySeePhoto(ctx.player, row.player_id, id))) throw new ApiError("not_found");
    const buf = await this.storage.get(objectKeyFor(id, row.content_type));
    if (!buf) throw new ApiError("storage_unavailable_image");
    ctx.res.writeHead(200, {
      "Content-Type": row.content_type,
      "Content-Length": buf.length,
      "Cache-Control": "no-store"
    });
    ctx.res.end(buf);
  }

  private async like(ctx: Ctx, photoId: string, like: boolean): Promise<void> {
    const p = ctx.requirePlayer();
    const r = await this.db.query<{ player_id: string }>("SELECT player_id FROM photos WHERE id = $1", [photoId]);
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found");
    if (!(await this.photoOnPublicHall(photoId))) throw new ApiError("not_found");
    if (row.player_id === p.id) throw new ApiError("own_photo");
    if (like) {
      await this.db.query("INSERT INTO likes (photo_id, visitor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [photoId, p.id]);
    } else {
      await this.db.query("DELETE FROM likes WHERE photo_id = $1 AND visitor_id = $2", [photoId, p.id]);
    }
    const count = await this.db.query<{ n: string }>("SELECT COUNT(*) AS n FROM likes WHERE photo_id = $1", [photoId]);
    const n = Number(count.rows[0].n);
    publishLive({ world: p.world_id, kind: "like", payload: { photo_id: photoId, likes: n, liked: like, visitor: p.name, owner_id: row.player_id } });
    json(ctx.res, 200, { likes: n, liked: like });
  }

  // ---------------- halls ----------------

  private async myHall(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const r = await this.db.query<{ frame: number; caption: string; photo_id: string; player_id: string }>(
      `SELECT hp.frame, hp.caption, hp.photo_id, ph.player_id FROM hall_photos hp
       JOIN photos ph ON ph.id = hp.photo_id WHERE hp.player_id = $1 ORDER BY hp.frame`, [p.id]);
    const frames = [];
    for (const row of r.rows) {
      const likes = await this.db.query<{ n: string }>("SELECT COUNT(*) AS n FROM likes WHERE photo_id = $1", [row.photo_id]);
      frames.push({ frame: row.frame, caption: row.caption, photo: row.photo_id, likes: Number(likes.rows[0].n) });
    }
    const pub = await this.db.query<{ public: boolean }>("SELECT public FROM hall_frames WHERE player_id = $1", [p.id]);
    json(ctx.res, 200, { hall: { handle: p.handle, public: pub.rows[0]?.public ?? false, frames } });
  }

  private async putHall(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const body = await readJson(ctx.req, JSON_LIMIT);
    await withTransaction(this.db, async client => {
      if (body.public !== undefined) {
        const pub = Boolean(body.public);
        await client.query(
          `INSERT INTO hall_frames (player_id, public) VALUES ($1,$2)
           ON CONFLICT (player_id) DO UPDATE SET public = $2`, [p.id, pub]);
      }
      if (body.frames !== undefined) {
        if (!Array.isArray(body.frames) || body.frames.length > 12) throw new ApiError("hall_full");
        const seen = new Set<string>();
        for (const f of body.frames) {
          if (f === null || typeof f !== "object") throw new ApiError("bad_request");
          const rec = f as Record<string, unknown>;
          const photoId = str(rec.photo);
          const caption = str(rec.caption ?? "");
          if (caption.length > 140) throw new ApiError("caption_too_long");
          if (seen.has(photoId)) throw new ApiError("bad_request");
          seen.add(photoId);
          const owned = await client.query("SELECT 1 FROM photos WHERE id = $1 AND player_id = $2", [photoId, p.id]);
          if (owned.rows.length === 0) throw new ApiError("not_found");
        }
        await client.query("DELETE FROM hall_photos WHERE player_id = $1", [p.id]);
        for (let i = 0; i < body.frames.length; i++) {
          const rec = body.frames[i] as Record<string, unknown>;
          await client.query(
            "INSERT INTO hall_photos (player_id, frame, photo_id, caption) VALUES ($1,$2,$3,$4)",
            [p.id, i + 1, str(rec.photo), str(rec.caption ?? "")]);
        }
      }
    });
    return this.myHall(ctx);
  }

  private async getHall(ctx: Ctx, handle: string): Promise<void> {
    const r = await this.db.query<{ id: string; name: string; public: boolean }>(
      `SELECT p.id, p.name, hf.public FROM players p JOIN hall_frames hf ON hf.player_id = p.id WHERE p.handle = $1`, [handle]);
    const row = r.rows[0];
    if (!row || !row.public) throw new ApiError("not_found");
    const framesR = await this.db.query<{ frame: number; caption: string; photo_id: string }>(
      `SELECT hp.frame, hp.caption, hp.photo_id FROM hall_photos hp WHERE hp.player_id = $1 ORDER BY hp.frame`, [row.id]);
    const frames = [];
    for (const f of framesR.rows) {
      const likes = await this.db.query<{ n: string }>("SELECT COUNT(*) AS n FROM likes WHERE photo_id = $1", [f.photo_id]);
      let likedByMe = false;
      if (ctx.player) {
        const mine = await this.db.query("SELECT 1 FROM likes WHERE photo_id = $1 AND visitor_id = $2", [f.photo_id, ctx.player.id]);
        likedByMe = mine.rows.length > 0;
      }
      frames.push({ frame: f.frame, caption: f.caption, photo: f.photo_id, likes: Number(likes.rows[0].n), liked_by_me: likedByMe });
    }
    json(ctx.res, 200, { hall: { handle, owner_name: row.name, frames } });
  }

  // ---------------- safaris ----------------

  private async startSafari(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const existing = await this.currentSafariRow(p);
    if (existing) { json(ctx.res, 200, { safari: safariBody(existing) }); return; }
    const row = await withTransaction(this.db, async client => {
      let code = makeSafariCode();
      for (let i = 0; i < 20; i++) {
        const taken = await client.query("SELECT 1 FROM safaris WHERE world_id = $1 AND code = $2", [p.world_id, code]);
        if (taken.rows.length === 0) break;
        code = makeSafariCode();
      }
      await client.query(
        "INSERT INTO safaris (code, world_id, status, host_id) VALUES ($1,$2,'open',$3)",
        [code, p.world_id, p.id]);
      const r = await client.query("SELECT code, status, host_id, guest_id FROM safaris WHERE world_id = $1 AND code = $2", [p.world_id, code]);
      return r.rows[0];
    });
    publishLive({ world: p.world_id, kind: "safari", payload: { code: row.code, status: row.status, host: p.name, host_id: p.id, guest: null } });
    json(ctx.res, 201, { safari: safariBody(row) });
  }

  private async currentSafariRow(p: players.PlayerRow): Promise<{ code: string; status: string; host_id: string; guest_id: string | null } | null> {
    const r = await this.db.query<{ code: string; status: string; host_id: string; guest_id: string | null }>(
      "SELECT code, status, host_id, guest_id FROM safaris WHERE world_id = $1 AND (host_id = $2 OR guest_id = $2) AND status <> 'ended'",
      [p.world_id, p.id]);
    return r.rows[0] ?? null;
  }

  private async currentSafari(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const row = await this.currentSafariRow(p);
    if (!row) { json(ctx.res, 200, { safari: null }); return; }
    const sightings = await this.sightingsOf(row.code);
    json(ctx.res, 200, { safari: { ...safariBody(row), sightings } });
  }

  private async sightingsOf(code: string): Promise<{ island: number; x: number; y: number; by: string }[]> {
    const r = await this.db.query<{ island: number; x: number; y: number; by_name: string }>(
      "SELECT island, x, y, by_name FROM sightings WHERE safari_code = $1 ORDER BY id", [code]);
    return r.rows.map(s => ({ island: s.island, x: s.x, y: s.y, by: s.by_name }));
  }

  private async joinSafari(ctx: Ctx, code: string): Promise<void> {
    const p = ctx.requirePlayer();
    const upper = code.toUpperCase();
    const row = await withTransaction(this.db, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`safari:${p.world_id}:${upper}`]);
      const r = await client.query<{ code: string; status: string; host_id: string; guest_id: string | null }>(
        "SELECT code, status, host_id, guest_id FROM safaris WHERE world_id = $1 AND code = $2 FOR UPDATE",
        [p.world_id, upper]);
      const safari = r.rows[0];
      if (!safari) throw new ApiError("no_safari");
      if (safari.status === "ended") throw new ApiError("safari_ended");
      if (safari.host_id === p.id) throw new ApiError("own_safari");
      if (safari.guest_id === p.id) return safari;
      if (safari.guest_id !== null) throw new ApiError("safari_full");
      await client.query("UPDATE safaris SET status = 'joined', guest_id = $3, seat_freed_at = now() + make_interval(secs => $4) WHERE world_id = $1 AND code = $2",
        [p.world_id, upper, p.id, this.config.safariSeatReleaseSeconds]);
      const after = await client.query<{ code: string; status: string; host_id: string; guest_id: string | null }>(
        "SELECT code, status, host_id, guest_id FROM safaris WHERE world_id = $1 AND code = $2", [p.world_id, upper]);
      return after.rows[0];
    });
    publishLive({ world: p.world_id, kind: "safari", payload: { code: row.code, status: row.status, host_id: row.host_id, guest_id: row.guest_id, joined: p.name, host_id_join: p.id } });
    const hostName = await this.playerName(row.host_id);
    const sightings = await this.sightingsOf(row.code);
    json(ctx.res, 200, { safari: { ...safariBody(row, hostName), sightings } });
  }

  private async playerName(id: string): Promise<string> {
    const r = await this.db.query<{ name: string }>("SELECT name FROM players WHERE id = $1", [id]);
    return r.rows[0]?.name ?? "";
  }

  private async addSighting(ctx: Ctx, code: string): Promise<void> {
    const p = ctx.requirePlayer();
    const body = await readJson(ctx.req, JSON_LIMIT);
    const island = num(body.island);
    const tile = body.tile;
    if (!Number.isInteger(island) || island < 1 || island > 5) throw new ApiError("bad_request");
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(n => Number.isInteger(n))) throw new ApiError("bad_request");
    const r = await this.db.query<{ host_id: string; guest_id: string | null; status: string }>(
      "SELECT host_id, guest_id, status FROM safaris WHERE world_id = $1 AND code = $2", [p.world_id, code.toUpperCase()]);
    const safari = r.rows[0];
    if (!safari) throw new ApiError("no_safari");
    if (safari.host_id !== p.id) throw new ApiError("not_host");
    if (safari.status === "ended") throw new ApiError("safari_ended");
    const [x, y] = tile as number[];
    await this.db.query(
      "INSERT INTO sightings (safari_code, world_id, island, x, y, by_name) VALUES ($1,$2,$3,$4,$5,$6)",
      [code.toUpperCase(), p.world_id, island, x, y, p.name]);
    publishLive({ world: p.world_id, kind: "sighting", payload: { code: code.toUpperCase(), island, x, y, by: p.name } });
    json(ctx.res, 201, { sighting: { island, x, y, by: p.name } });
  }

  private async leaveSafari(ctx: Ctx, code: string): Promise<void> {
    const p = ctx.requirePlayer();
    const row = await withTransaction(this.db, async client => {
      const r = await client.query<{ host_id: string; guest_id: string | null; status: string }>(
        "SELECT host_id, guest_id, status FROM safaris WHERE world_id = $1 AND code = $2 FOR UPDATE",
        [p.world_id, code.toUpperCase()]);
      const safari = r.rows[0];
      if (!safari || safari.guest_id !== p.id) throw new ApiError("no_safari");
      await client.query("UPDATE safaris SET status = 'open', guest_id = NULL WHERE world_id = $1 AND code = $2", [p.world_id, code.toUpperCase()]);
      const after = await client.query("SELECT code, status, host_id, guest_id FROM safaris WHERE world_id = $1 AND code = $2", [p.world_id, code.toUpperCase()]);
      return after.rows[0];
    });
    publishLive({ world: p.world_id, kind: "safari", payload: { code: row.code, status: row.status, host_id: row.host_id, guest_id: row.guest_id, left: p.name } });
    json(ctx.res, 200, { safari: safariBody(row) });
  }

  private async endSafari(ctx: Ctx, code: string): Promise<void> {
    const p = ctx.requirePlayer();
    const row = await withTransaction(this.db, async client => {
      const r = await client.query<{ host_id: string; guest_id: string | null; status: string }>(
        "SELECT host_id, guest_id, status FROM safaris WHERE world_id = $1 AND code = $2 FOR UPDATE",
        [p.world_id, code.toUpperCase()]);
      const safari = r.rows[0];
      if (!safari) throw new ApiError("no_safari");
      if (safari.host_id !== p.id) throw new ApiError("not_host");
      if (safari.status === "ended") throw new ApiError("safari_ended");
      await client.query("UPDATE safaris SET status = 'ended', guest_id = NULL WHERE world_id = $1 AND code = $2", [p.world_id, code.toUpperCase()]);
      const after = await client.query("SELECT code, status, host_id, guest_id FROM safaris WHERE world_id = $1 AND code = $2", [p.world_id, code.toUpperCase()]);
      return after.rows[0];
    });
    publishLive({ world: p.world_id, kind: "safari", payload: { code: row.code, status: row.status, host_id: row.host_id, guest_id: row.guest_id, ended: true } });
    json(ctx.res, 200, { safari: safariBody(row) });
  }

  // ---------------- notes ----------------

  private async notes(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    const r = await this.db.query<{ id: string; text: string; author_name: string; status: string; reason: string | null; author_id: string }>(
      `SELECT n.id, n.text, p.name AS author_name, n.status, n.reason, n.author_id
       FROM notes n JOIN players p ON p.id = n.author_id
       WHERE n.world_id = $1 AND (n.status = 'approved' OR n.author_id = $2) ORDER BY n.created_at`, [p.world_id, p.id]);
    json(ctx.res, 200, { notes: r.rows.map(n => ({ id: n.id, text: n.text, author_name: n.author_name, status: n.status, reason: n.reason })) });
  }

  private async pinNote(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireConfirmed(p);
    const requestKey = header(ctx.req, "request-key");
    const body = await readJson(ctx.req, JSON_LIMIT);
    const text = str(body.text);
    if (requestKey) {
      const prior = await this.db.query<{ body: string; status: number; answer: string }>(
        "SELECT body, status, answer FROM request_keys WHERE player_id = $1 AND request_key = $2", [p.id, requestKey]);
      if (prior.rows.length > 0) {
        if (prior.rows[0].body !== JSON.stringify({ text })) throw new ApiError("request_key_reused");
        ctx.res.writeHead(prior.rows[0].status, { "Content-Type": "application/json" });
        ctx.res.end(prior.rows[0].answer);
        return;
      }
    }
    if (isBlank(text)) throw new ApiError("note_empty");
    if (text.length > 140) throw new ApiError("note_too_long");
    const id = newId("note");
    await this.db.query("INSERT INTO notes (id, world_id, author_id, text, status) VALUES ($1,$2,$3,$4,'pending')", [id, p.world_id, p.id, text]);
    const answer = JSON.stringify({ note: { id, text, status: "pending" } });
    if (requestKey) {
      await this.db.query("INSERT INTO request_keys (player_id, request_key, route, body, status, answer) VALUES ($1,$2,'notes',$3,201,$4)",
        [p.id, requestKey, JSON.stringify({ text }), answer]);
    }
    json(ctx.res, 201, { note: { id, text, status: "pending" } });
  }

  private async rangerNotes(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireRanger(p);
    const r = await this.db.query<{ id: string; text: string; author_name: string; status: string }>(
      `SELECT n.id, n.text, p.name AS author_name, n.status FROM notes n JOIN players p ON p.id = n.author_id
       WHERE n.world_id = $1 AND n.status = 'pending' ORDER BY n.created_at`, [p.world_id]);
    json(ctx.res, 200, { notes: r.rows.map(n => ({ id: n.id, text: n.text, author_name: n.author_name, status: n.status })) });
  }

  private async approveNote(ctx: Ctx, id: string): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireRanger(p);
    const row = await withTransaction(this.db, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`note:${id}`]);
      const r = await client.query<{ text: string; status: string; author_id: string; decided_by_name: string | null }>(
        "SELECT text, status, author_id, decided_by_name FROM notes WHERE id = $1 FOR UPDATE", [id]);
      const note = r.rows[0];
      if (!note) throw new ApiError("not_found");
      if (note.status !== "pending") {
        throw new ApiError("note_decided", { approved: note.status === "approved" ? "approved" : "declined", ["ranger name"]: note.decided_by_name ?? "" });
      }
      await client.query("UPDATE notes SET status = 'approved', decided_by_name = $2 WHERE id = $1", [id, p.name]);
      return note;
    });
    publishLive({ world: p.world_id, kind: "note", payload: { id, text: row.text, status: "approved", author_id: row.author_id, ranger: p.name } });
    json(ctx.res, 200, { note: { id, status: "approved", decided_by: p.name } });
  }

  private async declineNote(ctx: Ctx, id: string): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireRanger(p);
    const body = await readJson(ctx.req, JSON_LIMIT);
    const reason = str(body.reason);
    if (!["Not about the islands", "Unkind", "Shares personal details"].includes(reason)) throw new ApiError("bad_reason");
    const row = await withTransaction(this.db, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`note:${id}`]);
      const r = await client.query<{ text: string; status: string; author_id: string; decided_by_name: string | null }>(
        "SELECT text, status, author_id, decided_by_name FROM notes WHERE id = $1 FOR UPDATE", [id]);
      const note = r.rows[0];
      if (!note) throw new ApiError("not_found");
      if (note.status !== "pending") {
        throw new ApiError("note_decided", { approved: note.status === "approved" ? "approved" : "declined", ["ranger name"]: note.decided_by_name ?? "" });
      }
      await client.query("UPDATE notes SET status = 'declined', reason = $2, decided_by_name = $3 WHERE id = $1", [id, reason, p.name]);
      return note;
    });
    publishLive({ world: p.world_id, kind: "note", payload: { id, text: row.text, status: "declined", reason, author_id: row.author_id, ranger: p.name } });
    json(ctx.res, 200, { note: { id, status: "declined", decided_by: p.name, reason } });
  }

  private async removeNote(ctx: Ctx, id: string): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireRanger(p);
    const r = await this.db.query<{ status: string }>("SELECT status FROM notes WHERE id = $1", [id]);
    const note = r.rows[0];
    if (!note) throw new ApiError("not_found");
    if (note.status !== "approved") throw new ApiError("note_not_approved");
    await this.db.query("DELETE FROM notes WHERE id = $1", [id]);
    publishLive({ world: p.world_id, kind: "note", payload: { id, status: "removed" } });
    ctx.res.writeHead(204); ctx.res.end();
  }

  // ---------------- postcards ----------------

  private async postPostcard(ctx: Ctx): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireConfirmed(p);
    const requestKey = header(ctx.req, "request-key");
    const body = await readJson(ctx.req, JSON_LIMIT);
    const photoId = str(body.photo);
    const recipient = str(body.recipient).trim();
    const line = str(body.line);
    const keyBody = JSON.stringify({ photo: photoId, recipient, line });
    if (requestKey) {
      const prior = await this.db.query<{ body: string; status: number; answer: string }>(
        "SELECT body, status, answer FROM request_keys WHERE player_id = $1 AND request_key = $2", [p.id, requestKey]);
      if (prior.rows.length > 0) {
        if (prior.rows[0].body !== keyBody) throw new ApiError("request_key_reused");
        ctx.res.writeHead(prior.rows[0].status, { "Content-Type": "application/json" });
        ctx.res.end(prior.rows[0].answer);
        return;
      }
    }
    const photo = await this.db.query<{ player_id: string; creature_id: string; island: number; tick: string; total: number; content_type: ImageType }>(
      "SELECT player_id, creature_id, island, tick, total, content_type FROM photos WHERE id = $1", [photoId]);
    const photoRow = photo.rows[0];
    if (!photoRow || photoRow.player_id !== p.id) throw new ApiError("not_found");
    if (!isValidEmail(recipient)) throw new ApiError("bad_email");
    if (isBlank(line)) throw new ApiError("line_empty");
    if (line.length > 140) throw new ApiError("line_too_long");

    // Rate limit: at most POSTCARD_LIMIT postcards in the rolling window; exactly the limit allowed.
    const windowStart = new Date(Date.now() - this.config.postcardWindowSeconds * 1000);
    const recent = await this.db.query<{ n: string; oldest: Date | null }>(
      "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM postcards WHERE sender_id = $1 AND created_at >= $2",
      [p.id, windowStart]);
    const count = Number(recent.rows[0].n);
    if (count >= this.config.postcardLimit) {
      const oldest = recent.rows[0].oldest;
      const retryAfter = Math.max(1, Math.ceil((oldest!.getTime() + this.config.postcardWindowSeconds * 1000 - Date.now()) / 1000));
      throw new ApiError("postcard_limit", { limit: this.config.postcardLimit }, { "Retry-After": String(retryAfter) });
    }

    // Read the stored image first: unreachable storage answers 503 with no message.
    const image = await this.storage.get(objectKeyFor(photoId, photoRow.content_type));
    if (!image) throw new ApiError("storage_unavailable_postcard");

    const id = newId("pc");
    const creature = creatureById(photoRow.creature_id)!;
    const island = islandById(photoRow.island)!;
    const link = `${this.config.appPublicUrl}/postcards/${id}`;
    const subject = `A postcard from ${p.name} on ${island.name}`;

    // It takes Posted only after Mailpit accepted the message.
    try {
      await this.mailer.send({
        to: recipient,
        subject,
        text: `${line}\n\n${creature.name}, ${photoRow.total} points\n\n${link}\n`,
        attachments: [{
          filename: `${photoRow.creature_id}.png`,
          content: image,
          contentType: photoRow.content_type
        }]
      });
    } catch {
      throw new ApiError("mail_unavailable_postcard");
    }

    await this.db.query(
      "INSERT INTO postcards (id, sender_id, photo_id, recipient, line, status) VALUES ($1,$2,$3,$4,$5,'posted')",
      [id, p.id, photoId, recipient, line]);
    const answer = JSON.stringify({ postcard: { id, url: `/postcards/${id}`, status: "posted" } });
    if (requestKey) {
      await this.db.query("INSERT INTO request_keys (player_id, request_key, route, body, status, answer) VALUES ($1,$2,'postcards',$3,201,$4)",
        [p.id, requestKey, keyBody, answer]);
    }
    json(ctx.res, 201, { postcard: { id, url: `/postcards/${id}`, status: "posted" } });
  }

  private async getPostcard(ctx: Ctx, id: string): Promise<void> {
    const r = await this.db.query<{ photo_id: string; line: string; sender_id: string }>(
      "SELECT photo_id, line, sender_id FROM postcards WHERE id = $1 AND status = 'posted'", [id]);
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found");
    const photo = await this.db.query<{ creature_id: string; island: number; total: number }>(
      "SELECT creature_id, island, total FROM photos WHERE id = $1", [row.photo_id]);
    const ph = photo.rows[0];
    const senderName = await this.playerName(row.sender_id);
    json(ctx.res, 200, {
      postcard: {
        id,
        image_url: `/api/photos/${row.photo_id}/image`,
        creature_name: creatureById(ph.creature_id)?.name ?? ph.creature_id,
        total: ph.total,
        island_name: islandById(ph.island)?.name ?? "",
        line: row.line,
        sender_name: senderName
      }
    });
  }

  // ---------------- boards ----------------

  private async getBoard(ctx: Ctx, islandStr: string): Promise<void> {
    const p = ctx.requirePlayer();
    const island = Number(islandStr);
    if (!Number.isInteger(island) || island < 1 || island > 5) throw new ApiError("not_found");
    const filter = (ctx.url.searchParams.get("player") ?? "").trim().toLowerCase();
    const r = await this.db.query<{
      id: string; player: string; handle: string; creature_id: string; total: number; tick: string;
      photo_id: string; created_at: Date; entry_id: string;
    }>(
      `SELECT p.id AS player, p.name AS player_name, p.handle, e.photo_id, ph.creature_id, ph.total, ph.tick, e.created_at, e.id AS entry_id
       FROM board_entries e JOIN players p ON p.id = e.player_id JOIN photos ph ON ph.id = e.photo_id
       WHERE e.world_id = $1 AND e.island = $2`, [p.world_id, island]);
    const all = r.rows.map(row => ({
      player: (row as unknown as { player_name: string }).player_name,
      handle: row.handle,
      creature: row.creature_id,
      creature_name: creatureById(row.creature_id)?.name ?? row.creature_id,
      total: row.total,
      tick: Number(row.tick),
      photo: row.photo_id,
      created: (row as unknown as { created_at: Date }).created_at.getTime()
    }));
    all.sort((a, b) => b.total - a.total || a.tick - b.tick || a.created - b.created);
    const ranked = all.map((e, i) => ({ ...e, rank: i + 1 }));
    const shown = filter ? ranked.filter(e => e.player.toLowerCase().includes(filter)) : ranked;
    json(ctx.res, 200, {
      entries: shown.map(e => ({ rank: e.rank, player: e.player, handle: e.handle, creature: e.creature, creature_name: e.creature_name, total: e.total, tick: e.tick, photo: e.photo })),
      total: ranked.length,
      shown: shown.length
    });
  }

  private async enterBoard(ctx: Ctx, islandStr: string): Promise<void> {
    const p = ctx.requirePlayer();
    players.requireConfirmed(p);
    const island = Number(islandStr);
    if (!Number.isInteger(island) || island < 1 || island > 5) throw new ApiError("not_found");
    const body = await readJson(ctx.req, JSON_LIMIT);
    const photoId = str(body.photo);
    const photo = await this.db.query<{ player_id: string; island: number; creature_id: string; total: number; tick: string }>(
      "SELECT player_id, island, creature_id, total, tick FROM photos WHERE id = $1", [photoId]);
    const row = photo.rows[0];
    if (!row || row.player_id !== p.id) throw new ApiError("not_found");
    if (row.island !== island) throw new ApiError("wrong_island");
    const existing = await this.db.query<{ photo_id: string }>(
      "SELECT photo_id FROM board_entries WHERE world_id = $1 AND island = $2 AND player_id = $3", [p.world_id, island, p.id]);
    let status = 201;
    if (existing.rows.length > 0) {
      const currentPhoto = await this.db.query<{ total: number }>("SELECT total FROM photos WHERE id = $1", [existing.rows[0].photo_id]);
      const currentTotal = currentPhoto.rows[0].total;
      if (row.total > currentTotal) {
        await this.db.query("UPDATE board_entries SET photo_id = $1, created_at = now() WHERE world_id = $2 AND island = $3 AND player_id = $4", [photoId, p.world_id, island, p.id]);
      } else {
        status = 200;
      }
    } else {
      await this.db.query("INSERT INTO board_entries (world_id, island, player_id, photo_id) VALUES ($1,$2,$3,$4)", [p.world_id, island, p.id, photoId]);
    }
    const entry = await this.entryOf(p.world_id, island, p.id);
    publishLive({ world: p.world_id, kind: "board", payload: { island, player: p.name, total: entry?.total ?? row.total } });
    json(ctx.res, status, { entry });
  }

  private async entryOf(worldId: string, island: number, playerId: string): Promise<{ rank: number; player: string; handle: string; creature: string; creature_name: string; total: number; tick: number; photo: string } | null> {
    const r = await this.db.query<{ player_id: string; player_name: string; handle: string; creature_id: string; total: number; tick: string; photo_id: string; created_at: Date }>(
      `SELECT e.player_id, p.name AS player_name, p.handle, ph.creature_id, ph.total, ph.tick, e.photo_id, e.created_at
       FROM board_entries e JOIN players p ON p.id = e.player_id JOIN photos ph ON ph.id = e.photo_id
       WHERE e.world_id = $1 AND e.island = $2
       ORDER BY ph.total DESC, ph.tick ASC, e.created_at ASC`, [worldId, island]);
    const rows = r.rows;
    const idx = rows.findIndex(x => x.player_id === playerId);
    if (idx === -1) return null;
    const row = rows[idx];
    return {
      rank: idx + 1,
      player: row.player_name,
      handle: row.handle,
      creature: row.creature_id,
      creature_name: creatureById(row.creature_id)?.name ?? row.creature_id,
      total: row.total,
      tick: Number(row.tick),
      photo: row.photo_id
    };
  }

  // ---------------- grading ----------------

  private async gradingWorld(ctx: Ctx): Promise<void> {
    const body = await readJson(ctx.req, JSON_LIMIT);
    const tick = body.tick === undefined ? 6000 : num(body.tick);
    if (!Number.isInteger(tick) || tick < 0) throw new ApiError("bad_request");
    const made = await createGradingWorld(this, tick);
    json(ctx.res, 201, made);
  }

  private async gradingClock(ctx: Ctx): Promise<void> {
    const body = await readJson(ctx.req, JSON_LIMIT);
    const worldId = str(body.world);
    const tick = num(body.tick);
    if (!Number.isInteger(tick) || tick < 0) throw new ApiError("bad_request");
    const r = await this.db.query("SELECT 1 FROM worlds WHERE id = $1", [worldId]);
    if (r.rows.length === 0) throw new ApiError("not_found");
    await this.clock.setTick(worldId, tick);
    publishLive({ world: worldId, kind: "clock", payload: { tick } });
    json(ctx.res, 200, { world: worldId, tick });
  }

  private async mainWorldId(): Promise<string> {
    const r = await this.db.query<{ id: string }>("SELECT id FROM worlds WHERE kind = 'main' LIMIT 1");
    return r.rows[0].id;
  }
}

// ---------------- helpers ----------------

export class Ctx {
  constructor(
    readonly app: App,
    readonly req: http.IncomingMessage,
    readonly res: http.ServerResponse,
    readonly url: URL,
    readonly player: players.PlayerRow | null,
    readonly token: string | null
  ) {}

  requirePlayer(): players.PlayerRow {
    if (!this.player) throw new ApiError("not_signed_in");
    return this.player;
  }
}

function safariBody(row: { code: string; status: string; host_id: string; guest_id: string | null }, hostName?: string): { code: string; status: string; host: string; guest: string | null } {
  return {
    code: row.code,
    status: row.status,
    host: hostName ?? row.host_id,
    guest: row.guest_id
  };
}

function sessionToken(req: http.IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "hushfoot_session") return v.join("=");
  }
  return null;
}

function setCookie(res: http.ServerResponse, token: string): void {
  res.setHeader("Set-Cookie", `hushfoot_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function header(req: http.IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function startServer(): App {
  const app = new App();
  void app.start();
  const server = http.createServer((req, res) => {
    void app.handle(req, res);
  });
  server.listen(app.config.appPublicPort, "0.0.0.0");
  return app;
}

const mainEntry = require.main;
if (mainEntry && (mainEntry.filename === process.argv[1] || mainEntry.filename === __filename)) {
  startServer();
}
