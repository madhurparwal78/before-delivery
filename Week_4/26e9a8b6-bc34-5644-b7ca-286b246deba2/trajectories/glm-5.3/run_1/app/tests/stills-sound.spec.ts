// Stills without WebGL, sound laziness, reduced motion figures.

import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:4173';

test('without WebGL the stage shows a still', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // WebGL unavailable: getContext returns null.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return original.call(this, type as never, ...rest);
    };
  });
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs?step=3');
  await page.waitForTimeout(800);
  const stage = page.locator('[role="application"]');
  await expect(stage).toHaveAttribute('data-state', 'still');
  const img = stage.locator('img');
  await expect(img).toHaveAttribute('src', /stills\/3/);
  await expect(img).toHaveAttribute('alt', 'Coffee grinder: fit new burrs, step 3 still');
  await expect(page.locator('[data-status="stage"]')).toHaveText('3D view is not available here. Showing a still of this step.');
  // The step text sits beside it.
  await expect(page.getByRole('heading', { name: 'Draw out the lower burr' })).toBeVisible();

  // Next step changes the still together with the text.
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.waitForTimeout(200);
  await expect(stage.locator('img')).toHaveAttribute('src', /stills\/4/);
  await expect(stage.locator('img')).toHaveAttribute('alt', 'Coffee grinder: fit new burrs, step 4 still');
  await expect(page.getByRole('heading', { name: 'Fit the new burr set' })).toBeVisible();
  await context.close();
});

test('sound stays off until pressed', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs');
  await page.waitForTimeout(600);
  const button = page.getByRole('button', { name: 'Workshop sound' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  // No audio context exists before the first press.
  const hasContext = await page.evaluate(() => {
    const names = Object.getOwnPropertyNames(window);
    return names.includes('__pwAudio');
  });
  expect(hasContext).toBe(false);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const gain = await page.evaluate(() => (window as unknown as { __pwMasterGain?: { gain: { value: number } } }).__pwMasterGain?.gain.value);
  expect(gain).toBe(0.25);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const gainOff = await page.evaluate(() => (window as unknown as { __pwMasterGain?: { gain: { value: number } } }).__pwMasterGain?.gain.value);
  expect(gainOff).toBe(0);
});

test('sound=off hides the sound button', async ({ page }) => {
  await page.goto(BASE + '/embed/coffee-grinder-fit-new-burrs?sound=off');
  await page.waitForTimeout(600);
  await expect(page.getByRole('button', { name: 'Workshop sound' })).toHaveCount(0);
});

test('reduced motion shows final figures at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs');
  const figures = page.locator('[data-figure="total-cost"]');
  // The final text appears without a count-up.
  await expect(figures).toHaveText('€21.30', { timeout: 3000 });
  await expect(page.locator('[data-figure="part-count"]')).toHaveText('9');
});

test('reduced motion: pose snaps with the camera matrices final', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.waitForTimeout(150);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '2');
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-explode', '0.250');
});
