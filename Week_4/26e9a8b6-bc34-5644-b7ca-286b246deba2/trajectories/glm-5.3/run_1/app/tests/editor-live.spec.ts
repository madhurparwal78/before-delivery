// Versions UI, presence, conflicts and live co-editing.

import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:4173';

async function makeWorld(): Promise<Record<string, unknown>> {
  const response = await fetch(BASE + '/api/grading/world', { method: 'POST' });
  return (await response.json()) as Record<string, never>;
}

async function signIn(page: import('@playwright/test').Page, person: { email: string; password: string }): Promise<void> {
  await page.goto(BASE + '/signin');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/dashboard/);
}

test('versions: compare two versions and restore an older one', async ({ page }) => {
  const world = await makeWorld();
  await signIn(page, world.author as { email: string; password: string });
  await page.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).public.slug}`);
  await page.waitForSelector('[role="application"]', { timeout: 10000 });

  // Open Versions.
  await page.getByRole('button', { name: 'Versions' }).click();
  const region = page.getByRole('region', { name: 'Versions' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('checkbox', { name: 'Version 3', exact: true })).toBeVisible();
  await expect(region.getByRole('checkbox', { name: 'Version 2', exact: true })).toBeVisible();
  await expect(region.getByRole('checkbox', { name: 'Version 1', exact: true })).toBeVisible();

  // Pick two by keyboard and compare.
  await region.getByRole('checkbox', { name: 'Version 1', exact: true }).focus();
  await page.keyboard.press('Space');
  await region.getByRole('checkbox', { name: 'Version 3', exact: true }).focus();
  await page.keyboard.press('Space');
  const compare = region.getByRole('button', { name: 'Compare' });
  await expect(compare).not.toHaveAttribute('aria-disabled', 'true');
  await compare.click();
  const compareRegion = page.getByRole('region', { name: 'Version compare' });
  await expect(compareRegion).toBeVisible();
  await expect(compareRegion.getByText('Parts cost difference +€4.90')).toBeVisible();
  await expect(compareRegion.getByText('Added', { exact: true })).toBeVisible();
  await expect(compareRegion.getByText('Removed', { exact: true })).toBeVisible();

  // Restore version 1 through its dialog.
  await region.getByRole('button', { name: 'Restore version 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore version 1' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored version 1 as version 4.')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Latest version 4')).toBeVisible();
  // The compare stays open while the notice shows.
  await expect(compareRegion).toBeVisible();
});

test('presence: the author sees the co-author and their step', async ({ browser }) => {
  const world = await makeWorld();
  const authorContext = await browser.newContext();
  const coauthorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();
  const coauthorPage = await coauthorContext.newPage();

  await signIn(authorPage, world.author as { email: string; password: string });
  await signIn(coauthorPage, world.coauthor as { email: string; password: string });
  await authorPage.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await coauthorPage.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await authorPage.waitForTimeout(1000);
  await coauthorPage.getByLabel('Step 3 title').focus();
  await authorPage.waitForTimeout(2500);
  const people = authorPage.getByRole('list', { name: 'People editing' });
  await expect(people).toContainText(/, step 3/);
  await authorContext.close();
  await coauthorContext.close();
});

test('different fields merge without a dialog', async ({ browser }) => {
  const world = await makeWorld();
  const authorContext = await browser.newContext();
  const coauthorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();
  const coauthorPage = await coauthorContext.newPage();
  await signIn(authorPage, world.author as { email: string; password: string });
  await signIn(coauthorPage, world.coauthor as { email: string; password: string });
  const slug = (world.guides as Record<string, { slug: string }>).draft.slug;
  await authorPage.goto(BASE + `/edit/${slug}`);
  await coauthorPage.goto(BASE + `/edit/${slug}`);
  await authorPage.waitForTimeout(800);
  await coauthorPage.waitForTimeout(800);

  // The author edits step 1 text; the co-author edits the guide title.
  await authorPage.getByLabel('Step 1 text').fill('Author takes this field.');
  await coauthorPage.getByLabel('Guide title').fill('A new shared title');
  await authorPage.waitForTimeout(1000);
  await coauthorPage.waitForTimeout(2500);

  // Both appear on both pages without any conflict dialog.
  await expect(authorPage.getByRole('dialog')).toHaveCount(0);
  await expect(coauthorPage.getByRole('dialog')).toHaveCount(0);
  await expect(authorPage.getByLabel('Guide title')).toHaveValue('A new shared title', { timeout: 6000 });
  await expect(coauthorPage.getByLabel('Step 1 text')).toHaveValue('Author takes this field.', { timeout: 6000 });
  await authorContext.close();
  await coauthorContext.close();
});

test('same-field change opens the conflict dialog and keeps mine', async ({ browser }) => {
  const world = await makeWorld();
  const authorContext = await browser.newContext();
  const coauthorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();
  const coauthorPage = await coauthorContext.newPage();
  await signIn(authorPage, world.author as { email: string; password: string });
  await signIn(coauthorPage, world.coauthor as { email: string; password: string });
  const slug = (world.guides as Record<string, { slug: string }>).draft.slug;
  await authorPage.goto(BASE + `/edit/${slug}`);
  await coauthorPage.goto(BASE + `/edit/${slug}`);
  await authorPage.waitForTimeout(800);
  await coauthorPage.waitForTimeout(800);

  // The co-author types slowly; the author commits the same field mid-typing.
  const authorText = authorPage.getByLabel('Step 1 text');
  const coauthorText = coauthorPage.getByLabel('Step 1 text');
  void coauthorText.pressSequentially('The-co-author-wrote-that', { delay: 90 }).catch(() => {});
  await authorText.fill('The author wrote this.');

  // The incoming change to the field with uncommitted text opens the conflict.
  const dialog = coauthorPage.getByRole('alertdialog', { name: 'Edit conflict' });
  await expect(dialog).toBeVisible({ timeout: 8000 });
  await expect(dialog).toContainText(/changed Step 1 text while you were editing it/);
  await expect(dialog.getByText('Yours', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Theirs', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep mine' }).click();
  await expect(coauthorPage.getByRole('alertdialog')).toHaveCount(0, { timeout: 4000 });
  await authorContext.close();
  await coauthorContext.close();
});
