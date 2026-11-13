// DP-29: concurrent checkouts for a listing's last units — exactly k succeed, stock never below 0.
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const BASE = "http://localhost:4173";

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// fresh shopper
const phone = `+9197${String(Date.now()).slice(-8)}`;
const email = `race${Date.now()}@example.test`;

async function api(path, init, cookies, idemKey) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
      ...(cookies ? { cookie: cookies } : {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  let cookie = cookies ?? "";
  if (setCookie) {
    const jar = {};
    for (const part of (cookie ? cookie.split("; ") : []).concat(setCookie.split("; "))) {
      const [k] = part.split("=");
      if (k && !["Path", "HttpOnly", "SameSite", "Max-Age"].includes(k)) jar[k] = part;
    }
    cookie = Object.values(jar).join("; ");
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, body, cookie };
}

// sign up (2 sends allowed per fresh identifier; we need 1)
let r = await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Race Tester", email, phone, password: "Race@Bazaar2026" }) });
const pendingCookie = r.cookie;
const codeRow = await pool.query("SELECT code_hash FROM pending_signins WHERE identifier = $1 ORDER BY issued_at DESC LIMIT 1", [phone]);
const { createHash } = await import("node:crypto");
let code = null;
for (let i = 0; i < 1000000; i++) {
  const c = String(i).padStart(6, "0");
  if (createHash("sha256").update(c).digest("hex") === codeRow.rows[0].code_hash) { code = c; break; }
}
r = await api("/api/auth/signup/verify", { method: "POST", body: JSON.stringify({ code }) }, pendingCookie);
const authCookie = r.cookie;
check("signed up", r.status === 201, JSON.stringify(r.body).slice(0, 80));

// an address
r = await api("/api/account/addresses", { method: "POST", body: JSON.stringify({ label: "Home", name: "Race Tester", line1: "1 Street", line2: "", city: "Bengaluru", pincode: "560034", phone: "+919812345678" }) }, authCookie);
check("address added", r.status === 201, r.body?.address_id ?? "");
const addressId = r.body.address_id;

// set stock of L-1002 (Kaveri tiffin, price 69900) to exactly 3
await pool.query("UPDATE listings SET stock = 3 WHERE listing_id = 'L-1002'");

// add 1 unit to the cart, then race 6 concurrent checkouts with the same stock
r = await api("/api/cart/lines", { method: "POST", body: JSON.stringify({ listing_id: "L-1002", quantity: 1 }) }, authCookie);
check("added to cart", r.status === 201);

const race = await Promise.all(Array.from({ length: 6 }, (_, i) =>
  api("/api/checkout", {
    method: "POST",
    body: JSON.stringify({
      address_id: addressId,
      expected_payable_paise: 69900,
      payment: { method: "cod", use_balance: false },
    }),
  }, authCookie, `race-key-${i}-abcdefgh`)));

const placed = race.filter((x) => x.status === 201);
const soldOut = race.filter((x) => x.body?.error === "sold_out");
check("exactly 3 succeed", placed.length === 3, `${placed.length} placed, ${soldOut.length} sold_out; other statuses: ${race.filter((x) => x.status !== 201 && x.body?.error !== "sold_out").map((x) => `${x.status}:${x.body?.error}:${x.body?.message}`).join(" | ")}`);
check("all placed orders are distinct", new Set(placed.map((x) => x.body.order_id)).size === placed.length);

const stock = await pool.query("SELECT stock FROM listings WHERE listing_id = 'L-1002'");
check("stock never below zero", Number(stock.rows[0].stock) === 0, `stock=${stock.rows[0].stock}`);

const charges = await pool.query("SELECT count(*) AS n FROM payment_legs WHERE status = 'confirmed' AND payment_id IN (SELECT payment_id FROM payments WHERE order_id = ANY($1))", [placed.map((x) => x.body.order_id)]);
check("no charge on failed attempts", Number(charges.rows[0].n) === 0, `confirmed legs for placed: ${charges.rows[0].n}`);

// restore stock
await pool.query("UPDATE listings SET stock = 10 WHERE listing_id = 'L-1002'");
await pool.end();
