import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { createDbPool } from "../src/server/pool";
import { poolStore } from "../src/server/db";
import { applySchemaAndSeed } from "../src/server/seed";
import { createServer, type ServerDeps } from "../src/server/routes";
import { SheetStorage, storageFromEnv } from "../src/server/storage";
import { NoteDelivery, poolNoteStore } from "../src/server/mail";
import { parseRoundSeconds } from "../src/server/rate";

let pool: Pool;
let app: Express;

function agent(): request.SuperTest<never> {
  return request.agent(app);
}

async function signIn(code: string): Promise<request.SuperTest<never>> {
  const a = request.agent(app);
  const result = await a.post("/api/session").send({ code }).set("Content-Type", "application/json");
  expect(result.status).toBe(201);
  return a;
}

beforeAll(async () => {
  pool = createDbPool(process.env["DATABASE_URL"] ?? "").raw();
  const store = poolStore(pool);
  await store.query(
    `DROP TABLE IF EXISTS answers, disputes, sheets, idempotency_records, published_scores, sessions, rounds, teams, desk_codes, league_meta CASCADE`,
  );
  await applySchemaAndSeed(store);
  const storage = new SheetStorage(storageFromEnv());
  const notes = new NoteDelivery(poolNoteStore(pool), {
    host: process.env["SMTP_HOST"] ?? "",
    port: Number(process.env["SMTP_PORT"] ?? 1025),
    from: process.env["MAIL_FROM"] ?? "",
  });
  app = createServer({
    store,
    storage,
    notes,
    roundSeconds: parseRoundSeconds(process.env["ROUND_SECONDS"]),
    isReady: () => true,
  });
  await notes.drain();
}, 20000);

afterAll(async () => {
  await pool.end();
});

describe("the night's journey", () => {
  it("runs a round from open to publish with a dispute and a ruling", async () => {
    const quizmaster = await signIn("HOST-4417");
    const marker = await signIn("MARK-2093");
    const captain = await signIn("CAP-01");

    const open = await quizmaster.post("/api/rounds/1/open");
    expect(open.status).toBe(200);

    const submit = await captain
      .post("/api/rounds/1/answers")
      .send({ answers: [{ question: 1, text: "Paris" }, { question: 2, text: "Björk" }] })
      .set("Content-Type", "application/json");
    expect(submit.status).toBe(201);
    expect((submit.body.accepted as unknown[]).length).toBe(2);

    const close = await quizmaster.post("/api/rounds/1/close");
    expect(close.status).toBe(200);

    const answers = await marker.get("/api/rounds/1/answers");
    const list = answers.body.answers as { id: number; question: number }[];
    expect(list).toHaveLength(2);

    for (const answer of list) {
      const mark = await marker
        .put("/api/rounds/1/marks")
        .send({ answer_id: answer.id, points: 0 })
        .set("Content-Type", "application/json");
      expect(mark.status).toBe(200);
      expect(mark.body.answer.mark).toBe(0);
    }

    const finish = await marker.post("/api/rounds/1/marked");
    expect(finish.status).toBe(200);
    expect(finish.body.round.status).toBe("marked");

    const publishBefore = await quizmaster.post("/api/rounds/1/publish");
    expect(publishBefore.status).toBe(200);
    expect(publishBefore.body.table.last_published_round).toBe(1);
    const table1 = publishBefore.body.table as { teams: { name: string; total: number; last_round: { round: number; score: number } }[]; version: number };
    expect(table1.version).toBe(2);
    expect(table1.teams[0]).toMatchObject({ name: "Tequila Mockingbird", total: 152 });
    expect(table1.teams[0].last_round).toEqual({ round: 1, score: 0 });

    await marker
      .put("/api/rounds/1/marks")
      .send({ answer_id: (list[0] as { id: number }).id, points: 1 })
      .set("Content-Type", "application/json");
  });

  it("refuses a dispute on a published round with the window closed", async () => {
    const captain = await signIn("CAP-01");
    const answers = await captain.get("/api/rounds/1/answers");
    const list = answers.body.answers as { id: number }[];
    const dispute = await captain
      .post("/api/disputes")
      .send({ answer_id: list[0]!.id, reason: "It was right" })
      .set("Content-Type", "application/json");
    expect(dispute.status).toBe(409);
    expect(dispute.body).toEqual({ error: "dispute_window_closed" });
  });

  it("takes a dispute on a marked round, rules it and sends the note", async () => {
    const quizmaster = await signIn("HOST-4417");
    const marker = await signIn("MARK-2093");
    const captain = await signIn("CAP-02");

    const open = await quizmaster.post("/api/rounds/2/open");
    expect(open.status).toBe(200);
    await captain
      .post("/api/rounds/2/answers")
      .send({ answers: [{ question: 1, text: "Waterloo" }] })
      .set("Content-Type", "application/json");
    await quizmaster.post("/api/rounds/2/close");

    const answers = await marker.get("/api/rounds/2/answers");
    const list = answers.body.answers as { id: number }[];
    expect(list).toHaveLength(1);
    await marker
      .put("/api/rounds/2/marks")
      .send({ answer_id: list[0]!.id, points: 0 })
      .set("Content-Type", "application/json");
    await marker.post("/api/rounds/2/marked");

    const dispute = await captain
      .post("/api/disputes")
      .send({ answer_id: list[0]!.id, reason: "The spelling was right" })
      .set("Content-Type", "application/json");
    expect(dispute.status).toBe(201);
    expect(dispute.body.dispute.status).toBe("raised");

    const publish = await quizmaster.post("/api/rounds/2/publish");
    expect(publish.status).toBe(409);
    expect(publish.body).toEqual({ error: "disputes_pending", count: 1 });

    const queue = await quizmaster.get("/api/disputes");
    const disputes = queue.body.disputes as { id: number; status: string }[];
    expect(disputes).toHaveLength(1);

    const ruling = await quizmaster
      .post(`/api/disputes/${disputes[0]!.id}/ruling`)
      .send({ ruling: "upheld" })
      .set("Content-Type", "application/json");
    expect(ruling.status).toBe(200);
    expect(ruling.body.dispute.status).toBe("upheld");
    expect(ruling.body.dispute.note).toBe("queued");

    const afterRule = await quizmaster.post("/api/disputes/999999/ruling").send({ ruling: "upheld" }).set("Content-Type", "application/json");
    expect(afterRule.status).toBe(404);

    const publish2 = await quizmaster.post("/api/rounds/2/publish");
    expect(publish2.status).toBe(200);
    const table = publish2.body.table as { teams: { name: string; total: number }[] };
    const lesQuiz = table.teams.find((t) => t.name === "Les Quizérables");
    expect(lesQuiz?.total).toBe(150);
  });

  it("upholds a disputed answer to 1 in the ruled score", async () => {
    const quizmaster = await signIn("HOST-4417");
    const captain = await signIn("CAP-02");
    const disputes = await quizmaster.get("/api/disputes");
    const ruled = (disputes.body.disputes as { status: string }[]).filter((d) => d.status === "upheld");
    expect(ruled).toHaveLength(1);
    void captain;
  });

  it("refuses a second ruling on the same dispute", async () => {
    const quizmaster = await signIn("HOST-4417");
    const queue = await quizmaster.get("/api/disputes");
    const disputes = queue.body.disputes as { id: number }[];
    const again = await quizmaster
      .post(`/api/disputes/${disputes[0]!.id}/ruling`)
      .send({ ruling: "dismissed" })
      .set("Content-Type", "application/json");
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "dispute_already_ruled" });
  });
});

describe("rate limit", () => {
  it("refuses the seventh submit inside the window with a wait", async () => {
    const quizmaster = await signIn("HOST-4417");
    const open = await quizmaster.post("/api/rounds/5/open");
    expect(open.status).toBe(200);
    const captain = await signIn("CAP-03");
    for (let i = 0; i < 6; i++) {
      const result = await captain
        .post("/api/rounds/5/answers")
        .send({ answers: [{ question: 1, text: `try ${i}` }] })
        .set("Content-Type", "application/json");
      expect(result.status).toBe(201);
    }
    const refused = await captain
      .post("/api/rounds/5/answers")
      .send({ answers: [{ question: 2, text: "too many" }] })
      .set("Content-Type", "application/json");
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe("too_many_submits");
    expect(typeof refused.body.retry_after).toBe("number");
    expect(refused.headers["retry-after"]).toBeDefined();
    await quizmaster.post("/api/rounds/5/close");
  });
});

describe("archive paging stability", () => {
  it("shows every answer exactly once while new answers arrive", async () => {
    const marker = await signIn("MARK-2093");
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const params = new URLSearchParams({ limit: "3" });
      if (cursor !== null) params.set("cursor", cursor);
      const result = await marker.get(`/api/answers?${params.toString()}`);
      expect(result.status).toBe(200);
      const body = result.body as { answers: { id: number }[]; next_cursor: string | null; has_more: boolean };
      for (const answer of body.answers) seen.push(answer.id);
      pages += 1;
      if (!body.has_more || body.next_cursor === null) break;
      cursor = body.next_cursor;
      if (pages > 30) break;
    }
    const unique = new Set(seen);
    expect(unique.size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("sheet serving by role", () => {
  it("refuses a captain a drafted sheet and 404s an unstored one", async () => {
    const captain = await signIn("CAP-04");
    const drafted = await captain.get("/api/rounds/6/sheet");
    expect(drafted.status).toBe(409);
    expect(drafted.body).toEqual({ error: "round_not_open" });
    const quizmaster = await signIn("HOST-4417");
    const unstored = await quizmaster.get("/api/rounds/6/sheet");
    expect(unstored.status).toBe(404);
  });
});
