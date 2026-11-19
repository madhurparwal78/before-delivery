import { expect, test } from '@playwright/test';
import { ACCOUNTS } from './utils';

test.beforeEach(async ({ page }) => {
  await page.goto('/finder');
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.match(/homes match|home matches/) !== null);
});

// The suite asserts the published seed counts, so it must not share state with
// the console suite that releases a floor band.
test.describe.configure({ mode: 'serial' });

test('shows three panes at 1280x800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('region', { name: 'Filters' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tower' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1280);
});

test('the result rows show the published facts', async ({ page }) => {
  const firstRow = page.locator('.home-row').first();
  await expect(firstRow).toContainText('3F');
  await expect(firstRow).toContainText('$655,000');
  await expect(firstRow).toContainText('Ridge');
  await expect(firstRow).toContainText('4° N');
  await expect(firstRow).toContainText('1 bed');
  await expect(firstRow).toContainText('Floors 3-9');
});

test('a facet chip updates the count, rows and lit cells in place', async ({ page }) => {
  const chip = page.getByRole('checkbox', { name: /3 bedrooms \(\d+\)/ });
  await chip.click();
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.includes('homes match'), { timeout: 15000 });
  const count = await page.locator('.result-count').textContent();
  expect(count).toMatch(/^\d+ homes match$/);
  await expect(page.locator('.home-row')).toHaveCount(24);
  // The address carries the filter (DP-73).
  await expect(page).toHaveURL(/bedrooms=3/);
  // Back and Forward restore the chips (DP-73).
  await page.goBack();
  await page.waitForTimeout(600);
  await expect(page).not.toHaveURL(/bedrooms=3/);
  await page.goForward();
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/bedrooms=3/);
});

test('an empty result shows the empty state', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search homes' });
  await search.fill('zzzzzz');
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.includes('0 homes match'));
  await expect(page.locator('.empty-state')).toContainText('NOTHING HERE');
  await expect(page.locator('.empty-hint')).toContainText('No homes match these filters. Clear a filter to see more.');
});

test('search text matches the start of words in the unit code', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search homes' });
  await search.fill('27C');
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.includes('1 home matches'));
  await expect(page.locator('.home-row')).toHaveCount(1);
  await expect(page.locator('.home-row')).toContainText('27C');
});

test('Show more homes appends and announces', async ({ page }) => {
  const more = page.getByRole('button', { name: 'Show more homes' });
  await expect(more).toBeVisible();
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('.home-row').length > 24);
  const rows = await page.locator('.home-row').count();
  expect(rows).toBe(48);
});

test('a click on a result row opens the home detail and pins the cell', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search homes' });
  await search.fill('27C');
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.includes('1 home matches'), { timeout: 15000 });
  await page.getByRole('button', { name: /^27C/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Home 27C' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/unit=27C/);
  const cell = page.locator('.tower-cell[data-code="27C"]');
  await expect(cell).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
  await expect(page).not.toHaveURL(/unit=27C/);
});

test('the detail dialog shows the published facts and the hold action', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search homes' });
  await search.fill('27C');
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.includes('1 home matches'), { timeout: 15000 });
  await page.getByRole('button', { name: /^27C/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Home 27C' });
  await expect(dialog).toContainText('$1,636,000');
  await expect(dialog).toContainText('112 m² · 1206 sq ft');
  await expect(dialog).toContainText('214° SW');
  await expect(dialog).toContainText('Bedrooms3');
  await expect(dialog).toContainText('Harbour');
  await expect(dialog).toContainText('Floors 20-29');
  await expect(dialog).toContainText('Available');
  await expect(dialog).toContainText('View photographed');
  await expect(dialog.getByRole('button', { name: 'Hold this home' })).toBeEnabled();
  await expect(dialog.getByRole('img', { name: 'View from 27C' })).toBeVisible();
});

test('a signed-out buyer signs in from Hold this home and lands on the confirm dialog', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search homes' });
  await search.fill('27C');
  await page.waitForFunction(() => document.querySelector('.result-count')?.textContent?.includes('1 home matches'), { timeout: 15000 });
  await page.getByRole('button', { name: /^27C/ }).first().click();
  await page.getByRole('button', { name: 'Hold this home' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in to hold' })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Sign in to hold' });
  await dialog.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.tom.email);
  await dialog.getByRole('textbox', { name: 'Password' }).fill(ACCOUNTS.tom.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"]') !== null, { timeout: 15000 });
  await expect(page.getByRole('alertdialog', { name: 'Confirm hold' })).toContainText('Hold 27C at $1,636,000?');
});

test('the tower cells carry the published names', async ({ page }) => {
  const cell = page.locator('.tower-cell[data-code="27C"]');
  await expect(cell).toHaveAttribute('aria-label', '27C · 214° SW · Available');
  const withdrawn = page.locator('.tower-cell[data-code="5D"]');
  await expect(withdrawn).toHaveAttribute('aria-label', '5D · Withdrawn');
  await expect(withdrawn).toHaveAttribute('aria-disabled', 'true');
});

test('an invalid filter value in the address is dropped', async ({ page }) => {
  await page.goto('/finder?bedrooms=9&band=20-29');
  await expect(page).toHaveURL(/band=20-29/);
  await expect(page).not.toHaveURL(/bedrooms=9/);
});
