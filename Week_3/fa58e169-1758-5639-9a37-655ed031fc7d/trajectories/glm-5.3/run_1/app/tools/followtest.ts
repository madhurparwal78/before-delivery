/**
 * DOM checks for the follow page: counter, buttons, the current-row pin and
 * the public read-only page.
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";

const BASE = "http://127.0.0.1:4173";
const KEY = process.env.GRADING_KEY ?? "twinrow-grading-key-2027";

const unique = Date.now().toString(36);
const owner = `follow-${unique}@twinrow.test`;
const tester = `tester-${unique}@twinrow.test`;
const setup = await fetch(`${BASE}/api/grading/setup`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-grading-key": KEY },
  body: JSON.stringify({
    users: [
      { email: owner, name: "Asha Verma", password: "stitchcraft1", verified: true },
      { email: tester, name: "Tomas Reed", password: "stitchcraft3", verified: true },
    ],
    patterns: [
      {
        key: "follow",
        owner,
        name: "Rib swatch",
        craft: "knit",
        mode: "flat",
        terms: null,
        castOn: 10,
        width: 10,
        height: 2,
        rows: { 1: "k k p p k k p p k k", 2: "k k p p k k p p k k" },
        colours: [{ letter: "A", name: "Main", hex: "#dce8f7" }],
        colourRows: {},
        repeats: [],
        coDesigners: [],
        versions: [
          { note: "", rows: { 1: "k k p p k k p p k k", 2: "k k p p k k p p k k" }, colourRows: {}, height: 2, width: 10, castOn: 10, repeats: [], colours: [] },
        ],
        published: true,
        testers: [{ email: tester, version: 1, row: 1, notes: [] }],
        invites: [],
      },
    ],
  }),
});
const setupBody = (await setup.json()) as { patterns: Record<string, string> };
const patternId = setupBody.patterns["follow"]!;

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function openPage(url: string, cookie: string): Promise<Document> {
  const html = fs.readFileSync("dist/client/index.html", "utf8");
  const dom = new JSDOM(html.replace('<script src="/app.js" defer></script>', ""), {
    url,
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
  return window.document;
}

async function signIn(email: string, password: string): Promise<string> {
  const session = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (session.headers.get("set-cookie") ?? "").split(";")[0]!;
}

// The tester's follow page.
const testerCookie = await signIn(tester, "stitchcraft3");
const followDoc = await openPage(`${BASE}/follow/${patternId}`, testerCookie);
const counter = followDoc.querySelector('[aria-label="Row counter"]')?.textContent;
check(counter === "Row 1 of 2", "counter reads Row 1 of 2", counter ?? "missing");
const nextButton = followDoc.querySelector('[aria-label="Next row"]') as HTMLButtonElement | null;
check(nextButton !== null, "Next row button exists");
check(nextButton?.disabled === false, "Next row is enabled at row 1");
const prevButton = followDoc.querySelector('[aria-label="Previous row"]') as HTMLButtonElement | null;
check(prevButton?.disabled === true, "Previous row is disabled at row 1");
const current = followDoc.querySelector('[data-follow="current"]');
check(current?.getAttribute("data-row") === "1", "row 1 carries data-follow current");
const done = followDoc.querySelector('[data-follow="done"]');
check(done === null, "no row below row 1");
const todo = followDoc.querySelector('[data-follow="todo"]');
check(todo?.getAttribute("data-row") === "2", "row 2 carries data-follow todo");
const version = followDoc.querySelector('[aria-label="Version"]')?.textContent;
check(version === "Version 1", "version status reads Version 1", version ?? "missing");

// Stepping the row updates the counter and the marks.
nextButton?.click();
await new Promise((resolve) => setTimeout(resolve, 700));
const counterAfter = followDoc.querySelector('[aria-label="Row counter"]')?.textContent;
check(counterAfter === "Row 2 of 2", "counter reads Row 2 of 2 after a step", counterAfter ?? "missing");
const nextAfter = followDoc.querySelector('[aria-label="Next row"]') as HTMLButtonElement | null;
check(nextAfter?.disabled === true, "Next row is disabled at the last row");

// The public page.
const publicDoc = await openPage(`${BASE}/p/${patternId}`, "");
const grid = publicDoc.querySelector('[aria-label="Stitch chart"]');
check(grid !== null, "public page shows the chart");
const sheet = publicDoc.querySelector('a[href$="/sheet.pdf"]');
check(sheet?.textContent === "Download sheet", "public page links the sheet");
const lines = publicDoc.querySelectorAll('[aria-label="Written instructions"] .line-card');
check(lines.length === 2, "public page shows two written lines");
const editButtons = publicDoc.querySelectorAll('button');
check(
  ![...editButtons].some((button) => button.textContent?.startsWith("Edit row")),
  "public page carries no Edit row buttons",
);
const pinButton = publicDoc.querySelector('[aria-label="Pin row 1"]');
check(pinButton !== null, "public page carries the Pin row button");

// The public page carries no tester details.
const publicText = publicDoc.body.textContent ?? "";
check(!publicText.includes("Tomas Reed"), "public page carries no tester name");
check(!publicText.includes("Tight at the edge"), "public page carries no note text");

console.log(failures === 0 ? "\nFOLLOW PASS" : `\n${failures} FOLLOW FAILURES`);
process.exit(failures === 0 ? 0 : 1);
