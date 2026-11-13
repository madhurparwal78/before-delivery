import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createDbPool } from "../src/server/pool";
import { poolStore } from "../src/server/db";
import { applySchemaAndSeed } from "../src/server/seed";
import { createServer, type ServerDeps } from "../src/server/routes";
import { SheetStorage, storageFromEnv } from "../src/server/storage";
import { NoteDelivery, poolNoteStore } from "../src/server/mail";
import { parseRoundSeconds } from "../src/server/rate";
import type { Pool } from "pg";
import request from "supertest";

interface Agent {
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  delete(path: string): request.Test;
  raw(): request.SuperTest<never>;
}

function agentFor(app: Express): Agent {
  const agent = request.agent(app);
  const wrapped: Agent = {
    get: (path) => agent.get(path),
    post: (path, body) =>
      agent.post(path).send(body ?? {}).set("Content-Type", "application/json"),
    put: (path, body) =>
      body === undefined ? agent.put(path) : agent.put(path).send(body).set("Content-Type", "application/json"),
    patch: (path, body) =>
      body === undefined ? agent.patch(path) : agent.patch(path).send(body).set("Content-Type", "application/json"),
    delete: (path) => agent.delete(path),
    raw: () => agent,
  };
  return wrapped;
}

function postWithKey(agent: Agent, path: string, body: unknown, key: string): request.Test {
  return agent
    .raw()
    .post(path)
    .send(body)
    .set("Content-Type", "application/json")
    .set("Idempotency-Key", key);
}

let pool: Pool;
let app: Express;
let deps: ServerDeps;

function pngBytes(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

beforeAll(async () => {
  pool = createDbPool(process.env["DATABASE_URL"] ?? "").raw();
  const store = poolStore(pool);
  await resetDatabase(store);
  const storage = new SheetStorage(storageFromEnv());
  const notes = new NoteDelivery(poolNoteStore(pool), {
    host: process.env["SMTP_HOST"] ?? "",
    port: Number(process.env["SMTP_PORT"] ?? 1025),
    from: process.env["MAIL_FROM"] ?? "",
  });
  deps = {
    store,
    storage,
    notes,
    roundSeconds: parseRoundSeconds(process.env["ROUND_SECONDS"]),
    isReady: () => true,
  };
  app = createServer(deps);
}, 20000);

afterAll(async () => {
  await pool.end();
});

async function resetDatabase(store: ReturnType<typeof poolStore>): Promise<void> {
  await store.query(`DROP TABLE IF EXISTS answers, disputes, sheets, idempotency_records, published_scores, sessions, rounds, teams, desk_codes, league_meta CASCADE`);
  await applySchemaAndSeed(store);
}

describe("sign-in and sessions", () => {
  it("signs in with a seeded quizmaster desk code", async () => {
    const quizmaster = agentFor(app);
    const result = await quizmaster.post("/api/session", { code: "HOST-4417" });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ role: "quizmaster", team_id: null, team_name: null });
  });

  it("refuses an unknown code with 401 bad_code", async () => {
    const anon = agentFor(app);
    const result = await anon.post("/api/session", { code: "NOPE-0000" });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "bad_code" });
  });

  it("signs a captain in with their team", async () => {
    const captain = agentFor(app);
    const result = await captain.post("/api/session", { code: "CAP-01" });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ role: "captain", team_id: 1, team_name: "Tequila Mockingbird" });
  });

  it("refuses desk requests without a session with 401", async () => {
    const anon = agentFor(app);
    const result = await anon.get("/api/rounds/1/answers");
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "signed_out" });
  });
});

describe("published boundary", () => {
  it("answers unknown API routes with 404", async () => {
    const anon = agentFor(app);
    const result = await anon.get("/api/nope");
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "not_found" });
  });

  it("answers wrong methods with 405 and Allow", async () => {
    const anon = agentFor(app);
    const result = await anon.patch("/api/rounds");
    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "method_not_allowed" });
    expect(result.headers["allow"]).toContain("GET");
  });

  it("refuses wrong content types with 415", async () => {
    const anon = agentFor(app);
    const result = await request(app).post("/api/session").send("code=x").set("Content-Type", "text/plain");
    expect(result.status).toBe(415);
    expect(result.body).toEqual({ error: "unsupported_media_type" });
  });

  it("refuses malformed JSON with 400", async () => {
    const result = await request(app).post("/api/session").send("{nope").set("Content-Type", "application/json");
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "bad_json" });
  });
});

describe("round machine", () => {
  it("opens a drafted round and closes it again", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const open = await quizmaster.post("/api/rounds/1/open");
    expect(open.status).toBe(200);
    expect(open.body.round.status).toBe("open");
    expect(typeof open.body.round.seconds_left).toBe("number");
    const close = await quizmaster.post("/api/rounds/1/close");
    expect(close.status).toBe(200);
    expect(close.body.round.status).toBe("closed");
  });

  it("refuses opening a round that is not drafted", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const result = await quizmaster.post("/api/rounds/1/open");
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "round_not_drafted" });
  });

  it("refuses opening a second round while one is open", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    await quizmaster.post("/api/rounds/2/open");
    const result = await quizmaster.post("/api/rounds/3/open");
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "another_round_open" });
    await quizmaster.post("/api/rounds/2/close");
  });

  it("refuses marking until every answer carries a mark", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-02" });
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const open = await quizmaster.post("/api/rounds/4/open");
    expect(open.status).toBe(200);
    const submit = await captain.post("/api/rounds/4/answers", { answers: [{ question: 1, text: "history" }] });
    expect(submit.status).toBe(201);
    const close = await quizmaster.post("/api/rounds/4/close");
    expect(close.status).toBe(200);
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const finish = await marker.post("/api/rounds/4/marked");
    expect(finish.status).toBe(409);
    expect(finish.body.error).toBe("unmarked_answers");
    expect(finish.body.count).toBeGreaterThan(0);
  });
});

describe("sheets", () => {
  it("uploads a valid sheet and stores it", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const result = await quizmaster.put("/api/rounds/3/sheet").send(pngBytes(200, 200)).set("Content-Type", "image/png");
    expect(result.status).toBe(201);
    expect(result.body.round.sheet.status).toBe("stored");
    expect(result.body.round.sheet.width).toBe(200);
  });

  it("refuses a sheet with wrong bytes for its declared type", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const result = await quizmaster.put("/api/rounds/6/sheet").send(pngBytes(200, 200)).set("Content-Type", "image/jpeg");
    expect(result.status).toBe(415);
    expect(result.body).toEqual({ error: "unsupported_media_type" });
  });

  it("refuses a sheet outside the pixel range", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const result = await quizmaster.put("/api/rounds/6/sheet").send(pngBytes(150, 200)).set("Content-Type", "image/png");
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "invalid", fields: { body: "invalid" } });
  });

  it("refuses an empty body with required", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const result = await quizmaster.put("/api/rounds/6/sheet").send(Buffer.alloc(0)).set("Content-Type", "image/png");
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "invalid", fields: { body: "required" } });
  });

  it("refuses opening a picture round with no sheet stored", async () => {
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const result = await quizmaster.post("/api/rounds/6/open");
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "sheet_not_stored" });
  });
});

describe("answers and marks", () => {
  it("stores answers as typed and shows the latest as current", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-01" });
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    const open = await quizmaster.post("/api/rounds/5/open");
    expect(open.status).toBe(200);
    await captain.post("/api/rounds/5/answers", { answers: [{ question: 1, text: "  first  " }] });
    await captain.post("/api/rounds/5/answers", { answers: [{ question: 1, text: "second" }] });
    const list = await captain.get("/api/rounds/5/answers");
    expect(list.status).toBe(200);
    const answers = list.body.answers as { text: string; current: boolean; mark: number | null }[];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ text: "second", current: true, mark: null, ruled: null });
    await quizmaster.post("/api/rounds/5/close");
  });

  it("refuses a submit on a closed round", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-01" });
    const result = await captain.post("/api/rounds/5/answers", { answers: [{ question: 2, text: "late" }] });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "round_closed" });
  });

  it("rejects over-long answers field by field", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-01" });
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    await quizmaster.post("/api/rounds/7/open");
    const long = "x".repeat(121);
    const result = await captain.post("/api/rounds/7/answers", { answers: [{ question: 1, text: long }] });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "invalid", fields: { question_1: "too_long" } });
    await quizmaster.post("/api/rounds/7/close");
  });

  it("keeps marks off the answer text", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const list = await marker.get("/api/rounds/5/answers");
    expect(list.status).toBe(200);
    const answers = list.body.answers as { id: number; text: string }[];
    expect(answers.length).toBeGreaterThan(0);
    const mark = await marker.put("/api/rounds/5/marks", { answer_id: answers[0]!.id, points: 1 });
    expect(mark.status).toBe(200);
    expect(mark.body.answer.text).toBe(answers[0]!.text);
    expect(mark.body.answer.mark).toBe(1);
  });
});

describe("idempotency", () => {
  it("replays a stored response for the same key and body", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-03" });
    const quizmaster = agentFor(app);
    await quizmaster.post("/api/session", { code: "HOST-4417" });
    await quizmaster.post("/api/rounds/8/open");
    const body = { answers: [{ question: 1, text: "idem" }] };
    const one = await postWithKey(captain, "/api/rounds/8/answers", body, "key-1");
    expect(one.status).toBe(201);
    const two = await postWithKey(captain, "/api/rounds/8/answers", body, "key-1");
    expect(two.status).toBe(201);
    expect(two.headers["idempotent-replayed"]).toBe("true");
    expect((two.body.accepted as unknown[]).length).toBe((one.body.accepted as unknown[]).length);
    await quizmaster.post("/api/rounds/8/close");
  });

  it("refuses the same key with a different body", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-03" });
    const other = { answers: [{ question: 2, text: "different" }] };
    const result = await postWithKey(captain, "/api/rounds/8/answers", other, "key-1");
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "idempotency_conflict" });
  });
});

describe("search", () => {
  it("finds answers ignoring case and accents", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const result = await marker.post("/api/answers/search", { query: "bjork" });
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(0);
  });

  it("refuses an empty query", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const result = await marker.post("/api/answers/search", { query: "   " });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "invalid", fields: { query: "required" } });
  });

  it("refuses a body nested too deeply", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const result = await marker.post("/api/answers/search", { query: { deep: { deeper: { deepest: {} } } } });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "invalid", fields: { body: "too_deep" } });
  });
});

describe("table", () => {
  it("derives positions from published totals with the tie rule", async () => {
    const anon = agentFor(app);
    const result = await anon.get("/api/table");
    expect(result.status).toBe(200);
    expect(result.body.night).toBe(4);
    expect(result.body.version).toBe(1);
    const teams = result.body.teams as { position: number; name: string; total: number }[];
    expect(teams[0]).toMatchObject({ position: 1, name: "Tequila Mockingbird", total: 152 });
    expect(teams[2]).toMatchObject({ position: 3, name: "Sherlock Ohms", total: 145 });
    expect(teams[3]).toMatchObject({ position: 4, name: "The Quizzly Bears", total: 145 });
  });
});

describe("role permissions", () => {
  it("refuses a captain opening a round", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-04" });
    const result = await captain.post("/api/rounds/4/open");
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "forbidden" });
  });

  it("refuses the marker opening a round", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const result = await marker.post("/api/rounds/4/open");
    expect(result.status).toBe(403);
  });

  it("lets a captain see only their own team's answers", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-05" });
    const list = await captain.get("/api/rounds/5/answers");
    expect(list.status).toBe(200);
    const answers = list.body.answers as { team_id: number }[];
    for (const answer of answers) {
      expect(answer.team_id).toBe(5);
    }
  });
});

describe("archive paging", () => {
  it("serves the default page size and honours the cap", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const first = await marker.get("/api/answers");
    expect(first.status).toBe(200);
    expect(first.body.limit).toBe(25);
    expect(first.body.answers.length).toBeLessThanOrEqual(25);
    const capped = await marker.get("/api/answers?limit=500");
    expect(capped.body.limit).toBe(100);
    const bad = await marker.get("/api/answers?limit=0");
    expect(bad.status).toBe(422);
    expect(bad.body).toEqual({ error: "invalid", fields: { limit: "invalid" } });
  });

  it("refuses an unreadable cursor", async () => {
    const marker = agentFor(app);
    await marker.post("/api/session", { code: "MARK-2093" });
    const result = await marker.get("/api/answers?cursor=zzzz");
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "invalid", fields: { cursor: "invalid" } });
  });
});

describe("teams", () => {
  it("renames a team and refuses a taken name", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-06" });
    const rename = await captain.patch("/api/teams/6", { name: "A New Name" });
    expect(rename.status).toBe(200);
    expect(rename.body.team.name).toBe("A New Name");
    const taken = await captain.patch("/api/teams/6", { name: "tequila mockingbird" });
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: "name_taken" });
  });

  it("refuses a captain renaming another team", async () => {
    const captain = agentFor(app);
    await captain.post("/api/session", { code: "CAP-06" });
    const result = await captain.patch("/api/teams/7", { name: "Not Mine" });
    expect(result.status).toBe(403);
  });
});
