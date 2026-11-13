import { randomBytes } from "node:crypto";
import type { Grant } from "../../../shared/types.js";
import { db } from "../../db.js";
import { serverDate, TIME_ZONE } from "../../domain/dates.js";
import { buildGrant, grantContext, GRANT_COLUMNS, type GrantRow } from "../../model/grants.js";
import { boardSize, quorumFor, toPerson, PERSON_COLUMNS, type PersonRow } from "../../model/people.js";
import { capTableForRole, loadRegisterTotals } from "../../model/register.js";
import { verifyPassword } from "../../passwords.js";
import { ApiError } from "../errors.js";
import { field, readText } from "../fields.js";
import { json, requirePerson, type Handler, type RequestContext } from "../context.js";
import { route, type Route } from "../router.js";

export const SESSION_COOKIE = "holdfast_session";

export async function personForToken(token: string | null): Promise<PersonRow | null> {
  if (token === null) return null;
  const row = await db.queryOne<PersonRow>(
    "select p.* from sessions s join people p on p.id = s.person_id where s.token = $1",
    [token],
  );
  if (row === null || row.access === "removed") return null;
  return row;
}

const health: Handler = async () => json({ status: "ok" });

const masthead: Handler = async () => {
  const totals = await loadRegisterTotals(db);
  return json({ company: "Tidecraft Robotics", fully_diluted_total: totals.fullyDilutedTotal });
};

const signIn: Handler = async (context) => {
  const email = readText(field(context.body, "email"));
  const password = readText(field(context.body, "password"));
  const person =
    email === null
      ? null
      : await db.queryOne<PersonRow>(`select ${PERSON_COLUMNS} from people where lower(email) = lower($1)`, [email]);
  const matches = person === null || password === null ? false : await verifyPassword(password, person.password_hash);
  if (person === null || !matches) {
    throw new ApiError(401, "invalid_credentials", "That email and password don't match a Tidecraft register account.");
  }
  if (person.access === "removed") {
    throw new ApiError(401, "access_removed", "Your access to the Tidecraft register has ended.");
  }
  const token = randomBytes(24).toString("hex");
  await db.query("insert into sessions (token, person_id) values ($1, $2)", [token, person.id]);
  return {
    status: 200,
    body: { person: toPerson(person) },
    headers: { "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` },
  };
};

const signOut: Handler = async (context) => {
  const cookie = context.headers.cookie ?? "";
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (match !== null && match[1] !== undefined) await db.query("delete from sessions where token = $1", [match[1]]);
  return {
    status: 204,
    headers: { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` },
  };
};

const me: Handler = async (context) => {
  const person = requirePerson(context);
  return json({
    person: toPerson(person),
    server_time: context.now.toISOString(),
    server_date: serverDate(context.now),
    time_zone: TIME_ZONE,
  });
};

async function grantsForHolder(context: RequestContext, holderId: string): Promise<Grant[]> {
  const rows = await db.query<GrantRow>(`select ${GRANT_COLUMNS} from grants where holder_id = $1 order by seq`, [
    holderId,
  ]);
  const grantsContext = await grantContext(db, context.now);
  return rows.map((row) => buildGrant(row, grantsContext));
}

const portal: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role === "option_holder" || person.role === "leaver") {
    const grants = (await grantsForHolder(context, person.id)).filter((grant) => grant.state === "accepted");
    if (person.role === "leaver") {
      return json({
        first_name: person.first_name,
        exercisable: grants.reduce((sum, grant) => sum + grant.exercisable, 0),
        window_ends_at: person.window_ends_at === null ? null : person.window_ends_at.toISOString(),
      });
    }
    const upcoming = grants
      .map((grant) => grant.next_tranche)
      .filter((tranche): tranche is { date: string; cumulative: number } => tranche !== null)
      .map((tranche) => tranche.date)
      .sort();
    return json({
      first_name: person.first_name,
      vested_today: grants.reduce((sum, grant) => sum + grant.vested, 0),
      total_options: grants.reduce((sum, grant) => sum + (grant.options ?? 0), 0),
      next_tranche_date: upcoming[0] ?? null,
    });
  }
  if (person.role === "investor") {
    const totals = await loadRegisterTotals(db);
    const table = capTableForRole(totals, person.role, person.id);
    const openTender = await db.queryOne<{ id: string; closes_at: Date }>(
      "select id, closes_at from tenders where state = 'open' order by created_at desc limit 1",
    );
    return json({
      first_name: person.first_name,
      fully_diluted_shares: table.rows[0]?.fully_diluted ?? 0,
      ownership: table.rows[0]?.ownership ?? "0.00",
      open_tender: openTender === null ? null : { id: openTender.id, closes_at: openTender.closes_at.toISOString() },
    });
  }
  if (person.role === "board_member") {
    const members = await boardSize(db);
    const waiting = await db.queryOne<{ count: number }>(
      `select count(*)::int as count from grants g
        where g.state = 'board_queue'
          and not exists (select 1 from grant_votes v where v.grant_id = g.id and v.person_id = $1)`,
      [person.id],
    );
    return json({
      first_name: person.first_name,
      awaiting_vote: waiting === null ? 0 : waiting.count,
      quorum: quorumFor(members),
      board_size: members,
    });
  }
  const totals = await loadRegisterTotals(db);
  const offers = await db.queryOne<{ count: number }>(
    "select count(*)::int as count from grants where state = 'approved'",
  );
  return json({
    first_name: person.first_name,
    fully_diluted_total: totals.fullyDilutedTotal,
    offers_to_send: offers === null ? 0 : offers.count,
  });
};

const capTable: Handler = async (context) => {
  const person = requirePerson(context);
  const totals = await loadRegisterTotals(db);
  return json(capTableForRole(totals, person.role, person.id));
};

export const sessionRoutes: Route[] = [
  route("GET", "/api/health", health, true),
  route("GET", "/api/masthead", masthead, true),
  route("POST", "/api/session", signIn, true),
  route("DELETE", "/api/session", signOut, true),
  route("GET", "/api/me", me),
  route("GET", "/api/portal", portal),
  route("GET", "/api/cap-table", capTable),
];
