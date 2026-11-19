import { expect, test } from '@playwright/test';
import { ACCOUNTS } from './utils';

test.beforeEach(async ({ page }) => {
  await page.goto('/console');
});

test('a signed-out visitor is asked to sign in', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});

test('a buyer sees the refusal heading', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.ana.email);
  await dialog.getByRole('textbox', { name: 'Password' }).fill(ACCOUNTS.ana.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Your account can't do that."), { timeout: 10000 });
  await expect(page.getByRole('heading', { name: "Your account can't do that." })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the finder' })).toBeVisible();
});

test('the coordinator releases a floor band and sees the notice', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.coordinator.email);
  await dialog.getByRole('textbox', { name: 'Password' }).fill(ACCOUNTS.coordinator.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Floor bands'), { timeout: 10000 });
  const button = page.getByRole('button', { name: 'Release floors 36-38' });
  await expect(button).toBeVisible();
  await button.click();
  await page.waitForFunction(() => document.querySelector('.console-notice')?.textContent?.includes('Floors 36-38 released.'), { timeout: 15000 });
  await expect(page.locator('.console-notice')).toContainText('Floors 36-38 released.');
});

test('the coordinator edits a unit price and sees the version table', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.coordinator.email);
  await dialog.getByRole('textbox', { name: 'Password' }).fill(ACCOUNTS.coordinator.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Unit editor'), { timeout: 10000 });
  await page.getByRole('searchbox', { name: 'Unit code' }).fill('21A');
  await page.waitForFunction(() => document.body.textContent?.includes('Unit 21A'), { timeout: 10000 });
  const priceInput = page.getByRole('spinbutton', { name: 'Price' });
  await priceInput.fill('1500000');
  await page.getByRole('button', { name: 'Save price' }).click();
  await page.waitForFunction(() => document.querySelector('.console-notice')?.textContent?.includes('Price saved for 21A.'), { timeout: 15000 });
  await expect(page.getByRole('table', { name: 'Price versions' })).toContainText('$1,500,000');
  await expect(page.getByRole('table', { name: 'Price versions' })).toContainText('Mira Castell');
});

test('a malformed price is refused with the field message', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.coordinator.email);
  await dialog.getByRole('textbox', { name: 'Password' }).fill(ACCOUNTS.coordinator.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Unit editor'), { timeout: 10000 });
  await page.getByRole('searchbox', { name: 'Unit code' }).fill('22A');
  await page.waitForFunction(() => document.body.textContent?.includes('Unit 22A'), { timeout: 15000 });
  const priceInput = page.getByRole('spinbutton', { name: 'Price' });
  await priceInput.fill('1234');
  await page.getByRole('button', { name: 'Save price' }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Check the highlighted fields.'), { timeout: 15000 });
  const region = page.locator('[aria-label="Unit 22A"]');
  await expect(region).toContainText('Check the highlighted fields.');
});
