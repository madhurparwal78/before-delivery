import { recordActivity } from "./activity.ts";
import { CAN_EDIT, isUuid, requireMember, requireRole } from "./access.ts";
import type { Membership } from "./access.ts";
import type { Collab } from "./collab.ts";
import { CollabOffline } from "./collab.ts";
import type { Database } from "./db.ts";
import { rows } from "./db.ts";
import { ApiError, collabOffline, forbidden, notFound, validation, writeJson } from "./errors.ts";
import type { EventHub } from "./events.ts";
import type { RequestContext, Router } from "./http.ts";
import { parsedJson, requireUser } from "./http.ts";
import { colourFor, leaseExpiry, LOCK_LEASE_SECONDS } from "../shared/collab.ts";
import { nullable, object, str } from "../shared/schema.ts";
import type { LockEvent, Person, PresenceMember } from "../shared/types.ts";

interface PersonRow { user_id: string; display_name: string }

interface LockGrant {
  layer_id: string;
  holder: Person;
  expires_at: string;
  server_time: string;
  ttl_seconds: number;
}

export class Locks {
  private readonly db: Database;
  private readonly collab: Collab;
  private readonly hub: EventHub;
  private readonly watchers = new Map<string, NodeJS.Timeout>();

  constructor(db: Database, collab: Collab, hub: EventHub) {
    this.db = db;
    this.collab = collab;
    this.hub = hub;
  }

  private async personOf(userId: string): Promise<Person> {
    const [person] = await rows<PersonRow>(this.db, "SELECT id AS user_id, display_name FROM users WHERE id = $1", [userId]);
    return person ?? { user_id: userId, display_name: "Someone" };
  }

  private async requireLayer(setId: string, layerId: string): Promise<void> {
    const found = isUuid(layerId)
      ? await rows(this.db, "SELECT 1 FROM layers WHERE id = $1 AND set_id = $2", [layerId, setId])
      : [];
    if (found.length === 0) throw notFound();
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CollabOffline) throw collabOffline();
      throw error;
    }
  }

  private async announce(setId: string, event: LockEvent): Promise<void> {
    await this.hub.publish(setId, { kind: "lock", data: event });
  }

  private watchExpiry(setId: string, layerId: string, leaseMs: number): void {
    const key = `${setId}:${layerId}`;
    clearTimeout(this.watchers.get(key));
    const timer = setTimeout(async () => {
      this.watchers.delete(key);
      try {
        const state = await this.collab.lockState(setId, layerId);
        if (state) this.watchExpiry(setId, layerId, state.leaseMs);
        else await this.announce(setId, { layer_id: layerId, holder: null, expires_at: null, reason: "expired" });
      } catch (error) {
        if (!(error instanceof CollabOffline)) throw error;
      }
    }, leaseMs + 150);
    timer.unref();
    this.watchers.set(key, timer);
  }

  private clearWatch(setId: string, layerId: string): void {
    clearTimeout(this.watchers.get(`${setId}:${layerId}`));
    this.watchers.delete(`${setId}:${layerId}`);
  }

  private async presenceOf(setId: string): Promise<PresenceMember[]> {
    const members = await rows<PersonRow>(this.db, 
      "SELECT u.id AS user_id, u.display_name FROM members m JOIN users u ON u.id = m.user_id WHERE m.set_id = $1 ORDER BY m.joined_at, u.id",
      [setId],
    );
    const stored = await this.collab.readPresence(setId, members.map((member) => member.user_id));
    const present: PresenceMember[] = [];
    members.forEach((member, index) => {
      const raw = stored[index];
      if (!raw) return;
      const value: { colour?: string; selection?: string | null } = JSON.parse(raw);
      present.push({
        user_id: member.user_id, display_name: member.display_name, colour: value.colour ?? colourFor(index), selection: value.selection ?? null,
      });
    });
    return present;
  }

  private async lockBody(layerId: string, holderId: string, leaseMs: number): Promise<LockGrant> {
    const now = Date.now();
    return {
      layer_id: layerId, holder: await this.personOf(holderId), expires_at: leaseExpiry(leaseMs, now),
      server_time: new Date(now).toISOString(), ttl_seconds: LOCK_LEASE_SECONDS,
    };
  }

  private async editor(ctx: RequestContext): Promise<Membership> {
    const membership = await requireMember(this.db, ctx);
    requireRole(membership, CAN_EDIT);
    return membership;
  }

  register(router: Router): void {
    router.add("POST", "/api/sets/:id/layers/:layerId/lock", {}, async (ctx) => {
      const membership = await this.editor(ctx);
      const layerId = ctx.params["layerId"] ?? "";
      await this.requireLayer(membership.setId, layerId);
      const outcome = await this.guarded(() => this.collab.acquireLock(membership.setId, layerId, membership.userId));
      const body = await this.lockBody(layerId, outcome.holderId, outcome.leaseMs);
      if (outcome.outcome === "held") {
        throw new ApiError(409, "lock_held", `Locked by ${body.holder.display_name}`, { holder: body.holder, expires_at: body.expires_at });
      }
      this.watchExpiry(membership.setId, layerId, outcome.leaseMs);
      await this.announce(membership.setId, { layer_id: layerId, holder: body.holder, expires_at: body.expires_at, reason: outcome.outcome });
      writeJson(ctx.res, outcome.outcome === "granted" ? 201 : 200, body);
    });

    router.add("POST", "/api/sets/:id/layers/:layerId/lock/heartbeat", {}, async (ctx) => {
      const membership = await this.editor(ctx);
      const layerId = ctx.params["layerId"] ?? "";
      await this.requireLayer(membership.setId, layerId);
      const { renewed, leaseMs } = await this.guarded(() => this.collab.renewLock(membership.setId, layerId, membership.userId));
      if (!renewed) throw new ApiError(409, "lock_not_held", "You do not hold this lock");
      const body = await this.lockBody(layerId, membership.userId, leaseMs);
      this.watchExpiry(membership.setId, layerId, leaseMs);
      await this.announce(membership.setId, { layer_id: layerId, holder: body.holder, expires_at: body.expires_at, reason: "renewed" });
      writeJson(ctx.res, 200, { layer_id: layerId, expires_at: body.expires_at, server_time: body.server_time });
    });

    router.add("DELETE", "/api/sets/:id/layers/:layerId/lock", {}, async (ctx) => {
      const membership = await this.editor(ctx);
      const layerId = ctx.params["layerId"] ?? "";
      await this.requireLayer(membership.setId, layerId);
      const released = await this.guarded(() => this.collab.releaseLock(membership.setId, layerId, membership.userId, membership.role === "owner"));
      if (released.result === "free") throw new ApiError(409, "lock_not_held", "This layer is not locked");
      if (released.result === "denied") throw forbidden();
      this.clearWatch(membership.setId, layerId);
      if (released.holderId && released.holderId !== membership.userId) {
        const previous = await this.personOf(released.holderId);
        await recordActivity(this.db, membership.setId, requireUser(ctx).id, "lock.force_release", layerId, `Released the lock held by ${previous.display_name}`);
      }
      await this.announce(membership.setId, { layer_id: layerId, holder: null, expires_at: null, reason: "released" });
      ctx.res.writeHead(204);
      ctx.res.end();
    });

    router.add("GET", "/api/sets/:id/locks", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const held = await this.guarded(() => this.collab.locksOfSet(membership.setId));
      const now = Date.now();
      const locks = await Promise.all(held.map(async (lock) => ({
        layer_id: lock.layerId, holder: await this.personOf(lock.holderId), expires_at: leaseExpiry(lock.leaseMs, now),
      })));
      writeJson(ctx.res, 200, { server_time: new Date(now).toISOString(), locks });
    });

    router.add("POST", "/api/sets/:id/presence", { body: "json" }, async (ctx) => {
      const membership = await this.editor(ctx);
      const body = parsedJson(ctx, object({ selection: nullable(str({ min: 1, max: 64, message: "Selection must be a layer id or null" })) }));
      if (body.selection !== null) {
        const found = isUuid(body.selection)
          ? await rows(this.db, "SELECT 1 FROM layers WHERE id = $1 AND set_id = $2", [body.selection, membership.setId])
          : [];
        if (found.length === 0) throw validation({ selection: "Selection must be a layer in this set" });
      }
      const members = await rows<PersonRow>(this.db, "SELECT user_id FROM members WHERE set_id = $1 ORDER BY joined_at, user_id", [membership.setId]);
      const index = Math.max(0, members.findIndex((member) => member.user_id === membership.userId));
      const person = await this.personOf(membership.userId);
      const present = await this.guarded(async () => {
        await this.collab.writePresence(membership.setId, membership.userId, {
          display_name: person.display_name, colour: colourFor(index), selection: body.selection,
        });
        return this.presenceOf(membership.setId);
      });
      await this.hub.publish(membership.setId, { kind: "presence", data: { members: present } });
      writeJson(ctx.res, 200, { members: present });
    });

    router.add("GET", "/api/sets/:id/presence", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      writeJson(ctx.res, 200, { members: await this.guarded(() => this.presenceOf(membership.setId)) });
    });
  }
}
