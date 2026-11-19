import { expect, test } from '@playwright/test';

test('the hero is visible quickly with the published copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HIGHWATER', level: 1 })).toBeVisible();
  await expect(page.getByText('Look out of the window before you buy it.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find your floor' })).toHaveAttribute('href', '/finder');
});

test('scrolling descends the camera and moves the readout', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.readout')).toHaveText('Floor 38');
  await page.mouse.wheel(0, 2400);
  await page.waitForTimeout(300);
  const readout = await page.locator('.readout').textContent();
  expect(readout).toMatch(/Floor (1[0-9]|2[0-2])/);
  await page.mouse.wheel(0, 2400);
  await page.waitForTimeout(300);
  const lower = await page.locator('.readout').textContent();
  expect(Number(lower?.replace('Floor ', ''))).toBeLessThan(Number(readout?.replace('Floor ', '')));
});

test('the band sections carry the giant cropped numerals in order', async ({ page }) => {
  await page.goto('/');
  const numerals = page.locator('.band-section .giant');
  await expect(numerals).toHaveCount(5);
  await expect(numerals.nth(0)).toHaveText('38');
  await expect(numerals.nth(4)).toHaveText('9');
});

test('the tally reads the available count', async ({ page }) => {
  await page.goto('/');
  const tally = page.getByRole('region', { name: 'Available now' });
  await expect(tally).toBeVisible();
  await expect(tally).toContainText(/homes available now/);
});

test('the landing tower image carries the floor name', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('.hero-stage canvas');
  await expect(canvas).toHaveAttribute('aria-label', 'Highwater tower at floor 38');
});
