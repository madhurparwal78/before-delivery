import { randomUUID } from "node:crypto";
import { FIELD_MESSAGES } from "../../shared/catalogue";
import { deriveCounts, type CountedItem } from "../../shared/counts";
import type { Role, Trade } from "../../shared/domain";
import {
  IDENTITY,
  affineToJson,
  applyAffine,
  checkOutline,
  hasFourDecimals,
  isPlanFraction,
  outlinesOverlap,
  roomForPin,
  solveAffine,
  type Affine,
  type Outline,
  type RefPair,
} from "../../shared/geometry";
import { jobAccess, lockOpenJob, requireOpenJob, requireRole, type JobAccess, type JobRow } from "../access";
import { maybeOne, one, pool, rows, transaction, type Db, type Tx } from "../db";
import { fail, invalid } from "../errors";
import { emit, openStream, startEventLog } from "../events";
import { json, readForm, readJson, route, type Reply } from "../http";
import { cleanImage, uploadedBytes, type CleanImage } from "../images";
import { emitItems, recordChange } from "../items";
import { projectRooms } from "../projection";
import { loadRooms, scopedItemRows, type RoomRow } from "../records";
import { deleteObject, getObject, putObject } from "../storage";
import { jobView } from "../views";

const NAME_MAX = 120;
const ADDRESS_MAX = 200;
const ROOM_NAME_MAX = 60;

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

route("GET", "/api/jobs", async (call) => {
  const { person } = call.auth;
  const memberships = await rows<JobRow & { role: Role; trade: Trade | null; member_id: string }>(
    pool,
    `SELECT j.id, j.firm_id, j.name, j.address, j.time_zone, j.status, m.role, m.trade, m.id AS member_id
     FROM jobs j JOIN job_members m ON m.job_id = j.id AND m.person_id = $1 AND m.ended_at IS NULL
     WHERE j.firm_id = $2 ORDER BY j.created_at DESC, j.position DESC`,
    [person.id, person.firm_id],
  );
  const jobs = await Promise.all(
    memberships.map(({ role, trade, member_id, ...job }) => jobView(pool, { job, person, role, trade, memberId: member_id })),
  );
  return json(200, { jobs });
});

route("POST", "/api/jobs", async (call) => {
  const { person } = call.auth;
  if (!person.is_owner) fail("forbidden");
  const body = readJson(call);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const errors: Record<string, string> = {};
  if (name.length < 1 || name.length > NAME_MAX) errors.name = `Enter a job name of 1 to ${NAME_MAX} characters.`;
  if (address.length < 1 || address.length > ADDRESS_MAX) errors.address = `Enter an address of 1 to ${ADDRESS_MAX} characters.`;
  if (!validTimeZone(body.time_zone)) errors.time_zone = "Choose a time zone name from the list, such as America/Chicago.";
  if (Object.keys(errors).length > 0) invalid(errors);
  const id = randomUUID();
  await transaction(async (tx) => {
    await tx.query("INSERT INTO jobs (id, firm_id, name, address, time_zone) VALUES ($1, $2, $3, $4, $5)", [
      id,
      person.firm_id,
      name,
      address,
      body.time_zone,
    ]);
    await tx.query("INSERT INTO job_members (id, job_id, person_id, role) VALUES ($1, $2, $3, 'owner')", [randomUUID(), id, person.id]);
    await tx.query("INSERT INTO access_cards (job_id) VALUES ($1)", [id]);
    await startEventLog(tx, id);
  });
  return json(201, await jobView(pool, await jobAccess(pool, person, id)));
});

route("GET", "/api/jobs/:jobId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  return json(200, await jobView(pool, access));
});

/** Deletes every stored object of a job: each photo and plan revision, the object first and then its record. */
async function deleteJobObjects(tx: Tx, jobId: string): Promise<void> {
  const photos = await rows<{ id: string; object_key: string; item_id: string; trade: Trade | null }>(
    tx,
    "SELECT ph.id, ph.object_key, ph.item_id, i.trade FROM photos ph JOIN items i ON i.id = ph.item_id WHERE ph.job_id = $1",
    [jobId],
  );
  for (const photo of photos) {
    await deleteObject(photo.object_key);
    await tx.query("DELETE FROM photos WHERE id = $1", [photo.id]);
  }
  const plans = await rows<{ id: string; object_key: string }>(tx, "SELECT id, object_key FROM plan_revisions WHERE job_id = $1", [jobId]);
  for (const plan of plans) {
    await deleteObject(plan.object_key);
    await tx.query("DELETE FROM plan_revisions WHERE id = $1", [plan.id]);
  }
  await emitItems(tx, jobId, new Map(photos.map((photo) => [photo.item_id, photo.trade])));
  if (plans.length > 0) emit(tx, jobId, { type: "plan", revision: null, planUrl: null });
}

route("POST", "/api/jobs/:jobId/actions", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  const { action } = readJson(call);
  if (action !== "start_walkthrough" && action !== "close_out") {
    requireOpenJob(access);
    invalid({ action: "Choose start_walkthrough or close_out." });
  }
  // The job row stays locked while the stage moves (and, on close-out, while its objects go),
  // so no item, plan or photo can arrive meanwhile. A storage failure rolls the records back
  // with the job still in walkthrough; the objects already gone stay gone.
  await transaction(async (tx) => {
    const { status } = await one<{ status: string }>(tx, "SELECT status FROM jobs WHERE id = $1 FOR UPDATE", [access.job.id]);
    if (status === "closed_out") fail("job_closed");
    if (action === "start_walkthrough") {
      if (status !== "active") fail("invalid_transition");
      await tx.query("UPDATE jobs SET status = 'walkthrough' WHERE id = $1", [access.job.id]);
    } else {
      if (status !== "walkthrough") fail("invalid_transition");
      const items = await rows<CountedItem>(tx, "SELECT room_id, status FROM items WHERE job_id = $1", [access.job.id]);
      const { verified, total } = deriveCounts(items, []).progress;
      if (verified < total) fail("items_not_verified", { unverified: total - verified });
      await deleteJobObjects(tx, access.job.id);
      await tx.query("UPDATE jobs SET status = 'closed_out' WHERE id = $1", [access.job.id]);
    }
    emit(tx, access.job.id, { type: "job" });
  });
  return json(200, await jobView(pool, await jobAccess(pool, call.auth.person, access.job.id)));
});

// ---------- Plan and revisions ----------

interface RevisionRow {
  id: string;
  revision: number;
  object_key: string;
  content_type: string;
}

function currentRevision(db: Db, jobId: string): Promise<RevisionRow | null> {
  return maybeOne<RevisionRow>(
    db,
    "SELECT id, revision, object_key, content_type FROM plan_revisions WHERE job_id = $1 ORDER BY revision DESC LIMIT 1",
    [jobId],
  );
}

async function imageFrom(form: FormData): Promise<CleanImage> {
  const bytes = await uploadedBytes(form);
  if (!bytes) invalid({ file: "Choose a plan image to upload." });
  return cleanImage(bytes);
}

/**
 * Stores a new plan revision: the image is stored and confirmed first, then in one
 * transaction the revision, the new outlines and every pin mapped through the transform.
 */
async function storeRevision(
  access: JobAccess,
  image: CleanImage,
  transform: Affine,
  outlines: ReadonlyMap<string, Outline> | null,
): Promise<{ revision: number; moved: number; needsReview: number }> {
  const id = randomUUID();
  const key = `jobs/${access.job.id}/plan/${id}.${image.ext}`;
  await putObject(key, image.bytes, image.contentType);
  return transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id, "update");
    const previous = await currentRevision(tx, access.job.id);
    if (outlines && !previous) fail("invalid_transition");
    const revision = (previous?.revision ?? 0) + 1;
    await tx.query(
      `INSERT INTO plan_revisions (id, job_id, revision, object_key, content_type, transform, uploaded_by, uploaded_by_role)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [id, access.job.id, revision, key, image.contentType, JSON.stringify(affineToJson(transform)), access.person.id, access.role],
    );
    const rooms = await loadRooms(tx, access.job.id);
    const placed: RoomRow[] = rooms.map((room) => ({ ...room, outline: outlines?.get(room.id) ?? room.outline }));
    for (const room of placed) await tx.query("UPDATE rooms SET outline = $2::jsonb WHERE id = $1", [room.id, JSON.stringify(room.outline)]);
    const pinned = await rows<{ id: string; room_id: string; trade: Trade | null; pin_x: number; pin_y: number }>(
      tx,
      "SELECT id, room_id, trade, pin_x, pin_y FROM items WHERE job_id = $1 AND pin_x IS NOT NULL ORDER BY number FOR UPDATE",
      [access.job.id],
    );
    let moved = 0;
    let needsReview = 0;
    const changed = new Map<string, Trade | null>();
    for (const item of pinned) {
      const pin = applyAffine(transform, { x: item.pin_x, y: item.pin_y });
      const room = isPlanFraction(pin.x) && isPlanFraction(pin.y) ? roomForPin(placed, pin, [item.room_id]) : null;
      if (room) {
        if (pin.x === item.pin_x && pin.y === item.pin_y && room.id === item.room_id) continue;
        if (pin.x !== item.pin_x || pin.y !== item.pin_y) moved += 1;
        await tx.query("UPDATE items SET pin_x = $2, pin_y = $3, room_id = $4, updated_at = clock_timestamp() WHERE id = $1", [
          item.id,
          pin.x,
          pin.y,
          room.id,
        ]);
        if (room.id !== item.room_id) await recordChange(tx, access.job.id, item.id);
      } else {
        moved += 1;
        needsReview += 1;
        await tx.query("UPDATE items SET pin_x = NULL, pin_y = NULL, pin_status = 'needs_review', updated_at = clock_timestamp() WHERE id = $1", [
          item.id,
        ]);
      }
      changed.set(item.id, item.trade);
    }
    await tx.query("UPDATE plan_revisions SET moved = $2, needs_review = $3 WHERE id = $1", [id, moved, needsReview]);
    if (outlines) for (const room of placed) emit(tx, access.job.id, { type: "room", room });
    await emitItems(tx, access.job.id, changed);
    emit(tx, access.job.id, { type: "plan", revision, planUrl: `/api/jobs/${access.job.id}/plan` });
    emit(tx, access.job.id, { type: "job" });
    return { revision, moved, needsReview };
  }).catch(async (error: unknown) => {
    await deleteObject(key).catch(() => undefined);
    throw error;
  });
}

route("PUT", "/api/jobs/:jobId/plan", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  requireOpenJob(access);
  const image = await imageFrom(await readForm(call));
  await storeRevision(access, image, IDENTITY, null);
  return json(200, await jobView(pool, access));
});

function parseJsonPart(form: FormData, name: string): unknown {
  const part = form.get(name);
  if (typeof part !== "string") return undefined;
  try {
    return JSON.parse(part);
  } catch {
    return undefined;
  }
}

function readPoint(raw: unknown): { x: number; y: number } | null {
  const point = raw as { x?: unknown; y?: unknown } | null;
  if (typeof point !== "object" || point === null) return null;
  const { x, y } = point;
  return isPlanFraction(x) && isPlanFraction(y) && hasFourDecimals(x) && hasFourDecimals(y) ? { x, y } : null;
}

route("POST", "/api/jobs/:jobId/plan/revisions", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const form = await readForm(call);
  const roomsPart = parseJsonPart(form, "rooms");
  const existing = await loadRooms(pool, access.job.id);
  const named = Array.isArray(roomsPart) ? roomsPart.map((entry) => (entry as { room_id?: unknown } | null)?.room_id) : [];
  if (named.some((id) => typeof id === "string" && !existing.some((room) => room.id === id))) fail("not_found");
  requireRole(access, "owner");
  requireOpenJob(access);
  if (!(await currentRevision(pool, access.job.id))) fail("invalid_transition");
  const errors: Record<string, string> = {};
  const pointsPart = parseJsonPart(form, "reference_points");
  const pairs: RefPair[] = [];
  if (Array.isArray(pointsPart) && pointsPart.length === 3) {
    for (const entry of pointsPart) {
      const pair = entry as { old?: unknown; new?: unknown } | null;
      const old = readPoint(pair?.old);
      const next = readPoint(pair?.new);
      if (old && next) pairs.push({ old, new: next });
    }
  }
  const transform = pairs.length === 3 ? solveAffine(pairs) : null;
  if (pairs.length !== 3) errors.reference_points = "Give exactly three pairs of points, each from 0 to 1 with up to four decimals.";
  else if (!transform) errors.reference_points = FIELD_MESSAGES.collinear;
  const outlines = new Map<string, Outline>();
  if (!Array.isArray(roomsPart)) errors.rooms = "Give every room's outline.";
  else {
    for (const entry of roomsPart) {
      const { room_id: roomId, outline } = (entry ?? {}) as { room_id?: unknown; outline?: unknown };
      const checked = checkOutline(outline);
      if (typeof roomId !== "string" || outlines.has(roomId)) errors.rooms = "Give each room's outline exactly once.";
      else if (!checked.ok) errors.rooms = checked.message;
      else outlines.set(roomId, checked.outline);
    }
    if (!errors.rooms && existing.some((room) => !outlines.has(room.id))) errors.rooms = "Give every room's outline exactly once.";
    const list = [...outlines.values()];
    if (!errors.rooms && list.some((a, i) => list.some((b, j) => j > i && outlinesOverlap(a, b)))) errors.rooms = FIELD_MESSAGES.overlap;
  }
  const bytes = await uploadedBytes(form);
  if (!bytes) errors.file = "Choose the revision image.";
  if (Object.keys(errors).length > 0) invalid(errors);
  const image = cleanImage(bytes!);
  const stored = await storeRevision(access, image, transform!, outlines);
  return json(201, {
    revision: stored.revision,
    job: await jobView(pool, access),
    moved: stored.moved,
    needs_review: stored.needsReview,
  });
});

route("GET", "/api/jobs/:jobId/plan/revisions", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner", "lead");
  const revisions = await rows<{ revision: number; created_at: string; name: string; role: Role; moved: number; needs_review: number }>(
    pool,
    `SELECT r.revision, r.created_at, p.name, r.uploaded_by_role AS role, r.moved, r.needs_review
     FROM plan_revisions r JOIN people p ON p.id = r.uploaded_by WHERE r.job_id = $1 ORDER BY r.revision`,
    [access.job.id],
  );
  return json(200, {
    revisions: revisions.map(({ name, role, ...revision }) => ({ ...revision, uploaded_by: { name, role } })),
  });
});

async function imageReply(revision: RevisionRow | null): Promise<Reply> {
  if (!revision) fail("not_found");
  const bytes = await getObject(revision.object_key);
  if (!bytes) fail("not_found");
  return { status: 200, bytes, contentType: revision.content_type, headers: { "Cache-Control": "private, no-cache" } };
}

route("GET", "/api/jobs/:jobId/plan", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  return imageReply(await currentRevision(pool, access.job.id));
});

route("GET", "/api/jobs/:jobId/plan/revisions/:n", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const n = /^\d{1,9}$/.test(call.params.n!) ? Number(call.params.n) : -1;
  const revision = await maybeOne<RevisionRow>(
    pool,
    "SELECT id, revision, object_key, content_type FROM plan_revisions WHERE job_id = $1 AND revision = $2",
    [access.job.id, n],
  );
  if (!revision) fail("not_found");
  requireRole(access, "owner", "lead");
  return imageReply(revision);
});

// ---------- Rooms ----------

route("GET", "/api/jobs/:jobId/rooms", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const [rooms, items] = await Promise.all([loadRooms(pool, access.job.id), scopedItemRows(pool, access)]);
  return json(200, { rooms: projectRooms(rooms, items) });
});

route("POST", "/api/jobs/:jobId/rooms", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  requireOpenJob(access);
  const body = readJson(call);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const room = await transaction(async (tx) => {
    // Room creation takes the job row, so of two overlapping rooms created at once one wins.
    await lockOpenJob(tx, access.job.id, "update");
    const rooms = await loadRooms(tx, access.job.id);
    const outline = checkOutline(body.outline);
    const errors: Record<string, string> = {};
    if (name.length < 1 || name.length > ROOM_NAME_MAX) errors.name = `Enter a room name of 1 to ${ROOM_NAME_MAX} characters.`;
    else if (rooms.some((room) => room.name.toLowerCase() === name.toLowerCase())) errors.name = "This job already has a room with that name.";
    if (!outline.ok) errors.outline = outline.message;
    else if (rooms.some((room) => outlinesOverlap(room.outline, outline.outline))) errors.outline = FIELD_MESSAGES.overlap;
    if (Object.keys(errors).length > 0 || !outline.ok) invalid(errors);
    const created: RoomRow = { id: randomUUID(), name, outline: outline.outline };
    await tx.query("INSERT INTO rooms (id, job_id, name, outline) VALUES ($1, $2, $3, $4::jsonb)", [
      created.id,
      access.job.id,
      name,
      JSON.stringify(created.outline),
    ]);
    emit(tx, access.job.id, { type: "room", room: created });
    return created;
  });
  return json(201, projectRooms([room], [])[0]);
});

route("GET", "/api/jobs/:jobId/events", async (call) => ({
  status: 200,
  stream: await openStream({
    person: call.auth.person,
    tokenHash: call.auth.tokenHash,
    jobId: call.params.jobId!,
    lastEventId: call.headers["last-event-id"],
    after: call.query.get("after"),
  }),
}));
