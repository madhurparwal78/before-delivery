// Outage test: run the app with an unreachable object store, commit a stroke
// (expect 202 waiting-for-store), then flip the store back by running a local
// proxy that forwards to MinIO at the SAME endpoint address the app read at
// start — the app reconnects without a restart, proving DP-56.
import { spawn } from "node:child_process";
import http from "node:http";
import { request as httpRequest } from "node:http";

// a proxy on 127.0.0.1:9999 that can be switched on later
let proxyOn = false;
const proxy = http.createServer((req, res) => {
  if (!proxyOn) {
    res.writeHead(502);
    res.end("unreachable");
    return;
  }
  // forward with the original host header so SigV4 stays valid
  const opts = { host: "minio", port: 9000, method: req.method, path: req.url, headers: req.headers };
  const up = httpRequest(opts, (ur) => {
    res.writeHead(ur.statusCode ?? 502, ur.headers);
    ur.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end("proxy error");
  });
  req.pipe(up);
});
await new Promise((r) => proxy.listen(9999, "127.0.0.1", r));
console.log("proxy listening (off)");

const env = {
  ...process.env,
  S3_ENDPOINT: "http://127.0.0.1:9999",
  S3_BUCKET: "gf-dev-outage-test",
};
const child = spawn("node", ["dist/server/main.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (d) => process.stdout.write(`[app] ${d}`));
child.stderr.on("data", (d) => process.stdout.write(`[app-err] ${d}`));
await new Promise((r) => setTimeout(r, 4000));

async function call(method, path, body, cookie, raw = false) {
  const res = await fetch("http://127.0.0.1:4173" + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `ditchbook_session=${cookie}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: raw ? text : (text ? JSON.parse(text) : null), cookie: res.headers.get("set-cookie") };
}

let r = await call("POST", "/api/session", { email: "jo@contractors.example", password: "channel-season-26" });
const joCookie = r.cookie?.match(/ditchbook_session=([^;]+)/)?.[1];
r = await call("POST", "/api/session", { email: "priya@wirrinbah.example", password: "channel-season-26" });
const priyaCookie = r.cookie?.match(/ditchbook_session=([^;]+)/)?.[1];
r = await call("POST", "/api/session", { email: "mara@growers.example", password: "channel-season-26" });
const maraCookie = r.cookie?.match(/ditchbook_session=([^;]+)/)?.[1];

let fails = 0;
function check(name, ok, detail = "") {
  if (!ok) { fails++; console.log(`FAIL ${name} ${detail}`); } else console.log(`ok   ${name}`);
}

r = await call("GET", "/api/health");
check("health with store down", r.status === 200 && r.body.status === "ok");

// the app serves every screen (page returns 200 html)
const page = await fetch("http://127.0.0.1:4173/sign-in");
check("screens served during outage", page.status === 200);

// Jo strokes his start card
r = await call("GET", "/api/gate-cards", undefined, joCookie);
const card = r.body.cards.find((c) => c.state === "open" && c.kind === "start");
check("card open", !!card);
r = await call("POST", `/api/gate-cards/${card.id}/stroke`, {}, joCookie);
check("stroke 202 waiting", r.status === 202 && r.body.card.state === "waiting-for-store", JSON.stringify(r.body).slice(0, 120));
r = await call("POST", `/api/gate-cards/${card.id}/stroke`, {}, joCookie);
check("spent-card rule: second stroke refused", r.status === 409 && r.body.error === "card_not_open");

// order not running yet
r = await call("GET", "/api/orders/ORD-00001", undefined, joCookie).catch(() => null);
if (r && r.status === 200) check("order still scheduled", r.body.order.status === "scheduled");
else check("order still scheduled (no access)", true);

// pack stalls at building
const doc = await (await fetch("http://127.0.0.1:4173/api/packs/preview?from=2026-11-12&to=2026-11-12&signatory=Priya%20Anand", { headers: { cookie: `ditchbook_session=${priyaCookie}` } })).text();
r = await call("POST", "/api/packs", { from: "2026-11-12", to: "2026-11-12", signatory: "Priya Anand", document: doc }, priyaCookie);
check("pack submitted 202", r.status === 202);
check("pack stalled at building", r.body.pack.state === "building" || r.body.pack.stalled_on === "store", JSON.stringify(r.body.pack).slice(0, 140));

// wait a couple of worker cycles; still stalled
await new Promise((r2) => setTimeout(r2, 12000));
r = await call("GET", "/api/packs/WP-0001", undefined, priyaCookie);
check("pack still stalled", r.body.pack.state === "building" && r.body.pack.stalled_on === "store");

// notices stay queued (mail is up but the pack is stalled on the store;
// restriction notice queued? none here). Now flip the proxy on: the store
// answers again at the same address.
proxyOn = true;
console.log("proxy ON — store answers again at the same address");
const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 30000) {
  await new Promise((r2) => setTimeout(r2, 2000));
  r = await call("GET", "/api/orders/ORD-00001", undefined, priyaCookie);
  const pack = await call("GET", "/api/packs/WP-0001", undefined, priyaCookie);
  const cardNow = await call("GET", "/api/gate-cards", undefined, joCookie);
  const spent = cardNow.body.cards.find((c) => c.id === card.id);
  const orderRunning = r.status === 200 && r.body.order.status === "running";
  if (orderRunning && pack.body.pack.state === "mailed" && spent?.state === "spent") {
    done = true;
    console.log(`recovered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    break;
  }
}
check("stroke confirmed after recovery", done);
if (done) {
  r = await call("GET", "/api/orders/ORD-00001", undefined, priyaCookie);
  check("order running after recovery", r.body.order.status === "running");
  r = await call("GET", "/api/windows/W-L4-A", undefined, priyaCookie);
  check("flow after recovery", r.body.window.channel_flow_ml_day === "20.000", r.body.window.channel_flow_ml_day);
  r = await call("GET", "/api/packs/WP-0001", undefined, priyaCookie);
  check("pack mailed after recovery", r.body.pack.state === "mailed");
  check("pack digest set", r.body.pack.sha256?.length === 64);
}

console.log(fails === 0 ? "OUTAGE TEST ALL OK" : `${fails} FAILURES`);
child.kill();
proxy.close();
process.exit(fails === 0 ? 0 : 1);
