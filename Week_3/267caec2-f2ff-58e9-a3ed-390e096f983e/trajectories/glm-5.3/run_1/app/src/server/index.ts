import { App } from "./app.js";
import { registerRoutes } from "./api/index.js";
import { createHttpServer } from "./http/server.js";
import { applySchema } from "./schema-apply.js";
import { applySeed } from "./domain/seed.js";
import { sendPendingEmails } from "./domain/mail.js";
import { buildJuryPacket, juryPacketKey } from "./domain/rounds.js";
import { rows } from "./db.js";
import { resultsEmail, enqueueEmail } from "./domain/mail.js";
import type { RoundRow } from "./domain/programs.js";

async function main(): Promise<void> {
  const app = App.fromEnv();
  const port = app.config.port;
  registerRoutes(app);

  // The server listens at once; Postgres is retried behind the health check.
  const server = await createHttpServer(app);
  server.listen(port, "0.0.0.0", () => {
    console.log(`cutline jury desk listening on 0.0.0.0:${port}`);
  });

  // Schema and seed: applied in the background until Postgres answers.
  void prepare(app);

  // Queued-email sender: delivers each queued email exactly once, retrying every 5s.
  setInterval(async () => {
    try {
      await sendPendingEmails(app.db, app.mailer);
    } catch {
      // Postgres or Mailpit unavailable; the next tick retries.
    }
  }, 5000);

  // Jury packet rewriter: retries open rounds with a pending packet change.
  setInterval(async () => {
    try {
      const dirty = await rows<RoundRow>(app.db, "SELECT * FROM rounds WHERE packet_dirty = true AND state = 'open'");
      for (const round of dirty) {
        try {
          const packet = await buildJuryPacket(app.db, round);
          await app.storage.put(juryPacketKey(round.id), Buffer.from(JSON.stringify(packet), "utf8"), "application/json");
          await app.db.query("UPDATE rounds SET packet_dirty = false WHERE id = $1", [round.id]);
        } catch {
          // Storage unreachable; retried on the next tick.
        }
      }
    } catch {
      // database unavailable on this tick
    }
  }, 5000);

  // Embargo watcher: queues each studio's results email once when the embargo passes.
  setInterval(async () => {
    try {
      const due = await rows<{
        id: string; name: string; program_id: string; embargo_at: Date; year: number; time_zone: string;
      }>(app.db, `
        SELECT c.id, c.name, c.program_id, c.embargo_at, p.year, p.time_zone FROM categories c
        JOIN programs p ON p.id = c.program_id
        WHERE c.published_at IS NOT NULL AND c.results_email_at IS NULL AND c.embargo_at <= now()
      `);
      for (const category of due) {
        await queueResultsEmails(app, category);
      }
    } catch {
      // database unavailable on this tick
    }
  }, 1000);

}

async function prepare(app: App): Promise<boolean> {
  for (;;) {
    try {
      await applySchema(app.db);
      await applySeed(app.db, app.storage);
      return true;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function queueResultsEmails(
  app: App,
  category: { id: string; name: string; program_id: string; embargo_at: Date; year: number; time_zone: string },
): Promise<void> {
  const outcomeStates = ["shortlisted", "eliminated", "final_round", "winner", "finalist", "honourable_mention", "published"];
  const entries = await rows<{
    id: string; entry_number: number; title: string; state: string; studio_id: string; email: string; award: string | null; final_score: string | null; r1_score: string | null;
  }>(app.db, `
    SELECT e.id, e.entry_number, e.title, e.state, e.studio_id, s.email, e.award, e.final_score, e.r1_score
    FROM entries e JOIN studios s ON s.id = e.studio_id
    WHERE e.category_id = $1 AND e.state = ANY($2)
    ORDER BY e.entry_number ASC
  `, [category.id, outcomeStates]);
  if (entries.length === 0) {
    await app.db.query("UPDATE categories SET results_email_at = $2 WHERE id = $1", [category.id, new Date()]);
    return;
  }
  await app.db.transaction(async (client) => {
    const claimed = await client.query<{ id: string }>(
      "UPDATE categories SET results_email_at = $2 WHERE id = $1 AND results_email_at IS NULL RETURNING id",
      [category.id, new Date()],
    );
    if (claimed.rows.length === 0) {
      return;
    }
    const byStudio = new Map<string, typeof entries>();
    for (const entry of entries) {
      byStudio.set(entry.studio_id, [...(byStudio.get(entry.studio_id) ?? []), entry]);
    }
    for (const studioEntries of byStudio.values()) {
      const lines = studioEntries.map((entry) => {
        const outcome =
          entry.state === "eliminated"
            ? "Not shortlisted"
            : entry.award === "winner"
              ? "Winner"
              : entry.award === "finalist"
                ? "Finalist"
                : "Honourable mention";
        const score = entry.state === "eliminated" ? entry.r1_score : entry.final_score;
        return { entryNumber: entry.entry_number, title: entry.title, outcome, score: score ?? "0.00" };
      });
      const email = resultsEmail(category.name, category.year, lines);
      // Queued at the embargo instant, delivered under the Mailpit timing rule.
      await enqueueEmail(client, "results", studioEntries[0].email, email.subject, email.body, new Date(category.embargo_at));
    }
  });
}

main().catch((error) => {
  console.error("failed to start", error);
  process.exit(1);
});
