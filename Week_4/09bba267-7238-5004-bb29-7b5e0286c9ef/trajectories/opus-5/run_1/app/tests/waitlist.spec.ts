import { expect, test, type Page } from '@playwright/test';

/** These checks need short hold and offer windows, as set by `scripts/check-all.sh 8 12`. */

async function publishOneSeatTier(page: Page, title: string, seatId: string): Promise<string> {
  await page.goto('/owner');
  await page.waitForSelector('#owner-passcode, a[href="/owner/new"]');
  const passcode = page.getByRole('textbox', { name: 'Passcode' });
  if (await passcode.isVisible()) {
    await passcode.fill('brass-rail-1897');
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.getByRole('link', { name: 'Publish performance' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Start (venue time)' }).fill('2029-06-01T20:00');
  await page.getByRole('textbox', { name: 'Tier name' }).fill('Single Seat');
  await page.getByRole('textbox', { name: 'Face value in dollars' }).fill('20');
  await page.getByRole('textbox', { name: 'Rows and seats' }).fill(seatId);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(`Published ${title}.`);
  await page.goto('/');
  const link = page.getByRole('link', { name: `Choose seats for ${title}` });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  return (href ?? '').replace('/p/', '');
}

test('a hold that runs out empties the cart and says so', async ({ page }) => {
  await page.goto('/p/fen-and-lark?section=ST&seat=ST-C-3&tier=all');
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator('[role="gridcell"][data-seat="ST-C-3"]').click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await expect(page.getByRole('region', { name: 'Cart' })).toContainText('Stalls row C seat 3');
  await expect(page.getByRole('timer', { name: 'Hold time left' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cart' })).toContainText('No seats held.', { timeout: 20_000 });
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Your hold ended and the seats were released.',
  );
  await expect(page.getByRole('region', { name: 'Notice' })).toHaveText(
    'Your hold ended and the seats were released.',
  );
  await expect(page.locator('[role="gridcell"][data-seat="ST-C-3"]')).toHaveAttribute('data-state', 'on_sale');
});

/** Sells the one seat of a freshly published tier, so the tier is sold out until it is refunded. */
async function sellTheOnlySeat(page: Page, performanceId: string, seatId: string, label: string): Promise<void> {
  await page.goto(`/p/${performanceId}?section=ST&seat=${seatId}&tier=all`);
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator(`[role="gridcell"][data-seat="${seatId}"]`).click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Olive Owner');
  await page.getByRole('textbox', { name: 'Email' }).fill(`olive-${Date.now()}@example.com`);
  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByRole('heading', { name: "You're in" })).toBeVisible();
  await page.getByRole('button', { name: 'View my tickets' }).click();
  await expect(page.getByRole('button', { name: `Refund ${label}` })).toBeVisible();
}

async function joinWaitlist(waiter: Page, performanceId: string, seatId: string, email: string): Promise<void> {
  await waiter.goto(`/p/${performanceId}?section=ST&seat=${seatId}&tier=all`);
  const joinButton = waiter.getByRole('button', { name: 'Join the waitlist for Single Seat' });
  await expect(joinButton).toBeVisible();
  await joinButton.click();
  const joinDialog = waiter.getByRole('dialog', { name: 'Join the waitlist' });
  await joinDialog.getByRole('textbox', { name: 'Full name' }).fill('Wendy Wait');
  await joinDialog.getByRole('textbox', { name: 'Email' }).fill(email);
  await joinDialog.getByRole('button', { name: 'Join waitlist' }).click();
  await expect(waiter.getByRole('status', { name: 'Box office updates' })).toHaveText(
    "You're on the waitlist for Single Seat. Your place is 1.",
  );
}

test('a sold-out tier takes waitlist joins and offers a freed seat to the earliest fan', async ({
  page,
  browser,
}) => {
  const title = `Waitlist UI ${Date.now()}`;
  const performanceId = await publishOneSeatTier(page, title, 'ST-A-15');
  const label = 'Stalls row A seat 15';

  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await sellTheOnlySeat(buyer, performanceId, 'ST-A-15', label);

  const waiterContext = await browser.newContext();
  const waiter = await waiterContext.newPage();
  await joinWaitlist(waiter, performanceId, 'ST-A-15', `wendy-${Date.now()}@example.com`);

  await buyer.getByRole('button', { name: `Refund ${label}` }).click();
  await buyer.getByRole('dialog', { name: 'Refund ticket' }).getByRole('button', { name: 'Confirm refund' }).click();
  await expect(buyer.getByRole('status', { name: 'Box office updates' })).toContainText('Refund confirmed:');

  await expect(waiter.getByRole('status', { name: 'Box office updates' })).toHaveText(
    `A seat is offered to you: ${label}.`,
    { timeout: 10_000 },
  );
  await waiter.goto('/tickets');
  const viewOffer = waiter.getByRole('link', { name: 'View offer' });
  await expect(viewOffer).toBeVisible();
  await viewOffer.click();
  await expect(waiter.getByRole('heading', { name: 'A seat for you' })).toBeVisible();
  await expect(waiter.getByRole('timer', { name: 'Offer time left' })).toBeVisible();
  await expect(waiter.locator('.offer')).toContainText(label);
  await waiter.getByRole('button', { name: 'Accept and pay $22.80' }).click();
  await expect(waiter.getByRole('heading', { name: "You're in" })).toBeVisible();
  await expect(waiter.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Payment confirmed. Your tickets are issued.',
  );
  await expect(waiter.getByRole('region', { name: 'Receipt' })).toContainText('$22.80');

  await buyerContext.close();
  await waiterContext.close();
});

test('a declined offer ends for the fan who declined it', async ({ page, browser }) => {
  const title = `Decline UI ${Date.now()}`;
  const performanceId = await publishOneSeatTier(page, title, 'ST-A-16');
  const label = 'Stalls row A seat 16';

  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await sellTheOnlySeat(buyer, performanceId, 'ST-A-16', label);

  const waiterContext = await browser.newContext();
  const waiter = await waiterContext.newPage();
  await joinWaitlist(waiter, performanceId, 'ST-A-16', `dina-${Date.now()}@example.com`);

  await buyer.getByRole('button', { name: `Refund ${label}` }).click();
  await buyer.getByRole('dialog', { name: 'Refund ticket' }).getByRole('button', { name: 'Confirm refund' }).click();
  await expect(waiter.getByRole('status', { name: 'Box office updates' })).toContainText(
    `A seat is offered to you: ${label}.`,
    { timeout: 10_000 },
  );

  await waiter.goto('/tickets');
  await waiter.getByRole('link', { name: 'View offer' }).click();
  await waiter.getByRole('button', { name: 'Decline offer' }).click();
  await expect(waiter.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Offer declined. The seat goes to the next person waiting.',
  );
  await expect(waiter.getByRole('heading', { name: 'This offer has ended' })).toBeVisible();
  await expect(waiter.getByRole('button', { name: 'Decline offer' })).toBeHidden();
  await buyerContext.close();
  await waiterContext.close();
});

test('the address keeps the place through a reload and Back', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Choose seats for Lantern & Tide' }).click();
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await expect(page).toHaveURL(/section=ST&seat=ST-A-15&tier=all/);
  await page.getByRole('tab', { name: 'Circle' }).click();
  await expect(page).toHaveURL(/section=CI&seat=CI-A-15/);
  await page.locator('[role="gridcell"][data-seat="CI-C-12"]').click();
  await expect(page).toHaveURL(/section=CI&seat=CI-C-12/);

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Circle' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-sightline]')).toHaveAttribute('data-seat', 'CI-C-12');
  await expect(page.locator('[role="gridcell"][tabindex="0"]')).toHaveAttribute('data-seat', 'CI-C-12');

  const secondTab = await context.newPage();
  await secondTab.goto(page.url());
  await expect(secondTab.locator('[data-sightline]')).toHaveAttribute('data-seat', 'CI-C-12');
  await secondTab.close();

  await page.getByRole('link', { name: 'My tickets' }).click();
  await expect(page.getByRole('heading', { name: 'My tickets' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/section=CI&seat=CI-C-12/);
  await expect(page.getByRole('tab', { name: 'Circle' })).toHaveAttribute('aria-selected', 'true');
});

test('the confirmation outlives the hold countdown', async ({ page }) => {
  await page.goto('/p/fen-and-lark?section=ST&seat=ST-D-7&tier=all');
  await expect(page.getByRole('grid', { name: 'Seat map' })).toBeVisible();
  await page.locator('[role="gridcell"][data-seat="ST-D-7"]').click();
  await page.getByRole('button', { name: 'Hold selected seats' }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Hilda Hold');
  await page.getByRole('textbox', { name: 'Email' }).fill('hilda@example.com');
  await page.getByRole('button', { name: /^Pay / }).click();
  const dialog = page.getByRole('dialog', { name: 'Checkout' });
  await expect(dialog.getByRole('heading', { name: "You're in" })).toBeVisible();
  await page.waitForTimeout(14_000);
  await expect(dialog.getByRole('heading', { name: "You're in" })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Receipt' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Box office updates' })).toHaveText(
    'Payment confirmed. Your tickets are issued.',
  );
});
