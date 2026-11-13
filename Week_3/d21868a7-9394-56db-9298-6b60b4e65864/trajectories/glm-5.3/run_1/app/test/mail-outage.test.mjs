// Mail outage: notices queue and packs stall at stored; both finish within 30s
// of the mail service answering again at the same address.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";

// a TCP proxy on 127.0.0.1:1026 that can be switched on later
let proxyOn = false;
const server = net.createServer((socket) => {
  if (!proxyOn) {
    socket.destroy();
    return;
  }
  const upstream = net.connect({ host: "mailpit", port: 1025 });
  socket.pipe(upstream);
  upstream.pipe(socket);
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
await new Promise((r) => server.listen(1026, "127.0.0.1", r));

const env = { ...process.env, SMTP_HOST: "127.0.0.1", SMTP_PORT: "1026" };
const child = spawn("node", ["dist/server/main.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (d) => process.stdout.write(`[app] ${d}`));
child.stderr.on("data", (d) => process.stdout.write(`[app-err] ${d}`));
await new Promise((r) => setTimeout(r, 4000));

let fails = 0;
function check(name, ok, detail = "") {
  if (!ok) { fails++; console.log(`FAIL ${name} ${detail}`); } else console.log(`ok   ${name}`);
}

async function call(method, path, body, cookie) {
  const res = await fetch("http://127.0.0.1:4173" + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `ditchbook_session=${cookie}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie") };
}

const hal = (await call("POST", "/api/session", { email: "hal@wirrinbah.example", password: "channel-season-26" })).cookie?.match(/ditchbook_session=([^;]+)/)?.[1];
const lin = (await call("POST", "/api/session", { email: "lin@growers.example", password: "channel-season-26" })).cookie?.match(/ditchbook_session=([^;]+)/)?.[1];
const priya = (await call("POST", "/api/session", { email: "priya@wirrinbah.example", password: "channel-season-26" })).cookie?.match(/ditchbook_session=([^;]+)/)?.[1];

check("health with mail down", (await call("GET", "/api/health")).status === 200);

// a restriction publish still succeeds; its notices queue
let r = await call("POST", "/api/windows/W-L4-A/restrictions", { cap_ml_day: "50.000", reason: "Channel maintenance" }, hal);
check("restriction publishes with mail down", r.status === 201, JSON.stringify(r.body).slice(0, 80));
r = await call("GET", "/api/windows/W-L4-A/notices", undefined, hal);
const queued = r.body.notices.filter((n) => n.state === "queued");
check("notices queued while mail down", queued.length >= 1, JSON.stringify(r.body.notices.slice(0, 2)));

// a pack stores but stalls on mail
const doc = await (await fetch("http://127.0.0.1:4173/api/packs/preview?from=2026-11-12&to=2026-11-12&signatory=Priya%20Anand", { headers: { cookie: `ditchbook_session=${priya}` } })).text();
r = await call("POST", "/api/packs", { from: "2026-11-12", to: "2026-11-12", signatory: "Priya Anand", document: doc }, priya);
check("pack submitted", r.status === 202);
await new Promise((res) => setTimeout(res, 6000));
r = await call("GET", "/api/packs/WP-0001", undefined, priya);
check("pack stored but stalled on mail", r.body.pack.state === "stored" && r.body.pack.stalled_on === "mail", JSON.stringify(r.body.pack).slice(0, 120));

// the reviewer cannot see an unmailed pack
r = await call("GET", "/api/packs/WP-0001", undefined, lin);
check("grower cannot read packs", r.status === 403 || r.status === 404, r.status);

// bring the mail service back at the same address
proxyOn = true;
console.log("mail proxy ON");
const t0 = Date.now();
let mailed = false;
while (Date.now() - t0 < 30000) {
  await new Promise((res) => setTimeout(res, 2000));
  r = await call("GET", "/api/packs/WP-0001", undefined, priya);
  if (r.body.pack.state === "mailed") { mailed = true; break; }
}
check("pack mailed after recovery", mailed, `after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
r = await call("GET", "/api/windows/W-L4-A/notices", undefined, hal);
check("queued notices sent after recovery", r.body.notices.every((n) => n.state === "sent"), JSON.stringify(r.body.notices.map((n) => n.state)));

console.log(fails === 0 ? "MAIL OUTAGE TEST ALL OK" : `${fails} FAILURES`);
child.kill();
server.close();
process.exit(fails === 0 ? 0 : 1);
