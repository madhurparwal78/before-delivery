import { randomUUID } from "node:crypto";
import { requireFounder, signedIn } from "../auth.js";
import { Check, EMAIL } from "../body.js";
import { one, pool, rows } from "../db.js";
import { conflict } from "../errors.js";
import { json, type Ctx, type Route } from "../http.js";
import { invite, venueGroup } from "../identity.js";
import * as keycloak from "../keycloak.js";
import * as killbill from "../killbill.js";
import * as mail from "../mail.js";
import * as s3 from "../s3.js";
import * as svix from "../svix.js";
import * as valkey from "../valkey.js";
import { iso, type VenueRow } from "../views.js";

/** Fees for a venue the founder onboards (the brief sets none; the owner changes them). */
const NEW_VENUE_FEES = { taker: 100, maker: 0 };

async function listVenues(ctx: Ctx) {
  requireFounder(signedIn(ctx));
  const venues = await rows<VenueRow & { member_count: number }>(
    pool,
    "SELECT v.*, (SELECT count(*)::int FROM members m WHERE m.venue_id = v.id) AS member_count FROM venues v ORDER BY v.created_at",
  );
  return json(200, {
    venues: venues.map((v) => ({ id: v.id, slug: v.slug, name: v.name, time_zone: v.time_zone, member_count: v.member_count, created_at: iso(v.created_at) })),
  });
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

async function onboardVenue(ctx: Ctx) {
  requireFounder(signedIn(ctx));
  const check = new Check(ctx.body, ["slug", "name", "time_zone", "owner_email"]);
  const slug = check.text("slug", 3, 20, false);
  if (!/^[a-z0-9-]{3,20}$/.test(slug)) check.fail("slug", "invalid");
  const name = check.text("name", 1, 60);
  const timeZone = check.text("time_zone", 1, 64, false);
  if (!validZone(timeZone)) check.fail("time_zone", "invalid");
  const ownerEmail = check.text("owner_email", 3, 254);
  if (!EMAIL.test(ownerEmail)) check.fail("owner_email", "invalid");
  if (check.ok && (await one(pool, "SELECT 1 FROM venues WHERE slug = $1", [slug]))) throw conflict("slug_taken");
  check.done();
  await keycloak.ensureGroup(venueGroup(slug));
  const venue = await one<VenueRow>(
    pool,
    "INSERT INTO venues (id, slug, name, time_zone, taker_fee_bps, maker_fee_bps) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING RETURNING *",
    [randomUUID(), slug, name, timeZone, NEW_VENUE_FEES.taker, NEW_VENUE_FEES.maker],
  );
  if (!venue) throw conflict("slug_taken");
  const ownerName = ownerEmail.split("@")[0] ?? ownerEmail;
  await invite(venue, { email: ownerEmail, displayName: ownerName, roles: ["org_owner"] });
  return json(201, { id: venue.id, slug: venue.slug, name: venue.name, time_zone: venue.time_zone, member_count: 1, created_at: iso(venue.created_at) });
}

async function health(ctx: Ctx) {
  requireFounder(signedIn(ctx));
  const postgres = async () => {
    try {
      await Promise.race([pool.query("SELECT 1"), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000))]);
      return true;
    } catch {
      return false;
    }
  };
  const checks = { keycloak: keycloak.reachable, killbill: killbill.reachable, postgres, valkey: valkey.reachable, svix: svix.reachable, minio: s3.reachable, mailpit: mail.reachable };
  const results = await Promise.all(Object.entries(checks).map(async ([name, check]) => [name, (await check()) ? "up" : "down"] as const));
  return json(200, { providers: Object.fromEntries(results), checked_at: new Date().toISOString() });
}

export const platformRoutes: Route[] = [
  { method: "GET", pattern: "/api/health", auth: "none", handler: async () => json(200, { status: "ok" }) },
  { method: "GET", pattern: "/api/platform/venues", auth: "session", handler: listVenues },
  { method: "POST", pattern: "/api/platform/venues", auth: "session", handler: onboardVenue, outage: "identity_unavailable" },
  { method: "GET", pattern: "/api/platform/health", auth: "session", handler: health },
];
