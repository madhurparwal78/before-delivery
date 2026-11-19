import { expect, test, type Page } from '@playwright/test';

const PERFORMANCE = 'lantern-and-tide';

async function openSeatMap(page: Page, query = ''): Promise<void> {
  await page.goto(`/p/${PERFORMANCE}${query}`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
}

test('programme lists performances in start order with tiers and links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Programme', level: 1 })).toBeVisible();
  const titles = await page
    .locator('article')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  const seeded = ['Lantern & Tide', 'Ostrava Strings', 'Fen & Lark', 'Marrow Quartet: The Late Set'];
  expect(titles.filter((title) => title !== null && seeded.includes(title))).toEqual(seeded);
  const first = page.getByRole('article', { name: 'Lantern & Tide' });
  await expect(first).toContainText('Fri 12 Feb 2027, 8:00 PM CST');
  await expect(first).toContainText('A Reserve');
  await expect(first).toContainText('240 left');
  await expect(page.getByRole('link', { name: 'Choose seats for Fen & Lark' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Marrow Quartet: The Late Set' })).toContainText(
    'Sun 7 Nov 2027, 1:30 AM CDT',
  );
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
});

test('seat map shows the header, tabs, tiers, grid and sightline', async ({ page }) => {
  await openSeatMap(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Lantern & Tide' })).toBeVisible();
  await expect(page.locator('.performance-header')).toContainText('Fri 12 Feb 2027, 8:00 PM CST');
  await expect(page.getByRole('tab', { name: 'Stalls' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('radio', { name: 'All tiers' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'B Reserve' })).toBeVisible();
  await expect(page.locator('[data-stage]')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(16);
  await expect(page.getByRole('gridcell')).toHaveCount(480);
  await expect(
    page.getByRole('gridcell', { name: 'Stalls row A seat 15, A Reserve, $68.00, On sale' }),
  ).toBeVisible();
  const sightline = page.getByRole('group', { name: 'Sightline' });
  await expect(sightline).toContainText('-1° off centre');
  await expect(sightline).toContainText('6.0 m to stage');
  const wedge = page.locator('[data-sightline]');
  await expect(wedge).toHaveAttribute('data-seat', 'ST-A-15');
  await expect(wedge).toHaveAttribute('data-angle', '-1');
  await expect(wedge).toHaveAttribute('data-distance', '6.0');
  await expect(wedge).toHaveAttribute('data-state', 'on_sale');
  await expect(page.getByRole('region', { name: 'Cart' })).toContainText('No seats held.');
  await expect(page).toHaveURL(/section=ST&seat=ST-A-15&tier=all/);
});

test('wedge corners land on the seat centre and the stage lip', async ({ page }) => {
  await openSeatMap(page, '?section=CI&seat=CI-C-12&tier=all');
  await page.waitForTimeout(900);
  const geometry = await page.evaluate(() => {
    const seat = document.querySelector('[data-seat="CI-C-12"][role="gridcell"]')!.getBoundingClientRect();
    const stage = document.querySelector('[data-stage]')!.getBoundingClientRect();
    const toScreen = (element: Element) => {
      const line = element as SVGLineElement;
      const svg = line.ownerSVGElement!;
      const point = (x: number, y: number) => {
        const p = svg.createSVGPoint();
        p.x = x;
        p.y = y;
        return p.matrixTransform(line.getScreenCTM()!);
      };
      return {
        from: point(line.x1.baseVal.value, line.y1.baseVal.value),
        to: point(line.x2.baseVal.value, line.y2.baseVal.value),
      };
    };
    const left = toScreen(document.querySelector('[data-part="left-edge"]')!);
    const right = toScreen(document.querySelector('[data-part="right-edge"]')!);
    return {
      seatCentre: { x: seat.left + seat.width / 2, y: seat.top + seat.height / 2 },
      lipLeft: { x: stage.left, y: stage.bottom },
      lipRight: { x: stage.right, y: stage.bottom },
      left: { from: { x: left.from.x, y: left.from.y }, to: { x: left.to.x, y: left.to.y } },
      right: { from: { x: right.from.x, y: right.from.y }, to: { x: right.to.x, y: right.to.y } },
    };
  });
  const near = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
  expect(near(geometry.left.from, geometry.seatCentre)).toBeLessThan(2);
  expect(near(geometry.right.from, geometry.seatCentre)).toBeLessThan(2);
  expect(near(geometry.left.to, geometry.lipLeft)).toBeLessThan(2);
  expect(near(geometry.right.to, geometry.lipRight)).toBeLessThan(2);
});

test('the grid is one keyboard tab stop that moves with the arrow keys', async ({ page }) => {
  await openSeatMap(page);
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-seat') ?? null);
  await page.getByRole('radio', { name: 'All tiers' }).focus();
  await page.keyboard.press('Tab');
  expect(await active()).toBe('ST-A-15');
  await page.keyboard.press('ArrowRight');
  expect(await active()).toBe('ST-A-16');
  await page.keyboard.press('ArrowDown');
  expect(await active()).toBe('ST-B-16');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await active()).toBe('ST-A-16');
  await page.keyboard.press('Home');
  expect(await active()).toBe('ST-A-1');
  await page.keyboard.press('ArrowLeft');
  expect(await active()).toBe('ST-A-1');
  await page.keyboard.press('End');
  expect(await active()).toBe('ST-A-30');
  await page.keyboard.press('Control+End');
  expect(await active()).toBe('ST-P-30');
  await page.keyboard.press('Control+Home');
  expect(await active()).toBe('ST-A-1');
  await page.keyboard.press('PageUp');
  expect(await active()).toBe('ST-A-1');
  await page.keyboard.press('PageDown');
  expect(await active()).toBe('CI-A-15');
  await expect(page.getByRole('tab', { name: 'Circle' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('PageDown');
  expect(await active()).toBe('BA-A-15');
  await page.keyboard.press('PageDown');
  expect(await active()).toBe('BA-A-15');
  await expect(page).toHaveURL(/section=BA&seat=BA-A-15/);
  expect(await page.locator('[role="gridcell"][tabindex="0"]').count()).toBe(1);
});

test('the tier choice dims other tiers and clears them from the selection', async ({ page }) => {
  await openSeatMap(page);
  await page.locator('[role="gridcell"][data-seat="ST-A-10"]').click();
  await expect(page.locator('.selection-line')).toContainText('1 selected');
  await page.getByRole('radio', { name: 'B Reserve' }).check();
  await expect(page).toHaveURL(/tier=b-reserve/);
  await expect(page.locator('.selection-line')).toContainText('0 selected');
  await expect(page.locator('[role="gridcell"][data-seat="ST-A-10"]')).toHaveAttribute('aria-disabled', 'true');
});

test('holding seats fills the cart, then checkout pays and issues tickets', async ({ page }) => {
  await openSeatMap(page, '?section=ST&seat=ST-I-20&tier=b-reserve');
  await page.locator('[role="gridcell"][data-seat="ST-I-20"]').click();
  await page.locator('[role="gridcell"][data-seat="ST-I-21"]').click();
  await expect(page.locator('.selection-line')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Held Stalls row I seat 20, Stalls row I seat 21.',
  );
  const cart = page.getByRole('region', { name: 'Cart' });
  await expect(cart).toContainText('Stalls row I seat 20');
  await expect(cart).toContainText('$45.00');
  await expect(cart).toContainText('$2.93');
  await expect(cart).toContainText('$1.50');
  await expect(cart).toContainText('$97.36');
  await expect(page.getByRole('timer', { name: 'Hold time left' })).toContainText(/\d+:\d\d/);

  await page.getByRole('button', { name: 'Checkout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Checkout' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toBeFocused();
  await page.getByRole('button', { name: 'Pay $97.36' }).click();
  await expect(dialog.getByRole('heading', { name: 'Check these details' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText('Check these details.');
  await dialog.getByRole('link', { name: 'Enter your full name.' }).click();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toBeFocused();

  await page.getByRole('textbox', { name: 'Full name' }).fill('Ida Keyboard');
  await page.getByRole('textbox', { name: 'Email' }).fill('ida@example.com');
  await page.getByRole('button', { name: 'Pay $97.36' }).click();
  await expect(dialog.getByRole('heading', { name: "You're in" })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Payment confirmed. Your tickets are issued.',
  );
  await expect(dialog).toContainText('Order HH-');
  await expect(dialog.getByRole('region', { name: 'Receipt' })).toContainText('$97.36');
  await expect(dialog).toContainText('A receipt is on its way to ida@example.com.');

  await page.getByRole('button', { name: 'View my tickets' }).click();
  await expect(page.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible();
  await expect(page.locator('.ticket-list')).toContainText('Issued');
  await expect(page.locator('.ticket-list')).toContainText('Stalls row I seat 20');
});

test('a second browser loses the contested seat and keeps the rest', async ({ page, browser }) => {
  await openSeatMap(page, '?tier=all');
  const other = await browser.newContext();
  const rival = await other.newPage();
  await rival.goto(`/p/${PERFORMANCE}?tier=all`);
  await expect(rival.getByRole('grid', { name: 'Seat map' })).toBeVisible();

  await page.locator('[role="gridcell"][data-seat="ST-D-5"]').click();
  await rival.locator('[role="gridcell"][data-seat="ST-D-5"]').click();
  await rival.locator('[role="gridcell"][data-seat="ST-D-6"]').click();

  await Promise.all([
    page.getByRole('button', { name: 'Hold selected seats' }).click(),
    rival.getByRole('button', { name: 'Hold selected seats' }).click(),
  ]);

  const cartOf = async (target: Page): Promise<string> =>
    (await target.getByRole('region', { name: 'Cart' }).innerText()).replace(/\s+/g, ' ');
  await expect(rival.getByRole('region', { name: 'Cart' })).toContainText('Stalls row D seat 6');
  const winner = (await cartOf(page)).includes('Stalls row D seat 5') ? page : rival;
  const loser = winner === page ? rival : page;
  expect((await cartOf(winner)).includes('Stalls row D seat 5')).toBe(true);
  expect((await cartOf(loser)).includes('Stalls row D seat 5')).toBe(false);
  await expect(loser.getByRole('status', { name: 'Box office updates' })).toContainText(
    'Taken by another buyer: Stalls row D seat 5.',
  );
  await expect(loser.getByRole('region', { name: 'Notice' })).toHaveText(
    'Someone else got there first. We kept the rest of your selection.',
  );
  for (const target of [page, rival]) {
    await expect(target.locator('[role="gridcell"][data-seat="ST-D-5"]')).toHaveAttribute(
      'data-state',
      winner === target ? 'held_by_you' : 'taken',
      { timeout: 2500 },
    );
  }
  await other.close();
});

test('a released seat returns to sale in another open map within two seconds', async ({ page, browser }) => {
  await openSeatMap(page, '?section=ST&seat=ST-F-2&tier=all');
  const watcherContext = await browser.newContext();
  const watcher = await watcherContext.newPage();
  await watcher.goto(`/p/${PERFORMANCE}?section=ST&seat=ST-F-2&tier=all`);
  await expect(watcher.getByRole('grid', { name: 'Seat map' })).toBeVisible();

  await page.locator('[role="gridcell"][data-seat="ST-F-2"]').click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(watcher.getByRole('gridcell', { name: /Stalls row F seat 2, A Reserve, \$68.00, Taken/ })).toBeVisible(
    {
      timeout: 2500,
    },
  );
  await page.getByRole('button', { name: 'Release Stalls row F seat 2' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText('Released Stalls row F seat 2.');
  await expect(
    watcher.getByRole('gridcell', { name: /Stalls row F seat 2, A Reserve, \$68.00, On sale/ }),
  ).toBeVisible({ timeout: 2500 });
  await watcherContext.close();
});

test('layout follows the published breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openSeatMap(page);
  const mapFrame = (await page.locator('.map-frame').boundingBox())!;
  const cart = (await page.locator('.cart').boundingBox())!;
  expect(cart.y).toBeGreaterThan(mapFrame.y + mapFrame.height - 1);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  const seatBox = (await page.locator('[role="gridcell"][data-seat="ST-A-15"]').boundingBox())!;
  expect(seatBox.width).toBeGreaterThanOrEqual(44);
  expect(seatBox.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  const sheet = (await page.locator('.cart-column').boundingBox())!;
  expect(sheet.height).toBeLessThanOrEqual(1024 * 0.4 + 1);
  expect(Math.round(sheet.y + sheet.height)).toBe(1024);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  const deskMap = (await page.locator('.map-frame').boundingBox())!;
  const rail = (await page.locator('.cart-column').boundingBox())!;
  expect(rail.width).toBeGreaterThanOrEqual(320);
  expect(rail.width).toBeLessThanOrEqual(400);
  expect(rail.x).toBeGreaterThan(deskMap.x + deskMap.width - 1);
  expect(Math.abs(rail.y - deskMap.y)).toBeLessThan(4);
  const seatDesktop = (await page.locator('[role="gridcell"][data-seat="ST-A-15"]').boundingBox())!;
  expect(seatDesktop.width).toBeGreaterThanOrEqual(24);
  expect(seatDesktop.height).toBeGreaterThanOrEqual(24);

  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);
  const railAfterScroll = (await page.locator('.cart-column').boundingBox())!;
  expect(railAfterScroll.y).toBeGreaterThanOrEqual(0);
  expect(railAfterScroll.y).toBeLessThan(800);
});

test('reduced motion settles the wedge and readout in one frame', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`/p/${PERFORMANCE}?section=BA&seat=BA-F-16&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  const wedge = page.locator('[data-sightline]');
  await expect(wedge).toHaveAttribute('data-angle', '1');
  await expect(wedge).toHaveAttribute('data-distance', '38.0');
  const readout = page.getByRole('group', { name: 'Sightline' });
  await expect(readout).toContainText('1° off centre');
  await expect(readout).toContainText('38.0 m to stage');
  const drawn = await page.evaluate(() => {
    const left = document.querySelector('[data-part="left-edge"]') as SVGLineElement;
    return { x1: left.x1.baseVal.value, x2: left.x2.baseVal.value };
  });
  expect(Math.abs(drawn.x1 - drawn.x2)).toBeGreaterThan(10);
  await context.close();
});
