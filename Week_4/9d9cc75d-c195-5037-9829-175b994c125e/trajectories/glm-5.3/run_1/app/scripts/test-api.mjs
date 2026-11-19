const BASE = process.env.LOZ_BASE ?? "http://127.0.0.1:4173";

let cookie = "";

async function call(method, path, body, raw) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined && !raw) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = "text/csv";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const ok = (name, cond, extra) => {
  console.log(cond ? "PASS" : "FAIL", name, cond ? "" : JSON.stringify(extra)?.slice(0, 300));
  if (!cond) process.exitCode = 1;
};

async function main() {
  // Platform
  const health = await call("GET", "/api/health");
  ok("health ok", health.status === 200 && health.json.status === "ok");
  const config = await call("GET", "/api/config");
  ok("config", config.status === 200 && typeof config.json.formula_max_chars === "number");

  // Seed
  const seed = await call("POST", "/api/grading/seed", {
    users: [
      { username: "owner", password: "password1" },
      { username: "south_rep", password: "password1" },
      { username: "north_rep", password: "password1" },
    ],
    projects: [
      {
        name: "Tea shop",
        members: { owner: "creator", south_rep: "viewer", north_rep: "viewer" },
      },
    ],
    sources: [{ name: "Fernhollow", project: "Tea shop", sample: "fernhollow" }],
    entitlements: [
      {
        source: "Fernhollow",
        field: "Region",
        users: { owner: ["East", "North", "South", "West"], south_rep: ["South"], north_rep: ["North"] },
      },
    ],
    workbooks: [
      {
        name: "Tea sales",
        project: "Tea shop",
        source: "Fernhollow",
        state: "published",
        sheets: [
          { name: "Region sales", rows: ["Region"], columns: [{ field: "Sales", agg: "SUM" }], color: null, size: null, label: [], detail: [], filters: [], chart: "automatic", totals: false, reference_lines: [], trend: false, sort: {} },
          { name: "Category sales", rows: ["Category"], columns: [{ field: "Sales", agg: "SUM" }], color: null, size: null, label: [], detail: [], filters: [], chart: "automatic", totals: false, reference_lines: [], trend: false, sort: {} },
        ],
        dashboards: [
          { name: "Tea board", sheets: ["Region sales", "Category sales"], actions: [] },
        ],
      },
    ],
  });
  ok("seed 201", seed.status === 201, seed);
  const wbId = seed.json.workbooks["Tea sales"];
  const sheetId = seed.json.sheets["Tea sales/Region sales"];
  const sourceId = seed.json.sources["Fernhollow"];
  ok("seed ids", Boolean(wbId && sheetId && sourceId));

  // Sign in
  const badLogin = await call("POST", "/api/auth/login", { username: "owner", password: "wrong-password" });
  ok("bad login 401", badLogin.status === 401 && badLogin.json.error === "invalid_credentials");
  const login = await call("POST", "/api/auth/login", { username: "owner", password: "password1" });
  ok("login 200", login.status === 200 && login.json.user.username === "owner");

  const me = await call("GET", "/api/me");
  ok("me projects", me.status === 200 && me.json.projects.length === 1 && me.json.projects[0].role === "creator");

  // Workbook and sheet query
  const wb = await call("GET", `/api/workbooks/${wbId}`);
  ok("workbook get", wb.status === 200 && wb.json.state === "published" && wb.json.sheets.length === 2);

  const q = await call("POST", `/api/sheets/${sheetId}/query?gen=1`, {});
  ok("query 200", q.status === 200, q);
  const regionRows = q.json.rows;
  const findRegion = (name) => regionRows.find((r) => r[0] === name);
  ok("query East 435", findRegion("East")?.[1] === 435, regionRows);
  ok("query North 480", findRegion("North")?.[1] === 480);
  ok("query West 325", findRegion("West")?.[1] === 325);
  ok("query chart bar", q.json.chart === "bar");

  // Grading session for south_rep: row-level security
  await call("POST", "/api/grading/session", { username: "south_rep" });
  const q2 = await call("POST", `/api/sheets/${sheetId}/query?gen=1`, {});
  ok("south sees only South", q2.json.rows.length === 1 && q2.json.rows[0][0] === "South" && q2.json.rows[0][1] === 60, q2.json);
  const members = await call("POST", `/api/sheets/${sheetId}/members`, { field: "Stockist", step: "dimension" });
  ok("south stockist list", JSON.stringify(members.json.members) === JSON.stringify(["Dune Mug"]), members.json);
  const otherWb = await call("GET", `/api/workbooks/${"nonexistent"}`);
  ok("unknown id not_found", otherWb.status === 404 && otherWb.json.error === "not_found");

  // Back to owner
  await call("POST", "/api/auth/login", { username: "owner", password: "password1" });

  // Upload CSV flow
  const csv = "a,b\n1,2\n3,4\n";
  const preview = await call("POST", "/api/projects/" + me.json.projects[0].id + "/sources/preview", csv, true);
  ok("preview", preview.status === 200 && preview.json.columns.length === 2 && preview.json.row_count === 2, preview);
  const upload = await call("POST", `/api/projects/${me.json.projects[0].id}/sources?name=My+source&table=data`, csv, true);
  ok("upload 201", upload.status === 201, upload);
  const uploadedSourceId = upload.json.id;
  const download = await call("GET", `/api/sources/${uploadedSourceId}/tables/data/file`);
  ok("download exact bytes", download.status === 200 && download.text === csv, { status: download.status, text: download.text });

  // Formula check
  const fc = await call("POST", "/api/formula/check", { sheet: sheetId, formula: "SUM([Salez])" });
  ok("formula error", fc.status === 200 && fc.json.valid === false && fc.json.message === 'Line 1, column 5: unknown field "Salez".', fc.json);
  const fc2 = await call("POST", "/api/formula/check", { sheet: sheetId, formula: "SUM([Sales])" });
  ok("formula valid", fc2.json.valid === true && fc2.json.type === "number" && fc2.json.aggregate === true);

  // Export
  const ex = await call("POST", "/api/exports", { kind: "csv", sheet: sheetId, filters: [], parameters: {} });
  ok("export queued", ex.status === 202 && ex.json.status === "queued", ex);
  const exJobId = ex.json.id;
  let final = null;
  for (let i = 0; i < 40; i++) {
    const st = await call("GET", `/api/exports/${exJobId}`);
    if (st.json.status === "ready" || st.json.status === "failed") {
      final = st.json;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  ok("export ready", final?.status === "ready", final);
  const file = await call("GET", `/api/exports/${exJobId}/file`);
  ok("export file", file.status === 200 && file.text.includes("Region") && file.text.includes("435"), { text: file.text.slice(0, 200) });
  ok("crosstab CRLF", file.text.includes("\r\n"), JSON.stringify(file.text.slice(0, 50)));

  // Replay: same request returns the running job
  const ex2 = await call("POST", "/api/exports", { kind: "csv", sheet: sheetId, filters: [], parameters: {} });
  ok("export replay 200", ex2.status === 200 || ex2.status === 202, ex2);

  // Refresh and extract state
  const refresh = await call("POST", `/api/sources/${sourceId}/refresh`);
  ok("refresh live", refresh.status === 200 && refresh.json.state === "live", refresh);
  const extract = await call("GET", `/api/sources/${sourceId}/extract`);
  ok("extract rows 16", extract.json.rows === 16, extract.json);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
