import { JSDOM } from "jsdom";
import fs from "node:fs";

/**
 * A DOM-level smoke check of the chart contract: roles, names and data
 * attributes as the published tests read them. jsdom is a dev tool; it is not
 * part of the served app.
 */
const BASE = "http://127.0.0.1:4173";
const KEY = process.env.GRADING_KEY ?? "twinrow-grading-key-2027";

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  return cookie;
}

async function main(): Promise<number> {
  const unique = Date.now().toString(36);
  const owner = `smoke-${unique}@twinrow.test`;

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
  const cookie = await signIn(owner, "stitchcraft1");

  const html = fs.readFileSync("dist/client/index.html", "utf8");
  const jsdom = (await import("jsdom")).JSDOM;
  const dom = new jsdom(html.replace('<script src="/app.js" defer></script>', ""), {
    url: `${BASE}/patterns/${patternId}`,
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
  const grid = doc.querySelector('[role="grid"][aria-label="Stitch chart"]');
  const failures: string[] = [];
  function check(condition: boolean, label: string): void {
    if (condition) console.log(`ok   ${label}`);
    else {
      failures.push(label);
      console.log(`FAIL ${label}`);
    }
  }

  check(grid !== null, "grid named Stitch chart exists");
  check(grid?.getAttribute("aria-rowcount") === "2", "aria-rowcount");
  check(grid?.getAttribute("aria-colcount") === "10", "aria-colcount");
  const rows = [...(grid?.querySelectorAll('[role="row"]') ?? [])];
  check(rows.length === 2, "one row element per chart row");
  check(rows[0]?.getAttribute("data-row") === "2", "highest row first");
  check(rows[1]?.getAttribute("data-row") === "1", "row 1 at the bottom");
  check(rows[0]?.querySelector('[role="rowheader"]')?.textContent === "Row 2", "row header reads Row 2");
  check(rows[0]?.getAttribute("data-side") === "WS", "data-side WS");
  check(rows[0]?.getAttribute("data-used") === "10", "data-used");
  check(rows[0]?.getAttribute("data-made") === "10", "data-made");
  check(rows[0]?.getAttribute("data-count-state") === "ok", "data-count-state");
  const countCell = rows[0]?.querySelector("[data-count]");
  check(countCell?.textContent === "10", "made count cell");
  const cells = [...(rows[1]?.querySelectorAll('[role="gridcell"][data-col]') ?? [])];
  check(cells.length === 10, "ten stitch cells on row 1");
  check(
    cells[0]?.getAttribute("aria-label") === "Row 1, column 1: Knit, colour A",
    "cell aria-label",
  );
  const cursors = doc.querySelectorAll('[data-cursor="true"]');
  check(cursors.length === 1, "exactly one cursor cell");
  check(cursors[0]?.getAttribute("tabindex") === "0", "cursor has tabindex 0");
  check(cursors[0]?.getAttribute("data-row") === "1", "cursor row 1");
  check(cursors[0]?.getAttribute("data-col") === "1", "cursor col 1");

  const lines = doc.querySelectorAll('[aria-label="Written instructions"] .line-card');
  check(lines.length === 2, "two row cards");
  const lineText = lines[0]?.querySelector("[data-line]")?.textContent ?? "";
  check(lineText === "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)", "row 1 line text");
  const tokens = lines[0]?.querySelectorAll("[data-token]") ?? [];
  check(tokens.length === 3, "three tokens on row 1");
  const errorsList = doc.querySelector('[aria-label="Row errors"]');
  check(errorsList?.textContent?.includes("All rows check out.") ?? false, "error list is clear");

  // Keyboard: arrows move the cursor, letters place symbols, announcements read.
  const press = (key: string, shift = false): void => {
    const active = doc.querySelector('[data-cursor="true"]') as HTMLElement | null;
    active?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true }),
    );
  };
  const announcement = () => doc.querySelector('[aria-label="Cell announcement"]')?.textContent ?? "";
  check(doc.querySelector('[data-cursor="true"]') !== null, "cursor cell present for keyboard entry");

  press("ArrowRight");
  await new Promise((resolve) => setTimeout(resolve, 150));
  check(doc.querySelector('[data-cursor="true"]')?.getAttribute("data-col") === "2", "arrow moves cursor right");
  check(announcement().startsWith("Row 1, column 2"), "move is announced");

  press("k");
  await new Promise((resolve) => setTimeout(resolve, 500));
  check(announcement() === "Placed Knit at row 1, column 2.", "placed symbol is announced");
  check(doc.querySelector('[data-row="1"][data-col="2"]')?.getAttribute("data-stitch") === "k", "letter placed its symbol");
  check(doc.querySelector('[data-cursor="true"]')?.getAttribute("data-col") === "1", "cursor moved left on the right-side row");

  press("ArrowUp");
  await new Promise((resolve) => setTimeout(resolve, 150));
  check(doc.querySelector('[data-cursor="true"]')?.getAttribute("data-row") === "2", "arrow up goes to a higher row");

  // On the wrong-side row the reading direction is left to right.
  press("p");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const wsCursor = doc.querySelector('[data-cursor="true"]');
  check(wsCursor?.getAttribute("data-row") === "2", "letter lands on the wrong-side row");
  check(wsCursor?.getAttribute("data-col") === "2", "cursor moved right on the wrong-side row");
  check(announcement() === "Placed Purl at row 2, column 1.", "wrong-side placement is announced");

  // Delete makes the cursor cell ns and does not move it.
  press("ArrowDown");
  await new Promise((resolve) => setTimeout(resolve, 150));
  press("ArrowLeft");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const before = doc.querySelector('[data-cursor="true"]')?.getAttribute("data-col");
  press("Delete");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterDelete = doc.querySelector('[data-cursor="true"]');
  check(afterDelete?.getAttribute("data-col") === before, "delete does not move the cursor");
  check(announcement() === "Placed No stitch at row 1, column 1.", "delete is announced");

  // Escape clears a shift-made selection.
  press("ArrowRight", true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  check(doc.querySelectorAll('[aria-selected="true"]').length >= 2, "shift and arrow select a rectangle");
  press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 150));
  check(doc.querySelectorAll('[aria-selected="true"]').length === 0, "escape clears the selection");

  console.log(failures.length === 0 ? "\nDOM SMOKE PASS" : `\n${failures.length} DOM FAILURES`);
  return failures.length === 0 ? 0 : 1;

}

void main().then((code) => process.exit(code));
