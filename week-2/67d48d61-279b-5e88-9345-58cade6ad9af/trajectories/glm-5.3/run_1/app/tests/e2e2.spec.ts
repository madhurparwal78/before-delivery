import { test, expect } from "@playwright/test";

const base = "http://localhost:4173";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "maya"));
});

test("phone layout: drawer opens, rows are tall, sheet opens detail", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "maya"));
  await page.goto(`${base}/tasks`);
  await expect(page.getByRole("button", { name: "Departments" })).toBeVisible();
  const rail = page.locator(".rail-area");
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "Departments" }).click();
  await expect(page.getByRole("dialog", { name: "Departments" })).toBeVisible();
  // every tap target in the drawer is at least 44px tall
  const heights = await page.locator(".drawer a, .drawer select").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  // rows are at least 44px tall
  const row = await page.locator("[data-task-id=STG-1]").boundingBox();
  expect(row?.height).toBeGreaterThanOrEqual(44);
  // detail opens as a full-screen sheet
  await page.locator("[data-task-id=STG-1]").tap();
  await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-task-id=STG-1]")).toBeFocused();
  await context.close();
});

test("phone: nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/tasks`);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);
});

test("mid layout: overlay detail pane", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-1]").click();
  await expect(page.getByRole("complementary", { name: "Task details" })).toBeVisible();
  const box = await page.locator(".detail-area").boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(768 - 420);
});

test("board view shows four columns", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/tasks?view=board`);
  for (const col of ["Backlog", "Todo", "In progress", "Done"]) {
    await expect(page.locator(".col-header", { hasText: col })).toBeVisible();
  }
  await expect(page.locator(".col-header", { hasText: "Cancelled" })).toHaveCount(0);
  // Left/Right arrow moves between columns
  const firstTodo = page.locator('[data-group="todo"] .row').first();
  await firstTodo.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[aria-current=true]")).toHaveAttribute("data-task-id", "STG-40");
});

test("upload a plot to STG-37 shows Current", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-37]").click();
  await page.locator("#attach-kind").selectOption("plot");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#attach-file").click(),
  ]);
  await chooser.setFiles({
    name: "plot-rev2.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 revised plot"),
  });
  await expect(page.locator("#notices")).toContainText("plot-rev2.pdf attached to STG-37.", { timeout: 8000 });
  await expect(page.locator("#attachments-list")).toContainText("plot-rev2.pdf");
  await expect(page.locator("#attachments-list")).toContainText("Current");
});

test("new task gets the next number and joins the current cycle", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("#new-task-btn").click();
  await page.fill("#nt-title", "Spike the porch rail");
  await page.locator("#nt-dept").selectOption("carpentry");
  await page.locator("#nt-create").click();
  await expect(page.locator("#notices")).toContainText(/ created\./);
  const notice = (await page.locator("#notices").textContent()) ?? "";
  const m = /(STG-\d+) created\./.exec(notice);
  expect(m).not.toBeNull();
  await expect(page.locator(`[data-task-id=${m![1]}]`)).toBeVisible();
});

test("link a carpentry task to block a paint task", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-4]").click();
  await page.getByRole("button", { name: "Add blocked task" }).click();
  await page.fill("#link-task", "STG-1");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.locator("#notices")).toContainText("STG-4 now blocks STG-1.");
  await expect(page.locator("[data-task-id=STG-1] .chip-blocked")).toBeVisible();
  const blocked = await page.locator("#blocked-count").textContent();
  expect(Number(blocked)).toBe(8);
  await page.locator("[data-task-id=STG-1]").click();
  await page.getByRole("button", { name: "Remove link to STG-4" }).click();
  await expect(page.locator("#notices")).toContainText("STG-4 no longer blocks STG-1.");
});

test("blocked task cannot move to Done", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-13]").click();
  await page.locator("#d-status").selectOption("done");
  await expect(page.locator("#notices")).toContainText("STG-13 is still blocked by STG-12.");
  await expect(page.locator("[data-task-id=STG-13]")).not.toContainText("Done");
});

test("group by cycle with Back stepping through view changes", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("#group-select").selectOption("cycle");
  expect(page.url()).toContain("group=cycle");
  await page.locator("#blocked-only").check();
  expect(page.url()).toContain("blocked=1");
  await page.goBack();
  expect(page.url()).not.toContain("blocked=1");
  expect(page.url()).toContain("group=cycle");
});

test("decline a triage request with a reason", async ({ page }) => {
  await page.goto(`${base}/triage`);
  await page.locator("[data-task-id=STG-63]").focus();
  await page.keyboard.press("d");
  await page.fill("#td-reason", "The chair stays for the blocking moment");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.locator("#notices")).toContainText("STG-63 declined.");
  await page.goto(`${base}/requests`);
  await expect(page.locator("#requests-table")).toContainText("Declined");
});

test("merge a triage request into STG-1", async ({ page }) => {
  await page.goto(`${base}/triage`);
  await page.locator("[data-task-id=STG-61]").focus();
  await page.keyboard.press("m");
  await page.locator("#tm-target").selectOption("STG-1");
  await page.getByRole("button", { name: "Merge" }).click();
  await expect(page.locator("#notices")).toContainText("STG-61 merged into STG-1.");
});

test("priority number keys announce once", async ({ page }) => {
  await page.goto(`${base}/tasks?dept=lighting`);
  await page.locator("[data-task-id=STG-21]").focus();
  await page.keyboard.press("x");
  await page.locator("[data-task-id=STG-22]").focus();
  await page.keyboard.press("x");
  await page.keyboard.press("2");
  await expect(page.locator("#notices")).toContainText("Priority set to High on 2 tasks.");
});

test("closing the last fitting rolls up the parent (STG-51)", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-51]").click();
  await page.locator("#d-status").selectOption("done");
  await expect(page.locator("#notices")).toContainText("STG-51 moved to Done. STG-48 closed.");
  await expect(page.locator("[data-task-id=STG-48] .chip-done")).toBeVisible();
  await expect(page.locator("[data-task-id=STG-47] .freed-badge")).toHaveText("Freed by STG-48");
  await page.locator("[data-task-id=STG-48]").click();
  const rollup = await page.locator("#subtask-rollup").textContent();
  expect(rollup).toContain("3 of 3 sub-tasks done");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#notices")).toContainText("Undo restored 2 tasks. 1 task blocked again.");
});

test("dialog focus trap keeps Tab inside", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("#commands-btn").click();
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.id);
  expect(["palette-input"]).toContain(focused);
  await page.keyboard.press("Escape");
  await expect(page.locator("#commands-btn")).toBeFocused();
});

test("triage dialog keeps Tab inside and returns focus", async ({ page }) => {
  await page.goto(`${base}/triage`);
  const row = page.locator("[data-task-id]").first();
  await row.focus();
  await page.keyboard.press("a");
  const dialog = page.getByRole("dialog", { name: "Accept request" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#ta-dept")).toBeFocused();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => !!document.activeElement?.closest(".dialog"));
  expect(inside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
});
