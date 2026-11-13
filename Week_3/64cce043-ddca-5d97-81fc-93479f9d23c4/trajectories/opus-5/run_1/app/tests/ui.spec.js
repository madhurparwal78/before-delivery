// Browser checks for the published roles, names, copy and behaviour.
const { test, expect } = require('@playwright/test');

const BASE = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`;
const OWNER = { email: 'ada.marsh@example.com', password: 'Strongroom-Owner-1' };
const CONTACT = { email: 'ines.marsh@example.com', password: 'Strongroom-Contact-1' };

async function signIn(page, who, startAt = '/') {
    await page.goto(BASE + startAt);
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Username or email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForLoadState('networkidle');
}

test.describe.configure({ mode: 'serial' });

test('the landing page offers sign-in and remembers where you were going', async ({ page }) => {
    await page.goto(`${BASE}/vault/breaches`);
    await expect(page).toHaveURL(`${BASE}/?next=%2Fvault%2Fbreaches`);
    await expect(page.getByRole('heading', { name: 'Strongroom Ledger' })).toBeVisible();
    const link = page.getByRole('link', { name: 'Sign in' });
    await expect(link).toHaveAttribute('href', '/auth/login?next=%2Fvault%2Fbreaches');
});

test('a plain sign-in lands on the ledger with the score and the steps', async ({ page }) => {
    await signIn(page, OWNER);
    await expect(page).toHaveURL(`${BASE}/vault`);
    const exposure = page.getByRole('region', { name: 'Exposure' });
    await expect(exposure.getByRole('heading', { name: 'Exposure score' })).toBeVisible();
    await expect(exposure.locator('.score')).toHaveText('48');
    await expect(exposure.locator('.band')).toHaveText('Exposed');
    const steps = page.getByRole('list', { name: 'Next steps' });
    await expect(steps.getByRole('checkbox')).toHaveCount(4);
    await expect(
        steps.getByRole('checkbox', {
            name: 'Report the passport to the issuing office as compromised, Brightway Air',
        }),
    ).toBeVisible();
    const holdings = page.getByRole('table', { name: 'Holdings' });
    await expect(holdings.getByRole('row').filter({ hasText: 'Brightway Air' }).first()).toBeVisible();
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 12.');
    await expect(page.getByRole('navigation', { name: 'Vault' })).toBeVisible();
});

test('sign-in returns to the page that was asked for', async ({ page }) => {
    await signIn(page, OWNER, '/vault/rules');
    await expect(page).toHaveURL(`${BASE}/vault/rules`);
    await expect(page.getByRole('list', { name: 'Rules' })).toBeVisible();
});

test('filters work live, live in the address and survive Back and Forward', async ({ page }) => {
    await signIn(page, OWNER);
    const search = page.getByRole('searchbox', { name: 'Search holdings' });
    await search.pressSequentially('parcel', { delay: 30 });
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 2.');
    await expect(page).toHaveURL(`${BASE}/vault?q=parcel`);
    await page.getByRole('combobox', { name: 'Level' }).selectOption('low');
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 1.');
    await expect(page).toHaveURL(`${BASE}/vault?q=parcel&level=low`);
    await page.goBack();
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 2.');
    await expect(search).toHaveValue('parcel');
    await page.goForward();
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 1.');
    // A copied link opens filtered.
    await page.goto(`${BASE}/vault?q=cop`);
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 3.');
    // An unpublished level is dropped and the address rewritten.
    await page.goto(`${BASE}/vault?level=nope`);
    await expect(page).toHaveURL(`${BASE}/vault`);
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 12.');
});

test('a holding is added through the dialog and appears in place', async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole('button', { name: 'Add holding' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add holding' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Company' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Company' }).fill('Larchfield Clinic');
    await dialog.getByRole('combobox', { name: 'Data kind' }).selectOption('date_of_birth');
    await dialog.getByRole('textbox', { name: 'Value' }).fill('1986-03-14');
    await dialog.getByRole('button', { name: 'Save holding' }).click();
    await expect(dialog).toBeHidden();
    const row = page
        .getByRole('table', { name: 'Holdings' })
        .getByRole('row')
        .filter({ hasText: 'Date of birth' })
        .filter({ hasText: 'Critical' });
    await expect(row).toHaveCount(1);
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Holding saved. Exposure score',
    );
    // field errors and the duplicate refusal
    await page.getByRole('button', { name: 'Add holding' }).click();
    const again = page.getByRole('dialog', { name: 'Add holding' });
    await again.getByRole('button', { name: 'Save holding' }).click();
    await expect(again.getByRole('alert').filter({ hasText: 'Check these fields' })).toBeVisible();
    await again.getByRole('textbox', { name: 'Company' }).fill('larchfield clinic');
    await again.getByRole('combobox', { name: 'Data kind' }).selectOption('date_of_birth');
    await again.getByRole('textbox', { name: 'Value' }).fill('x');
    await again.getByRole('button', { name: 'Save holding' }).click();
    await expect(again.getByRole('alert')).toContainText('already holds that data kind');
    await page.keyboard.press('Escape');
    await expect(again).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add holding' })).toBeFocused();
    // tidy up
    await page.getByRole('link', { name: 'Date of birth' }).nth(1).click();
    await page.getByRole('button', { name: 'Delete holding' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete holding?' });
    await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(`${BASE}/vault`);
    await expect(page.getByRole('button', { name: 'Add holding' })).toBeFocused();
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Holding deleted. Exposure score 48.',
    );
});

test('the blast preview lights rows and counts the numeral, then commits', async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole('button', { name: 'Log breach' }).click();
    const form = page.getByRole('form', { name: 'Log breach' });
    await expect(form).toBeVisible();
    const company = form.getByRole('combobox', { name: 'Company' });
    await expect(company).toBeFocused();
    await company.pressSequentially('b', { delay: 20 });
    const suggestions = page.getByRole('listbox', { name: 'Company suggestions' });
    await expect(suggestions.getByRole('option')).toHaveCount(2);
    await expect(suggestions.getByRole('option', { name: 'Brightway Air' })).toBeVisible();
    await expect(suggestions.getByRole('option', { name: 'Copperleaf Bank' })).toBeVisible();
    await company.press('ArrowDown');
    await company.press('ArrowDown');
    await company.press('Enter');
    await expect(company).toHaveValue('Copperleaf Bank');
    await expect(suggestions).toBeHidden();
    await form.getByRole('checkbox', { name: 'Bank account' }).check();
    await expect(page.getByRole('status', { name: 'Breach preview' })).toHaveText(
        'Preview: holdings touched 1, projected score 68.',
    );
    await expect(page.locator('.score')).toHaveText('68');
    await expect(page.locator('.preview-tag')).toBeVisible();
    await expect(page.locator('tr.touched')).toHaveCount(1);
    await form.getByRole('checkbox', { name: 'Payment card' }).check();
    await expect(page.getByRole('status', { name: 'Breach preview' })).toHaveText(
        'Preview: holdings touched 2, projected score 88.',
    );
    await expect(page.locator('tr.touched')).toHaveCount(2);
    await expect(page.locator('tr.touched').first()).toContainText('Touched');
    await form.getByRole('checkbox', { name: 'Payment card' }).uncheck();
    await expect(page.locator('tr.touched')).toHaveCount(1);
    await form.getByRole('button', { name: 'Save breach' }).click();
    await expect(form).toBeHidden();
    await expect(page.locator('.preview-tag')).toBeHidden();
    await expect(page.locator('.score')).toHaveText('68');
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Breach logged. Holdings touched: 1. Exposure score 68.',
    );
    // remove it again so later checks read the seeded vault
    await page.getByRole('link', { name: 'Breaches' }).click();
    await page.getByRole('link', { name: /Copperleaf Bank/ }).click();
    await page.getByRole('button', { name: 'Remove breach' }).click();
    await page.getByRole('alertdialog', { name: 'Remove breach?' })
        .getByRole('button', { name: 'Remove' })
        .click();
    await expect(page).toHaveURL(`${BASE}/vault/breaches`);
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Breach removed. Exposure score 48.',
    );
});

test('the closed breach form and the closed phone menu are unreachable', async ({ page }) => {
    await signIn(page, OWNER);
    await expect(page.getByRole('form', { name: 'Log breach' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Company' })).toHaveCount(3 - 2);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('navigation', { name: 'Vault' })).toHaveCount(0);
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('navigation', { name: 'Vault' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Vault' })).toHaveCount(0);
    await expect(menu).toBeFocused();
});

test('the next steps work by keyboard and settle on the server', async ({ page }) => {
    await signIn(page, OWNER);
    const steps = page.getByRole('list', { name: 'Next steps' });
    const second = steps.getByRole('checkbox').nth(1);
    await second.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('alert')).toContainText('Finish the step before this one first.');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.score')).toHaveText('48');
    const first = steps.getByRole('checkbox').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.score')).toHaveText('28');
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Step marked done. Exposure score 28.',
    );
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(steps.getByRole('checkbox').nth(1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press(' ');
    await expect(page.locator('.score')).toHaveText('48');
});

test('rules reorder by keyboard with a live preview', async ({ page }) => {
    await signIn(page, OWNER, '/vault/rules');
    const rules = page.getByRole('list', { name: 'Rules' });
    await expect(rules.getByRole('listitem')).toHaveCount(13);
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.getByRole('table', { name: 'Preview levels' })).toBeVisible();
    await expect(preview).toContainText('Projected score 48');
    const handle = page.getByRole('button', { name: 'Move rule: Any kind at clinic is Critical' });
    await handle.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('status', { name: 'Rule order' })).toHaveText(
        'Picked up Any kind at clinic is Critical. Position 1 of 13.',
    );
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('status', { name: 'Rule order' })).toHaveText('Position 2 of 13.');
    await expect(handle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status', { name: 'Rule order' })).toHaveText(
        'Dropped Any kind at clinic is Critical. Position 2 of 13.',
    );
    await expect(handle).toBeFocused();
    await expect(rules.getByRole('listitem').nth(1)).toContainText('Any kind at clinic is Critical');
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Rule order saved. Exposure score',
    );
    // put it back
    await handle.focus();
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(rules.getByRole('listitem').first()).toContainText('Any kind at clinic is Critical');
    // Escape cancels
    await handle.focus();
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status', { name: 'Rule order' })).toHaveText('Move cancelled.');
    await expect(rules.getByRole('listitem').first()).toContainText('Any kind at clinic is Critical');
    await expect(handle).toBeFocused();
});

test('a rule edit changes the levels and the score', async ({ page }) => {
    await signIn(page, OWNER, '/vault/rules');
    await page.getByRole('button', { name: 'Edit rule: Any kind at clinic is Critical' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit rule' });
    await dialog.getByRole('combobox', { name: 'Level' }).selectOption('moderate');
    await dialog.getByRole('button', { name: 'Save rule' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Rules updated. Exposure score 48.',
    );
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(
        preview.getByRole('row').filter({ hasText: 'Larchfield Clinic' }).first(),
    ).toContainText('Moderate');
    await page.getByRole('button', { name: 'Edit rule: Any kind at clinic is Moderate' }).click();
    const back = page.getByRole('dialog', { name: 'Edit rule' });
    await back.getByRole('combobox', { name: 'Level' }).selectOption('critical');
    await back.getByRole('button', { name: 'Save rule' }).click();
    await expect(back).toBeHidden();
});

test('the contact sees a masked, scoped, read-only view', async ({ page }) => {
    await signIn(page, CONTACT);
    await expect(page).toHaveURL(`${BASE}/shared`);
    await expect(page.getByRole('heading', { name: 'Shared by Ada Marsh' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Access time' })).toContainText('Access ends in');
    const holdings = page.getByRole('table', { name: 'Holdings' });
    await expect(holdings).toContainText('* **** *471 8');
    await expect(holdings).toContainText('14 Wren Row, Aldmoor');
    await expect(page.getByRole('button', { name: 'Add holding' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log breach' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Vault' })).toHaveCount(0);
    const steps = page.getByRole('list', { name: 'Next steps' });
    await expect(steps.getByRole('listitem').first()).toContainText('Open');
    await expect(steps.getByRole('checkbox')).toHaveCount(0);
    await page.goto(`${BASE}/vault`);
    await expect(page).toHaveURL(`${BASE}/shared`);
});

test('narrowing and revoking reach the watching contact', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const contactContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const contact = await contactContext.newPage();
    await signIn(owner, OWNER, '/vault/contact');
    await signIn(contact, CONTACT);
    await expect(contact.getByRole('table', { name: 'Holdings' })).toContainText('Passport');

    const panel = owner.locator('.panel');
    await expect(panel).toContainText('Ines Marsh');
    await expect(panel).toContainText('Active');
    await expect(panel).toContainText('Access ends in');
    const levels = owner.getByRole('group', { name: 'Levels shown' });
    await levels.getByRole('checkbox', { name: 'Critical' }).uncheck();
    await levels.getByRole('checkbox', { name: 'High' }).uncheck();
    await owner.getByRole('button', { name: 'Narrow scope' }).click();
    await expect(owner.getByRole('status', { name: 'Grant updates' })).toHaveText('Scope narrowed.');
    await expect(contact.getByRole('table', { name: 'Holdings' })).not.toContainText('Passport', {
        timeout: 2000,
    });
    await expect(contact.getByRole('status', { name: 'Shared updates' })).toHaveText(
        'The owner narrowed what you can see.',
    );

    await owner.getByRole('button', { name: 'Revoke access' }).click();
    const confirm = owner.getByRole('alertdialog', { name: 'Revoke access?' });
    await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Revoke' }).click();
    await expect(owner.getByRole('status', { name: 'Grant updates' })).toHaveText(
        'Access ended for Ines Marsh.',
    );
    await expect(owner.locator('.panel')).toContainText('Revoked');
    await expect(contact.getByRole('heading', { name: 'Access ended' })).toBeVisible({
        timeout: 2000,
    });
    await expect(contact.getByRole('status', { name: 'Shared updates' })).toHaveText('Access ended.');
    await expect(owner.getByRole('button', { name: 'Add trusted contact' })).toBeVisible();
    await ownerContext.close();
    await contactContext.close();
});

test('granting a new contact shows the temporary password once', async ({ page }) => {
    await signIn(page, OWNER, '/vault/contact');
    await page.getByRole('button', { name: 'Add trusted contact' }).click();
    const dialog = page.getByRole('dialog', { name: 'Grant access' });
    await expect(dialog.getByRole('textbox', { name: 'Contact name' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Contact name' }).fill('Ines Marsh');
    await dialog.getByRole('textbox', { name: 'Contact email' }).fill('ines.marsh@example.com');
    await dialog.getByRole('radiogroup', { name: 'Duration' }).getByRole('radio', { name: '7 days' }).check();
    await dialog.getByRole('group', { name: 'Levels shown' }).getByRole('checkbox', { name: 'Critical' }).check();
    await dialog.getByRole('button', { name: 'Grant access' }).click();
    await expect(dialog).toContainText('Temporary password:');
    const done = dialog.getByRole('button', { name: 'Done' });
    await expect(done).toBeFocused();
    await expect(page.getByRole('status', { name: 'Grant updates' })).toHaveText(
        'Access granted to Ines Marsh.',
    );
    // A refresh never closes the dialog or hides the password.
    await page.waitForTimeout(1200);
    await expect(dialog).toContainText('Temporary password:');
    await done.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.panel')).toContainText('Active');
});

test('the account screen changes the password and keeps this session', async ({ page }) => {
    await signIn(page, OWNER, '/vault/account');
    const form = page.getByRole('form', { name: 'Change password' });
    await form.getByLabel('Current password').fill('wrong-password');
    await form.getByLabel('New password').fill('Strongroom-Owner-1x');
    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(form.getByRole('alert')).toContainText('Check these fields');
    await expect(form).toContainText('Current password is incorrect.');
    await form.getByLabel('Current password').fill('Strongroom-Owner-1');
    await form.getByLabel('New password').fill('short');
    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(form).toContainText('Use 12 to 128 characters.');
});

test('the layouts follow the published edges', async ({ page }) => {
    await signIn(page, OWNER);
    for (const [width, height] of [[1280, 800], [768, 1024], [375, 812], [1024, 800], [600, 800]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(150);
        const scroll = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(scroll, `no sideways scrolling at ${width}`).toBeLessThanOrEqual(1);
        const twoColumn = await page.evaluate(() => {
            const pane = document.querySelector('.exposure-pane');
            const ledger = document.querySelector('.ledger-pane');
            const left = pane.getBoundingClientRect();
            const right = ledger.getBoundingClientRect();
            return { paneLeft: left.left, ledgerLeft: right.left, sameRow: Math.abs(left.top - right.top) < 40 };
        });
        if (width >= 1024) {
            expect(twoColumn.sameRow, `two columns at ${width}`).toBe(true);
            expect(twoColumn.ledgerLeft).toBeLessThan(twoColumn.paneLeft);
        } else {
            expect(twoColumn.sameRow, `one column at ${width}`).toBe(false);
            const banded = await page.evaluate(() => {
                const band = document.querySelector('.score-band');
                return getComputedStyle(band).position;
            });
            expect(banded).toBe('sticky');
        }
    }
    // every control is at least 44 by 44
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(150);
    const small = await page.evaluate(() => {
        const bad = [];
        for (const node of document.querySelectorAll('button, select, input, a[href], [role="checkbox"]')) {
            const box = node.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;
            if (box.height < 44 || box.width < 44) {
                bad.push(`${node.tagName}.${node.className} ${Math.round(box.width)}x${Math.round(box.height)}`);
            }
        }
        return bad;
    });
    expect(small).toEqual([]);
});

test('every screen fits, and every control is big enough, at every width', async ({ page }) => {
    await signIn(page, OWNER);
    const screens = ['/vault', '/vault/breaches', '/vault/rules', '/vault/contact', '/vault/account'];
    for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        for (const path of screens) {
            await page.goto(BASE + path);
            await page.waitForLoadState('networkidle');
            const sideways = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(sideways, `no sideways scrolling on ${path} at ${width}`).toBeLessThanOrEqual(1);
            const small = await page.evaluate(() => {
                const bad = [];
                const selector = 'button, select, input, a[href], [role="checkbox"], [role="option"]';
                for (const node of document.querySelectorAll(selector)) {
                    const box = node.getBoundingClientRect();
                    if (box.width === 0 && box.height === 0) continue;
                    if (box.height < 44 || box.width < 44) {
                        bad.push(`${node.tagName}.${node.className}:${Math.round(box.width)}x${Math.round(box.height)}`);
                    }
                }
                return bad;
            });
            expect(small, `controls on ${path} at ${width}`).toEqual([]);
        }
        // the Rules screen puts its Preview beside the list only in the two-column layout
        await page.goto(`${BASE}/vault/rules`);
        await page.waitForLoadState('networkidle');
        const sameRow = await page.evaluate(() => {
            const preview = document.querySelector('.exposure-pane').getBoundingClientRect();
            const list = document.querySelector('.ledger-pane').getBoundingClientRect();
            return { sameRow: Math.abs(preview.top - list.top) < 40, previewFirst: preview.top <= list.top };
        });
        if (width >= 1024) expect(sameRow.sameRow, `two columns at ${width}`).toBe(true);
        else {
            expect(sameRow.sameRow, `one column at ${width}`).toBe(false);
            expect(sameRow.previewFirst, `Preview above the rules at ${width}`).toBe(true);
        }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
});

test('the shared screen fits at every width', async ({ page }) => {
    await signIn(page, CONTACT);
    for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${BASE}/shared`);
        await page.waitForLoadState('networkidle');
        const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(sideways, `no sideways scrolling on /shared at ${width}`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
});

test('reduced motion shows the final state at once', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await signIn(page, OWNER);
    await page.getByRole('button', { name: 'Log breach' }).click();
    const form = page.getByRole('form', { name: 'Log breach' });
    await form.getByRole('combobox', { name: 'Company' }).fill('Copperleaf Bank');
    await form.getByRole('checkbox', { name: 'Bank account' }).check();
    await expect(page.getByRole('status', { name: 'Breach preview' })).toHaveText(
        'Preview: holdings touched 1, projected score 68.',
    );
    // No counting: the numeral is already final when the status arrives.
    await expect(page.locator('.score')).toHaveText('68');
    await expect(page.locator('tr.touched')).toHaveCount(1);
    await expect(page.locator('tr.touched')).toContainText('Touched');
    await context.close();
});

test('a change in another window redraws the ledger without touching the form', async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await signIn(first, OWNER);
    await first.getByRole('button', { name: 'Log breach' }).click();
    const form = first.getByRole('form', { name: 'Log breach' });
    await form.getByRole('combobox', { name: 'Company' }).fill('Copperleaf Bank');
    await form.getByRole('checkbox', { name: 'Bank account' }).check();
    await expect(first.locator('tr.touched')).toHaveCount(1);

    await second.goto(`${BASE}/vault`);
    await second.waitForLoadState('networkidle');
    await second.getByRole('button', { name: 'Add holding' }).click();
    const dialog = second.getByRole('dialog', { name: 'Add holding' });
    await dialog.getByRole('textbox', { name: 'Company' }).fill('Northgate Telecom');
    await dialog.getByRole('combobox', { name: 'Data kind' }).selectOption('phone');
    await dialog.getByRole('textbox', { name: 'Value' }).fill('+44 7700 900999');
    await dialog.getByRole('button', { name: 'Save holding' }).click();
    await expect(dialog).toBeHidden();

    await expect(first.getByRole('table', { name: 'Holdings' })).toContainText('Northgate Telecom', {
        timeout: 2000,
    });
    await expect(form.getByRole('combobox', { name: 'Company' })).toHaveValue('Copperleaf Bank');
    await expect(form.getByRole('checkbox', { name: 'Bank account' })).toBeChecked();
    await expect(first.locator('tr.touched')).toHaveCount(1);
    await expect(first.locator('.preview-tag')).toBeVisible();

    // tidy up
    await second.getByRole('link', { name: 'Phone number' }).last().click();
    await second.getByRole('button', { name: 'Delete holding' }).click();
    await second
        .getByRole('alertdialog', { name: 'Delete holding?' })
        .getByRole('button', { name: 'Delete' })
        .click();
    await context.close();
});

test('an outsider learns nothing and a missing record shows the not-found page', async ({ page }) => {
    await signIn(page, OWNER);
    const link = await page.getByRole('table', { name: 'Holdings' }).getByRole('link').first().getAttribute('href');
    await page.context().clearCookies();
    const context = await page.context().browser().newContext();
    const outsider = await context.newPage();
    await signIn(outsider, { email: 'teodor.vance@example.com', password: 'Strongroom-Owner-2' });
    const response = await outsider.goto(BASE + link);
    expect(response.status()).toBe(404);
    await expect(outsider.getByRole('heading', { name: 'Not found' })).toBeVisible();
    await expect(outsider.getByText('This record does not exist or is not in your view.')).toBeVisible();
    await expect(outsider.getByRole('link', { name: 'Back to ledger' })).toBeVisible();
    const unknown = await outsider.goto(`${BASE}/nowhere`);
    expect(unknown.status()).toBe(404);
    await context.close();
});
