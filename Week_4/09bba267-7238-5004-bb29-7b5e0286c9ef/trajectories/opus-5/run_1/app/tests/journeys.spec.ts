import { expect, test, type Page } from '@playwright/test';

const PERFORMANCE = 'ostrava-strings';

async function buySeats(page: Page, seatIds: readonly string[], email: string): Promise<void> {
  await page.goto(`/p/${PERFORMANCE}?section=ST&seat=${seatIds[0]}&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  for (const seatId of seatIds) {
    await page.locator(`[role="gridcell"][data-seat="${seatId}"]`).click();
  }
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(page.getByRole('region', { name: 'Cart' })).not.toContainText('No seats held.');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Tess Ticket');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByRole('heading', { name: "You're in" })).toBeVisible();
  await page.getByRole('button', { name: 'View my tickets' }).click();
  await expect(page.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible();
}

test('exchange and refund keep two tabs in step', async ({ page, context }) => {
  await buySeats(page, ['ST-B-4', 'ST-B-5'], 'tess@example.com');
  const secondTab = await context.newPage();
  await secondTab.goto('/tickets');
  await expect(secondTab.getByRole('heading', { name: 'My tickets' })).toBeVisible();
  await expect(secondTab.locator('.ticket-list')).toContainText('Stalls row B seat 4');

  await page.getByRole('button', { name: 'Exchange Stalls row B seat 4' }).click();
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notice' })).toContainText(
    'Choose a new seat for Stalls row B seat 4.',
  );
  await page.locator('[role="gridcell"][data-seat="ST-K-4"]').click();
  await page.getByRole('button', { name: 'Exchange to this seat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm exchange' });
  await expect(dialog).toContainText('Stalls row B seat 4');
  await expect(dialog).toContainText('Stalls row K seat 4');
  await expect(dialog).toContainText('We refund $24.49');
  await dialog.getByRole('button', { name: 'Confirm exchange' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Exchange confirmed. Your new seat is Stalls row K seat 4.',
  );
  await expect(page.locator('.ticket-list')).toContainText('Stalls row K seat 4');
  await expect(secondTab.locator('.ticket-list')).toContainText('Stalls row K seat 4', { timeout: 2500 });

  await page.getByRole('button', { name: 'Refund Stalls row B seat 5' }).click();
  const refundDialog = page.getByRole('dialog', { name: 'Refund ticket' });
  await expect(refundDialog).toContainText('Refund $72.42');
  await refundDialog.getByRole('button', { name: 'Confirm refund' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText('Refund confirmed: $72.42.');
  await expect(page.locator('.ticket-list')).toContainText('Refunded');
  await expect(secondTab.locator('.ticket-list')).toContainText('Refunded', { timeout: 2500 });
  await secondTab.close();
});

test('the owner signs in, watches counts and reads the outbox', async ({ page }) => {
  await page.goto('/owner');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Passcode' }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText('That passcode is not right.');

  await page.getByRole('textbox', { name: 'Passcode' }).fill('brass-rail-1897');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Performances', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Ostrava Strings' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toContainText('A Reserve');

  await page.getByRole('link', { name: 'Publish performance' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Late Set Check');
  await page.getByRole('textbox', { name: 'Start (venue time)' }).fill('2027-11-07T01:30');
  await page.getByRole('textbox', { name: 'Tier name' }).fill('Night Tier');
  await page.getByRole('textbox', { name: 'Face value in dollars' }).fill('30');
  await page.getByRole('textbox', { name: 'Rows and seats' }).fill('BA-A, BA-B-7');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText('Published Late Set Check.');

  await page.goto('/');
  await expect(page.getByRole('article', { name: 'Late Set Check' })).toContainText('Sun 7 Nov 2027, 1:30 AM CDT');
  await expect(page.getByRole('article', { name: 'Late Set Check' })).toContainText('31 left');

  await page.goto('/owner/orders');
  const orders = page.getByRole('table', { name: 'Orders' });
  await expect(orders).toBeVisible();
  await expect(orders).toContainText('HH-');
  await page.goto('/owner/outbox');
  const outbox = page.getByRole('table', { name: 'Outbox' });
  await expect(outbox).toContainText('Your Halyard Hall tickets');
  await expect(outbox).toContainText('Sent');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/owner/orders');
  await expect(page.getByRole('table', { name: 'Orders' })).toBeVisible();
  const scrolling = await page.evaluate(() => {
    const frame = document.querySelector('.table-frame')!;
    return {
      page: document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth,
      frame: frame.scrollWidth > frame.clientWidth,
    };
  });
  expect(scrolling).toEqual({ page: false, frame: true });
});

test('an unknown page and an unknown offer show the not-found heading', async ({ page }) => {
  await page.goto('/nowhere');
  await expect(page.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
  await page.goto('/offers/0123456789abcdef0123456789abcdef');
  await expect(page.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
  await page.goto('/p/not-a-performance');
  await expect(page.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
});

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

test('controls meet the touch size and no page scrolls sideways', async ({ page }) => {
  const smallControls = async (): Promise<string[]> =>
    page.evaluate(() => {
      const bad: string[] = [];
      for (const selector of ['button', 'a[href]', 'input', '[role="tab"]']) {
        for (const element of document.querySelectorAll(selector)) {
          const box = element.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          if (box.width < 44 || box.height < 44) {
            bad.push(`${selector} ${element.textContent?.slice(0, 20) ?? ''} ${box.width}x${box.height}`);
          }
        }
      }
      return bad;
    });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const path of ['/', `/p/${PERFORMANCE}`, '/tickets', '/owner', '/owner/new', '/owner/orders', '/nowhere']) {
      await page.goto(path);
      await page.waitForTimeout(400);
      expect(await smallControls(), `${path} at ${viewport.width}`).toEqual([]);
      const overflows = await page.evaluate(
        () => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth,
      );
      expect(overflows, `${path} at ${viewport.width} scrolls sideways`).toBe(false);
    }
  }
});
