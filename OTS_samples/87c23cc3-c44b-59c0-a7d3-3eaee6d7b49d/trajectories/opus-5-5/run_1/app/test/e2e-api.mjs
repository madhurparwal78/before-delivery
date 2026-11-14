// End-to-end API checks against a running server and its real services.
// Run: BASE=http://127.0.0.1:4173 node test/e2e-api.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
const KEY = process.env.JOINERY_GRADING_KEY ?? "grading-key-7c41e9";
const unique = Date.now().toString(36);

async function call(method, path, { session, body, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (session) init.headers.cookie = `joinery_session=${session}`;
  if (raw !== undefined) {
    init.body = raw;
    init.headers["content-type"] ??= "application/sql";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const res = await fetch(BASE + path, init);
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.log(`not ok - ${name}`);
    console.log(error);
    process.exitCode = 1;
  }
};

const example1 = `entity authors {
  id int [key, auto]
  name varchar(80) [required]
}

entity books {
  id int [key, auto]
  title text [required]
  author_id int [required]
}
link books.author_id >- authors.id
`;

const setup = await call("POST", "/api/grading/setup", {
  headers: { "x-grading-key": KEY },
  body: {
    users: [
      { ref: "owner", email: `ada-${unique}@example.test`, displayName: "Ada Okafor" },
      { ref: "editor", email: `ben-${unique}@example.test`, displayName: "Ben Ito" },
      { ref: "viewer", email: `cy-${unique}@example.test`, displayName: "Cy Vale" },
      { ref: "stranger", email: `dee-${unique}@example.test`, displayName: "Dee Moss" },
    ],
    projects: [
      {
        ref: "p1",
        owner: "owner",
        name: "Library Loans",
        text: example1,
        versions: [{ name: "First cut" }],
        members: [
          { user: "editor", role: "editor" },
          { user: "viewer", role: "viewer" },
        ],
        shares: [
          { ref: "view", access: "view" },
          { ref: "edit", access: "edit" },
        ],
      },
    ],
  },
});
assert.equal(setup.status, 201, JSON.stringify(setup.data));
const S = Object.fromEntries(Object.entries(setup.data.users).map(([k, v]) => [k, v.session]));
const pid = setup.data.projects.p1.id;

await step("grading key guard", async () => {
  const r = await call("POST", "/api/grading/setup", { headers: { "x-grading-key": "nope" }, body: {} });
  assert.equal(r.status, 404);
  assert.deepEqual(r.data, { error: "not_found", message: "Nothing is here." });
});

await step("project access by role", async () => {
  const owner = await call("GET", `/api/projects/${pid}`, { session: S.owner });
  assert.equal(owner.status, 200);
  assert.equal(owner.data.role, "owner");
  assert.equal(owner.data.revision, 1);
  assert.deepEqual(owner.data.layout.entities.authors, { x: 0, y: 0, color: "slate" });
  assert.deepEqual(owner.data.layout.entities.books, { x: 14, y: 0, color: "slate" });
  assert.equal((await call("GET", `/api/projects/${pid}`, { session: S.viewer })).data.role, "viewer");
  assert.equal((await call("GET", `/api/projects/${pid}`, { session: S.stranger })).status, 404);
  assert.equal((await call("GET", `/api/projects/${pid}`)).status, 401);
  assert.equal((await call("GET", `/api/projects/not-a-uuid`, { session: S.owner })).status, 404);
  const list = await call("GET", "/api/projects", { session: S.editor });
  assert.equal(list.data.shared[0].entityCount, 2);
});

let ws;
const messages = [];
await step("live channel hello", async () => {
  ws = new WebSocket(`${BASE.replace("http", "ws")}/api/projects/${pid}/live`, { headers: { cookie: `joinery_session=${S.owner}` } });
  ws.onmessage = (e) => messages.push(JSON.parse(e.data));
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(messages[0].type, "hello");
  assert.equal(messages[0].access, "owner");
});

await step("viewer cannot write", async () => {
  const r = await call("POST", `/api/projects/${pid}/edits`, { session: S.viewer, body: { baseRevision: 1, text: "x" } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "read_only");
});

await step("edits, merge and conflict", async () => {
  const t2 = example1.replace("name varchar(80) [required]", "name varchar(80) [required]\n  born date");
  const r1 = await call("POST", `/api/projects/${pid}/edits`, { session: S.owner, body: { baseRevision: 1, text: t2 } });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.revision, 2);
  // editor works from revision 1 on a different unit
  const t3 = example1.replace("title text [required]", "title text [required]\n  pages int");
  const r2 = await call("POST", `/api/projects/${pid}/edits`, { session: S.editor, body: { baseRevision: 1, text: t3 } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.merged, true);
  assert.ok(r2.data.text.includes("born date") && r2.data.text.includes("pages int"));
  // conflict on authors from revision 1
  const t4 = example1.replace("id int [key, auto]\n  name", "id int [key, auto]\n  nick text\n  name");
  const r3 = await call("POST", `/api/projects/${pid}/edits`, { session: S.editor, body: { baseRevision: 1, text: t4 } });
  assert.equal(r3.status, 409);
  assert.equal(r3.data.error, "edit_conflict");
  assert.equal(r3.data.message, "Ada Okafor changed entity authors first.");
  assert.deepEqual(r3.data.conflicts, [{ unit: "entity authors", by: "Ada Okafor" }]);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(messages.some((m) => m.type === "revision" && m.revision === 3 && m.by.displayName === "Ben Ito"));
  const bad = await call("POST", `/api/projects/${pid}/edits`, { session: S.owner, body: { text: "x" } });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.fields.baseRevision, "Send the revision your text is based on.");
});

let revision = 3;
let text;
await step("link write-back", async () => {
  const p = await call("GET", `/api/projects/${pid}`, { session: S.owner });
  revision = p.data.revision;
  text = p.data.text;
  const r = await call("POST", `/api/projects/${pid}/links`, { session: S.owner, body: { baseRevision: revision, from: "books.id", to: "authors.id" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.line, "link books.id >- authors.id");
  assert.equal(r.data.text, text.replace("link books.author_id >- authors.id\n", "link books.author_id >- authors.id\nlink books.id >- authors.id\n"));
  revision = r.data.revision;
  const exists = await call("POST", `/api/projects/${pid}/links`, { session: S.owner, body: { baseRevision: revision, from: "authors.id", to: "books.id" } });
  assert.equal(exists.status, 409);
  assert.equal(exists.data.error, "link_exists");
  const mismatch = await call("POST", `/api/projects/${pid}/links`, { session: S.owner, body: { baseRevision: revision, from: "books.title", to: "authors.id" } });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.data.fields.to, "Link joins text to int");
  const stale = await call("POST", `/api/projects/${pid}/links`, { session: S.owner, body: { baseRevision: revision - 1, from: "books.title", to: "authors.id" } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, "stale_revision");
});

await step("groups and rename", async () => {
  const g = await call("POST", `/api/projects/${pid}/groups`, { session: S.owner, body: { baseRevision: revision, name: "Core", entities: ["books", "authors"], color: "green" } });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.ok(g.data.text.endsWith('\n\ngroup "Core" { authors, books }\n'));
  assert.deepEqual(g.data.layout.groups.Core, { color: "green" });
  revision = g.data.revision;
  const again = await call("POST", `/api/projects/${pid}/groups`, { session: S.owner, body: { baseRevision: revision, name: "Other", entities: ["books"], color: "green" } });
  assert.equal(again.status, 409);
  assert.equal(again.data.message, 'books is already in group "Core".');
  const rn = await call("POST", `/api/projects/${pid}/entities/rename`, { session: S.owner, body: { baseRevision: revision, from: "authors", to: "writers" } });
  assert.equal(rn.status, 200, JSON.stringify(rn.data));
  assert.ok(rn.data.text.includes("entity writers {") && rn.data.text.includes(">- writers.id") && rn.data.text.includes("{ writers, books }"));
  assert.deepEqual(rn.data.layout.entities.writers, { x: 0, y: 0, color: "slate" });
  revision = rn.data.revision;
  const del = await call("DELETE", `/api/projects/${pid}/groups/Core?baseRevision=${revision}`, { session: S.owner });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.ok(!del.data.text.includes("group"));
  assert.ok(del.data.text.endsWith("writers.id\nlink books.id >- writers.id\n"));
  revision = del.data.revision;
});

await step("layout and arrange", async () => {
  const r = await call("PATCH", `/api/projects/${pid}/layout`, { session: S.editor, body: { entities: { books: { x: 40, y: 3, color: "red" } } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.layout.entities.books, { x: 40, y: 3, color: "red" });
  const bad = await call("PATCH", `/api/projects/${pid}/layout`, { session: S.editor, body: { entities: { nope: { x: 1 }, books: { x: 501, color: "pink" } } } });
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.data.fields, { "entities.nope": "No entity nope.", "entities.books.x": "Use a whole number from 0 to 500.", "entities.books.color": "Pick one of slate, blue, violet, green, amber or red." });
  const a = await call("POST", `/api/projects/${pid}/layout/arrange`, { session: S.editor });
  assert.deepEqual(a.data.layout.entities.books, { x: 14, y: 0, color: "red" });
});

await step("versions", async () => {
  const v = await call("POST", `/api/projects/${pid}/versions`, { session: S.editor, body: { name: "Second" } });
  assert.equal(v.status, 201);
  assert.equal(v.data.number, 2);
  const [a, b] = await Promise.all([
    call("POST", `/api/projects/${pid}/versions`, { session: S.owner, body: { name: "A" } }),
    call("POST", `/api/projects/${pid}/versions`, { session: S.owner, body: { name: "B" } }),
  ]);
  assert.deepEqual([a.data.number, b.data.number].sort(), [3, 4]);
  const cmp = await call("GET", `/api/projects/${pid}/versions/compare?from=1&to=2`, { session: S.viewer });
  assert.deepEqual(cmp.data, { from: 1, to: 2, added: ["writers"], removed: ["authors"], changed: ["books"] });
  const restore = await call("POST", `/api/projects/${pid}/versions/1/restore`, { session: S.owner });
  assert.equal(restore.status, 201);
  assert.equal(restore.data.version.number, 5);
  assert.equal(restore.data.version.name, "Restored from version 1");
  assert.equal(restore.data.project.text, example1);
  const list = await call("GET", `/api/projects/${pid}/versions`, { session: S.viewer });
  assert.deepEqual(list.data.versions.map((x) => x.number), [5, 4, 3, 2, 1]);
  assert.equal((await call("POST", `/api/projects/${pid}/versions`, { session: S.viewer, body: { name: "x" } })).status, 403);
});

await step("exports", async () => {
  const r = await call("POST", `/api/projects/${pid}/exports`, { session: S.owner, body: { dialect: "postgresql" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, "stored");
  assert.equal(r.data.fileName, "library-loans-postgresql.sql");
  assert.equal(r.data.key, `exports/${pid}/${r.data.id}-postgresql.sql`);
  const dl = await call("GET", r.data.downloadUrl, { session: S.owner });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/sql; charset=utf-8");
  const ddl = await call("GET", `/api/projects/${pid}/ddl?dialect=postgresql`, { session: S.owner });
  assert.equal(dl.data, ddl.data);
  const my = await call("POST", `/api/projects/${pid}/exports`, { session: S.owner, body: { dialect: "mysql" } });
  assert.equal(my.status, 201);
  const bad = await call("POST", `/api/projects/${pid}/exports`, { session: S.owner, body: { dialect: "oracle" } });
  assert.equal(bad.status, 422);
  assert.equal((await call("GET", "/api/stats")).data.exports >= 2, true);
});

await step("imports", async () => {
  const p = await call("GET", `/api/projects/${pid}`, { session: S.owner });
  const ddl = "SET search_path = public;\nCREATE TABLE members (id serial PRIMARY KEY, name text NOT NULL);\nCREATE TABLE books (id int PRIMARY KEY, title text);\n";
  const r = await call("POST", `/api/projects/${pid}/imports?dialect=postgresql&mode=merge&baseRevision=${p.data.revision}`, { session: S.owner, raw: ddl });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.counts, { added: 1, merged: 1, skipped: 1, ambiguous: 0 });
  const orig = await call("GET", `/api/projects/${pid}/imports/${r.data.id}/original`, { session: S.owner });
  assert.equal(orig.data, ddl);
  const again = await call("POST", `/api/projects/${pid}/imports?dialect=postgresql&mode=merge&baseRevision=${r.data.revision}`, { session: S.owner, raw: ddl });
  assert.equal(again.data.changed, false);
  const fail = await call("POST", `/api/projects/${pid}/imports?dialect=postgresql&mode=merge&baseRevision=${r.data.revision}`, { session: S.owner, raw: "CREATE VIEW v AS SELECT 1;" });
  assert.equal(fail.status, 422);
  assert.deepEqual(fail.data.lines, ["Line 1, column 1: Unsupported statement: CREATE VIEW"]);
});

await step("shares, invitations, rotate and revoke", async () => {
  const email = `inv-${unique}@example.test`;
  const r = await call("POST", `/api/projects/${pid}/shares`, { session: S.owner, body: { access: "view", email } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.invitation.status, "sent");
  const mail = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  assert.equal(mail.messages[0].Subject, 'Ada Okafor shared "Library Loans" on Joinery');
  assert.equal((await call("GET", `/api/projects/${pid}/shares`, { session: S.editor })).data.error, "owner_only");
  const viewToken = setup.data.shares.view.token;
  const shared = await call("GET", `/api/shared/${viewToken}`);
  assert.equal(shared.data.role, "viewer");
  assert.equal(shared.data.via, "link");
  const rot = await call("POST", `/api/projects/${pid}/shares/${setup.data.shares.view.id}/rotate`, { session: S.owner });
  assert.equal(rot.status, 201);
  assert.equal((await call("GET", `/api/shared/${viewToken}`)).status, 404);
  const editToken = setup.data.shares.edit.token;
  assert.deepEqual((await call("GET", `/api/shared/${editToken}`)).data, { access: "edit", projectName: "Library Loans" });
  const join = await call("POST", `/api/shared/${editToken}/join`, { session: S.stranger });
  assert.deepEqual(join.data, { projectId: pid, role: "editor" });
  const rev = await call("POST", `/api/projects/${pid}/shares/${setup.data.shares.edit.id}/revoke`, { session: S.owner });
  assert.equal(rev.data.status, "revoked");
  assert.equal((await call("GET", `/api/projects/${pid}`, { session: S.stranger })).status, 404);
  assert.equal((await call("POST", `/api/projects/${pid}/shares/${setup.data.shares.edit.id}/revoke`, { session: S.owner })).data.error, "share_not_active");
});

await step("member roles", async () => {
  const members = await call("GET", `/api/projects/${pid}/members`, { session: S.owner });
  const ben = members.data.members.find((m) => m.displayName === "Ben Ito");
  const down = await call("PATCH", `/api/projects/${pid}/members/${ben.userId}`, { session: S.owner, body: { role: "viewer" } });
  assert.equal(down.data.role, "viewer");
  const write = await call("POST", `/api/projects/${pid}/versions`, { session: S.editor, body: { name: "x" } });
  assert.equal(write.status, 403);
  const ownerId = setup.data.users.owner.id;
  assert.equal((await call("PATCH", `/api/projects/${pid}/members/${ownerId}`, { session: S.owner, body: { role: "viewer" } })).data.error, "owner_role_fixed");
});

await step("sign-in by emailed code", async () => {
  const email = `new-${unique}@example.test`;
  const missing = await call("POST", "/api/auth/code", { body: { email } });
  assert.equal(missing.status, 422);
  const r = await call("POST", "/api/auth/code", { body: { email, displayName: "Eve Lund" } });
  assert.equal(r.status, 202);
  const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json();
  const code = /code is (\d{6})\./.exec(message.Text)[1];
  const wrong = await call("POST", "/api/auth/session", { body: { email, code: code === "000000" ? "111111" : "000000" } });
  assert.equal(wrong.status, 422);
  const ok = await call("POST", "/api/auth/session", { body: { email, code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.displayName, "Eve Lund");
  assert.match(ok.headers.get("set-cookie"), /joinery_session=.*HttpOnly; SameSite=Lax/);
  const reuse = await call("POST", "/api/auth/session", { body: { email, code } });
  assert.equal(reuse.status, 422);
});

ws?.close();
