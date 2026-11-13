// Needs the server started with SESSION_IDLE_SECONDS=20.
const { test, expect } = require('@playwright/test');

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`;

async function signIn(page, startAt = '/') {
    await page.goto(BASE + startAt);
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Username or email').fill('ada.marsh@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Strongroom-Owner-1');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForLoadState('networkidle');
}

test('unsaved breach ticks survive an expired session', async ({ page }) => {
    await signIn(page);
    const breachesBefore = await page.evaluate(async () => {
        const answer = await fetch('/api/breaches').then((r) => r.json());
        return answer.breaches.length;
    });

    await page.getByRole('button', { name: 'Log breach' }).click();
    const form = page.getByRole('form', { name: 'Log breach' });
    await form.getByRole('combobox', { name: 'Company' }).fill('Copperleaf Bank');
    await form.getByRole('checkbox', { name: 'Bank account' }).check();
    await expect(page.getByRole('status', { name: 'Breach preview' })).toContainText('projected score 68');

    // Let the session idle out, without touching the app.
    await page.waitForTimeout(23_000);
    await form.getByRole('button', { name: 'Save breach' }).click();

    // The screen signs in again and comes back to the same page.
    await page.waitForURL(`${BASE}/vault`, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    const restored = page.getByRole('form', { name: 'Log breach' });
    await expect(restored).toBeVisible();
    await expect(restored.getByRole('combobox', { name: 'Company' })).toHaveValue('Copperleaf Bank');
    await expect(restored.getByRole('checkbox', { name: 'Bank account' })).toBeChecked();
    await expect(restored.getByRole('button', { name: 'Save breach' })).toBeFocused();
    await expect(page.getByRole('status', { name: 'Draft restored' })).toHaveText(
        'Your session ended. Your unsaved entries were kept; check them and save again.',
    );
    const breachesAfter = await page.evaluate(async () => {
        const answer = await fetch('/api/breaches').then((r) => r.json());
        return answer.breaches.length;
    });
    expect(breachesAfter, 'nothing was saved').toBe(breachesBefore);

    // The draft is used once.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('form', { name: 'Log breach' })).toHaveCount(0);
});
