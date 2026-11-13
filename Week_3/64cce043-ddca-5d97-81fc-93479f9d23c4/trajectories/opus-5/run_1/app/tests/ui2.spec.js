// Browser checks: pointer drag, breach detail, stale edits, suggestions and dialogs.
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

test('a rule is moved by dragging its handle', async ({ page }) => {
    await signIn(page, OWNER, '/vault/rules');
    const rules = page.getByRole('list', { name: 'Rules' });
    const handle = page.getByRole('button', { name: 'Move rule: Any kind at clinic is Critical' });
    const start = await handle.boundingBox();
    const second = await rules.getByRole('listitem').nth(2).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2, second.y + second.height / 2, { steps: 10 });
    await expect(page.getByRole('status', { name: 'Rule order' })).toContainText('Position 3 of 13.');
    await page.mouse.up();
    await expect(page.getByRole('status', { name: 'Rule order' })).toContainText(
        'Dropped Any kind at clinic is Critical. Position 3 of 13.',
    );
    await expect(rules.getByRole('listitem').nth(2)).toContainText('Any kind at clinic is Critical');
    await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Projected score');
});

test('a live rule change cancels a pick-up and saves nothing', async ({ page }) => {
    await signIn(page, OWNER, '/vault/rules');
    const handle = page.getByRole('button', { name: 'Move rule: Passport is Critical' });
    const before = await page.evaluate(async () => {
        const answer = await fetch('/api/rules').then((r) => r.json());
        return answer.rules.map((rule) => rule.label);
    });
    await handle.focus();
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');
    await page.evaluate(async () => {
        await fetch('/api/rules', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data_kind: 'email', level: 'low' }),
        });
    });
    await expect(page.getByRole('status', { name: 'Rule order' })).toHaveText('Move cancelled.');
    const after = await page.evaluate(async () => {
        const answer = await fetch('/api/rules').then((r) => r.json());
        return answer.rules.map((rule) => rule.label);
    });
    expect(after.slice(0, before.length)).toEqual(before);
    // tidy up the added rule
    await page.evaluate(async () => {
        const answer = await fetch('/api/rules').then((r) => r.json());
        const last = answer.rules[answer.rules.length - 1];
        await fetch(`/api/rules/${last.id}`, { method: 'DELETE' });
    });
});

test('breach detail edits its kinds and refuses a stale save', async ({ page }) => {
    await signIn(page, OWNER, '/vault/breaches');
    await page.getByRole('link', { name: /Brightway Air/ }).click();
    await expect(page.getByRole('heading', { name: 'Breach at Brightway Air' })).toBeVisible();
    const kinds = page.getByRole('group', { name: 'Data kinds' });
    await expect(kinds.getByRole('checkbox', { name: 'Passport' })).toBeChecked();
    await expect(kinds.getByRole('checkbox', { name: 'Date of birth' })).toBeChecked();
    await expect(page.getByRole('table', { name: 'Affected holdings' }).getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('list', { name: 'Steps for this breach' }).getByRole('listitem')).toHaveCount(4);

    await kinds.getByRole('checkbox', { name: 'Email address' }).check();
    await expect(page.locator('.projected')).toContainText('Projected score 50');

    // another window edits the same breach first
    await page.evaluate(async () => {
        const list = await fetch('/api/breaches').then((r) => r.json());
        const breach = list.breaches[0];
        await fetch(`/api/breaches/${breach.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ version: breach.version, data_kinds: ['passport'] }),
        });
    });
    await page.getByRole('button', { name: 'Save kinds' }).click();
    await expect(page.getByRole('alert')).toContainText('This record changed in another window');
    await expect(kinds.getByRole('checkbox', { name: 'Email address' })).not.toBeChecked();
    await expect(kinds.getByRole('checkbox', { name: 'Date of birth' })).not.toBeChecked();
    await expect(page.locator('.projected')).toHaveText('');

    // saving again now works against the fresh version
    await kinds.getByRole('checkbox', { name: 'Date of birth' }).check();
    await page.getByRole('button', { name: 'Save kinds' }).click();
    await expect(page.getByRole('status', { name: 'Exposure updates' })).toContainText(
        'Breach updated. Exposure score 48.',
    );
});

test('an edit dialog keeps its entries when the record changed elsewhere', async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole('link', { name: 'Email address' }).first().click();
    await page.getByRole('button', { name: 'Edit holding' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit holding' });
    await dialog.getByRole('textbox', { name: 'Notes' }).fill('my careful note');
    await page.evaluate(async () => {
        const path = location.pathname.split('/').pop();
        const answer = await fetch(`/api/holdings/${path}`).then((r) => r.json());
        await fetch(`/api/holdings/${path}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ version: answer.holding.version, notes: 'from another window' }),
        });
    });
    await dialog.getByRole('button', { name: 'Save holding' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('This record changed in another window');
    await expect(dialog.getByRole('textbox', { name: 'Notes' })).toHaveValue('my careful note');
    await page.keyboard.press('Escape');
});

test('company suggestions stay clickable at every published width', async ({ page }) => {
    await signIn(page, OWNER);
    for (const [width, height] of [[1280, 800], [768, 1024], [375, 812]]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${BASE}/vault`);
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: 'Log breach' }).click();
        const form = page.getByRole('form', { name: 'Log breach' });
        await form.getByRole('combobox', { name: 'Company' }).press('ArrowDown');
        const options = page.getByRole('listbox', { name: 'Company suggestions' }).getByRole('option');
        await expect(options.first()).toBeVisible();
        const count = await options.count();
        for (let index = 0; index < count; index += 1) {
            const option = options.nth(index);
            await option.scrollIntoViewIfNeeded();
            const box = await option.boundingBox();
            const topmost = await page.evaluate(
                ([x, y]) => {
                    const node = document.elementFromPoint(x, y);
                    return node ? node.closest('[role="option"]') !== null : false;
                },
                [box.x + box.width / 2, box.y + box.height / 2],
            );
            expect(topmost, `option ${index} is topmost at ${width}px`).toBe(true);
            expect(box.height, `option ${index} is tall enough at ${width}px`).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox', { name: 'Company suggestions' })).toBeHidden();
        await expect(form.getByRole('combobox', { name: 'Company' })).toBeFocused();
    }
    await page.setViewportSize({ width: 1280, height: 800 });
});

test('the shared ledger filters and mirrors them in the address', async ({ page }) => {
    await signIn(page, CONTACT);
    await expect(page.getByRole('status', { name: 'Results' })).toContainText('Holdings shown:');
    await page.getByRole('searchbox', { name: 'Search holdings' }).pressSequentially('parcel', { delay: 30 });
    await expect(page).toHaveURL(`${BASE}/shared?q=parcel`);
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 2.');
    // A select change adds a history entry, so Back restores the earlier filters in place.
    await page.getByRole('combobox', { name: 'Level' }).selectOption('low');
    await expect(page).toHaveURL(`${BASE}/shared?q=parcel&level=low`);
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 1.');
    await page.goBack();
    await expect(page).toHaveURL(`${BASE}/shared?q=parcel`);
    await expect(page.getByRole('status', { name: 'Results' })).toHaveText('Holdings shown: 2.');
    await expect(page.getByRole('searchbox', { name: 'Search holdings' })).toHaveValue('parcel');
});

test('the grant dialog survives live events and refreshes', async ({ page }) => {
    await signIn(page, OWNER, '/vault/contact');
    await page.getByRole('button', { name: 'Revoke access' }).click();
    await page
        .getByRole('alertdialog', { name: 'Revoke access?' })
        .getByRole('button', { name: 'Revoke' })
        .click();
    await page.getByRole('button', { name: 'Add trusted contact' }).click();
    const dialog = page.getByRole('dialog', { name: 'Grant access' });
    await dialog.getByRole('textbox', { name: 'Contact name' }).fill('Ines Marsh');
    await dialog.getByRole('textbox', { name: 'Contact email' }).fill('ines.marsh@example.com');
    await dialog.getByRole('group', { name: 'Levels shown' }).getByRole('checkbox', { name: 'Critical' }).uncheck();
    // a change in another window
    await page.evaluate(async () => {
        await fetch('/api/holdings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ company: 'Dialog Test Ltd', data_kind: 'email', value: 'a@b.com' }),
        });
    });
    await page.waitForTimeout(1200);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Contact name' })).toHaveValue('Ines Marsh');
    await expect(
        dialog.getByRole('group', { name: 'Levels shown' }).getByRole('checkbox', { name: 'Critical' }),
    ).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Grant access' }).click();
    await expect(dialog).toContainText('Temporary password:');
    await page.waitForTimeout(1000);
    await expect(dialog).toContainText('Temporary password:');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.evaluate(async () => {
        const answer = await fetch('/api/holdings?company=Dialog%20Test%20Ltd').then((r) => r.json());
        for (const item of answer.items) await fetch(`/api/holdings/${item.id}`, { method: 'DELETE' });
    });
});
