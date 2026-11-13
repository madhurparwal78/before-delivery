/**
 * A DOM check of the compare page: pickers, summary line and the diff grid.
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";

const BASE = "http://127.0.0.1:4173";
const KEY = process.env.GRADING_KEY ?? "twinrow-grading-key-2027";

const unique = Date.now().toString(36);
const owner = `cmp-${unique}@twinrow.test`;
const setup = await fetch(`${BASE}/api/grading/setup`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-grading-key": KEY },
  body: JSON.stringify({
    users: [{ email: owner, name: "Asha Verma", password: "stitchcraft1", verified: true }],
    patterns: [
      {
        key: "cmp",
        owner,
        name: "Compare swatch",
        craft: "knit",
        mode: "flat",
        terms: null,
        castOn: 2,
        width: 3,
        height: 2,
        rows: {},
        colours: [{ letter: "A", name: "Main", hex: "#dce8f7" }],
        colourRows: {},
        repeats: [],
        coDesigners: [],
        versions: [
          { note: "first", rows: { 1: "k k" }, colourRows: {}, height: 1, width: 2, castOn: 2, repeats: [], colours: [] },
          { note: "second", rows: { 1: "k p k", 2: "k k k" }, colourRows: {}, height: 2, width: 3, castOn: 2, repeats: [], colours: [] },
        ],
        published: false,
        testers: [],
        invites: [],
      },
    ],
  }),
});
const setupBody = (await setup.json()) as { patterns: Record<string, string> };
const patternId = setupBody.patterns["cmp"]!;
const session = await fetch(`${BASE}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: owner, password: "stitchcraft1" }),
});
const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0]!;

// the summary of the brief's worked example
const compare = await fetch(`${BASE}/api/patterns/${patternId}/compare?a=1&b=2`, { headers: { cookie } });
const compareBody = (await compare.json()) as { summary: string };
let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
}
check(
  compareBody.summary === "1 row changed, 1 row added, 0 rows removed, 2 cells changed. Stitches 2 to 3.",
  "compare summary matches the worked example",
  compareBody.summary,
);

const html = fs.readFileSync("dist/client/index.html", "utf8");
const dom = new JSDOM(html.replace('<script src="/app.js" defer></script>', ""), {
  url: `${BASE}/patterns/${patternId}/compare?a=1&b=2`,
  runScripts: "dangerously",
  pretendToBeVisual: false,
});
const { window } = dom;
class StubSocket {
  readyState = 3;
  send(): void {}
  close(): void {}
}
window.WebSocket = StubSocket as unknown as typeof window.WebSocket;
window.fetch = (path: string, init: RequestInit) =>
  fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addListener() {}, removeListener() {} }));
window.eval(fs.readFileSync("dist/client/app.js", "utf8"));
await new Promise((resolve) => setTimeout(resolve, 1200));

const doc = window.document;
const status = doc.querySelector('[aria-label="Compare result"]')?.textContent ?? "";
check(status === compareBody.summary, "status Compare result reads the summary", status);
const grid = doc.querySelector('[aria-label="Compare chart"]');
check(grid !== null, "grid named Compare chart exists");
const row1 = [...(grid?.querySelectorAll('[data-row="1"] [data-col]') ?? [])];
check(row1.length === 3, "row 1 has three cells");
const diffs = row1.map((cell) => cell.getAttribute("data-diff"));
check(JSON.stringify(diffs) === JSON.stringify(["same", "changed", "added"]), "row 1 diffs read same, changed, added", JSON.stringify(diffs));
const row2 = [...(grid?.querySelectorAll('[data-row="2"] [data-col]') ?? [])];
check(row2.every((cell) => cell.getAttribute("data-diff") === "added"), "row 2 is all added");
const fromPick = doc.querySelector('[aria-label="From version"]') as HTMLSelectElement | null;
const toPick = doc.querySelector('[aria-label="To version"]') as HTMLSelectElement | null;
check(fromPick?.value === "1", "From version picks 1", fromPick?.value);
check(toPick?.value === "2", "To version picks 2", toPick?.value);

console.log(failures === 0 ? "\nCOMPARE PASS" : `\n${failures} COMPARE FAILURES`);
process.exit(failures === 0 ? 0 : 1);
