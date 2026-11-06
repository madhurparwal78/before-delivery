import { test, expect } from "@playwright/test";

const base = "http://localhost:4173";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("promptside-actor", "maya"));
});

test("boot: header, rail, seeded rows, snapshot counts", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Lantern Keepers");
  await expect(page.locator("#blocked-count")).toHaveText("7");
  await expect(page.getByRole("navigation", { name: "Departments" })).toBeVisible();
  await expect(page.locator("[data-task-id=STG-1]")).toBeVisible();
  await expect(page.getByRole("link", { name: /Triage/ })).toContainText("3");
  await expect(page.getByRole("progressbar", { name: "Rehearsal 1 progress" })).toHaveAttribute("aria-valuenow", "3");
  await expect(page.getByRole("combobox", { name: "Working as" })).toBeVisible();
});

test("keyboard: j/k move, x selects, palette assigns", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-1]").focus();
  await page.keyboard.press("j");
  await expect(page.locator("[aria-current=true]")).toHaveAttribute("data-task-id", "STG-2");
  await page.keyboard.press("k");
  await expect(page.locator("[aria-current=true]")).toHaveAttribute("data-task-id", "STG-1");
  await page.keyboard.press("x");
  await expect(page.locator("#selection-text")).toContainText("1 selected");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("#selection-text")).toContainText("2 selected");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.fill("#palette-input", "Assign to Oren Vale");
  await page.keyboard.press("Enter");
  await expect(page.locator("#notices")).toContainText("2 tasks assigned to Oren Vale.");
  await expect(page.locator("[data-task-id=STG-1] .row-owner")).toHaveText("Oren Vale");
  await expect(page.locator("[data-task-id=STG-2] .row-owner")).toHaveText("Oren Vale");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#notices")).toContainText("Undo restored 2 tasks.");
});

test("cascade: STG-12 done frees STG-13 and STG-14", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-12]").click();
  await expect(page.getByRole("complementary", { name: "Task details" })).toBeVisible();
  await page.locator("#d-status").selectOption("done");
  await expect(page.locator("#notices")).toContainText("STG-12 moved to Done. STG-10 closed. 2 tasks freed.", { timeout: 8000 });
  await expect(page.locator("[data-task-id=STG-13]")).toHaveAttribute("data-freed-order", "1");
  await expect(page.locator("[data-task-id=STG-13] .freed-badge")).toHaveText("Freed by STG-12");
  await expect(page.locator("[data-task-id=STG-14]")).toHaveAttribute("data-freed-order", "2");
  await expect(page.locator("[data-task-id=STG-14] .freed-badge")).toHaveText("Freed by STG-10");
  await expect(page.locator("#blocked-count")).toHaveText("5");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-task-id=STG-12]")).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#notices")).toContainText("Undo restored 2 tasks. 2 tasks blocked again.");
});

test("undo re-blocks in reverse order", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-12]").click();
  await page.locator("#d-status").selectOption("done");
  await expect(page.locator("#notices")).toContainText("2 tasks freed.", { timeout: 8000 });
  await page.keyboard.press("Control+z");
  await expect(page.locator("#notices")).toContainText("Undo restored 2 tasks. 2 tasks blocked again.");
  await expect(page.locator("[data-task-id=STG-14] .chip-blocked")).toBeVisible();
  await expect(page.locator("[data-task-id=STG-13] .chip-blocked")).toBeVisible();
  await expect(page.locator("#blocked-count")).toHaveText("7");
});

test("bulk blocked refusal rolls back", async ({ page }) => {
  await page.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-26]").focus();
  await page.keyboard.press("x");
  await page.locator("[data-task-id=STG-46]").focus();
  await page.keyboard.press("x");
  await page.keyboard.press("s");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.fill("#palette-input", "Move to Done");
  await page.keyboard.press("Enter");
  await expect(page.locator("#notices")).toContainText("No tasks changed. 2 of the selected tasks can't take that change.");
});

test("triage decisions reach the intake", async ({ page }) => {
  await page.goto(`${base}/triage`);
  await expect(page.locator("[data-task-id=STG-62]")).toBeVisible();
  await page.locator("[data-task-id=STG-62]").focus();
  await page.keyboard.press("a");
  await expect(page.getByRole("dialog", { name: "Accept request" })).toBeVisible();
  await page.locator("#ta-dept").selectOption("sound");
  await page.locator("#ta-owner").selectOption("kofi");
  await page.locator("#ta-accept").click();
  await expect(page.locator("#notices")).toContainText("STG-62 accepted into Rehearsal 1.");
  await page.goto(`${base}/requests`);
  await expect(page.locator("#requests-table")).toContainText("Accepted");
});

test("live updates: second tab sees the change", async ({ page, context }) => {
  await page.goto(`${base}/tasks`);
  const tab2 = await context.newPage();
  await tab2.addInitScript(() => localStorage.setItem("promptside-actor", "kofi"));
  await tab2.goto(`${base}/tasks`);
  await page.locator("[data-task-id=STG-38]").click();
  await page.locator("#d-priority").selectOption("1");
  await expect(page.locator("#notices")).toContainText("STG-38 priority set to Urgent.");
  await expect(tab2.locator("[data-task-id=STG-38] .row-priority")).toHaveText("Urgent", { timeout: 4000 });
});

test("views live in the address", async ({ page }) => {
  await page.goto(`${base}/tasks?dept=carpentry&blocked=1&group=cycle&row=STG-41`);
  await expect(page.locator("[data-task-id=STG-41]")).toBeVisible();
  await expect(page.locator("[aria-current=true]")).toHaveAttribute("data-task-id", "STG-41");
  await page.reload();
  await expect(page.locator("[aria-current=true]")).toHaveAttribute("data-task-id", "STG-41");
  await expect(page.locator("#group-select")).toHaveValue("cycle");
  await expect(page.locator("#blocked-only")).toBeChecked();
});

test("file a request", async ({ page }) => {
  await page.goto(`${base}/requests`);
  await page.getByRole("button", { name: "File a request" }).click();
  await expect(page.getByRole("dialog", { name: "File a request" })).toBeVisible();
  await page.fill("#fr-title", "Need a chair for the porch scene");
  await page.fill("#fr-name", "Hana Ito");
  await page.locator("#fr-dept").selectOption("props");
  await page.locator("#fr-submit").click();
  await expect(page.locator("#notices")).toContainText("Request filed. It reaches triage within a few seconds.");
});

test("not found page", async ({ page }) => {
  const res = await page.goto(`${base}/nope`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page isn't in the prompt book");
});
