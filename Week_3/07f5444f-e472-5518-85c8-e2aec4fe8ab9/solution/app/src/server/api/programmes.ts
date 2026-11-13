// Programmes: list, read, create, string count, works, status changes, publish and notices.

import { PROGRAMME_STATUS_LABELS, SECTION_KEYS, type ProgrammeStatus, type StringCount } from "../../shared/api.js";
import { pool, rows, transaction, pgCode, type Db } from "../db.js";
import { checkStringCount } from "../domain/stringCount.js";
import { foldersOpen } from "../domain/seating.js";
import { STRING_SECTIONS } from "../domain/copies.js";
import { transitionAllowed, worksMayBeAdded } from "../domain/programmeStatus.js";
import { singleLineText } from "../domain/text.js";
import { conflict, FieldErrors, invalid, notFound, programmeClosed } from "../errors.js";
import { route, jsonBody } from "../http.js";
import { visibleProgramme } from "../access.js";
import { noticeSeatedPlayers } from "../notices.js";
import { authenticate, chairOf, requireRole } from "../people.js";
import {
  loadProgrammes,
  loadRoster,
  pad2,
  programmeDetail,
  programmeSummary,
  seatedRoster,
  workDetailOf,
  type ProgrammeModel,
} from "../readModel.js";
import { addCatalogueWork } from "../seed.js";
import { uncutMs, wholeSeconds } from "../domain/runningTime.js";
import { field, readIdempotencyKey, readInstant } from "../validate.js";
import { londonTimestamp } from "../../shared/london.js";

const PROGRAMME_NUMBER_LOCK = 4_173_001;

async function detailOf(db: Db, id: string) {
  const [model] = await loadProgrammes(db, [id]);
  if (!model) throw notFound();
  return programmeDetail(model, await loadRoster(db), Date.now());
}

export async function summaryOf(db: Db, model: ProgrammeModel) {
  return programmeSummary(model, await loadRoster(db), Date.now());
}

/** Players per string section's roster, read from the seeded people. */
async function rosterSizes(db: Db): Promise<StringCount> {
  const counted = await rows<{ chair_key: string; players: number }>(
    db,
    "SELECT chair_key, count(*)::int AS players FROM people WHERE chair_key = ANY($1) GROUP BY chair_key",
    [Object.keys(STRING_SECTIONS)],
  );
  const sizes: StringCount = { violin_1: 0, violin_2: 0, viola: 0, cello: 0, bass: 0 };
  for (const { chair_key, players } of counted) {
    const section = STRING_SECTIONS[chair_key];
    if (section) sizes[section] = players;
  }
  return sizes;
}

export function closedGuard(model: ProgrammeModel): void {
  if (model.row.status === "closed") throw programmeClosed();
}

route("GET", "/api/programmes", "none", async (request) => {
  const person = await authenticate(pool, request);
  requireRole(person, "PAS");
  const [models, roster] = await Promise.all([loadProgrammes(pool, null), loadRoster(pool)]);
  const now = Date.now();
  return { status: 200, json: { programmes: models.map((model) => programmeSummary(model, roster, now)) } };
});

route("GET", "/api/programmes/{id}", "none", async (request) => {
  const person = await authenticate(pool, request);
  const model = await visibleProgramme(pool, person, request.params.id ?? "");
  requireRole(person, "PAS");
  return { status: 200, json: programmeDetail(model, await loadRoster(pool), Date.now()) };
});

route("POST", "/api/programmes", "json", async (request) => {
  const person = await authenticate(pool, request);
  requireRole(person, "P");
  const body = jsonBody(request);
  const errors = new FieldErrors();
  const title = singleLineText(field(body, "title"), "Title");
  if (!title.ok) errors.add("title", title.message);
  const firstRehearsal = readInstant(field(body, "first_rehearsal"));
  if (firstRehearsal === null) errors.add("first_rehearsal", "Enter the first rehearsal as an ISO 8601 time with an offset.");
  const listed = field(body, "performances");
  const read = Array.isArray(listed) ? listed.map(readInstant) : [];
  const performances = read.every((p) => p !== null) ? read : null;
  if (!Array.isArray(listed) || listed.length < 1 || listed.length > 10) {
    errors.add("performances", "Enter 1 to 10 performances.");
  } else if (performances === null) {
    errors.add("performances", "Enter each performance as an ISO 8601 time with an offset.");
  } else if (new Set(performances).size !== performances.length) {
    errors.add("performances", "Two performances can't be at the same time.");
  } else if (firstRehearsal !== null && performances.some((p) => p <= firstRehearsal)) {
    errors.add("performances", "Every performance must come after the first rehearsal.");
  }
  const count = checkStringCount(field(body, "string_count"), await rosterSizes(pool));
  if (!count.ok) for (const [section, message] of Object.entries(count.errors)) errors.add(`string_count.${section}`, message);
  if (errors.any() || !title.ok || firstRehearsal === null || performances === null || !count.ok) throw errors.error();
  const id = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [PROGRAMME_NUMBER_LOCK]);
    const [next] = await rows<{ number: number }>(client, "SELECT coalesce(max(number), 0) + 1 AS number FROM programmes");
    const number = next?.number ?? 1;
    const programmeId = `p${pad2(number)}`;
    const c = count.count;
    await client.query(
      `INSERT INTO programmes (id, number, title, status, first_rehearsal, violin_1, violin_2, viola, cello, bass)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)`,
      [programmeId, number, title.text, new Date(firstRehearsal).toISOString(), c.violin_1, c.violin_2, c.viola, c.cello, c.bass],
    );
    await client.query("INSERT INTO performances (programme_id, performs_at) SELECT $1, unnest($2::timestamptz[])", [
      programmeId,
      performances.map((p) => new Date(p).toISOString()),
    ]);
    return programmeId;
  });
  return { status: 201, json: await detailOf(pool, id) };
});

route("PUT", "/api/programmes/{id}/string-count", "json", async (request) => {
  const person = await authenticate(pool, request);
  const model = await visibleProgramme(pool, person, request.params.id ?? "");
  requireRole(person, "P");
  closedGuard(model);
  const count = checkStringCount(jsonBody(request), await rosterSizes(pool));
  if (!count.ok) throw invalid(count.errors);
  await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE programmes SET violin_1 = $2, violin_2 = $3, viola = $4, cello = $5, bass = $6
       WHERE id = $1 AND status <> 'closed' RETURNING status`,
      [model.row.id, ...SECTION_KEYS.map((section) => count.count[section])],
    );
    if (updated.rowCount === 0) throw programmeClosed();
    const [fresh] = await loadProgrammes(client, [model.row.id]);
    if (fresh && foldersOpen(fresh.row.status)) {
      const seated = seatedRoster(fresh, await loadRoster(client));
      await noticeSeatedPlayers(client, fresh.row.id, seated.map((chair) => chair.person_id));
    }
  });
  return { status: 200, json: await detailOf(pool, model.row.id) };
});

route("POST", "/api/programmes/{id}/works", "json", async (request) => {
  const person = await authenticate(pool, request);
  const model = await visibleProgramme(pool, person, request.params.id ?? "");
  const catalogueId = field(jsonBody(request), "catalogue_work_id");
  if (typeof catalogueId === "string") {
    const [known] = await rows(pool, "SELECT 1 FROM catalogue_works WHERE id = $1", [catalogueId]);
    if (!known) throw notFound();
  }
  requireRole(person, "P");
  const workId = await transaction(async (client) => {
    const [locked] = await rows<{ status: ProgrammeStatus }>(client, "SELECT status FROM programmes WHERE id = $1 FOR NO KEY UPDATE", [model.row.id]);
    if (!locked || !worksMayBeAdded(locked.status)) {
      throw conflict("wrong_status", "Works can only be added while the programme is a draft or in preparation.");
    }
    if (typeof catalogueId !== "string") throw invalid({ catalogue_work_id: "Choose a catalogue work." });
    const [position] = await rows<{ next: number }>(
      client,
      "SELECT coalesce(max(position), -1) + 1 AS next FROM works WHERE programme_id = $1",
      [model.row.id],
    );
    try {
      await client.query("SAVEPOINT add_work");
      return await addCatalogueWork(client, model.row.id, catalogueId, position?.next ?? 0);
    } catch (error) {
      if (pgCode(error) !== "23505") throw error;
      await client.query("ROLLBACK TO SAVEPOINT add_work");
      const [title] = await rows<{ title: string }>(client, "SELECT title FROM catalogue_works WHERE id = $1", [catalogueId]);
      throw conflict("work_already_in_programme", `${title?.title ?? "That work"} is already in this programme.`);
    }
  });
  const [fresh] = await loadProgrammes(pool, [model.row.id]);
  const work = fresh?.works.find((w) => w.row.id === workId);
  if (!fresh || !work) throw notFound();
  return { status: 201, json: await workDetailOf(pool, fresh, work) };
});

const TRANSITION_TARGETS: readonly ProgrammeStatus[] = ["draft", "in_preparation", "in_performance", "closed"];

route("POST", "/api/programmes/{id}/transition", "json", async (request) => {
  const person = await authenticate(pool, request);
  const model = await visibleProgramme(pool, person, request.params.id ?? "");
  requireRole(person, "P");
  const to = TRANSITION_TARGETS.find((status) => status === field(jsonBody(request), "to"));
  if (to === undefined) throw invalid({ to: "Choose draft, in preparation, in performance or closed." });
  const from = model.row.status;
  const refused = conflict(
    "illegal_transition",
    `Programme ${pad2(model.row.number)} can't move from ${PROGRAMME_STATUS_LABELS[from]} to ${PROGRAMME_STATUS_LABELS[to]}.`,
  );
  if (!transitionAllowed(from, to)) throw refused;
  const moved = await pool.query("UPDATE programmes SET status = $2 WHERE id = $1 AND status = $3", [model.row.id, to, from]);
  if (moved.rowCount === 0) throw refused;
  return { status: 200, json: await detailOf(pool, model.row.id) };
});

route("POST", "/api/programmes/{id}/publish", "none", async (request) => {
  const person = await authenticate(pool, request);
  const model = await visibleProgramme(pool, person, request.params.id ?? "");
  requireRole(person, "P");
  const key = readIdempotencyKey(request.headers["idempotency-key"]);
  const json = await transaction(async (client) => {
    if (key !== null) {
      const claimed = await client.query(
        "INSERT INTO publish_keys (idempotency_key, programme_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [key, model.row.id],
      );
      if (claimed.rowCount === 0) {
        const [stored] = await rows<{ programme_id: string; response: unknown }>(
          client,
          "SELECT programme_id, response FROM publish_keys WHERE idempotency_key = $1",
          [key],
        );
        if (stored?.programme_id !== model.row.id) {
          throw conflict("idempotency_key_reused", "That Idempotency-Key was already used for a different request.");
        }
        return stored.response;
      }
    }
    await client.query("SELECT 1 FROM programmes WHERE id = $1 FOR NO KEY UPDATE", [model.row.id]);
    const [locked] = await loadProgrammes(client, [model.row.id]);
    if (!locked) throw notFound();
    const roster = await loadRoster(client);
    const check = programmeSummary(locked, roster, Date.now());
    const [blocker] = check.publish_blockers;
    if (blocker) {
      throw conflict(blocker.error, blocker.message, blocker.error === "copies_short" ? { shortfall: check.copies.shortfall } : {});
    }
    if (key === null) throw invalid({ idempotency_key: "Send an Idempotency-Key of 1 to 80 visible ASCII characters." });
    await client.query("UPDATE programmes SET status = 'published' WHERE id = $1", [model.row.id]);
    const seated = seatedRoster(locked, roster);
    const notices = await noticeSeatedPlayers(client, model.row.id, seated.map((chair) => chair.person_id));
    const [published] = await loadProgrammes(client, [model.row.id]);
    if (!published) throw notFound();
    const response = { programme: programmeDetail(published, roster, Date.now()), notices };
    await client.query("UPDATE publish_keys SET response = $2 WHERE idempotency_key = $1", [key, JSON.stringify(response)]);
    return response;
  });
  return { status: 200, json };
});

route("GET", "/api/programmes/{id}/notices", "none", async (request) => {
  const person = await authenticate(pool, request);
  const model = await visibleProgramme(pool, person, request.params.id ?? "");
  requireRole(person, "PA");
  const found = await rows<{
    player_id: string;
    name: string;
    email: string;
    chair_key: string | null;
    chair_number: number | null;
    part_name: string | null;
    status: "sent" | "queued";
    sent_at: number | null;
  }>(
    pool,
    `SELECT n.player_id, pe.name, pe.email, pe.chair_key, pe.chair_number, n.status, n.sent_at,
            (SELECT cp.name FROM catalogue_parts cp WHERE cp.chair_key = pe.chair_key LIMIT 1) AS part_name
     FROM notices n JOIN people pe ON pe.id = n.player_id
     WHERE n.programme_id = $1 ORDER BY pe.sort_order`,
    [model.row.id],
  );
  return {
    status: 200,
    json: {
      notices: found.map((n) => ({
        player_id: n.player_id,
        name: n.name,
        email: n.email,
        chair_label: chairOf(n, n.part_name)?.label ?? "",
        status: n.status,
        sent_at: n.sent_at === null ? null : londonTimestamp(n.sent_at),
      })),
    },
  };
});

route("GET", "/api/catalogue", "none", async (request) => {
  const person = await authenticate(pool, request);
  requireRole(person, "PAS");
  const [works, segments, parts] = await Promise.all([
    rows<{ id: string; title: string; composer: string }>(pool, "SELECT id, title, composer FROM catalogue_works ORDER BY position"),
    rows<{ catalogue_work_id: string; from_bar: number; to_bar: number; bar_ms: number }>(pool, "SELECT * FROM catalogue_bar_segments ORDER BY from_bar"),
    rows<{ catalogue_work_id: string; name: string; chair_key: string; bars_from: number; bars_to: number }>(
      pool,
      "SELECT catalogue_work_id, name, chair_key, bars_from, bars_to FROM catalogue_parts ORDER BY position",
    ),
  ]);
  return {
    status: 200,
    json: {
      works: works.map((work) => {
        const barMap = segments.filter((s) => s.catalogue_work_id === work.id);
        return {
          id: work.id,
          title: work.title,
          composer: work.composer,
          bars: barMap.at(-1)?.to_bar ?? 0,
          running_time_seconds: wholeSeconds(uncutMs(barMap, [])),
          parts: parts
            .filter((p) => p.catalogue_work_id === work.id)
            .map(({ name, chair_key, bars_from, bars_to }) => ({ name, chair_key, bars_from, bars_to })),
        };
      }),
    },
  };
});
