import type { Role } from "../shared/rules.js";
import { realmRoles, createSession, hash, randomToken } from "./auth.js";
import { config } from "./config.js";
import { one, pool, tx, type Db } from "./db.js";
import { conflict } from "./errors.js";
import * as keycloak from "./keycloak.js";
import { enqueueEmail } from "./outbox.js";
import type { VenueRow } from "./views.js";

export const venueGroup = (slug: string): string => `venue-${slug}`;

function splitName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/);
  return { firstName: parts[0] ?? displayName, lastName: parts.slice(1).join(" ") || "-" };
}

/**
 * Turns a Keycloak access token into a session. Realm roles come from the token; the venue comes
 * from the person's venue group, read through the admin API, never from the browser.
 */
export async function sessionFromToken(accessToken: string): Promise<{ sessionId: string; memberId: string }> {
  const claims = keycloak.claimsOf(accessToken);
  const roles = realmRoles(claims.realm_access?.roles);
  const groups = await keycloak.groupsOf(claims.sub);
  const slug = groups.find((name) => name.startsWith("venue-"))?.slice("venue-".length);
  const venue = slug ? await one<{ id: string }>(pool, "SELECT id FROM venues WHERE slug = $1", [slug]) : undefined;
  const venueId = venue?.id ?? null;
  await pool.query(
    `INSERT INTO members (id, venue_id, username, email, display_name, roles) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username`,
    [claims.sub, venueId, claims.preferred_username ?? claims.sub, claims.email ?? "", claims.name ?? claims.preferred_username ?? "Member", roles],
  );
  return { sessionId: await createSession(claims.sub, roles, venueId), memberId: claims.sub };
}

interface InviteRequest {
  email: string;
  displayName: string;
  roles: Role[];
}

/**
 * Creates the person in Keycloak in the venue with the chosen roles and UPDATE_PASSWORD, records the
 * member and a one-time invite link, and queues the invite email.
 */
export async function invite(venue: VenueRow, request: InviteRequest): Promise<{ memberId: string }> {
  const taken = await one(pool, "SELECT 1 FROM members WHERE venue_id = $1 AND lower(email) = lower($2)", [venue.id, request.email]);
  if (taken) throw conflict("already_member");
  const groupId = await keycloak.ensureGroup(venueGroup(venue.slug));
  const userId = await keycloak.createUser({
    username: request.email.toLowerCase(),
    email: request.email,
    ...splitName(request.displayName),
    requiredActions: ["UPDATE_PASSWORD"],
  });
  if (userId === null) throw conflict("already_member");
  await keycloak.grantRealmRoles(userId, request.roles);
  await keycloak.joinGroup(userId, groupId);
  const token = randomToken();
  await tx(async (client) => {
    await client.query("INSERT INTO members (id, venue_id, username, email, display_name, roles) VALUES ($1, $2, $3, $4, $5, $6)", [
      userId,
      venue.id,
      request.email.toLowerCase(),
      request.email,
      request.displayName,
      request.roles,
    ]);
    await client.query("INSERT INTO invites (token_hash, member_id, venue_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))", [
      hash(token),
      userId,
      venue.id,
      config.inviteTtlSeconds,
    ]);
    await enqueueEmail(client, venue.id, {
      to: request.email,
      subject: `You're invited to ${venue.name}`,
      text: `Hello ${request.displayName},\n\nYou have been invited to ${venue.name} on Plumtide Venue.\n\nChoose your password here:\n${config.publicUrl}/invites/${token}\n\nThis link can be used once.\n`,
    });
  });
  return { memberId: userId };
}

interface InviteRow {
  token_hash: string;
  member_id: string;
  email: string;
  venue_name: string;
  expired: boolean;
}

/** An unused invite by its token; expired invites are returned with `expired` set. */
export async function inviteByToken(db: Db, token: string): Promise<InviteRow | undefined> {
  return one<InviteRow>(
    db,
    `SELECT i.token_hash, i.member_id, m.email, v.name AS venue_name, i.expires_at <= now() AS expired
       FROM invites i JOIN members m ON m.id = i.member_id JOIN venues v ON v.id = i.venue_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL`,
    [hash(token)],
  );
}
