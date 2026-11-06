/**
 * The overdue rule. Run against a server started with LIGHTFALL_TODAY set past the
 * due date of the account order that apitest3.mjs left behind.
 */

import { readFileSync } from "node:fs";

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";
let passed = 0;
const failures = [];
const eq = (n, a, e) => {
  const same = JSON.stringify(a) === JSON.stringify(e);
  if (same) passed += 1;
  else failures.push(`${n} -> ${JSON.stringify({ actual: a, expected: e })}`);
};

async function signin(email, password) {
  const r = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}

async function call(cookie, method, path, body) {
  const headers = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

const { orderKey, invoice } = JSON.parse(readFileSync("/tmp/overdue-order.json", "utf8"));
const today = process.env.LIGHTFALL_TODAY;

const buyer = await signin("rangi@kowhai-electrical.test", "Trade-approved-2026");
const admin = await signin("admin@southerly-light.test", "Lightfall-admin-2026");

const order = (await call(buyer, "GET", `/api/orders/${orderKey}`)).body.order;
eq(`the order reads Overdue from the 21st (server date ${today}, due ${invoice.due_date})`, order.status, "overdue");
eq("the overdue label", order.display_status, "Overdue");
eq("the due date is unchanged", order.invoice.due_date, invoice.due_date);

const adminView = (await call(admin, "GET", "/api/admin/orders")).body.orders.find((o) => o.order_key === orderKey);
eq("the admin table shows Overdue too", adminView.display_status, "Overdue");

// Recording payment moves an overdue order to paid.
const paid = await call(admin, "POST", `/api/admin/orders/${orderKey}/record-payment`, { amount_cents: order.total_cents });
eq("an overdue order accepts the recorded payment", [paid.status, paid.body.order.status], [200, "paid"]);
eq("and then reads Paid", paid.body.order.display_status, "Paid");

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length > 0) process.exitCode = 1;
