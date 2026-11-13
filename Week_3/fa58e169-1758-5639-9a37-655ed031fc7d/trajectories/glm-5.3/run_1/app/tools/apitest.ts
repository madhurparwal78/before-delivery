/**
 * End-to-end API checks against a running server, using the grading setup route.
 * Every check prints ok or FAIL, and the script exits non-zero on failure.
 */
const BASE = process.env.TWINROW_URL ?? "http://127.0.0.1:4173";
const KEY = process.env.GRADING_KEY ?? "twinrow-grading-key-2027";
let failures = 0;

function expect(actual: unknown, wanted: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(wanted);
  if (a !== b) {
    failures++;
    console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  setCookie?: string;
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; key?: boolean } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.key) headers["x-grading-key"] = KEY;
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const setCookie = response.headers.get("set-cookie") ?? undefined;
  return { status: response.status, body, setCookie };
}

function cookieOf(response: Reply): string {
  const token = response.setCookie?.split(";")[0];
  return token ?? "";
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, ordered(item)] as const);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
  }
  return value;
}

async function main(): Promise<void> {
  const unique = Date.now().toString(36);
  const owner = `owner-${unique}@twinrow.test`;
  const coDesigner = `co-${unique}@twinrow.test`;
  const tester = `tester-${unique}@twinrow.test`;
  const other = `other-${unique}@twinrow.test`;

  // Setup.
  const setup = await call("/api/grading/setup", {
    method: "POST",
    key: true,
    body: {
      users: [
        { email: owner, name: "Asha Verma", password: "stitchcraft1", verified: true },
        { email: coDesigner, name: "Lena Holt", password: "stitchcraft2", verified: true },
        { email: tester, name: "Tomas Reed", password: "stitchcraft3", verified: true },
        { email: other, name: "Sam Ortiz", password: "stitchcraft4", verified: true },
      ],
      patterns: [
        {
          key: "rib",
          owner,
          name: "Rib swatch",
          craft: "knit",
          mode: "flat",
          terms: null,
          castOn: 10,
          width: 10,
          height: 2,
          rows: { 1: "k k p p k k p p k k", 2: "k k p p k k p p k k" },
          colours: [{ letter: "A", name: "Main", hex: "#dce8f7" }],
          colourRows: {},
          repeats: [],
          coDesigners: [coDesigner],
          versions: [
            {
              note: "first",
              rows: { 1: "k k p p k k p p k k", 2: "k k p p k k p p k k" },
              colourRows: {},
              height: 2,
              width: 10,
              castOn: 10,
              repeats: [],
              colours: [],
            },
          ],
          published: false,
          testers: [{ email: tester, version: 1, row: 1, notes: [{ row: 1, text: "Tight at the edge." }] }],
          invites: [{ email: other, sentHoursAgo: 0, status: "sent" }],
        },
      ],
    },
  });
  expect(setup.status, 200, "grading setup answers 200");
  const patternId = (setup.body.patterns as Record<string, string>)["rib"]!;

  // Health and config.
  const health = await call("/api/health");
  expect(health.status, 200, "health answers 200");
  expect(health.body, { status: "ok" }, "health body");

  const config = await call("/api/config");
  expect(config.status, 200, "config answers 200");
  expect(typeof (config.body.limits as Record<string, unknown>).maxChartCols, "number", "config limits");

  // Auth guards.
  const unauth = await call(`/api/patterns/${patternId}`);
  expect(unauth.status, 401, "unauthenticated pattern answers 401");
  expect(unauth.body, { error: "unauthenticated" }, "unauthenticated body");

  const stranger = await call("/api/session", {
    method: "POST",
    body: { email: other, password: "stitchcraft4" },
  });
  expect(stranger.status, 200, "sign-in answers 200");
  const strangerCookie = cookieOf(stranger);

  const denied = await call(`/api/patterns/${patternId}`, { cookie: strangerCookie });
  expect(denied.status, 404, "stranger pattern answers 404");
  expect(denied.body, { error: "not_found" }, "stranger body");

  const publicDenied = await call(`/api/public/${patternId}`);
  expect(publicDenied.status, 404, "unpublished public answers 404");

  // Owner reads the pattern.
  const ownerSession = await call("/api/session", { method: "POST", body: { email: owner, password: "stitchcraft1" } });
  expect(ownerSession.status, 200, "owner signs in");
  const ownerCookie = cookieOf(ownerSession);

  const pattern = await call(`/api/patterns/${patternId}`, { cookie: ownerCookie });
  expect(pattern.status, 200, "owner reads pattern");
  const rows = pattern.body.rows as { text: string; errors: string[]; state: string; notes: number }[];
  expect(
    rows.map((row) => row.text),
    [
      "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)",
      "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)",
    ],
    "rib lines",
  );
  expect(rows.every((row) => row.errors.length === 0 && row.state === "ok"), true, "rib rows are ok");
  expect(rows[0]!.notes, 1, "row note count");

  // Tester access rules.
  const testerSession = await call("/api/session", { method: "POST", body: { email: tester, password: "stitchcraft3" } });
  expect(testerSession.status, 200, "tester signs in");
  const testerCookie = cookieOf(testerSession);
  const testerDenied = await call(`/api/patterns/${patternId}`, { cookie: testerCookie });
  expect(testerDenied.status, 404, "tester cannot open the designer page data");

  const follow = await call(`/api/patterns/${patternId}/follow`, { cookie: testerCookie });
  expect(follow.status, 200, "tester opens follow data");
  expect(follow.body.version, 1, "follow version");
  expect(follow.body.latestVersion, 1, "follow latest version");

  const followDenied = await call(`/api/patterns/${patternId}/follow`, { cookie: ownerCookie });
  expect(followDenied.status, 404, "owner cannot call the follow route");

  // Shared counter.
  const step = await call(`/api/patterns/${patternId}/counter`, {
    method: "POST",
    cookie: testerCookie,
    body: { from: 1, step: 1, stepId: `s-${unique}` },
  });
  expect(step.status, 200, "counter steps");
  expect(step.body, { row: 2 }, "counter row");

  const replay = await call(`/api/patterns/${patternId}/counter`, {
    method: "POST",
    cookie: testerCookie,
    body: { from: 1, step: 1, stepId: `s-${unique}` },
  });
  expect(replay.body, { row: 2 }, "replayed step changes nothing");

  const stale = await call(`/api/patterns/${patternId}/counter`, {
    method: "POST",
    cookie: testerCookie,
    body: { from: 1, step: 1, stepId: `s2-${unique}` },
  });
  expect(stale.body, { row: 2 }, "stale from-row changes nothing");

  const pastEnd = await call(`/api/patterns/${patternId}/counter`, {
    method: "POST",
    cookie: testerCookie,
    body: { from: 2, step: 1, stepId: `s3-${unique}` },
  });
  expect(pastEnd.body, { row: 2 }, "step past the last row changes nothing");

  // Notes.
  const note = await call(`/api/patterns/${patternId}/notes`, {
    method: "POST",
    cookie: testerCookie,
    body: { row: 2, text: "Look here." },
  });
  expect(note.status, 201, "note saves");

  const ownerNotes = await call(`/api/patterns/${patternId}/notes`, { cookie: ownerCookie });
  expect((ownerNotes.body.notes as unknown[]).length, 2, "owner sees both notes");

  const testerNotes = await call(`/api/patterns/${patternId}/notes`, { cookie: testerCookie });
  expect((testerNotes.body.notes as unknown[]).length, 2, "tester sees own notes only");

  // Versions, restore, compare.
  const versions = await call(`/api/patterns/${patternId}/versions`, { cookie: ownerCookie });
  expect((versions.body.versions as unknown[]).length, 1, "one version");

  const saved = await call(`/api/patterns/${patternId}/versions`, {
    method: "POST",
    cookie: ownerCookie,
    body: { note: "second" },
  });
  expect(saved.status, 201, "version saves");
  expect(saved.body.version, 2, "version number");

  const restore = await call(`/api/patterns/${patternId}/versions/1/restore`, {
    method: "POST",
    cookie: ownerCookie,
  });
  expect(restore.status, 201, "restore answers 201");
  expect(restore.body, { version: 3, restoredFrom: 1 }, "restore makes version 3");

  const compare = await call(`/api/patterns/${patternId}/compare?a=1&b=2`, { cookie: ownerCookie });
  expect(compare.status, 200, "compare answers 200");
  expect(typeof compare.body.summary, "string", "compare summary");

  // Publish.
  const publish = await call(`/api/patterns/${patternId}/publish`, { method: "POST", cookie: ownerCookie });
  expect(publish.status, 200, "publish answers 200");
  expect(publish.body.state, "published", "publish state");

  const publicPage = await call(`/api/public/${patternId}`);
  expect(publicPage.status, 200, "public page answers 200");
  expect((publicPage.body.rows as unknown[]).every((row) => !("notes" in (row as object))), true, "public rows carry no notes");

  const sheet = await fetch(`${BASE}/api/patterns/${patternId}/sheet.pdf`);
  expect(sheet.status, 200, "sheet answers 200");
  expect(sheet.headers.get("content-type"), "application/pdf", "sheet content type");

  // Text route.
  const coSession = await call("/api/session", { method: "POST", body: { email: coDesigner, password: "stitchcraft2" } });
  expect(coSession.status, 200, "co-designer signs in");
  const coCookie = cookieOf(coSession);

  const textOk = await call(`/api/patterns/${patternId}/text`, {
    method: "POST",
    cookie: coCookie,
    body: { row: 1, text: "k4, p6." },
  });
  expect(textOk.status, 200, "text applies");
  expect(textOk.body.changed, 6, "text changed cell count");

  const textBad = await call(`/api/patterns/${patternId}/text`, {
    method: "POST",
    cookie: coCookie,
    body: { row: 1, text: "k2, k2t." },
  });
  expect(textBad.status, 422, "text error answers 422");
  expect(textBad.body.field, "text", "text error field");
  expect(String(textBad.body.message).includes('unknown stitch "k2t"'), true, "unknown stitch message");

  // Conflicts.
  const fresh = await call(`/api/patterns/${patternId}`, { cookie: ownerCookie });
  const cells = fresh.body.cells as { row: number; col: number; stitch: string; colour: string; rev: number }[];
  const target = cells.find((cell) => cell.row === 1 && cell.col === 1)!;
  const first = await call(`/api/patterns/${patternId}/cells`, {
    method: "POST",
    cookie: ownerCookie,
    body: { opId: `c-${unique}-1`, cells: [{ row: 1, col: 1, stitch: "p", colour: "A", rev: target.rev }] },
  });
  expect(first.status, 200, "first edit applies");
  const staleEdit = await call(`/api/patterns/${patternId}/cells`, {
    method: "POST",
    cookie: coCookie,
    body: { opId: `c-${unique}-2`, cells: [{ row: 1, col: 1, stitch: "yo", colour: "A", rev: target.rev }] },
  });
  expect(staleEdit.status, 200, "stale edit answers 200");
  expect((staleEdit.body.conflicts as unknown[]).length, 1, "stale edit conflicts");

  const replayOp = await call(`/api/patterns/${patternId}/cells`, {
    method: "POST",
    cookie: ownerCookie,
    body: { opId: `c-${unique}-1`, cells: [{ row: 1, col: 1, stitch: "yo", colour: "A", rev: 99 }] },
  });
  expect(replayOp.status, 200, "replayed opId answers 200");
  expect(JSON.stringify(ordered(replayOp.body)), JSON.stringify(ordered(first.body)), "replayed opId returns the first answer");

  // Invitations.
  const inviteList = await call("/api/config");
  expect(inviteList.status, 200, "config reachable");

  // A wrong grading key answers 404.
  const wrongKey = await call("/api/grading/setup", { method: "POST", body: {}, key: false });
  expect(wrongKey.status, 404, "grading without key answers 404");

  // Error order: unauthenticated before not found.
  const badPath = await call("/api/patterns/does-not-exist");
  expect(badPath.status, 401, "unauthenticated wins over not found");

  // Publish refusal with row errors.
  const brokenPattern = await call("/api/patterns", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "Broken", kind: "Flat knitting", rows: 2, columns: 4, castOn: 4 },
  });
  const brokenId = (brokenPattern.body as { id: string }).id;
  expect(brokenPattern.status, 201, "broken pattern created");
  const brokenCells = [
    { row: 1, col: 4, stitch: "k", colour: "A", rev: 1 },
    { row: 1, col: 3, stitch: "k", colour: "A", rev: 1 },
    { row: 1, col: 2, stitch: "k", colour: "A", rev: 1 },
    { row: 1, col: 1, stitch: "k", colour: "A", rev: 1 },
  ];
  const brokenEdit = await call(`/api/patterns/${brokenId}/cells`, {
    method: "POST",
    cookie: ownerCookie,
    body: { opId: `b-${unique}`, cells: brokenCells },
  });
  expect(brokenEdit.status, 200, "broken edit applies");
  const brokenSave = await call(`/api/patterns/${brokenId}/versions`, {
    method: "POST",
    cookie: ownerCookie,
    body: { note: "" },
  });
  expect(brokenSave.status, 201, "broken version saves");
  const brokenPublish = await call(`/api/patterns/${brokenId}/publish`, {
    method: "POST",
    cookie: ownerCookie,
  });
  expect(brokenPublish.status, 200, "balanced broken pattern publishes");

  // Sample pattern.
  const sample = await call("/api/patterns", {
    method: "POST",
    cookie: ownerCookie,
    body: { sample: true },
  });
  expect(sample.status, 201, "sample creates");
  const sampleRead = await call(`/api/patterns/${(sample.body as { id: string }).id}`, { cookie: ownerCookie });
  const sampleRows = sampleRead.body.rows as { text: string }[];
  expect(sampleRows[2]!.text, "Row 3 (RS): k1, ssk, k6, k2tog, k1. (10 sts)", "sample shaping row 3");

  // Body boundary checks run before the error order.
  const badJson = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops",
  });
  expect(badJson.status, 422, "malformed json answers 422");
  expect(await badJson.json(), { error: "invalid", field: "body", message: "The request body is not valid JSON." }, "malformed json body");

  const wrongType = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "x=1",
  });
  expect(wrongType.status, 415, "wrong content type answers 415");
  expect(await wrongType.json(), { error: "unsupported_media_type" }, "wrong content type body");

  const tooLarge = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `{"x":"${"a".repeat(1_100_000)}"}`,
  });
  expect(tooLarge.status, 413, "oversized body answers 413");
  expect(await tooLarge.json(), { error: "too_large" }, "oversized body shape");

  const exactlyAllowed = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `{"x":"${"a".repeat(900_000)}"}`,
  });
  expect(exactlyAllowed.status, 401, "an allowed size reaches the error order");

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
