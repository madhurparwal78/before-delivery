import type { Person, Portal, Role } from "../shared/types.js";
import { acceptGrant, createDraft, declineGrant, deleteDraft, listGrants, offerGrant, patchDraft, presentGrant, presentGrantById, requireHolder, respondToOutcome, submitGrant, visibleGrantRow } from "./grants.js";
import { awaitingVote, boardSize, castVote, loadQueue } from "./board.js";
import { correctDocument, documentContent, documentRow, listDocuments, presentDocument } from "./documents.js";
import { direct, query } from "./db.js";
import { recordDeparture } from "./departures.js";
import { forbidden, notFound, vaultUnavailable } from "./errors.js";
import { cancelExerciseOrder, listExerciseOrders, placeExerciseOrder, quoteExercise, retryExerciseOrder, loadExerciseOrder } from "./exercises.js";
import { currentSequence } from "./live.js";
import { listLedger } from "./ledger.js";
import { addPerson, changeRole, endSession, listPeople, removeAccess, signIn, personRow } from "./people.js";
import { tenderHasClosed } from "./deadlines.js";
import { loadPool, issueShares, resizePool } from "./pool.js";
import { loadRegisterTotals, loadValuations, ownershipOf, presentCapTable } from "./registry.js";
import { listSaved, runScenario, saveScenario } from "./scenarios.js";
import { listTenders, loadTender, openTender, saveDraft, signNda, submitTender, withdrawTender } from "./tenders.js";
import { recordValuation } from "./valuations.js";
import { TIME_ZONE } from "../shared/format.js";
import { iso, now, pacificDate } from "./time.js";
import { clearedSessionCookie, openRoute, route, sessionCookie, type Context } from "./http.js";

function requireRole(person: Person, ...roles: Role[]): void {
  if (!roles.includes(person.role)) throw forbidden();
}

const admin = (context: Context): Person => {
  requireRole(context.person, "founder_admin");
  return context.person;
};

async function portalOf(person: Person): Promise<Portal> {
  const first_name = person.first_name;
  switch (person.role) {
    case "option_holder": {
      const grants = (await listGrants(person)).filter((grant) => grant.state === "accepted");
      const next = grants.flatMap((grant) => (grant.next_tranche ? [grant.next_tranche.date] : [])).sort()[0] ?? null;
      return {
        first_name,
        vested_today: grants.reduce((sum, grant) => sum + grant.vested, 0),
        total_options: grants.reduce((sum, grant) => sum + (grant.options ?? 0), 0),
        next_tranche_date: next,
      };
    }
    case "leaver": {
      const grants = (await listGrants(person)).filter((grant) => grant.state === "accepted");
      return {
        first_name,
        exercisable: grants.reduce((sum, grant) => sum + grant.exercisable, 0),
        window_ends_at: person.departure?.window_ends_at ?? null,
      };
    }
    case "investor": {
      const totals = await loadRegisterTotals(direct);
      const own = totals.holders.get(person.id);
      const [waiting] = await query<{ id: string; closes_at: Date }>("SELECT id, closes_at FROM tenders WHERE state = 'open'");
      const open = waiting && !tenderHasClosed(waiting.closes_at, now()) ? waiting : undefined;
      return {
        first_name,
        fully_diluted_shares: (own?.issued ?? 0) + (own?.options ?? 0),
        ownership: ownershipOf(totals, person.id),
        open_tender: open ? { id: open.id, closes_at: iso(open.closes_at) } : null,
      };
    }
    case "board_member": {
      const size = await boardSize(direct);
      return { first_name, awaiting_vote: await awaitingVote(person), quorum: size.quorum, board_size: size.boardSize };
    }
    case "founder_admin": {
      const totals = await loadRegisterTotals(direct);
      const [approved] = await query<{ n: number }>("SELECT count(*)::int AS n FROM grants WHERE state = 'approved'");
      return { first_name, fully_diluted_total: totals.fullyDiluted, offers_to_send: approved?.n ?? 0 };
    }
  }
}

export function registerRoutes(): void {
  openRoute("GET", "/api/masthead", async () => {
    const totals = await loadRegisterTotals(direct);
    return { status: 200, body: { company: "Tidecraft Robotics", fully_diluted_total: totals.fullyDiluted } };
  });

  openRoute("POST", "/api/session", async (context) => {
    const { person, token } = await signIn(context.body.email, context.body.password);
    return { status: 200, body: { person }, headers: { "Set-Cookie": sessionCookie(token) } };
  });

  route("DELETE", "/api/session", async (context) => {
    await endSession(context.token);
    return { status: 204, headers: { "Set-Cookie": clearedSessionCookie } };
  });

  route("GET", "/api/me", async ({ person }) => {
    const moment = now();
    return {
      status: 200,
      body: { person, server_time: iso(moment), server_date: pacificDate(moment), time_zone: TIME_ZONE, event_seq: await currentSequence() },
    };
  });

  route("GET", "/api/portal", async ({ person }) => ({ status: 200, body: await portalOf(person) }));

  route("GET", "/api/cap-table", async ({ person }) => ({ status: 200, body: presentCapTable(await loadRegisterTotals(direct), person) }));

  route("GET", "/api/ledger", async ({ person }) => ({ status: 200, body: { entries: await listLedger(person) } }));

  route("GET", "/api/pool", async (context) => {
    admin(context);
    return { status: 200, body: await loadPool() };
  });
  route("PATCH", "/api/pool", async (context) => {
    admin(context);
    return { status: 200, body: await resizePool(context.body.authorized) };
  });
  route("POST", "/api/issuances", async (context) => {
    admin(context);
    return { status: 201, body: { entry: await issueShares(context.body) } };
  });

  /* people */
  route("GET", "/api/people", async (context) => {
    admin(context);
    return { status: 200, body: { people: await listPeople() } };
  });
  route("POST", "/api/people", async (context) => {
    admin(context);
    return { status: 201, body: { person: await addPerson(context.body) } };
  });
  route("PATCH", "/api/people/:id", async (context) => {
    const actor = admin(context);
    return { status: 200, body: { person: await changeRole(actor, context.id, context.body.role) } };
  });
  route("POST", "/api/people/:id/remove-access", async (context) => {
    const actor = admin(context);
    return { status: 200, body: { person: await removeAccess(actor, context.id) } };
  });
  route("POST", "/api/people/:id/departure", async (context) => {
    admin(context);
    await personRow(direct, context.id);
    return { status: 200, body: { person: await recordDeparture(context.id) } };
  });

  /* grants */
  route("GET", "/api/grants", async ({ person }) => ({ status: 200, body: { grants: await listGrants(person) } }));
  route("POST", "/api/grants", async (context) => {
    admin(context);
    return { status: 201, body: await createDraft(context.body) };
  });
  route("GET", "/api/grants/:id", async ({ person, id }) => {
    const row = await visibleGrantRow(person, id);
    return { status: 200, body: presentGrant(row, await loadRegisterTotals(direct)) };
  });
  route("PATCH", "/api/grants/:id", async (context) => {
    await visibleGrantRow(context.person, context.id);
    admin(context);
    return { status: 200, body: await patchDraft(context.id, context.body) };
  });
  route("DELETE", "/api/grants/:id", async (context) => {
    await visibleGrantRow(context.person, context.id);
    admin(context);
    await deleteDraft(context.id);
    return { status: 204 };
  });
  route("POST", "/api/grants/:id/submit", async (context) => {
    await visibleGrantRow(context.person, context.id);
    admin(context);
    return { status: 200, body: await submitGrant(context.id) };
  });
  route("POST", "/api/grants/:id/offer", async (context) => {
    await visibleGrantRow(context.person, context.id);
    admin(context);
    return { status: 200, body: await offerGrant(context.id) };
  });
  route("POST", "/api/grants/:id/accept", async (context) => {
    requireHolder(context.person, await visibleGrantRow(context.person, context.id));
    const { outcome } = await acceptGrant(context.id);
    if (outcome === "vault_down") throw vaultUnavailable({ grant: await presentGrantById(context.id) });
    respondToOutcome(outcome);
    return { status: 200, body: await presentGrantById(context.id) };
  });
  route("POST", "/api/grants/:id/decline", async (context) => {
    requireHolder(context.person, await visibleGrantRow(context.person, context.id));
    respondToOutcome((await declineGrant(context.id)).outcome);
    return { status: 200, body: await presentGrantById(context.id) };
  });
  route("POST", "/api/grants/:id/exercise-quote", async (context) => ({
    status: 200,
    body: await quoteExercise(context.person, context.id, context.body.options),
  }));
  route("POST", "/api/grants/:id/exercises", async (context) => placeExerciseOrder(context.person, context.id, context.header("Idempotency-Key"), context.body));

  /* board */
  route("GET", "/api/board/queue", async ({ person }) => {
    requireRole(person, "board_member", "founder_admin");
    return { status: 200, body: await loadQueue(person) };
  });
  route("POST", "/api/board/queue/:id/votes", async (context) => {
    const [grant] = await query("SELECT 1 FROM grants WHERE id = $1", [context.id]);
    if (!grant) throw notFound();
    requireRole(context.person, "board_member");
    return { status: 200, body: await castVote(context.person, context.id, context.body.vote) };
  });

  /* valuations */
  route("GET", "/api/valuations", async (context) => {
    admin(context);
    const { all, current } = await loadValuations(direct);
    return { status: 200, body: { valuations: all, current_id: current?.id ?? null } };
  });
  route("POST", "/api/valuations", async (context) => {
    admin(context);
    return { status: 201, body: await recordValuation(context.body) };
  });

  /* orders */
  route("GET", "/api/exercises", async ({ person }) => ({ status: 200, body: { orders: await listExerciseOrders(person) } }));
  route("GET", "/api/exercises/:id", async ({ person, id }) => ({ status: 200, body: await loadExerciseOrder(person, id) }));
  route("POST", "/api/exercises/:id/retry", async (context) => retryExerciseOrder(context.person, context.id));
  route("POST", "/api/exercises/:id/cancel", async (context) => ({ status: 200, body: await cancelExerciseOrder(context.person, context.id) }));

  /* tenders */
  route("GET", "/api/tenders", async ({ person }) => ({ status: 200, body: { tenders: await listTenders(person) } }));
  route("POST", "/api/tenders", async (context) => {
    admin(context);
    return { status: 201, body: await openTender(context.person, context.body) };
  });
  route("GET", "/api/tenders/:id", async ({ person, id }) => ({ status: 200, body: await loadTender(person, id) }));
  route("POST", "/api/tenders/:id/nda", async (context) => ({ status: 200, body: await signNda(context.person, context.id) }));
  route("PUT", "/api/tenders/:id/draft", async (context) => ({ status: 200, body: await saveDraft(context.person, context.id, context.body) }));
  route("POST", "/api/tenders/:id/submissions", async (context) => ({ status: 201, body: await submitTender(context.person, context.id, context.body) }));
  route("DELETE", "/api/tenders/:id/submissions/mine", async (context) => {
    await withdrawTender(context.person, context.id);
    return { status: 204 };
  });

  /* scenarios */
  route("POST", "/api/scenarios/round", async (context) => {
    admin(context);
    return { status: 200, body: await runScenario(context.body) };
  });
  route("GET", "/api/scenarios/saved", async (context) => {
    admin(context);
    return { status: 200, body: { scenarios: await listSaved() } };
  });
  route("POST", "/api/scenarios/saved", async (context) => {
    admin(context);
    return { status: 201, body: { scenario: await saveScenario(context.body) } };
  });

  /* documents */
  route("GET", "/api/documents", async ({ person }) => {
    requireRole(person, "founder_admin", "option_holder", "leaver", "investor");
    return { status: 200, body: { documents: await listDocuments(person) } };
  });
  route("GET", "/api/documents/:id", async ({ person, id }) => ({ status: 200, body: presentDocument(await documentRow(person, id)) }));
  route("GET", "/api/documents/:id/content", async ({ person, id }) => {
    const row = await documentRow(person, id);
    const bytes = await documentContent(row);
    return { status: 200, bytes, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Document-SHA256": row.sha256 } };
  });
  route("POST", "/api/documents/:id/corrections", async (context) => {
    const row = await documentRow(context.person, context.id);
    admin(context);
    return { status: 201, body: await correctDocument(row, context.body.text) };
  });

}
