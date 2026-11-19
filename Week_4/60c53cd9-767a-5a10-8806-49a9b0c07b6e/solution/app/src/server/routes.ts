/** The API route table. Each handler owns only its own steps of the error order (rate limits, 404, validation, conflicts). */
import { parseUnitCode } from "../shared/domain.js";
import { toPublicAccount, type Accounts } from "./accounts.js";
import type { AppClock } from "./clock.js";
import type { Config } from "./config.js";
import type { ConsoleActions } from "./console.js";
import type { Database } from "./db.js";
import { ApiError } from "./errors.js";
import type { Holds } from "./holds.js";
import type { Route } from "./http.js";
import { kindFromSignature, scalePng, type ImageKind } from "./images.js";
import type { Indexer } from "./indexer.js";
import { lapseAndNotify } from "./transitions.js";
import type { MediaSigner } from "./media.js";
import type { Search } from "./search.js";
import { StorageUnavailable, type ObjectStore } from "./s3.js";
import { UNIT_SELECT, isVisible, toPublicUnit, toTowerCell, type UnitRow } from "./units.js";

export interface Services {
  readonly config: Config;
  readonly clock: AppClock;
  readonly db: Database;
  readonly store: ObjectStore;
  readonly media: MediaSigner;
  readonly indexer: Indexer;
  readonly accounts: Accounts;
  readonly holds: Holds;
  readonly search: Search;
  readonly console: ConsoleActions;
}

/** Smaller renditions of stored photographs for `srcset`, kept per object version; the stored bytes are never changed. */
const RENDITIONS = new Map<string, Buffer | null>();
const smaller = (etag: string, body: Buffer, width: number): Buffer | null => {
  const key = `${etag}:${width}`;
  if (RENDITIONS.has(key)) return RENDITIONS.get(key) ?? null;
  let copy: Buffer | null = null;
  try {
    copy = scalePng(body, width);
  } catch {
    copy = null;
  }
  if (RENDITIONS.size >= 256) RENDITIONS.delete(RENDITIONS.keys().next().value as string);
  RENDITIONS.set(key, copy);
  return copy;
};

const TOWER_ASSETS = {
  shell: "models/tower-shell.glb",
  plates: {
    "03-09": "models/plates/03-09.glb",
    "10-19": "models/plates/10-19.glb",
    "20-29": "models/plates/20-29.glb",
    "30-35": "models/plates/30-35.glb",
    "36-38": "models/plates/36-38.glb",
  },
  facade: "textures/facade.png",
  ramp: "textures/duotone-ramp.png",
} as const;

/** A session cookie: how long a session lasts is decided by the server on the app clock, never by the browser's. */
const sessionCookie = (token: string): string => `hw_session=${token}; HttpOnly; SameSite=Lax; Path=/`;

const CLEARED_COOKIE = "hw_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";

export const buildRoutes = (s: Services): Route[] => {
  const freshLapse = (): Promise<string[]> => lapseAndNotify(s.db, s.clock, s.indexer);
  const notFound = (): never => {
    throw new ApiError("not_found");
  };

  return [
    {
      method: "GET",
      pattern: /^\/api\/health$/,
      auth: "none",
      body: "none",
      handler: async () => (s.db.ready ? { status: 200, body: { status: "ok" } } : { status: 503, body: { status: "starting" } }),
    },
    {
      method: "GET",
      pattern: /^\/api\/tower$/,
      auth: "none",
      body: "none",
      handler: async () => {
        await freshLapse();
        const rows = await s.db.query<UnitRow>(`${UNIT_SELECT} ORDER BY u.floor, u.stack`);
        const link = (key: string): string => s.media.link(key, null);
        return {
          status: 200,
          body: {
            units: rows.rows.map(toTowerCell),
            assets: {
              shell: link(TOWER_ASSETS.shell),
              plates: Object.fromEntries(Object.entries(TOWER_ASSETS.plates).map(([band, key]) => [band, link(key)])),
              facade: link(TOWER_ASSETS.facade),
              ramp: link(TOWER_ASSETS.ramp),
            },
          },
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/search$/,
      auth: "optional",
      body: "none",
      handler: async (ctx) => {
        if (ctx.account === null) await s.search.limitAnonymous(ctx.clientAddress);
        return { status: 200, body: await s.search.run(ctx.url.searchParams) };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/units\/([^/]+)$/,
      auth: "none",
      body: "none",
      handler: async (ctx) => {
        const identity = parseUnitCode(decodeURIComponent(ctx.params[0] ?? ""));
        if (identity === null) return notFound();
        await freshLapse();
        const row = (await s.db.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [identity.code])).rows[0];
        if (!row || !isVisible(row)) return notFound();
        return { status: 200, body: { unit: toPublicUnit(row, s.media) } };
      },
    },
    {
      method: "GET",
      pattern: /^\/media\/([^/]+)$/,
      auth: "none",
      body: "none",
      handler: async (ctx) => {
        const claim = s.media.verify(ctx.params[0] ?? "");
        if (claim === null) return notFound();
        if (claim.u !== null) {
          const unit = (await s.db.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [claim.u])).rows[0];
          if (!unit || unit.withdrawn) return notFound();
        }
        try {
          const object = await s.store.get(claim.k);
          if (object === null) return notFound();
          const kind = kindFromSignature(object.body);
          const type = claim.k.endsWith(".glb") ? "model/gltf-binary" : kind === "jpg" ? "image/jpeg" : "image/png";
          const wanted = Number(ctx.url.searchParams.get("w"));
          const copy = kind === "png" && Number.isInteger(wanted) && wanted >= 64 && wanted <= 4096 ? smaller(object.etag, object.body, wanted) : null;
          return {
            status: 200,
            raw: copy ?? object.body,
            headers: {
              "content-type": type,
              etag: copy === null ? `"${object.etag}"` : `"${object.etag}-w${wanted}"`,
              "cache-control": "private, max-age=30",
            },
          };
        } catch (error) {
          if (error instanceof StorageUnavailable) throw new ApiError("media_unavailable");
          throw error;
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/accounts$/,
      auth: "none",
      body: "json",
      handler: async (ctx) => ({ status: 202, body: await s.accounts.create(ctx.json?.value ?? {}) }),
    },
    {
      method: "POST",
      pattern: /^\/api\/session$/,
      auth: "none",
      body: "json",
      handler: async (ctx) => {
        const { account, token } = await s.accounts.signIn(ctx.json?.value ?? {});
        return {
          status: 200,
          body: { account: toPublicAccount(account) },
          headers: { "set-cookie": sessionCookie(token) },
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/session$/,
      auth: "signedIn",
      body: "none",
      handler: async (ctx) => ({ status: 200, body: { account: toPublicAccount(ctx.account as NonNullable<typeof ctx.account>) } }),
    },
    {
      method: "DELETE",
      pattern: /^\/api\/session$/,
      auth: "none",
      body: "none",
      handler: async (ctx) => {
        await s.accounts.signOut(ctx.sessionToken);
        return { status: 204, headers: { "set-cookie": CLEARED_COOKIE } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/holds$/,
      auth: "buyer",
      body: "none",
      handler: async (ctx) => ({ status: 200, body: { holds: await s.holds.list(ctx.account as NonNullable<typeof ctx.account>) } }),
    },
    {
      method: "POST",
      pattern: /^\/api\/holds$/,
      auth: "signedIn",
      body: "json",
      handler: async (ctx) => {
        const key = ctx.req.headers["idempotency-key"];
        const reply = await s.holds.place(ctx.account as NonNullable<typeof ctx.account>, Array.isArray(key) ? key[0] : key, ctx.json);
        return {
          status: reply.status,
          body: reply.body,
          ...(reply.retryAfterSeconds === undefined ? {} : { headers: { "retry-after": String(reply.retryAfterSeconds) } }),
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/holds\/([^/]+)$/,
      auth: "buyer",
      body: "none",
      handler: async (ctx) => ({
        status: 200,
        body: { hold: await s.holds.get(ctx.account as NonNullable<typeof ctx.account>, ctx.params[0] ?? "") },
      }),
    },
    {
      method: "POST",
      pattern: /^\/api\/holds\/([^/]+)\/release$/,
      auth: "buyer",
      body: "json",
      handler: async (ctx) => ({
        status: 200,
        body: { hold: await s.holds.release(ctx.account as NonNullable<typeof ctx.account>, ctx.params[0] ?? "") },
      }),
    },
    {
      method: "POST",
      pattern: /^\/api\/holds\/([^/]+)\/share$/,
      auth: "buyer",
      body: "json",
      handler: async (ctx) => ({
        status: 201,
        body: await s.holds.share(ctx.account as NonNullable<typeof ctx.account>, ctx.params[0] ?? ""),
      }),
    },
    {
      method: "DELETE",
      pattern: /^\/api\/holds\/([^/]+)\/share$/,
      auth: "buyer",
      body: "json",
      handler: async (ctx) => {
        await s.holds.unshare(ctx.account as NonNullable<typeof ctx.account>, ctx.params[0] ?? "");
        return { status: 204 };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/shared\/([^/]+)$/,
      auth: "none",
      body: "none",
      handler: async (ctx) => {
        const shared = await s.holds.shared(ctx.params[0] ?? "");
        if (shared === null) return notFound();
        return { status: 200, body: shared };
      },
    },
    ...(["POST", "PUT", "PATCH", "DELETE"] as const).map(
      (method): Route => ({
        method,
        pattern: /^\/api\/shared\/([^/]+)$/,
        auth: "none",
        body: "json",
        handler: async () => {
          throw new ApiError("read_only");
        },
      }),
    ),
    {
      method: "GET",
      pattern: /^\/api\/console\/units$/,
      auth: "coordinator",
      body: "none",
      handler: async () => ({ status: 200, body: { units: await s.console.units() } }),
    },
    {
      method: "GET",
      pattern: /^\/api\/console\/units\/([^/]+)\/prices$/,
      auth: "coordinator",
      body: "none",
      handler: async (ctx) => ({ status: 200, body: { versions: await s.console.priceVersions(decodeURIComponent(ctx.params[0] ?? "")) } }),
    },
    {
      method: "GET",
      pattern: /^\/api\/console\/holds$/,
      auth: "coordinator",
      body: "none",
      handler: async () => ({ status: 200, body: { holds: await s.console.activeHolds() } }),
    },
    {
      method: "POST",
      pattern: /^\/api\/console\/bands\/([^/]+)\/release$/,
      auth: "coordinator",
      body: "json",
      handler: async (ctx) => ({ status: 200, body: await s.console.releaseBand(decodeURIComponent(ctx.params[0] ?? "")) }),
    },
    {
      method: "PUT",
      pattern: /^\/api\/console\/units\/([^/]+)\/price$/,
      auth: "coordinator",
      body: "json",
      handler: async (ctx) => ({
        status: 200,
        body: await s.console.savePrice(ctx.account as NonNullable<typeof ctx.account>, decodeURIComponent(ctx.params[0] ?? ""), ctx.json),
      }),
    },
    {
      method: "PUT",
      pattern: /^\/api\/console\/units\/([^/]+)\/view-photo$/,
      auth: "coordinator",
      body: "photo",
      handler: async (ctx) => {
        const kind = kindFromSignature(ctx.bytes) as ImageKind;
        return { status: 200, body: await s.console.uploadPhoto(decodeURIComponent(ctx.params[0] ?? ""), ctx.bytes, kind) };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/console\/units\/([^/]+)\/withdraw$/,
      auth: "coordinator",
      body: "json",
      handler: async (ctx) => ({ status: 200, body: await s.console.withdraw(decodeURIComponent(ctx.params[0] ?? "")) }),
    },
    {
      method: "POST",
      pattern: /^\/api\/console\/holds\/([^/]+)\/convert$/,
      auth: "coordinator",
      body: "json",
      handler: async (ctx) => ({ status: 200, body: { hold: await s.console.convert(ctx.params[0] ?? "") } }),
    },
  ];
};
