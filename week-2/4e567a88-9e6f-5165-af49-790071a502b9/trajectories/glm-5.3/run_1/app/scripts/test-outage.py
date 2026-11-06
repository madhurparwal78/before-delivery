#!/usr/bin/env python3
"""Outage journey tests (DP-32, DP-35, DP-36, DP-37) against an isolated instance."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4199"
KEYS = {"mara": "dpk_mara_4c19e7", "june": "dpk_june_d39a58"}

passed = 0
failed = 0
procs = []

def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok  {name}", flush=True)
    else:
        failed += 1
        print(f"FAIL  {name}  {detail}", flush=True)

def req(method, path, key=None, body=None, headers=None, timeout=30):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if key:
        r.add_header("Authorization", f"Bearer {key}")
    if body is not None:
        r.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            r.add_header(k, v)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        return resp.status, json.loads(resp.read()), dict(resp.headers)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            payload = json.loads(payload)
        except Exception:
            pass
        return e.code, payload, dict(e.headers)

def kill_instance_b():
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            env = open(f"/proc/{pid}/environ", "rb").read().decode(errors="replace")
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().decode(errors="replace")
        except Exception:
            continue
        if "APP_PUBLIC_PORT" in env and "APP_PUBLIC_PORT=4199" in env.replace("\x00", "\n") and "main.js" in cmd:
            try:
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass

def kill_proxies():
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode()
        except Exception:
            continue
        if "proxy.mjs" in cmd:
            try:
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass

def start_proxy(port, target_host, target_port, mode):
    p = subprocess.Popen(["node", "/app/scripts/proxy.mjs", str(port), target_host, str(target_port), mode],
                         stdout=open(f"/tmp/proxy-{port}-{mode}.log", "w"), stderr=subprocess.STDOUT)
    procs.append(p)
    return p

def main():
    kill_instance_b()
    kill_proxies()

    # --- setup: fresh schema and bucket -----------------------------------
    reset = subprocess.run(["node", "-e", (
        "const {Client}=require('/app/node_modules/pg');"
        "const c=new Client({connectionString:'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev'});"
        "c.connect().then(async()=>{"
        "await c.query('DROP SCHEMA IF EXISTS outage_test CASCADE');"
        "await c.query('CREATE SCHEMA outage_test');"
        "await c.end();console.log('schema ok');"
        "}).catch(e=>{console.error(e.message);process.exit(1);});"
    )], capture_output=True, text=True)
    if reset.returncode != 0:
        print("schema setup failed:", reset.stderr)
        return 1
    subprocess.run(["node", "-e", (
        "import('/app/dist/server/storage.js').then(async ({Storage}) => {"
        "const s = new Storage({endpoint:'http://minio:9000',region:'us-east-1',bucket:'gf-outage',"
        "forcePathStyle:true,accessKeyId:'gf-dev-root-71c3e0',secretAccessKey:'gf-dev-secret-4b8d92'});"
        "await s.ensureBucket();console.log('bucket ok');});"
    )], capture_output=True)

    # instance B: storage on a dead port, billing on a dead port
    env_b = dict(os.environ)
    env_b.update({
        "DATABASE_URL": "postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev?options=-c%20search_path%3Doutage_test",
        "S3_ENDPOINT": "http://192.168.224.7:9090",
        "S3_BUCKET": "gf-outage",
        "KILLBILL_URL": "http://192.168.224.7:9091",
        "APP_PUBLIC_PORT": "4199",
        "APP_PUBLIC_URL": "http://127.0.0.1:4199",
    })
    inst = subprocess.Popen(["node", "dist/server/main.js"], cwd="/app", env=env_b,
                            stdout=open("/tmp/outage-server.log", "w"), stderr=subprocess.STDOUT)
    procs.append(inst)
    time.sleep(3)

    print("== DP-37: boot with dependencies down ==", flush=True)
    s, d, _ = req("GET", "/api/health")
    check("health 200 while storage+billing down", s == 200 and d["status"] == "ok", (s, d))

    print("== DP-36: service status reflects outage ==", flush=True)
    s, d, _ = req("GET", "/api/system", KEYS["mara"])
    check("system shows storage down", d["storage"] == "down", d)
    check("system shows billing down", d["billing"] == "down", d)

    print("== DP-35: storage outage holds the queue ==", flush=True)
    s, d, _ = req("POST", "/api/jobs", KEYS["mara"],
                  {"model": "quill-still", "input": {"prompt": "text-only during outage", "num_images": 1}},
                  headers={"Idempotency-Key": "outage-text-1"})
    check("text-only submission 201", s == 201, (s, d))
    job_id = d["job"]["id"]
    check("queued", d["job"]["status"] == "queued", d["job"]["status"])
    check("reservation made", d["job"]["reserved_micro"] == 4_000_000, d["job"]["reserved_micro"])
    time.sleep(2)
    s, d, _ = req("GET", f"/api/jobs/{job_id}", KEYS["mara"])
    check("waiting reason storage_unavailable", d["job"]["waiting_reason"] == "storage_unavailable", d["job"])
    check("still queued (nothing leased)", d["job"]["status"] == "queued", d["job"]["status"])

    r = urllib.request.Request(BASE + "/api/uploads", data=b"\x89PNG fake", method="POST")
    r.add_header("Authorization", f"Bearer {KEYS['mara']}")
    r.add_header("Content-Type", "image/png")
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        s, body = resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        s, body = e.code, json.loads(e.read())
    check("upload 503", s == 503 and body["error"]["code"] == "storage_unavailable", (s, body))

    s, d, _ = req("POST", "/api/jobs", KEYS["mara"],
                  {"model": "halftone-xl", "input": {"prompt": "with url", "init_image": "http://main:18099/x.png"}},
                  headers={"Idempotency-Key": "outage-url-1"})
    check("URL input 503", s == 503 and d["error"]["code"] == "storage_unavailable", (s, d))

    print("== DP-32: billing outage keeps top-ups pending ==", flush=True)
    s, d, _ = req("POST", "/api/topups", KEYS["june"], {"team_id": "t_storefront", "credits": 200})
    check("topup 202 pending", s == 202 and d["topup"]["status"] == "pending", (s, d))
    check("pending reason billing_unavailable", d["topup"]["pending_reason"] == "billing_unavailable", d["topup"])
    topup_id = d["topup"]["id"]
    s, d, _ = req("GET", "/api/teams/t_storefront/meter", KEYS["mara"])
    check("no credits granted during outage", d["available_micro"] == 5_000_000_000 - 4_000_000, d["available_micro"])

    print("== storage returns; queue drains without restart ==", flush=True)
    start_proxy(9090, "minio", 9000, "pass")
    time.sleep(1)
    deadline = time.time() + 45
    drained = False
    while time.time() < deadline:
        s, d, _ = req("GET", f"/api/jobs/{job_id}", KEYS["mara"])
        if d["job"]["status"] == "succeeded":
            drained = True
            break
        time.sleep(2)
    check("queue drained when storage returned", drained, "job did not finish in 45s")
    s, d, _ = req("GET", "/api/system", KEYS["mara"])
    check("system shows storage up", d["storage"] == "up", d)

    print("== billing returns; pending top-up completes without restart ==", flush=True)
    start_proxy(9091, "killbill", 8080, "pass")
    paid = None
    deadline = time.time() + 45
    while time.time() < deadline:
        s, d, _ = req("GET", "/api/topups", KEYS["june"])
        paid = next((t for t in d["topups"] if t["id"] == topup_id), None)
        if paid and paid["status"] == "paid":
            break
        time.sleep(3)
    check("topup completed after billing returned", paid and paid["status"] == "paid", paid)
    s, d, _ = req("GET", "/api/teams/t_storefront/meter", KEYS["mara"])
    check("credits granted after billing returned", d["available_micro"] == 5_000_000_000 - 4_000_000 + 200 * 1_000_000,
          d["available_micro"])

    print("== a timed-out call that reached Kill Bill is continued, not repeated ==", flush=True)
    kill_proxies()
    start_proxy(9091, "killbill", 8080, "silent")
    time.sleep(11)  # the probe sees billing down (responses swallowed)
    s, d, _ = req("POST", "/api/topups", KEYS["june"], {"team_id": "t_storefront", "credits": 300}, timeout=40)
    check("timed-out topup 202 pending", s == 202 and d["topup"]["status"] == "pending", (s, d))
    timedout_topup_id = d["topup"]["id"]
    time.sleep(2)  # the invoice reached Kill Bill behind the silent proxy
    kill_proxies()
    start_proxy(9091, "killbill", 8080, "pass")
    paid = None
    deadline = time.time() + 50
    while time.time() < deadline:
        s, d, _ = req("GET", "/api/topups", KEYS["june"])
        paid = next((t for t in d["topups"] if t["id"] == timedout_topup_id), None)
        if paid and paid["status"] == "paid":
            break
        time.sleep(3)
    check("timed-out topup completes on retry", paid and paid["status"] == "paid", paid)

    # exactly one Kill Bill invoice must exist for this top-up
    account_id = subprocess.run(["bash", "-c", (
        "curl -s -u admin:password -H 'X-Killbill-ApiKey: gfkit-dev' -H 'X-Killbill-ApiSecret: gfkit-dev-secret' "
        "-H 'Accept: application/json' \"http://killbill:8080/1.0/kb/accounts?externalKey=t_storefront\" "
        "| python3 -c \"import json,sys; print(json.load(sys.stdin).get('accountId',''))\""
    )], capture_output=True, text=True).stdout.strip()
    invoices = json.loads(subprocess.run(["bash", "-c", (
        f"curl -s -u admin:password -H 'X-Killbill-ApiKey: gfkit-dev' -H 'X-Killbill-ApiSecret: gfkit-dev-secret' "
        f"-H 'Accept: application/json' \"http://killbill:8080/1.0/kb/accounts/{account_id}/invoices\""
    )], capture_output=True, text=True).stdout)
    matching = []
    for inv in invoices:
        detail = json.loads(subprocess.run(["bash", "-c", (
            f"curl -s -u admin:password -H 'X-Killbill-ApiKey: gfkit-dev' -H 'X-Killbill-ApiSecret: gfkit-dev-secret' "
            f"-H 'Accept: application/json' \"http://killbill:8080/1.0/kb/invoices/{inv['invoiceId']}\""
        )], capture_output=True, text=True).stdout)
        for item in detail.get("items", []):
            if item.get("description") == f"Dispatch credits {timedout_topup_id}":
                matching.append(inv["invoiceId"])
    check("exactly one Kill Bill invoice for the top-up", len(matching) == 1, matching)

    print()
    print(f"passed {passed}, failed {failed}")
    return 0 if failed == 0 else 1

code = 1
try:
    code = main()
finally:
    kill_instance_b()
    kill_proxies()
    for p in procs:
        try:
            p.kill()
        except Exception:
            pass
sys.exit(code)
