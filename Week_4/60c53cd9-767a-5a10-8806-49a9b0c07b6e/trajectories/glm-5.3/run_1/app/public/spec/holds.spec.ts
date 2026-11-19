import { expect, test } from '@playwright/test';
import { freshBuyer, post, type Hold } from './utils';

test.beforeEach(async ({ page, request }, testInfo) => {
  // Each hold-page test creates its own buyer so the hold attempt window and
  // the one-hold rule never collide with other suites.
  const combos = ['30A', '32C', '31B'];
  const code = combos[testInfo.line % combos.length];
  const { cookie } = await freshBuyer(request, `holds${testInfo.line}`);
  const unitResponse = await request.fetch(`/api/units/${code}`);
  const unitText = await unitResponse.text();
  const parsed = unitText.length > 0 ? JSON.parse(unitText) as { unit: { code: string; priceVersion: number } } : null;
  expect(parsed).not.toBeNull();
  const holdReply = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: parsed!.unit.code, priceVersion: parsed!.unit.priceVersion }, { cookie });
  expect(holdReply.status).toBe(201);
  const token = cookie.split('=')[1];
  await page.context().addCookies([{ name: 'hw_session', value: token, url: 'http://127.0.0.1:4173', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`/holds/${holdReply.body.hold.id}`);
});

test('the hold page shows the quoted price, version and countdown', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Your hold on \d+[ABC]/, level: 1 })).toBeVisible();
  await expect(page.getByText(/Quoted price \$1,[0-9,]+/)).toBeVisible();
  await expect(page.getByText(/Price version 1/)).toBeVisible();
  await expect(page.getByText(/Held until/)).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/\d{2,}:\d{2}:\d{2}/);
});

test('the release control asks for confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Release hold' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Release this hold?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep hold' }).click();
  await expect(page.getByRole('button', { name: 'Release hold' })).toBeVisible();
});

test('a share link can be created and copied', async ({ page }) => {
  await page.getByRole('button', { name: 'Create share link' }).click();
  await expect(page.getByRole('textbox', { name: 'Share link' })).toHaveValue(/\/shared\/.+/);
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make a new link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke link' })).toBeVisible();
});
