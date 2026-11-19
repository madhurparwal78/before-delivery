import type { Cohort, RosterRow } from "../../shared/api.js";
import { acceptsRefund, digestRuns, illegalTransition, type CohortTransition } from "../domain/cohorts.js";
import { cohortSignsLine, digestLine, rosterRow, type RosterEntry } from "../domain/roster.js";
import { nightKeyAt, nightNumber } from "../domain/time.js";
import { cohortRequest, isUuid, nameKey } from "../domain/validation.js";
import { pool, transaction } from "../db.js";
import { fail, invalid, notFound, ok } from "../http.js";
import { coachOnly, withoutBody, type Route } from "../router.js";
import { refundSeat } from "../services/killbill.js";
import { sendMail } from "../services/mail.js";
import { COHORT_SELECT, phaseOf, SIGN_SELECT, toCohort, type CohortRow, type EntryRow, type SignRow } from "../views.js";
import type { CoachViewer } from "../viewer.js";
import { memoReply } from "./dreamer.js";

async function ownCohort(me: CoachViewer, id: string | undefined): Promise<CohortRow> {
  if (!isUuid(id)) throw notFound();
  const found = await pool.query<CohortRow>(`${COHORT_SELECT} WHERE c.id = $1 AND c.coach_id = $2`, [id, me.id]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

interface RosterEnrollment {
  id: string;
  name: string;
  status: "active" | "refunded";
  home_tz: string;
  bedtime: string;
  first_night: string;
}

/** The roster of active and refunded dreamers, ordered by display name. Dream text leaves only for shared entries. */
async function roster(cohortId: string, now: Date): Promise<RosterRow[]> {
  const people = await pool.query<RosterEnrollment>(
    "SELECT id, name, status, home_tz, bedtime, first_night FROM enrollments WHERE cohort_id = $1 AND status IN ('active', 'refunded')",
    [cohortId],
  );
  const ids = people.rows.map((p) => p.id);
  const entries = await pool.query<EntryRow>("SELECT * FROM entries WHERE enrollment_id = ANY($1::uuid[])", [ids]);
  const signs = await pool.query<SignRow>(`${SIGN_SELECT} WHERE n.enrollment_id = ANY($1::uuid[])`, [ids]);
  const checks = await pool.query<{ enrollment_id: string; count: number }>(
    "SELECT enrollment_id, count(*)::int AS count FROM reality_checks WHERE enrollment_id = ANY($1::uuid[]) GROUP BY enrollment_id",
    [ids],
  );
  return people.rows
    .map((person) => {
      const own: RosterEntry[] = entries.rows
        .filter((entry) => entry.enrollment_id === person.id)
        .map((entry) => ({
          id: entry.id,
          nightKey: entry.night_key,
          nightNumber: nightNumber(entry.night_key, person.first_night),
          title: entry.title,
          text: entry.text,
          dreamsRecalled: entry.dreams_recalled,
          wbtb: entry.wbtb,
          techniqueMinutes: entry.technique_minutes,
          shared: entry.shared,
          hasMemo: entry.memo_sha256 !== null,
        }));
      const latestEntryKey = own.reduce<string | null>((latest, entry) => (latest === null || entry.nightKey > latest ? entry.nightKey : latest), null);
      return rosterRow({
        enrollmentId: person.id,
        displayName: person.name,
        status: person.status,
        currentNight: nightNumber(nightKeyAt(now, { homeTz: person.home_tz, bedtime: person.bedtime, latestEntryKey }), person.first_night),
        entries: own,
        signCategories: signs.rows.filter((s) => s.enrollment_id === person.id).map((s) => s.category),
        realityChecks: checks.rows.find((c) => c.enrollment_id === person.id)?.count ?? 0,
      });
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "en"));
}

function transition(kind: CohortTransition): Route {
  return withoutBody(coachOnly("POST", new RegExp(`^/api/coach/cohorts/([^/]+)/${kind}$`), async ({ params, now }, me) => {
    const cohort = await ownCohort(me, params[0]);
    const refused = illegalTransition(phaseOf(cohort, now).phase, kind);
    if (refused) throw fail(409, refused.error, { from: refused.from, to: refused.to });
    const update =
      kind === "publish"
        ? "UPDATE cohorts SET published = true WHERE id = $1 AND NOT published"
        : "UPDATE cohorts SET closed = true WHERE id = $1 AND published AND NOT closed";
    const changed = await pool.query(update, [cohort.id]);
    const after = await ownCohort(me, cohort.id);
    // A simultaneous request changed the phase first: answer from the phase it left behind.
    const raced = changed.rowCount ? null : illegalTransition(phaseOf(after, now).phase, kind);
    if (raced) throw fail(409, raced.error, { from: raced.from, to: raced.to });
    return ok({ cohort: toCohort(after, now) });
  }));
}

export const coachRoutes: Route[] = [
  coachOnly("GET", /^\/api\/coach\/cohorts$/, async ({ now }, me) => {
    const rows = await pool.query<CohortRow>(`${COHORT_SELECT} WHERE c.coach_id = $1 ORDER BY c.starts_on, c.name`, [me.id]);
    const cohorts: Cohort[] = rows.rows.map((row) => toCohort(row, now));
    return ok({ cohorts });
  }),

  coachOnly("POST", /^\/api\/coach\/cohorts$/, async ({ body, now }, me) => {
    const id = await transaction(async (client) => {
      // One cohort name per coach: creates by one coach queue on the coach's row, so the name check sees every commit.
      await client.query("SELECT id FROM coaches WHERE id = $1 FOR UPDATE", [me.id]);
      if (typeof body.name === "string") {
        const clash = await client.query("SELECT 1 FROM cohorts WHERE coach_id = $1 AND name_key = $2", [me.id, nameKey(body.name)]);
        if (clash.rowCount) throw fail(409, "cohort_name_taken");
      }
      const request = cohortRequest(body);
      if ("errors" in request) throw invalid(request.errors);
      const { name, startsOn, priceCents, seats } = request.cohort;
      const created = await client.query<{ id: string }>(
        "INSERT INTO cohorts (coach_id, name, name_key, starts_on, price_cents, seats) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [me.id, name, nameKey(name), startsOn, priceCents, seats],
      );
      return created.rows[0]?.id;
    });
    return ok({ cohort: toCohort(await ownCohort(me, id), now) }, 201);
  }),

  transition("publish"),
  transition("close"),

  coachOnly("GET", /^\/api\/coach\/cohorts\/([^/]+)\/roster$/, async ({ params, now }, me) => {
    const cohort = await ownCohort(me, params[0]);
    return ok({ cohort: toCohort(cohort, now), dreamers: await roster(cohort.id, now) });
  }),

  coachOnly("GET", /^\/api\/coach\/cohorts\/([^/]+)\/shared\/([^/]+)\/memo$/, async ({ params, req }, me) => {
    const cohort = await ownCohort(me, params[0]);
    if (!isUuid(params[1])) throw notFound();
    const found = await pool.query<EntryRow>(
      `SELECT n.* FROM entries n JOIN enrollments e ON e.id = n.enrollment_id
        WHERE n.id = $1 AND n.shared AND e.cohort_id = $2 AND e.status = 'active'`,
      [params[1], cohort.id],
    );
    const entry = found.rows[0];
    if (!entry) throw notFound();
    return memoReply(entry, entry.enrollment_id, req.headers.range);
  }),

  withoutBody(coachOnly("POST", /^\/api\/coach\/cohorts\/([^/]+)\/digest$/, async ({ params, now }, me) => {
    const cohort = await ownCohort(me, params[0]);
    const { phase, week } = phaseOf(cohort, now);
    if (!digestRuns(phase) || week === null) throw fail(409, "cohort_not_running");
    // The cohort row is held while the digest is sent, so simultaneous sends for one cohort week wait and replay.
    const digest = await transaction(async (client) => {
      await client.query("SELECT id FROM cohorts WHERE id = $1 FOR UPDATE", [cohort.id]);
      const stored = await client.query<{ week: number; sent_to: string; dreamers: number }>(
        "SELECT week, sent_to, dreamers FROM digests WHERE cohort_id = $1 AND week = $2",
        [cohort.id, week],
      );
      const sent = stored.rows[0];
      if (sent) return { week: sent.week, to: sent.sent_to, dreamers: sent.dreamers, replayed: true };
      const active = (await roster(cohort.id, now)).filter((row) => row.status === "active");
      await sendMail(me.email, `Lanternfish digest: ${cohort.name}, week ${week}`, [...active.map(digestLine), cohortSignsLine(active)]);
      await client.query("INSERT INTO digests (cohort_id, week, sent_to, dreamers) VALUES ($1, $2, $3, $4)", [cohort.id, week, me.email, active.length]);
      return { week, to: me.email, dreamers: active.length, replayed: false };
    });
    return ok({ digest });
  })),

  withoutBody(coachOnly("POST", /^\/api\/coach\/enrollments\/([^/]+)\/refund$/, async ({ params, now }, me) => {
    const id = params[0];
    if (!isUuid(id)) throw notFound();
    const cohortId = await transaction(async (client) => {
      const found = await client.query<{ status: string; cohort_id: string; killbill_payment_id: string | null }>(
        `SELECT e.status, e.cohort_id, e.killbill_payment_id FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
          WHERE e.id = $1 AND c.coach_id = $2 FOR UPDATE OF e`,
        [id, me.id],
      );
      const seat = found.rows[0];
      if (!seat) throw notFound();
      if (seat.status !== "active") throw fail(409, "illegal_transition", { from: seat.status, to: "refunded" });
      const cohort = await ownCohort(me, seat.cohort_id);
      if (!acceptsRefund(phaseOf(cohort, now).phase)) throw fail(409, "refund_window_closed");
      if (seat.killbill_payment_id === null) throw fail(409, "not_refundable");
      const refunded = await refundSeat({ id, paymentId: seat.killbill_payment_id, priceCents: cohort.price_cents });
      if (!refunded) throw fail(402, "payment_declined");
      await client.query("UPDATE enrollments SET status = 'refunded' WHERE id = $1", [id]);
      await client.query("DELETE FROM sessions WHERE enrollment_id = $1", [id]);
      return cohort.id;
    });
    const row = (await roster(cohortId, now)).find((r) => r.enrollment_id === id);
    return ok({ dreamer: row });
  })),
];
