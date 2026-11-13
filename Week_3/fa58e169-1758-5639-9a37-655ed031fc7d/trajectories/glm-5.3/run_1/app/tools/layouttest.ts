/**
 * Layout width checks: data-layout changes exactly at 600 and 1024 px.
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";

const BASE = "http://127.0.0.1:4173";
const KEY = process.env.GRADING_KEY ?? "twinrow-grading-key-2027";

const unique = Date.now().toString(36);
const owner = `layout-${unique}@twinrow.test`;
const setup = await fetch(`${BASE}/api/grading/setup`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-grading-key": KEY },
  body: JSON.stringify({
    users: [{ email: owner, name: "Asha Verma", password: "stitchcraft1", verified: true }],
    patterns: [
      {
        key: "rib",
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
        versions: [],
        published: false,
        testers: [],
        invites: [],
      },
    ],
  }),
});
const setupBody = (await setup.json()) as { patterns: Record<string, string> };
const patternId = setupBody.patterns["rib"]!;
const session = await fetch(`${BASE}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: owner, password: "stitchcraft1" }),
});
const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0]!;

const html = fs.readFileSync("dist/client/index.html", "utf8");

async function layoutAt(width: number): Promise<string | null> {
  const dom = new JSDOM(html.replace('<script src="/app.js" defer></script>', ""), {
    url: `${BASE}/patterns/${patternId}`,
    runScripts: "dangerously",
    pretendToBeVisual: false,
  });
  const { window } = dom;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
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
  await new Promise((resolve) => setTimeout(resolve, 900));
  return window.document.querySelector("#root > div")?.getAttribute("data-layout") ?? null;
}

let failures = 0;
async function check(width: number, wanted: string): Promise<void> {
  const actual = await layoutAt(width);
  if (actual === wanted) console.log(`ok   ${width} px reads ${wanted}`);
  else {
    failures++;
    console.log(`FAIL ${width} px: got ${actual}, wanted ${wanted}`);
  }
}

await check(375, "phone");
await check(599, "phone");
await check(600, "tablet");
await check(1023, "tablet");
await check(1024, "desktop");
await check(1280, "desktop");

console.log(failures === 0 ? "\nLAYOUT PASS" : `\n${failures} LAYOUT FAILURES`);
process.exit(failures === 0 ? 0 : 1);
