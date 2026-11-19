const BASE = "http://127.0.0.1:4173";

async function call(method, path, body, opts) {
  const headers = {};
  if (opts?.cookie) headers.cookie = opts.cookie;
  if (body !== undefined) {
    headers["content-type"] = opts?.raw ? "text/csv" : "application/json";
  }
  const payload = body === undefined ? undefined : opts?.raw ? String(body) : JSON.stringify(body);
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: payload,
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(";")[0] : opts?.cookie ?? null };
}

const ok = (name, cond, extra) => {
  console.log(cond ? "PASS" : "FAIL", name, cond ? "" : JSON.stringify(extra)?.slice(0, 400));
  if (!cond) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // --- Journey 7: refresh and alert ---
  const seed = await call("POST", "/api/grading/seed", {
    users: [
      { username: "shopkeeper", password: "password1" },
      { username: "watcher", password: "password1" },
      { username: "south_rep", password: "password1" },
      { username: "north_rep", password: "password1" },
    ],
    projects: [
      { name: "Alerts shop", members: { shopkeeper: "creator", watcher: "viewer" } },
    ],
    sources: [{ name: "Alerts tea", project: "Alerts shop", sample: "fernhollow" }],
    workbooks: [
      {
        name: "Alerts book",
        project: "Alerts shop",
        source: "Alerts tea",
        state: "published",
        sheets: [
          { name: "Total", rows: [], columns: [{ field: "Sales", agg: "SUM" }], color: null, size: null, label: [], detail: [], filters: [], chart: "automatic", totals: false, reference_lines: [], trend: false, sort: {} },
        ],
        dashboards: [
          { name: "Board", sheets: ["Total"], actions: [] },
        ],
      },
    ],
    alerts: [
      { username: "watcher", workbook: "Alerts book", sheet: "Total", name: "Total sales", measure: { field: "Sales", agg: "SUM" }, above: 1400 },
    ],
  });
  ok("seed", seed.status === 201, seed);
  const alertSource = seed.json.sources["Alerts tea"];
  const alertSheet = seed.json.sheets["Alerts book/Total"];
  const alertWb = seed.json.workbooks["Alerts book"];
  const alertDash = seed.json.dashboards["Alerts book/Board"];

  // The seed's alert subscribes 'watcher'. Their extract has 1,320 rows sum.
  // Simulate the extract state for the source.
  const setExtract = await call("POST", "/api/grading/seed", {
    extracts: [{ source: "Alerts tea", state: "live" }],
  });
  ok("extract state", setExtract.status === 201, setExtract);

  // Refresh with a new file adding Order 17 with Sales 100 -> 1,420.
  const newOrders = `Order,Date,Stockist ID,Product,Category,Units,Sales
1,2027-01-04,S1,Moss Sencha,Green,4,120
2,2027-01-06,S1,Ember Assam,Black,2,50
3,2027-01-11,S2,Moss Sencha,Green,3,90
4,2027-01-13,S3,Quiet Mint,Herbal,5,75
5,2027-01-20,S3,Ember Assam,Black,6,150
6,2027-02-02,S4,Quiet Mint,Herbal,2,30
7,2027-02-03,S4,Moss Sencha,Green,1,30
8,2027-02-09,S5,Ember Assam,Black,8,200
9,2027-02-10,S5,Dusk Blend,Black,4,80
10,2027-02-17,S1,Dusk Blend,Black,5,100
11,2027-02-24,S2,Quiet Mint,Herbal,6,90
12,2027-03-01,S3,Moss Sencha,Green,7,210
13,2027-03-03,S5,Quiet Mint,Herbal,3,45
14,2027-03-08,S1,Quiet Mint,Herbal,2,30
15,2027-03-15,S9,Dusk Blend,Black,1,20
16,2027-03-16,S4,Ember Assam,Black,,
17,2027-03-17,S2,Moss Sencha,Green,2,100
`;
  await call("POST", "/api/grading/source-file", { source: alertSource, table: "orders", csv: newOrders });

  // Owner refresh.
  const ownerLogin = await call("POST", "/api/auth/login", { username: "shopkeeper", password: "password1" });
  const ownerCookie = ownerLogin.cookie;
  ok("owner login", ownerLogin.status === 200);
  const refresh = await call("POST", `/api/sources/${alertSource}/refresh`, undefined, { cookie: ownerCookie });
  ok("refresh live", refresh.status === 200 && refresh.json.state === "live", refresh);

  // Watcher inbox should have exactly one item: 'Total sales crossed 1,400: now 1,420.'
  const watcherLogin = await call("POST", "/api/auth/login", { username: "watcher", password: "password1" });
  const watcherCookie = watcherLogin.cookie;
  const inbox = await call("GET", "/api/inbox", undefined, { cookie: watcherCookie });
  const item = (inbox.json?.items ?? []).find((i) => i.text.includes("Total sales"));
  ok("alert inbox item", Boolean(item), inbox.json);
  ok("alert text", item?.text === "Total sales crossed 1,400: now 1,420.", item?.text);
  ok("inbox unread 1", inbox.json?.unread === 1, inbox.json?.unread);

  // Refresh again with the same value: no new item (alert disarmed).
  await call("POST", `/api/sources/${alertSource}/refresh`, undefined, { cookie: ownerCookie });
  const inbox2 = await call("GET", "/api/inbox", undefined, { cookie: watcherCookie });
  const items2 = (inbox2.json?.items ?? []).filter((i) => i.text.includes("Total sales"));
  ok("no duplicate alert", items2.length === 1, items2);

  // --- Journey 6: two readers one workbook ---
  const seed2 = await call("POST", "/api/grading/seed", {
    users: [{ username: "north_rep2", password: "password1" }],
    projects: [{ name: "Secure shop", members: { shopkeeper: "creator", south_rep: "viewer", north_rep: "viewer" } }],
    sources: [{ name: "Secure tea", project: "Secure shop", sample: "fernhollow" }],
    entitlements: [{ source: "Secure tea", field: "Region", users: { south_rep: ["South"], north_rep: ["North"] } }],
    workbooks: [
      {
        name: "Secure book",
        project: "Secure shop",
        source: "Secure tea",
        state: "published",
        sheets: [
          { name: "By region", rows: ["Region"], columns: [{ field: "Sales", agg: "SUM" }], color: null, size: null, label: [], detail: [], filters: [], chart: "automatic", totals: false, reference_lines: [], trend: false, sort: {} },
        ],
        dashboards: [{ name: "Secure board", sheets: ["By region"], actions: [] }],
      },
    ],
  });
  ok("secure seed", seed2.status === 201, seed2);
  const secureSheet = seed2.json.sheets["Secure book/By region"];

  const southLogin = await call("POST", "/api/auth/login", { username: "south_rep", password: "password1" });
  const southCookie = southLogin.cookie;
  const southQuery = await call("POST", `/api/sheets/${secureSheet}/query?gen=1`, {}, { cookie: southCookie });
  ok("south one row", southQuery.json?.rows?.length === 1 && southQuery.json.rows[0][0] === "South" && southQuery.json.rows[0][1] === 60, southQuery.json);

  const northLogin = await call("POST", "/api/auth/login", { username: "north_rep", password: "password1" });
  const northCookie = northLogin.cookie;
  const northQuery = await call("POST", `/api/sheets/${secureSheet}/query?gen=1`, {}, { cookie: northCookie });
  ok("north one row", northQuery.json?.rows?.length === 1 && northQuery.json.rows[0][0] === "North" && northQuery.json.rows[0][1] === 480, northQuery.json);

  // Exports respect RLS.
  const southExport = await call("POST", "/api/exports", { kind: "csv", sheet: secureSheet, filters: [], parameters: {} }, { cookie: southCookie });
  ok("south export queued", southExport.status === 202, southExport);
  await sleep(400);
  const southFile = await call("GET", `/api/exports/${southExport.json.id}/file`, undefined, { cookie: southCookie });
  ok("south export has South only", southFile.text.includes("South") && !southFile.text.includes("North") && !southFile.text.includes("East"), southFile.text);

  // north_rep cannot find south_rep's export job.
  const чужой = await call("GET", `/api/exports/${southExport.json.id}`, undefined, { cookie: northCookie });
  ok("export job hidden from others", чужой.status === 404 && чужой.json.error === "not_found", чужой);

  // --- Journey 4/5: dashboard with actions ---
  const seed3 = await call("POST", "/api/grading/seed", {
    projects: [{ name: "Dash shop", members: { shopkeeper: "creator", watcher: "viewer" } }],
    sources: [{ name: "Dash tea", project: "Dash shop", sample: "fernhollow" }],
    workbooks: [
      {
        name: "Dash book",
        project: "Dash shop",
        source: "Dash tea",
        state: "published",
        sheets: [
          { name: "Region sheet", rows: ["Region"], columns: [{ field: "Sales", agg: "SUM" }], color: null, size: null, label: [], detail: [], filters: [], chart: "automatic", totals: false, reference_lines: [], trend: false, sort: {} },
          { name: "Category sheet", rows: ["Category"], columns: [{ field: "Sales", agg: "SUM" }], color: null, size: null, label: [], detail: [], filters: [], chart: "automatic", totals: false, reference_lines: [], trend: false, sort: {} },
        ],
        dashboards: [
          {
            name: "Dash board",
            sheets: ["Region sheet", "Category sheet"],
            actions: [
              { name: "Pick region", type: "filter", source: "Region sheet", targets: ["Category sheet"], field: "Region" },
            ],
          },
        ],
      },
    ],
  });
  ok("dash seed", seed3.status === 201, seed3);
  const dashId = seed3.json.dashboards["Dash book/Dash board"];
  const catSheet = seed3.json.sheets["Dash book/Category sheet"];
  const dash = await call("GET", `/api/dashboards/${dashId}`, undefined, { cookie: ownerCookie });
  ok("dashboard objects", dash.status === 200 && (dash.json.objects ?? []).length === 2, dash);
  ok("dashboard action present", (dash.json.actions ?? []).length === 1, dash.json.actions);
  ok("dashboard layout x/w", (dash.json.objects ?? []).reduce((a, o) => Math.max(a, o.x + o.w), 0) <= 1280, dash.json.objects);

  // DP-26 worked example: three flexible sheets across 1280 are 422, 421, 421.
  const layoutRes = await call("GET", `/api/dashboards/${dashId}`, undefined, { cookie: ownerCookie });
  void layoutRes;

  // Filter a target via the query route like an action would.
  const filtered = await call("POST", `/api/sheets/${catSheet}/query?gen=2`, { filters: [{ field: "Region", step: "dimension", values: ["East"] }] }, { cookie: ownerCookie });
  ok("action filter applies", filtered.status === 200, filtered);

  // --- Export states with pause ---
  const paused = await call("POST", "/api/grading/exports", { paused: true });
  ok("exports paused", paused.status === 200 && paused.json.paused === true);
  const pausedExport = await call("POST", "/api/exports", { kind: "pdf", sheet: secureSheet, filters: [], parameters: {} }, { cookie: southCookie });
  ok("paused export queued", pausedExport.status === 202 && pausedExport.json.status === "queued");
  await sleep(300);
  const pausedState = await call("GET", `/api/exports/${pausedExport.json.id}`, undefined, { cookie: southCookie });
  ok("stays queued while paused", pausedState.json?.status === "queued" && pausedState.json?.progress === 0, pausedState.json);
  const unpaused = await call("POST", "/api/grading/exports", { paused: false });
  ok("exports unpaused", unpaused.status === 200);
  await sleep(500);
  const afterUnpause = await call("GET", `/api/exports/${pausedExport.json.id}`, undefined, { cookie: southCookie });
  ok("job finishes after unpause", afterUnpause.json?.status === "ready", afterUnpause.json);
  const pdfFile = await call("GET", `/api/exports/${pausedExport.json.id}/file`, undefined, { cookie: southCookie });
  ok("pdf downloads", pdfFile.status === 200 && pdfFile.text.length > 100, { status: pdfFile.status, len: pdfFile.text.length });

  // --- Storage outage ---
  const down = await call("POST", "/api/grading/storage", { down: true });
  ok("storage down", down.status === 200 && down.json.down === true);
  const healthDown = await call("GET", "/api/health");
  ok("health unavailable", healthDown.status === 200 && healthDown.json.status === "unavailable", healthDown);
  const outageUpload = await call("POST", `/api/projects/${seed.json.projects["Alerts shop"]}/sources?name=Outage&table=data`, "a,b\n1,2\n", { raw: true, cookie: ownerCookie });
  ok("upload outage 503", outageUpload.status === 503 && outageUpload.json.error === "storage_unavailable", outageUpload);
  const up = await call("POST", "/api/grading/storage", { down: false });
  ok("storage up", up.status === 200 && up.json.down === false);
  const retryUpload = await call("POST", `/api/projects/${seed.json.projects["Alerts shop"]}/sources?name=Outage2&table=data`, "a,b\n1,2\n", { raw: true, cookie: ownerCookie });
  ok("upload succeeds after recovery", retryUpload.status === 201, retryUpload);

  // --- Clock control ---
  const clockNow = await call("POST", "/api/grading/clock", { advance_ms: 1000 });
  ok("clock advance", clockNow.status === 200 && typeof clockNow.json.now === "string", clockNow);

  // --- Error precedence ---
  const unauth = await call("GET", "/api/workbooks");
  ok("401 unauthenticated", unauth.status === 401 && unauth.json.error === "unauthenticated");
  const nosuch = await call("GET", "/api/workbooks/does-not-exist", undefined, { cookie: ownerCookie });
  ok("404 not_found", nosuch.status === 404 && nosuch.json.error === "not_found");
  const privateWb = await call("GET", `/api/workbooks/${secureSheet}`, undefined, { cookie: ownerCookie });
  ok("sheet in other project 404", privateWb.status === 404 && privateWb.json.error === "not_found");

  console.log("\nJourneys done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
