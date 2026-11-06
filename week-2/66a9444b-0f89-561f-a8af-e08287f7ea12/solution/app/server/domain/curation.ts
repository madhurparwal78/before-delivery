// Curators move sessions through the programme states; cancelling one refunds every line sold for it.
import { db, transaction } from "../db/index.ts";
import { notFound, ok, route } from "../http.ts";
import { SESSION_SELECT, sessionView, type SessionRow } from "./programme.ts";
import { refundCancelledSession, startTasks } from "./refunds.ts";
import { closeSessionSeats } from "./seats.ts";
import { history, move } from "./stateMachine.ts";
import { asObject } from "./validate.ts";

route("POST", "/api/sessions/:id/transitions", ["curator"], async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const now = new Date();
    const session = await tx.one<{ id: string }>("SELECT id FROM sessions WHERE id = $1 FOR UPDATE", [ctx.params.id!]);
    if (!session) throw notFound();
    let tasks: Awaited<ReturnType<typeof refundCancelledSession>>["tasks"] = [];
    const moved = await move(tx, "session", session.id, ctx.user, { to: body.to, note: body.note, publish_at: body.publish_at }, {
      apply: async (to) => {
        if (to !== "cancelled") return 0;
        await closeSessionSeats(tx, session.id);
        const refunded = await refundCancelledSession(tx, ctx.user, session.id);
        tasks = refunded.tasks;
        return refunded.count;
      },
    });
    const row = (await tx.one<SessionRow>(`${SESSION_SELECT} WHERE s.id = $2`, [now, session.id]))!;
    return { session: sessionView(row, true), history: await history(tx, "session", session.id), refunds_started: moved.refunds, tasks };
  });
  await startTasks(result.tasks);
  return ok({ session: result.session, history: result.history, refunds_started: result.refunds_started });
});

route("GET", "/api/sessions/:id/history", ["curator"], async (ctx) => {
  if (!(await db.one("SELECT id FROM sessions WHERE id = $1", [ctx.params.id!]))) throw notFound();
  return ok({ history: await history(db, "session", ctx.params.id!) });
});
