import { expect, test } from '@playwright/test';

const PERFORMANCE = 'marrow-quartet-late-set';

test('the wedge draws its left edge, then its right edge, then its fill', async ({ page }) => {
  await page.goto(`/p/${PERFORMANCE}?section=ST&seat=ST-A-15&tier=all`);
  const samples = await page.evaluate(async () => {
    const read = () => {
      const part = (name: string) => document.querySelector(`[data-part="${name}"]`);
      const line = (name: string) => {
        const element = part(name) as SVGLineElement | null;
        if (element === null) return 0;
        return Math.hypot(
          element.x2.baseVal.value - element.x1.baseVal.value,
          element.y2.baseVal.value - element.y1.baseVal.value,
        );
      };
      const fill = part('fill');
      return {
        left: line('left-edge'),
        right: line('right-edge'),
        fill: fill === null ? 0 : Number(fill.getAttribute('opacity') ?? '1'),
      };
    };
    const taken: { at: number; left: number; right: number; fill: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < 800) {
      taken.push({ at: performance.now() - start, ...read() });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return taken;
  });
  const started = (key: 'left' | 'right' | 'fill'): number =>
    samples.find((sample) => sample[key] > 0.01)?.at ?? Number.POSITIVE_INFINITY;
  expect(started('left')).toBeLessThan(started('right'));
  expect(started('right')).toBeLessThan(started('fill'));
  const settled = samples[samples.length - 1]!;
  expect(settled.fill).toBeCloseTo(1, 2);
  expect(started('fill')).toBeLessThan(750);
});

test('the wedge marks a taken seat and a seat of this buyer', async ({ page, browser }) => {
  await page.goto(`/p/${PERFORMANCE}?section=CI&seat=CI-B-9&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator('[role="gridcell"][data-seat="CI-B-9"]').click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(page.getByRole('region', { name: 'Cart' })).toContainText('Circle row B seat 9');
  await expect(page.locator('[data-sightline]')).toHaveAttribute('data-state', 'held_by_you');
  await expect(page.getByRole('group', { name: 'Sightline' })).toContainText('Held by you');

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(`/p/${PERFORMANCE}?section=CI&seat=CI-B-9&tier=all`);
  await expect(rival.locator('[data-sightline]')).toHaveAttribute('data-state', 'taken');
  await expect(rival.getByRole('group', { name: 'Sightline' })).toContainText('Taken');
  const hatched = await rival.evaluate(() => {
    const fill = document.querySelector('[data-part="fill"]')!;
    return window.getComputedStyle(fill).fill;
  });
  expect(hatched).toContain('url');
  await rivalContext.close();
});

test('a selected seat taken by someone else leaves the selection with a notice', async ({ page, browser }) => {
  await page.goto(`/p/${PERFORMANCE}?section=ST&seat=ST-G-21&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator('[role="gridcell"][data-seat="ST-G-21"]').click();
  await expect(page.locator('.selection-line')).toContainText('1 selected');

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(`/p/${PERFORMANCE}?section=ST&seat=ST-G-21&tier=all`);
  await expect(rival.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await rival.locator('[role="gridcell"][data-seat="ST-G-21"]').click();
  await rival.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(rival.getByRole('region', { name: 'Cart' })).toContainText('Stalls row G seat 21');

  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Taken by another buyer: Stalls row G seat 21.',
    { timeout: 3000 },
  );
  await expect(page.getByRole('region', { name: 'Notice' })).toHaveText(
    'Someone else got there first. We kept the rest of your selection.',
  );
  await expect(page.locator('.selection-line')).toContainText('0 selected');
  await rivalContext.close();
});

test('paying in one tab empties the other tab silently', async ({ page, context }) => {
  await page.goto(`/p/${PERFORMANCE}?section=CI&seat=CI-F-4&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator('[role="gridcell"][data-seat="CI-F-4"]').click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(page.getByRole('region', { name: 'Cart' })).toContainText('Circle row F seat 4');

  const otherTab = await context.newPage();
  await otherTab.goto(`/p/${PERFORMANCE}?section=CI&seat=CI-F-4&tier=all`);
  await expect(otherTab.getByRole('region', { name: 'Cart' })).toContainText('Circle row F seat 4');

  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Tilly Tabs');
  await page.getByRole('textbox', { name: 'Email' }).fill('tilly@example.com');
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByRole('heading', { name: "You're in" })).toBeVisible();

  await expect(otherTab.getByRole('region', { name: 'Cart' })).toContainText('No seats held.', { timeout: 3000 });
  await expect(otherTab.locator('[role="gridcell"][data-seat="CI-F-4"]')).toHaveAttribute('data-state', 'yours');
  await expect(otherTab.getByRole('status', { name: 'Box office updates' })).toHaveText('');
  await expect(otherTab.getByRole('region', { name: 'Notice' })).toHaveText('');
  await otherTab.close();
});

test('the checkout dialog traps Tab, closes on Escape and hands focus back', async ({ page }) => {
  await page.goto(`/p/${PERFORMANCE}?section=BA&seat=BA-D-3&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator('[role="gridcell"][data-seat="BA-D-3"]').click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  const checkoutButton = page.getByRole('button', { name: 'Checkout' });
  await checkoutButton.click();
  const dialog = page.getByRole('dialog', { name: 'Checkout' });
  await expect(page.getByRole('textbox', { name: 'Full name' })).toBeFocused();

  const inDialog = async (): Promise<boolean> =>
    page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Tab');
    expect(await inDialog()).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await inDialog()).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(checkoutButton).toBeFocused();
});
