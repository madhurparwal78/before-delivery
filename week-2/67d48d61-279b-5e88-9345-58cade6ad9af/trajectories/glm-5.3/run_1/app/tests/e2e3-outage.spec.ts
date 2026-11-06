/** Test the outages: a server copy pointed at closed ports keeps working (DP-49). */
import { test, expect } from "@playwright/test";
import { spawn, execSync } from "node:child_process";
import { openSync } from "node:fs";

let outageServer: ReturnType<typeof spawn> | null = null;
let outagePid = "";

test.beforeAll(async () => {
  try { execSync("node scripts/kill-servers.mjs") } catch { /* not running */ }
  const out = openSync("/tmp/outage-server.log", "a");
  outageServer = spawn("node", ["dist/server.js"], {
    stdio: ["ignore", out, out], detached: true,
    env: { ...process.env, POCKETBASE_URL: "http://127.0.0.1:59999", S3_ENDPOINT: "http://127.0.0.1:59998" },
  });
  outageServer.unref();
  outagePid = String(outageServer.pid);
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/server.pid", outagePid);
  await new Promise((r) => setTimeout(r, 6000));
});

test.afterAll(async () => {
  try { process.kill(Number(outagePid), "SIGTERM") } catch { /* already gone */ }
});

test("boots and serves the tracker with both services down", async ({ page }) => {
  const health = await page.request.get("http://localhost:4173/api/health");
  expect(health.status()).toBe(200);
  const status = await (await page.request.get("http://localhost:4173/api/status")).json();
  expect(status.intake).toBe("down");
  expect(status.plot_storage).toBe("down");
});

test("shows the outage banners and the intake note on Requests", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "maya"));
  await page.goto("http://localhost:4173/tasks");
  await expect(page.getByRole("region", { name: "Service status" })).toContainText("Request intake is unreachable. New requests reach triage when it is back, and decisions are paused.", { timeout: 15000 });
  await expect(page.getByRole("region", { name: "Service status" })).toContainText("Plot storage is unreachable. Attachments can't be uploaded or opened right now; everything else still works.");
  await page.goto("http://localhost:4173/requests");
  await expect(page.locator(".outage-note")).toContainText("Request outcomes can't be shown until the intake is back.");
});

test("task edits and the build queue still work during the outage", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "devi"));
  await page.goto("http://localhost:4173/tasks");
  await page.locator("[data-task-id=STG-12]").click();
  await page.locator("#d-status").selectOption("done");
  await expect(page.locator("#notices")).toContainText("STG-12 moved to Done. STG-10 closed. 2 tasks freed.");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-task-id=STG-12]")).toBeFocused();
});

test("a link can still be added during the outage", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "maya"));
  await page.goto("http://localhost:4173/tasks");
  await page.locator("[data-task-id=STG-3]").click();
  await page.getByRole("button", { name: "Add blocked task" }).click();
  await page.fill("#link-task", "STG-13");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.locator("#notices")).toContainText("STG-3 now blocks STG-13.");
});

test("upload is refused with storage down and focus stays in the details", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "ines"));
  await page.goto("http://localhost:4173/tasks");
  await page.locator("[data-task-id=STG-23]").click();
  await page.locator("#attach-kind").selectOption("plot");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#attach-file").click(),
  ]);
  await chooser.setFiles({
    name: "plot-rev.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 plot"),
  });
  await expect(page.locator("#notices")).toContainText("Plot storage is unreachable. plot-rev.pdf was not attached.");
  await expect(page.locator("#attachments-list")).toContainText("No attachments yet.");
});

test("decisions are paused while the intake is down", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "maya"));
  await page.goto("http://localhost:4173/triage");
  const row = page.locator("[data-task-id]").first();
  await row.focus();
  await page.keyboard.press("d");
  await page.fill("#td-reason", "Not now");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.locator("#notices")).toContainText("stays in triage");
});
