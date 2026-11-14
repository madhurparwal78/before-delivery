import assert from "node:assert/strict";
import { test } from "node:test";
import { bakery, Client, seed, setClock, supper, unique } from "./helpers.js";

async function seedOwner(forms: unknown[]): Promise<any> {
  return seed({ users: [{ key: "owen", name: "Owen Hale", email: unique("owen"), password: "pw-owen-1" }], forms });
}

test("supper club walk, hidden answers and submit", async () => {
  await setClock(null);
  const seeded = await seedOwner([{ key: "rsvp", owner: "owen", editions: [supper], settings: { copy_to: null } }]);
  const slug = seeded.forms.rsvp.slug;
  const r = new Client();
  const info = await r.call("GET", `/api/f/${slug}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.title, "Supper club RSVP");
  const created = await r.call("POST", `/api/f/${slug}/responses`, {});
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.page, "about");
  let c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 1, page: "about", answers: { attending: "Yes", guests: "3" } });
  assert.equal(c.status, 200);
  assert.equal(c.body.evaluation.shown_pages, 4);
  let n = await r.call("POST", `/api/responses/${id}/next`, { page: "about" });
  assert.equal(n.body.page, "meals");
  assert.equal(n.body.evaluation.announce, "Page 2 of 4: Meals");
  await r.call("POST", `/api/responses/${id}/answers`, { seq: 2, page: "meals", answers: { meal: "Vegetarian", diet: "Vegan" } });
  n = await r.call("POST", `/api/responses/${id}/next`, { page: "meals" });
  assert.equal(n.body.page, "travel");
  c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 3, page: "travel", answers: { parking: "Yes" } });
  const back = await r.call("POST", `/api/responses/${id}/back`, { page: "travel" });
  assert.equal(back.body.page, "meals");
  const back2 = await r.call("POST", `/api/responses/${id}/back`, { page: "meals" });
  assert.equal(back2.body.page, "about");
  c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 4, page: "about", answers: { guests: "1" } });
  assert.equal(c.body.evaluation.hidden_now, 1);
  assert.equal(c.body.evaluation.announce, "1 answer no longer applies and will not be sent.");
  assert.equal(c.body.evaluation.shown_pages, 3);
  c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 5, page: "about", answers: { guests: "3" } });
  assert.equal(c.body.evaluation.restored, 1);
  c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 6, page: "about", answers: { guests: "1" } });
  // next with error: guests 9
  c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 7, page: "about", answers: { guests: "9" } });
  n = await r.call("POST", `/api/responses/${id}/next`, { page: "about" });
  assert.equal(n.status, 422);
  assert.equal(n.body.error.code, "ANSWERS_INVALID");
  assert.equal(n.body.error.items[0].message, "How many guests?: enter a number from 1 to 8.");
  assert.equal(n.body.error.message, "There is a problem with your answers. 1 to fix.");
  await r.call("POST", `/api/responses/${id}/answers`, { seq: 8, page: "about", answers: { guests: "1" } });
  const noKey = await r.call("POST", `/api/responses/${id}/submit`, { page: "thanks" });
  assert.equal(noKey.status, 422);
  assert.equal(noKey.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const s1 = await r.call("POST", `/api/responses/${id}/submit`, { page: "thanks" }, { "Idempotency-Key": "k-" + id });
  assert.equal(s1.status, 200, s1.text);
  assert.equal(s1.body.replayed, false);
  const s2 = await r.call("POST", `/api/responses/${id}/submit`, { page: "thanks" }, { "Idempotency-Key": "k-" + id });
  assert.equal(s2.status, 200);
  assert.equal(s2.body.replayed, true);
  const s3 = await r.call("POST", `/api/responses/${id}/submit`, { page: "about" }, { "Idempotency-Key": "k-" + id });
  assert.equal(s3.status, 409);
  assert.equal(s3.body.error.code, "IDEMPOTENCY_CONFLICT");
  const s4 = await r.call("POST", `/api/responses/${id}/submit`, { page: "thanks" }, { "Idempotency-Key": "other-" + id });
  assert.equal(s4.body.error.code, "ALREADY_SUBMITTED");
  const owner = new Client(seeded.users.owen.session);
  const view = await owner.call("GET", `/api/forms/${seeded.forms.rsvp.id}/responses/${id}`);
  assert.equal(view.status, 200);
  assert.deepEqual(view.body.items.map((i: any) => i.key), ["attending", "guests", "meal", "diet"]);
  const summary = await owner.call("GET", `/api/forms/${seeded.forms.rsvp.id}/summary`);
  assert.equal(summary.body.count, "1");
  const partialRead = await owner.call("GET", `/api/responses/${id}`);
  assert.equal(partialRead.status, 404);
});

test("bakery commit values and hidden margin", async () => {
  const seeded = await seedOwner([{ key: "bakery", owner: "owen", editions: [bakery], settings: { copy_to: "email" } }]);
  const r = new Client();
  const created = await r.call("POST", `/api/f/${seeded.forms.bakery.slug}/responses`, {});
  const id = created.body.id;
  assert.ok(!JSON.stringify(created.body).includes("margin"));
  const c = await r.call("POST", `/api/responses/${id}/answers`, { seq: 1, page: "order", answers: { loaves: "6", rolls: "3", delivery: "yes" } });
  assert.equal(c.body.evaluation.values.total.text, "£21.27");
  assert.equal(c.body.evaluation.values.each.text, "Cannot calculate: division by zero.");
  assert.ok(!JSON.stringify(c.body).includes("margin"));
  assert.match(c.body.evaluation.announce, /Subtotal: £21.45/);
  const bulk = c.body.evaluation.pages[0].questions.find((q: any) => q.key === "bulk_note");
  assert.equal(bulk.state, "lit");
  await r.call("POST", `/api/responses/${id}/answers`, { seq: 2, page: "order", answers: { people: "2", email: "ana@example.test" } });
  const s = await r.call("POST", `/api/responses/${id}/submit`, { page: "order" }, { "Idempotency-Key": "bk-" + id });
  assert.equal(s.status, 200, s.text);
  assert.ok(["sent", "queued"].includes(s.body.copy));
  const owner = new Client(seeded.users.owen.session);
  const exp = await owner.call("POST", `/api/forms/${seeded.forms.bakery.id}/exports`, {});
  assert.equal(exp.status, 201, exp.text);
  const csv = await owner.call("GET", exp.body.url);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^response_id,submitted_at,edition,loaves,rolls,delivery,people,subtotal,discount,total,each,margin,bulk_note,email\r\n/);
  assert.match(csv.text, /,6,3,yes,2,21.45,2.68,21.27,10.64,6.38,,ana@example.test\r\n$/);
});

test("formula refusals on changes and publishing", async () => {
  const seeded = await seedOwner([{ key: "d", owner: "owen", editions: [], draft: supper }]);
  const owner = new Client(seeded.users.owen.session);
  const id = seeded.forms.d.id;
  const form = await owner.call("GET", `/api/forms/${id}`);
  assert.equal(form.body.state, "draft");
  const bad = await owner.call("POST", `/api/forms/${id}/changes`, {
    changes: [{ op: "set", key: "travel", field: "show_rule", value: { name: "R", when: "{guests} >= " }, base_rev: form.body.rev }],
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "FORMULA_INVALID");
  assert.equal(bad.body.error.message, "Column 13: the formula ends too early.");
  const later = await owner.call("POST", `/api/forms/${id}/changes`, {
    changes: [{ op: "set", key: "travel", field: "show_rule", value: { name: "R", when: "{comment} = 1" }, base_rev: form.body.rev }],
  });
  assert.equal(later.body.error.message, "Column 1: {comment} comes later in the form, so it cannot be used here.");
  const dup = await owner.call("POST", `/api/forms/${id}/changes`, {
    changes: [{ op: "add_question", page: "about", question: { key: "guests", type: "short_text", label: "X" }, base_rev: 0 }],
  });
  assert.equal(dup.body.error.code, "DUPLICATE_KEY");
  const badKey = await owner.call("POST", `/api/forms/${id}/changes`, {
    changes: [{ op: "add_question", page: "about", question: { key: "Bad Key", type: "short_text", label: "X" }, base_rev: 0 }],
  });
  assert.equal(badKey.body.error.code, "VALIDATION_FAILED");
  assert.deepEqual(badKey.body.error.items, [{ key: "Bad Key", message: "Use lower-case letters, digits and underscores, starting with a letter." }]);
  const calc = await owner.call("POST", `/api/forms/${id}/changes`, {
    changes: [{ op: "add_question", page: "thanks", question: { key: "calc", type: "calculated", label: "Calc" }, base_rev: 0 }],
  });
  assert.equal(calc.status, 200, calc.text);
  const pub = await owner.call("POST", `/api/forms/${id}/publish`, {});
  assert.equal(pub.status, 422);
  assert.equal(pub.body.error.message, "Fix 1 problem before publishing.");
  await owner.call("POST", `/api/forms/${id}/changes`, { changes: [{ op: "remove_question", key: "calc", base_rev: 0 }] });
  const pub2 = await owner.call("POST", `/api/forms/${id}/publish`, {});
  assert.equal(pub2.status, 200);
  assert.equal(pub2.body.edition, 1);
  const trial = await owner.call("POST", `/api/forms/${id}/trial`, { seq: 3, answers: { attending: "No" } });
  assert.equal(trial.body.announce, "Path: 2 of 4 pages shown");
  assert.equal(trial.body.pages[1].skipped_by, "Not attending");
});

test("closing time, limit and clock", async () => {
  const seeded = await seedOwner([
    { key: "t", owner: "owen", editions: [supper], settings: { closes_at: "2026-03-14T17:00", response_limit: 1 } },
  ]);
  await setClock("2026-03-14T16:59:00+00:00");
  const slug = seeded.forms.t.slug;
  const a = new Client();
  const b = new Client();
  const ra = await a.call("POST", `/api/f/${slug}/responses`, {});
  const rb = await b.call("POST", `/api/f/${slug}/responses`, {});
  assert.equal(ra.status, 201, ra.text);
  for (const [c, r] of [
    [a, ra],
    [b, rb],
  ] as const)
    await c.call("POST", `/api/responses/${r.body.id}/answers`, { seq: 1, page: "about", answers: { attending: "No" } });
  const results = await Promise.all([
    a.call("POST", `/api/responses/${ra.body.id}/submit`, { page: "thanks" }, { "Idempotency-Key": "a" + ra.body.id }),
    b.call("POST", `/api/responses/${rb.body.id}/submit`, { page: "thanks" }, { "Idempotency-Key": "b" + rb.body.id }),
  ]);
  const statuses = results.map((x) => x.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const closed = results.find((x) => x.status === 409);
  assert.equal(closed?.body.error.code, "FORM_CLOSED");
  assert.equal(closed?.body.error.message, "This form has reached its limit of 1 responses.");
  const seeded2 = await seedOwner([{ key: "t", owner: "owen", editions: [supper], settings: { closes_at: "2026-03-14T17:00" } }]);
  await setClock("2026-03-14T16:59:59+00:00");
  const c = new Client();
  const rc = await c.call("POST", `/api/f/${seeded2.forms.t.slug}/responses`, {});
  assert.equal(rc.status, 201);
  await setClock("2026-03-14T17:00:00+00:00");
  const info = await c.call("GET", `/api/f/${seeded2.forms.t.slug}`);
  assert.equal(info.body.state, "closed");
  assert.equal(info.body.closed.text, "This form closed at 14 Mar 2026, 17:00 (Europe/London).");
  await setClock(null);
});

test("resume link moves device and expires", async () => {
  await setClock("2026-03-01T09:00:00+00:00");
  const seeded = await seedOwner([
    {
      key: "rsvp",
      owner: "owen",
      editions: [supper],
      responses: [{ key: "r1", status: "partial", answers: { attending: "Yes", guests: "3" }, page: "meals", email: "ana@example.test", saved_at: "2026-03-01T09:00" }],
    },
  ]);
  const token = seeded.forms.rsvp.responses.r1.resume_url.split("/r/")[1];
  const first = new Client();
  const opened = await first.call("POST", `/api/resume/${token}`, {});
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.body.page, "meals");
  assert.equal(opened.body.notice, "Welcome back. Your answers were saved on 1 Mar 2026, 09:00.");
  const second = new Client();
  await second.call("POST", `/api/resume/${token}`, {});
  const moved = await first.call("POST", `/api/responses/${opened.body.id}/answers`, { seq: 1, page: "meals", answers: { meal: "Fish" } });
  assert.equal(moved.status, 409);
  assert.equal(moved.body.error.code, "DRAFT_MOVED");
  await setClock("2026-03-31T09:00:00+00:00");
  const still = await new Client().call("POST", `/api/resume/${token}`, {});
  assert.equal(still.status, 200);
  await setClock("2026-03-31T09:00:01+00:00");
  const expired = await new Client().call("POST", `/api/resume/${token}`, {});
  assert.equal(expired.status, 404);
  assert.equal(expired.body.error.code, "LINK_EXPIRED");
  await setClock(null);
});

test("invitations and co-editor access", async () => {
  const riaEmail = unique("ria");
  const seeded = await seed({
    users: [
      { key: "owen", name: "Owen Hale", email: unique("owen"), password: "pw-owen-1" },
      { key: "ria", name: "Ria Moss", email: riaEmail, password: "pw-ria-1" },
    ],
    forms: [{ key: "f", owner: "owen", editions: [supper] }],
  });
  const owner = new Client(seeded.users.owen.session);
  const ria = new Client(seeded.users.ria.session);
  const id = seeded.forms.f.id;
  assert.equal((await ria.call("GET", `/api/forms/${id}`)).status, 404);
  const known = await owner.call("POST", `/api/forms/${id}/invitations`, { email: riaEmail });
  const unknown = await owner.call("POST", `/api/forms/${id}/invitations`, { email: "nobody@example.test" });
  assert.equal(known.status, 202);
  assert.deepEqual(Object.keys(known.body), Object.keys(unknown.body));
  assert.equal(known.body.message, `Invitation sent to ${riaEmail}.`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const search = await (await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(`to:${riaEmail}`)}`)).json();
  const message = await (await fetch(`http://mailpit:8025/api/v1/message/${search.messages[0].ID}`)).json();
  assert.equal(message.Subject, "Join Supper club RSVP on Nightform");
  const token = /\/invite\/([a-f0-9]+)/.exec(message.Text)?.[1];
  assert.ok(token);
  assert.equal((await new Client().call("POST", `/api/invitations/${token}/accept`, {})).status, 401);
  const accepted = await ria.call("POST", `/api/invitations/${token}/accept`, {});
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.form_id, id);
  assert.equal((await ria.call("POST", `/api/invitations/${token}/accept`, {})).status, 404);
  assert.equal((await ria.call("GET", `/api/forms/${id}`)).status, 200);
  assert.equal((await ria.call("POST", `/api/forms/${id}/publish`, {})).status, 404);
  assert.equal((await ria.call("PUT", `/api/forms/${id}/settings`, {})).status, 404);
  assert.equal((await owner.call("POST", `/api/forms/${id}/close`, {})).status, 200);
  assert.equal((await ria.call("GET", `/api/forms/${id}`)).status, 404);
  assert.equal((await ria.call("GET", `/api/forms/${id}/summary`)).status, 200);
  assert.equal((await owner.call("GET", `/api/forms/${id}`)).status, 200);
  assert.equal((await owner.call("POST", `/api/forms/${id}/reopen`, {})).body.state, "open");
  assert.equal((await owner.call("POST", `/api/forms/${id}/reopen`, {})).body.error.code, "FORM_OPEN");
});

test("csv neutralises formulas", async () => {
  const def = {
    title: "Notes",
    pages: [{ key: "p", title: "P", questions: [{ key: "note", type: "short_text", label: "Note" }, { key: "n", type: "number", label: "N" }] }],
  };
  const seeded = await seedOwner([
    {
      key: "f",
      owner: "owen",
      editions: [def],
      responses: [{ key: "r", status: "submitted", answers: { note: "=SUM(A1)", n: "-5" }, submitted_at: "2026-03-14T17:00" }],
    },
  ]);
  const owner = new Client(seeded.users.owen.session);
  const exported = await owner.call("POST", `/api/forms/${seeded.forms.f.id}/exports`, {});
  const csv = await owner.call("GET", exported.body.url);
  assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(csv.text, `response_id,submitted_at,edition,note,n\r\n${seeded.forms.f.responses.r.id},2026-03-14T17:00:00+00:00,1,'=SUM(A1),-5\r\n`);
});

test("grading routes need the key", async () => {
  const r = await new Client().call("POST", "/api/grading/seed", {});
  assert.equal(r.status, 404);
  const big = await new Client().call("POST", "/api/session", { pad: "x".repeat(1_000_001) });
  assert.equal(big.status, 413);
});
